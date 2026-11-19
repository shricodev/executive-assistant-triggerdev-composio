import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { actions, type ActionResult } from "@/db/schema";

export type Action = typeof actions.$inferSelect;

/** A failure that retrying cannot fix, such as a draft that no longer exists. */
export class PermanentActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentActionError";
  }
}

export type Reconciliation =
  | { state: "done"; result: ActionResult }
  | { state: "not_done" }
  | { state: "unknown"; reason: string };

export type ActionHandler = {
  /** Calls the provider. May be invoked again after a failed attempt. */
  perform: () => Promise<ActionResult>;
  /**
   * Asks the provider whether an earlier attempt already took effect. Called
   * whenever an attempt started but no outcome was recorded.
   */
  reconcile: () => Promise<Reconciliation>;
};

export type ExecutorOptions = {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function finish(id: string, status: "succeeded" | "failed", patch: Partial<Action>) {
  const [row] = await db
    .update(actions)
    .set({ status, ...patch })
    .where(eq(actions.id, id))
    .returning();
  return row;
}

/**
 * Runs one external side effect at most once.
 *
 * The row is marked `executing` before the provider is called. If a later
 * attempt (in this run or a retried run) finds it still `executing`, the
 * previous call may or may not have reached the provider, so it reconciles
 * first and only calls the provider again when that says nothing happened.
 * Terminal rows are returned as they are and never re-executed.
 */
export async function runAction(
  actionId: string,
  handler: ActionHandler,
  options: ExecutorOptions = {},
): Promise<Action> {
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  for (;;) {
    const [action] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
    if (!action) throw new Error(`Action ${actionId} not found`);
    if (action.status === "succeeded" || action.status === "failed") return action;

    if (action.status === "executing") {
      const reconciled = await handler.reconcile();
      if (reconciled.state === "done") {
        return finish(actionId, "succeeded", { result: reconciled.result, error: null });
      }
      if (reconciled.state === "unknown") {
        return finish(actionId, "failed", { error: reconciled.reason });
      }
      if (action.attempts >= maxAttempts) {
        return finish(actionId, "failed", {
          error: action.error ?? "Gave up after repeated failures.",
        });
      }
      await sleep(Math.min(1_000 * 2 ** (action.attempts - 1), 15_000));
    }

    const [claimed] = await db
      .update(actions)
      .set({ status: "executing", attempts: sql`${actions.attempts} + 1` })
      .where(and(eq(actions.id, actionId), eq(actions.status, action.status), eq(actions.attempts, action.attempts)))
      .returning();
    // Another worker claimed this attempt. Start over and look at what it did.
    if (!claimed) continue;

    try {
      const result = await handler.perform();
      return await finish(actionId, "succeeded", { result, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (error instanceof PermanentActionError) {
        return finish(actionId, "failed", { error: message });
      }
      // Leave the row `executing`: the next pass reconciles before retrying.
      await db.update(actions).set({ error: message }).where(eq(actions.id, actionId));
    }
  }
}
