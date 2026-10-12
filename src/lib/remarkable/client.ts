import "server-only";

import { AuthError, auth, register, session } from "rmapi-js";

import { endSession, NotConnectedError, readSession, requireSession, type Session, startSession } from "@/lib/session/session";

export { NotConnectedError };

type RemarkableApi = ReturnType<typeof session>;

/** One-time codes from my.remarkable.com are eight lowercase letters. */
export const ONE_TIME_CODE_PATTERN = /^[a-z]{8}$/;

/** Where users get a one-time code for the "browser-chrome" device type. */
export const CONNECT_URL = "https://my.remarkable.com/device/browser/connect";

// Session tokens are short-lived (about a day); renew well before that.
const SESSION_MAX_AGE_MS = 20 * 60 * 60 * 1000;
/** API sessions kept per server instance (one per active user); oldest dropped first. */
const MAX_CACHED_SESSIONS = 500;

/**
 * Short-lived reMarkable API sessions, cached per user in this instance.
 * Losing them (cold start) only costs one token exchange.
 */
const apiSessions = new Map<string, { api: RemarkableApi; createdAt: number }>();

/** Exchange a one-time code for a device token and start a session with it. */
export async function connectDevice(code: string): Promise<void> {
  const deviceToken = await register(code, { deviceDesc: "browser-chrome" });
  const { userId } = await startSession(deviceToken);
  apiSessions.delete(userId);
}

export async function disconnectDevice(): Promise<void> {
  const current = await readSession();
  if (current) apiSessions.delete(current.userId);
  await endSession();
}

export async function isConnected(): Promise<boolean> {
  return (await readSession()) !== null;
}

async function getApi(user: Session, forceNewSession = false): Promise<RemarkableApi> {
  const cached = apiSessions.get(user.userId);
  if (cached && !forceNewSession && Date.now() - cached.createdAt < SESSION_MAX_AGE_MS) {
    // refresh recency so active users stay cached
    apiSessions.delete(user.userId);
    apiSessions.set(user.userId, cached);
    return cached.api;
  }
  const api = session(await auth(user.deviceToken));
  apiSessions.delete(user.userId);
  apiSessions.set(user.userId, { api, createdAt: Date.now() });
  if (apiSessions.size > MAX_CACHED_SESSIONS) apiSessions.delete(apiSessions.keys().next().value!);
  return api;
}

/**
 * Run a call against the current user's cloud account. If the API session
 * was rejected, mint a new one once and retry.
 */
export async function withRemarkable<T>(call: (api: RemarkableApi) => Promise<T>): Promise<T> {
  const user = await requireSession();
  try {
    return await call(await getApi(user));
  } catch (error) {
    const sessionRejected = error instanceof Error && "status" in error && (error as { status: number }).status === 401;
    if (!sessionRejected || error instanceof AuthError) throw error;
    return call(await getApi(user, true));
  }
}
