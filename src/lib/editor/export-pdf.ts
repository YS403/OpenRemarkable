import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFName, type PDFPage } from "pdf-lib";

import { EncryptedPdfError } from "@/lib/rm";


import type { Element, EllipseElement, LineElement, PageInfo, Project, RectElement, TextElement } from "./model";
import { lineHeads, lineShaft, type Point } from "./shapes";
import { alignOffset, baselineY, faceFor, type FontFace, wrapText } from "./text";

/** Bézier handle length for a quarter ellipse. */
const KAPPA = 0.5522847498;

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? "0" : String(r);
};
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(" ");

/**
 * Draw a project's elements onto the matching pages of a rendered notebook PDF
 * and return the combined document. Elements become real vector shapes and
 * selectable text with an embedded font.
 */
export async function applyProject(basePdf: Uint8Array, project: Project, pages: readonly PageInfo[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(basePdf, { ignoreEncryption: true });
  if (doc.isEncrypted) throw new EncryptedPdfError();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  const fonts = new FontCache(doc);
  const pdfPages = doc.getPages();

  for (const { id, index } of pages) {
    const elements = project.pages[id];
    const page = pdfPages[index];
    if (!elements?.length || !page) continue;
    await new PageWriter(doc, page, fonts).draw(elements);
  }
  return doc.save({ useObjectStreams: true });
}

class FontCache {
  private readonly fonts = new Map<string, Promise<PDFFont>>();
  constructor(private readonly doc: PDFDocument) {}

  get(face: FontFace): Promise<PDFFont> {
    let font = this.fonts.get(face.file);
    if (!font) {
      // Full embedding: pdf-lib's subsetting has dropped glyphs with some fonts.
      font = readFile(path.join(process.cwd(), "public", face.file)).then((bytes) => this.doc.embedFont(bytes));
      this.fonts.set(face.file, font);
    }
    return font;
  }
}

class PageWriter {
  private readonly out: string[] = [];
  private readonly states = new Map<number, PDFName>();
  private readonly fontNames = new Map<PDFFont, PDFName>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly page: PDFPage,
    private readonly fonts: FontCache,
  ) {}

  async draw(elements: readonly Element[]): Promise<void> {
    // page space: points, origin top-left, y down (same as the editor)
    this.out.push(`q 1 0 0 -1 0 ${num(this.page.getHeight())} cm\n`);
    for (const el of elements) {
      const rad = (el.rotation * Math.PI) / 180;
      const [c, s] = [Math.cos(rad), Math.sin(rad)];
      this.out.push(`q ${this.opacity(el.opacity)}${num(c)} ${num(s)} ${num(-s)} ${num(c)} ${num(el.x)} ${num(el.y)} cm `);
      switch (el.type) {
        case "rect":
          this.rect(el);
          break;
        case "ellipse":
          this.ellipse(el);
          break;
        case "line":
          this.line(el);
          break;
        case "text":
          await this.text(el);
          break;
      }
      this.out.push("Q\n");
    }
    this.out.push("Q\n");
    const stream = this.doc.context.flateStream(this.out.join(""));
    this.page.node.addContentStream(this.doc.context.register(stream));
  }

  private opacity(alpha: number): string {
    if (alpha >= 1) return "";
    const a = Math.round(alpha * 1000) / 1000;
    let name = this.states.get(a);
    if (!name) {
      name = this.page.node.newExtGState("GS", this.doc.context.obj({ Type: "ExtGState", ca: a, CA: a }));
      this.states.set(a, name);
    }
    return `${name.toString()} gs `;
  }

  /** Fill and/or stroke the current path according to a shape's style. */
  private paint(style: { fill: string | null; stroke: string | null; strokeWidth: number }): void {
    const fill = style.fill !== null;
    const stroke = style.stroke !== null && style.strokeWidth > 0;
    if (fill) this.out.push(`${rgb(style.fill!)} rg `);
    if (stroke) this.out.push(`${rgb(style.stroke!)} RG ${num(style.strokeWidth)} w 1 j `);
    this.out.push(fill && stroke ? "B " : fill ? "f " : stroke ? "S " : "n ");
  }

  private rect(el: RectElement): void {
    const { width: w, height: h } = el;
    const r = Math.min(el.cornerRadius, w / 2, h / 2);
    if (r <= 0) {
      this.out.push(`0 0 ${num(w)} ${num(h)} re `);
    } else {
      const k = r * (1 - KAPPA);
      this.out.push(
        `${num(r)} 0 m ${num(w - r)} 0 l ${num(w - k)} 0 ${num(w)} ${num(k)} ${num(w)} ${num(r)} c ` +
          `${num(w)} ${num(h - r)} l ${num(w)} ${num(h - k)} ${num(w - k)} ${num(h)} ${num(w - r)} ${num(h)} c ` +
          `${num(r)} ${num(h)} l ${num(k)} ${num(h)} 0 ${num(h - k)} 0 ${num(h - r)} c ` +
          `0 ${num(r)} l 0 ${num(k)} ${num(k)} 0 ${num(r)} 0 c h `,
      );
    }
    this.paint(el);
  }

  private ellipse(el: EllipseElement): void {
    const [rx, ry] = [el.width / 2, el.height / 2];
    const [kx, ky] = [rx * KAPPA, ry * KAPPA];
    const p = (...xs: number[]) => xs.map(num).join(" ");
    this.out.push(
      `${p(2 * rx, ry)} m ${p(2 * rx, ry + ky, rx + kx, 2 * ry, rx, 2 * ry)} c ${p(rx - kx, 2 * ry, 0, ry + ky, 0, ry)} c ` +
        `${p(0, ry - ky, rx - kx, 0, rx, 0)} c ${p(rx + kx, 0, 2 * rx, ry - ky, 2 * rx, ry)} c h `,
    );
    this.paint(el);
  }

  private line(el: LineElement): void {
    const [a, b] = lineShaft(el);
    this.out.push(`${rgb(el.stroke)} RG ${rgb(el.stroke)} rg ${num(el.strokeWidth)} w 1 J 1 j `);
    this.out.push(`${num(a.x)} ${num(a.y)} m ${num(b.x)} ${num(b.y)} l S `);
    for (const head of lineHeads(el)) this.polygon(head);
  }

  private polygon(points: Point[]): void {
    this.out.push(`${num(points[0].x)} ${num(points[0].y)} m `);
    for (const p of points.slice(1)) this.out.push(`${num(p.x)} ${num(p.y)} l `);
    this.out.push("h f ");
  }

  private async text(el: TextElement): Promise<void> {
    const font = await this.fonts.get(faceFor(el));
    let name = this.fontNames.get(font);
    if (!name) {
      name = this.page.node.newFontDictionary(font.name, font.ref);
      this.fontNames.set(font, name);
    }
    const measure = (t: string) => font.widthOfTextAtSize(t, el.fontSize);
    const lines = el.lines ?? wrapText(el.text, el.width, measure);
    this.out.push(`${rgb(el.color)} rg BT ${name.toString()} ${num(el.fontSize)} Tf `);
    lines.forEach((line, i) => {
      if (!line) return;
      const x = alignOffset(el.align, el.width, measure(line));
      // the text matrix flips glyphs back upright in our y-down space
      this.out.push(`1 0 0 -1 ${num(x)} ${num(baselineY(el, i))} Tm ${font.encodeText(line).toString()} Tj `);
    });
    this.out.push("ET ");
  }
}
