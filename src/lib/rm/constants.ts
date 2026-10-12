/**
 * Constants recovered from the reMarkable desktop app (Windows build, see
 * the private rendering notes). Addresses refer to reMarkable.exe as analysed.
 */

/** Scene pixels per inch; the PDF exporter uses QPdfWriter::setResolution(227). */
export const SCENE_DPI = 227;
/** PDF points per scene pixel. */
export const PT_PER_PX = 72 / SCENE_DPI;

/** Default page for reMarkable 1/2 and Paper Pure, portrait. */
export const DEFAULT_PAPER = { width: 1404, height: 1872 } as const;
/**
 * How far content may reach past the paper's side edge before the page is
 * widened. Measured: the app keeps the paper width for content reaching 729 px
 * from the centre (paper half-width 702) and widens from 795 px.
 */
export const WIDE_PAGE_OVERFLOW = 60;
/** Space kept below the lowest content when a page grows downward (measured). */
export const PAGE_BOTTOM_MARGIN = 52;

/** Stored point widths are in quarter pixels (DAT_1412490b0 = 0.25). */
export const WIDTH_UNIT = 0.25;
/** Stored speeds are scaled by the same factor before use. */
export const SPEED_UNIT = 0.25;
/** Extra width added by the anti-aliased raster pens on screen (DAT_141475d58). */
export const AA_WIDTH_PADDING = 0.75;

/**
 * Effective width of raster pens in the app's PDF export, as a fraction of the
 * stored width. Rasterising (marker alpha, ballpoint ink threshold) and tracing
 * thin the strokes. Measured from ink area against desktop-app exports of
 * notebooks (21 marker pages, 15 ballpoint pages; total ink within a few
 * percent). Pens without enough data keep the stored width.
 */
export const EXPORT_WIDTH_SCALE = {
  marker: 0.75,
  ballpoint: 0.96,
  default: 1,
} as const;

/** Template name for pages without a background. */
export const BLANK_TEMPLATE = "Blank";

/**
 * Text-anchored strokes sit on the line of their anchor character:
 * y = text.posY + ANCHOR_LINE_OFFSET + lineIndex * PLAIN_LINE_HEIGHT.
 * Both values fit 1,428 of 1,430 measured strokes to within 0.0005 px.
 */
export const ANCHOR_LINE_OFFSET = 4099 / 64;
export const PLAIN_LINE_HEIGHT = 4451 / 64;

/** CRDT id used as an anchor for "end of the text". */
export const END_OF_TEXT_ANCHOR = { authorId: 0, counter: 281474976710655 } as const;
