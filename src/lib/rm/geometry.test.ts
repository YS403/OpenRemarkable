import { describe, expect, it } from "vitest";

import { dedupe, ribbonShapes, type Shape, signedArea, simplify, type Vec } from "./geometry";
import type { StrokePoint } from "./types";

const pt = (x: number, y: number, width = 10): StrokePoint => ({ x, y, width, pressure: 0.5, speed: 0 });

/** Polygon approximation of a shape, for winding tests. */
function outline(shape: Shape): Vec[] {
  if (shape.kind === "polygon") return shape.points;
  const [start, sweep] = shape.kind === "circle" ? [0, 2 * Math.PI] : [shape.start, shape.sweep];
  const steps = 64;
  const arc = Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + (sweep * i) / steps;
    return { x: shape.center.x + shape.radius * Math.cos(a), y: shape.center.y + shape.radius * Math.sin(a) };
  });
  return shape.kind === "circle" ? arc : [shape.center, ...arc];
}

function winding(points: Vec[], p: Vec): number {
  let w = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y && b.y > p.y && cross > 0) w++;
    else if (a.y > p.y && b.y <= p.y && cross < 0) w--;
  }
  return w;
}

/** Nonzero-rule coverage of the union of all shapes, as a PDF viewer fills them. */
const covered = (shapes: Shape[], p: Vec) => shapes.reduce((sum, s) => sum + winding(outline(s), p), 0) !== 0;

function distanceToPolyline(points: Vec[], p: Vec): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Every point clearly inside the stroke is filled; nothing far outside is. */
function expectExactUnion(points: StrokePoint[], half: number) {
  const shapes = ribbonShapes(points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  for (let x = Math.min(...xs) - half - 2; x <= Math.max(...xs) + half + 2; x += 0.7) {
    for (let y = Math.min(...ys) - half - 2; y <= Math.max(...ys) + half + 2; y += 0.7) {
      const d = distanceToPolyline(points, { x, y });
      if (d < half - 0.3) expect(covered(shapes, { x, y }), `hole at ${x},${y}`).toBe(true);
      // miters may overshoot a round join by up to 0.155·h
      if (d > half * 1.16 + 0.3) expect(covered(shapes, { x, y }), `spill at ${x},${y}`).toBe(false);
    }
  }
}

describe("ribbon geometry", () => {
  it("gives every shape the same (positive) orientation", () => {
    const shapes = ribbonShapes([pt(0, 0), pt(40, 5), pt(60, 40), pt(20, 60), pt(25, 20)]);
    for (const shape of shapes) {
      if (shape.kind === "polygon") expect(signedArea(shape.points)).toBeGreaterThan(0);
      if (shape.kind === "sector") expect(shape.sweep).toBeGreaterThan(0);
    }
  });

  it("covers a sharp corner with a round join on the outside", () => {
    expectExactUnion([pt(0, 0), pt(100, 0), pt(100, 100)], 5);
  });

  it("has no holes on a tight zigzag of short, wide segments", () => {
    const zigzag = Array.from({ length: 30 }, (_, i) => pt(i * 2, (i % 2) * 3, 12));
    expectExactUnion(zigzag, 6);
  });

  it("fills a self-crossing loop", () => {
    const loop = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * 2.2 * Math.PI;
      return pt(30 * Math.cos(a) + i * 0.5, 30 * Math.sin(a), 8);
    });
    expectExactUnion(loop, 4);
  });

  it("draws a single point as a dot", () => {
    expect(ribbonShapes([pt(5, 5, 6)])).toEqual([{ kind: "circle", center: pt(5, 5, 6), radius: 3 }]);
  });

  it("applies the width scale", () => {
    const [shape] = ribbonShapes([pt(5, 5, 10)], 0.5);
    expect(shape).toMatchObject({ kind: "circle", radius: 2.5 });
  });
});

describe("point reduction", () => {
  it("drops duplicates and near-collinear points but keeps the ends", () => {
    const line = Array.from({ length: 101 }, (_, i) => pt(i, 0.01 * Math.sin(i)));
    const simplified = simplify(dedupe([line[0], ...line]));
    expect(simplified[0]).toBe(line[0]);
    expect(simplified.at(-1)).toBe(line.at(-1));
    expect(simplified.length).toBe(2);
  });

  it("keeps points where the width changes", () => {
    const line = [pt(0, 0, 4), pt(10, 0, 12), pt(20, 0, 4)];
    expect(simplify(line)).toHaveLength(3);
  });
});
