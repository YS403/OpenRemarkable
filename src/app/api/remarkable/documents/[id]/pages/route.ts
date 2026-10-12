import { connection } from "next/server";

import { badRequest, UUID_PATTERN } from "@/lib/http";
import { findDocument, getPageList } from "@/lib/remarkable/documents";
import { errorResponse } from "@/lib/remarkable/http";

/** GET /api/remarkable/documents/:id/pages — page ids in PDF order. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return badRequest("Invalid document id.");
  try {
    const item = await findDocument(id);
    return Response.json({ hash: item.hash, pages: await getPageList(item) });
  } catch (error) {
    return errorResponse(error);
  }
}
