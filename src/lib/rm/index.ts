/**
 * reMarkable notebook → PDF renderer.
 *
 * Framework-free: no Next.js or Node-only APIs, so it can run in a route
 * handler, a worker, or the browser. See the private rendering notes for how the rules
 * here were derived from the desktop app.
 */
export {
  renderNotebookPdf,
  RENDERER_VERSION,
  type NotebookPageInput,
  type RenderOptions,
  type RenderResult,
} from "./render-pdf";
export { orderPages, type OrderedPage, type PageOrderSource } from "./page-order";
export { type AnnotatedPageInput, EncryptedPdfError, renderAnnotatedPdf } from "./annotated-pdf";
export type { RenderWarning } from "./types";
