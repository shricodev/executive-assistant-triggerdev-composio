import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { Proposal } from "@/lib/agent/proposal";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Better Auth tables. Column names follow its Drizzle adapter defaults.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

export const TOOLKITS = ["gmail", "googlecalendar"] as const;
export type Toolkit = (typeof TOOLKITS)[number];

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toolkit: text("toolkit").$type<Toolkit>().notNull(),
    connectedAccountId: text("connected_account_id").notNull().unique(),
    accountEmail: text("account_email"),
    triggerId: text("trigger_id"),
    // "webhook" (realtime push) or "poll", as reported by Composio for this trigger.
    triggerType: text("trigger_type"),
    triggerPollingMinutes: integer("trigger_polling_minutes"),
    ...timestamps,
  },
  (table) => [unique().on(table.userId, table.toolkit)],
);

export const settings = pgTable("settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  workdayStartHour: integer("workday_start_hour").notNull().default(9),
  workdayEndHour: integer("workday_end_hour").notNull().default(17),
  meetingMinutes: integer("meeting_minutes").notNull().default(30),
  ...timestamps,
});

export const EVENT_STATUSES = ["accepted", "ignored", "duplicate"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Composio's event id. Equals the `webhook-id` header and is stable across retries.
    composioEventId: text("composio_event_id").notNull().unique(),
    triggerSlug: text("trigger_slug").notNull(),
    triggerId: text("trigger_id"),
    connectedAccountId: text("connected_account_id"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    sender: text("sender"),
    subject: text("subject"),
    status: text("status").$type<EventStatus>().notNull(),
    ignoreReason: text("ignore_reason"),
    webhookRunId: text("webhook_run_id"),
    createdAt: timestamps.createdAt,
  },
  (table) => [index().on(table.userId, table.createdAt)],
);

export const REQUEST_STATUSES = [
  "processing",
  "skipped",
  "proposed",
  "failed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    inboundEventId: uuid("inbound_event_id")
      .notNull()
      .unique()
      .references(() => inboundEvents.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    senderEmail: text("sender_email").notNull(),
    senderName: text("sender_name"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    status: text("status").$type<RequestStatus>().notNull().default("processing"),
    intent: text("intent"),
    summary: text("summary"),
    error: text("error"),
    runId: text("run_id"),
    ...timestamps,
  },
  (table) => [
    // Composio delivers at least once and may send two events for one message.
    unique().on(table.userId, table.gmailMessageId),
    index().on(table.userId, table.createdAt),
  ],
);

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
  "executing",
  "completed",
  "failed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Written once at creation and never updated. Decisions reference proposalHash.
    proposal: jsonb("proposal").$type<Proposal>().notNull(),
    proposalHash: text("proposal_hash").notNull(),
    draftId: text("draft_id"),
    // Gmail replaces a draft's message whenever the draft is edited, so a
    // changed message id means the draft no longer matches what was approved.
    draftMessageId: text("draft_message_id"),
    waitTokenId: text("wait_token_id"),
    status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").references(() => user.id),
    decisionNote: text("decision_note"),
    failureReason: text("failure_reason"),
    // The run that claimed execution. A different run must not execute the
    // same approval, even if it wakes from the same wait token.
    executionRunId: text("execution_run_id"),
    ...timestamps,
  },
  (table) => [
    unique().on(table.requestId, table.version),
    index().on(table.userId, table.status),
  ],
);

export const ACTION_KINDS = ["create_event", "send_email"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_STATUSES = [
  "pending",
  "executing",
  "succeeded",
  "failed",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export type ActionResult = {
  messageId?: string;
  threadId?: string;
  eventId?: string;
  url?: string;
};

export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ActionKind>().notNull(),
    status: text("status").$type<ActionStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result").$type<ActionResult>(),
    error: text("error"),
    ...timestamps,
  },
  (table) => [unique().on(table.approvalId, table.kind)],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").references(() => requests.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    runId: text("run_id"),
    createdAt: timestamps.createdAt,
  },
  (table) => [index().on(table.userId, table.createdAt)],
);
