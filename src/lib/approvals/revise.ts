import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { approvals } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { hashProposal, REPLY_MAX_LENGTH, type Proposal } from "@/lib/agent/proposal";
import { describeStatus, transitionApproval, type Approval } from "./state";

/** Where the reply draft lives. Gmail in the app, a fake in tests. */
export type DraftStore = {
  create: (reply: Proposal["email"]) => Promise<{ draftId: string; messageId: string }>;
  remove: (draftId: string) => Promise<void>;
};

export type RevisionInput = {
  approvalId: string;
  userId: string;
  /** Hash of the proposal the user was editing. */
  proposalHash: string;
  body: string;
  drafts: DraftStore;
  now?: Date;
};

export type RevisionResult =
  | { ok: true; approval: Approval; changed: boolean }
  | {
      ok: false;
      code: "not_found" | "invalid" | "stale" | "expired" | "conflict";
      message: string;
    };

class LostRace extends Error {}

/**
 * Replaces the reply text of a pending proposal with the owner's own wording.
 *
 * A stored proposal is never modified. The edit becomes the next version, with
 * its own hash and Gmail draft, and the version it replaces is superseded. Both
 * share one wait token, so a decision on the new version resumes the same run.
 */
export async function reviseReply(input: RevisionInput): Promise<RevisionResult> {
  const now = input.now ?? new Date();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body || body.length > REPLY_MAX_LENGTH) {
    return {
      ok: false,
      code: "invalid",
      message: `The reply must be between 1 and ${REPLY_MAX_LENGTH} characters.`,
    };
  }

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
  if (current.status !== "pending") {
    return {
      ok: false,
      code: "conflict",
      message: `This proposal was already ${describeStatus(current.status)}.`,
    };
  }
  if (current.expiresAt <= now) {
    await transitionApproval(current.id, "expired");
    return { ok: false, code: "expired", message: "This proposal has expired." };
  }
  if (body === current.proposal.email.body) {
    return { ok: true, approval: current, changed: false };
  }

  const proposal: Proposal = { ...current.proposal, email: { ...current.proposal.email, body } };
  const draft = await input.drafts.create(proposal.email);

  let revised: Approval;
  try {
    revised = await db.transaction(async (tx) => {
      const [replaced] = await tx
        .update(approvals)
        .set({ status: "superseded" })
        .where(
          and(
            eq(approvals.id, current.id),
            eq(approvals.status, "pending"),
            gt(approvals.expiresAt, now),
          ),
        )
        .returning({ id: approvals.id });
      if (!replaced) throw new LostRace();

      const [next] = await tx
        .insert(approvals)
        .values({
          requestId: current.requestId,
          userId: current.userId,
          version: current.version + 1,
          proposal,
          proposalHash: hashProposal(proposal),
          draftId: draft.draftId,
          draftMessageId: draft.messageId,
          waitTokenId: current.waitTokenId,
          expiresAt: current.expiresAt,
          editedBy: input.userId,
        })
        .returning();

      await recordActivity(tx, {
        userId: input.userId,
        requestId: current.requestId,
        type: "proposal.edited",
        message: "Reply edited before approval",
      });
      return next;
    });
  } catch (error) {
    await input.drafts.remove(draft.draftId).catch(() => undefined);
    if (!(error instanceof LostRace)) throw error;
    const [latest] = await db.select().from(approvals).where(eq(approvals.id, current.id)).limit(1);
    return {
      ok: false,
      code: "conflict",
      message: `This proposal was already ${latest ? describeStatus(latest.status) : "decided"}.`,
    };
  }

  if (current.draftId) await input.drafts.remove(current.draftId).catch(() => undefined);
  return { ok: true, approval: revised, changed: true };
}
