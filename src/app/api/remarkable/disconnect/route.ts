import { disconnectDevice } from "@/lib/remarkable/client";
import { errorResponse } from "@/lib/remarkable/http";

/**
 * End this browser's session (forgets its device token). The device stays listed under
 * my.remarkable.com until removed there.
 */
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "bad_request", message: "Expected a JSON body." }, { status: 415 });
  }
  try {
    await disconnectDevice();
    return Response.json({ connected: false });
  } catch (error) {
    return errorResponse(error);
  }
}
