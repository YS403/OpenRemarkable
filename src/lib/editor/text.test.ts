import { describe, expect, it } from "vitest";

import { alignOffset, baselineY, wrapText } from "./text";

// every character is 10 units wide
const measure = (t: string) => t.length * 10;

describe("wrapText", () => {
  it("keeps short text on one line", () => {
    expect(wrapText("hello world", 200, measure)).toEqual(["hello world"]);
  });

  it("wraps at word boundaries, dropping the space at the break", () => {
    expect(wrapText("hello world again", 120, measure)).toEqual(["hello world", "again"]);
  });

  it("honours explicit newlines, including empty lines", () => {
    expect(wrapText("a\n\nb", 200, measure)).toEqual(["a", "", "b"]);
  });

  it("splits a word longer than the box", () => {
    expect(wrapText("abcdefghij", 40, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("returns one empty line for empty text", () => {
    expect(wrapText("", 100, measure)).toEqual([""]);
  });
});

describe("text metrics", () => {
  it("places baselines one line box apart", () => {
    const el = { fontSize: 20, lineHeight: 1.5 };
    expect(baselineY(el, 1) - baselineY(el, 0)).toBeCloseTo(30);
    // first baseline sits below the top, inside the first line box
    expect(baselineY(el, 0)).toBeGreaterThan(0);
    expect(baselineY(el, 0)).toBeLessThan(30);
  });

  it("aligns lines inside the box", () => {
    expect(alignOffset("left", 100, 40)).toBe(0);
    expect(alignOffset("center", 100, 40)).toBe(30);
    expect(alignOffset("right", 100, 40)).toBe(60);
  });
});
