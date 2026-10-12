import "server-only";

import { createHash } from "node:crypto";

import { cookies } from "next/headers";

import { IS_PRODUCTION, sessionSecret } from "@/lib/server/config";

import { seal, unseal } from "./seal";

/**
 * Who is making the request. Each browser that connects a reMarkable account
 * gets its own session; nothing is shared between users.
 *
 * For now the session lives entirely in an encrypted, httpOnly cookie, so no
 * database is needed. With a database, the cookie would carry only a session
 * id and `readSession`/`startSession`/`endSession` would look it up; callers
 * don't change.
 */
export interface Session {
  /** stable, non-secret id for this reMarkable connection; used to namespace stored data */
  userId: string;
  /** grants full account access: never sent to the browser in readable form */
  deviceToken: string;
}

const COOKIE = "rm_session";
/** Device tokens don't expire, so the session lasts until the user disconnects. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60; // browsers cap cookie lifetimes at 400 days

interface Payload {
  deviceToken: string;
  connectedAt: string;
}

export const userIdFor = (deviceToken: string) => createHash("sha256").update(deviceToken).digest("hex").slice(0, 32);

/** Thrown when a request needs a connected reMarkable account and has none. */
export class NotConnectedError extends Error {
  constructor() {
    super("No reMarkable account is connected.");
    this.name = "NotConnectedError";
  }
}

/** The current session, or NotConnectedError (mapped to 401 by the API layer). */
export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (!session) throw new NotConnectedError();
  return session;
}

export async function readSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const json = unseal(raw, sessionSecret());
  if (!json) return null;
  try {
    const payload = JSON.parse(json) as Partial<Payload>;
    if (typeof payload.deviceToken !== "string" || !payload.deviceToken) return null;
    return { userId: userIdFor(payload.deviceToken), deviceToken: payload.deviceToken };
  } catch {
    return null;
  }
}

/** Start a session for a newly registered device. Only callable from route handlers and server functions. */
export async function startSession(deviceToken: string): Promise<Session> {
  const payload: Payload = { deviceToken, connectedAt: new Date().toISOString() };
  (await cookies()).set(COOKIE, seal(JSON.stringify(payload), sessionSecret()), {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return { userId: userIdFor(deviceToken), deviceToken };
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
