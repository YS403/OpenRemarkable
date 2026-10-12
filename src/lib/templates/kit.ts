import { PDFDocument, type PDFFont, type PDFPage, type PDFRef, rgb, StandardFonts } from "pdf-lib";

import type { CalendarEvent } from "@/lib/calendar/types";
import { DEFAULT_PAPER, PT_PER_PX } from "@/lib/rm/constants";

/**
 * Shared drawing kit for templates. Pages are laid out in points with y measured
 * down from the top (like the screen); `up()` converts for pdf-lib.
 */

/** reMarkable 2 paper (1404 × 1872 px at 227 DPI) in points. */
export const PAGE = { width: DEFAULT_PAPER.width * PT_PER_PX, height: DEFAULT_PAPER.height * PT_PER_PX };

/** The left margin is wider: the tablet's toolbar overlaps that edge. */
export const MARGIN = { left: 40, right: 28, top: 34, bottom: 28 };
export const CONTENT = { left: MARGIN.left, right: PAGE.width - MARGIN.right, bottom: PAGE.height - MARGIN.bottom };

export const INK = rgb(0, 0, 0);
export const MUTED = rgb(0.45, 0.45, 0.45);
export const RULE = rgb(0.78, 0.78, 0.78);
export const FAINT = rgb(0.9, 0.9, 0.9);
export const FILL = rgb(0.94, 0.94, 0.94);

/** Handwriting line spacing: about 7.8 mm, close to the tablet's "Lined medium". */
export const LINE_GAP = 22;

export interface TemplateInput {
  /** YYYY-MM-DD, in `timeZone` */
  day: string;
  events: readonly CalendarEvent[];
  /** IANA zone the page is laid out in, e.g. "Europe/London" */
  timeZone: string;
  locale?: string;
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export const up = (y: number) => PAGE.height - y;

/** A new document with deterministic metadata, so the same input gives the same bytes. */
export async function createDocument(title: string, day: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  const date = dayDate(day);
  doc.setTitle(title);
  doc.setProducer("myremarkable");
  doc.setCreator("myremarkable");
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  return { doc, fonts: await embedFonts(doc) };
}

/** The template fonts, embedded in `doc` (standard fonts, so nothing is downloaded). */
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
}

export const addPage = (doc: PDFDocument) => doc.addPage([PAGE.width, PAGE.height]);

// ---------------------------------------------------------------- pieces

/** Weekday, full date, and a right-aligned note, over a heavy rule. Returns the y below it. */
export function drawDayHeader(page: PDFPage, fonts: Fonts, day: string, locale: string, note: string): number {
  const date = dayDate(day);
  const y = MARGIN.top;
  const weekday = date.toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
  const full = date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  text(page, fonts.bold, weekday, CONTENT.left, y + 22, 22);
  text(page, fonts.regular, full, CONTENT.left, y + 38, 11, MUTED);
  textRight(page, fonts.regular, note, CONTENT.right, y + 38, 9, MUTED);
  hline(page, CONTENT.left, CONTENT.right, y + 48, 1, INK);
  return y + 54;
}

/** Small caps-style section label. */
export function label(page: PDFPage, fonts: Fonts, value: string, x: number, y: number): void {
  text(page, fonts.bold, value.toUpperCase(), x, y, 7, MUTED);
}

/** Ruled lines every LINE_GAP from `top` (exclusive) down to `bottom`. Returns how many. */
export function ruledLines(page: PDFPage, left: number, right: number, top: number, bottom: number, gap = LINE_GAP): number {
  let n = 0;
  for (let y = top + gap; y <= bottom; y += gap, n++) hline(page, left, right, y, 0.5, RULE);
  return n;
}

/** Lines with a checkbox at the start of each. */
export function checkboxLines(page: PDFPage, left: number, right: number, top: number, bottom: number, gap = LINE_GAP): void {
  for (let y = top + gap; y <= bottom; y += gap) {
    page.drawRectangle({ x: left, y: up(y - 3), width: 8, height: 8, borderColor: MUTED, borderWidth: 0.7 });
    hline(page, left + 14, right, y, 0.5, RULE);
  }
}

export function hline(page: PDFPage, x0: number, x1: number, y: number, thickness: number, color = RULE, dashed = false): void {
  page.drawLine({ start: { x: x0, y: up(y) }, end: { x: x1, y: up(y) }, thickness, color, dashArray: dashed ? [2, 2] : undefined });
}

export function vline(page: PDFPage, x: number, y0: number, y1: number, thickness: number, color = RULE): void {
  page.drawLine({ start: { x, y: up(y0) }, end: { x, y: up(y1) }, thickness, color });
}

/** Text with its baseline at y (from the top). Unencodable characters become "?". */
export function text(page: PDFPage, font: PDFFont, value: string, x: number, y: number, size: number, color = INK, maxWidth?: number): void {
  const s = maxWidth === undefined ? safe(font, value) : fit(font, value, size, maxWidth);
  if (s) page.drawText(s, { x, y: up(y), size, font, color });
}

export function textRight(page: PDFPage, font: PDFFont, value: string, right: number, y: number, size: number, color = INK): void {
  const s = safe(font, value);
  page.drawText(s, { x: right - font.widthOfTextAtSize(s, size), y: up(y), size, font, color });
}

/** Make a rectangle (top-left based) jump to `target` when tapped. */
export function linkTo(doc: PDFDocument, page: PDFPage, target: PDFRef, x: number, y: number, width: number, height: number): void {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, up(y + height), x + width, up(y)],
    Border: [0, 0, 0],
    Dest: [target, "Fit"],
  });
  page.node.addAnnot(doc.context.register(annot));
}

// ---------------------------------------------------------------- text helpers

const charSets = new WeakMap<PDFFont, Set<number>>();

/** Replace characters the standard fonts can't encode (they cover WinAnsi only). */
export function safe(font: PDFFont, value: string): string {
  let chars = charSets.get(font);
  if (!chars) charSets.set(font, (chars = new Set(font.getCharacterSet())));
  let out = "";
  for (const ch of value) out += chars.has(ch.codePointAt(0)!) ? ch : "?";
  return out;
}

/** Shorten text with an ellipsis so it fits `maxWidth`. */
export function fit(font: PDFFont, value: string, size: number, maxWidth: number): string {
  let s = safe(font, value);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 0 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return s.length > 0 ? `${s.trimEnd()}...` : "";
}

// ---------------------------------------------------------------- dates

/** Midnight UTC of a YYYY-MM-DD day; only used for its calendar fields. */
export function dayDate(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Invalid day "${day}", expected YYYY-MM-DD.`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export const clock = (minute: number) => {
  const m = Math.min(Math.max(minute, 0), 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const countLabel = (n: number) => (n === 0 ? "No meetings" : n === 1 ? "1 meeting" : `${n} meetings`);
