import type { Db } from "@/db";
import { activity } from "@/db/schema";

type Executor = Pick<Db, "insert">;

export type ActivityEntry = {
  userId: string;
  requestId?: string | null;
  type: string;
  message: string;
  runId?: string | null;
};

export async function recordActivity(executor: Executor, entry: ActivityEntry) {
  await executor.insert(activity).values({
    userId: entry.userId,
    requestId: entry.requestId ?? null,
    type: entry.type,
    message: entry.message,
    runId: entry.runId ?? null,
  });
}
