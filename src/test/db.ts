import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

/** An in-memory Postgres with the real migrations applied. */
export async function createTestDb(): Promise<Db> {
  const database = drizzle(new PGlite(), { schema });
  await migrate(database, { migrationsFolder: "./drizzle" });
  return database as unknown as Db;
}

export async function seedUser(db: Db, id = "user_1") {
  await db
    .insert(schema.user)
    .values({ id, name: "Maya Okafor", email: `${id}@larkspur.example` })
    .onConflictDoNothing();
  return id;
}

export async function seedGmailConnection(db: Db, userId: string) {
  const [connection] = await db
    .insert(schema.connections)
    .values({
      userId,
      toolkit: "gmail",
      connectedAccountId: `ca_${userId}`,
      accountEmail: "maya@larkspur.example",
    })
    .returning();
  return connection;
}
