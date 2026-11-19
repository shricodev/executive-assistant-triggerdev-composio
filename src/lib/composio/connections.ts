import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections, type Toolkit } from "@/db/schema";
import { env } from "@/env";
import { recordActivity } from "@/lib/activity";
import { GMAIL_NEW_MESSAGE_TRIGGER } from "@/lib/events/payload";
import { composio, openSession, WORKFLOW_TOOLS, type Accounts } from "./client";
import { getMailboxAddress } from "./gmail";

/** Starts Composio's managed OAuth flow and returns the consent URL. */
export async function startConnection(userId: string, toolkit: Toolkit) {
  const session = await composio().create(userId, {
    toolkits: [toolkit],
    manageConnections: false,
  });
  const request = await session.authorize(toolkit, {
    callbackUrl: `${env().APP_URL}/api/composio/callback?toolkit=${toolkit}`,
  });
  if (!request.redirectUrl) {
    throw new Error(`Composio returned no redirect URL for ${toolkit}`);
  }
  return request.redirectUrl;
}

/**
 * Called after the OAuth redirect. The callback's query string is not proof
 * of ownership, so the connected account is looked up from Composio by the
 * signed-in user's id instead of being read from the URL.
 */
export async function completeConnection(userId: string, toolkit: Toolkit) {
  const accounts = await composio().connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [toolkit],
    statuses: ["ACTIVE"],
  });
  const account = accounts.items.toSorted(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0];
  if (!account) throw new Error(`No active ${toolkit} connection found`);

  let accountEmail: string | null = null;
  let trigger: Awaited<ReturnType<typeof createGmailTrigger>> | null = null;

  if (toolkit === "gmail") {
    const session = await openSession(userId, { gmail: account.id }, WORKFLOW_TOOLS);
    accountEmail = await getMailboxAddress(session);
    trigger = await createGmailTrigger(userId, account.id);
  }

  const values = {
    connectedAccountId: account.id,
    accountEmail,
    triggerId: trigger?.triggerId ?? null,
    triggerType: trigger?.type ?? null,
    triggerPollingMinutes: trigger?.pollingInterval ?? null,
  };

  await db
    .insert(connections)
    .values({ userId, toolkit, ...values })
    .onConflictDoUpdate({
      target: [connections.userId, connections.toolkit],
      set: values,
    });

  await recordActivity(db, {
    userId,
    type: "connection.created",
    message:
      toolkit === "gmail"
        ? `Connected Gmail (${accountEmail}); new-message trigger is ${trigger?.type === "poll" ? "polling" : "realtime"}`
        : "Connected Google Calendar",
  });
}

async function createGmailTrigger(userId: string, connectedAccountId: string) {
  // Composio upserts: calling this again for the same account returns the
  // existing trigger instance instead of creating a second one.
  return composio().triggers.create(userId, GMAIL_NEW_MESSAGE_TRIGGER, {
    connectedAccountId,
    triggerConfig: { labelIds: "INBOX" },
  });
}

export async function removeConnection(userId: string, toolkit: Toolkit) {
  const [connection] = await db
    .delete(connections)
    .where(and(eq(connections.userId, userId), eq(connections.toolkit, toolkit)))
    .returning();
  if (!connection) return;

  if (connection.triggerId) {
    await composio().triggers.delete(connection.triggerId);
  }
  await composio().connectedAccounts.delete(connection.connectedAccountId);

  await recordActivity(db, {
    userId,
    type: "connection.removed",
    message: `Disconnected ${toolkit === "gmail" ? "Gmail" : "Google Calendar"}`,
  });
}

export async function getConnections(userId: string) {
  const rows = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, userId));
  return {
    gmail: rows.find((row) => row.toolkit === "gmail") ?? null,
    googlecalendar: rows.find((row) => row.toolkit === "googlecalendar") ?? null,
  };
}

/** Connected account ids for a user, or null when Gmail is not connected. */
export async function getAccounts(userId: string): Promise<Accounts | null> {
  const { gmail, googlecalendar } = await getConnections(userId);
  if (!gmail) return null;
  return {
    gmail: gmail.connectedAccountId,
    googlecalendar: googlecalendar?.connectedAccountId,
  };
}
