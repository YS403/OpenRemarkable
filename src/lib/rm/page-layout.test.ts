import { describe, expect, it } from "vitest";

import { PAGE_BOTTOM_MARGIN, PT_PER_PX } from "./constants";
import { framePage } from "./page-layout";
import type { Bounds, RenderPage } from "./types";

const page = (contentBounds: Bounds | null): RenderPage => ({
  strokes: [],
  text: [],
  highlights: [],
  contentBounds,
  paperSize: { width: 1404, height: 1872 },
});

describe("page frame", () => {
  it("keeps the paper size when content fits", () => {
    expect(framePage(page({ minX: -600, maxX: 600, minY: 10, maxY: 1800 }))).toEqual({
      width: 1404,
      height: 1872,
      offsetX: 702,
      offsetY: 0,
    });
  });

  it("tolerates small overflow past the side edges (measured up to 729 px)", () => {
    expect(framePage(page({ minX: -729, maxX: 0, minY: 0, maxY: 100 })).width).toBe(1404);
  });

  it("widens to the paper's long side when content spills well past the sides", () => {
    const frame = framePage(page({ minX: -500, maxX: 795, minY: 0, maxY: 100 }));
    expect(frame.width).toBe(1872);
    expect(frame.offsetX).toBe(936);
  });

  it("grows downward to fit content, in whole points", () => {
    const frame = framePage(page({ minX: 0, maxX: 0, minY: 0, maxY: 3000 }));
    expect(frame.height).toBeGreaterThanOrEqual(3000 + PAGE_BOTTOM_MARGIN);
    expect(Number.isInteger(Math.round(frame.height * PT_PER_PX * 1e6) / 1e6)).toBe(true);
  });

  it("handles empty pages", () => {
    expect(framePage(page(null))).toMatchObject({ width: 1404, height: 1872 });
  });
});
