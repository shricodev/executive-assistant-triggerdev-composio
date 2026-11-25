import type { Settings } from "@/lib/settings";

const MAX_DAYS_AHEAD = 30;
const MIN_LEAD_MINUTES = 60;
const HAS_OFFSET = /T.*(Z|[+-]\d{2}:?\d{2})$/i;

type LocalTime = { weekday: string; hour: number; minute: number };

function localTime(instant: Date, timezone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { weekday: part("weekday"), hour: Number(part("hour")), minute: Number(part("minute")) };
}

export type SlotCheck = { ok: true } | { ok: false; reason: string };

/**
 * Rules a proposed meeting must satisfy regardless of what the model says:
 * a sane length, far enough in the future, on a weekday, inside working hours
 * in the owner's timezone.
 */
export function checkMeetingTime(
  slot: { start: string; end: string },
  settings: Settings,
  now: Date,
): SlotCheck {
  // Without an offset, Date would read the time in the worker's own timezone
  // and the invite could land hours away from the time stated in the reply.
  if (!HAS_OFFSET.test(slot.start.trim()) || !HAS_OFFSET.test(slot.end.trim())) {
    return {
      ok: false,
      reason:
        "The meeting start and end must include a UTC offset, for example 2026-11-24T15:00:00-06:00.",
    };
  }

  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, reason: "The meeting start or end is not a valid date-time." };
  }

  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes < 15 || minutes > 120) {
    return { ok: false, reason: "A meeting must be between 15 and 120 minutes long." };
  }
  if (start.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    return { ok: false, reason: "The meeting must start at least one hour from now." };
  }
  if (start.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
    return { ok: false, reason: `The meeting must be within the next ${MAX_DAYS_AHEAD} days.` };
  }

  const localStart = localTime(start, settings.timezone);
  const localEnd = localTime(end, settings.timezone);
  if (localStart.weekday === "Sat" || localStart.weekday === "Sun") {
    return { ok: false, reason: "The meeting must be on a weekday." };
  }

  const startMinutes = localStart.hour * 60 + localStart.minute;
  const endMinutes = localEnd.hour * 60 + localEnd.minute;
  const withinHours =
    localStart.weekday === localEnd.weekday &&
    startMinutes >= settings.workdayStartHour * 60 &&
    endMinutes <= settings.workdayEndHour * 60;
  if (!withinHours) {
    return {
      ok: false,
      reason: `The meeting must be between ${settings.workdayStartHour}:00 and ${settings.workdayEndHour}:00 in ${settings.timezone}.`,
    };
  }
  return { ok: true };
}

export function describeNow(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
}
