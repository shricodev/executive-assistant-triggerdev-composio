import { z } from "zod";

const flag = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const sharedSchema = z.object({
  DATABASE_URL: z.url(),
  APP_URL: z.url().default("http://localhost:3000"),
  COMPOSIO_API_KEY: z.string().min(1),
  APPROVAL_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(48),
});

const agentSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  // Prompts and completions contain email content. Off by default in production.
  AI_TRACE_CONTENT: flag.optional(),
});

const appSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  ALLOWED_EMAILS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  TRIGGER_SECRET_KEY: z.string().min(1),
  // Optional. Enables links from the dashboard to runs in Trigger.dev.
  TRIGGER_PROJECT_REF: z.string().optional(),
});

function lazy<T extends z.ZodType>(name: string, schema: T): () => z.output<T> {
  let cached: z.output<T> | undefined;
  return () => {
    if (cached) return cached;
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(`Invalid ${name} environment:\n${issues}`);
    }
    cached = parsed.data;
    return cached;
  };
}

/** Needed by both the Next.js app and Trigger.dev tasks. */
export const env = lazy("shared", sharedSchema);

/** Needed only where the model runs (Trigger.dev tasks). */
export const agentEnv = lazy("agent", agentSchema);

/** Needed only by the Next.js app. */
export const appEnv = lazy("app", appSchema);
