import type { PDFDocument, PDFPage } from "pdf-lib";

import type { CalendarEvent } from "@/lib/calendar/types";

import {
  addPage,
  checkboxLines,
  clock,
  CONTENT,
  countLabel,
  createDocument,
  dayDate,
  drawDayHeader,
  type Fonts,
  hline,
  INK,
  label,
  linkTo,
  MARGIN,
  MUTED,
  ruledLines,
  text,
  textRight,
  type TemplateInput,
  vline,
} from "./kit";
import { allDayEvents, layoutDay, type PlacedEvent } from "./layout";
import { templateName } from "./names";

const ROW_H = 32;
const CUE_W = 120;
const SUMMARY_H = 74;

/**
 * "Meeting notes": an overview page listing the day's meetings, then one
 * Cornell-style page per meeting (notes, an actions & decisions column, and a
 * summary). Overview rows are links, so tapping one on the tablet jumps to
 * that meeting's page, and every meeting page links back.
 */
export async function renderMeetings(input: TemplateInput): Promise<Uint8Array> {
  const { doc, fonts } = await createDocument(templateName("meetings", input.day, input.locale), input.day);
  addMeetingPages(doc, fonts, input);
  return doc.save();
}

/** Append the day's overview and meeting pages to `doc`. Returns how many pages were added. */
export function addMeetingPages(doc: PDFDocument, fonts: Fonts, input: TemplateInput): number {
  const locale = input.locale ?? "en-GB";

  const allDay = allDayEvents(input.events, input.day, input.timeZone);
  const timed = layoutDay(input.events, input.day, input.timeZone);

  const overview = addPage(doc);
  // pages are created first so overview rows can link to them
  const meetingPages = timed.length > 0 ? timed.map(() => addPage(doc)) : [addPage(doc)];
  const dateLabel = dayDate(input.day).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  drawOverview(doc, overview, fonts, input.day, locale, timed, allDay, meetingPages);
  if (timed.length === 0) drawMeetingPage(doc, meetingPages[0], fonts, null, dateLabel, overview);
  timed.forEach((p, i) => drawMeetingPage(doc, meetingPages[i], fonts, p, dateLabel, overview));
  return 1 + meetingPages.length;
}

function drawOverview(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  day: string,
  locale: string,
  timed: readonly PlacedEvent[],
  allDay: readonly CalendarEvent[],
  meetingPages: readonly PDFPage[],
): void {
  let y = drawDayHeader(page, fonts, day, locale, countLabel(timed.length + allDay.length)) + 8;

  if (allDay.length > 0) {
    label(page, fonts, "All day", CONTENT.left, y + 6);
    text(page, fonts.regular, allDay.map((e) => e.title).join("  ·  "), CONTENT.left + 34, y + 6, 8.5, INK, CONTENT.right - CONTENT.left - 34);
    y += 18;
  }

  label(page, fonts, "Meetings", CONTENT.left, y + 6);
  y += 12;
  if (timed.length === 0) {
    text(page, fonts.regular, "No meetings today. A blank meeting page follows.", CONTENT.left, y + 16, 9, MUTED);
    y += 28;
  }

  // as many rows as fit above the notes area
  const notesTop = Math.max(y + Math.min(timed.length, 12) * ROW_H + 18, CONTENT.bottom - 190);
  const rows = Math.min(timed.length, Math.floor((notesTop - 18 - y) / ROW_H));
  for (let i = 0; i < rows; i++) {
    const p = timed[i];
    const rowTop = y + i * ROW_H;
    text(page, fonts.bold, clock(p.start), CONTENT.left, rowTop + 13, 9);
    text(page, fonts.regular, clock(p.end), CONTENT.left, rowTop + 24, 7.5, MUTED);
    const textLeft = CONTENT.left + 46;
    const textW = CONTENT.right - textLeft - 40;
    text(page, fonts.bold, p.event.title, textLeft, rowTop + 13, 9.5, INK, textW);
    text(page, fonts.regular, details(p.event), textLeft, rowTop + 24, 7.5, MUTED, textW);
    // page numbers would be wrong once days are combined into one document; the row itself is the link
    textRight(page, fonts.regular, "notes  >", CONTENT.right, rowTop + 13, 8, MUTED);
    hline(page, CONTENT.left, CONTENT.right, rowTop + ROW_H, 0.5);
    linkTo(doc, page, meetingPages[i].ref, CONTENT.left, rowTop, CONTENT.right - CONTENT.left, ROW_H);
  }
  if (rows < timed.length) {
    text(page, fonts.regular, `+ ${timed.length - rows} more on the following pages`, CONTENT.left, y + rows * ROW_H + 14, 8, MUTED);
  }

  label(page, fonts, "Notes", CONTENT.left, notesTop);
  ruledLines(page, CONTENT.left, CONTENT.right, notesTop, CONTENT.bottom);
}

