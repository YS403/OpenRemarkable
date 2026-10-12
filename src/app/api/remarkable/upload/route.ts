import type { NextRequest } from "next/server";

import { badRequest, UUID_PATTERN } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { documentNameFor, uploadPdfDocument, UploadRejectedError } from "@/lib/remarkable/upload";
import { ROOT_FOLDER } from "@/lib/remarkable/types";
import { UPLOAD_MAX_BYTES } from "@/lib/server/config";
import { requireSession } from "@/lib/session/session";

// large files take a while to send on to the reMarkable cloud
export const maxDuration = 60;

const MB = 1024 * 1024;

/**
 * POST /api/remarkable/upload?name=<file name>&parent=<folder id> — the body
 * is the raw PDF (Content-Type: application/pdf). Creates a new document in
 * that folder (root when `parent` is empty) and returns its id.
 */
export async function POST(request: NextRequest) {
  // a raw binary body (not a form) keeps cross-site form posts out and avoids multipart parsing
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/pdf") {
    return badRequest("Send the file as application/pdf.", 415);
  }
  const fileName = request.nextUrl.searchParams.get("name") ?? "";
  const parent = request.nextUrl.searchParams.get("parent") ?? ROOT_FOLDER;
  if (parent !== ROOT_FOLDER && parent !== "trash" && !UUID_PATTERN.test(parent)) return badRequest("Invalid folder.");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > UPLOAD_MAX_BYTES) return tooLarge();

  try {
    await requireSession();
    const bytes = await readCapped(request, UPLOAD_MAX_BYTES);
    if (bytes === null) return tooLarge();
    if (bytes.byteLength === 0) return badRequest("The file is empty.");

    const uploaded = await uploadPdfDocument({ name: documentNameFor(fileName), bytes, parent });
    console.info(`[upload] ${uploaded.id}: ${uploaded.pages} pages, ${(bytes.byteLength / MB).toFixed(1)} MB`);
    return Response.json(uploaded, { status: 201 });
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return Response.json({ error: "upload_rejected", message: error.message }, { status: error.status });
    }
    return errorResponse(error);
  }
}

function tooLarge(): Response {
  return Response.json(
    { error: "too_large", message: `PDFs can be up to ${Math.round(UPLOAD_MAX_BYTES / MB)} MB here.` },
    { status: 413 },
  );
}

/** The whole body, or null as soon as it passes `max` bytes (the rest is never read). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
