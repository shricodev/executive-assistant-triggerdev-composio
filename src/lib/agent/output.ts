import { z } from "zod";
import { DOCUMENT_IDS, type DocumentId } from "./company-context";
import { checkMeetingTime } from "./schedule";
import { INTENTS, proposalSchema, type Proposal } from "./proposal";
import type { Settings } from "@/lib/settings";

// What the model returns. Kept flat and loosely constrained because it is a
// suggestion: recipients, subject, attendees and timezone are filled in by
// code, and everything is validated again by `buildProposal`.
export const agentOutputSchema = z.object({
  decision: z
    .enum(["reply", "skip"])
    .describe("reply when the email needs an answer from the founder, otherwise skip"),
  intent: z.enum(INTENTS),
  summary: z.string().describe("One sentence: who wrote and what they want."),
  skipReason: z.string().nullable().describe("Why no reply is needed. Null when replying."),
  replyBody: z
    .string()
    .nullable()
    .describe("Plain-text reply body, including greeting and sign-off. Null when skipping."),
  meeting: z
    .object({
      title: z.string(),
      start: z.string().describe("ISO 8601 with UTC offset, e.g. 2026-11-24T15:00:00-06:00"),
      end: z.string().describe("ISO 8601 with UTC offset"),
      description: z.string().describe("One or two sentences for the calendar invite."),
    })
    .nullable()
    .describe("Only when the sender asked to meet and the calendar was checked. Otherwise null."),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

export type ProposalInput = {
  output: AgentOutput;
  documentsRead: DocumentId[];
  request: { senderEmail: string; subject: string; gmailThreadId: string };
  settings: Settings;
  calendarConnected: boolean;
  now: Date;
};

export type ProposalResult =
  | { kind: "skip"; reason: string }
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "invalid"; reason: string };

function replySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * Turns the model's suggestion into the proposal a human will approve, or
 * says why it cannot be used. Nothing here trusts the model for anything that
 * decides who receives what.
 */
export function buildProposal(input: ProposalInput): ProposalResult {
  const { output, request, settings } = input;

  if (output.decision === "skip") {
    return { kind: "skip", reason: output.skipReason?.trim() || "No reply needed." };
  }

  const body = output.replyBody?.trim();
  if (!body) return { kind: "invalid", reason: "A reply was chosen but the reply body is empty." };

  if (input.documentsRead.length === 0) {
    return {
      kind: "invalid",
      reason: "Read the relevant company documents with getCompanyContext before replying.",
    };
  }

  const wantsMeeting = output.meeting !== null && output.intent !== "escalation";
  if (wantsMeeting && !input.calendarConnected) {
    return {
      kind: "invalid",
      reason: "Google Calendar is not connected, so no meeting time can be proposed.",
    };
  }

  let meeting: Proposal["meeting"] = null;
  if (wantsMeeting && output.meeting) {
    const timing = checkMeetingTime(output.meeting, settings, input.now);
    if (!timing.ok) return { kind: "invalid", reason: timing.reason };
    meeting = {
      title: output.meeting.title.trim(),
      start: new Date(output.meeting.start).toISOString(),
      end: new Date(output.meeting.end).toISOString(),
      timezone: settings.timezone,
      description: output.meeting.description.trim(),
      attendees: [request.senderEmail],
    };
  }

  const parsed = proposalSchema.safeParse({
    intent: output.intent,
    priority: output.intent === "escalation" ? "high" : "normal",
    summary: output.summary.trim(),
    email: {
      to: request.senderEmail,
      subject: replySubject(request.subject),
      body,
      threadId: request.gmailThreadId,
    },
    meeting,
    actions: meeting ? ["create_event", "send_email"] : ["send_email"],
    sources: input.documentsRead.filter((id) => DOCUMENT_IDS.includes(id)),
  } satisfies Proposal);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: "invalid", reason: `${issue.path.join(".")}: ${issue.message}` };
  }
  return { kind: "proposal", proposal: parsed.data };
}
