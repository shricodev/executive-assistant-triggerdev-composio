import { Composio, SessionPreset } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
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
