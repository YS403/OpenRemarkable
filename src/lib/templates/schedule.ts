import type { PDFDocument } from "pdf-lib";

import { drawHourGrid } from "./hour-grid";

import { addPage, CONTENT, countLabel, createDocument, drawDayHeader, type Fonts, label, MARGIN, PAGE, ruledLines, text, type TemplateInput } from "./kit";
import { allDayEvents, layoutDay } from "./layout";
import { templateName } from "./names";

/** schedule height share of the page body; the rest is lines for notes */
const SCHEDULE_SHARE = 0.56;

/** "Schedule": the day's meetings on a full-width hour grid, ruled notes below. One page. */
export async function renderSchedule(input: TemplateInput): Promise<Uint8Array> {
  const { doc, fonts } = await createDocument(templateName("schedule", input.day, input.locale), input.day);
  addSchedulePages(doc, fonts, input);
  return doc.save();
}

/** Append the day's page to `doc`. Returns how many pages were added. */
export function addSchedulePages(doc: PDFDocument, fonts: Fonts, input: TemplateInput): number {
  const locale = input.locale ?? "en-GB";
  const page = addPage(doc);

  const allDay = allDayEvents(input.events, input.day, input.timeZone);
  const timed = layoutDay(input.events, input.day, input.timeZone);

  let y = drawDayHeader(page, fonts, input.day, locale, countLabel(timed.length + allDay.length));
  if (allDay.length > 0) {
    label(page, fonts, "All day", CONTENT.left, y + 10);
    text(page, fonts.regular, allDay.map((e) => e.title).join("  ·  "), CONTENT.left + 34, y + 10, 8.5, undefined, CONTENT.right - CONTENT.left - 34);
    y += 16;
  }

  const scheduleBottom = MARGIN.top + (PAGE.height - MARGIN.top - MARGIN.bottom) * SCHEDULE_SHARE + (allDay.length ? 14 : 0);
  drawHourGrid(page, fonts, timed, { left: CONTENT.left, right: CONTENT.right, top: y + 8, bottom: scheduleBottom });

  label(page, fonts, "Notes", CONTENT.left, scheduleBottom + 18);
  ruledLines(page, CONTENT.left, CONTENT.right, scheduleBottom + 18, CONTENT.bottom);
  return 1;
}
