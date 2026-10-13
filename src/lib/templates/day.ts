import { type PDFDocument, type PDFPage, rgb } from "pdf-lib";

import { minutesOf, type DayPrayers } from "@/lib/prayer/timetable";

import { type Box, drawHourGrid, HOUR_LABEL_W } from "./hour-grid";
import {
  addPage,
  checkboxLines,
  CONTENT,
  countLabel,
  createDocument,
  drawDayHeader,
  type Fonts,
  hline,
  INK,
  label,
  LINE_GAP,
  MUTED,
  ruledLines,
  text,
  type TemplateInput,
  up,
  vline,
} from "./kit";
import { allDayEvents, layoutDay } from "./layout";
import { templateName } from "./names";

/** timeline column share of the content width */
const TIMELINE_SHARE = 0.62;
const GUTTER = 14;
const TODO_LINES = 12;
const BAND = rgb(0.955, 0.955, 0.955);
const BAND_EDGE = rgb(0.55, 0.55, 0.55);
/** width of the prayer strip beside the hour labels, and its gap to the meetings */
const STRIP_W = 46;
const STRIP_GAP = 4;
const DAY_MINUTES = 24 * 60;

/**
 * "My day": the whole day on a 24-hour timeline with meetings and the day's
 * prayer windows shaded on it; prayer times, a to-do list and notes beside it.
 */
export async function renderDay(input: TemplateInput): Promise<Uint8Array> {
  const { doc, fonts } = await createDocument(templateName("day", input.day, input.locale), input.day);
  addDayPages(doc, fonts, input);
  return doc.save();
}

/** Append the day's page to `doc`. Returns how many pages were added. */
export function addDayPages(doc: PDFDocument, fonts: Fonts, input: TemplateInput): number {
  const locale = input.locale ?? "en-GB";
  const page = addPage(doc);
  const prayers = input.prayers ?? null;

  const allDay = allDayEvents(input.events, input.day, input.timeZone);
  const timed = layoutDay(input.events, input.day, input.timeZone);
  const count = countLabel(timed.length + allDay.length);
  const top = drawDayHeader(page, fonts, input.day, locale, count) + 8;

  const split = CONTENT.left + (CONTENT.right - CONTENT.left) * TIMELINE_SHARE;
  const right = { left: split + GUTTER, right: CONTENT.right };
  vline(page, split + GUTTER / 2, top, CONTENT.bottom, 0.5);

  // ---- left: the 24-hour timeline -----------------------------------------
  label(page, fonts, "Today", CONTENT.left, top + 6);
  let gridTop = top + 14;
  if (allDay.length > 0) {
    text(page, fonts.regular, allDay.map((e) => e.title).join(" · "), CONTENT.left, gridTop + 6, 7, MUTED, split - CONTENT.left);
    gridTop += 12;
  }
  const box: Box = { left: CONTENT.left, right: split, top: gridTop, bottom: CONTENT.bottom };
  // prayers get their own strip between the hour labels and the meetings,
  // so a meeting is never hidden behind a prayer window (or the other way round)
  const spans = prayers ? prayerSpans(prayers) : [];
  const strip = spans.length > 0 ? STRIP_W + STRIP_GAP : 0;
  drawHourGrid(page, fonts, timed, box, { start: 0, end: 24 }, (yOf) => drawPrayerStrip(page, fonts, spans, box, yOf), strip);

  // ---- right: to do and notes -------------------------------------------
  let y = top + 6;
  label(page, fonts, "To do", right.left, y);
  checkboxLines(page, right.left, right.right, y, y + TODO_LINES * LINE_GAP);
  y += TODO_LINES * LINE_GAP + 22;

  label(page, fonts, "Notes", right.left, y);
  ruledLines(page, right.left, right.right, y, CONTENT.bottom);
  return 1;
}

interface Span {
  from: number;
  to: number;
  name: string;
  /** "begins–ends", e.g. "05:30–07:00"; absent for the after-midnight Isha continuation */
  times?: string;
}

/** The day's prayer windows as minute spans; Isha also covers 00:00 until today's Fajr. */
function prayerSpans(prayers: DayPrayers): Span[] {
  const spans: Span[] = [];
  for (const w of prayers.windows) {
    const from = minutesOf(w.start);
    // Isha runs past midnight: shade to the end of the day
    const to = w.end === null || minutesOf(w.end) <= from ? DAY_MINUTES : minutesOf(w.end);
    spans.push({ from, to, name: w.label, times: w.end ? `${w.start}–${w.end}` : w.start });
  }
  const fajr = prayers.windows.find((w) => w.name === "fajr");
  if (fajr) spans.push({ from: 0, to: minutesOf(fajr.start), name: "Isha" });
  return spans.filter((s) => s.to > s.from);
}

/**
 * The prayer strip: one shaded segment per window beside the hour labels,
 * with the prayer's name and its begins–ends times at the top.
 */
function drawPrayerStrip(page: PDFPage, fonts: Fonts, spans: readonly Span[], box: Box, yOf: (m: number) => number): void {
  const x = box.left + HOUR_LABEL_W;
  for (const s of spans) {
    const y0 = yOf(s.from);
    const h = yOf(s.to) - y0;
    page.drawRectangle({ x, y: up(y0 + h), width: STRIP_W, height: h, color: BAND });
    page.drawRectangle({ x, y: up(y0 + h), width: 2, height: h, color: BAND_EDGE });
    // a firm line where each window begins, so touching windows stay distinct
    if (s.from > 0) hline(page, x, x + STRIP_W, y0, 1, INK);

    // name, then "begins–ends", at the top of the window
    if (h >= 8) text(page, fonts.bold, s.name, x + 4, y0 + 7, 6, INK, STRIP_W - 6);
    if (h >= 15 && s.times) text(page, fonts.regular, s.times, x + 4, y0 + 13.5, 6, MUTED, STRIP_W - 6);
  }
}


