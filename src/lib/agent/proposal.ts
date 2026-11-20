import { createHash } from "node:crypto";
import { z } from "zod";

export const INTENTS = [
  "pricing_and_meeting",
  "product_question",
  "escalation",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export const REPLY_MAX_LENGTH = 8000;

const isoDateTime = z.iso.datetime({ offset: true });

export const meetingSchema = z
  .object({
    title: z.string().min(3).max(120),
    start: isoDateTime,
    end: isoDateTime,
    timezone: z.string().min(1),
    description: z.string().max(1000),
    attendees: z.array(z.email()).min(1).max(5),
  })
  .refine((meeting) => Date.parse(meeting.end) > Date.parse(meeting.start), {
    message: "Meeting must end after it starts",
    path: ["end"],
  });

export const proposalSchema = z
  .object({
    intent: z.enum(INTENTS),
    priority: z.enum(["normal", "high"]),
    summary: z.string().min(1).max(500),
    email: z.object({
      to: z.email(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(REPLY_MAX_LENGTH),
      threadId: z.string().min(1),
    }),
    meeting: meetingSchema.nullable(),
    actions: z.array(z.enum(["create_event", "send_email"])).min(1),
    sources: z.array(z.string()).max(10),
  })
  .refine(
    (proposal) => proposal.actions.includes("create_event") === (proposal.meeting !== null),
    { message: "create_event requires a meeting, and a meeting requires create_event", path: ["actions"] },
  )
  .refine((proposal) => proposal.actions.includes("send_email"), {
    message: "A proposal always sends the reply",
    path: ["actions"],
  });

export type Proposal = z.infer<typeof proposalSchema>;
export type Meeting = z.infer<typeof meetingSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, canonicalize(inner)]),
    );
  }
  return value;
}

/** Stable digest of a proposal. An approval is only valid for this exact content. */
export function hashProposal(proposal: Proposal): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(proposal)))
    .digest("hex");
}
