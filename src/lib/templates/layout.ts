import type { CalendarEvent } from "@/lib/calendar/types";

import { dayDate } from "./kit";

/** A timed meeting clipped to the day, in minutes since local midnight. */
export interface PlacedEvent {
  event: CalendarEvent;
  start: number;
  end: number;
  /** side-by-side position among overlapping meetings */
  lane: number;
  lanes: number;
}

const DEFAULT_HOURS = { start: 8, end: 18 };
const DAY = 24 * 60;

/**
 * Timed meetings that touch the day, clipped to it, with side-by-side lanes
 * for overlaps (each overlapping cluster shares its width evenly).
 */
export function layoutDay(events: readonly CalendarEvent[], day: string, timeZone: string): PlacedEvent[] {
  const placed = events
    .filter((e) => !e.allDay)
    .map((event) => {
      const start = minuteOfDay(event.start, day, timeZone);
      const end = minuteOfDay(event.end, day, timeZone);
      return { event, start: Math.max(0, start), end: Math.min(DAY, Math.max(end, start + 15)) };
    })
    .filter((p) => p.end > 0 && p.start < DAY)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const result: PlacedEvent[] = [];
  let cluster: PlacedEvent[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.lanes = lanes;
    result.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
  };

  for (const p of placed) {
    if (p.start >= clusterEnd && cluster.length > 0) flush();
    let lane = laneEnds.findIndex((end) => end <= p.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = p.end;
    cluster.push({ ...p, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, p.end);
  }
  if (cluster.length > 0) flush();
  return result;
}

/** All-day events covering the day (end date exclusive, as calendars store them). */
export function allDayEvents(events: readonly CalendarEvent[], day: string, timeZone: string): CalendarEvent[] {
  return events.filter((e) => {
    if (!e.allDay) return false;
    const start = e.start.length === 10 ? e.start : zoned(e.start, timeZone).day;
    const end = e.end.length === 10 ? e.end : zoned(e.end, timeZone).day;
    return start <= day && (day < end || start === end);
  });
}

/** Hours shown: 08–18 by default, widened to whole hours that cover every meeting. */
export function visibleHours(placed: readonly PlacedEvent[], defaults = DEFAULT_HOURS): { start: number; end: number } {
  let start = defaults.start;
  let end = defaults.end;
  for (const p of placed) {
    start = Math.min(start, Math.floor(p.start / 60));
    end = Math.max(end, Math.ceil(p.end / 60));
  }
  return { start, end: Math.min(24, Math.max(end, start + 1)) };
}

const zonedFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day and minute of an instant in a time zone. */
function zoned(iso: string, timeZone: string): { day: string; minute: number } {
  let format = zonedFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    zonedFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Minutes from the day's local midnight; negative before it, ≥ 1440 after it. */
function minuteOfDay(iso: string, day: string, timeZone: string): number {
  const z = zoned(iso, timeZone);
  const days = Math.round((dayDate(z.day).getTime() - dayDate(day).getTime()) / 86_400_000);
  return days * DAY + z.minute;
}
