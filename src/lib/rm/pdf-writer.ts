/**
 * Thin adapter over pdf-lib. Everything PDF-specific lives here so the
 * renderer can move to another backend without touching the pen logic.
 *
 * Page content is written as raw PDF operators into a string and stored as one
 * Flate-compressed stream; building pdf-lib operator objects for every path
 * point is far slower and larger on dense pages.
 */
import { PDFDocument, type PDFFont, type PDFName, type PDFPage, StandardFonts } from "pdf-lib";

import type { Shape, Vec } from "./geometry";
import type { BlendMode, LineCap, LineJoin, Rgba } from "./types";

const CAPS: Record<LineCap, number> = { butt: 0, round: 1, square: 2 };
const JOINS: Record<LineJoin, number> = { miter: 0, round: 1, bevel: 2 };

/** Format a number for a content stream: two decimals, no exponent, no "-0". */
function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? "0" : String(r);
}

/**
 * Path coordinates in scene pixels to 0.1 px (11 µm on paper); finer
 * precision only grows the file.
 */
function coord(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? "0" : String(r);
}

const colorOperands = (c: Rgba) => `${num(c.r / 255)} ${num(c.g / 255)} ${num(c.b / 255)}`;

/** Append a circular arc as cubic Béziers of at most 90° each, starting at the current point. */
function arc(out: string[], cx: number, cy: number, r: number, start: number, sweep: number): void {
  const pieces = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  let a = start;
  for (let i = 0; i < pieces; i++) {
    const b = a + step;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    out.push(
      ` ${coord(cx + r * (ca - k * sa))} ${coord(cy + r * (sa + k * ca))}` +
        ` ${coord(cx + r * (cb + k * sb))} ${coord(cy + r * (sb - k * cb))}` +
        ` ${coord(cx + r * cb)} ${coord(cy + r * sb)} c`,
    );
    a = b;
  }
}

/** A PDF transformation matrix in `cm` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export class PdfBuilder {
  private constructor(
    private readonly doc: PDFDocument,
    readonly font: PDFFont,
    private readonly fontChars: Set<number>,
  ) {}

  static async create(title?: string): Promise<PdfBuilder> {
    return PdfBuilder.fromDocument(await PDFDocument.create(), title);
  }

  /** Draw into an existing document (e.g. an annotated PDF). */
  static async fromDocument(doc: PDFDocument, title?: string): Promise<PdfBuilder> {
    doc.setProducer("openremarkable");
    if (title) doc.setTitle(title);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    return new PdfBuilder(doc, font, new Set(font.getCharacterSet()));
  }

  get document(): PDFDocument {
    return this.doc;
  }

  /** Replace characters the standard font cannot encode. */
  sanitize(text: string): { text: string; replaced: boolean } {
    let replaced = false;
    let out = "";
    for (const ch of text) {
      if (this.fontChars.has(ch.codePointAt(0)!)) out += ch;
      else {
        out += "?";
        replaced = true;
      }
    }
    return { text: out, replaced };
  }

  measure(text: string, size: number): number {
    return this.font.widthOfTextAtSize(this.sanitize(text).text, size);
  }

  /**
   * Add a page sized in scene pixels. Drawing calls on the returned canvas use
   * scene pixels with y pointing down; conversion to points happens once.
   */
  addPage(widthPx: number, heightPx: number, ptPerPx: number, index?: number): PageCanvas {
    const size: [number, number] = [Number(num(widthPx * ptPerPx)), Number(num(heightPx * ptPerPx))];
    const page = index === undefined ? this.doc.addPage(size) : this.doc.insertPage(index, size);
    // map scene pixels (y down) onto PDF points (y up)
    return new PageCanvas(this.doc, page, this.font, [ptPerPx, 0, 0, -ptPerPx, 0, page.getHeight()]);
  }

  /**
   * Draw on top of an existing page through `matrix` (PDF `cm` order:
   * a b c d e f). The page's own content is wrapped in q/Q first so any
   * graphics state it leaves behind can't shift the drawing.
   */
  canvasOnPage(page: PDFPage, matrix: Matrix): PageCanvas {
    const contents = page.node.normalizedEntries().Contents;
    if (contents) {
      contents.insert(0, this.doc.context.register(this.doc.context.flateStream("q\n")));
      contents.push(this.doc.context.register(this.doc.context.flateStream("Q\n")));
    }
    return new PageCanvas(this.doc, page, this.font, matrix);
  }

  save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: true });
  }
}

export class PageCanvas {
  private readonly parts: string[] = [];
  private readonly states = new Map<string, PDFName>();
  private fontName: PDFName | null = null;

  constructor(
    private readonly doc: PDFDocument,
    private readonly page: PDFPage,
    private readonly font: PDFFont,
    matrix: Matrix,
  ) {
    this.parts.push(`q ${matrix.map((n) => String(Math.round(n * 1e6) / 1e6)).join(" ")} cm\n`);
  }

