import { describe, expect, it } from "vitest";

import { ANCHOR_LINE_OFFSET, PLAIN_LINE_HEIGHT } from "./constants";
import type { SequenceItem } from "./crdt";
import { layoutText } from "./text-layout";

const id = (authorId: number, counter: number) => ({ authorId, counter });
const ZERO = id(0, 0);
const monospace = (t: string, size: number) => t.length * size * 0.5;

function block(value: string, width = 936) {
  const items: SequenceItem<string>[] = [{ itemId: id(1, 1), leftId: ZERO, rightId: ZERO, deletedLength: 0, value }];
  return { items, posX: -468, posY: 234, width };
}

describe("text layout", () => {
  it("places anchors on blank lines exactly (insert-space pages)", () => {
    const layout = layoutText(block("\n".repeat(20)), monospace);
    // the 9th character is the newline that starts line 8
    expect(layout.anchorY(id(1, 9))).toBeCloseTo(234 + ANCHOR_LINE_OFFSET + 8 * PLAIN_LINE_HEIGHT, 6);
    expect(layout.approximate).toBe(false);
    expect(layout.lines).toEqual([]);
  });

  it("puts the end-of-text anchor on the last character's line", () => {
    const layout = layoutText(block("\n".repeat(33)), monospace);
    expect(layout.anchorY({ authorId: 0, counter: 281474976710655 })).toBeCloseTo(
      234 + ANCHOR_LINE_OFFSET + 32 * PLAIN_LINE_HEIGHT,
      6,
    );
  });

  it("wraps long lines and moves wrapped words with their anchors", () => {
    // 17 px per character at size 34 → about 55 characters per 936 px line
    const words = "lorem ipsum dolor sit amet ".repeat(4);
    const layout = layoutText(block(words), monospace);
    expect(layout.approximate).toBe(true);
    expect(layout.lines.length).toBe(2);
    const lastChar = id(1, words.length);
    expect(layout.anchorY(lastChar)).toBeCloseTo(234 + ANCHOR_LINE_OFFSET + PLAIN_LINE_HEIGHT, 6);
  });

  it("returns nothing for pages without text", () => {
    const layout = layoutText(undefined, monospace);
    expect(layout.lines).toEqual([]);
    expect(layout.anchorY(id(1, 1))).toBeUndefined();
  });
});
