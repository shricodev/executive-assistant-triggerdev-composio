import { anthropic } from "@ai-sdk/anthropic";
import { OpenTelemetry } from "@ai-sdk/otel";
import { generateText, Output, registerTelemetry, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import { agentEnv } from "@/env";
import { AGENT_TOOLS, type ComposioSession } from "@/lib/composio/client";
import {
  COMPANY_DOCUMENTS,
  DOCUMENT_IDS,
  readCompanyDocument,
  type DocumentId,
} from "./company-context";
import { agentOutputSchema, type AgentOutput } from "./output";
import { buildPrompt, INSTRUCTIONS, type PromptInput } from "./prompt";

// AI SDK 7 emits OpenTelemetry spans only once an integration is registered.
// Trigger.dev's worker owns the global tracer, so the spans join the run trace.
let telemetryRegistered = false;
function ensureTelemetry() {
  if (telemetryRegistered) return;
  registerTelemetry(new OpenTelemetry());
  telemetryRegistered = true;
}

const READ_ONLY_SLUGS: readonly string[] = [...AGENT_TOOLS.gmail, ...AGENT_TOOLS.googlecalendar];

/**
 * The tool set the model sees: the read-only Composio tools from the session
 * plus the company-document reader. Anything outside the allowlist is dropped
 * here even if a session were to return it, and the Gmail thread tool is
 * pinned to the thread that triggered this run.
 */
export async function buildAgentTools(session: ComposioSession, threadId: string) {
  const documentsRead = new Set<DocumentId>();
  const tools: ToolSet = {};

  for (const [slug, composioTool] of Object.entries((await session.tools()) as ToolSet)) {
    if (!READ_ONLY_SLUGS.includes(slug)) continue;
    const execute = composioTool.execute;
    tools[slug] =
      slug === "GMAIL_FETCH_MESSAGE_BY_THREAD_ID" && execute
        ? {
            ...composioTool,
            execute: (input, options) =>
              execute({ ...(input as object), thread_id: threadId }, options),
          }
        : composioTool;
  }

  tools.getCompanyContext = tool({
    description:
      "Read one internal company document. The only source of truth for product, pricing and policy facts.",
    inputSchema: z.object({
      document: z.enum(DOCUMENT_IDS).describe(
        Object.entries(COMPANY_DOCUMENTS)
          .map(([id, document]) => `${id}: ${document.description}`)
          .join(" | "),
      ),
    }),
    execute: async ({ document }) => {
      documentsRead.add(document);
      return {
        document,
        title: COMPANY_DOCUMENTS[document].title,
        content: await readCompanyDocument(document),
      };
    },
  });

  return { tools, documentsRead };
}

export type AnalysisInput = PromptInput & {
  session: ComposioSession;
  threadId: string;
  recordContent: boolean;
};

export type Analysis = { output: AgentOutput; documentsRead: DocumentId[] };

export async function analyzeEmail(input: AnalysisInput): Promise<Analysis> {
  ensureTelemetry();
  const { tools, documentsRead } = await buildAgentTools(input.session, input.threadId);

  const result = await generateText({
    model: anthropic(agentEnv().AI_MODEL),
    instructions: INSTRUCTIONS,
    prompt: buildPrompt(input),
    tools,
    output: Output.object({ schema: agentOutputSchema }),
    stopWhen: stepCountIs(10),
    telemetry: {
      isEnabled: true,
      functionId: "email-assistant",
      recordInputs: input.recordContent,
      recordOutputs: input.recordContent,
    },
  });

  return { output: result.output, documentsRead: [...documentsRead] };
}
