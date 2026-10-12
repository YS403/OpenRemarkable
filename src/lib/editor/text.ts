/**
 * Text layout shared by the editor (canvas) and the PDF exporter, so a text
 * box wraps and sits on the same baselines in both.
 *
 * Both sides draw with the same font files, without kerning, and put each
 * line's baseline at the same offset, computed from the font's metrics.
 */
import type { TextElement } from "./model";

/** Inter's vertical metrics (identical for all four styles). */
const INTER = { unitsPerEm: 2048, ascent: 1984, descent: -494 };

export interface FontFace {
  file: string;
  bold: boolean;
  italic: boolean;
}

/** Font files, served from /public and read from disk by the exporter. */
export const INTER_FACES: readonly FontFace[] = [
  { file: "fonts/inter/Inter-Regular.ttf", bold: false, italic: false },
  { file: "fonts/inter/Inter-Bold.ttf", bold: true, italic: false },
  { file: "fonts/inter/Inter-Italic.ttf", bold: false, italic: true },
  { file: "fonts/inter/Inter-BoldItalic.ttf", bold: true, italic: true },
];

export function faceFor(element: Pick<TextElement, "bold" | "italic">): FontFace {
  return INTER_FACES.find((f) => f.bold === element.bold && f.italic === element.italic)!;
}

export type Measure = (text: string) => number;

/** Height of one line box. */
export const lineBox = (el: Pick<TextElement, "fontSize" | "lineHeight">) => el.fontSize * el.lineHeight;

/**
 * Baseline of line `i`, from the top of the text box: the font's ascent-to-
 * descent span is centred in each line box.
 */
export function baselineY(el: Pick<TextElement, "fontSize" | "lineHeight">, i: number): number {
  const ascent = (INTER.ascent / INTER.unitsPerEm) * el.fontSize;
  const descent = (-INTER.descent / INTER.unitsPerEm) * el.fontSize;
  return i * lineBox(el) + (lineBox(el) - (ascent + descent)) / 2 + ascent;
}

export const textHeight = (el: Pick<TextElement, "fontSize" | "lineHeight">, lineCount: number) =>
  Math.max(1, lineCount) * lineBox(el);

/**
 * Greedy word wrap within `width`. Explicit newlines always break; a word
 * longer than the box is split by character.
 */
export function wrapText(text: string, width: number, measure: Measure): string[] {
  const lines: string[] = [];
  const fits = (s: string) => measure(s.trimEnd()) <= width;
  for (const paragraph of text.split("\n")) {
    let line = "";
    // tokens keep their trailing whitespace: "hello world" → ["hello ", "world"]
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (line && !fits(line + word)) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!line && !fits(word)) {
        for (const ch of word) {
          if (line && !fits(line + ch)) {
            lines.push(line.trimEnd());
            line = "";
          }
          line += ch;
        }
        continue;
      }
      line += word;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Horizontal offset of a line inside the box for its alignment. */
export function alignOffset(align: TextElement["align"], boxWidth: number, lineWidth: number): number {
  if (align === "center") return (boxWidth - lineWidth) / 2;
  if (align === "right") return boxWidth - lineWidth;
  return 0;
}
