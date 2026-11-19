import type { ComposioTriggerEvent } from "@/lib/events/payload";

export function gmailEvent(overrides: {
  id?: string;
  metadata?: Partial<ComposioTriggerEvent["metadata"]>;
  data?: Record<string, unknown>;
} = {}): ComposioTriggerEvent {
  return {
    id: overrides.id ?? "msg_1",
    type: "composio.trigger.message",
    timestamp: "2026-11-20T10:00:00Z",
    metadata: {
      trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
      trigger_id: "ti_1",
      connected_account_id: "ca_user_1",
      user_id: "user_1",
      ...overrides.metadata,
    },
    data: {
      message_id: "18c0ffee",
      thread_id: "18c0ffee",
      sender: "Priya Nair <priya@acme.example>",
      subject: "Pricing and a quick call?",
      message_text: "Could you share pricing for 40 seats, and are you free next week?",
      message_timestamp: "2026-11-20T09:59:30Z",
      label_ids: ["INBOX", "UNREAD"],
      ...overrides.data,
    },
  };
}
