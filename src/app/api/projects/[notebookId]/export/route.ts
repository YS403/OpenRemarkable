import { z } from "zod";

import { exportEditedDocument, uploadPdfToRemarkable } from "@/lib/editor/export-service";
import { badRequest, contentDisposition, readJsonBody, streamBody, UUID_PATTERN } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";

const bodySchema = z.object({
  target: z.enum(["download", "remarkable"]),
  /** name for the new reMarkable document */
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\u0000-\u001f]*$/, "Names can't contain control characters.")
    .optional(),
});

/**
 * POST /api/projects/:notebookId/export — the document with its saved edits.
 * `download` returns the PDF; `remarkable` uploads it as a new document.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await params;
  if (!UUID_PATTERN.test(notebookId)) return badRequest("Invalid notebook id.");

  const read = await readJsonBody(request, 4096);
  if (!read.ok) return read.response;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid request.");

  try {
    const { bytes, name } = await exportEditedDocument(notebookId);
    if (parsed.data.target === "download") {
      return new Response(streamBody(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition("attachment", `${name} (edited).pdf`),
          "Cache-Control": "no-store",
        },
      });
    }
    const documentName = parsed.data.name ?? `${name} (edited)`;
    const uploaded = await uploadPdfToRemarkable(documentName, bytes);
    return Response.json({ id: uploaded.id, name: documentName });
  } catch (error) {
    return errorResponse(error);
  }
}
