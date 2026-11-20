"use server";

import { wait } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { REPLY_MAX_LENGTH } from "@/lib/agent/proposal";
import { decide } from "@/lib/approvals/decide";
import { reviseReply } from "@/lib/approvals/revise";
import { DRAFT_TOOLS, openSession, type ComposioSession } from "@/lib/composio/client";
import { getAccounts } from "@/lib/composio/connections";
import { createReplyDraft, deleteDraft } from "@/lib/composio/gmail";
import { requireUserForAction } from "@/lib/session";
import type { DecisionPayload } from "@/trigger/process-email";

const inputSchema = z.object({
  approvalId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  proposalHash: z.string().length(64),
  note: z.string().max(500).optional(),
});

export type DecisionActionResult = { ok: true } | { ok: false; message: string };

export async function decideApproval(input: z.input<typeof inputSchema>): Promise<DecisionActionResult> {
  const user = await requireUserForAction();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const result = await decide({ ...parsed.data, userId: user.id });
  if (!result.ok) {
    revalidatePath("/", "layout");
    return { ok: false, message: result.message };
  }

  const tokenId = result.approval.waitTokenId;
  if (tokenId) {
    try {
      // Wakes the suspended run. Completing a token twice is harmless, so a
      // repeated submit after a failed resume simply tries again.
      await wait.completeToken<DecisionPayload>(tokenId, { decision: parsed.data.decision });
    } catch (error) {
      console.error("Failed to resume run after decision", {
        approvalId: result.approval.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return {
        ok: false,
        message: "Your decision was saved, but the workflow could not be resumed. Submit again to retry.",
      };
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

const editSchema = z.object({
  approvalId: z.uuid(),
  proposalHash: z.string().length(64),
  body: z.string().min(1).max(REPLY_MAX_LENGTH * 2),
});

export type EditActionResult =
  | { ok: true; approvalId: string; changed: boolean }
  | { ok: false; message: string };

export async function editReply(input: z.input<typeof editSchema>): Promise<EditActionResult> {
  const user = await requireUserForAction();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const accounts = await getAccounts(user.id);
  if (!accounts) return { ok: false, message: "Gmail is not connected." };

  // Opened only if the edit gets as far as touching the draft.
  let session: ComposioSession | undefined;
  const gmail = async () =>
    (session ??= await openSession(user.id, { gmail: accounts.gmail }, DRAFT_TOOLS));

  try {
    const result = await reviseReply({
      ...parsed.data,
      userId: user.id,
      drafts: {
        create: async (reply) => createReplyDraft(await gmail(), reply),
        remove: async (draftId) => deleteDraft(await gmail(), draftId),
      },
    });
    revalidatePath("/", "layout");
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, approvalId: result.approval.id, changed: result.changed };
  } catch (error) {
    console.error("Failed to edit reply", {
      approvalId: parsed.data.approvalId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, message: "The Gmail draft could not be updated, so the reply was not changed." };
  } finally {
    await session?.delete().catch(() => undefined);
  }
}
