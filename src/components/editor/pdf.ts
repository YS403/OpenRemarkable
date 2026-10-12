import type { PDFDocumentProxy } from "pdfjs-dist";

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

/** Load pdf.js on demand in the browser; the worker is served from /public (scripts/copy-pdf-worker.mjs). */
function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return lib;
  });
  return pdfjs;
}

/** Open a PDF; call `close` to free the worker-side document. */
export async function openPdf(data: ArrayBuffer): Promise<{ pdf: PDFDocumentProxy; close: () => Promise<void> }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data });
  return { pdf: await task.promise, close: () => task.destroy() };
}

/** Page sizes in PDF points, in order. */
export async function pageSizes(pdf: PDFDocumentProxy): Promise<{ width: number; height: number }[]> {
  const sizes = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return sizes;
}
