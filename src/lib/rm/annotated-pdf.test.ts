import { degrees, PDFDocument } from "pdf-lib";
import type { RmScene } from "rmapi-js";
import { describe, expect, it } from "vitest";

import { renderAnnotatedPdf, sceneToPdfMatrix } from "./annotated-pdf";
import { PT_PER_PX } from "./constants";
import { Tool } from "./pens";

function scene(points: [number, number][]): RmScene {
  const line = {
    tool: Tool.FinelinerV2,
    color: 0,
    thicknessScale: 1,
    startingLength: 0,
    points: points.map(([x, y]) => ({ x, y, speed: 4, width: 8, direction: 0, pressure: 128 })),
  };
  return {
    version: 6,
    blocks: [],
    authors: new Map(),
    paperSize: [1404, 1872],
    layers: () => [{ id: { authorId: 0, counter: 11 }, items: [{ kind: "line", line }] }],
    strokes: () => [line],
    text: () => undefined,
  } as unknown as RmScene;
}

async function sourcePdf(sizes: [number, number][], rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size).setRotation(degrees(rotate));
  return doc.save();
}

const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe("sceneToPdfMatrix", () => {
  it("centres x on the page and measures y down from the top", () => {
    const m = sceneToPdfMatrix(0, [0, 0, 612, 792], 612);
    expect(apply(m, 0, 0)).toEqual([306, 792]);
    const [x, y] = apply(m, 227, 227);
    expect(x).toBeCloseTo(306 + 72);
    expect(y).toBeCloseTo(792 - 72);
  });

  it("keeps the visual top-left at the scene origin on rotated pages", () => {
    // a landscape-displayed page: 792 wide unrotated box rotated 90°, so visual width = 792
    const box: [number, number, number, number] = [0, 0, 612, 792];
    for (const rotation of [90, 180, 270]) {
      const visualWidth = rotation === 180 ? 612 : 792;
      const m = sceneToPdfMatrix(rotation, box, visualWidth);
      // a step right on screen must move one scene unit's worth of points
      const [ax, ay] = apply(m, 0, 0);
      const [bx, by] = apply(m, 227, 0);
      expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(72);
      // the scene origin (top centre on screen) lands on the box edge, mid-way along it
      const onEdge = [0, 612].some((v) => Math.abs(ax - v) < 1e-9) || [0, 792].some((v) => Math.abs(ay - v) < 1e-9);
      expect(onEdge).toBe(true);
      expect(PT_PER_PX).toBeCloseTo(72 / 227);
    }
  });
});

describe("renderAnnotatedPdf", () => {
  it("returns the original bytes when nothing was annotated or moved", async () => {
    const original = await sourcePdf([[612, 792], [612, 792]]);
    const result = await renderAnnotatedPdf(original, [{ scene: null, source: 0 }, { scene: null, source: 1 }]);
    expect(result.pdf).toBe(original);
  });

  it("draws on annotated pages in place and keeps the page size", async () => {
    const original = await sourcePdf([[612, 792], [612, 792]]);
    const result = await renderAnnotatedPdf(original, [
      { scene: scene([[-100, 100], [100, 200]]), source: 0 },
      { scene: null, source: 1 },
    ]);
    const doc = await PDFDocument.load(result.pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it("follows the tablet's page order, including inserted and removed pages", async () => {
    const original = await sourcePdf([[100, 100], [200, 200], [300, 300]]);
    const result = await renderAnnotatedPdf(original, [
      { scene: null, source: 2 },
      { scene: scene([[0, 100], [50, 150]]) },
      { scene: null, source: 0 },
    ]);
    const doc = await PDFDocument.load(result.pdf);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([300, Math.round(1404 * PT_PER_PX), 100]);
  });

  it("grows the page by a 5 mm margin when ink runs off it", async () => {
    const original = await sourcePdf([[612, 792]]);
    // 1500 px right of centre is well past the right edge
    const result = await renderAnnotatedPdf(original, [{ scene: scene([[0, 100], [1500, 100]]), source: 0 }]);
    const page = (await PDFDocument.load(result.pdf)).getPage(0);
    expect(page.getMediaBox().width).toBeGreaterThan(306 + 1500 * PT_PER_PX);
    expect(page.getMediaBox().height).toBe(792);
  });

  it("uses the PDF's own pages when the document has no page list yet", async () => {
    const original = await sourcePdf([[612, 792], [612, 792], [612, 792]]);
    const result = await renderAnnotatedPdf(original, []);
    expect(result.pageCount).toBe(3);
  });

  it("falls back to the untouched original for encrypted PDFs", async () => {
    const encrypted = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 1/R 2/O(x)/U(x)/P -4>>endobj\ntrailer<</Root 1 0 R/Encrypt 3 0 R>>\n%%EOF",
    );
    const result = await renderAnnotatedPdf(encrypted, [{ scene: scene([[0, 0], [10, 10]]), source: 0 }]);
    expect(result.pdf).toBe(encrypted);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "annotations_skipped" })]);
  });
});
