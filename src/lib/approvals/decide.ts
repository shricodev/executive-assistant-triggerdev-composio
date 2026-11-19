import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { approvals } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { transitionApproval, type Approval } from "./state";

export type Decision = "approved" | "rejected";

export type DecisionInput = {
  approvalId: string;
  userId: string;
  decision: Decision;
  /** Hash of the proposal the user was looking at when they decided. */
  proposalHash: string;
  note?: string;
  now?: Date;
};

export type DecisionResult =
  | { ok: true; approval: Approval; repeated: boolean }
  | { ok: false; code: "not_found" | "stale" | "expired" | "conflict"; message: string };

/**
 * Records a human decision. Only the owner can decide, only once, only before
 * expiry, and only for the exact proposal they were shown. Resuming the
 * suspended run is the caller's job; this function touches the database only.
 */
export async function decide(input: DecisionInput): Promise<DecisionResult> {
  const now = input.now ?? new Date();

  // Ownership is part of the lookup, so another user's approval is
  // indistinguishable from one that does not exist.
  const [current] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, input.approvalId), eq(approvals.userId, input.userId)))
    .limit(1);
  if (!current) {
    return { ok: false, code: "not_found", message: "Approval not found." };
  }
  if (current.proposalHash !== input.proposalHash) {
    return {
      ok: false,
      code: "stale",
      message: "This proposal changed since you opened it. Reload and review it again.",
    };
  }
  if (current.status === input.decision) {
    return { ok: true, approval: current, repeated: true };
  }
  if (current.status !== "pending") {
    return {
      ok: false,
      code: "conflict",
      message: `This proposal was already ${describe(current.status)}.`,
    };
  }
  if (current.expiresAt <= now) {
    await transitionApproval(current.id, "expired");
    return { ok: false, code: "expired", message: "This proposal has expired." };
  }

  const [updated] = await db
    .update(approvals)
    .set({
      status: input.decision,
      decidedAt: now,
      decidedBy: input.userId,
      decisionNote: input.note?.trim() || null,
    })
    .where(
      and(
        eq(approvals.id, current.id),
        eq(approvals.userId, input.userId),
        eq(approvals.status, "pending"),
        gt(approvals.expiresAt, now),
      ),
    )
    .returning();

  if (!updated) {
    // Lost a race with another decision or with expiry.
    const [latest] = await db.select().from(approvals).where(eq(approvals.id, current.id)).limit(1);
    if (latest?.status === input.decision) {
      return { ok: true, approval: latest, repeated: true };
    }
    return {
      ok: false,
      code: "conflict",
      message: `This proposal was already ${describe(latest?.status ?? "decided")}.`,
    };
  }

  await recordActivity(db, {
    userId: input.userId,
    requestId: updated.requestId,
    type: `approval.${input.decision}`,
    message: input.decision === "approved" ? "Proposal approved" : "Proposal rejected",
  });
  return { ok: true, approval: updated, repeated: false };
}

function describe(status: string) {
  if (status === "executing" || status === "completed" || status === "failed") return "approved";
  if (status === "superseded") return "replaced by a newer proposal";
  return status;
}
