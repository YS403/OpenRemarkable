import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { utils } from "ssh2";

import { DATA_DIR } from "@/lib/server/config";

/**
 * What this computer remembers about the tablet, under DATA_DIR/tablet/:
 * an SSH key pair made here (its public half goes into the tablet's
 * authorized_keys when pairing) and the tablet's host-key fingerprint.
 * The root password is used once to pair and never stored.
 */
const DIR = path.join(DATA_DIR, "tablet");
const PRIVATE_KEY = path.join(DIR, "id_ed25519");
const PUBLIC_KEY = path.join(DIR, "id_ed25519.pub");
const HOST = path.join(DIR, "host.json");

export interface Pairing {
  privateKey: string;
  hostFingerprint: string;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** This computer's key pair, made on first use. */
export async function keyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const [privateKey, publicKey] = await Promise.all([readText(PRIVATE_KEY), readText(PUBLIC_KEY)]);
  if (privateKey && publicKey) return { privateKey, publicKey: publicKey.trim() };
  const made = utils.generateKeyPairSync("ed25519", { comment: "openremarkable" });
  await mkdir(DIR, { recursive: true });
  await writeFile(PRIVATE_KEY, made.private, { mode: 0o600 });
  await writeFile(PUBLIC_KEY, `${made.public}\n`, { mode: 0o644 });
  return { privateKey: made.private, publicKey: made.public.trim() };
}

/** The pinned tablet, if one has been paired. */
export async function pinnedHost(): Promise<string | null> {
  const raw = await readText(HOST);
  if (!raw) return null;
  try {
    const { fingerprint } = JSON.parse(raw) as { fingerprint?: unknown };
    return typeof fingerprint === "string" ? fingerprint : null;
  } catch {
    return null;
  }
}

export async function pinHost(fingerprint: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(HOST, JSON.stringify({ fingerprint, pairedAt: new Date().toISOString() }));
}

/** Key and pinned host, or null when no tablet is paired. */
export async function pairing(): Promise<Pairing | null> {
  const hostFingerprint = await pinnedHost();
  const privateKey = await readText(PRIVATE_KEY);
  return hostFingerprint && privateKey ? { privateKey, hostFingerprint } : null;
}

/** Forget the tablet (the key pair stays, so pairing again reuses it). */
export async function forgetHost(): Promise<void> {
  await rm(HOST, { force: true });
}
