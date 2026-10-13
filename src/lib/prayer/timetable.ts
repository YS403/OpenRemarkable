import { z } from "zod";

/**
 * A mosque's monthly prayer timetable, stored per user. Times are 24-hour
 * "HH:MM" local wall-clock times for that date (clock changes are already
 * reflected in the printed sheet).
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** about three years of days */
const MAX_STORED_DAYS = 1100;
const time = z.string().regex(TIME, "Expected HH:MM (24-hour).");

const ORDER = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;

/** A real calendar date, YYYY-MM-DD. */
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date like 2026-10-31.")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, day));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
  }, "Not a real date.");

export const prayerDaySchema = z
  .object({
    date,
    /** beginning times */
    fajr: time, // subḥ ṣādiq
    sunrise: time,
    dhuhr: time, // zawāl
    asr: time,
    maghrib: time,
    isha: time,
    /** congregation times, where the mosque publishes them */
    jamaat: z
      .object({ fajr: time, dhuhr: time, asr: time, maghrib: time, isha: time })
      .partial()
      .optional(),
  })
  .superRefine((day, ctx) => {
    // catches 12-hour times typed without converting (e.g. Asr "04:21")
    for (let i = 1; i < ORDER.length; i++) {
      if (day[ORDER[i]] <= day[ORDER[i - 1]]) {
        ctx.addIssue({ code: "custom", path: [ORDER[i]], message: `${ORDER[i]} (${day[ORDER[i]]}) must be after ${ORDER[i - 1]} (${day[ORDER[i - 1]]}). Use 24-hour times.` });
        return;
      }
    }
  });

/** What a user uploads: one or more months of days. */
export const prayerTimetableSchema = z
  .object({
    source: z.string().max(200).optional(),
    days: z.array(prayerDaySchema).min(1, "The timetable has no days.").max(400),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.days.forEach((d, i) => {
      if (seen.has(d.date)) ctx.addIssue({ code: "custom", path: ["days", i, "date"], message: `${d.date} appears twice.` });
      seen.add(d.date);
    });
  });

/** What's kept per user: every uploaded day, and whether prayer times are switched on. */
export const storedTimetableSchema = z.object({
  enabled: z.boolean().default(true),
  source: z.string().max(200).optional(),
  days: z.array(prayerDaySchema).max(MAX_STORED_DAYS),
});

export type PrayerDay = z.infer<typeof prayerDaySchema>;
export type PrayerTimetable = z.infer<typeof prayerTimetableSchema>;
export type StoredTimetable = z.infer<typeof storedTimetableSchema>;

/** Accept `{ days: [...] }` or a bare array of days, the two shapes people tend to write. */
export function parseUpload(body: unknown) {
  return prayerTimetableSchema.safeParse(Array.isArray(body) ? { days: body } : body);
}

/** Add uploaded days to what's stored: same dates are replaced, the rest kept, oldest dropped past the cap. */
export function mergeTimetable(stored: StoredTimetable | null, upload: PrayerTimetable): StoredTimetable {
  const byDate = new Map((stored?.days ?? []).map((d) => [d.date, d]));
  for (const d of upload.days) byDate.set(d.date, d);
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_STORED_DAYS);
  return { enabled: stored?.enabled ?? true, ...(upload.source ? { source: upload.source } : stored?.source ? { source: stored.source } : {}), days };
}

/** Drop one month (YYYY-MM). */
export function removeMonth(stored: StoredTimetable, month: string): StoredTimetable {
  return { ...stored, days: stored.days.filter((d) => !d.date.startsWith(`${month}-`)) };
}

export interface TimetableSummary {
  enabled: boolean;
  /** months with at least one day, oldest first */
  months: { month: string; days: number }[];
}

export function summarize(stored: StoredTimetable | null): TimetableSummary {
  const counts = new Map<string, number>();
  for (const d of stored?.days ?? []) counts.set(d.date.slice(0, 7), (counts.get(d.date.slice(0, 7)) ?? 0) + 1);
  return {
    enabled: stored?.enabled ?? false,
    months: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([month, days]) => ({ month, days })),
  };
}

export type PrayerName = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export interface PrayerWindow {
  name: PrayerName;
  /** display label; Dhuhr becomes Jumu'ah on Fridays */
  label: string;
  /** "HH:MM" */
  start: string;
  /** "HH:MM"; for Isha this is the next day's Fajr, or null if unknown */
  end: string | null;
  jamaat?: string;
}

/** What a template needs for one day. */
export interface DayPrayers {
  date: string;
  sunrise: string;
  windows: PrayerWindow[];
}

const LABELS: Record<PrayerName, string> = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };

const nextDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

const isFriday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5;
};

/**
 * Prayer windows for a day: Fajr until sunrise, Dhuhr until Asr, Asr until
 * Maghrib, Maghrib until Isha, Isha until the next day's Fajr.
 */
export function prayersForDay(timetable: Pick<PrayerTimetable, "days">, day: string): DayPrayers | null {
  const today = timetable.days.find((d) => d.date === day);
  if (!today) return null;
  const tomorrow = timetable.days.find((d) => d.date === nextDate(day));
  const j = today.jamaat ?? {};
  const window = (name: PrayerName, start: string, end: string | null): PrayerWindow => ({
    name,
    label: name === "dhuhr" && isFriday(day) ? "Jumu'ah" : LABELS[name],
    start,
    end,
    ...(j[name] ? { jamaat: j[name] } : {}),
  });
  return {
    date: day,
    sunrise: today.sunrise,
    windows: [
      window("fajr", today.fajr, today.sunrise),
      window("dhuhr", today.dhuhr, today.asr),
      window("asr", today.asr, today.maghrib),
      window("maghrib", today.maghrib, today.isha),
      window("isha", today.isha, tomorrow?.fajr ?? null),
    ],
  };
}

/** Minutes since midnight for "HH:MM". */
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
