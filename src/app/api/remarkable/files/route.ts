import type { NextRequest } from "next/server";

import { listCloudItems } from "@/lib/remarkable/files";
import { errorResponse } from "@/lib/remarkable/http";

/** Lists every folder and document. Pass ?refresh=1 to bypass the cached root. */
export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const items = await listCloudItems(refresh);
    return Response.json({ items, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
