import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyProject } from "./export-pdf";
import { type Project, projectSchema } from "./model";

const NOTEBOOK = "11111111-2222-4333-8444-555555555555";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([445, 594]);
  return doc.save();
}

const project: Project = projectSchema.parse({
  version: 1,
  notebookId: NOTEBOOK,
  notebookHash: "abc",
  updatedAt: new Date().toISOString(),
  pages: {
    second: [
      { id: "r", type: "rect", x: 20, y: 20, width: 100, height: 50, rotation: 15, opacity: 0.5, fill: "#3366cc", stroke: "#000000", strokeWidth: 2, cornerRadius: 8 },
      { id: "e", type: "ellipse", x: 150, y: 20, width: 80, height: 40, fill: null, stroke: "#cc0000", strokeWidth: 3 },
      { id: "l", type: "line", x: 20, y: 120, dx: 200, dy: 40, stroke: "#00aa00", strokeWidth: 4, arrowEnd: true },
      {
        id: "t",
        type: "text",
        x: 20,
        y: 200,
        width: 300,
        text: "Hello reMarkable — ünïcode ✓",
        fontFamily: "Inter",
        fontSize: 18,
        bold: true,
        color: "#111111",
      },
    ],
  },
});

/** Extract a page's text with pdf.js, as a PDF viewer would for search/selection. */
async function pageText(pdf: Uint8Array, pageNumber: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: pdf.slice(), useSystemFonts: false }).promise;
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join("");
}

describe("applyProject", () => {
  it("draws elements on the page with the matching id, as selectable text and vector shapes", async () => {
    const pages = [
      { id: "first", index: 0 },
      { id: "second", index: 1 },
    ];
    const out = await applyProject(await blankPdf(2), project, pages, "Edited");

    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toBe("Edited");

    expect(await pageText(out, 1)).toBe("");
    expect(await pageText(out, 2)).toContain("Hello reMarkable — ünïcode ✓");
  });

  it("leaves the PDF untouched when there are no edits", async () => {
    const empty = { ...project, pages: {} };
    const out = await applyProject(await blankPdf(1), empty, [{ id: "first", index: 0 }], "x");
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe("project schema", () => {
  it("rejects malformed colors and unknown element types", () => {
    const bad = structuredClone(project) as unknown as { pages: { second: { fill?: string; type?: string }[] } };
    bad.pages.second[0].fill = "red";
    expect(projectSchema.safeParse(bad).success).toBe(false);
    const unknown = structuredClone(project) as unknown as { pages: { second: { type: string }[] } };
    unknown.pages.second[0].type = "script";
    expect(projectSchema.safeParse(unknown).success).toBe(false);
  });
});
