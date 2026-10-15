import { connection } from "next/server";

import type { TabletStatus } from "@/lib/tablet/types";
import { readState } from "@/lib/tablet/installer";
import { pairing } from "@/lib/tablet/keystore";
import { isBusy, localOnly, openTablet } from "@/lib/tablet/session";
import { reachable, TabletError } from "@/lib/tablet/ssh";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/tablet: is a tablet plugged in, paired, and what's installed on it. */
export async function GET(request: Request) {
  await connection();
  const denied = localOnly(request);
  if (denied) return denied;
  const paired = Boolean(await pairing());
  const status: TabletStatus = { reachable: await reachable(), paired, busy: isBusy(), state: null };
  // while installing, the installer owns the connection and the UI may be restarting
  if (!status.reachable || !paired || status.busy) return Response.json(status, { headers: NO_STORE });
  try {
    const tablet = await openTablet();
    try {
      status.state = await readState(tablet);
    } finally {
      tablet.close();
    }
  } catch (error) {
    if (error instanceof TabletError && error.kind === "auth") {
      // e.g. after a firmware update replaced authorized_keys
      status.paired = false;
      status.problem = "The tablet no longer accepts this computer's key (a software update can reset it). Connect again with the password.";
    } else {
      status.problem = (error as Error).message;
    }
  }
  return Response.json(status, { headers: NO_STORE });
}
