import { describe, expect, it } from "vitest";

import { keyBetween, keysBetween } from "./sort-key";

describe("sort keys", () => {
  it.each([
    [undefined, undefined],
    [undefined, "ba"],
    ["ba", "bb"],
    ["ba", undefined],
    ["bz", "c"],
    ["az", "b"],
    ["bab", "bac"],
    ["zz", undefined],
  ])("finds a key between %s and %s", (low, high) => {
    const key = keyBetween(low, high);
    if (low !== undefined) expect(key > low).toBe(true);
    if (high !== undefined) expect(key < high).toBe(true);
    expect(key).toMatch(/^[a-z]+$/);
  });

  it("refuses impossible gaps instead of looping", () => {
    expect(() => keyBetween("ba", "baa")).toThrow("No key");
    expect(() => keyBetween("bb", "ba")).toThrow("No key");
  });

  it("makes many ordered keys in a tight gap", () => {
    const keys = keysBetween("ba", "bb", 50);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(50);
    expect(keys.every((k) => k > "ba" && k < "bb")).toBe(true);
  });
});
