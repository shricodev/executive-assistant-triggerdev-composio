"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TOOLKITS } from "@/db/schema";
import { removeConnection, startConnection } from "@/lib/composio/connections";
import { requireUserForAction } from "@/lib/session";
import { saveSettings, settingsSchema } from "@/lib/settings";

const toolkitSchema = z.enum(TOOLKITS);

export async function connectToolkit(formData: FormData) {
  const user = await requireUserForAction();
  const toolkit = toolkitSchema.parse(formData.get("toolkit"));
  redirect(await startConnection(user.id, toolkit));
}

export async function disconnectToolkit(formData: FormData) {
  const user = await requireUserForAction();
  const toolkit = toolkitSchema.parse(formData.get("toolkit"));
  await removeConnection(user.id, toolkit);
  revalidatePath("/settings");
}

export type SettingsFormState = { ok: boolean; message: string } | null;

export async function updateSettings(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUserForAction();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings" };
  }
  await saveSettings(user.id, parsed.data);
  revalidatePath("/settings");
  return { ok: true, message: "Settings saved" };
}
