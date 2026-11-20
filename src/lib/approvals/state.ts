import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvals, type ApprovalStatus } from "@/db/schema";

export const TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  pending: ["approved", "rejected", "expired", "superseded"],
  approved: ["executing", "superseded"],
  executing: ["completed", "failed"],
  rejected: [],
  expired: [],
  superseded: [],
  completed: [],
  failed: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus) {
  return TRANSITIONS[from].includes(to);
}

export type Approval = typeof approvals.$inferSelect;

/**
 * Moves an approval to `to` only if it is currently in a state that allows it.
 * The check and the write are one UPDATE, so two callers racing on the same
 * approval cannot both succeed. Returns null when the transition did not apply.
 */
export async function transitionApproval(
  id: string,
  to: ApprovalStatus,
  patch: Partial<Pick<Approval, "decidedAt" | "decidedBy" | "decisionNote" | "failureReason" | "executionRunId">> = {},
): Promise<Approval | null> {
  const allowedFrom = (Object.keys(TRANSITIONS) as ApprovalStatus[]).filter((from) =>
    canTransition(from, to),
  );
  const [row] = await db
    .update(approvals)
    .set({ status: to, ...patch })
    .where(and(eq(approvals.id, id), inArray(approvals.status, allowedFrom)))
    .returning();
  return row ?? null;
}

/** How a status reads in "This proposal was already ...". */
export function describeStatus(status: ApprovalStatus) {
  if (status === "executing" || status === "completed" || status === "failed") return "approved";
  if (status === "superseded") return "replaced by a newer version";
  return status;
}

export async function getApproval(id: string): Promise<Approval | null> {
  const [row] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  return row ?? null;
}
