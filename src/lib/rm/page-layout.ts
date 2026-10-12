import { PAGE_BOTTOM_MARGIN, PT_PER_PX, WIDE_PAGE_OVERFLOW } from "./constants";
import type { RenderPage } from "./types";

/** Where a page sits on the output sheet, in scene pixels. */
export interface PageFrame {
  width: number;
  height: number;
  /** added to scene x to get sheet x (scene x is centred) */
  offsetX: number;
  /** added to scene y to get sheet y */
  offsetY: number;
}

/**
 * Size the output page as the app does for notebooks: start from the paper
 * size; switch to the wide width (the paper's long side) when content spills
 * well past the sides; extend downward to fit content. Widths match the app
 * on all 68 measured pages; heights match within a few points. Growing upward for
 * content above the page is not observed in the app and is a best effort.
 */
export function framePage(page: RenderPage): PageFrame {
  const { width: paperWidth, height: paperHeight } = page.paperSize;
  const bounds = page.contentBounds;

  let minY = bounds?.minY ?? 0;
  let maxY = bounds?.maxY ?? 0;
  for (const line of page.text) {
    minY = Math.min(minY, line.baseline - line.fontSize);
    maxY = Math.max(maxY, line.baseline);
  }

  const reach = paperWidth / 2 + WIDE_PAGE_OVERFLOW;
  const spillsSideways = bounds !== null && (bounds.minX < -reach || bounds.maxX > reach);
  const width = spillsSideways ? Math.max(paperWidth, paperHeight) : paperWidth;

  const top = minY < 0 ? Math.ceil(-minY + PAGE_BOTTOM_MARGIN) : 0;
  const contentHeight = maxY + top + PAGE_BOTTOM_MARGIN;
  const rawHeight = Math.max(paperHeight + top, contentHeight);
  // the app emits whole-point page heights
  const height = rawHeight > paperHeight ? Math.ceil(rawHeight * PT_PER_PX) / PT_PER_PX : paperHeight;

  return { width, height, offsetX: width / 2, offsetY: top };
}
