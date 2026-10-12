import { PDFDocument } from "pdf-lib";
import type { RmScene } from "rmapi-js";
import { describe, expect, it } from "vitest";

import { renderNotebookPdf } from "./render-pdf";
import { Tool } from "./pens";

const line = (tool: number, points: [number, number][], width = 12) => ({
  kind: "line" as const,
  line: {
    tool,
    color: 0,
    thicknessScale: 1,
    startingLength: 0,
    points: points.map(([x, y]) => ({ x, y, speed: 4, width, direction: 0, pressure: 128 })),
  },
});

/** A minimal stand-in for a parsed v6 page. */
function scene(items: ReturnType<typeof line>[]): RmScene {
  return {
    version: 6,
    blocks: [],
    authors: new Map(),
    paperSize: [1404, 1872],
    layers: () => [{ id: { authorId: 0, counter: 11 }, items }],
    strokes: () => items.map((i) => i.line),
    text: () => undefined,
  } as unknown as RmScene;
}

describe("renderNotebookPdf", () => {
  it("renders every pen family into a valid PDF, one page per input page", async () => {
    const page = scene([
      line(Tool.BallpointV2, [[-300, 100], [-200, 150], [-100, 120]]),
      line(Tool.MarkerV2, [[-300, 300], [0, 320]]),
      line(Tool.FinelinerV2, [[-300, 500], [0, 520]], 8),
      line(Tool.HighlighterV2, [[-300, 700], [0, 700]], 120),
      line(Tool.PencilV2, [[-300, 900], [0, 950]], 20),
      line(Tool.Calligraphy, [[-300, 1100], [0, 1150]]),
    ]);
    const result = await renderNotebookPdf([{ scene: page }, { scene: null, template: "P Day" }], { title: "Test" });

    const pdf = await PDFDocument.load(result.pdf);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe("Test");
    const [first] = pdf.getPages();
    expect(first.getWidth()).toBeCloseTo((1404 * 72) / 227, 1);
    expect(result.warnings).toEqual([expect.objectContaining({ page: 2, code: "template_not_rendered" })]);
  });

  it("still produces a one-page PDF for an empty notebook", async () => {
    const result = await renderNotebookPdf([]);
    expect((await PDFDocument.load(result.pdf)).getPageCount()).toBe(1);
  });

  it("widens pages whose content spills far past the sides", async () => {
    const result = await renderNotebookPdf([{ scene: scene([line(Tool.FinelinerV2, [[-900, 100], [900, 100]], 8)]) }]);
    const [first] = (await PDFDocument.load(result.pdf)).getPages();
    expect(first.getWidth()).toBeCloseTo((1872 * 72) / 227, 1);
  });
});
