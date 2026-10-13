import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredTimetable } from "@/lib/prayer/timetable";

const requireSession = vi.fn();
let stored: StoredTimetable | null = null;

// GET opts out of prerendering with connection(), which needs a real request scope
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/lib/session/session", () => ({
  requireSession: () => requireSession(),
  NotConnectedError: class NotConnectedError extends Error {},
}));
vi.mock("@/lib/prayer/store", () => ({
  prayerStore: {
    load: async () => (stored ? structuredClone(stored) : null),
    save: async (_userId: string, next: StoredTimetable) => void (stored = structuredClone(next)),
  },
}));

const { DELETE, GET, PATCH, POST } = await import("./route");
const { NotConnectedError } = await import("@/lib/session/session");

const URL_BASE = "http://localhost/api/calendar/prayer";
const day = (date: string) => ({ date, fajr: "05:30", sunrise: "07:00", dhuhr: "12:30", asr: "15:45", maghrib: "18:00", isha: "19:30" });
const send = (method: string, body: unknown, query = "") =>
  new NextRequest(`${URL_BASE}${query}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  stored = null;
  requireSession.mockReset();
  requireSession.mockResolvedValue({ userId: "u", deviceToken: "t" });
});

describe("/api/calendar/prayer", () => {
  it("uploads months one after another and reports what's stored", async () => {
    const first = await POST(send("POST", { days: [day("2026-10-01"), day("2026-10-02")] }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ enabled: true, added: 2, months: [{ month: "2026-10", days: 2 }] });

    await POST(send("POST", [day("2026-11-01")]));
    const summary = await (await GET(new NextRequest(URL_BASE))).json();
    expect(summary.months).toEqual([{ month: "2026-10", days: 2 }, { month: "2026-11", days: 1 }]);
  });

  it("explains bad files by day and field", async () => {
    const response = await POST(send("POST", { days: [day("2026-10-01"), { ...day("2026-10-02"), isha: "7:38" }] }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Day 2 (2026-10-02), isha: Expected HH:MM (24-hour).");
    expect(stored).toBeNull();
  });

  it("switching off hides prayer times from pages but keeps the months", async () => {
    await POST(send("POST", [day("2026-10-01")]));
    expect((await (await GET(new NextRequest(`${URL_BASE}?day=2026-10-01`))).json()).prayers).not.toBeNull();

    const off = await PATCH(send("PATCH", { enabled: false }));
    expect(await off.json()).toMatchObject({ enabled: false, months: [{ month: "2026-10", days: 1 }] });
    expect((await (await GET(new NextRequest(`${URL_BASE}?day=2026-10-01`))).json()).prayers).toBeNull();

    await PATCH(send("PATCH", { enabled: true }));
    expect((await (await GET(new NextRequest(`${URL_BASE}?day=2026-10-01`))).json()).prayers).not.toBeNull();
  });

  it("removes one month", async () => {
    await POST(send("POST", [day("2026-10-01"), day("2026-11-01")]));
    const response = await DELETE(new NextRequest(`${URL_BASE}?month=2026-10`, { method: "DELETE" }));
    expect((await response.json()).months).toEqual([{ month: "2026-11", days: 1 }]);
    expect((await DELETE(new NextRequest(`${URL_BASE}?month=2026-13`, { method: "DELETE" }))).status).toBe(400);
  });

  it("rejects non-JSON bodies and needs a session", async () => {
    const form = new NextRequest(URL_BASE, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect((await POST(form)).status).toBe(415);
    requireSession.mockRejectedValue(new NotConnectedError());
    expect((await GET(new NextRequest(URL_BASE))).status).toBe(401);
  });
});
