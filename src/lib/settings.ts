import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { settings } from "@/db/schema";

export const settingsSchema = z
  .object({
    timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
    workdayStartHour: z.coerce.number().int().min(0).max(23),
    workdayEndHour: z.coerce.number().int().min(1).max(24),
    meetingMinutes: z.coerce.number().int().min(15).max(120),
  })
  .refine((value) => value.workdayEndHour > value.workdayStartHour, {
    message: "The workday must end after it starts",
    path: ["workdayEndHour"],
  });

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  timezone: "UTC",
  workdayStartHour: 9,
  workdayEndHour: 17,
  meetingMinutes: 30,
};

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function getSettings(userId: string): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  const { timezone, workdayStartHour, workdayEndHour, meetingMinutes } = row;
  return { timezone, workdayStartHour, workdayEndHour, meetingMinutes };
}

export async function saveSettings(userId: string, values: Settings) {
  await db
    .insert(settings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: settings.userId, set: values });
}
