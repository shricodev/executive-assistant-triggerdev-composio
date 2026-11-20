import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inboundEvents, requests } from "@/db/schema";
import { gmailEvent } from "@/test/fixtures";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() };
});

const { db } = await import("@/db");
const { seedGmailConnection, seedUser } = await import("@/test/db");
const { intakeEvent } = await import("./intake");

beforeEach(async () => {
  await db.delete(inboundEvents);
  await seedUser(db);
  await db.delete(requests);
  const existing = await db.query.connections.findFirst();
  if (!existing) await seedGmailConnection(db, "user_1");
});

describe("intakeEvent", () => {
  it("creates one request for an accepted email", async () => {
    const result = await intakeEvent(gmailEvent(), "run_1");
    expect(result).toMatchObject({ outcome: "accepted", userId: "user_1" });

    const rows = await db.select().from(requests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      senderEmail: "priya@acme.example",
      gmailThreadId: "18c0ffee",
      status: "processing",
    });
  });

  it("returns the same request when the webhook run is retried", async () => {
    const first = await intakeEvent(gmailEvent(), "run_1");
    const retry = await intakeEvent(gmailEvent(), "run_1");

    expect(first.outcome).toBe("accepted");
    expect(retry).toEqual(first);
    expect(await db.select().from(requests)).toHaveLength(1);
    expect(await db.select().from(inboundEvents)).toHaveLength(1);
  });

  it("treats the same event in a different webhook run as a duplicate", async () => {
    await intakeEvent(gmailEvent(), "run_1");
    const replay = await intakeEvent(gmailEvent(), "run_2");

    expect(replay).toEqual({ outcome: "duplicate", reason: "event_already_seen" });
    expect(await db.select().from(requests)).toHaveLength(1);
  });

  it("treats a second event for the same Gmail message as a duplicate", async () => {
    await intakeEvent(gmailEvent({ id: "msg_1" }), "run_1");
    const second = await intakeEvent(gmailEvent({ id: "msg_2" }), "run_2");

    expect(second).toEqual({ outcome: "duplicate", reason: "message_already_handled" });
    expect(await db.select().from(requests)).toHaveLength(1);
    const [event] = await db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.composioEventId, "msg_2"));
    expect(event.status).toBe("duplicate");
  });

  it("lets only one of two concurrent deliveries create a request", async () => {
    const results = await Promise.all([
      intakeEvent(gmailEvent({ id: "msg_a" }), "run_a"),
      intakeEvent(gmailEvent({ id: "msg_b" }), "run_b"),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["accepted", "duplicate"]);
    expect(await db.select().from(requests)).toHaveLength(1);
  });

  it("records but does not process mail from an unknown account", async () => {
    const result = await intakeEvent(
      gmailEvent({ metadata: { connected_account_id: "ca_stranger" } }),
      "run_1",
    );

    expect(result).toEqual({ outcome: "ignored", reason: "unknown_account" });
    expect(await db.select().from(requests)).toHaveLength(0);
    const [event] = await db.select().from(inboundEvents);
    expect(event).toMatchObject({ status: "ignored", ignoreReason: "unknown_account", userId: null });
  });

  it("ignores the mailbox owner's own messages", async () => {
    const result = await intakeEvent(
      gmailEvent({ data: { sender: "maya@larkspur.example", label_ids: ["INBOX"] } }),
      "run_1",
    );
    expect(result).toEqual({ outcome: "ignored", reason: "sent_by_mailbox_owner" });
    expect(await db.select().from(requests)).toHaveLength(0);
  });

  it("ignores triggers other than new Gmail messages", async () => {
    const result = await intakeEvent(
      gmailEvent({ metadata: { trigger_slug: "SLACK_RECEIVE_MESSAGE" } }),
      "run_1",
    );
    expect(result).toEqual({ outcome: "ignored", reason: "unsupported_trigger" });
  });
});
