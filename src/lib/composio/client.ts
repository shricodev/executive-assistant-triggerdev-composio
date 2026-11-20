import { Composio, SessionPreset } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { z } from "zod";
import { env } from "@/env";

let client: Composio<VercelProvider> | undefined;

export function composio() {
  client ??= new Composio({
    apiKey: env().COMPOSIO_API_KEY,
    provider: new VercelProvider(),
  });
  return client;
}

// The model may only ever be handed these. Everything that writes to Gmail or
// Calendar is called from code after an approval, never exposed as a tool.
export const AGENT_TOOLS = {
  gmail: ["GMAIL_FETCH_MESSAGE_BY_THREAD_ID"],
  googlecalendar: ["GOOGLECALENDAR_FREE_BUSY_QUERY"],
} as const;

export const WORKFLOW_TOOLS = {
  gmail: [
    "GMAIL_GET_PROFILE",
    "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
    "GMAIL_CREATE_EMAIL_DRAFT",
    "GMAIL_GET_DRAFT",
    "GMAIL_SEND_DRAFT",
    "GMAIL_DELETE_DRAFT",
  ],
  googlecalendar: [
    "GOOGLECALENDAR_FREE_BUSY_QUERY",
    "GOOGLECALENDAR_FIND_EVENT",
    "GOOGLECALENDAR_CREATE_EVENT",
  ],
} as const;

// Editing a pending reply in the dashboard swaps its Gmail draft.
export const DRAFT_TOOLS = {
  gmail: ["GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_DELETE_DRAFT"],
  googlecalendar: [],
} as const;

export type Accounts = { gmail: string; googlecalendar?: string };

type ToolAllowlist = { gmail: readonly string[]; googlecalendar: readonly string[] };

/**
 * A Composio session limited to an explicit tool list and pinned to the
 * user's stored connected accounts. The allowlist is enforced by Composio
 * for the session, not by the prompt.
 */
export async function openSession(
  userId: string,
  accounts: Accounts,
  allowlist: ToolAllowlist,
) {
  const toolkits = accounts.googlecalendar
    ? (["gmail", "googlecalendar"] as const)
    : (["gmail"] as const);

  return composio().create(userId, {
    toolkits: [...toolkits],
    tools: Object.fromEntries(
      toolkits.map((toolkit) => [toolkit, { enable: [...allowlist[toolkit]] }]),
    ),
    connectedAccounts: Object.fromEntries(
      toolkits.map((toolkit) => [toolkit, accounts[toolkit] as string]),
    ),
    sessionPreset: SessionPreset.DIRECT_TOOLS,
    manageConnections: false,
    sandbox: { enable: false },
  });
}

export type ComposioSession = Awaited<ReturnType<typeof openSession>>;

export class ToolError extends Error {
  constructor(
    readonly slug: string,
    message: string,
  ) {
    super(`${slug}: ${message}`);
    this.name = "ToolError";
  }
}

export async function executeTool(
  session: ComposioSession,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await session.execute(slug, args);
  if (result.resultType !== "completed") {
    throw new ToolError(slug, result.error || `tool ${result.resultType}`);
  }
  return result.data;
}

/** Validates a tool's response, naming the tool and the field when it does not fit. */
export function parseResponse<Schema extends z.ZodType>(
  slug: string,
  schema: Schema,
  data: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
    .join("; ");
  throw new ToolError(slug, `unexpected response (${issues})`);
}
