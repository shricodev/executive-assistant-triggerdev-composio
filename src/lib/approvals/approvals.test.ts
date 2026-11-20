import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvals, APPROVAL_STATUSES } from "@/db/schema";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() };
});

const { db } = await import("@/db");
const { seedApproval, seedUser } = await import("@/test/db");
const { decide } = await import("./decide");
const { reviseReply } = await import("./revise");
const { canTransition, transitionApproval, getApproval } = await import("./state");

const beforeExpiry = new Date("2026-11-21T10:00:00Z");
const afterExpiry = new Date("2026-11-23T10:00:00Z");

let approval: Awaited<ReturnType<typeof seedApproval>>;

beforeEach(async () => {
  await seedUser(db, "owner");
  await seedUser(db, "intruder");
  approval = await seedApproval(db, "owner");
});

function input(overrides: Partial<Parameters<typeof decide>[0]> = {}) {
  return {
    approvalId: approval.id,
    userId: "owner",
    decision: "approved" as const,
    proposalHash: approval.proposalHash,
    now: beforeExpiry,
    ...overrides,
  };
}

describe("approval transitions", () => {
  it("only allows the documented lifecycle", () => {
    const allowed = APPROVAL_STATUSES.flatMap((from) =>
      APPROVAL_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        "pending>approved",
        "pending>rejected",
        "pending>expired",
        "pending>superseded",
        "approved>executing",
        "approved>superseded",
        "executing>completed",
        "executing>failed",
      ].sort(),
    );
  });

  it("refuses to execute an approval that was not approved", async () => {
    expect(await transitionApproval(approval.id, "executing")).toBeNull();
    await decide(input({ decision: "rejected" }));
    expect(await transitionApproval(approval.id, "executing")).toBeNull();
    expect((await getApproval(approval.id))?.status).toBe("rejected");
  });

  it("lets only one of two concurrent claims start execution", async () => {
    await decide(input());
    const claims = await Promise.all([
      transitionApproval(approval.id, "executing", { executionRunId: "run_a" }),
      transitionApproval(approval.id, "executing", { executionRunId: "run_b" }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe("decide", () => {
  it("records an approval by the owner", async () => {
    const result = await decide(input());
    expect(result).toMatchObject({ ok: true, repeated: false });

    const stored = await getApproval(approval.id);
    expect(stored).toMatchObject({ status: "approved", decidedBy: "owner", decidedAt: beforeExpiry });
  });

  it("hides another user's approval and leaves it untouched", async () => {
    const result = await decide(input({ userId: "intruder" }));
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect((await getApproval(approval.id))?.status).toBe("pending");
  });

  it("rejects a decision made against different proposal content", async () => {
    const result = await decide(input({ proposalHash: "0".repeat(64) }));
    expect(result).toMatchObject({ ok: false, code: "stale" });
    expect((await getApproval(approval.id))?.status).toBe("pending");
  });

  it("refuses a decision after expiry and marks the approval expired", async () => {
    const result = await decide(input({ now: afterExpiry }));
    expect(result).toMatchObject({ ok: false, code: "expired" });
    expect((await getApproval(approval.id))?.status).toBe("expired");
  });

  it("treats a repeated identical decision as already done", async () => {
    await decide(input());
    const again = await decide(input());
    expect(again).toMatchObject({ ok: true, repeated: true });
  });

  it("rejects a conflicting second decision", async () => {
    await decide(input({ decision: "rejected" }));
    const result = await decide(input({ decision: "approved" }));
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect((await getApproval(approval.id))?.status).toBe("rejected");
  });

  it("lets exactly one of two simultaneous opposite decisions win", async () => {
    const results = await Promise.all([
      decide(input({ decision: "approved" })),
      decide(input({ decision: "rejected" })),
    ]);
    const winners = results.filter((result) => result.ok && !result.repeated);
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);

    const [stored] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(["approved", "rejected"]).toContain(stored.status);
  });

  it("does not accept a decision once execution has started", async () => {
    await decide(input());
    await transitionApproval(approval.id, "executing", { executionRunId: "run_1" });
    const result = await decide(input({ decision: "rejected" }));
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect((await getApproval(approval.id))?.status).toBe("executing");
  });
});

describe("reviseReply", () => {
  const versions = () =>
    db.select().from(approvals).where(eq(approvals.requestId, approval.requestId));

  function drafts() {
    let created = 0;
    return {
      create: vi.fn(async () => {
        created += 1;
        return { draftId: `r-edit-${created}`, messageId: `edit-message-${created}` };
      }),
      remove: vi.fn(async () => undefined),
    };
  }

  function revision(overrides: Partial<Parameters<typeof reviseReply>[0]> = {}) {
    return {
      approvalId: approval.id,
      userId: "owner",
      proposalHash: approval.proposalHash,
      body: "Hi Priya, here is my own wording.",
      drafts: drafts(),
      now: beforeExpiry,
      ...overrides,
    };
  }

  it("stores the edit as a new pending version and replaces the old one", async () => {
    const store = drafts();
    const result = await reviseReply(revision({ drafts: store }));

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.approval).toMatchObject({
      status: "pending",
      version: 2,
      editedBy: "owner",
      draftId: "r-edit-1",
      draftMessageId: "edit-message-1",
      waitTokenId: approval.waitTokenId,
      expiresAt: approval.expiresAt,
    });
    expect(result.approval.proposal.email.body).toBe("Hi Priya, here is my own wording.");
    expect(result.approval.proposal.email.to).toBe(approval.proposal.email.to);
    expect(result.approval.proposalHash).not.toBe(approval.proposalHash);

    const original = await getApproval(approval.id);
    expect(original).toMatchObject({ status: "superseded", proposalHash: approval.proposalHash });
    expect(original?.proposal).toEqual(approval.proposal);
    expect(store.remove).toHaveBeenCalledWith("r-draft-1");
  });

  it("only accepts a decision for the edited version afterwards", async () => {
    const result = await reviseReply(revision());
    if (!result.ok) throw new Error("edit failed");

    expect(await decide(input())).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await decide(input({ approvalId: result.approval.id, proposalHash: approval.proposalHash })),
    ).toMatchObject({ ok: false, code: "stale" });
    expect(
      await decide(input({ approvalId: result.approval.id, proposalHash: result.approval.proposalHash })),
    ).toMatchObject({ ok: true, approval: { status: "approved", version: 2 } });
  });

  it("hides another user's approval and leaves it untouched", async () => {
    const store = drafts();
    const result = await reviseReply(revision({ userId: "intruder", drafts: store }));

    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(store.create).not.toHaveBeenCalled();
    expect((await getApproval(approval.id))?.status).toBe("pending");
  });

  it("rejects an edit made against different proposal content", async () => {
    const store = drafts();
    const result = await reviseReply(revision({ proposalHash: "0".repeat(64), drafts: store }));

    expect(result).toMatchObject({ ok: false, code: "stale" });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("refuses to edit a proposal that was already decided", async () => {
    await decide(input());
    const store = drafts();

    expect(await reviseReply(revision({ drafts: store }))).toMatchObject({ ok: false, code: "conflict" });
    expect(store.create).not.toHaveBeenCalled();
    expect(await versions()).toHaveLength(1);
  });

  it("refuses an edit after expiry and marks the approval expired", async () => {
    const result = await reviseReply(revision({ now: afterExpiry }));

    expect(result).toMatchObject({ ok: false, code: "expired" });
    expect((await getApproval(approval.id))?.status).toBe("expired");
  });

  it("rejects an empty or oversized reply", async () => {
    expect(await reviseReply(revision({ body: "  \n " }))).toMatchObject({ ok: false, code: "invalid" });
    expect(await reviseReply(revision({ body: "x".repeat(8001) }))).toMatchObject({ ok: false, code: "invalid" });
    expect((await getApproval(approval.id))?.status).toBe("pending");
  });

  it("does nothing when the text was not changed", async () => {
    const store = drafts();
    const result = await reviseReply(revision({ body: `${approval.proposal.email.body}\r\n`, drafts: store }));

    expect(result).toMatchObject({ ok: true, changed: false, approval: { id: approval.id } });
    expect(store.create).not.toHaveBeenCalled();
    expect(await versions()).toHaveLength(1);
  });

  it("leaves the proposal as it was when the new draft cannot be created", async () => {
    const store = { ...drafts(), create: vi.fn(async () => { throw new Error("Gmail is down"); }) };

    await expect(reviseReply(revision({ drafts: store }))).rejects.toThrow("Gmail is down");
    expect((await getApproval(approval.id))?.status).toBe("pending");
    expect(await versions()).toHaveLength(1);
  });

  it("lets one of two simultaneous edits win and removes the loser's draft", async () => {
    const first = drafts();
    const second = drafts();
    const results = await Promise.all([
      reviseReply(revision({ body: "First wording.", drafts: first })),
      reviseReply(revision({ body: "Second wording.", drafts: second })),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "conflict" });
    const rows = await versions();
    expect(rows.map((row) => row.status).sort()).toEqual(["pending", "superseded"]);
    const loser = results[0].ok ? second : first;
    expect(loser.remove).toHaveBeenCalledWith("r-edit-1");
  });

  it("lets an edit and a decision racing on the same version produce one outcome", async () => {
    const [edited, decided] = await Promise.all([reviseReply(revision()), decide(input())]);

    expect(Number(edited.ok) + Number(decided.ok)).toBe(1);
    const rows = await versions();
    expect(rows.filter((row) => row.status === "approved" || row.status === "pending")).toHaveLength(1);
  });
});
