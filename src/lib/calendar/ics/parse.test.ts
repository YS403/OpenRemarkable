import { describe, expect, it } from "vitest";

import { parseCalendar, zonedToUtc } from "./parse";

// Shaped like an Outlook "publish calendar" feed: Windows time zone names with
// embedded VTIMEZONE, a weekly series with a moved and a deleted occurrence,
// a cancelled meeting, an all-day event and a floating-time event.
const FEED = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:Microsoft Exchange Server 2010
X-WR-CALNAME:Calendar
BEGIN:VTIMEZONE
TZID:GMT Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T010000
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:standup
SUMMARY:Daily stand-up
DTSTART;TZID=GMT Standard Time:20260901T093000
DTEND;TZID=GMT Standard Time:20260901T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
EXDATE;TZID=GMT Standard Time:20261013T093000
LOCATION:Microsoft Teams
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=GMT Standard Time:20261012T093000
SUMMARY:Daily stand-up (moved)
DTSTART;TZID=GMT Standard Time:20261012T110000
DTEND;TZID=GMT Standard Time:20261012T111500
END:VEVENT
BEGIN:VEVENT
UID:review
SUMMARY:Design review
DTSTART:20261012T130000Z
DTEND:20261012T140000Z
ATTENDEE;CN=Sam Lee:mailto:sam@example.com
END:VEVENT
BEGIN:VEVENT
UID:cancelled
SUMMARY:Cancelled sync
STATUS:CANCELLED
DTSTART:20261012T150000Z
DTEND:20261012T153000Z
END:VEVENT
BEGIN:VEVENT
UID:offsite
SUMMARY:Offsite
DTSTART;VALUE=DATE:20261012
DTEND;VALUE=DATE:20261013
END:VEVENT
BEGIN:VEVENT
UID:floating
SUMMARY:Gym
DTSTART:20261012T180000
DTEND:20261012T190000
END:VEVENT
END:VCALENDAR`;

const day = (d: string) => ({ start: new Date(`${d}T00:00:00Z`), end: new Date(`${d}T23:59:59Z`) });

describe("parseCalendar", () => {
  const calendar = parseCalendar(FEED);

  it("reads the calendar name", () => {
    expect(calendar.name).toBe("Calendar");
  });

  it("applies moved occurrences, skips cancelled meetings, keeps all-day and floating events", () => {
    const events = calendar.events(day("2026-10-12"), "Europe/London");
    expect(events.map((e) => [e.title, e.start])).toEqual([
      ["Offsite", "2026-10-12"],
      ["Daily stand-up (moved)", "2026-10-12T10:00:00.000Z"], // 11:00 BST
      ["Design review", "2026-10-12T13:00:00.000Z"],
      ["Gym", "2026-10-12T17:00:00.000Z"], // floating 18:00, read in London (BST)
    ]);
    expect(events.find((e) => e.title === "Design review")?.attendees).toEqual(["Sam Lee"]);
    expect(events.find((e) => e.title === "Offsite")?.allDay).toBe(true);
  });

  it("expands the series on ordinary days and honours deleted occurrences", () => {
    expect(calendar.events(day("2026-10-14"), "Europe/London").map((e) => e.start)).toEqual(["2026-10-14T08:30:00.000Z"]);
    expect(calendar.events(day("2026-10-13"), "Europe/London")).toEqual([]);
    // after the clocks go back, 09:30 London is 09:30 UTC
    expect(calendar.events(day("2026-11-02"), "Europe/London").map((e) => e.start)).toEqual(["2026-11-02T09:30:00.000Z"]);
  });

  it("rejects things that aren't calendars", () => {
    expect(() => parseCalendar("<html>sign in</html>")).toThrow("didn't return a calendar");
  });
});

describe("zonedToUtc", () => {
  it("handles daylight saving", () => {
    expect(new Date(zonedToUtc(2026, 7, 1, 12, 0, 0, "Europe/London")).toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(new Date(zonedToUtc(2026, 1, 1, 12, 0, 0, "America/New_York")).toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });
});

// Shaped like a Google Calendar "secret address in iCal format" feed: IANA time
// zones (one of them not defined in the feed), a series ending with UNTIL, a
// moved occurrence, and a multi-day all-day event.
const GOOGLE_FEED = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-CALNAME:alex@gmail.com
X-WR-TIMEZONE:Europe/London
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:gym@google.com
SUMMARY:Gym
DTSTART;TZID=Europe/London:20261005T070000
DTEND;TZID=Europe/London:20261005T080000
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019T060000Z
END:VEVENT
BEGIN:VEVENT
UID:gym@google.com
RECURRENCE-ID;TZID=Europe/London:20261012T070000
SUMMARY:Gym (late)
DTSTART;TZID=Europe/London:20261012T190000
DTEND;TZID=Europe/London:20261012T200000
END:VEVENT
BEGIN:VEVENT
UID:nyc-call@google.com
SUMMARY:Call with New York
DTSTART;TZID=America/New_York:20261012T090000
DTEND;TZID=America/New_York:20261012T093000
END:VEVENT
BEGIN:VEVENT
UID:trip@google.com
SUMMARY:Trip
DTSTART;VALUE=DATE:20261011
DTEND;VALUE=DATE:20261014
END:VEVENT
END:VCALENDAR`;

describe("parseCalendar (Google feed)", () => {
  const calendar = parseCalendar(GOOGLE_FEED);

  it("resolves IANA zones, including ones the feed didn't define", () => {
    const events = calendar.events(day("2026-10-12"), "Europe/London");
    expect(events.map((e) => [e.title, e.start])).toEqual([
      ["Trip", "2026-10-11"],
      ["Call with New York", "2026-10-12T13:00:00.000Z"], // 09:00 EDT
      ["Gym (late)", "2026-10-12T18:00:00.000Z"], // 19:00 BST
    ]);
  });

  it("stops recurring at UNTIL", () => {
    expect(calendar.events(day("2026-10-19"), "Europe/London").map((e) => e.title)).toEqual(["Gym"]);
    expect(calendar.events(day("2026-10-26"), "Europe/London")).toEqual([]);
  });
});
