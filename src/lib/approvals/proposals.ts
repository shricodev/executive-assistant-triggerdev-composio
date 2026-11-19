import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvals, requests } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { hashProposal, type Proposal } from "@/lib/agent/proposal";
import type { Approval } from "./state";

export async function findApproval(requestId: string, version: number): Promise<Approval | null> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.requestId, requestId), eq(approvals.version, version)))
    .limit(1);
  return row ?? null;
}

export type NewApproval = {
  requestId: string;
  userId: string;
  version: number;
  proposal: Proposal;
  draftId: string;
  draftMessageId: string;
  waitTokenId: string;
  expiresAt: Date;
  runId: string;
};

/** Stores a proposal as a pending approval. The proposal is never updated afterwards. */
export async function createApproval(input: NewApproval): Promise<Approval> {
  return db.transaction(async (tx) => {
    const [approval] = await tx
      .insert(approvals)
      .values({
        requestId: input.requestId,
        userId: input.userId,
        version: input.version,
        proposal: input.proposal,
        proposalHash: hashProposal(input.proposal),
        draftId: input.draftId,
        draftMessageId: input.draftMessageId,
        waitTokenId: input.waitTokenId,
        expiresAt: input.expiresAt,
      })
      .returning();

    await tx
      .update(requests)
      .set({
        status: "proposed",
        intent: input.proposal.intent,
        summary: input.proposal.summary,
        error: null,
      })
      .where(eq(requests.id, input.requestId));

    await recordActivity(tx, {
      userId: input.userId,
      requestId: input.requestId,
      type: "proposal.created",
      message: input.proposal.meeting
        ? "Drafted a reply and a meeting invite for approval"
        : "Drafted a reply for approval",
      runId: input.runId,
    });
    return approval;
  });
}
