import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

function connect(): Db {
  // Reuse the pool across Next.js hot reloads in development.
  const client = globalForDb.pg ?? postgres(env().DATABASE_URL, { max: 5 });
  if (process.env.NODE_ENV !== "production") globalForDb.pg = client;
  return drizzle(client, { schema });
}

let instance: Db | undefined;

export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    instance ??= connect();
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
