import { connection } from "next/server";

import { CONNECT_URL, isConnected } from "@/lib/remarkable/client";
import { errorResponse } from "@/lib/remarkable/http";
import { adoptLegacyDevice } from "@/lib/remarkable/token-store";
import { UPLOAD_MAX_BYTES } from "@/lib/server/config";

export async function GET() {
  await connection();
  try {
    await adoptLegacyDevice();
    return Response.json({ connected: await isConnected(), connectUrl: CONNECT_URL, uploadMaxBytes: UPLOAD_MAX_BYTES });
  } catch (error) {
    return errorResponse(error);
  }
}
