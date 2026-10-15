import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "@/lib/server/config";

/**
 * Third-party tablet software, fetched from its official GitHub releases at
 * install time (not shipped with this app) and checked against a pinned
 * SHA-256, so a changed or tampered file is refused. Versions are the ones
 * tested on firmware 3.25.1.1; newer AppLoad (0.5.x) doesn't patch 3.25.
 */
export const RELEASES = {
  /** XOVI 0.3.2 + qt-resource-rebuilder, from rm-xovi-extensions v18 (reMarkable 2, arm32) */
  xovi: {
    name: "XOVI",
    url: "https://github.com/asivery/rm-xovi-extensions/releases/download/v18-23032026/xovi-arm32.tar.gz",
    sha256: "f1db3eeefb486e21b52a1307b3372da09958cd1835eb82d9ab3c51ff698aefae",
    file: "xovi-arm32-v18.tar.gz",
  },
  /** AppLoad 0.4.2: runs QML apps inside the tablet UI */
  appload: {
    name: "AppLoad",
    url: "https://github.com/asivery/rm-appload/releases/download/v0.4.2/appload-arm32.zip",
    sha256: "a43d17c0fb9f3db721810f3d6b75c61076cc1385058cd8af4873698bdf1e1813",
    file: "appload-arm32-v0.4.2.zip",
  },
} as const;

export type Release = (typeof RELEASES)[keyof typeof RELEASES];

const CACHE = path.join(DATA_DIR, "tablet", "downloads");
const MAX_BYTES = 64 * 1024 * 1024;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The release's bytes, from the local cache or downloaded, always hash-checked. */
export async function fetchRelease(release: Release, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const cached = path.join(CACHE, release.file);
  try {
    const bytes = new Uint8Array(await readFile(cached));
    if (sha256(bytes) === release.sha256) return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const response = await fetcher(release.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Downloading ${release.name} failed (HTTP ${response.status}).`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error(`${release.name} download is unexpectedly large.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`${release.name} download is unexpectedly large.`);
  if (sha256(bytes) !== release.sha256) {
    throw new Error(`${release.name} download doesn't match the tested version (checksum differs), so it wasn't installed.`);
  }

  await mkdir(CACHE, { recursive: true });
  const temp = `${cached}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, cached);
  return bytes;
}
