import type { RmPage } from "rmapi-js";

import { BLANK_TEMPLATE, DEFAULT_PAPER, PT_PER_PX } from "./constants";
import { dedupe, ribbonShapes, type Vec } from "./geometry";
import { framePage } from "./page-layout";
import { PdfBuilder, type PageCanvas } from "./pdf-writer";
import { toRenderPage } from "./scene";
import { packImageMask, rasterizePencil } from "./pencil-raster";
import type { RenderPage, RenderStroke, RenderWarning, Rgba } from "./types";

/**
 * Bump when output changes for the same input, so cached PDFs from older
 * renderer versions are not served.
 */
export const RENDERER_VERSION = 10;

export interface RenderOptions {
  title?: string;
}

export interface RenderResult {
  pdf: Uint8Array;
  pageCount: number;
  warnings: RenderWarning[];
}

const TEXT_COLOR: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const BLANK_PAGE: RenderPage = {
  strokes: [],
  text: [],
  highlights: [],
  contentBounds: null,
  paperSize: { ...DEFAULT_PAPER },
};

export interface NotebookPageInput {
  /** the parsed lines file; null for a page that has none yet (blank) */
  scene: RmPage | null;
  /** background template name from the document's content file */
  template?: string;
}

/** Render notebook pages, in order, to a vector PDF. */
export async function renderNotebookPdf(
  pages: readonly NotebookPageInput[],
  options: RenderOptions = {},
): Promise<RenderResult> {
  const builder = await PdfBuilder.create(options.title);
  const warnings: RenderWarning[] = [];
  const measure = (text: string, size: number) => builder.measure(text, size);

  const renderPages = pages.map(({ scene, template }, index) => {
    const page = index + 1;
    if (template && template !== BLANK_TEMPLATE) {
      warnings.push({ page, code: "template_not_rendered", message: `Background template "${template}" is not drawn.` });
    }
    return scene ? toRenderPage(scene, measure, (w) => warnings.push({ ...w, page })) : BLANK_PAGE;
  });
  // A PDF needs at least one page.
  if (renderPages.length === 0) renderPages.push(BLANK_PAGE);

  renderPages.forEach((page, index) => drawPage(builder, page, index + 1, warnings));

  return { pdf: await builder.save(), pageCount: renderPages.length, warnings };
}

function drawPage(builder: PdfBuilder, page: RenderPage, pageNumber: number, warnings: RenderWarning[]): void {
  const frame = framePage(page);
  const canvas = builder.addPage(frame.width, frame.height, PT_PER_PX);
  drawScene(builder, canvas, page, { x: frame.offsetX, y: frame.offsetY }, pageNumber, warnings);
  canvas.finish();
}

/**
 * Draw a page's highlights, strokes and typed text onto a canvas. `offset`
 * moves scene coordinates into the canvas's coordinate space; the canvas's
 * own transform takes it from there to PDF points.
 */
export function drawScene(
  builder: PdfBuilder,
  canvas: PageCanvas,
  page: RenderPage,
  offset: Vec,
  pageNumber: number,
  warnings: RenderWarning[],
): void {
  // Text highlights sit under the ink.
  for (const h of page.highlights) {
    const corners = [
      { x: h.x, y: h.y },
      { x: h.x + h.width, y: h.y },
      { x: h.x + h.width, y: h.y + h.height },
      { x: h.x, y: h.y + h.height },
    ];
    canvas.fillShapes([{ kind: "polygon", points: corners }], h.color, "Darken", offset);
  }

  // Pencil strokes share one paper grain, so each pencil color becomes a single
  // image mask, drawn where its first stroke falls in the drawing order.
  const pencilGroups = new Map<string, RenderStroke[]>();
  for (const stroke of page.strokes) {
    if (stroke.style.geometry.kind !== "grain") continue;
    const key = colorKey(stroke.style.color);
    const group = pencilGroups.get(key);
    if (group) group.push(stroke);
    else pencilGroups.set(key, [stroke]);
  }

  for (const stroke of page.strokes) {
    const { geometry, color, blend } = stroke.style;
    switch (geometry.kind) {
      case "grain": {
        const key = colorKey(color);
        const group = pencilGroups.get(key);
        if (!group) break; // already drawn with its group
        pencilGroups.delete(key);
        drawPencilGroup(canvas, group, color, offset);
        break;
      }
      case "polyline":
        canvas.strokePolyline(dedupe(stroke.points), geometry.width, geometry.cap, geometry.join, color, blend, offset);
        break;
      case "ribbon":
        canvas.fillShapes(ribbonShapes(stroke.points, geometry.widthScale, geometry.widthPadding), color, blend, offset);
        break;
      case "area": {
        const points = dedupe(stroke.points);
        if (points.length >= 3) canvas.fillShapes([{ kind: "polygon", points }], color, blend, offset);
        break;
      }
    }
  }

  let replaced = false;
  for (const line of page.text) {
    const safe = builder.sanitize(line.text);
    replaced ||= safe.replaced;
    canvas.text(safe.text, line.x + offset.x, line.baseline + offset.y, line.fontSize, TEXT_COLOR);
  }
  if (replaced) {
    warnings.push({ page: pageNumber, code: "unencodable_text", message: "Some typed characters could not be embedded and were replaced with '?'." });
  }
}

/** Rasterise a pencil group over just its own bounding box (one scene pixel per mask pixel). */
function drawPencilGroup(canvas: PageCanvas, group: RenderStroke[], color: Rgba, offset: Vec): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of group) {
    for (const p of stroke.points) {
      const r = p.width / 2 + 1;
      minX = Math.min(minX, p.x - r);
      minY = Math.min(minY, p.y - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    }
  }
  if (minX === Infinity) return;
  const x0 = Math.floor(minX);
  const y0 = Math.floor(minY);
  const mask = rasterizePencil(
    group.map((s) => s.points),
    maxX - x0,
    maxY - y0,
    { x: -x0, y: -y0 },
  );
  canvas.imageMask(packImageMask(mask), mask.width, mask.height, color, { x: x0 + offset.x, y: y0 + offset.y });
}

const colorKey = (c: Rgba) => `${c.r},${c.g},${c.b},${c.a}`;
