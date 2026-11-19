import { describe, expect, it } from "vitest";
import { filterEmail, type Mailbox } from "./filter";
import { gmailEvent } from "@/test/fixtures";
import {
  composioTriggerEventSchema,
  normalizeEvent,
  parseAddress,
  type ComposioTriggerEvent,
  type InboundEmail,
} from "./payload";

const mailbox: Mailbox = {
  userId: "user_1",
  connectedAccountId: "ca_user_1",
  accountEmail: "Maya@Larkspur.example",
};

function normalized(event: ComposioTriggerEvent): InboundEmail {
  const result = normalizeEvent(event);
  if (!result.ok) throw new Error(result.reason);
  return result.email;
}

describe("payload schema", () => {
  it("accepts a V3 trigger message and ignores unknown fields", () => {
    const event = { ...gmailEvent(), extra: true, metadata: { ...gmailEvent().metadata, auth_config_id: "ac_1" } };
    expect(composioTriggerEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects other event types and envelopes without an account", () => {
    expect(composioTriggerEventSchema.safeParse({ ...gmailEvent(), type: "composio.connected_account.expired" }).success).toBe(false);
    const metadata = { ...gmailEvent().metadata, connected_account_id: undefined };
    expect(composioTriggerEventSchema.safeParse({ ...gmailEvent(), metadata }).success).toBe(false);
  });
});

describe("parseAddress", () => {
  it.each([
    ["Priya Nair <Priya@Acme.example>", { email: "priya@acme.example", name: "Priya Nair" }],
    ['"Nair, Priya" <priya@acme.example>', { email: "priya@acme.example", name: "Nair, Priya" }],
    ["priya@acme.example", { email: "priya@acme.example", name: null }],
  ])("parses %s", (raw, expected) => {
    expect(parseAddress(raw)).toEqual(expected);
  });

  it("returns null for something that is not an address", () => {
    expect(parseAddress("undisclosed-recipients:;")).toBeNull();
  });
});

describe("normalizeEvent", () => {
  it("maps the Gmail payload onto an inbound email", () => {
    expect(normalized(gmailEvent())).toMatchObject({
      eventId: "msg_1",
      connectedAccountId: "ca_user_1",
      composioUserId: "user_1",
      messageId: "18c0ffee",
      threadId: "18c0ffee",
      from: { email: "priya@acme.example", name: "Priya Nair" },
      subject: "Pricing and a quick call?",
      receivedAt: new Date("2026-11-20T09:59:30Z"),
    });
  });

  it("falls back to `id` when `message_id` is absent", () => {
    expect(normalized(gmailEvent({ data: { message_id: undefined, id: "abc" } })).messageId).toBe("abc");
  });

  it.each([
    [{ thread_id: undefined }, "malformed_gmail_payload"],
    [{ message_id: undefined }, "missing_message_id"],
    [{ sender: "not an address" }, "unparseable_sender"],
  ])("rejects %j", (data, reason) => {
    expect(normalizeEvent(gmailEvent({ data }))).toEqual({ ok: false, reason });
  });
});

describe("filterEmail", () => {
  const verdict = (data: Record<string, unknown> = {}) =>
    filterEmail(normalized(gmailEvent({ data })), mailbox);

  it("accepts a normal inbox message", () => {
    expect(verdict()).toEqual({ accept: true });
  });

  it("rejects events for accounts this app did not connect", () => {
    expect(filterEmail(normalized(gmailEvent()), undefined)).toEqual({
      accept: false,
      reason: "unknown_account",
    });
  });

  it("rejects an event whose Composio user does not own the connection", () => {
    const email = normalized(gmailEvent({ metadata: { user_id: "someone_else" } }));
    expect(filterEmail(email, mailbox)).toEqual({ accept: false, reason: "user_mismatch" });
  });

  it("rejects mail sent by the mailbox owner, ignoring case", () => {
    expect(verdict({ sender: "Maya <maya@larkspur.example>" })).toEqual({
      accept: false,
      reason: "sent_by_mailbox_owner",
    });
  });

  it.each([
    [["SENT"], "not_inbox"],
    [["DRAFT"], "not_inbox"],
    [["INBOX", "SPAM"], "not_inbox"],
    [["UNREAD"], "not_inbox"],
    [["INBOX", "CATEGORY_PROMOTIONS"], "bulk_mail"],
  ])("rejects labels %j", (label_ids, reason) => {
    expect(verdict({ label_ids })).toEqual({ accept: false, reason });
  });

  it.each(["no-reply@acme.example", "notifications+billing@acme.example", "mailer-daemon@acme.example"])(
    "rejects automated sender %s",
    (sender) => {
      expect(verdict({ sender })).toEqual({ accept: false, reason: "automated_sender" });
    },
  );

  it("rejects an empty message", () => {
    expect(verdict({ message_text: "  " })).toEqual({ accept: false, reason: "empty_body" });
  });
});
