import "./load-env";
import { Composio } from "@composio/core";
import { z } from "zod";

const ENDPOINT_ID = "composio";

const endpointsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      declaredId: z.string(),
      url: z.string(),
      secretSet: z.boolean(),
    }),
  ),
});

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const force = process.argv.includes("--force");
  const triggerKey = required("TRIGGER_SECRET_KEY");
  const triggerApi = process.env.TRIGGER_API_URL ?? "https://api.trigger.dev";
  const headers = {
    Authorization: `Bearer ${triggerKey}`,
    "Content-Type": "application/json",
  };

  // The secret key selects the environment, so a dev key configures the dev
  // endpoint and a prod key configures production.
  const listed = await fetch(`${triggerApi}/api/v1/webhooks/endpoints`, { headers });
  if (!listed.ok) {
    throw new Error(`Trigger.dev returned ${listed.status} when listing webhook endpoints`);
  }
  const endpoint = endpointsSchema
    .parse(await listed.json())
    .data.find((item) => item.declaredId === ENDPOINT_ID);
  if (!endpoint) {
    throw new Error(
      `No "${ENDPOINT_ID}" endpoint in this environment yet. Run \`pnpm trigger:dev\` (or deploy) once so Trigger.dev registers it, then run this again.`,
    );
  }

  const composio = new Composio({ apiKey: required("COMPOSIO_API_KEY") });
  const existing = (await composio.webhooks.subscriptions.list()).items[0];
  if (existing && existing.webhookUrl !== endpoint.url && !force) {
    throw new Error(
      `This Composio project already delivers webhooks to ${existing.webhookUrl}.\n` +
        "A project has one subscription, so continuing would replace it. Re-run with --force to do that.",
    );
  }

  const subscription = await composio.webhooks.subscriptions.set({
    webhookUrl: endpoint.url,
    version: "V3",
  });
  // The secret is only returned in full by some calls; fetch it when it is missing.
  const secret =
    subscription.secret ?? (await composio.webhooks.subscriptions.get(subscription.id)).secret;
  if (!secret) {
    throw new Error(
      "Composio did not return the signing secret. Copy it from the Composio dashboard and set it on the Trigger.dev endpoint.",
    );
  }

  const stored = await fetch(
    `${triggerApi}/api/v1/webhooks/endpoints/${encodeURIComponent(endpoint.id)}/secret`,
    { method: "PUT", headers, body: JSON.stringify({ secret }) },
  );
  if (!stored.ok) {
    throw new Error(`Trigger.dev returned ${stored.status} when storing the signing secret`);
  }

  console.log(`Composio subscription ${subscription.id} (V3) -> ${endpoint.url}`);
  console.log("Signing secret stored on the Trigger.dev endpoint.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
