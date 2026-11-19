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
