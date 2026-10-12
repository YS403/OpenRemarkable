import type { Rgba } from "./types";

/** Color codes stored in .rm files. */
export const ColorCode = {
  Black: 0,
  Gray: 1,
  White: 2,
  HighlighterYellow: 3,
  HighlighterGreen: 4,
  HighlighterPink: 5,
  Blue: 6,
  Red: 7,
  GrayOverlap: 8,
  /** the real color is the line's ARGB value */
  Argb: 9,
  Green: 10,
  Cyan: 11,
  Magenta: 12,
  Yellow: 13,
} as const;

export function argb(value: number): Rgba {
  return {
    a: ((value >>> 24) & 0xff) / 255,
    r: (value >>> 16) & 0xff,
    g: (value >>> 8) & 0xff,
    b: value & 0xff,
  };
}

/**
 * The desktop app's export palette, in color-code order (built inline in the
 * vectorizer, e.g. FUN_140a5daa0).
 */
const PALETTE: readonly number[] = [
  0xff000000, // black
  0xff909090, // gray
  0xffffffff, // white
  0xfffefd60, // highlighter yellow
  0xffa9fa5c, // highlighter green
  0xffff55cf, // highlighter pink
  0xff304ae0, // blue
  0xffc23132, // red
  0x40000000, // gray overlap (translucent)
  0xff000000, // ARGB placeholder
  0xff91da71, // green
  0xff74d2e8, // cyan
  0xffc07fd2, // magenta
  0xfffae719, // yellow
];

/**
 * Resolve a stroke color. Lines with an explicit ARGB value (newer firmware
 * and all highlighter colors) use it; otherwise the palette entry.
 */
export function resolveColor(code: number, colorArgb: number | undefined): { color: Rgba; known: boolean } {
  if (colorArgb !== undefined) return { color: argb(colorArgb), known: true };
  const entry = PALETTE[code];
  if (entry === undefined) return { color: argb(PALETTE[ColorCode.Black]), known: false };
  return { color: argb(entry), known: true };
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
