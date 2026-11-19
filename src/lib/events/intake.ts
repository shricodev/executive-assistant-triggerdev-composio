import { eq } from "drizzle-orm";
import { db } from "@/db";
import { connections, inboundEvents, requests } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { filterEmail } from "./filter";
import {
  GMAIL_NEW_MESSAGE_TRIGGER,
  normalizeEvent,
  type ComposioTriggerEvent,
} from "./payload";

export type IntakeResult =
  | { outcome: "accepted"; requestId: string; userId: string; threadId: string }
  | { outcome: "ignored"; reason: string }
  | { outcome: "duplicate"; reason: "event_already_seen" | "message_already_handled" };

/**
 * Turns a verified webhook event into at most one request row.
 *
 * Safe to call repeatedly with the same event: the unique constraints on
 * `inbound_events.composio_event_id` and `requests(user_id, gmail_message_id)`
 * decide the winner, so a retried webhook run or a second delivery of the same
 * message never creates a second workflow.
 */
export async function intakeEvent(
  event: ComposioTriggerEvent,
  webhookRunId: string,
): Promise<IntakeResult> {
  const base = {
    composioEventId: event.id,
    triggerSlug: event.metadata.trigger_slug,
    triggerId: event.metadata.trigger_id ?? null,
    connectedAccountId: event.metadata.connected_account_id,
    webhookRunId,
  };

  const ignore = async (reason: string, extra: Partial<typeof inboundEvents.$inferInsert> = {}) => {
    await db
      .insert(inboundEvents)
      .values({ ...base, ...extra, status: "ignored", ignoreReason: reason })
      .onConflictDoNothing({ target: inboundEvents.composioEventId });
    return { outcome: "ignored", reason } as const;
  };

  if (event.metadata.trigger_slug !== GMAIL_NEW_MESSAGE_TRIGGER) {
    return ignore("unsupported_trigger");
  }

  const normalized = normalizeEvent(event);
  if (!normalized.ok) return ignore(normalized.reason);
  const email = normalized.email;

  const [mailbox] = await db
    .select({
      userId: connections.userId,
      connectedAccountId: connections.connectedAccountId,
      accountEmail: connections.accountEmail,
    })
    .from(connections)
    .where(eq(connections.connectedAccountId, email.connectedAccountId))
    .limit(1);

  const details = {
    userId: mailbox?.userId ?? null,
    gmailMessageId: email.messageId,
    gmailThreadId: email.threadId,
    sender: email.from.email,
    subject: email.subject,
  };

  const verdict = filterEmail(email, mailbox);
  if (!verdict.accept || !mailbox) {
    return ignore(verdict.accept ? "unknown_account" : verdict.reason, details);
  }

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(inboundEvents)
      .values({ ...base, ...details, status: "accepted" })
      .onConflictDoNothing({ target: inboundEvents.composioEventId })
      .returning({ id: inboundEvents.id });

    if (!inserted) {
      // A retried attempt of this webhook run. Hand back the request the
      // first attempt created so the caller can re-trigger idempotently.
      const [existing] = await tx
        .select({ requestId: requests.id, status: inboundEvents.status })
        .from(inboundEvents)
        .leftJoin(requests, eq(requests.inboundEventId, inboundEvents.id))
        .where(eq(inboundEvents.composioEventId, event.id))
        .limit(1);
      if (existing?.requestId) {
        return {
          outcome: "accepted",
          requestId: existing.requestId,
          userId: mailbox.userId,
          threadId: email.threadId,
        } as const;
      }
      return { outcome: "duplicate", reason: "event_already_seen" } as const;
    }

    const [request] = await tx
      .insert(requests)
      .values({
        userId: mailbox.userId,
        inboundEventId: inserted.id,
        gmailMessageId: email.messageId,
        gmailThreadId: email.threadId,
        senderEmail: email.from.email,
        senderName: email.from.name,
        subject: email.subject,
        body: email.body,
        receivedAt: email.receivedAt,
      })
      .onConflictDoNothing({ target: [requests.userId, requests.gmailMessageId] })
      .returning({ id: requests.id });

    if (!request) {
      await tx
        .update(inboundEvents)
        .set({ status: "duplicate", ignoreReason: "message_already_handled" })
        .where(eq(inboundEvents.id, inserted.id));
      return { outcome: "duplicate", reason: "message_already_handled" } as const;
    }

    await recordActivity(tx, {
      userId: mailbox.userId,
      requestId: request.id,
      type: "email.received",
      message: `Email received from ${email.from.name ?? email.from.email}`,
      runId: webhookRunId,
    });

    return {
      outcome: "accepted",
      requestId: request.id,
      userId: mailbox.userId,
      threadId: email.threadId,
    } as const;
  });
}
