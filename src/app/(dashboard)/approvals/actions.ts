"use server";

import { wait } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decide } from "@/lib/approvals/decide";
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
