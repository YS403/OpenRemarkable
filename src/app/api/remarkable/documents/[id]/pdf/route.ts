import type { NextRequest } from "next/server";

import { badRequest, contentDisposition, streamBody, UUID_PATTERN } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { getDocumentPdf } from "@/lib/remarkable/document-pdf";

/**
 * GET /api/remarkable/documents/:id/pdf — a notebook rendered to PDF, or a PDF
 * document with its tablet annotations drawn on.
 * Shown inline by default; `?download=1` saves it instead.
 */
/** big documents can take a while to download, render and stream */
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return badRequest("Invalid document id.");

  try {
    const pdf = await getDocumentPdf(id);
    const headers = {
      ETag: pdf.etag,
      // private: the content is the user's; no-cache: revalidate with the ETag each time
      "Cache-Control": "private, no-cache",
    };
    if (request.headers.get("if-none-match") === pdf.etag) {
      return new Response(null, { status: 304, headers });
    }

    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(streamBody(pdf.bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(disposition, pdf.filename),
        "X-Cache": pdf.cacheHit ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