  /** Fill shapes as one path (nonzero rule), so overlaps never double up. */
  fillShapes(shapes: readonly Shape[], color: Rgba, blend: BlendMode, offset: Vec): void {
    if (shapes.length === 0) return;
    this.begin(color, blend, "fill");
    const out: string[] = [];
    for (const shape of shapes) {
      if (shape.kind === "polygon") polygon(out, shape.points, offset);
      else if (shape.radius > 0) {
        const cx = shape.center.x + offset.x;
        const cy = shape.center.y + offset.y;
        const r = shape.radius;
        if (shape.kind === "circle") {
          out.push(` ${coord(cx + r)} ${coord(cy)} m`);
          arc(out, cx, cy, r, 0, 2 * Math.PI);
        } else {
          // pie slice: centre, out along the start angle, round the arc, back
          out.push(` ${coord(cx)} ${coord(cy)} m ${coord(cx + r * Math.cos(shape.start))} ${coord(cy + r * Math.sin(shape.start))} l`);
          arc(out, cx, cy, r, shape.start, shape.sweep);
        }
        out.push(" h");
      }
    }
    out.push(" f Q\n");
    this.parts.push(out.join(""));
  }

  strokePolyline(
    points: readonly Vec[],
    width: number,
    cap: LineCap,
    join: LineJoin,
    color: Rgba,
    blend: BlendMode,
    offset: Vec,
  ): void {
    if (points.length === 0) return;
    this.begin(color, blend, "stroke");
    const out = [`${num(width)} w ${CAPS[cap]} J ${JOINS[join]} j `];
    out.push(`${coord(points[0].x + offset.x)} ${coord(points[0].y + offset.y)} m`);
    // a single point still needs a segment so its cap is drawn
    const rest = points.length > 1 ? points.slice(1) : points;
    for (const p of rest) out.push(` ${coord(p.x + offset.x)} ${coord(p.y + offset.y)} l`);
    out.push(" S Q\n");
    this.parts.push(out.join(""));
  }

  /**
   * Paint a 1-bit mask (PDF image mask: rows MSB first, 0 = paint) in one
   * color, one mask pixel per canvas unit, with its top-left corner at `at`.
   */
  imageMask(packed: Uint8Array, width: number, height: number, color: Rgba, at: Vec): void {
    const stream = this.doc.context.flateStream(packed, {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      ImageMask: true,
      BitsPerComponent: 1,
    });
    const name = this.page.node.newXObject("Mask", this.doc.context.register(stream));
    this.begin(color, "Normal", "fill");
    // image space is a unit square with row 0 at the top; flip it into our y-down space
    this.parts.push(`${width} 0 0 ${-height} ${num(at.x)} ${num(at.y + height)} cm ${name.toString()} Do Q\n`);
  }

  /** Draw one line of text with its baseline at (x, y) in scene pixels. */
  text(text: string, x: number, y: number, size: number, color: Rgba): void {
    if (!text) return;
    this.fontName ??= this.page.node.newFontDictionary(this.font.name, this.font.ref);
    this.begin(color, "Normal", "fill");
    // the text matrix undoes the page's y flip for glyphs
    this.parts.push(
      `BT ${this.fontName.toString()} ${num(size)} Tf 1 0 0 -1 ${num(x)} ${num(y)} Tm ${this.font.encodeText(text).toString()} Tj ET Q\n`,
    );
  }

  finish(): void {
    this.parts.push("Q\n");
    const stream = this.doc.context.flateStream(this.parts.join(""));
    this.page.node.addContentStream(this.doc.context.register(stream));
  }

  private begin(color: Rgba, blend: BlendMode, mode: "fill" | "stroke"): void {
    const state = this.graphicsState(color.a, blend);
    this.parts.push(`q ${state ? `${state.toString()} gs ` : ""}${colorOperands(color)} ${mode === "fill" ? "rg" : "RG"} `);
  }

  /** Shared ExtGState for an opacity/blend pair; null when defaults suffice. */
  private graphicsState(alpha: number, blend: BlendMode): PDFName | null {
    const a = Math.round(alpha * 1000) / 1000;
    if (a >= 1 && blend === "Normal") return null;
    const key = `${a}|${blend}`;
    let name = this.states.get(key);
    if (!name) {
      const dict = this.doc.context.obj({ Type: "ExtGState", ca: a, CA: a, BM: blend });
      name = this.page.node.newExtGState("GS", dict);
      this.states.set(key, name);
    }
    return name;
  }

}

function polygon(out: string[], points: readonly Vec[], offset: Vec): void {
  out.push(` ${coord(points[0].x + offset.x)} ${coord(points[0].y + offset.y)} m`);
  for (let i = 1; i < points.length; i++) out.push(` ${coord(points[i].x + offset.x)} ${coord(points[i].y + offset.y)} l`);
  out.push(" h");
}
