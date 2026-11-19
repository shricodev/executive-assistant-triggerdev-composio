import { AbortTaskRunError, logger, metadata, schemaTask, wait } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { approvals, requests } from "@/db/schema";
import { agentEnv, env } from "@/env";
import { executeApproval } from "@/lib/actions/execute";
import { handlerFor } from "@/lib/actions/handlers";
import { recordActivity } from "@/lib/activity";
import { analyzeEmail } from "@/lib/agent/analyze";
import { buildProposal, type ProposalResult } from "@/lib/agent/output";
import { checkMeetingTime } from "@/lib/agent/schedule";
import type { Decision } from "@/lib/approvals/decide";
import { createApproval, findApproval } from "@/lib/approvals/proposals";
import { getApproval, transitionApproval, type Approval } from "@/lib/approvals/state";
import { isSlotFree } from "@/lib/composio/calendar";
import {
  AGENT_TOOLS,
  openSession,
  WORKFLOW_TOOLS,
  type Accounts,
  type ComposioSession,
} from "@/lib/composio/client";
import { getAccounts } from "@/lib/composio/connections";
import { createReplyDraft, deleteDraft } from "@/lib/composio/gmail";
import { getSettings, type Settings } from "@/lib/settings";

// One original proposal plus one replacement if the slot is taken while waiting.
const MAX_PROPOSALS = 2;
const MAX_AGENT_ATTEMPTS = 2;

type Request = typeof requests.$inferSelect;

type Context = {
  request: Request;
  accounts: Accounts;
  settings: Settings;
  runId: string;
  recordContent: boolean;
};

export type DecisionPayload = { decision: Decision };

async function withSession<T>(
  context: Context,
  allowlist: typeof AGENT_TOOLS | typeof WORKFLOW_TOOLS,
  work: (session: ComposioSession) => Promise<T>,
): Promise<T> {
  const session = await openSession(context.request.userId, context.accounts, allowlist);
  try {
    return await work(session);
  } finally {
    await session.delete().catch(() => undefined);
  }
}

/** Runs the agent until its suggestion passes the code-level checks. */
async function draftProposal(context: Context, feedback?: string): Promise<ProposalResult> {
  const { request, settings, accounts } = context;
  const calendarConnected = Boolean(accounts.googlecalendar);

  return withSession(context, AGENT_TOOLS, async (session) => {
    let result: ProposalResult = { kind: "invalid", reason: "The agent was not run." };

    for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
      const now = new Date();
      const analysis = await analyzeEmail({
        session,
        threadId: request.gmailThreadId,
        recordContent: context.recordContent,
        email: {
          from: request.senderEmail,
          fromName: request.senderName,
          subject: request.subject,
          body: request.body,
          receivedAt: request.receivedAt,
        },
        settings,
        calendarConnected,
        now,
        feedback,
      });

      result = buildProposal({
        output: analysis.output,
        documentsRead: analysis.documentsRead,
        request,
        settings,
        calendarConnected,
        now,
      });

      if (result.kind === "proposal" && result.proposal.meeting) {
        const free = await isSlotFree(session, result.proposal.meeting);
        if (!free) {
          result = {
            kind: "invalid",
            reason: `${result.proposal.meeting.start} is not free on the calendar. Check availability again and pick a different time.`,
          };
        }
      }

      if (result.kind !== "invalid") return result;
      feedback = result.reason;
      logger.warn("Agent proposal rejected by guard", { attempt, reason: result.reason });
    }
    return result;
  });
}

