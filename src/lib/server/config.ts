import "server-only";

import path from "node:path";

/**
 * Server configuration, read once from the environment. Everything that
 * differs between local development and a hosted deployment lives here.
 */

const MB = 1024 * 1024;

/** Running on Vercel (or any serverless host with a read-only project directory). */
export const IS_SERVERLESS = Boolean(process.env.VERCEL);
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Writable directory for the file-based storage driver and caches. Serverless
 * hosts only allow writes under /tmp, which is per-instance and short-lived.
 */
export const DATA_DIR = process.env.DATA_DIR ?? (IS_SERVERLESS ? "/tmp/myremarkable" : path.join(process.cwd(), ".data"));

/** Storage driver for user data. Only "fs" exists until a database is added. */
export const STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? "fs";

export const PDF_CACHE_BYTES = positiveInt(process.env.PDF_CACHE_MAX_MB, IS_SERVERLESS ? 256 : 1024) * MB;
export const PDF_RENDER_CONCURRENCY = positiveInt(process.env.PDF_RENDER_CONCURRENCY, 2);

/**
 * Largest PDF accepted for upload. Serverless hosts cap request bodies (Vercel:
 * 4.5 MB including headers), so the default stays under that there.
 */
export const UPLOAD_MAX_BYTES = positiveInt(process.env.UPLOAD_MAX_MB, IS_SERVERLESS ? 4 : 100) * MB;

/** Key material for session cookies. Required in production; a fixed dev key otherwise. */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (IS_PRODUCTION) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters (e.g. `openssl rand -base64 48`).");
  }
  return "development-only-session-secret-do-not-use-in-production";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
