import { describe, expect, it, vi } from "vitest";

import { formatBytes, rejectReason, type UploadFile, type Uploader, UploadQueue } from "./upload-queue";

const MB = 1024 * 1024;

function file(name: string, size = 1000, type = "application/pdf"): UploadFile {
  return Object.assign(new Blob([new Uint8Array(size)], { type }), { name });
}

/** An uploader whose calls the test resolves by hand. */
function controlledUploader() {
  const calls: { name: string; parent: string; onProgress: (f: number) => void; signal: AbortSignal; resolve: (id: string) => void; reject: (e: Error) => void }[] = [];
  const upload: Uploader = (f, { parent, onProgress, signal }) =>
    new Promise((resolve, reject) => {
      const call = { name: f.name, parent, onProgress, signal, resolve: (id: string) => resolve({ id }), reject };
      signal.addEventListener("abort", () => reject(new DOMException("Upload cancelled.", "AbortError")));
      calls.push(call);
    });
  return { upload, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const statuses = (q: UploadQueue) => q.getSnapshot().map((i) => i.status);

describe("rejectReason", () => {
  it("accepts PDFs by type or by extension", () => {
    expect(rejectReason(file("a.pdf"), MB)).toBeNull();
    expect(rejectReason(file("scan.PDF", 10, ""), MB)).toBeNull();
    expect(rejectReason(file("noext", 10, "application/pdf"), MB)).toBeNull();
  });

  it("rejects other types, empty files and files over the limit", () => {
    expect(rejectReason(file("notes.txt", 10, "text/plain"), MB)).toMatch(/Only PDF/);
    expect(rejectReason(file("empty.pdf", 0), MB)).toMatch(/empty/);
    expect(rejectReason(file("big.pdf", MB + 1), MB)).toMatch(/Too large.*1\.0 MB/);
    expect(rejectReason(file("exact.pdf", MB), MB)).toBeNull();
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2 KB"],
    [3.5 * MB, "3.5 MB"],
    [42 * MB, "42 MB"],
  ])("%d → %s", (n, text) => expect(formatBytes(n)).toBe(text));
});

describe("UploadQueue", () => {
  it("uploads one file at a time, in order, into the folder they were added for", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    q.add([file("a.pdf"), file("b.pdf")], "folder-1");
    await tick();
    expect(calls.map((c) => c.name)).toEqual(["a.pdf"]); // b waits
    expect(statuses(q)).toEqual(["uploading", "queued"]);
    expect(calls[0].parent).toBe("folder-1");

    calls[0].resolve("doc-a");
    await tick();
    expect(calls.map((c) => c.name)).toEqual(["a.pdf", "b.pdf"]);
    calls[1].resolve("doc-b");
    await tick();
    expect(statuses(q)).toEqual(["done", "done"]);
    expect(q.getSnapshot().map((i) => i.documentId)).toEqual(["doc-a", "doc-b"]);
    expect(q.busy).toBe(false);
  });

  it("lists rejected files as failed without uploading them, and never retries them", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    q.add([file("notes.txt", 10, "text/plain"), file("big.pdf", 2 * MB)], "");
    await tick();
    expect(calls).toHaveLength(0);
    expect(q.getSnapshot().map((i) => [i.status, i.retryable])).toEqual([
      ["failed", false],
      ["failed", false],
    ]);
    q.retry(q.getSnapshot()[0].id);
    await tick();
    expect(calls).toHaveLength(0);
  });

  it("reports progress in whole percents and never backwards", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    const renders = vi.fn();
    q.subscribe(renders);
    q.add([file("a.pdf")], "");
    await tick();
    const before = renders.mock.calls.length;
    calls[0].onProgress(0.501);
    calls[0].onProgress(0.503); // same whole percent: no update
    calls[0].onProgress(0.4); // backwards: ignored
    expect(q.getSnapshot()[0].progress).toBe(0.5);
    expect(renders.mock.calls.length).toBe(before + 1);
    calls[0].onProgress(1.2); // clamped
    expect(q.getSnapshot()[0].progress).toBe(1);
  });

  it("calls onUploaded after each success only", async () => {
    const { upload, calls } = controlledUploader();
    const uploaded = vi.fn();
    const q = new UploadQueue(upload, MB, uploaded);
    q.add([file("a.pdf"), file("b.pdf")], "");
    await tick();
    calls[0].reject(new Error("PDFs can be up to 4 MB here."));
    await tick();
    calls[1].resolve("doc-b");
    await tick();
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(uploaded.mock.calls[0][0]).toMatchObject({ name: "b.pdf", status: "done" });
  });

  it("keeps the server's message on failure and can retry", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    q.add([file("a.pdf")], "f");
    await tick();
    calls[0].reject(new Error("That PDF is damaged or unreadable, so it can't be uploaded."));
    await tick();
    expect(q.getSnapshot()[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/damaged/), retryable: true });

    q.retry(q.getSnapshot()[0].id);
    await tick();
    expect(calls).toHaveLength(2);
    expect(q.getSnapshot()[0]).toMatchObject({ status: "uploading", error: undefined, progress: 0 });
    calls[1].resolve("doc");
    await tick();
    expect(statuses(q)).toEqual(["done"]);
  });

  it("cancels a queued file without uploading it, and aborts one in progress", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    q.add([file("a.pdf"), file("b.pdf")], "");
    await tick();
    const [a, b] = q.getSnapshot();
    q.cancel(b.id);
    q.cancel(a.id);
    await tick();
    expect(calls[0].signal.aborted).toBe(true);
    expect(statuses(q)).toEqual(["cancelled", "cancelled"]);
    expect(calls).toHaveLength(1); // b never started
    // cancelled uploads can be retried
    q.retry(b.id);
    await tick();
    expect(calls.map((c) => c.name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("clears finished rows but keeps active ones", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    q.add([file("a.pdf"), file("b.pdf"), file("c.txt", 5, "text/plain")], "");
    await tick();
    calls[0].resolve("doc-a");
    await tick();
    q.clearFinished();
    expect(q.getSnapshot().map((i) => [i.name, i.status])).toEqual([["b.pdf", "uploading"]]);
  });

  it("applies a new size limit to files added afterwards", async () => {
    const { upload } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    q.configure({ maxBytes: 10 * MB });
    q.add([file("big.pdf", 5 * MB)], "");
    await tick();
    expect(statuses(q)).toEqual(["uploading"]);
  });

  it("tells completion listeners about each finished upload, not failures", async () => {
    const { upload, calls } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    const completed = vi.fn();
    const stop = q.onCompleted(completed);
    q.add([file("a.pdf"), file("b.pdf")], "");
    await tick();
    calls[0].resolve("doc-a");
    await tick();
    calls[1].reject(new Error("nope"));
    await tick();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][0]).toMatchObject({ name: "a.pdf", status: "done", documentId: "doc-a" });
    stop();
    q.retry(q.getSnapshot()[1].id);
    await tick();
    calls[2].resolve("doc-b");
    await tick();
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const { upload } = controlledUploader();
    const q = new UploadQueue(upload, MB);
    const listener = vi.fn();
    const unsubscribe = q.subscribe(listener);
    q.add([file("a.pdf")], "");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    q.add([file("b.pdf")], "");
    expect(listener).not.toHaveBeenCalled();
  });
});
