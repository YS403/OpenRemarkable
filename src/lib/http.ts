import "server-only";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: "bad_request", message }, { status });
}

/**
 * Read a JSON body, insisting on a JSON content type (so plain cross-site form
 * posts can't reach state-changing routes) and capping its size.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return { ok: false, response: badRequest("Expected a JSON body.", 415) };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: badRequest("Request body too large.", 413) };
  const text = await request.text();
  if (text.length > maxBytes) return { ok: false, response: badRequest("Request body too large.", 413) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: badRequest("Invalid JSON.") };
  }
}

/** RFC 6266 header with an ASCII fallback and the full UTF-8 name. */
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const STREAM_CHUNK = 1024 * 1024;

/**
 * Send bytes as a stream. Hosts like Vercel cap buffered function responses
 * (4.5 MB) but not streamed ones, and PDFs regularly exceed that.
 */
export function streamBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + STREAM_CHUNK));
      offset += STREAM_CHUNK;
    },
  });
}
