import type { StrokePoint } from "./types";

export interface Vec {
  x: number;
  y: number;
}

/**
 * A closed shape. All shapes produced here share one orientation (positive
 * signed area in y-down coordinates), so filling them together with the
 * nonzero rule yields their union with no gaps or holes.
 */
export type Shape =
  | { kind: "polygon"; points: Vec[] }
  | { kind: "circle"; center: Vec; radius: number }
  /** pie slice from angle `start` sweeping `sweep` radians (0 < sweep ≤ 2π), angles of (cos, sin) */
  | { kind: "sector"; center: Vec; radius: number; start: number; sweep: number };

const angleOf = (v: Vec) => Math.atan2(v.y, v.x);

/** Pie slice between two directions, taking the shorter way round. */
function sectorBetween(center: Vec, radius: number, from: Vec, to: Vec): Shape {
  const a = angleOf(from);
  let sweep = angleOf(to) - a;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  // keep positive orientation: always sweep forward from the earlier angle
  return sweep >= 0
    ? { kind: "sector", center, radius, start: a, sweep }
    : { kind: "sector", center, radius, start: a + sweep, sweep: -sweep };
}

/** Maximum deviation allowed when simplifying a centreline, in pixels (invisible at 227 DPI). */
const POSITION_TOLERANCE = 0.15;
/** Maximum width deviation allowed when simplifying, in pixels. */
const WIDTH_TOLERANCE = 0.25;
/**
 * Bends sharper than this end an outline run and get a round join. Below it a
 * miter overshoots the true round join by at most h·(1/cos(30°) − 1) ≈ 0.15·h.
 */
const MAX_MITER_TURN = Math.PI / 3;

/** Drop consecutive points at the same position. */
export function dedupe<T extends Vec>(points: readonly T[]): T[] {
  const out: T[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function signedArea(points: readonly Vec[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Ramer–Douglas–Peucker over position and width: keep a point only if
 * dropping it would move the line or change the width noticeably.
 * Iterative, so long strokes cannot overflow the stack.
 */
export function simplify(points: readonly StrokePoint[]): StrokePoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstScore = 1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const dist = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      const widthError = Math.abs(p.width - (a.width + t * (b.width - a.width)));
      const score = Math.max(dist / POSITION_TOLERANCE, widthError / WIDTH_TOLERANCE);
      if (score > worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Outline a variable-width stroke following the app's tessellation
 * (FUN_140bd0ad0): the edge sits ±w/2 from the centreline with width
 * interpolated between points, round caps at both ends, round joins on sharp
 * bends.
 *
 * Smooth stretches become one polygon each (mitered offsets). A run ends where
 * the inner edge could fold back, which would punch a hole under the nonzero
 * rule; a round join covers the break.
 */
export function ribbonShapes(points: readonly StrokePoint[], widthScale = 1, widthPadding = 0): Shape[] {
  const pts = simplify(dedupe(points));
  const half = (p: StrokePoint) => Math.max(0, (p.width * widthScale + widthPadding) / 2);
  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ kind: "circle", center: pts[0], radius: half(pts[0]) }];

  const segments = pts.length - 1;
  const normals: Vec[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(len);
    normals.push({ x: (a.y - b.y) / len, y: (b.x - a.x) / len });
  }

  const shapes: Shape[] = [];
  let left: Vec[] = [];
  let right: Vec[] = [];
  const offsetBy = (p: StrokePoint, n: Vec, h: number) => {
    left.push({ x: p.x + n.x * h, y: p.y + n.y * h });
    right.push({ x: p.x - n.x * h, y: p.y - n.y * h });
  };
  const closeRun = () => {
    const outline = [...left, ...right.reverse()];
    shapes.push({ kind: "polygon", points: signedArea(outline) < 0 ? outline.reverse() : outline });
    left = [];
    right = [];
  };

  offsetBy(pts[0], normals[0], half(pts[0]));
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const h = half(p);
    const n0 = normals[i - 1];
    const n1 = normals[i];
    const turn = Math.abs(Math.atan2(n0.x * n1.y - n0.y * n1.x, n0.x * n1.x + n0.y * n1.y));
    // the mitered inner corner reaches h·tan(turn/2) along each neighbouring segment
    const reach = h * Math.tan(turn / 2);
    if (turn <= MAX_MITER_TURN && reach < lengths[i - 1] && reach < lengths[i]) {
      const bx = n0.x + n1.x;
      const by = n0.y + n1.y;
      const bl = Math.hypot(bx, by);
      const miter = h / ((bx / bl) * n1.x + (by / bl) * n1.y);
      offsetBy(p, { x: bx / bl, y: by / bl }, miter);
    } else {
      offsetBy(p, n0, h);
      closeRun();
      // Round only the outer side; the segments already cover the inner one.
      // Normals rotating positively means the + side is the inner side.
      const outerSign = n0.x * n1.y - n0.y * n1.x > 0 ? -1 : 1;
      shapes.push(
        sectorBetween(p, h, { x: n0.x * outerSign, y: n0.y * outerSign }, { x: n1.x * outerSign, y: n1.y * outerSign }),
      );
      offsetBy(p, n1, h);
    }
  }
  const end = pts[pts.length - 1];
  const nEnd = normals[segments - 1];
  offsetBy(end, nEnd, half(end));
  closeRun();

  // Round caps: half discs behind the start and ahead of the end.
  const n0 = normals[0];
  shapes.push({ kind: "sector", center: pts[0], radius: half(pts[0]), start: angleOf(n0), sweep: Math.PI });
  shapes.push({ kind: "sector", center: end, radius: half(end), start: angleOf({ x: -nEnd.x, y: -nEnd.y }), sweep: Math.PI });
  return shapes;
}
