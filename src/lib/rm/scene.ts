import type { RmPage, RmSceneLayer, RmScene, RmPageV5 } from "rmapi-js";

import { DEFAULT_PAPER, SPEED_UNIT, WIDTH_UNIT } from "./constants";
import type { CrdtIdLike } from "./crdt";
import { argb, resolveColor } from "./palette";
import { isKnownTool, resolveStrokeStyle, Tool } from "./pens";
import { layoutText, type MeasureText } from "./text-layout";
import type { Bounds, HighlightRect, RenderPage, RenderStroke, RenderWarning, StrokePoint } from "./types";

const ERASERS = new Set<number>([Tool.Eraser, Tool.EraseArea]);

interface Anchor {
  id: CrdtIdLike;
  originX: number;
}

/** Convert a parsed page (v6 scene or legacy v5) into the renderer model. */
export function toRenderPage(
  page: RmPage,
  measure: MeasureText,
  warn: (warning: Omit<RenderWarning, "page">) => void,
): RenderPage {
  return page.version === 6 ? fromV6(page, measure, warn) : fromV5(page, warn);
}

function fromV6(scene: RmScene, measure: MeasureText, warn: (w: Omit<RenderWarning, "page">) => void): RenderPage {
  const text = scene.text();
  const layout = layoutText(text, measure);
  if (layout.approximate) {
    warn({ code: "approximate_text_layout", message: "Typed text is laid out approximately; positions may differ slightly." });
  }

  // Group anchors live on the tree-node blocks, keyed by node id.
  const anchors = new Map<string, Anchor>();
  for (const block of scene.blocks) {
    if (block.type === "treeNode" && block.anchor) {
      anchors.set(key(block.nodeId), { id: block.anchor.id.value, originX: block.anchor.originX.value });
    }
  }

  const strokes: RenderStroke[] = [];
  const highlights: HighlightRect[] = [];
  const reported = new Set<string>();

  const walk = (layer: RmSceneLayer, dx: number, dy: number) => {
    if (layer.visible === false) return;
    const anchor = anchors.get(key(layer.id));
    if (anchor) {
      dx += anchor.originX;
      dy += layout.anchorY(anchor.id) ?? 0;
    }
    for (const item of layer.items) {
      if (item.kind === "layer") {
        walk(item.layer, dx, dy);
      } else if (item.kind === "line") {
        const { line } = item;
        const points: StrokePoint[] = line.points.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
          width: p.width * WIDTH_UNIT,
          pressure: p.pressure / 255,
          speed: p.speed * SPEED_UNIT,
        }));
        const stroke = buildStroke(line.tool, line.color, line.colorRgba, points, warn, reported);
        if (stroke) strokes.push(stroke);
      } else {
        const { glyph } = item;
        const color = glyph.colorRgba !== undefined ? argb(glyph.colorRgba) : resolveColor(glyph.color, undefined).color;
        for (const r of glyph.rectangles) highlights.push({ x: r.x + dx, y: r.y + dy, width: r.w, height: r.h, color });
      }
    }
  };
  for (const layer of scene.layers()) walk(layer, 0, 0);

  const [width, height] = scene.paperSize ?? [DEFAULT_PAPER.width, DEFAULT_PAPER.height];
  return {
    strokes,
    text: layout.lines,
    highlights,
    contentBounds: boundsOf(strokes),
    paperSize: { width, height },
  };
}

function fromV5(page: RmPageV5, warn: (w: Omit<RenderWarning, "page">) => void): RenderPage {
  // v5 coordinates start at the page's top-left and widths are already pixels.
  const half = DEFAULT_PAPER.width / 2;
  const strokes: RenderStroke[] = [];
  const reported = new Set<string>();
  for (const layer of page.layers) {
    for (const line of layer.lines) {
      const points: StrokePoint[] = line.points.map((p) => ({
        x: p.x - half,
        y: p.y,
        width: p.width,
        pressure: p.pressure,
        speed: p.speed,
      }));
      const stroke = buildStroke(line.brushType, line.color, undefined, points, warn, reported);
      if (stroke) strokes.push(stroke);
    }
  }
  return {
    strokes,
    text: [],
    highlights: [],
    contentBounds: boundsOf(strokes),
    paperSize: { ...DEFAULT_PAPER },
  };
}

function buildStroke(
  tool: number,
  colorCode: number,
  colorArgb: number | undefined,
  points: StrokePoint[],
  warn: (w: Omit<RenderWarning, "page">) => void,
  reported: Set<string>,
): RenderStroke | null {
  if (points.length === 0) return null;
  if (!isKnownTool(tool) && !reported.has(`tool:${tool}`)) {
    reported.add(`tool:${tool}`);
    warn({ code: "unknown_tool", message: `Unknown pen ${tool}; drawn as a solid stroke.` });
  }
  const { style, knownColor } = resolveStrokeStyle(tool, colorCode, colorArgb, points);
  if (!knownColor && !reported.has(`color:${colorCode}`)) {
    reported.add(`color:${colorCode}`);
    warn({ code: "unknown_color", message: `Unknown color ${colorCode}; drawn in black.` });
  }
  return { tool, points, style };
}

/** Extents of drawn (non-eraser) stroke centrelines. */
export function boundsOf(strokes: readonly RenderStroke[]): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    if (ERASERS.has(stroke.tool)) continue;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX === Infinity ? null : { minX, maxX, minY, maxY };
}

const key = (id: CrdtIdLike) => `${id.authorId}:${id.counter}`;
