import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for values stored in cookies. The
 * browser can hold them but can neither read nor alter them.
 */

const VERSION = "v1";

const KEY_LABEL = "openremarkable-session";
/** label used before the app was renamed; still accepted so existing sessions stay signed in */
const LEGACY_KEY_LABEL = "myremarkable-session";

const keyFrom = (secret: string, label = KEY_LABEL) => createHash("sha256").update(`${label}:${secret}`).digest();

export function seal(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** The original value, or null if the token was tampered with, malformed, or sealed with another key. */
export function unseal(token: string, secret: string): string | null {
  return open(token, keyFrom(secret)) ?? open(token, keyFrom(secret, LEGACY_KEY_LABEL));
}

function open(token: string, key: Buffer): string | null {
  const [version, iv, body, tag] = token.split(".");
  if (version !== VERSION || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
