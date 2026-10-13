import type { PDFPage } from "pdf-lib";

import { clock, FAINT, FILL, fit, type Fonts, hline, INK, MUTED, RULE, text, up } from "./kit";
import { type PlacedEvent, visibleHours } from "./layout";

export const HOUR_LABEL_W = 30;
/** smallest event block, in points: one readable line of 7 pt text */
const MIN_BLOCK_H = 11;
/** height a short meeting grows to (when free) so it can show its place and people */
const TWO_LINE_H = 19;

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * An hour-by-hour column with the day's meetings as blocks. Wide grids show
 * title plus time and place; narrow ones (`compact`) keep to one line.
 */
export function drawHourGrid(
  page: PDFPage,
  fonts: Fonts,
  placed: readonly PlacedEvent[],
  box: Box,
  hours = visibleHours(placed),
  /** drawn after the hour lines, before the meetings (so it never hides one) */
  overlay?: (yOf: (minute: number) => number, gridLeft: number) => void,
  /** extra space between the hour labels and the meeting area, e.g. for a prayer strip */
  labelGap = 0,
  /** add place/attendees inside short blocks; off when the page lists meetings in full elsewhere */
  inlineDetails = true,
): void {
  const perMinute = (box.bottom - box.top) / ((hours.end - hours.start) * 60);
  const gridLeft = box.left + HOUR_LABEL_W + labelGap;
  const yOf = (minute: number) => box.top + (minute - hours.start * 60) * perMinute;

  for (let h = hours.start; h <= hours.end; h++) {
    const y = yOf(h * 60);
    hline(page, gridLeft, box.right, y, 0.6, RULE);
    if (h < hours.end) {
      hline(page, gridLeft, box.right, yOf(h * 60 + 30), 0.4, FAINT, true);
      text(page, fonts.regular, `${String(h).padStart(2, "0")}:00`, box.left, y + 7, 7, MUTED);
    }
  }

  overlay?.(yOf, gridLeft);

  const width = box.right - gridLeft - 4;
  for (const p of placed) {
    const y0 = yOf(p.start);
    const laneW = width / p.lanes;
    const x = gridLeft + 2 + p.lane * laneW;
    const w = laneW - 2;
    // short meetings still get a block tall enough to read; when nothing follows
    // closely in the same lane, grow to two lines so place and people fit
    const nextStart = placed
      .filter((o) => o !== p && o.lane === p.lane && o.start >= p.start)
      .reduce((m, o) => Math.min(m, o.start), Infinity);
    const free = (Number.isFinite(nextStart) ? yOf(nextStart) : box.bottom) - y0 - 1.5;
    const h = Math.max(yOf(p.end) - y0 - 1, Math.min(TWO_LINE_H, free), MIN_BLOCK_H);
    page.drawRectangle({ x, y: up(y0 + 0.5 + h), width: w, height: h, color: FILL, borderColor: INK, borderWidth: 0.7 });
    page.drawRectangle({ x, y: up(y0 + 0.5 + h), width: 2.2, height: h, color: INK });

    const textX = x + 6;
    const textW = w - 9;
    const time = `${clock(p.start)}–${clock(p.end)}`;
    const people = p.event.attendees?.length ? `with ${p.event.attendees.join(", ")}` : "";
    const details = [p.event.location, people].filter(Boolean).join("  ·  ");
    // the full start–end time always comes first and is never cut; the title gives way instead
    const head = (size: number, baseline: number) => {
      const timeW = fonts.bold.widthOfTextAtSize(`${time}  `, size);
      text(page, fonts.bold, time, textX, baseline, size, INK);
      const title = fit(fonts.bold, p.event.title, size, Math.max(textW - timeW, 0));
      if (title) text(page, fonts.bold, title, textX + timeW, baseline, size, INK);
      return timeW + (title ? fonts.bold.widthOfTextAtSize(title, size) : 0);
    };
    if (h >= 22) {
      // time and title, then place, then who (when there's room)
      head(8, y0 + 10);
      if (details) text(page, fonts.regular, p.event.location ?? people, textX, y0 + 19, 6.5, MUTED, textW);
      if (p.event.location && people && h >= 31) text(page, fonts.regular, people, textX, y0 + 27.5, 6, MUTED, textW);
    } else if (h >= TWO_LINE_H) {
      // compact two lines: time and title; then place and people
      head(7, y0 + 8.5);
      if (details) text(page, fonts.regular, details, textX, y0 + 16, 6, MUTED, textW);
    } else {
      // one line: time and title in bold, then the place if it fits
      const size = Math.min(7, h - 4);
      const baseline = y0 + 0.5 + h / 2 + size * 0.35;
      const used = head(size, baseline);
      if (inlineDetails && details && textW - used > 20) text(page, fonts.regular, `  ·  ${details}`, textX + used, baseline, size, MUTED, textW - used);
    }
  }
}
