import "server-only";

import { cookies } from "next/headers";

import { IS_PRODUCTION, sessionSecret } from "@/lib/server/config";
import { seal, unseal } from "@/lib/session/seal";

import type { CalendarProvider, ConnectionMethod } from "./types";

/** A calendar connection as stored on the server, including its secret link. */
export interface StoredCalendarConnection {
  id: string;
  provider: CalendarProvider;
  method: ConnectionMethod;
  label: string;
  /** the subscription link; anyone holding it can read the calendar */
  url: string;
  connectedAt: string;
}

/** Where calendar connections are kept. A database driver replaces the cookie one later. */
export interface CalendarConnectionStore {
  list(userId: string): Promise<StoredCalendarConnection[]>;
  add(userId: string, connection: StoredCalendarConnection): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
  /** the reMarkable document the calendar syncs into, once created */
  getDocumentId(userId: string): Promise<string | null>;
  setDocumentId(userId: string, documentId: string | null): Promise<void>;
}

interface Payload {
  userId: string;
  connections: StoredCalendarConnection[];
  documentId?: string | null;
}

export const MAX_CONNECTIONS = 5;
const COOKIE = "rm_calendars";
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Keeps connections in an encrypted, httpOnly cookie, so they survive
 * serverless restarts without a database. The payload is bound to the user,
 * so connecting a different reMarkable account in the same browser starts clean.
 */
class CookieCalendarStore implements CalendarConnectionStore {
  private async read(userId: string): Promise<Payload> {
    const empty: Payload = { userId, connections: [] };
    const raw = (await cookies()).get(COOKIE)?.value;
    const json = raw ? unseal(raw, sessionSecret()) : null;
    if (!json) return empty;
    try {
      const payload = JSON.parse(json) as Partial<Payload>;
      if (payload.userId !== userId) return empty;
      return { userId, connections: Array.isArray(payload.connections) ? payload.connections : [], documentId: payload.documentId ?? null };
    } catch {
      return empty;
    }
  }

  private async write(payload: Payload): Promise<void> {
    const store = await cookies();
    if (payload.connections.length === 0 && !payload.documentId) {
      store.delete(COOKIE);
      return;
    }
    store.set(COOKIE, seal(JSON.stringify(payload), sessionSecret()), {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
  }

  async list(userId: string) {
    return (await this.read(userId)).connections;
  }

  async add(userId: string, connection: StoredCalendarConnection) {
    const current = await this.read(userId);
    const connections = [...current.connections.filter((c) => c.url !== connection.url), connection].slice(-MAX_CONNECTIONS);
    await this.write({ ...current, connections });
  }

  async remove(userId: string, id: string) {
    const current = await this.read(userId);
    await this.write({ ...current, connections: current.connections.filter((c) => c.id !== id) });
  }

  async getDocumentId(userId: string) {
    return (await this.read(userId)).documentId ?? null;
  }

  async setDocumentId(userId: string, documentId: string | null) {
    await this.write({ ...(await this.read(userId)), documentId });
  }
}

export const calendarStore: CalendarConnectionStore = new CookieCalendarStore();
