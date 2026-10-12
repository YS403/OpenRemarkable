/**
 * Editable layer over a notebook. Shared by the browser editor and the server
 * exporter; validated with zod wherever it crosses a trust boundary.
 *
 * Coordinates are PDF points on the rendered page, origin top-left, y down.
 * Rotation is in degrees, clockwise, around the element's (x, y) corner, which
 * matches Konva's default.
 */
import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1;

const finite = z.number().finite();
const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Colors are #rrggbb.");

const base = {
  id: z.string().min(1).max(64),
  x: finite,
  y: finite,
  rotation: finite.default(0),
  opacity: z.number().min(0).max(1).default(1),
};

export const textElementSchema = z.object({
  ...base,
  type: z.literal("text"),
  width: z.number().positive().max(20_000),
  text: z.string().max(20_000),
  fontFamily: z.literal("Inter"),
  fontSize: z.number().min(2).max(500),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  color,
  align: z.enum(["left", "center", "right"]).default("left"),
  lineHeight: z.number().min(0.5).max(4).default(1.25),
  /** wrapped lines as laid out by the editor; the exporter uses them verbatim */
  lines: z.array(z.string().max(20_000)).max(5_000).optional(),
});

const shapeStyle = {
  fill: color.nullable(),
  stroke: color.nullable(),
  strokeWidth: z.number().min(0).max(200),
};

export const rectElementSchema = z.object({
  ...base,
  ...shapeStyle,
  type: z.literal("rect"),
  width: z.number().nonnegative().max(20_000),
  height: z.number().nonnegative().max(20_000),
  cornerRadius: z.number().min(0).max(10_000).default(0),
});

export const ellipseElementSchema = z.object({
  ...base,
  ...shapeStyle,
  type: z.literal("ellipse"),
  width: z.number().nonnegative().max(20_000),
  height: z.number().nonnegative().max(20_000),
});

export const lineElementSchema = z.object({
  ...base,
  type: z.literal("line"),
  /** end point relative to (x, y) */
  dx: finite,
  dy: finite,
  stroke: color,
  strokeWidth: z.number().min(0.1).max(200),
  arrowStart: z.boolean().default(false),
  arrowEnd: z.boolean().default(false),
});

export const elementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  rectElementSchema,
  ellipseElementSchema,
  lineElementSchema,
]);

export const projectSchema = z.object({
  version: z.literal(PROJECT_SCHEMA_VERSION),
  notebookId: z.string().uuid(),
  /** notebook version the edits were last made against */
  notebookHash: z.string().min(1).max(128),
  /** elements per notebook page id, in paint order (last on top) */
  pages: z.record(z.string().min(1).max(64), z.array(elementSchema).max(2_000)),
  updatedAt: z.string(),
});

export type TextElement = z.infer<typeof textElementSchema>;
export type RectElement = z.infer<typeof rectElementSchema>;
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type Element = z.infer<typeof elementSchema>;
export type ElementType = Element["type"];
export type Project = z.infer<typeof projectSchema>;

/** A notebook page as the editor and exporter see it, in PDF order. */
export interface PageInfo {
  id: string;
  index: number;
}

export function emptyProject(notebookId: string, notebookHash: string): Project {
  return { version: PROJECT_SCHEMA_VERSION, notebookId, notebookHash, pages: {}, updatedAt: new Date().toISOString() };
}
