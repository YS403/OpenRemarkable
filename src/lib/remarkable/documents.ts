import "server-only";

import { HashNotFoundError, type RmPage } from "rmapi-js";

import { type AnnotatedPageInput, type NotebookPageInput, orderPages, type PageOrderSource } from "@/lib/rm";

import { withRemarkable } from "./client";
import { listCloudItems, type CloudItem } from "./files";

export class DocumentNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No document with id ${id}.`);
    this.name = "DocumentNotFoundError";
  }
}

export class UnsupportedDocumentError extends Error {
  constructor(readonly fileType: string | null) {
    super(`Notebooks and PDFs can be opened; ${fileType ? `${fileType.toUpperCase()} files` : "folders"} aren't supported yet.`);
    this.name = "UnsupportedDocumentError";
  }
}

/** Document kinds this app can render. */
export type RenderableType = "notebook" | "pdf";

export function renderableType(item: CloudItem): RenderableType {
  if (item.kind === "document" && (item.fileType === "notebook" || item.fileType === "pdf")) return item.fileType;
  throw new UnsupportedDocumentError(item.fileType);
}

/** Look up a document's current entry, refreshing the listing once if needed. */
export async function findDocument(id: string): Promise<CloudItem> {
  for (const refresh of [false, true]) {
    const item = (await listCloudItems(refresh)).find((entry) => entry.id === id);
    if (item) return item;
  }
  throw new DocumentNotFoundError(id);
}

/** Page ids in display order (same order as the rendered PDF), without downloading pages. */
export async function getPageList(item: CloudItem): Promise<{ id: string; index: number }[]> {
  renderableType(item);
  const content = await withRemarkable((api) => api.getContent({ id: item.id, hash: item.hash }));
  return orderPages(content as PageOrderSource).map(({ id }, index) => ({ id, index }));
}

/** A notebook's pages, parsed, in display order. */
export async function fetchNotebook(item: CloudItem): Promise<NotebookPageInput[]> {
  const { pages } = await fetchPagesAndAnnotations(item);
  return pages.map(({ scene, template }) => ({ scene, template }));
}

/** A PDF document: the original file plus its annotations, in display order. */
export async function fetchAnnotatedPdf(item: CloudItem): Promise<{ original: Uint8Array; pages: AnnotatedPageInput[] }> {
  const { pages, original } = await fetchPagesAndAnnotations(item, true);
  return { original: original!, pages };
}

async function fetchPagesAndAnnotations(
  item: CloudItem,
  withOriginal = false,
): Promise<{ pages: AnnotatedPageInput[]; original?: Uint8Array }> {
  renderableType(item);
  const ref = { id: item.id, hash: item.hash };
  try {
    return await withRemarkable(async (api) => {
      const [content, rmPages, original] = await Promise.all([
        api.getContent(ref),
        api.getRmPages(ref),
        withOriginal ? api.getPdf(ref) : Promise.resolve(undefined),
      ]);
      const pages = orderPages(content as PageOrderSource).map(({ id, template, source }) => ({
        scene: (rmPages.get(id) ?? null) as RmPage | null,
        template,
        source,
      }));
      return { pages, original };
    });
  } catch (error) {
    // The listing was stale: the document changed since it was read.
    if (error instanceof HashNotFoundError) return fetchPagesAndAnnotations(await findDocument(item.id), withOriginal);
    throw error;
  }
}
