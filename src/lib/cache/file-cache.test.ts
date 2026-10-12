import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileCache } from "./file-cache";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rm-cache-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (n: number) => new Uint8Array(n).fill(7);

describe("FileCache", () => {
  it("creates once, then serves from disk", async () => {
    const cache = new FileCache(dir, 1_000_000);
    let calls = 0;
    const create = async () => {
      calls++;
      return bytes(10);
    };
    expect((await cache.getOrCreate("a.pdf", create)).hit).toBe(false);
    const second = await cache.getOrCreate("a.pdf", create);
    expect(second.hit).toBe(true);
    expect(second.bytes).toEqual(bytes(10));
    expect(calls).toBe(1);
  });

  it("de-duplicates concurrent requests for the same key", async () => {
    const cache = new FileCache(dir, 1_000_000);
    let calls = 0;
    const create = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return bytes(5);
    };
    await Promise.all([cache.getOrCreate("k", create), cache.getOrCreate("k", create), cache.getOrCreate("k", create)]);
    expect(calls).toBe(1);
  });

  it("evicts the least recently used entries past the size limit", async () => {
    const cache = new FileCache(dir, 25);
    for (const key of ["one", "two", "three"]) {
      await cache.getOrCreate(key, async () => bytes(10));
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 50)); // pruning runs after the write
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(["three", "two"]);
  });

  it("rejects keys that could escape the cache directory", async () => {
    const cache = new FileCache(dir, 100);
    await expect(cache.getOrCreate("../evil", async () => bytes(1))).rejects.toThrow("Invalid cache key");
  });
});
