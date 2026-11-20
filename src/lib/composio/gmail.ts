import { z } from "zod";
import { executeTool, parseResponse, ToolError, type ComposioSession } from "./client";

function isNotFound(error: unknown) {
  return error instanceof ToolError && /not found|404|invalid id/i.test(error.message);
}

const profileSchema = z.object({ emailAddress: z.email() });

export async function getMailboxAddress(session: ComposioSession) {
  const data = await executeTool(session, "GMAIL_GET_PROFILE", { user_id: "me" });
  return parseResponse("GMAIL_GET_PROFILE", profileSchema, data).emailAddress.toLowerCase();
}

// Composio names a message's id `id` in some Gmail responses (create draft)
// and `messageId` in others (get draft), so both are accepted.
const messageRefSchema = z
  .object({
    id: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    threadId: z.string().optional(),
  })
  .transform((message, ctx) => {
    const id = message.messageId ?? message.id;
    if (!id) {
      ctx.addIssue({ code: "custom", message: "message id is missing" });
      return z.NEVER;
    }
    return { id, threadId: message.threadId ?? null };
  });

const draftSchema = z.object({ id: z.string().min(1), message: messageRefSchema });

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
  const draft = parseResponse("GMAIL_CREATE_EMAIL_DRAFT", draftSchema, data);
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
    const draft = parseResponse("GMAIL_GET_DRAFT", draftSchema, data);
    return { draftId: draft.id, messageId: draft.message.id };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export type SentMessage = { messageId: string; threadId: string | null };

export async function sendDraft(
  session: ComposioSession,
  draftId: string,
): Promise<SentMessage> {
  const data = await executeTool(session, "GMAIL_SEND_DRAFT", { draft_id: draftId });
  const sent = parseResponse("GMAIL_SEND_DRAFT", messageRefSchema, data);
  return { messageId: sent.id, threadId: sent.threadId };
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
  const parsed = threadSchema.safeParse(data);
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
