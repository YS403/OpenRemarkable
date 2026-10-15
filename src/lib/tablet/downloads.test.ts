import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "openremarkable-downloads-"));
});

describe("fetchRelease", () => {
  it("refuses a download whose checksum differs from the pinned one", async () => {
    const { fetchRelease, RELEASES } = await import("./downloads");
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    await expect(fetchRelease(RELEASES.appload, fetcher as unknown as typeof fetch)).rejects.toThrow(/checksum differs/);
  });

  it("reports a failed download", async () => {
    const { fetchRelease, RELEASES } = await import("./downloads");
    const fetcher = vi.fn(async () => new Response("gone", { status: 404 }));
    await expect(fetchRelease(RELEASES.xovi, fetcher as unknown as typeof fetch)).rejects.toThrow(/HTTP 404/);
  });
});
