import type { LineElement } from "./model";

export interface Point {
  x: number;
  y: number;
}

/** Arrowhead size grows with the stroke so thin and thick arrows both read well. */
export function arrowSize(strokeWidth: number): { length: number; width: number } {
  const length = Math.max(8, strokeWidth * 4);
  return { length, width: length * 0.8 };
}

/**
 * Filled triangle for an arrowhead with its tip at `tip`, pointing away from
 * `from`. Coordinates are in the line's local space.
 */
export function arrowHead(from: Point, tip: Point, strokeWidth: number): Point[] {
  const { length, width } = arrowSize(strokeWidth);
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * length;
  const by = tip.y - uy * length;
  return [tip, { x: bx - uy * (width / 2), y: by + ux * (width / 2) }, { x: bx + uy * (width / 2), y: by - ux * (width / 2) }];
}

/**
 * The shaft of a line, shortened under arrowheads so a thick stroke doesn't
 * poke out past the tip.
 */
export function lineShaft(el: Pick<LineElement, "dx" | "dy" | "strokeWidth" | "arrowStart" | "arrowEnd">): [Point, Point] {
  const len = Math.hypot(el.dx, el.dy) || 1;
  const ux = el.dx / len;
  const uy = el.dy / len;
  const inset = arrowSize(el.strokeWidth).length * 0.6;
  const start = el.arrowStart ? { x: ux * inset, y: uy * inset } : { x: 0, y: 0 };
  const end = el.arrowEnd ? { x: el.dx - ux * inset, y: el.dy - uy * inset } : { x: el.dx, y: el.dy };
  return [start, end];
}

export function lineHeads(el: Pick<LineElement, "dx" | "dy" | "strokeWidth" | "arrowStart" | "arrowEnd">): Point[][] {
  const start = { x: 0, y: 0 };
  const end = { x: el.dx, y: el.dy };
  const heads: Point[][] = [];
  if (el.arrowStart) heads.push(arrowHead(end, start, el.strokeWidth));
  if (el.arrowEnd) heads.push(arrowHead(start, end, el.strokeWidth));
  return heads;
}
