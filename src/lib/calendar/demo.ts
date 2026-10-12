import type { CalendarConnection, CalendarEvent, CalendarProvider } from "./types";

/**
 * Sample data for previewing the calendar flow without a backend. Meetings are
 * pseudo-random but seeded by the day, so a day always shows the same agenda.
 */

const DEMO_ACCOUNTS: Record<CalendarProvider, string> = {
  outlook: "alex.morgan@outlook.com",
  google: "alex.morgan@gmail.com",
};

export function demoConnection(provider: CalendarProvider): CalendarConnection {
  return { id: `demo-${provider}`, provider, method: "oauth", account: DEMO_ACCOUNTS[provider], connectedAt: new Date().toISOString() };
}

const TITLES = [
  "Daily stand-up",
  "1:1 with Sam",
  "Product review",
  "Design critique",
  "Sprint planning",
  "Customer call: Northwind",
  "Hiring loop: frontend",
  "Roadmap sync",
  "Budget review",
  "Lunch & learn",
  "Investor update prep",
  "Retro",
  "Partner onboarding",
  "Marketing weekly",
  "Focus time",
  "Interview: product designer",
];
const LOCATIONS = ["Microsoft Teams", "Room 3A", "Zoom", "Board room", "Cafe on 2nd floor", undefined, undefined];
const PEOPLE = ["Sam Lee", "Priya Shah", "Jordan Kim", "Maria Lopez", "Chen Wei", "Tom Baker", "Aisha Khan"];
const DURATIONS = [15, 30, 30, 45, 60, 60, 90];

/** mulberry32: small, fast, good enough for sample data */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

/** Meetings for one day (YYYY-MM-DD), in the viewer's local time. */
export function demoEvents(day: string, connectionId: string): CalendarEvent[] {
  const rand = random(hash(`${day}:${connectionId}`));
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  const weekend = weekday === 0 || weekday === 6;

  const events: CalendarEvent[] = [];
  const at = (minute: number) => new Date(y, m - 1, d, 0, minute).toISOString();

  if (!weekend) {
    // the stand-up anchors most weekdays
    events.push({ id: `${day}-standup`, connectionId, title: "Daily stand-up", start: at(9 * 60 + 30), end: at(9 * 60 + 45), allDay: false, location: "Microsoft Teams" });
  }

  const count = weekend ? Math.floor(rand() * 2) : 2 + Math.floor(rand() * 5);
  for (let i = 0; i < count; i++) {
    const duration = pick(DURATIONS);
    // quarter-hour starts between 08:00 and 17:00
    const start = 8 * 60 + Math.floor(rand() * 36) * 15;
    const title = pick(TITLES.slice(1));
    events.push({
      id: `${day}-${i}`,
      connectionId,
      title,
      start: at(start),
      end: at(start + duration),
      allDay: false,
      location: pick(LOCATIONS),
      attendees: PEOPLE.filter(() => rand() < 0.3),
    });
  }

  if (rand() < 0.15) {
    events.push({ id: `${day}-allday`, connectionId, title: pick(["Company offsite", "Public holiday", "Out of office: Priya", "Quarter close"]), start: day, end: day, allDay: true });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}
