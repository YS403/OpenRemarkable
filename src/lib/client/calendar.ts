import { demoConnection, demoEvents } from "@/lib/calendar/demo";
import type { CalendarConnection, CalendarEvent, CalendarProvider } from "@/lib/calendar/types";
import type { TemplateId } from "@/lib/templates/names";

import { ApiError } from "./api";

/** How to connect: paste a published calendar link, or sign in (not built yet). */
export type ConnectRequest = { provider: CalendarProvider; method: "ics"; url: string } | { provider: CalendarProvider; method: "oauth" };

export interface DayEvents {
  events: CalendarEvent[];
  /** calendars that couldn't be read; the rest still show */
  problems: { connectionId: string; account: string; message: string }[];
}

/**
 * Everything the Planner page needs from the server. Two implementations:
 * `liveCalendar` (the real API) and `demoCalendar` (sample data,
 * `/planner?demo=outlook`). The UI only knows this interface.
 */
export interface CalendarClient {
  readonly demo: boolean;
  connections(): Promise<CalendarConnection[]>;
  connect(request: ConnectRequest): Promise<CalendarConnection>;
  disconnect(connectionId: string): Promise<void>;
  /** meetings around a day (YYYY-MM-DD) across all connected calendars */
  events(day: string, timeZone: string): Promise<DayEvents>;
  /** bring the calendar document on reMarkable up to date: today and the next six days */
  sync(request: SyncRequest): Promise<{ message: string }>;
}

export interface SyncRequest {
  template: TemplateId;
  timeZone: string;
  /** YYYY-MM-DD in the viewer's time zone */
  today: string;
}

interface SyncResult {
  documentName: string;
  created: boolean;
  added: string[];
  updated: string[];
  unchanged: string[];
}

function describeSync(r: SyncResult): string {
  if (r.created) return `Created "${r.documentName}" on your reMarkable with the next ${r.added.length} days.`;
  const parts = [
    r.added.length ? `added ${r.added.length} day${r.added.length === 1 ? "" : "s"}` : "",
    r.updated.length ? `refreshed ${r.updated.length} changed day${r.updated.length === 1 ? "" : "s"} (your handwriting stays)` : "",
  ].filter(Boolean);
  return parts.length ? `Synced "${r.documentName}": ${parts.join(", ")}.` : `"${r.documentName}" is already up to date.`;
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.message ?? `Request failed (${response.status}).`, response.status);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function sync(request: SyncRequest): Promise<{ message: string }> {
  return { message: describeSync(await call<SyncResult>("/api/calendar/sync", json("POST", request))) };
}

export const liveCalendar: CalendarClient = {
  demo: false,
  connections: async () => (await call<{ connections: CalendarConnection[] }>("/api/calendar/connections")).connections,
  connect: async (request) => (await call<{ connection: CalendarConnection }>("/api/calendar/connections", json("POST", request))).connection,
  disconnect: async (id) => {
    await call(`/api/calendar/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  events: (day, timeZone) => call<DayEvents>(`/api/calendar/events?day=${encodeURIComponent(day)}&tz=${encodeURIComponent(timeZone)}`),
  sync,
};

/** In-memory sample calendar; `provider` is pre-connected. */
export function demoCalendar(provider: CalendarProvider = "outlook"): CalendarClient {
  let connected: CalendarConnection[] = [demoConnection(provider)];
  // feel like a network call so loading states are visible
  const latency = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 250));
  return {
    demo: true,
    connections: () => latency([...connected]),
    connect: async ({ provider: p }) => {
      const connection = connected.find((c) => c.provider === p) ?? demoConnection(p);
      connected = [...connected.filter((c) => c.provider !== p), connection];
      return latency(connection);
    },
    disconnect: async (id) => {
      connected = connected.filter((c) => c.id !== id);
      await latency(undefined);
    },
    events: (day) => latency({ events: connected.flatMap((c) => demoEvents(day, c.id)), problems: [] }),
    // sync reads your real calendars on the server, so sample meetings can't be synced
    sync: () => Promise.reject(new Error("Sync uses your connected calendars, not the sample meetings. Exit the demo to sync.")),
  };
}
