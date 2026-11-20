import { z } from "zod";
import type { Meeting } from "@/lib/agent/proposal";
import { executeTool, parseResponse, type ComposioSession } from "./client";

const freeBusySchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
    }),
  ),
});

export type Interval = { start: string; end: string };

export async function getBusyIntervals(
  session: ComposioSession,
  window: Interval,
): Promise<Interval[]> {
  const data = await executeTool(session, "GOOGLECALENDAR_FREE_BUSY_QUERY", {
    timeMin: window.start,
    timeMax: window.end,
    items: [{ id: "primary" }],
  });
  const parsed = parseResponse("GOOGLECALENDAR_FREE_BUSY_QUERY", freeBusySchema, data);
  return Object.values(parsed.calendars).flatMap((calendar) => calendar.busy);
}

export async function isSlotFree(session: ComposioSession, slot: Interval) {
  const busy = await getBusyIntervals(session, slot);
  const start = Date.parse(slot.start);
  const end = Date.parse(slot.end);
  return !busy.some(
    (interval) => Date.parse(interval.start) < end && Date.parse(interval.end) > start,
  );
}

const eventSchema = z.looseObject({
  id: z.string().min(1),
  htmlLink: z.string().optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
});

export type CalendarEvent = { eventId: string; url: string | null };

// Stored on the event so a retry can recognise an event it already created.
const REFERENCE_KEY = "assistantApprovalId";

export async function createEvent(
  session: ComposioSession,
  meeting: Meeting,
  reference: string,
): Promise<CalendarEvent> {
  const data = await executeTool(session, "GOOGLECALENDAR_CREATE_EVENT", {
    calendar_id: "primary",
    summary: meeting.title,
    description: meeting.description,
    start_datetime: meeting.start,
    end_datetime: meeting.end,
    timezone: meeting.timezone,
    attendees: meeting.attendees,
    send_updates: "all",
    create_meeting_room: true,
    extended_properties: { private: { [REFERENCE_KEY]: reference } },
  });
  const event = parseResponse("GOOGLECALENDAR_CREATE_EVENT", eventSchema, data);
  return { eventId: event.id, url: event.htmlLink ?? null };
}

// Matching events come back under `event_data.event_data`.
const eventListSchema = z.object({
  event_data: z.object({ event_data: z.array(z.unknown()).default([]) }),
});

export async function findEventByReference(
  session: ComposioSession,
  meeting: Meeting,
  reference: string,
): Promise<CalendarEvent | null> {
  const data = await executeTool(session, "GOOGLECALENDAR_FIND_EVENT", {
    calendar_id: "primary",
    time_min: meeting.start,
    time_max: meeting.end,
    single_events: true,
  });
  const list = parseResponse("GOOGLECALENDAR_FIND_EVENT", eventListSchema, data);

  for (const item of list.event_data.event_data) {
    const event = eventSchema.safeParse(item);
    if (event.success && event.data.extendedProperties?.private?.[REFERENCE_KEY] === reference) {
      return { eventId: event.data.id, url: event.data.htmlLink ?? null };
    }
  }
  return null;
}
