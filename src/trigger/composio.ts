import { logger, tags, webhook, webhooks } from "@trigger.dev/sdk";
import { intakeEvent } from "@/lib/events/intake";
import {
  composioTriggerEventSchema,
  type ComposioTriggerEvent,
} from "@/lib/events/payload";
import { processEmail } from "./process-email";

/**
 * The URL Composio delivers to. Trigger.dev hosts it, verifies Composio's
 * signature with the secret stored on the endpoint, dedupes retries on the
 * `webhook-id` header and records every delivery.
 */
export const composioEndpoint = webhooks.endpoint.define({
  id: "composio",
  source: webhooks.composio<ComposioTriggerEvent>(),
  description: "Composio trigger events for connected Gmail accounts",
});

export const composioEvents = webhook({
  id: "composio-events",
  endpoint: composioEndpoint,
  // Evaluated by Trigger.dev before a run starts. Everything else Composio
  // sends is recorded as a FILTERED delivery and costs nothing.
  filter:
    "event.type == 'composio.trigger.message' && event.metadata.trigger_slug == 'GMAIL_NEW_GMAIL_MESSAGE'",
  retry: { maxAttempts: 5 },
  onEvent: async ({ event, headers, ctx }) => {
    // The source's event type is a compile-time annotation only.
    const parsed = composioTriggerEventSchema.safeParse(event);
    if (!parsed.success) {
      logger.warn("Ignoring event with unexpected shape", {
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      return;
    }

    const result = await intakeEvent(parsed.data, ctx.run.id);
    logger.info("Composio event handled", {
      eventId: parsed.data.id,
      webhookId: headers.get("webhook-id"),
      deliveryAttempt: headers.get("x-composio-delivery-attempt"),
      ...result,
    });

    if (result.outcome !== "accepted") {
      await tags.add(`intake:${result.outcome}`);
      return;
    }

    await tags.add(["intake:accepted", `request:${result.requestId}`]);

    // The key makes a retried attempt of this run reuse the workflow run the
    // first attempt started instead of starting a second one.
    const handle = await processEmail.trigger(
      { requestId: result.requestId },
      {
        idempotencyKey: `process-email:${result.requestId}`,
        tags: [`request:${result.requestId}`, `user:${result.userId}`],
      },
    );
    logger.info("Started email workflow", { runId: handle.id });
  },
});
