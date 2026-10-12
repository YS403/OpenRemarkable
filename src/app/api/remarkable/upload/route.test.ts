import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadPdfDocument = vi.fn();
const requireSession = vi.fn();

vi.mock("@/lib/server/config", () => ({ UPLOAD_MAX_BYTES: 1000 }));
vi.mock("@/lib/session/session", () => ({
  requireSession: () => requireSession(),
  NotConnectedError: class NotConnectedError extends Error {},
}));
vi.mock("@/lib/remarkable/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/remarkable/upload")>()),
  uploadPdfDocument: (args: unknown) => uploadPdfDocument(args),
}));

const { POST } = await import("./route");
const { UploadRejectedError } = await import("@/lib/remarkable/upload");
const { NotConnectedError } = await import("@/lib/session/session");

const FOLDER = "11111111-1111-4111-8111-111111111111";
const bytes = (n: number) => new Uint8Array(n).fill(37);

function request(body: BodyInit | null, { query = "name=Report.pdf", type = "application/pdf", length }: { query?: string; type?: string | null; length?: number } = {}) {
  const headers = new Headers();
  if (type) headers.set("content-type", type);
  if (length !== undefined) headers.set("content-length", String(length));
  return new NextRequest(`http://localhost/api/remarkable/upload?${query}`, { method: "POST", body, headers, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
}

/** A body that arrives in chunks with no Content-Length, like a chunked upload. */
function streamed(chunks: number, size: number) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ >= chunks) controller.close();
      else controller.enqueue(bytes(size));
    },
  });
}

beforeEach(() => {
  uploadPdfDocument.mockReset();
  uploadPdfDocument.mockResolvedValue({ id: "doc-1", name: "Report", pages: 3 });
  requireSession.mockReset();
  requireSession.mockResolvedValue({ userId: "u", deviceToken: "t" });
});

describe("POST /api/remarkable/upload", () => {
  it("uploads and answers 201 with the new document", async () => {
    const res = await POST(request(bytes(500), { query: `name=Report.pdf&parent=${FOLDER}` }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "doc-1", name: "Report", pages: 3 });
    const args = uploadPdfDocument.mock.calls[0][0];
    expect(args.name).toBe("Report"); // ".pdf" stripped
    expect(args.parent).toBe(FOLDER);
    expect(args.bytes).toHaveLength(500);
  });

  it("defaults to the root folder and an Untitled name", async () => {
    await POST(request(bytes(10), { query: "" }));
    expect(uploadPdfDocument.mock.calls[0][0]).toMatchObject({ name: "Untitled", parent: "" });
  });

  it.each([
    ["no content type", null],
    ["a form post", "multipart/form-data; boundary=x"],
    ["JSON", "application/json"],
  ])("refuses %s with 415", async (_, type) => {
    const res = await POST(request(bytes(10), { type }));
    expect(res.status).toBe(415);
    expect(uploadPdfDocument).not.toHaveBeenCalled();
  });

  it("accepts a content type with parameters", async () => {
    const res = await POST(request(bytes(10), { type: "application/pdf; charset=binary" }));
    expect(res.status).toBe(201);
  });

  it.each(["not-a-uuid", "../etc", "123"])("refuses the folder id %j", async (parent) => {
    const res = await POST(request(bytes(10), { query: `name=a.pdf&parent=${encodeURIComponent(parent)}` }));
    expect(res.status).toBe(400);
    expect(uploadPdfDocument).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the limit before reading the body", async () => {
    const res = await POST(request(bytes(10), { length: 5000 }));
    expect(res.status).toBe(413);
    expect((await res.json()).message).toMatch(/up to/);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body as soon as it passes the limit", async () => {
    const res = await POST(request(streamed(10, 400)));
    expect(res.status).toBe(413);
    expect(uploadPdfDocument).not.toHaveBeenCalled();
  });

  it("accepts a streamed body under the limit", async () => {
    const res = await POST(request(streamed(2, 400)));
    expect(res.status).toBe(201);
    expect(uploadPdfDocument.mock.calls[0][0].bytes).toHaveLength(800);
  });

  it("refuses an empty file", async () => {
    const res = await POST(request(new Uint8Array(0)));
    expect(res.status).toBe(400);
  });

  it("answers 401 when no reMarkable account is connected", async () => {
    requireSession.mockRejectedValue(new NotConnectedError());
    const res = await POST(request(bytes(10)));
    expect(res.status).toBe(401);
    expect(uploadPdfDocument).not.toHaveBeenCalled();
  });

  it.each([
    [415, "That file isn't a PDF."],
    [422, "That PDF is damaged or unreadable, so it can't be uploaded."],
    [404, "That folder no longer exists."],
    [400, "Files can't be uploaded into the trash."],
  ] as const)("passes a %d rejection through with its message", async (status, message) => {
    uploadPdfDocument.mockRejectedValue(new UploadRejectedError(message, status));
    const res = await POST(request(bytes(10)));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: "upload_rejected", message });
  });

  it("hides unexpected errors behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    uploadPdfDocument.mockRejectedValue(new Error("secret internal detail"));
    const res = await POST(request(bytes(10)));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
