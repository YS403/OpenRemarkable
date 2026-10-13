import type { TimetableSummary } from "@/lib/prayer/timetable";

import { ApiError } from "./api";

const ENDPOINT = "/api/calendar/prayer";

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.message ?? `Request failed (${response.status}).`, response.status);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The prayer timetable settings on the Calendar page: on/off, and uploaded months. */
export const prayerTimetable = {
  summary: () => call<TimetableSummary>(ENDPOINT),
  setEnabled: (enabled: boolean) => call<TimetableSummary>(ENDPOINT, json("PATCH", { enabled })),
  /** `timetable` is the parsed JSON file; the server validates it */
  upload: (timetable: unknown) => call<TimetableSummary & { added: number }>(ENDPOINT, json("POST", timetable)),
  removeMonth: (month: string) => call<TimetableSummary>(`${ENDPOINT}?month=${encodeURIComponent(month)}`, { method: "DELETE" }),
};

/** "2026-10" → "October 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** A one-day example of the file format, offered as a download in the upload dialog. */
export const EXAMPLE_TIMETABLE = {
  source: "My mosque, November 2026",
  days: [
    {
      date: "2026-11-01",
      fajr: "05:40",
      sunrise: "07:10",
      dhuhr: "12:05",
      asr: "14:50",
      maghrib: "16:40",
      isha: "18:10",
      jamaat: { fajr: "06:00", dhuhr: "12:45", asr: "15:15", maghrib: "16:45", isha: "19:30" },
    },
  ],
};
