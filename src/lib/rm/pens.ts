import { EXPORT_WIDTH_SCALE } from "./constants";
import { ColorCode, resolveColor, WHITE } from "./palette";
import type { Rgba, StrokeGeometry, StrokePoint, StrokeStyle } from "./types";

/** Tool codes stored in .rm files (Line::Tool in the app). */
export const Tool = {
  Brush: 0,
  Pencil: 1,
  Ballpoint: 2,
  Marker: 3,
  Fineliner: 4,
  Highlighter: 5,
  Eraser: 6,
  MechanicalPencil: 7,
  EraseArea: 8,
  BrushV2: 12,
  MechanicalPencilV2: 13,
  PencilV2: 14,
  BallpointV2: 15,
  MarkerV2: 16,
  FinelinerV2: 17,
  HighlighterV2: 18,
  Calligraphy: 21,
  Shader: 23,
} as const;

const KNOWN_TOOLS = new Set<number>(Object.values(Tool));

const smoothstep = (t: number) => (3 - 2 * t) * t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Shader opacity: 0.8 + 0.2·(1 − smoothstep((speed − 2) / 8)) (FUN_140b975a0). */
export function shaderOpacity(points: readonly StrokePoint[]): number {
  if (points.length === 0) return 1;
  let sum = 0;
  for (const p of points) sum += 0.8 + 0.2 * (1 - smoothstep(clamp01((p.speed - 2) / 8)));
  return sum / points.length;
}

/**
 * Ballpoint ink level 0–255 from pressure and speed (FUN_140b96d40). Harder
 * pressure darkens, faster strokes lighten. Kept for raster rendering; vector
 * export draws ballpoint solid, as the app's traced output is solid at the ink
 * levels real strokes reach.
 */
export function ballpointInk(point: StrokePoint): number {
  const P = point.pressure > 0.7 ? 1 : smoothstep(clamp01(point.pressure / 0.7));
  const S = smoothstep(clamp01((point.speed - 5) / 25));
  return (255 - 50 * S) * (0.5 + 0.5 * P);
}

/** Marker v2 alpha 0–1 from speed (FUN_140ba0c70); used by raster rendering. */
export function markerAlpha(point: StrokePoint): number {
  return 1 - 0.4 * smoothstep(clamp01((point.speed - 3) / 97));
}

function withAlpha(color: Rgba, factor: number): Rgba {
  return { ...color, a: clamp01(color.a * factor) };
}

export function isKnownTool(tool: number): boolean {
  return KNOWN_TOOLS.has(tool);
}

/**
 * Decide how a stroke is exported, following the desktop app's vectorizer
 * (FUN_140a551a0): fineliners and highlighters become constant-width
 * polylines; every other pen goes through the raster-and-trace path, which a
 * filled ribbon reproduces.
 */
export function resolveStrokeStyle(
  tool: number,
  colorCode: number,
  colorArgb: number | undefined,
  points: readonly StrokePoint[],
): { style: StrokeStyle; knownColor: boolean } {
  const { color, known } = resolveColor(colorCode, colorArgb);
  const firstWidth = points[0]?.width ?? 0;

  switch (tool) {
    case Tool.Fineliner:
    case Tool.FinelinerV2:
      return {
        style: { geometry: { kind: "polyline", width: firstWidth, cap: "round", join: "round" }, color, blend: "Normal" },
        knownColor: known,
      };

    case Tool.Highlighter:
    case Tool.HighlighterV2: {
      const cap = tool === Tool.Highlighter ? "square" : "butt";
      // The gray highlighter composes normally; the others darken (FUN_140bc7d50).
      const blend = colorCode === ColorCode.GrayOverlap ? "Normal" : "Darken";
      return {
        style: { geometry: { kind: "polyline", width: firstWidth, cap, join: "bevel" }, color, blend },
        knownColor: known,
      };
    }

    case Tool.Eraser:
      return { style: { geometry: ribbon(EXPORT_WIDTH_SCALE.default), color: WHITE, blend: "Normal" }, knownColor: true };

    case Tool.EraseArea:
      return { style: { geometry: { kind: "area" }, color: WHITE, blend: "Normal" }, knownColor: true };

    case Tool.Pencil:
    case Tool.PencilV2:
    case Tool.MechanicalPencil:
    case Tool.MechanicalPencilV2:
      // The app's PencilPipeline serves both pencils (FUN_140bc7d50).
      return { style: { geometry: { kind: "grain" }, color, blend: "Normal" }, knownColor: known };

    case Tool.Shader:
      return {
        style: {
          geometry: ribbon(EXPORT_WIDTH_SCALE.default),
          color: withAlpha(color, shaderOpacity(points)),
          blend: "Normal",
        },
        knownColor: known,
      };

    case Tool.Ballpoint:
    case Tool.BallpointV2:
      return { style: { geometry: ribbon(EXPORT_WIDTH_SCALE.ballpoint), color, blend: "Normal" }, knownColor: known };

    case Tool.Marker:
    case Tool.MarkerV2:
      return { style: { geometry: ribbon(EXPORT_WIDTH_SCALE.marker), color, blend: "Normal" }, knownColor: known };

    default:
      // Brush, calligraphy, and unknown future pens.
      return { style: { geometry: ribbon(EXPORT_WIDTH_SCALE.default), color, blend: "Normal" }, knownColor: known };
  }
}

/** A filled outline at the export width (no on-screen anti-aliasing padding). */
function ribbon(widthScale: number): StrokeGeometry {
  return { kind: "ribbon", widthScale, widthPadding: 0 };
}