async function propose(
  context: Context,
  version: number,
  feedback?: string,
): Promise<Approval | null> {
  const { request, runId } = context;
  metadata.set("stage", "analyzing");

  const result = await draftProposal(context, feedback);
  if (result.kind === "invalid") {
    throw new Error(`The agent could not produce a usable proposal: ${result.reason}`);
  }

  if (result.kind === "skip") {
    await db
      .update(requests)
      .set({ status: "skipped", summary: result.reason })
      .where(eq(requests.id, request.id));
    await recordActivity(db, {
      userId: request.userId,
      requestId: request.id,
      type: "email.skipped",
      message: `No reply needed: ${result.reason}`,
      runId,
    });
    return null;
  }

  const proposal = result.proposal;
  const expiresAt = new Date(Date.now() + env().APPROVAL_TTL_HOURS * 3_600_000);

  // Keyed so a retried attempt gets the same token instead of a second one.
  const token = await wait.createToken({
    timeout: expiresAt,
    idempotencyKey: `approval:${request.id}:${version}`,
    tags: [`request:${request.id}`],
  });

  return withSession(context, WORKFLOW_TOOLS, async (session) => {
    const draft = await createReplyDraft(session, proposal.email);
    try {
      return await createApproval({
        requestId: request.id,
        userId: request.userId,
        version,
        proposal,
        draftId: draft.draftId,
        draftMessageId: draft.messageId,
        waitTokenId: token.id,
        expiresAt,
        runId,
      });
    } catch (error) {
      await deleteDraft(session, draft.draftId).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Suspends the run until a human decides or the token times out. The token's
 * output is only a wake-up signal: the decision is read from the database,
 * where it was written by an authenticated, owner-checked, single-use update.
 */
async function awaitDecision(context: Context, approval: Approval): Promise<Approval> {
  if (approval.status === "pending" && approval.waitTokenId) {
    metadata.set("stage", "awaiting_approval");
    const result = await wait.forToken<DecisionPayload>(approval.waitTokenId);
    logger.info("Resumed from approval wait", { approvalId: approval.id, timedOut: !result.ok });
  }

  const current = await getApproval(approval.id);
  if (!current) throw new AbortTaskRunError(`Approval ${approval.id} no longer exists`);
  if (current.status !== "pending") return current;

  const expired = await transitionApproval(current.id, "expired");
  if (!expired) return (await getApproval(current.id)) ?? current;

  await recordActivity(db, {
    userId: current.userId,
    requestId: current.requestId,
    type: "approval.expired",
    message: "Proposal expired without a decision",
    runId: context.runId,
  });
  return expired;
}

async function discardDraft(context: Context, approval: Approval) {
  if (!approval.draftId) return;
  const draftId = approval.draftId;
  await withSession(context, WORKFLOW_TOOLS, (session) => deleteDraft(session, draftId));
}

/**
 * Availability can change during a long wait. Returns a reason when the
 * approved meeting can no longer be honoured as written.
 */
async function recheck(context: Context, approval: Approval): Promise<string | null> {
  const meeting = approval.proposal.meeting;
  if (!meeting) return null;

  const timing = checkMeetingTime(meeting, context.settings, new Date());
  if (!timing.ok) return `The approved time is no longer valid. ${timing.reason}`;

  const free = await withSession(context, WORKFLOW_TOOLS, (session) => isSlotFree(session, meeting));
  return free ? null : `${meeting.start} was booked while the proposal was waiting for approval.`;
}

export const processEmail = schemaTask({
  id: "process-email",
  schema: z.object({ requestId: z.uuid() }),
  retry: { maxAttempts: 3 },
  onFailure: async ({ payload, error, ctx }) => {
    const message = error instanceof Error ? error.message : "The workflow failed.";
    const [request] = await db
      .update(requests)
      .set({ status: "failed", error: message })
      .where(and(eq(requests.id, payload.requestId), eq(requests.status, "processing")))
      .returning();
    // A crash during execution leaves the approval `executing`. Close it so
    // the dashboard does not show work in progress that will never finish.
    const stuck = await db
      .update(approvals)
      .set({ status: "failed", failureReason: message })
      .where(
        and(
          eq(approvals.requestId, payload.requestId),
          inArray(approvals.status, ["approved", "executing"]),
        ),
      )
      .returning();
    const userId = request?.userId ?? stuck[0]?.userId;
    if (userId) {
      await recordActivity(db, {
        userId,
        requestId: payload.requestId,
        type: "workflow.failed",
        message,
        runId: ctx.run.id,
      });
    }
  },
  run: async ({ requestId }, { ctx }) => {
    const [request] = await db
      .update(requests)
      .set({ runId: ctx.run.id })
      .where(eq(requests.id, requestId))
      .returning();
    if (!request) throw new AbortTaskRunError(`Request ${requestId} not found`);
    if (request.status === "skipped") return { status: "skipped" as const };

    const accounts = await getAccounts(request.userId);
    if (!accounts) throw new AbortTaskRunError("Gmail is not connected for this user");

    const context: Context = {
      request,
      accounts,
      settings: await getSettings(request.userId),
      runId: ctx.run.id,
      recordContent: agentEnv().AI_TRACE_CONTENT ?? ctx.environment.type === "DEVELOPMENT",
    };

    let feedback: string | undefined;

    for (let version = 1; version <= MAX_PROPOSALS; version++) {
      // On a retried attempt the proposal for this version already exists.
      let approval = await findApproval(requestId, version);
      approval ??= await propose(context, version, feedback);
      if (!approval) return { status: "skipped" as const };

      if (approval.status === "superseded") {
        feedback = approval.failureReason ?? undefined;
        continue;
      }

      approval = await awaitDecision(context, approval);
      if (approval.status === "rejected" || approval.status === "expired") {
        await discardDraft(context, approval);
        return { status: approval.status, approvalId: approval.id };
      }

      if (approval.status === "approved") {
        const conflict = await recheck(context, approval);
        if (conflict) {
          const superseded = await transitionApproval(approval.id, "superseded", {
            failureReason: conflict,
          });
          if (superseded) {
            await discardDraft(context, approval);
            await recordActivity(db, {
              userId: request.userId,
              requestId,
              type: "approval.superseded",
              message: `Nothing was sent. ${conflict}`,
              runId: ctx.run.id,
            });
            feedback = conflict;
            continue;
          }
        }
      }

      metadata.set("stage", "executing");
      const execution = await withSession(context, WORKFLOW_TOOLS, (session) =>
        executeApproval(approval.id, ctx.run.id, (kind, current) =>
          handlerFor(kind, session, current),
        ),
      );
      metadata.set("stage", execution.status);
      return { status: execution.status, approvalId: approval.id };
    }

    const message = `No usable meeting time after ${MAX_PROPOSALS} proposals. ${feedback ?? ""}`.trim();
    await db.update(requests).set({ status: "failed", error: message }).where(eq(requests.id, requestId));
    throw new AbortTaskRunError(message);
  },
});
