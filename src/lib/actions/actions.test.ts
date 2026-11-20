import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, approvals, type ActionKind } from "@/db/schema";
import type { ActionHandler, Reconciliation } from "./executor";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() };
});

const { db } = await import("@/db");
const { seedApproval, seedUser, proposalFixture } = await import("@/test/db");
const { decide } = await import("@/lib/approvals/decide");
const { getApproval } = await import("@/lib/approvals/state");
const { PermanentActionError, runAction } = await import("./executor");
const { executeApproval } = await import("./execute");

const sleep = async () => undefined;
const now = new Date("2026-11-21T10:00:00Z");

function handler(overrides: Partial<ActionHandler> = {}) {
  return {
    perform: vi.fn(async () => ({ messageId: "sent_1" })),
    reconcile: vi.fn(async (): Promise<Reconciliation> => ({ state: "not_done" })),
    ...overrides,
  };
}

async function seedAction(kind: ActionKind = "send_email", values: Partial<typeof actions.$inferInsert> = {}) {
  await seedUser(db, "owner");
  const approval = await seedApproval(db, "owner");
  const [action] = await db.insert(actions).values({ approvalId: approval.id, kind, ...values }).returning();
  return action;
}

describe("runAction", () => {
  it("performs the action once and stores the provider result", async () => {
    const action = await seedAction();
    const h = handler();

    const result = await runAction(action.id, h, { sleep });

    expect(result).toMatchObject({ status: "succeeded", attempts: 1, result: { messageId: "sent_1" } });
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it("never performs an action that already succeeded", async () => {
    const action = await seedAction();
    const h = handler();
    await runAction(action.id, h, { sleep });
    await runAction(action.id, h, { sleep });
    await Promise.all([runAction(action.id, h, { sleep }), runAction(action.id, h, { sleep })]);

    expect(h.perform).toHaveBeenCalledTimes(1);
  });

  it("performs once when two workers race on a fresh action", async () => {
    const action = await seedAction();
    const h = handler({
      // Whoever loses the claim finds the row executing and reconciles.
      reconcile: vi.fn(async (): Promise<Reconciliation> => ({ state: "done", result: { messageId: "sent_1" } })),
    });

    await Promise.all([runAction(action.id, h, { sleep }), runAction(action.id, h, { sleep })]);

    expect(h.perform).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the call when an earlier attempt already took effect", async () => {
    // The previous run crashed after calling the provider and before recording the result.
    const action = await seedAction("send_email", { status: "executing", attempts: 1 });
    const h = handler({
      reconcile: vi.fn(async (): Promise<Reconciliation> => ({ state: "done", result: { messageId: "sent_before_crash" } })),
    });

    const result = await runAction(action.id, h, { sleep });

    expect(result).toMatchObject({ status: "succeeded", result: { messageId: "sent_before_crash" } });
    expect(h.perform).not.toHaveBeenCalled();
  });

  it("fails without retrying when the outcome of an earlier attempt cannot be determined", async () => {
    const action = await seedAction("send_email", { status: "executing", attempts: 1 });
    const h = handler({
      reconcile: vi.fn(async (): Promise<Reconciliation> => ({ state: "unknown", reason: "Draft is gone" })),
    });

    const result = await runAction(action.id, h, { sleep });

    expect(result).toMatchObject({ status: "failed", error: "Draft is gone" });
    expect(h.perform).not.toHaveBeenCalled();
  });

  it("retries a transient failure after confirming nothing happened", async () => {
    const action = await seedAction();
    const perform = vi
      .fn<ActionHandler["perform"]>()
      .mockRejectedValueOnce(new Error("503 from provider"))
      .mockResolvedValueOnce({ messageId: "sent_2" });
    const h = handler({ perform });

    const result = await runAction(action.id, h, { sleep });

    expect(result).toMatchObject({ status: "succeeded", attempts: 2, error: null });
    expect(h.reconcile).toHaveBeenCalledTimes(1);
  });

  it("never calls the provider again when the outcome check itself keeps failing", async () => {
    const action = await seedAction("send_email", { status: "executing", attempts: 1 });
    const h = handler({
      reconcile: vi.fn(async (): Promise<Reconciliation> => { throw new Error("GMAIL_GET_DRAFT: unexpected response"); }),
    });

    const result = await runAction(action.id, h, { sleep, maxAttempts: 3 });

    expect(result).toMatchObject({ status: "failed", attempts: 1 });
    expect(result.error).toContain("Could not confirm whether an earlier attempt took effect");
    expect(result.error).toContain("GMAIL_GET_DRAFT");
    expect(h.reconcile).toHaveBeenCalledTimes(3);
    expect(h.perform).not.toHaveBeenCalled();
  });

  it("retries the outcome check before deciding", async () => {
    const action = await seedAction("send_email", { status: "executing", attempts: 1 });
    const reconcile = vi
      .fn<ActionHandler["reconcile"]>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ state: "done", result: { messageId: "sent_before_crash" } });
    const h = handler({ reconcile });

    const result = await runAction(action.id, h, { sleep });

    expect(result).toMatchObject({ status: "succeeded", result: { messageId: "sent_before_crash" } });
    expect(h.perform).not.toHaveBeenCalled();
  });

  it("gives up after the attempt limit and reports the last error", async () => {
    const action = await seedAction();
    const h = handler({ perform: vi.fn(async () => { throw new Error("503 from provider"); }) });

    const result = await runAction(action.id, h, { sleep, maxAttempts: 3 });

    expect(result).toMatchObject({ status: "failed", attempts: 3, error: "503 from provider" });
    expect(h.perform).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent failure", async () => {
    const action = await seedAction();
    const h = handler({
      perform: vi.fn(async () => { throw new PermanentActionError("The Gmail draft was edited after it was approved"); }),
    });

    const result = await runAction(action.id, h, { sleep });

    expect(result).toMatchObject({ status: "failed", attempts: 1 });
    expect(h.perform).toHaveBeenCalledTimes(1);
  });

  it("leaves a failed action failed", async () => {
    const action = await seedAction("send_email", { status: "failed", attempts: 3, error: "gave up" });
    const h = handler();
    expect(await runAction(action.id, h, { sleep })).toMatchObject({ status: "failed" });
    expect(h.perform).not.toHaveBeenCalled();
  });
});

