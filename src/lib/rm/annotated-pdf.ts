import { PDFDocument, type PDFPage } from "pdf-lib";
import type { RmPage } from "rmapi-js";

import { BLANK_TEMPLATE, PT_PER_PX } from "./constants";
import { framePage } from "./page-layout";
import { type Matrix, PdfBuilder } from "./pdf-writer";
import { drawScene, type RenderOptions, type RenderResult } from "./render-pdf";
import { toRenderPage } from "./scene";
import type { Bounds, RenderPage, RenderWarning } from "./types";

/** Margin the app adds around annotations that reach past the page edge (DAT_141246c60, 5 mm). */
const EXPAND_MARGIN_PT = 14.173228346456693;

export interface AnnotatedPageInput {
  /** the page's annotations; null when it has none */
  scene: RmPage | null;
  /** 0-based page of the original PDF shown here; undefined for a page inserted on the tablet */
  source?: number;
  template?: string;
}

export class EncryptedPdfError extends Error {
  constructor() {
    super("This PDF is encrypted, so edits can't be added to it.");
    this.name = "EncryptedPdfError";
  }
}

/** A PDF box as [left, bottom, right, top]. */
type Box = [number, number, number, number];

/**
 * Map scene pixels onto a PDF page, as the app's exporter does
 * (pdfexporter.cpp buildRenderMatrix, FUN_1404724f0 / FUN_140472a70):
 * scale 72/227, scene x centred on the page, scene y down from the top of the
 * visible box (media ∩ crop), with the page's /Rotate applied.
 *
 * `visualWidth` is the page width as displayed (after rotation).
 */
export function sceneToPdfMatrix(rotation: number, box: Box, visualWidth: number): Matrix {
  const s = PT_PER_PX;
  const w2 = visualWidth / 2;
  const [x0, y0, x1, y1] = box;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [0, s, s, 0, x0, y0 + w2];
    case 180:
      return [-s, 0, 0, s, x1 - w2, y0];
    case 270:
      return [0, -s, -s, 0, x1, y1 - w2];
    default:
      return [s, 0, 0, -s, x0 + w2, y1];
  }
}

const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** The visible page box: media box intersected with crop box. */
function visibleBox(page: PDFPage): Box {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  return [
    Math.max(media.x, crop.x),
    Math.max(media.y, crop.y),
    Math.min(media.x + media.width, crop.x + crop.width),
    Math.min(media.y + media.height, crop.y + crop.height),
  ];
}

/** Grow the box to hold the annotations plus a margin, like the app's "expanding page" step. */
function expandToFit(box: Box, m: Matrix, bounds: Bounds | null): Box | null {
  if (!bounds) return null;
  const corners = [
    apply(m, bounds.minX, bounds.minY),
    apply(m, bounds.maxX, bounds.minY),
    apply(m, bounds.minX, bounds.maxY),
    apply(m, bounds.maxX, bounds.maxY),
  ];
  const [left, bottom, right, top] = [
    Math.min(...corners.map((c) => c.x)),
    Math.min(...corners.map((c) => c.y)),
    Math.max(...corners.map((c) => c.x)),
    Math.max(...corners.map((c) => c.y)),
  ];
  const next: Box = [
    left < box[0] ? left - EXPAND_MARGIN_PT : box[0],
    bottom < box[1] ? bottom - EXPAND_MARGIN_PT : box[1],
    right > box[2] ? right + EXPAND_MARGIN_PT : box[2],
    top > box[3] ? top + EXPAND_MARGIN_PT : box[3],
  ];
  return next.some((v, i) => v !== box[i]) ? next : null;
}

/**
 * Combine an original PDF with the annotations made on it, in the document's
 * page order. Pages without annotations are passed through untouched.
 */
