import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { actions, ACTION_KINDS, type ActionKind } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { getApproval, transitionApproval, type Approval } from "@/lib/approvals/state";
import { runAction, type Action, type ActionHandler, type ExecutorOptions } from "./executor";

const LABELS: Record<ActionKind, { done: string; failed: string }> = {
  create_event: { done: "Calendar event created", failed: "Calendar event was not created" },
  send_email: { done: "Reply sent", failed: "Reply was not sent" },
};

export function summarizeFailure(results: Action[]): string {
  const event = results.find((action) => action.kind === "create_event");
  const email = results.find((action) => action.kind === "send_email");

  if (event?.status === "failed") {
    return `The calendar event could not be created, so the reply was not sent. ${event.error ?? ""}`.trim();
  }
  if (email?.status === "failed") {
    const prefix = event?.status === "succeeded" ? "The calendar event was created, but the reply was not sent." : "The reply was not sent.";
    return `${prefix} ${email.error ?? ""}`.trim();
  }
  return "The approved actions did not finish.";
}

export type ExecutionResult = { status: Approval["status"]; actions: Action[] };

/**
 * Executes exactly the actions listed in an approved proposal, in a fixed
 * order, and records what happened to each one.
 *
 * `runId` is the Trigger.dev run executing the approval. The first run to
 * claim an approval owns it; a retried attempt of that run continues where it
 * stopped, and any other run leaves it alone.
 */
export async function executeApproval(
  approvalId: string,
  runId: string,
  handlerFor: (kind: ActionKind, approval: Approval) => ActionHandler,
  options: ExecutorOptions = {},
): Promise<ExecutionResult> {
  await transitionApproval(approvalId, "executing", { executionRunId: runId });

  const approval = await getApproval(approvalId);
  if (!approval) throw new Error(`Approval ${approvalId} not found`);
  if (approval.status !== "executing" || approval.executionRunId !== runId) {
    const existing = await db.select().from(actions).where(eq(actions.approvalId, approvalId));
    return { status: approval.status, actions: existing };
  }

  const kinds = ACTION_KINDS.filter((kind) => approval.proposal.actions.includes(kind));
  await db
    .insert(actions)
    .values(kinds.map((kind) => ({ approvalId, kind })))
    .onConflictDoNothing({ target: [actions.approvalId, actions.kind] });

  const results: Action[] = [];
  for (const kind of kinds) {
    const [row] = await db
      .select()
      .from(actions)
      .where(and(eq(actions.approvalId, approvalId), eq(actions.kind, kind)))
      .limit(1);
    const wasTerminal = row.status === "succeeded" || row.status === "failed";

    const action = await runAction(row.id, handlerFor(kind, approval), options);
    results.push(action);

    if (!wasTerminal) {
      await recordActivity(db, {
        userId: approval.userId,
        requestId: approval.requestId,
        type: `action.${action.status}`,
        message: action.status === "succeeded" ? LABELS[kind].done : `${LABELS[kind].failed}: ${action.error}`,
        runId,
      });
    }
    // Later actions depend on earlier ones: the reply mentions the invite.
    if (action.status !== "succeeded") break;
  }

  const succeeded = results.length === kinds.length && results.every((action) => action.status === "succeeded");
  const final = await transitionApproval(
    approvalId,
    succeeded ? "completed" : "failed",
    succeeded ? {} : { failureReason: summarizeFailure(results) },
  );
  return { status: final?.status ?? approval.status, actions: results };
}
