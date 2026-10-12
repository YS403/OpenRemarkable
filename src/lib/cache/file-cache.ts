import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A size-bounded, content-addressed file cache with in-flight de-duplication.
 *
 * Keys must be derived from immutable inputs (e.g. a document hash plus the
 * renderer version), so entries never need invalidation, only eviction.
 * Eviction is least-recently-used by file mtime, which reads refresh.
 */
export class FileCache {
  private readonly inFlight = new Map<string, Promise<Uint8Array>>();
  private pruning: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
  ) {}

  async getOrCreate(key: string, create: () => Promise<Uint8Array>): Promise<{ bytes: Uint8Array; hit: boolean }> {
    const cached = await this.read(key);
    if (cached) return { bytes: cached, hit: true };

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = create()
        .then(async (bytes) => {
          await this.write(key, bytes);
          return bytes;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return { bytes: await pending, hit: false };
  }

  private file(key: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid cache key: ${key}`);
    return path.join(this.dir, key);
  }

  private async read(key: string): Promise<Uint8Array | null> {
    const file = this.file(key);
    try {
      const bytes = await readFile(file);
      const now = new Date();
      await utimes(file, now, now).catch(() => {});
      return new Uint8Array(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async write(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // write-then-rename so readers never see a partial file
    const temp = path.join(this.dir, `.tmp-${randomUUID()}`);
    await writeFile(temp, bytes);
    await rename(temp, this.file(key));
    this.pruning ??= this.prune().finally(() => (this.pruning = null));
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.dir)).filter((name) => !name.startsWith(".tmp-"));
    const entries = await Promise.all(
      names.map(async (name) => {
        const info = await stat(path.join(this.dir, name));
        return { name, size: info.size, mtime: info.mtimeMs };
      }),
    );
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    for (const entry of entries.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= this.maxBytes) break;
      await rm(path.join(this.dir, entry.name), { force: true });
      total -= entry.size;
    }
  }
}