export async function renderAnnotatedPdf(
  original: Uint8Array,
  pages: readonly AnnotatedPageInput[],
  options: RenderOptions = {},
): Promise<RenderResult> {
  // pdf-lib's own EncryptedPDFError is ES5-compiled and can't be told apart, so check the flag
  const source = await PDFDocument.load(original, { updateMetadata: false, ignoreEncryption: true });
  if (source.isEncrypted) {
    // Most such files only restrict editing and still open without a password, so
    // show the original rather than nothing; drawing on it would need decryption.
    const annotated = pages.some((p) => p.scene !== null);
    return {
      pdf: original,
      pageCount: source.getPageCount(),
      warnings: annotated
        ? [{ code: "annotations_skipped", message: "This PDF is encrypted, so its annotations couldn't be drawn on it." }]
        : [],
    };
  }
  const sourceCount = source.getPageCount();

  // Documents that were never opened on the tablet have no page list.
  // Without redirection info, display page i is original page i.
  const anyRedir = pages.some((p) => p.source !== undefined);
  const display = pages.length === 0
    ? Array.from({ length: sourceCount }, (_, i): AnnotatedPageInput => ({ scene: null, source: i }))
    : pages.map((p, i) => (anyRedir ? p : { ...p, source: i < sourceCount ? i : undefined }));

  const sameOrder = display.length === sourceCount && display.every((p, i) => p.source === i);
  const annotated = display.some((p) => p.scene !== null);

  // Nothing to add and nothing moved: serve the original bytes.
  if (sameOrder && !annotated) return { pdf: original, pageCount: sourceCount, warnings: [] };

  // Same order: edit in place (fast for big books). Otherwise assemble a new document.
  let doc: PDFDocument;
  if (sameOrder) {
    doc = source;
  } else {
    doc = await PDFDocument.create();
    const wanted = display.map((p) => p.source).filter((s): s is number => s !== undefined && s < sourceCount);
    const copied = await doc.copyPages(source, wanted);
    copied.forEach((page) => doc.addPage(page));
  }

  const builder = await PdfBuilder.fromDocument(doc, options.title);
  const warnings: RenderWarning[] = [];
  const measure = (text: string, size: number) => builder.measure(text, size);

  // pages from the original, in output order, before inserted pages shift indices
  const sourcePages = doc.getPages();
  let sourceCursor = 0;
  let outputIndex = 0;

  for (const [i, input] of display.entries()) {
    const pageNumber = i + 1;
    const scene: RenderPage | null = input.scene
      ? toRenderPage(input.scene, measure, (w) => warnings.push({ ...w, page: pageNumber }))
      : null;

    if (input.source === undefined || input.source >= sourceCount) {
      // a page inserted on the tablet: draw it like a notebook page
      if (input.template && input.template !== BLANK_TEMPLATE) {
        warnings.push({ page: pageNumber, code: "template_not_rendered", message: `Background template "${input.template}" is not drawn.` });
      }
      const page = scene ?? emptyPage();
      const frame = framePage(page);
      const canvas = builder.addPage(frame.width, frame.height, PT_PER_PX, outputIndex);
      drawScene(builder, canvas, page, { x: frame.offsetX, y: frame.offsetY }, pageNumber, warnings);
      canvas.finish();
      outputIndex++;
      continue;
    }

    const page = sourcePages[sourceCursor++];
    outputIndex++;
    if (!scene) continue;

    const rotation = page.getRotation().angle;
    let box = visibleBox(page);
    const quarterTurn = Math.abs(rotation % 180) === 90;
    const visualWidth = quarterTurn ? box[3] - box[1] : box[2] - box[0];
    const matrix = sceneToPdfMatrix(rotation, box, visualWidth);

    const grown = expandToFit(box, matrix, scene.contentBounds);
    if (grown) {
      box = grown;
      page.setMediaBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      page.setCropBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    }

    const canvas = builder.canvasOnPage(page, matrix);
    drawScene(builder, canvas, scene, { x: 0, y: 0 }, pageNumber, warnings);
    canvas.finish();
  }

  return { pdf: await builder.save(), pageCount: doc.getPageCount(), warnings };
}

function emptyPage(): RenderPage {
  return { strokes: [], text: [], highlights: [], contentBounds: null, paperSize: { width: 1404, height: 1872 } };
}
