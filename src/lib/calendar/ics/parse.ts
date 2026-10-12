import ICAL from "ical.js";

import type { CalendarEvent } from "../types";

/**
 * Read an iCalendar (ICS) feed and list the meetings in a time window,
 * expanding recurring meetings and applying moved or cancelled occurrences.
 * Pure: no I/O, so it is tested directly against sample feeds.
 */

/** Stop expanding a recurrence after this many occurrences (protects against runaway rules). */
const MAX_OCCURRENCES = 20_000;
const MAX_ATTENDEES = 20;

export interface ParsedCalendar {
  /** the calendar's display name, if the feed has one (X-WR-CALNAME) */
  name: string | null;
  events: (window: { start: Date; end: Date }, fallbackTimeZone: string) => Omit<CalendarEvent, "connectionId">[];
}

export function parseCalendar(text: string): ParsedCalendar {
  let root: InstanceType<typeof ICAL.Component>;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error("That link didn't return a calendar.");
  }
  if (root.name !== "vcalendar") throw new Error("That link didn't return a calendar.");

  // Outlook embeds the definition of every time zone it uses (often with Windows names).
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    const tzid = tz.getFirstPropertyValue("tzid");
    if (typeof tzid === "string" && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tz);
  }

  const name = root.getFirstPropertyValue("x-wr-calname");
  const vevents = root.getAllSubcomponents("vevent");

  // Group by UID: the series master plus any overridden occurrences.
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>();
  const exceptions: InstanceType<typeof ICAL.Event>[] = [];
  for (const component of vevents) {
    // `exceptions: []` stops ical.js from attaching every override in the feed
    // (whatever its UID) to each event; they're matched by UID below instead
    const event = new ICAL.Event(component, { strictExceptions: true, exceptions: [] });
    if (!event.uid) continue;
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(event.uid, event);
  }
  const orphans: InstanceType<typeof ICAL.Event>[] = [];
  for (const exception of exceptions) {
    const master = masters.get(exception.uid);
    if (master) master.relateException(exception);
    else orphans.push(exception); // an occurrence published without its series
  }

  return {
    name: typeof name === "string" && name.trim() ? name.trim() : null,
    events(window, fallbackTimeZone) {
      const out: Omit<CalendarEvent, "connectionId">[] = [];
      const add = (item: InstanceType<typeof ICAL.Event>, start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time>, key: string) => {
        if (isCancelled(item)) return;
        const occurrence = toEvent(item, start, end, key, fallbackTimeZone);
        if (overlaps(occurrence, window)) out.push(occurrence);
      };

      for (const event of [...masters.values(), ...orphans]) {
        if (!event.startDate) continue;
        if (!event.isRecurring()) {
          add(event, event.startDate, event.endDate ?? event.startDate, event.uid);
          continue;
        }
        const iterator = event.iterator();
        for (let i = 0; i < MAX_OCCURRENCES; i++) {
          const next = iterator.next();
          if (!next) break;
          const details = event.getOccurrenceDetails(next);
          const start = instant(details.startDate, fallbackTimeZone);
          if (start > window.end.getTime()) break;
          add(details.item, details.startDate, details.endDate, `${event.uid}:${next.toString()}`);
        }
      }
      return out.sort((a, b) => a.start.localeCompare(b.start));
    },
  };
}

function isCancelled(event: InstanceType<typeof ICAL.Event>): boolean {
  const status = event.component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function toEvent(
  item: InstanceType<typeof ICAL.Event>,
  start: InstanceType<typeof ICAL.Time>,
  end: InstanceType<typeof ICAL.Time>,
  key: string,
  fallbackTimeZone: string,
): Omit<CalendarEvent, "connectionId"> {
  const allDay = start.isDate;
  const attendees = item.attendees
    .map((a) => a.getParameter("cn"))
    .filter((cn): cn is string => typeof cn === "string" && cn.trim().length > 0)
    .slice(0, MAX_ATTENDEES);
  return {
    id: key,
    title: item.summary?.trim() || "(no title)",
    start: allDay ? dateString(start) : new Date(instant(start, fallbackTimeZone)).toISOString(),
    end: allDay ? dateString(end) : new Date(instant(end, fallbackTimeZone)).toISOString(),
    allDay,
    location: item.location?.trim() || undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
  };
}

/**
 * Milliseconds since the epoch. Times tied to a known zone (or UTC) convert
 * directly; "floating" times and zones the feed never defined are read in the
 * viewer's time zone.
 */
function instant(time: InstanceType<typeof ICAL.Time>, fallbackTimeZone: string): number {
  const zone = time.zone;
  const known = zone && zone !== ICAL.Timezone.localTimezone && (zone === ICAL.Timezone.utcTimezone || zone.tzid !== "floating");
  if (known && (zone === ICAL.Timezone.utcTimezone || ICAL.TimezoneService.has(zone.tzid))) return time.toUnixTime() * 1000;
  // a TZID the feed didn't define: Google uses IANA names ("America/New_York") that we can resolve ourselves
  const tzid = (time as unknown as { timezone?: string }).timezone;
  const timeZone = tzid && isIanaZone(tzid) ? tzid : fallbackTimeZone;
  return zonedToUtc(time.year, time.month, time.day, time.hour, time.minute, time.second, timeZone);
}

const ianaZones = new Map<string, boolean>();

function isIanaZone(tzid: string): boolean {
  let valid = ianaZones.get(tzid);
  if (valid === undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tzid });
      valid = true;
    } catch {
      valid = false;
    }
    ianaZones.set(tzid, valid);
  }
  return valid;
}

/** Wall-clock time in an IANA zone → epoch ms (two passes settle DST edges). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) guess = asUtc - offsetMs(guess, timeZone);
  return guess;
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

function offsetMs(epochMs: number, timeZone: string): number {
  let format = offsetFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    offsetFormats.set(timeZone, format);
  }
  const p = Object.fromEntries(format.formatToParts(new Date(epochMs)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(epochMs / 1000) * 1000;
}

const dateString = (t: InstanceType<typeof ICAL.Time>) =>
  `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

function overlaps(event: Omit<CalendarEvent, "connectionId">, window: { start: Date; end: Date }): boolean {
  // all-day dates compare as UTC midnights, which the window's ±1 day margin covers
  const start = Date.parse(event.allDay ? `${event.start}T00:00:00Z` : event.start);
  const end = Date.parse(event.allDay ? `${event.end}T00:00:00Z` : event.end);
  return start < window.end.getTime() && Math.max(end, start + 1) > window.start.getTime();
}