describe("executeApproval", () => {
  let approvalId: string;
  let performed: ActionKind[];

  function handlers(failing: Partial<Record<ActionKind, Error>> = {}) {
    return (kind: ActionKind): ActionHandler => ({
      perform: async () => {
        performed.push(kind);
        const error = failing[kind];
        if (error) throw error;
        return kind === "create_event" ? { eventId: "evt_1", url: "https://calendar.example/evt_1" } : { messageId: "sent_1" };
      },
      reconcile: async () => ({ state: "not_done" }),
    });
  }

  beforeEach(async () => {
    performed = [];
    await seedUser(db, "owner");
    const approval = await seedApproval(db, "owner");
    approvalId = approval.id;
  });

  async function approve(id = approvalId) {
    const current = await getApproval(id);
    const result = await decide({
      approvalId: id,
      userId: "owner",
      decision: "approved",
      proposalHash: current!.proposalHash,
      now,
    });
    expect(result.ok).toBe(true);
  }

  it("creates the event, then sends the reply, and completes", async () => {
    await approve();
    const result = await executeApproval(approvalId, "run_1", handlers(), { sleep });

    expect(performed).toEqual(["create_event", "send_email"]);
    expect(result.status).toBe("completed");
    expect(result.actions.map((action) => action.result)).toEqual([
      { eventId: "evt_1", url: "https://calendar.example/evt_1" },
      { messageId: "sent_1" },
    ]);
  });

  it("executes nothing for a rejected approval", async () => {
    const current = await getApproval(approvalId);
    await decide({
      approvalId,
      userId: "owner",
      decision: "rejected",
      proposalHash: current!.proposalHash,
      now,
    });

    const result = await executeApproval(approvalId, "run_1", handlers(), { sleep });

    expect(performed).toEqual([]);
    expect(result.status).toBe("rejected");
    expect(await db.select().from(actions).where(eq(actions.approvalId, approvalId))).toHaveLength(0);
  });

  it("executes nothing while the approval is still pending", async () => {
    const result = await executeApproval(approvalId, "run_1", handlers(), { sleep });
    expect(performed).toEqual([]);
    expect(result.status).toBe("pending");
  });

  it("only runs the actions the approved proposal lists", async () => {
    const emailOnly = { ...proposalFixture, meeting: null, actions: ["send_email" as const] };
    const approval = await seedApproval(db, "owner", { proposal: emailOnly });
    await approve(approval.id);

    await executeApproval(approval.id, "run_1", handlers(), { sleep });

    expect(performed).toEqual(["send_email"]);
  });

  it("does not send the reply when the event could not be created", async () => {
    await approve();
    const result = await executeApproval(
      approvalId,
      "run_1",
      handlers({ create_event: new PermanentActionError("Calendar rejected the event") }),
      { sleep },
    );

    expect(performed).toEqual(["create_event"]);
    expect(result.status).toBe("failed");
    const stored = await getApproval(approvalId);
    expect(stored?.failureReason).toContain("could not be created, so the reply was not sent");
  });

  it("reports a partial failure accurately when the event exists but the reply failed", async () => {
    await approve();
    const result = await executeApproval(
      approvalId,
      "run_1",
      handlers({ send_email: new PermanentActionError("The Gmail draft no longer exists") }),
      { sleep },
    );

    expect(result.status).toBe("failed");
    expect(result.actions.map((action) => [action.kind, action.status])).toEqual([
      ["create_event", "succeeded"],
      ["send_email", "failed"],
    ]);
    const stored = await getApproval(approvalId);
    expect(stored?.failureReason).toContain("calendar event was created, but the reply was not sent");
  });

  it("does not repeat finished actions when the same run is retried", async () => {
    await approve();
    await executeApproval(approvalId, "run_1", handlers(), { sleep });
    const retry = await executeApproval(approvalId, "run_1", handlers(), { sleep });

    expect(performed).toEqual(["create_event", "send_email"]);
    expect(retry.status).toBe("completed");
  });

  it("resumes after a crash without redoing the action that already succeeded", async () => {
    // State a crashed attempt of run_1 leaves behind: the event was created
    // and recorded, the send had started and its outcome was never written.
    await approve();
    await db
      .update(approvals)
      .set({ status: "executing", executionRunId: "run_1" })
      .where(eq(approvals.id, approvalId));
    await db.insert(actions).values([
      { approvalId, kind: "create_event", status: "succeeded", attempts: 1, result: { eventId: "evt_1" } },
      { approvalId, kind: "send_email", status: "executing", attempts: 1 },
    ]);

    const result = await executeApproval(approvalId, "run_1", handlers(), { sleep });

    expect(performed).toEqual(["send_email"]);
    expect(result.status).toBe("completed");
  });

  it("keeps a second run out while another run is executing the approval", async () => {
    await approve();
    await db
      .update(approvals)
      .set({ status: "executing", executionRunId: "run_1" })
      .where(eq(approvals.id, approvalId));

    const other = await executeApproval(approvalId, "run_2", handlers(), { sleep });

    expect(performed).toEqual([]);
    expect(other.status).toBe("executing");
  });

  it("does nothing when a different run arrives after completion", async () => {
    await approve();
    await executeApproval(approvalId, "run_1", handlers(), { sleep });
    performed = [];

    const other = await executeApproval(approvalId, "run_2", handlers(), { sleep });

    expect(performed).toEqual([]);
    expect(other.status).toBe("completed");
  });
});
