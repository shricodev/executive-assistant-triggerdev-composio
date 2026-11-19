"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "@/lib/settings";
import { updateSettings, type SettingsFormState } from "./actions";

export function SchedulingForm({
  settings,
  timezones,
}: {
  settings: Settings;
  timezones: string[];
}) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(
    updateSettings,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          name="timezone"
          list="timezones"
          defaultValue={settings.timezone}
          autoComplete="off"
          required
        />
        <datalist id="timezones">
          {timezones.map((timezone) => (
            <option key={timezone} value={timezone} />
          ))}
        </datalist>
      </div>
      <div className="space-y-2">
        <Label htmlFor="workdayStartHour">Workday starts (hour)</Label>
        <Input
          id="workdayStartHour"
          name="workdayStartHour"
          type="number"
          min={0}
          max={23}
          defaultValue={settings.workdayStartHour}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="workdayEndHour">Workday ends (hour)</Label>
        <Input
          id="workdayEndHour"
          name="workdayEndHour"
          type="number"
          min={1}
          max={24}
          defaultValue={settings.workdayEndHour}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="meetingMinutes">Meeting length (min)</Label>
        <Input
          id="meetingMinutes"
          name="meetingMinutes"
          type="number"
          min={15}
          max={120}
          step={15}
          defaultValue={settings.meetingMinutes}
          required
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
