import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/lib/calendar/types";

import { PAGE, renderTemplate, type TemplateId, templateName, TEMPLATES } from ".";
import { layoutDay, visibleHours } from "./layout";

const TZ = "Europe/London";
const ev = (id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  connectionId: "c",
  title: id,
  start,
  end,
  allDay: false,
  ...extra,
});

describe("layoutDay", () => {
  it("puts overlapping meetings side by side and leaves the rest full width", () => {
    const placed = layoutDay(
      [
        ev("a", "2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z"),
        ev("b", "2026-10-12T09:30:00Z", "2026-10-12T10:30:00Z"),
        ev("c", "2026-10-12T13:00:00Z", "2026-10-12T14:00:00Z"),
      ],
      "2026-10-12",
      "UTC",
    );
    expect(placed.map((p) => [p.event.id, p.lane, p.lanes])).toEqual([["a", 0, 2], ["b", 1, 2], ["c", 0, 1]]);
  });

  it("uses the page's time zone and clips meetings that cross midnight", () => {
    // 23:00Z on the 11th is 00:00 on the 12th in London (BST)
    const [p] = layoutDay([ev("late", "2026-10-11T22:00:00Z", "2026-10-12T01:00:00Z")], "2026-10-12", TZ);
    expect([p.start, p.end]).toEqual([0, 120]);
  });

  it("widens the visible hours to fit early and late meetings", () => {
    const placed = layoutDay([ev("early", "2026-10-12T06:15:00Z", "2026-10-12T07:00:00Z")], "2026-10-12", "UTC");
    expect(visibleHours(placed)).toEqual({ start: 6, end: 18 });
  });
});

const INPUT = {
  day: "2026-10-12",
  timeZone: TZ,
  events: [
    ev("Stand-up ✓ with emoji 🎉", "2026-10-12T08:30:00Z", "2026-10-12T08:45:00Z", { attendees: ["Sam Lee"] }),
    ev("Design review", "2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z", { location: "Room 3A" }),
    ev("Offsite", "2026-10-12", "2026-10-13", { allDay: true }),
  ],
};

describe.each(TEMPLATES.map((t) => t.id))("%s template", (id: TemplateId) => {
  it("renders reMarkable-sized pages, deterministically", async () => {
    const a = await renderTemplate(id, INPUT);
    const b = await renderTemplate(id, INPUT);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);

    const doc = await PDFDocument.load(a);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(PAGE.width);
      expect(page.getHeight()).toBeCloseTo(PAGE.height);
    }
    expect(doc.getTitle()).toBe(templateName(id, "2026-10-12"));
  });

  it("renders a day without meetings", async () => {
    const doc = await PDFDocument.load(await renderTemplate(id, { ...INPUT, events: [] }));
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it("rejects malformed days", async () => {
    await expect(renderTemplate(id, { ...INPUT, day: "12/10/2026" })).rejects.toThrow("Invalid day");
  });
});

describe("meeting notes template", () => {
  it("adds one linked page per meeting after the overview", async () => {
    const doc = await PDFDocument.load(await renderTemplate("meetings", INPUT));
    expect(doc.getPageCount()).toBe(3); // overview + 2 timed meetings (all-day ones aren't meetings)
    const annots = doc.getPage(0).node.Annots();
    expect(annots?.size()).toBe(2);
  });
});
