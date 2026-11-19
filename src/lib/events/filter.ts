import type { InboundEmail } from "./payload";

export type Mailbox = {
  userId: string;
  connectedAccountId: string;
  accountEmail: string | null;
};

export type FilterResult =
  | { accept: true }
  | { accept: false; reason: string };

const AUTOMATED_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounces?)([+.\-_].*)?$/;

const NON_INBOX_LABELS = ["SENT", "DRAFT", "SPAM", "TRASH", "CHAT"];
const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];

/**
 * Cheap, deterministic checks that run before any model call. The mailbox is
 * the stored connection for the event's connected account, or undefined when
 * the account is not one this app connected.
 */
export function filterEmail(
  email: InboundEmail,
  mailbox: Mailbox | undefined,
): FilterResult {
  if (!mailbox) return { accept: false, reason: "unknown_account" };

  if (email.composioUserId && email.composioUserId !== mailbox.userId) {
    return { accept: false, reason: "user_mismatch" };
  }

  // Our own replies come back through the same trigger. Without this check an
  // approved send would start a new run for the message it just sent.
  if (mailbox.accountEmail && email.from.email === mailbox.accountEmail.toLowerCase()) {
    return { accept: false, reason: "sent_by_mailbox_owner" };
  }

  if (email.labels.some((label) => NON_INBOX_LABELS.includes(label))) {
    return { accept: false, reason: "not_inbox" };
  }
  if (email.labels.length > 0 && !email.labels.includes("INBOX")) {
    return { accept: false, reason: "not_inbox" };
  }
  if (email.labels.some((label) => BULK_LABELS.includes(label))) {
    return { accept: false, reason: "bulk_mail" };
  }

  const localPart = email.from.email.split("@")[0];
  if (AUTOMATED_LOCAL_PART.test(localPart)) {
    return { accept: false, reason: "automated_sender" };
  }

  if (!email.body) return { accept: false, reason: "empty_body" };

  return { accept: true };
}
