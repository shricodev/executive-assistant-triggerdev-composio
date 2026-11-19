import { logger, schemaTask } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requests } from "@/db/schema";

export const processEmail = schemaTask({
  id: "process-email",
  schema: z.object({ requestId: z.uuid() }),
  run: async ({ requestId }, { ctx }) => {
    const [request] = await db
      .update(requests)
      .set({ runId: ctx.run.id })
      .where(eq(requests.id, requestId))
      .returning();
    if (!request) {
      logger.warn("Request not found", { requestId });
      return { status: "missing" as const };
    }

    logger.info("Received email", {
      requestId,
      threadId: request.gmailThreadId,
      from: request.senderEmail,
    });
    return { status: request.status };
  },
});
