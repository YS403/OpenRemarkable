import { describe, expect, it } from "vitest";

import {
  mergeTimetable,
  minutesOf,
  parseUpload,
  prayersForDay,
  type PrayerTimetable,
  prayerTimetableSchema,
  removeMonth,
  type StoredTimetable,
  summarize,
} from "./timetable";

const timetable: PrayerTimetable = {
  days: [
    { date: "2026-10-15", fajr: "05:30", sunrise: "07:00", dhuhr: "12:30", asr: "15:45", maghrib: "18:00", isha: "19:30", jamaat: { fajr: "06:00", dhuhr: "13:15", asr: "16:30", maghrib: "18:00", isha: "20:00" } },
    { date: "2026-10-16", fajr: "05:31", sunrise: "07:02", dhuhr: "12:30", asr: "15:43", maghrib: "17:58", isha: "19:28" },
  ],
};

describe("prayersForDay", () => {
  it("builds windows from one beginning time to the next", () => {
    const day = prayersForDay(timetable, "2026-10-15")!;
    expect(day.windows.map((w) => [w.label, w.start, w.end, w.jamaat])).toEqual([
      ["Fajr", "05:30", "07:00", "06:00"],
      ["Dhuhr", "12:30", "15:45", "13:15"],
      ["Asr", "15:45", "18:00", "16:30"],
      ["Maghrib", "18:00", "19:30", "18:00"],
      ["Isha", "19:30", "05:31", "20:00"], // until the next day's Fajr
    ]);
  });

  it("calls Dhuhr Jumu'ah on Fridays and leaves Isha open-ended without tomorrow's row", () => {
    const friday = prayersForDay(timetable, "2026-10-16")!;
    expect(friday.windows[1].label).toBe("Jumu'ah");
    expect(friday.windows[4].end).toBeNull();
    expect(friday.windows[0].jamaat).toBeUndefined();
  });

  it("returns null for days the timetable doesn't cover", () => {
    expect(prayersForDay(timetable, "2026-11-01")).toBeNull();
  });
});

describe("prayerTimetableSchema", () => {
  it("accepts 24-hour times and rejects 12-hour or malformed ones", () => {
    expect(prayerTimetableSchema.safeParse(timetable).success).toBe(true);
    const bad = structuredClone(timetable);
    bad.days[0].asr = "4:17";
    expect(prayerTimetableSchema.safeParse(bad).success).toBe(false);
    bad.days[0].asr = "24:00";
    expect(prayerTimetableSchema.safeParse(bad).success).toBe(false);
  });

  it("converts HH:MM to minutes", () => {
    expect(minutesOf("19:30")).toBe(19 * 60 + 30);
  });
});

const day = (date: string, over: Record<string, string> = {}) => ({
  date,
  fajr: "05:30",
  sunrise: "07:00",
  dhuhr: "12:30",
  asr: "15:45",
  maghrib: "18:00",
  isha: "19:30",
  ...over,
});

describe("upload validation", () => {
  it("accepts { days } or a bare array of days", () => {
    expect(parseUpload({ days: [day("2026-11-01")] }).success).toBe(true);
    expect(parseUpload([day("2026-11-01")]).success).toBe(true);
  });

  it("rejects 12-hour times that weren't converted, with a helpful message", () => {
    const result = parseUpload([day("2026-11-01", { asr: "04:17" })]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/after dhuhr.*24-hour/);
  });

  it("rejects impossible dates, duplicates and empty files", () => {
    expect(parseUpload([day("2026-02-30")]).success).toBe(false);
    expect(parseUpload([day("2026-11-01"), day("2026-11-01")]).success).toBe(false);
    expect(parseUpload({ days: [] }).success).toBe(false);
    expect(parseUpload({ hello: "world" }).success).toBe(false);
  });
});

describe("mergeTimetable", () => {
  it("adds new months, replaces re-uploaded dates, keeps the switch, and sorts by date", () => {
    const stored: StoredTimetable = { enabled: false, days: [day("2026-10-01"), day("2026-10-02")] };
    const merged = mergeTimetable(stored, { days: [day("2026-11-01"), day("2026-10-02", { fajr: "05:00" })] });
    expect(merged.enabled).toBe(false);
    expect(merged.days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-11-01"]);
    expect(merged.days[1].fajr).toBe("05:00");
  });

  it("starts switched on for a first upload", () => {
    expect(mergeTimetable(null, { days: [day("2026-11-01")] }).enabled).toBe(true);
  });
});

describe("summarize and removeMonth", () => {
  it("lists months with day counts, and removes exactly one month", () => {
    const stored: StoredTimetable = { enabled: true, days: [day("2026-10-01"), day("2026-10-31"), day("2026-11-01")] };
    expect(summarize(stored)).toEqual({ enabled: true, months: [{ month: "2026-10", days: 2 }, { month: "2026-11", days: 1 }] });
    expect(summarize(removeMonth(stored, "2026-10")).months).toEqual([{ month: "2026-11", days: 1 }]);
    expect(summarize(null)).toEqual({ enabled: false, months: [] });
  });
});
