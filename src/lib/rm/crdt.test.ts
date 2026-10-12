import { describe, expect, it } from "vitest";

import { orderCharacters, splitIntoCharacters, type SequenceItem } from "./crdt";

const id = (authorId: number, counter: number) => ({ authorId, counter });
const ZERO = id(0, 0);

function text(items: SequenceItem<string | number>[]): string {
  return orderCharacters(splitIntoCharacters(items))
    .map((c) => c.char ?? "")
    .join("");
}

describe("CRDT text ordering", () => {
  it("orders items by their left/right links", () => {
    const items: SequenceItem<string>[] = [
      { itemId: id(1, 10), leftId: id(1, 5), rightId: ZERO, deletedLength: 0, value: "world" },
      { itemId: id(1, 1), leftId: ZERO, rightId: ZERO, deletedLength: 0, value: "hello" },
      { itemId: id(1, 6), leftId: id(1, 5), rightId: id(1, 10), deletedLength: 0, value: " " },
    ];
    expect(text(items)).toBe("hello world");
  });

  it("handles insertions that point inside a multi-character item", () => {
    // "abc" typed first, then "X" inserted between "a" (1:1) and "b" (1:2)
    const items: SequenceItem<string>[] = [
      { itemId: id(1, 1), leftId: ZERO, rightId: ZERO, deletedLength: 0, value: "abc" },
      { itemId: id(2, 1), leftId: id(1, 1), rightId: id(1, 2), deletedLength: 0, value: "X" },
    ];
    expect(text(items)).toBe("aXbc");
  });

  it("keeps deleted characters as positions without text", () => {
    const items: SequenceItem<string>[] = [
      { itemId: id(1, 1), leftId: ZERO, rightId: ZERO, deletedLength: 0, value: "ab" },
      { itemId: id(1, 3), leftId: id(1, 2), rightId: ZERO, deletedLength: 2, value: undefined },
      { itemId: id(1, 5), leftId: id(1, 4), rightId: ZERO, deletedLength: 0, value: "c" },
    ];
    const ordered = orderCharacters(splitIntoCharacters(items));
    expect(ordered.map((c) => c.key)).toEqual(["1:1", "1:2", "1:3", "1:4", "1:5"]);
    expect(text(items)).toBe("abc");
  });

  it("ignores formatting markers", () => {
    const items: SequenceItem<string | number>[] = [
      { itemId: id(1, 1), leftId: ZERO, rightId: ZERO, deletedLength: 0, value: "a" },
      { itemId: id(1, 2), leftId: id(1, 1), rightId: ZERO, deletedLength: 0, value: 1 },
    ];
    expect(text(items)).toBe("a");
  });
});
