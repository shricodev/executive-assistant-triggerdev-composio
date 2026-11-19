import type { ActionKind } from "@/db/schema";
import type { Approval } from "@/lib/approvals/state";
import { createEvent, findEventByReference } from "@/lib/composio/calendar";
import type { ComposioSession } from "@/lib/composio/client";
import { findSentReply, getDraft, sendDraft } from "@/lib/composio/gmail";
import { PermanentActionError, type ActionHandler } from "./executor";

function createEventHandler(session: ComposioSession, approval: Approval): ActionHandler {
  const meeting = approval.proposal.meeting;
  if (!meeting) throw new PermanentActionError("The approved proposal has no meeting.");

  return {
    perform: async () => {
      const event = await createEvent(session, meeting, approval.id);
      return { eventId: event.eventId, url: event.url ?? undefined };
    },
    reconcile: async () => {
      const event = await findEventByReference(session, meeting, approval.id);
      return event
        ? { state: "done", result: { eventId: event.eventId, url: event.url ?? undefined } }
        : { state: "not_done" };
    },
  };
}

function sendEmailHandler(session: ComposioSession, approval: Approval): ActionHandler {
  const { draftId, draftMessageId } = approval;
  const threadId = approval.proposal.email.threadId;
  if (!draftId || !draftMessageId) {
    throw new PermanentActionError("The approved proposal has no Gmail draft.");
  }

  return {
    perform: async () => {
      const draft = await getDraft(session, draftId);
      if (!draft) {
        throw new PermanentActionError("The Gmail draft no longer exists, so nothing was sent.");
      }
      if (draft.messageId !== draftMessageId) {
        throw new PermanentActionError(
          "The Gmail draft was edited after it was approved, so it was not sent.",
        );
      }
      const sent = await sendDraft(session, draftId);
      return { messageId: sent.messageId, threadId: sent.threadId ?? threadId };
    },
    reconcile: async () => {
      // Sending consumes the draft, so a draft that still exists was not sent.
      if (await getDraft(session, draftId)) return { state: "not_done" };
      const sent = await findSentReply(session, threadId, approval.decidedAt ?? approval.createdAt);
      if (sent) {
        return { state: "done", result: { messageId: sent.messageId, threadId } };
      }
      return {
        state: "unknown",
        reason: "The draft is gone but no sent reply was found. Check the thread in Gmail.",
      };
    },
  };
}

export function handlerFor(
  kind: ActionKind,
  session: ComposioSession,
  approval: Approval,
): ActionHandler {
  return kind === "create_event"
    ? createEventHandler(session, approval)
    : sendEmailHandler(session, approval);
}
