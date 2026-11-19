import { z } from "zod";

export const GMAIL_NEW_MESSAGE_TRIGGER = "GMAIL_NEW_GMAIL_MESSAGE";

// Composio V3 webhook envelope. Only the fields this app reads are declared;
// the rest of the provider payload is ignored rather than trusted.
export const composioTriggerEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal("composio.trigger.message"),
  timestamp: z.string().optional(),
  metadata: z.object({
    trigger_slug: z.string(),
    trigger_id: z.string().optional(),
    connected_account_id: z.string(),
    user_id: z.string().nullish(),
    log_id: z.string().optional(),
  }),
  data: z.record(z.string(), z.unknown()),
});

export type ComposioTriggerEvent = z.infer<typeof composioTriggerEventSchema>;

const gmailMessageSchema = z.object({
  message_id: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  thread_id: z.string().min(1),
  sender: z.string().min(1),
  subject: z.string().optional(),
  message_text: z.string().optional(),
  message_timestamp: z.string().optional(),
  label_ids: z.array(z.string()).optional(),
});

export type EmailAddress = { email: string; name: string | null };

export type InboundEmail = {
  eventId: string;
  triggerSlug: string;
  triggerId: string | null;
  connectedAccountId: string;
  composioUserId: string | null;
  messageId: string;
  threadId: string;
  from: EmailAddress;
  subject: string;
  body: string;
  labels: string[];
  receivedAt: Date;
};

export function parseAddress(raw: string): EmailAddress | null {
  const match = raw.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  const email = (match ? match[2] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = match?.[1].replace(/^["']|["']$/g, "").trim() || null;
  return { email, name };
}

export type NormalizeResult =
  | { ok: true; email: InboundEmail }
  | { ok: false; reason: string };

export function normalizeEvent(event: ComposioTriggerEvent): NormalizeResult {
  const parsed = gmailMessageSchema.safeParse(event.data);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_gmail_payload" };
  }
  const data = parsed.data;
  const messageId = data.message_id ?? data.id;
  if (!messageId) return { ok: false, reason: "missing_message_id" };

  const from = parseAddress(data.sender);
  if (!from) return { ok: false, reason: "unparseable_sender" };

  const received = new Date(data.message_timestamp ?? event.timestamp ?? "");

  return {
    ok: true,
    email: {
      eventId: event.id,
      triggerSlug: event.metadata.trigger_slug,
      triggerId: event.metadata.trigger_id ?? null,
      connectedAccountId: event.metadata.connected_account_id,
      composioUserId: event.metadata.user_id ?? null,
      messageId,
      threadId: data.thread_id,
      from,
      subject: data.subject?.trim() || "(no subject)",
      body: data.message_text?.trim() ?? "",
      labels: data.label_ids ?? [],
      receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    },
  };
}
