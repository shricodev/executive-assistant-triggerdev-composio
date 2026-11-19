const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(date: Date, now = new Date()) {
  const diff = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function formatDateTime(date: Date | string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(date));
}

export function formatTimeRange(start: string, end: string, timezone: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
    .formatToParts(new Date(start))
    .find((part) => part.type === "timeZoneName")?.value;
  return {
    day: day.format(new Date(start)),
    time: `${time.format(new Date(start))} to ${time.format(new Date(end))} ${zone ?? ""}`.trim(),
    minutes: Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
  };
}

export const INTENT_LABELS: Record<string, string> = {
  pricing_and_meeting: "Pricing and meeting",
  product_question: "Product question",
  escalation: "Escalation",
  other: "Other",
};
