import "server-only";

import { withRemarkable } from "@/lib/remarkable/client";
import { findDocument, getPageList, renderableType } from "@/lib/remarkable/documents";
import { getDocumentPdf } from "@/lib/remarkable/document-pdf";

import { applyProject } from "./export-pdf";
import { emptyProject } from "./model";
import { requireSession } from "@/lib/session/session";
import { projectStore } from "@/lib/storage";

/** A notebook or PDF (with its annotations) plus the saved edits on top, as a PDF. */
export async function exportEditedDocument(notebookId: string): Promise<{ bytes: Uint8Array; name: string }> {
  const item = await findDocument(notebookId);
  renderableType(item);
  const [base, pages, project] = await Promise.all([
    getDocumentPdf(notebookId),
    getPageList(item),
    requireSession().then(({ userId }) => projectStore.load(userId, notebookId)),
  ]);
  const bytes = await applyProject(base.bytes, project ?? emptyProject(notebookId, item.hash), pages, item.name);
  return { bytes, name: item.name.replace(/\.pdf$/i, "") };
}

/** Upload a PDF to the root of the reMarkable account as a new document. */
export async function uploadPdfToRemarkable(name: string, bytes: Uint8Array): Promise<{ id: string }> {
  const ref = await withRemarkable((api) => api.uploadPdf(name, bytes));
  return { id: ref.id };
}
