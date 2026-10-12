import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, uploadPdf } from "./api";

/** Minimal XMLHttpRequest stand-in that the test drives by hand. */
class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  response: unknown = null;
  responseType = "";
  aborted = false;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, response: unknown) {
    this.status = status;
    this.response = response;
    this.onload?.();
  }
}

const file = Object.assign(new Blob([new Uint8Array(10)], { type: "application/pdf" }), { name: "My Report.pdf" });

beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));
afterEach(() => vi.unstubAllGlobals());

describe("uploadPdf (browser)", () => {
  it("posts the raw file with name and folder in the query, and reports progress", async () => {
    const progress: number[] = [];
    const done = uploadPdf(file, { parent: "folder-1", onProgress: (f) => progress.push(f) });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/remarkable/upload?name=My+Report.pdf&parent=folder-1");
    expect(xhr.headers["content-type"]).toBe("application/pdf");
    expect(xhr.body).toBe(file);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 7, total: 0 }); // ignored
    xhr.respond(201, { id: "d", name: "My Report", pages: 1 });
    await expect(done).resolves.toEqual({ id: "d", name: "My Report", pages: 1 });
    expect(progress).toEqual([0.5]);
  });

  it("rejects with the server's message and status", async () => {
    const done = uploadPdf(file, { parent: "" });
    FakeXhr.last.respond(413, { error: "too_large", message: "PDFs can be up to 4 MB here." });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "PDFs can be up to 4 MB here.", status: 413 });
  });

  it("falls back to a generic message when the body isn't JSON", async () => {
    const done = uploadPdf(file, { parent: "" });
    FakeXhr.last.respond(502, null);
    await expect(done).rejects.toThrow("Upload failed (502).");
  });

  it("reports network errors", async () => {
    const done = uploadPdf(file, { parent: "" });
    FakeXhr.last.onerror?.();
    await expect(done).rejects.toThrow(/Network error/);
  });

  it("aborts when the signal fires, and refuses an already-aborted signal", async () => {
    const controller = new AbortController();
    const done = uploadPdf(file, { parent: "", signal: controller.signal });
    controller.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ name: "AbortError" });

    const pre = new AbortController();
    pre.abort();
    await expect(uploadPdf(file, { parent: "", signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
