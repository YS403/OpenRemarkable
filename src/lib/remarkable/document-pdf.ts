import "server-only";

import path from "node:path";

import { FileCache } from "@/lib/cache/file-cache";
import { Semaphore } from "@/lib/concurrency";
import { RENDERER_VERSION, renderAnnotatedPdf, renderNotebookPdf, type RenderResult } from "@/lib/rm";
import { DATA_DIR, PDF_CACHE_BYTES, PDF_RENDER_CONCURRENCY } from "@/lib/server/config";
import { requireSession } from "@/lib/session/session";

import { fetchAnnotatedPdf, fetchNotebook, findDocument, renderableType } from "./documents";
import type { CloudItem } from "./files";

const MB = 1024 * 1024;

const cache = new FileCache(path.join(DATA_DIR, "cache", "pdf"), PDF_CACHE_BYTES);
// Rendering is CPU- and memory-heavy; cap parallel renders so one big document can't starve the server.
const renders = new Semaphore(PDF_RENDER_CONCURRENCY);

export interface DocumentPdf {
  bytes: Uint8Array;
  /** strong validator: changes whenever the document or renderer changes */
  etag: string;
  filename: string;
  cacheHit: boolean;
}

/**
 * A notebook rendered to PDF, or a PDF document with its annotations drawn on,
 * rendered only if this version isn't cached yet.
 */
export async function getDocumentPdf(id: string): Promise<DocumentPdf> {
  const { userId } = await requireSession();
  const item = await findDocument(id);
  const type = renderableType(item);

  const version = `${item.hash}-r${RENDERER_VERSION}`;
  // namespaced per user: cached renders are only ever served back to their owner
  const { bytes, hit } = await cache.getOrCreate(`${userId}-${version}.pdf`, () =>
    renders.run(async () => {
      const started = performance.now();
      const result = type === "notebook" ? await renderNotebook(item) : await renderPdf(item);
      console.info(
        `[pdf] ${item.id} ${type} "${item.name}": ${result.pageCount} pages, ` +
          `${(result.pdf.byteLength / MB).toFixed(1)} MB, ${(performance.now() - started).toFixed(0)} ms`,
      );
      for (const warning of result.warnings) {
        console.warn(`[pdf] ${item.id} page ${warning.page ?? "-"}: ${warning.code}: ${warning.message}`);
      }
      return result.pdf;
    }),
  );

  const filename = item.name.toLowerCase().endsWith(".pdf") ? item.name : `${item.name}.pdf`;
  return { bytes, etag: `"${version}"`, filename, cacheHit: hit };
}

async function renderNotebook(item: CloudItem): Promise<RenderResult> {
  return renderNotebookPdf(await fetchNotebook(item), { title: item.name });
}

async function renderPdf(item: CloudItem): Promise<RenderResult> {
  const { original, pages } = await fetchAnnotatedPdf(item);
  return renderAnnotatedPdf(original, pages, { title: item.name });
}
