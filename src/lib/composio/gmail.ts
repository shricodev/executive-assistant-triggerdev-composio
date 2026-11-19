import { z } from "zod";
import { executeTool, ToolError, type ComposioSession } from "./client";

// Composio returns Gmail's own response, sometimes nested under `response_data`.
function unwrap(data: Record<string, unknown>): unknown {
  return data.response_data ?? data;
}

function isNotFound(error: unknown) {
  return error instanceof ToolError && /not found|404|invalid id/i.test(error.message);
}

const profileSchema = z.object({ emailAddress: z.email() });

export async function getMailboxAddress(session: ComposioSession) {
  const data = await executeTool(session, "GMAIL_GET_PROFILE", { user_id: "me" });
  return profileSchema.parse(unwrap(data)).emailAddress.toLowerCase();
}

const draftSchema = z.object({
  id: z.string().min(1),
  message: z.object({ id: z.string().min(1), threadId: z.string().optional() }),
});

export type Draft = { draftId: string; messageId: string };

export async function createReplyDraft(
  session: ComposioSession,
  reply: { to: string; subject: string; body: string; threadId: string },
): Promise<Draft> {
  const data = await executeTool(session, "GMAIL_CREATE_EMAIL_DRAFT", {
    recipient_email: reply.to,
    subject: reply.subject,
    body: reply.body,
    thread_id: reply.threadId,
    is_html: false,
  });
  const draft = draftSchema.parse(unwrap(data));
  return { draftId: draft.id, messageId: draft.message.id };
}

/** Returns null when the draft no longer exists (sent or deleted). */
export async function getDraft(
  session: ComposioSession,
  draftId: string,
): Promise<Draft | null> {
  try {
    const data = await executeTool(session, "GMAIL_GET_DRAFT", {
      draft_id: draftId,
      format: "minimal",
    });
    const draft = draftSchema.parse(unwrap(data));
    return { draftId: draft.id, messageId: draft.message.id };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

const sentSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().optional(),
});

export type SentMessage = { messageId: string; threadId: string | null };

export async function sendDraft(
  session: ComposioSession,
  draftId: string,
): Promise<SentMessage> {
  const data = await executeTool(session, "GMAIL_SEND_DRAFT", { draft_id: draftId });
  const sent = sentSchema.parse(unwrap(data));
  return { messageId: sent.id, threadId: sent.threadId ?? null };
}

export async function deleteDraft(session: ComposioSession, draftId: string) {
  try {
    await executeTool(session, "GMAIL_DELETE_DRAFT", { draft_id: draftId });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

const threadSchema = z.object({
  messages: z.array(
    z.looseObject({
      messageId: z.string().optional(),
      id: z.string().optional(),
      labelIds: z.array(z.string()).optional(),
      messageTimestamp: z.string().optional(),
      internalDate: z.union([z.string(), z.number()]).optional(),
    }),
  ),
});

/**
 * Finds a message we sent in the thread after `since`. Used only to settle an
 * ambiguous send, where the draft is gone and we do not know whether the
 * previous attempt's send reached Gmail.
 */
export async function findSentReply(
  session: ComposioSession,
  threadId: string,
  since: Date,
): Promise<SentMessage | null> {
  const data = await executeTool(session, "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", {
    thread_id: threadId,
  });
  const parsed = threadSchema.safeParse(unwrap(data));
  if (!parsed.success) return null;

  for (const message of parsed.data.messages) {
    const id = message.messageId ?? message.id;
    if (!id || !message.labelIds?.includes("SENT")) continue;
    const sentAt = message.messageTimestamp
      ? Date.parse(message.messageTimestamp)
      : Number(message.internalDate);
    if (Number.isFinite(sentAt) && sentAt >= since.getTime()) {
      return { messageId: id, threadId };
    }
  }
  return null;
}
