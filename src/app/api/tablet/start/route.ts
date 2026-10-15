import { startApps } from "@/lib/tablet/installer";
import { isBusy, localOnly, openTablet, withTabletLock } from "@/lib/tablet/session";
import { progressStream } from "@/lib/tablet/stream";

export const maxDuration = 300;

/** POST /api/tablet/start: turn apps back on after the tablet restarted (XOVI is off after every reboot). */
export async function POST(request: Request) {
  const denied = localOnly(request);
  if (denied) return denied;
  if (isBusy()) return Response.json({ error: "busy", message: "Something is already being installed on the tablet." }, { status: 409 });
  return progressStream((report) =>
    withTabletLock(async () => {
      const tablet = await openTablet();
      try {
        await startApps(tablet, report);
      } finally {
        tablet.close();
      }
    }),
  );
}
