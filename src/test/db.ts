import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { hashProposal, type Proposal } from "@/lib/agent/proposal";

/** An in-memory Postgres with the real migrations applied. */
export async function createTestDb(): Promise<Db> {
  const database = drizzle(new PGlite(), { schema });
  await migrate(database, { migrationsFolder: "./drizzle" });
  return database as unknown as Db;
}

export async function seedUser(db: Db, id = "user_1") {
  await db
    .insert(schema.user)
    .values({ id, name: "Maya Okafor", email: `${id}@larkspur.example` })
    .onConflictDoNothing();
  return id;
}

export async function seedGmailConnection(db: Db, userId: string) {
  const [connection] = await db
    .insert(schema.connections)
    .values({
      userId,
      toolkit: "gmail",
      connectedAccountId: `ca_${userId}`,
      accountEmail: "maya@larkspur.example",
    })
    .returning();
  return connection;
}

export const proposalFixture: Proposal = {
  intent: "pricing_and_meeting",
  priority: "normal",
  summary: "Priya from Acme wants pricing for 40 seats and a call next week.",
  email: {
    to: "priya@acme.example",
    subject: "Re: Pricing and a quick call?",
    body: "Hi Priya,\n\nThe Team plan is $199 per month.\n\nMaya",
    threadId: "18c0ffee",
  },
  meeting: {
    title: "Larkspur Notes intro: Acme",
    start: "2026-11-24T15:00:00.000Z",
    end: "2026-11-24T15:30:00.000Z",
    timezone: "America/Chicago",
    description: "Intro call about the Team plan.",
    attendees: ["priya@acme.example"],
  },
  actions: ["create_event", "send_email"],
  sources: ["policies", "pricing"],
};

let sequence = 0;

/** A request with one pending approval, owned by `userId`. */
export async function seedApproval(
  db: Db,
  userId: string,
  overrides: Partial<typeof schema.approvals.$inferInsert> = {},
) {
  sequence += 1;
  const [event] = await db
    .insert(schema.inboundEvents)
    .values({
      composioEventId: `msg_seed_${sequence}`,
      triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE",
      status: "accepted",
      userId,
    })
    .returning();
  const [request] = await db
    .insert(schema.requests)
    .values({
      userId,
      inboundEventId: event.id,
      gmailMessageId: `message_${sequence}`,
      gmailThreadId: "18c0ffee",
      senderEmail: "priya@acme.example",
      subject: "Pricing and a quick call?",
      body: "Could you share pricing?",
      receivedAt: new Date("2026-11-20T10:00:00Z"),
      status: "proposed",
    })
    .returning();
  const proposal = overrides.proposal ?? proposalFixture;
  const [approval] = await db
    .insert(schema.approvals)
    .values({
      requestId: request.id,
      userId,
      version: 1,
      proposal,
      proposalHash: hashProposal(proposal),
      draftId: "r-draft-1",
      draftMessageId: "draft-message-1",
      waitTokenId: "waitpoint_1",
      expiresAt: new Date("2026-11-22T10:00:00Z"),
      ...overrides,
    })
    .returning();
  return approval;
}
