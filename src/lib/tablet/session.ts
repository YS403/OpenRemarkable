import "server-only";

import { IS_SERVERLESS } from "@/lib/server/config";

import { pairing } from "./keystore";
import { connectTablet, type Tablet, TabletError } from "./ssh";

/**
 * The tablet routes give root access to a device on this computer's USB-C
 * port, so they only answer when the app runs locally, and only to this app's
 * own pages: the Host must be localhost (which also defeats DNS rebinding) and
 * state-changing requests must come from the same origin.
 */
export function localOnly(request: Request): Response | null {
  const deny = (message: string) => Response.json({ error: "forbidden", message }, { status: 403 });
  if (IS_SERVERLESS) return deny("Installing on a tablet only works when OpenRemarkable runs on your own computer.");
  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return deny("Open OpenRemarkable at http://localhost to manage your tablet.");
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== host) return deny("Requests must come from this app.");
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return deny("Requests must come from this app.");
  }
  return null;
}

let busy = false;

/** One tablet operation at a time (installs restart the tablet's UI). */
export async function withTabletLock<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new TabletError("Something is already being installed on the tablet. Wait for it to finish.", "busy");
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

export const isBusy = () => busy;

/** Connect with this computer's key to the pinned tablet. */
export async function openTablet(): Promise<Tablet> {
  const paired = await pairing();
  if (!paired) throw new TabletError("Connect your tablet first.", "not-paired");
  const { tablet } = await connectTablet({ privateKey: paired.privateKey }, (fp) => fp === paired.hostFingerprint);
  return tablet;
}

/** Response for a failed tablet call, with a status code the page can act on. */
export function tabletErrorResponse(error: unknown): Response {
  if (error instanceof TabletError) {
    const status = { unreachable: 503, auth: 401, "host-key": 409, command: 502, "not-paired": 428, busy: 409 }[error.kind];
    return Response.json({ error: error.kind, message: error.message }, { status });
  }
  console.error("tablet:", error);
  return Response.json({ error: "internal", message: (error as Error)?.message || "Something went wrong." }, { status: 500 });
}
