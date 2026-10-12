/**
 * Renderer data model, independent of how pages were fetched or parsed.
 *
 * Coordinates are in reMarkable scene pixels (227 per inch): x is measured
 * from the horizontal centre of the page, y from the top, y pointing down.
 */

export interface Rgba {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  /** stroke width at this point, in pixels */
  width: number;
  /** 0–1 */
  pressure: number;
  /** pen speed in the units the pen formulas expect (raw value × 0.25) */
  speed: number;
}

export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";
export type BlendMode = "Normal" | "Darken";

/**
 * How a stroke is turned into vector geometry.
 *
 * - `polyline`: the app's "direct line" export path; one constant-width line
 *   through the raw points.
 * - `ribbon`: a filled outline following the per-point width; stands in for
 *   the app's rasterise-then-trace export path.
 * - `area`: a filled polygon through the points (area eraser).
 * - `grain`: pencil texture, rasterised and embedded as an image mask.
 */
export type StrokeGeometry =
  | { kind: "polyline"; width: number; cap: LineCap; join: LineJoin }
  | { kind: "ribbon"; widthScale: number; widthPadding: number }
  | { kind: "area" }
  | { kind: "grain" };

export interface StrokeStyle {
  geometry: StrokeGeometry;
  color: Rgba;
  blend: BlendMode;
}

export interface RenderStroke {
  /** reMarkable tool code */
  tool: number;
  points: StrokePoint[];
  style: StrokeStyle;
}

export interface TextLine {
  text: string;
  /** left edge, scene pixels */
  x: number;
  /** baseline, scene pixels */
  baseline: number;
  fontSize: number;
}

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Rgba;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** One page, ready to lay out and draw. */
export interface RenderPage {
  strokes: RenderStroke[];
  text: TextLine[];
  highlights: HighlightRect[];
  /** extents of stroke centrelines, used for page sizing; null if empty */
  contentBounds: Bounds | null;
  /** the page's base size, from the file or the device default */
  paperSize: { width: number; height: number };
}

/** Diagnostics collected while converting, surfaced to callers and logs. */
export interface RenderWarning {
  page?: number;
  code: "approximate_text_layout" | "unencodable_text" | "unknown_tool" | "unknown_color" | "template_not_rendered"
    | "annotations_skipped";
  message: string;
}
