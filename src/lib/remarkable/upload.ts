import "server-only";

import { PDFDocument } from "pdf-lib";
import { GenerationError } from "rmapi-js";

import { withRemarkable } from "./client";
import { listCloudItems } from "./files";
import { ROOT_FOLDER, TRASH_FOLDER } from "./types";

/** An upload the server refuses; `status` is the HTTP status to answer with. */
export class UploadRejectedError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 413 | 415 | 422,
  ) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

const MAX_NAME_LENGTH = 200;
const MAX_ATTEMPTS = 4;

/**
 * The document name shown on the tablet: the file name without ".pdf",
 * trimmed, without control characters, never empty.
 */
export function documentNameFor(fileName: string): string {
  const name = fileName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return name || "Untitled";
}

/** Check the bytes really are a readable PDF. Returns its page count. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pages: number }> {
  // "%PDF-" may follow a little leading junk; real-world files sometimes have it
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new UploadRejectedError("That file isn't a PDF.", 415);
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const pages = doc.getPageCount();
    if (pages < 1) throw new Error("no pages");
    return { pages };
  } catch (error) {
    if (error instanceof UploadRejectedError) throw error;
    throw new UploadRejectedError("That PDF is damaged or unreadable, so it can't be uploaded.", 422);
  }
}

/** The destination must be the root or an existing folder (not the trash). */
async function checkParent(parent: string): Promise<void> {
  if (parent === ROOT_FOLDER) return;
  if (parent === TRASH_FOLDER) throw new UploadRejectedError("Files can't be uploaded into the trash.", 400);
  const folder = (await listCloudItems()).find((item) => item.id === parent) ?? (await listCloudItems(true)).find((item) => item.id === parent);
  if (!folder || folder.kind !== "folder") throw new UploadRejectedError("That folder no longer exists.", 404);
  if (folder.parent === TRASH_FOLDER) throw new UploadRejectedError("That folder is in the trash.", 400);
}

/**
 * Upload a PDF into a folder of the connected account. The cloud rejects a
 * write if someone else (usually the tablet) changed the account meanwhile;
 * those writes are retried with backoff.
 */
export async function uploadPdfDocument({ name, bytes, parent }: { name: string; bytes: Uint8Array; parent: string }): Promise<{ id: string; name: string; pages: number }> {
  const { pages } = await inspectPdf(bytes);
  await checkParent(parent);
  const ref = await withRemarkable(async (api) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api.putPdf(name, bytes, parent === ROOT_FOLDER ? {} : { parent });
      } catch (error) {
        if (error instanceof GenerationError && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
  });
  return { id: ref.id, name, pages };
}
