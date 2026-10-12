import type { PDFPage } from "pdf-lib";

import { clock, FAINT, FILL, type Fonts, hline, INK, MUTED, RULE, text, up } from "./kit";
import { type PlacedEvent, visibleHours } from "./layout";

const HOUR_LABEL_W = 30;
/** smallest event block, in points: one readable line of 7 pt text */
const MIN_BLOCK_H = 11;

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
export function drawHourGrid(page: PDFPage, fonts: Fonts, placed: readonly PlacedEvent[], box: Box, hours = visibleHours(placed)): void {
  const perMinute = (box.bottom - box.top) / ((hours.end - hours.start) * 60);
  const gridLeft = box.left + HOUR_LABEL_W;
  const yOf = (minute: number) => box.top + (minute - hours.start * 60) * perMinute;

  for (let h = hours.start; h <= hours.end; h++) {
    const y = yOf(h * 60);
    hline(page, gridLeft, box.right, y, 0.6, RULE);
    if (h < hours.end) {
      hline(page, gridLeft, box.right, yOf(h * 60 + 30), 0.4, FAINT, true);
      text(page, fonts.regular, `${String(h).padStart(2, "0")}:00`, box.left, y + 7, 7, MUTED);
    }
  }

  const width = box.right - gridLeft - 4;
  for (const p of placed) {
    const y0 = yOf(p.start);
    const laneW = width / p.lanes;
    const x = gridLeft + 2 + p.lane * laneW;
    const w = laneW - 2;
    // short meetings still get a block tall enough to read
    const h = Math.max(yOf(p.end) - y0 - 1, MIN_BLOCK_H);
    page.drawRectangle({ x, y: up(y0 + 0.5 + h), width: w, height: h, color: FILL, borderColor: INK, borderWidth: 0.7 });
    page.drawRectangle({ x, y: up(y0 + 0.5 + h), width: 2.2, height: h, color: INK });

    const textX = x + 6;
    const textW = w - 9;
    if (h >= 22 && w >= 90) {
      text(page, fonts.bold, p.event.title, textX, y0 + 10, 8, INK, textW);
      const time = `${clock(p.start)}–${clock(p.end)}`;
      text(page, fonts.regular, p.event.location ? `${time}  ·  ${p.event.location}` : time, textX, y0 + 19, 6.5, MUTED, textW);
    } else {
      const size = Math.min(7.5, h - 4);
      text(page, fonts.bold, `${clock(p.start)}  ${p.event.title}`, textX, y0 + 0.5 + h / 2 + size * 0.35, size, INK, textW);
    }
  }
}
