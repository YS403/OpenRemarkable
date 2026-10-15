import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPosition, locationSearch, positionFromScroll, readLocation, savePosition, scrollFromPosition } from "./notebook-location";

const ROOT = "";

describe("open document in the address", () => {
  it("reads the document and folder", () => {
    expect(readLocation("?doc=abc&folder=f1")).toEqual({ doc: "abc", folder: "f1" });
    expect(readLocation("")).toEqual({ doc: null, folder: null });
    expect(readLocation("?doc=")).toEqual({ doc: null, folder: null });
  });

  it("writes them, keeping other parameters and leaving out the root folder", () => {
    expect(locationSearch("?demo=1", { doc: "abc", folder: "f1" }, ROOT)).toBe("?demo=1&doc=abc&folder=f1");
    expect(locationSearch("?doc=abc&folder=f1", { doc: null, folder: ROOT }, ROOT)).toBe("");
    expect(locationSearch("", { doc: "a b", folder: null }, ROOT)).toBe("?doc=a+b");
  });

  it("round-trips", () => {
    const location = { doc: "8f2c-1", folder: "folder-9" };
    expect(readLocation(locationSearch("", location, ROOT))).toEqual(location);
  });
});

describe("reading position", () => {
  // three pages of 1000px with 16px gaps: tops at 16, 1032, 2048
  const heights = [1000, 1000, 1000];
  const GAP = 16;

  it("finds the page and how far down it the view starts", () => {
    expect(positionFromScroll(0, heights, GAP)).toEqual({ page: 0, offset: 0 });
    expect(positionFromScroll(1032, heights, GAP)).toEqual({ page: 1, offset: 0 });
    expect(positionFromScroll(1532, heights, GAP)).toEqual({ page: 1, offset: 0.5 });
    expect(positionFromScroll(99999, heights, GAP)).toEqual({ page: 2, offset: 1 });
  });

  it("scrolls back to the same spot", () => {
    for (const top of [0, 500, 1032, 1532, 2048, 2500]) {
      expect(scrollFromPosition(positionFromScroll(top, heights, GAP), heights, GAP)).toBeCloseTo(top, 5);
    }
  });

  it("keeps the same page when the window is resized (pages scaled)", () => {
    const position = positionFromScroll(1532, heights, GAP); // half-way down page 2
    const smaller = heights.map((h) => h * 0.6);
    expect(scrollFromPosition(position, smaller, GAP)).toBeCloseTo(GAP + 600 + GAP + 300, 5);
  });

  it("clamps to the last page when the document now has fewer pages", () => {
    expect(scrollFromPosition({ page: 7, offset: 0.25 }, heights, GAP)).toBeCloseTo(2048 + 250, 5);
    expect(scrollFromPosition({ page: 1, offset: 0 }, [], GAP)).toBe(0);
  });
});

describe("stored position", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is kept per document", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    savePosition("a", { page: 3, offset: 0.12345 });
    expect(loadPosition("a")).toEqual({ page: 3, offset: 0.123 });
    expect(loadPosition("b")).toBeNull();
  });

  it("works without storage", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => savePosition("a", { page: 1, offset: 0 })).not.toThrow();
    expect(loadPosition("a")).toBeNull();
  });
});
