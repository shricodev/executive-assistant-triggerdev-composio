import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

let client: ReturnType<typeof postgres> | undefined;
let instance: Db | undefined;

function connect(): Db {
  // Reuse the pool across Next.js hot reloads in development.
  client = globalForDb.pg ?? postgres(env().DATABASE_URL, { max: 5 });
  if (process.env.NODE_ENV !== "production") globalForDb.pg = client;
  return drizzle(client, { schema });
}

/**
 * Closes the pool. The next query opens a new one.
 *
 * A run calls this before it suspends on a long wait, so it does not hold
 * connections while it sleeps or wake up with sockets that died in the meantime.
 */
export async function releaseDb() {
  const current = client;
  client = undefined;
  instance = undefined;
  globalForDb.pg = undefined;
  await current?.end({ timeout: 5 }).catch(() => undefined);
}

export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    instance ??= connect();
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
