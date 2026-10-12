import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { CalendarLinkError, fetchCalendarText, parseCalendarLink } from "./ics/fetch";
import { parseCalendar, type ParsedCalendar } from "./ics/parse";
import { calendarStore, MAX_CONNECTIONS, type StoredCalendarConnection } from "./store";
import type { CalendarConnection, CalendarEvent, CalendarProvider } from "./types";

export { CalendarLinkError };

/** Re-read a feed at most this often per server instance; Outlook refreshes published calendars slowly anyway. */
const FEED_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_FEEDS = 100;
const DAY_MS = 86_400_000;

export interface CalendarProblem {
  connectionId: string;
  account: string;
  message: string;
}

const feeds = new Map<string, { at: number; calendar: Promise<ParsedCalendar> }>();

/** Parsed feed for a link, shared across requests for a few minutes. Keyed by a hash so links aren't kept as keys. */
function loadFeed(url: string, provider: CalendarProvider, fresh = false): Promise<ParsedCalendar> {
  const key = createHash("sha256").update(url).digest("hex");
  const cached = feeds.get(key);
  if (cached && !fresh && Date.now() - cached.at < FEED_TTL_MS) return cached.calendar;
  const calendar = fetchCalendarText(new URL(url), provider).then((text) => {
    try {
      return parseCalendar(text);
    } catch (error) {
      throw new CalendarLinkError((error as Error).message);
    }
  });
  feeds.delete(key);
  feeds.set(key, { at: Date.now(), calendar });
  calendar.catch(() => feeds.delete(key)); // don't cache failures
  if (feeds.size > MAX_CACHED_FEEDS) feeds.delete(feeds.keys().next().value!);
  return calendar;
}

const toPublic = (c: StoredCalendarConnection): CalendarConnection => ({
  id: c.id,
  provider: c.provider,
  method: c.method,
  account: c.label,
  connectedAt: c.connectedAt,
});

export async function listConnections(userId: string): Promise<CalendarConnection[]> {
  return (await calendarStore.list(userId)).map(toPublic);
}

/** Check that a pasted link really is a readable calendar, then save it. */
export async function connectCalendarLink(userId: string, provider: CalendarProvider, rawLink: string): Promise<CalendarConnection> {
  const url = parseCalendarLink(rawLink, provider).toString();
  const existing = await calendarStore.list(userId);
  if (existing.length >= MAX_CONNECTIONS && !existing.some((c) => c.url === url)) {
    throw new CalendarLinkError(`You can connect up to ${MAX_CONNECTIONS} calendars. Disconnect one first.`);
  }
  const calendar = await loadFeed(url, provider, true);
  const providerName = provider === "google" ? "Google" : "Outlook";
  const named = calendar.name && calendar.name.toLowerCase() !== "calendar";
  const connection: StoredCalendarConnection = {
    id: randomUUID(),
    provider,
    method: "ics",
    label: named ? `${calendar.name} (${providerName})` : `${providerName} calendar`,
    url,
    connectedAt: new Date().toISOString(),
  };
  await calendarStore.add(userId, connection);
  return toPublic(connection);
}

export async function disconnectCalendar(userId: string, id: string): Promise<void> {
  await calendarStore.remove(userId, id);
}

/**
 * Meetings around a day (YYYY-MM-DD) from every connected calendar. The window
 * is padded by a day each side; the templates clip to the viewer's local day.
 * A calendar that fails is reported, not fatal, so one bad link doesn't blank the page.
 */
export async function eventsForDay(
  userId: string,
  day: string,
  timeZone: string,
): Promise<{ events: CalendarEvent[]; problems: CalendarProblem[] }> {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const window = { start: new Date(midnight - DAY_MS), end: new Date(midnight + 2 * DAY_MS) };
  const connections = await calendarStore.list(userId);

  const results = await Promise.allSettled(
    connections.map(async (c) => (await loadFeed(c.url, c.provider)).events(window, timeZone).map((e) => ({ ...e, connectionId: c.id }))),
  );
  const events: CalendarEvent[] = [];
  const problems: CalendarProblem[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") events.push(...result.value);
    else {
      const message = result.reason instanceof CalendarLinkError ? result.reason.message : "Couldn't read this calendar.";
      problems.push({ connectionId: connections[i].id, account: connections[i].label, message });
    }
  });
  return { events: events.sort((a, b) => a.start.localeCompare(b.start)), problems };
}
