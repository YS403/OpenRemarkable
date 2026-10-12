import { ANCHOR_LINE_OFFSET, PLAIN_LINE_HEIGHT } from "./constants";
import { idKey, orderCharacters, splitIntoCharacters, type CrdtIdLike, type SequenceItem } from "./crdt";
import type { TextLine } from "./types";

/** The typed-text block of a v6 page. */
export interface TextBlock {
  items: readonly SequenceItem<string | number>[];
  posX: number;
  posY: number;
  width: number;
}

/** Measures text width in scene pixels at a font size in scene pixels. */
export type MeasureText = (text: string, fontSize: number) => number;

export interface TextLayout {
  lines: TextLine[];
  /** y of the line holding the anchor character; undefined if unknown */
  anchorY(anchor: CrdtIdLike): number | undefined;
  /** true when the layout had to guess (wrapped or non-empty text) */
  approximate: boolean;
}

/** Font size used for typed text, in scene pixels (approximation). */
export const TEXT_FONT_SIZE = 34;

const END_COUNTER = 281474976710655;

/**
 * Lay out typed text one visual line at a time. Line positions use the
 * measured plain-text metrics, which are exact for blank lines ("insert space")
 * and approximate when lines hold text, since the app's fonts, paragraph styles
 * and wrapping are not reproduced exactly.
 */
export function layoutText(block: TextBlock | undefined, measure: MeasureText): TextLayout {
  if (!block) return { lines: [], anchorY: () => undefined, approximate: false };

  const chars: { char: string; key: string }[] = [];
  // Deleted characters keep their ids; anchors on them resolve to where they were.
  const deletedKeyPosition = new Map<string, number>();
  for (const item of orderCharacters(splitIntoCharacters(block.items))) {
    if (item.char === undefined) deletedKeyPosition.set(item.key, chars.length);
    else chars.push({ char: item.char, key: item.key });
  }
  const lineOfChar: number[] = new Array(chars.length);
  const keyIndex = new Map<string, number>();
  const lines: TextLine[] = [];
  const lineY = (index: number) => block.posY + ANCHOR_LINE_OFFSET + index * PLAIN_LINE_HEIGHT;

  let approximate = false;
  let line = 0;
  // characters of the visual line being built, by index into `chars`
  let current: number[] = [];
  const textOf = (indices: number[]) => indices.map((i) => chars[i].char).join("");
  const flush = (indices: number[]) => {
    const text = textOf(indices);
    if (text.trim()) lines.push({ text, x: block.posX, baseline: lineY(line), fontSize: TEXT_FONT_SIZE });
  };

  chars.forEach(({ char, key }, i) => {
    keyIndex.set(key, i);
    lineOfChar[i] = line;
    if (char === "\n") {
      flush(current);
      current = [];
      line += 1;
      return;
    }
    approximate = true;
    if (current.length > 0 && measure(textOf([...current, i]), TEXT_FONT_SIZE) > block.width) {
      // wrap after the last space if there is one, else mid-word
      const space = current.findLastIndex((j) => chars[j].char === " ");
      const keep = space >= 0 ? current.slice(0, space) : current;
      const carry = space >= 0 ? current.slice(space + 1) : [];
      flush(keep);
      line += 1;
      for (const j of carry) lineOfChar[j] = line;
      lineOfChar[i] = line;
      current = [...carry, i];
    } else {
      current.push(i);
    }
  });
  flush(current);

  const lastLine = chars.length > 0 ? lineOfChar[chars.length - 1] : 0;

  return {
    lines,
    approximate,
    anchorY(anchor) {
      if (anchor.authorId === 0 && anchor.counter === END_COUNTER) return lineY(lastLine);
      const key = idKey(anchor);
      const index = keyIndex.get(key);
      if (index !== undefined) return lineY(lineOfChar[index]);
      const deletedAt = deletedKeyPosition.get(key);
      if (deletedAt !== undefined) return lineY(deletedAt < chars.length ? lineOfChar[deletedAt] : lastLine);
      return undefined;
    },
  };
}
