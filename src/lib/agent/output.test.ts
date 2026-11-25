import { describe, expect, it } from "vitest";
import { proposalFixture } from "@/test/db";
import type { Settings } from "@/lib/settings";
import { buildProposal, type AgentOutput, type ProposalInput } from "./output";
import { hashProposal, proposalSchema } from "./proposal";
import { checkMeetingTime } from "./schedule";

const settings: Settings = {
  timezone: "America/Chicago",
  workdayStartHour: 9,
  workdayEndHour: 17,
  meetingMinutes: 30,
};

// Friday 20 Nov 2026, 10:00 in Chicago.
const now = new Date("2026-11-20T16:00:00Z");

const reply: AgentOutput = {
  decision: "reply",
  intent: "pricing_and_meeting",
  summary: "Priya wants pricing and a call.",
  skipReason: null,
  replyBody: "Hi Priya,\n\nThe Team plan is $199 per month.\n\nMaya",
  meeting: {
    title: "Larkspur Notes intro: Acme",
    start: "2026-11-24T10:00:00-06:00",
    end: "2026-11-24T10:30:00-06:00",
    description: "Intro call.",
  },
};

function input(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    output: reply,
    documentsRead: ["policies", "pricing"],
    request: {
      senderEmail: "priya@acme.example",
      subject: "Pricing and a quick call?",
      gmailThreadId: "18c0ffee",
    },
    settings,
    calendarConnected: true,
    now,
    ...overrides,
  };
}

describe("buildProposal", () => {
  it("builds a proposal whose recipient, subject and attendees come from the request", () => {
    const result = buildProposal(input());
    if (result.kind !== "proposal") throw new Error(JSON.stringify(result));

    expect(result.proposal.email).toEqual({
      to: "priya@acme.example",
      subject: "Re: Pricing and a quick call?",
      body: reply.replyBody,
      threadId: "18c0ffee",
    });
    expect(result.proposal.meeting).toMatchObject({
      start: "2026-11-24T16:00:00.000Z",
      end: "2026-11-24T16:30:00.000Z",
      timezone: "America/Chicago",
      attendees: ["priya@acme.example"],
    });
    expect(result.proposal.actions).toEqual(["create_event", "send_email"]);
    expect(result.proposal.sources).toEqual(["policies", "pricing"]);
  });

  it("does not double the Re: prefix", () => {
    const result = buildProposal(
      input({ request: { ...input().request, subject: "RE: Pricing" } }),
    );
    expect(result.kind === "proposal" && result.proposal.email.subject).toBe("RE: Pricing");
  });

  it("returns a skip without a proposal", () => {
    const result = buildProposal(
      input({ output: { ...reply, decision: "skip", skipReason: "Newsletter", replyBody: null, meeting: null } }),
    );
    expect(result).toEqual({ kind: "skip", reason: "Newsletter" });
  });

  it("rejects a reply written without reading any company document", () => {
    expect(buildProposal(input({ documentsRead: [] })).kind).toBe("invalid");
  });

  it("rejects an empty reply body", () => {
    expect(buildProposal(input({ output: { ...reply, replyBody: "  " } })).kind).toBe("invalid");
  });

  it("rejects a meeting when no calendar is connected", () => {
    expect(buildProposal(input({ calendarConnected: false })).kind).toBe("invalid");
  });

  it("never schedules a meeting for an escalation", () => {
    const result = buildProposal(input({ output: { ...reply, intent: "escalation" } }));
    if (result.kind !== "proposal") throw new Error(JSON.stringify(result));
    expect(result.proposal.meeting).toBeNull();
    expect(result.proposal.actions).toEqual(["send_email"]);
    expect(result.proposal.priority).toBe("high");
  });

  it.each([
    ["on a weekend", "2026-11-21T10:00:00-06:00", "2026-11-21T10:30:00-06:00"],
    ["before working hours", "2026-11-24T07:00:00-06:00", "2026-11-24T07:30:00-06:00"],
    ["running past the end of the day", "2026-11-24T16:45:00-06:00", "2026-11-24T17:15:00-06:00"],
    ["in the past", "2026-11-19T10:00:00-06:00", "2026-11-19T10:30:00-06:00"],
    ["that is too long", "2026-11-24T10:00:00-06:00", "2026-11-24T13:00:00-06:00"],
    ["with an unparseable time", "next Tuesday", "later"],
  ])("rejects a meeting %s", (_label, start, end) => {
    const result = buildProposal(input({ output: { ...reply, meeting: { ...reply.meeting!, start, end } } }));
    expect(result.kind).toBe("invalid");
  });
});

describe("checkMeetingTime", () => {
  it("evaluates working hours in the owner's timezone, not UTC", () => {
    // 15:00 UTC is 09:00 in Chicago and 00:00 the next day in Tokyo.
    const slot = { start: "2026-11-24T15:00:00Z", end: "2026-11-24T15:30:00Z" };
    expect(checkMeetingTime(slot, settings, now)).toEqual({ ok: true });
    expect(checkMeetingTime(slot, { ...settings, timezone: "Asia/Tokyo" }, now).ok).toBe(false);
  });

  it("rejects a time without a UTC offset instead of guessing the timezone", () => {
    const slot = { start: "2026-11-24T10:00:00", end: "2026-11-24T10:30:00" };
    const result = checkMeetingTime(slot, settings, now);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("UTC offset") });
    expect(
      checkMeetingTime(
        { start: "2026-11-24T10:00:00-0600", end: "2026-11-24T10:30:00-06:00" },
        settings,
        now,
      ),
    ).toEqual({ ok: true });
  });

  it("requires at least an hour of notice", () => {
    const slot = { start: "2026-11-20T16:30:00Z", end: "2026-11-20T17:00:00Z" };
    expect(checkMeetingTime(slot, settings, now).ok).toBe(false);
  });
});

describe("proposal integrity", () => {
  it("hashes the same content identically regardless of key order", () => {
    const reordered = JSON.parse(JSON.stringify({ ...proposalFixture, intent: proposalFixture.intent }));
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse());
    expect(hashProposal(shuffled as typeof proposalFixture)).toBe(hashProposal(proposalFixture));
  });

  it("changes the hash when any approved content changes", () => {
    const original = hashProposal(proposalFixture);
    expect(hashProposal({ ...proposalFixture, email: { ...proposalFixture.email, body: "Different" } })).not.toBe(original);
    expect(hashProposal({ ...proposalFixture, email: { ...proposalFixture.email, to: "other@acme.example" } })).not.toBe(original);
    expect(hashProposal({ ...proposalFixture, meeting: null, actions: ["send_email"] })).not.toBe(original);
  });

  it("rejects proposals whose actions and content disagree", () => {
    expect(proposalSchema.safeParse(proposalFixture).success).toBe(true);
    expect(proposalSchema.safeParse({ ...proposalFixture, actions: ["send_email"] }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...proposalFixture, meeting: null }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...proposalFixture, actions: ["create_event"] }).success).toBe(false);
    expect(
      proposalSchema.safeParse({ ...proposalFixture, email: { ...proposalFixture.email, to: "not-an-email" } }).success,
    ).toBe(false);
  });
});
