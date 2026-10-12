import type { PDFDocument } from "pdf-lib";

import { drawHourGrid } from "./hour-grid";
import {
  addPage,
  checkboxLines,
  CONTENT,
  countLabel,
  createDocument,
  drawDayHeader,
  hline,
  label,
  LINE_GAP,
  MUTED,
  ruledLines,
  text,
  type Fonts,
  type TemplateInput,
  vline,
} from "./kit";
import { allDayEvents, layoutDay, visibleHours } from "./layout";
import { templateName } from "./names";

/** schedule column share of the content width */
const SCHEDULE_SHARE = 0.47;
const GUTTER = 14;
const TODO_LINES = 9;

/**
 * "Daily planner": the classic two-column day. Hourly schedule with meetings
 * on the left; top three priorities, a to-do list and notes on the right.
 */
export async function renderPlanner(input: TemplateInput): Promise<Uint8Array> {
  const { doc, fonts } = await createDocument(templateName("planner", input.day, input.locale), input.day);
  addPlannerPages(doc, fonts, input);
  return doc.save();
}

/** Append the day's page to `doc`. Returns how many pages were added. */
export function addPlannerPages(doc: PDFDocument, fonts: Fonts, input: TemplateInput): number {
  const locale = input.locale ?? "en-GB";
  const page = addPage(doc);

  const allDay = allDayEvents(input.events, input.day, input.timeZone);
  const timed = layoutDay(input.events, input.day, input.timeZone);
  const top = drawDayHeader(page, fonts, input.day, locale, countLabel(timed.length + allDay.length)) + 8;

  const split = CONTENT.left + (CONTENT.right - CONTENT.left) * SCHEDULE_SHARE;
  const right = { left: split + GUTTER, right: CONTENT.right };
  vline(page, split + GUTTER / 2, top, CONTENT.bottom, 0.5);

  // left: schedule, a longer day than the default so evenings fit too
  label(page, fonts, "Schedule", CONTENT.left, top + 6);
  let gridTop = top + 14;
  if (allDay.length > 0) {
    text(page, fonts.regular, allDay.map((e) => e.title).join(" · "), CONTENT.left, gridTop + 6, 7, MUTED, split - CONTENT.left);
    gridTop += 12;
  }
  drawHourGrid(page, fonts, timed, { left: CONTENT.left, right: split, top: gridTop, bottom: CONTENT.bottom }, visibleHours(timed, { start: 7, end: 20 }));

  // right: priorities, to-dos, notes
  let y = top + 6;
  label(page, fonts, "Top 3", right.left, y);
  for (let i = 1; i <= 3; i++) {
    const lineY = y + i * LINE_GAP;
    text(page, fonts.bold, String(i), right.left, lineY - 4, 9, MUTED);
    hline(page, right.left + 12, right.right, lineY, 0.5);
  }
  y += 3 * LINE_GAP + 22;

  label(page, fonts, "To do", right.left, y);
  checkboxLines(page, right.left, right.right, y, y + TODO_LINES * LINE_GAP);
  y += TODO_LINES * LINE_GAP + 22;

  label(page, fonts, "Notes", right.left, y);
  ruledLines(page, right.left, right.right, y, CONTENT.bottom);
  return 1;
}
