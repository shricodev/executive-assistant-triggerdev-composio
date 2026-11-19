import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { appEnv, env } from "@/env";

function createAuth() {
  return betterAuth({
    baseURL: env().APP_URL,
    secret: appEnv().BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
    },
    databaseHooks: {
      user: {
        create: {
          // This is a single-tenant tool. Only addresses the operator listed
          // in ALLOWED_EMAILS may create an account.
          before: async (user) => {
            if (!appEnv().ALLOWED_EMAILS.includes(user.email.toLowerCase())) {
              throw new APIError("FORBIDDEN", {
                message: "This email address is not allowed to sign up.",
              });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  instance ??= createAuth();
  return instance;
}