function drawMeetingPage(doc: PDFDocument, page: PDFPage, fonts: Fonts, placed: PlacedEvent | null, dateLabel: string, overview: PDFPage): void {
  let y = MARGIN.top;

  // back to the overview, top right
  textRight(page, fonts.regular, "<  overview", CONTENT.right, y + 8, 8, MUTED);
  linkTo(doc, page, overview.ref, CONTENT.right - 60, y - 2, 60, 14);

  if (placed) {
    text(page, fonts.bold, placed.event.title, CONTENT.left, y + 30, 17, INK, CONTENT.right - CONTENT.left);
    const where = placed.event.location ? `  ·  ${placed.event.location}` : "";
    text(page, fonts.regular, `${dateLabel}  ·  ${clock(placed.start)}–${clock(placed.end)}${where}`, CONTENT.left, y + 45, 9, MUTED, CONTENT.right - CONTENT.left);
    const people = placed.event.attendees?.length ? placed.event.attendees.join(", ") : "-";
    text(page, fonts.regular, `With: ${people}`, CONTENT.left, y + 58, 8, MUTED, CONTENT.right - CONTENT.left);
  } else {
    // a fill-in header for meetings that weren't on the calendar
    text(page, fonts.bold, "Meeting", CONTENT.left, y + 30, 17);
    hline(page, CONTENT.left + 78, CONTENT.right, y + 30, 0.5);
    text(page, fonts.regular, `${dateLabel}  ·  Time`, CONTENT.left, y + 45, 9, MUTED);
    hline(page, CONTENT.left + 110, CONTENT.left + 200, y + 45, 0.5);
    text(page, fonts.regular, "With:", CONTENT.left, y + 58, 8, MUTED);
    hline(page, CONTENT.left + 26, CONTENT.right, y + 58, 0.5);
  }
  y += 66;
  hline(page, CONTENT.left, CONTENT.right, y, 1, INK);

  const bodyTop = y + 6;
  const summaryTop = CONTENT.bottom - SUMMARY_H;
  const cueRight = CONTENT.left + CUE_W;

  label(page, fonts, "Actions & decisions", CONTENT.left, bodyTop + 8);
  checkboxLines(page, CONTENT.left, cueRight - 8, bodyTop + 8, summaryTop - 8);
  vline(page, cueRight, bodyTop, summaryTop, 0.6);

  label(page, fonts, "Notes", cueRight + 10, bodyTop + 8);
  ruledLines(page, cueRight + 10, CONTENT.right, bodyTop + 8, summaryTop - 8);

  hline(page, CONTENT.left, CONTENT.right, summaryTop, 1, INK);
  label(page, fonts, "Summary & next steps", CONTENT.left, summaryTop + 12);
  ruledLines(page, CONTENT.left, CONTENT.right, summaryTop + 12, CONTENT.bottom);
}

function details(e: CalendarEvent): string {
  const parts = [e.location, e.attendees?.length ? `with ${e.attendees.join(", ")}` : undefined].filter(Boolean);
  return parts.join("  ·  ");
}
