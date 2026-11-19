import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TOOLKITS } from "@/db/schema";
import { env } from "@/env";
import { completeConnection } from "@/lib/composio/connections";
import { getUser } from "@/lib/session";

const querySchema = z.object({
  toolkit: z.enum(TOOLKITS),
  status: z.string().optional(),
});

function settingsUrl(params: Record<string, string>) {
  const url = new URL("/settings", env().APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env().APP_URL));

  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return NextResponse.redirect(settingsUrl({ error: "invalid_callback" }));
  }
  if (query.data.status && query.data.status !== "success") {
    return NextResponse.redirect(settingsUrl({ error: "connection_failed" }));
  }

  try {
    await completeConnection(user.id, query.data.toolkit);
  } catch (error) {
    console.error("Failed to complete Composio connection", {
      toolkit: query.data.toolkit,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.redirect(settingsUrl({ error: "connection_failed" }));
  }
  return NextResponse.redirect(settingsUrl({ connected: query.data.toolkit }));
}
