import { connectDevice, ONE_TIME_CODE_PATTERN } from "@/lib/remarkable/client";
import { errorResponse } from "@/lib/remarkable/http";

/** Body: { "code": "abcdefgh" } — the one-time code from my.remarkable.com. */
export async function POST(request: Request) {
  // Requiring JSON keeps plain cross-site form posts from reaching this route.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "bad_request", message: "Expected a JSON body." }, { status: 415 });
  }

  let code: unknown;
  try {
    ({ code } = (await request.json()) as { code?: unknown });
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }

  const normalized = typeof code === "string" ? code.trim().toLowerCase() : "";
  if (!ONE_TIME_CODE_PATTERN.test(normalized)) {
    return Response.json(
      { error: "invalid_code", message: "The one-time code is eight letters." },
      { status: 400 },
    );
  }

  try {
    await connectDevice(normalized);
    return Response.json({ connected: true });
  } catch (error) {
    return errorResponse(error);
  }
}
