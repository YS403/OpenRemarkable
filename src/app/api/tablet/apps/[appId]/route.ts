import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/http";
import { isAppId } from "@/lib/tablet/catalog";
import { installApp, removeApp } from "@/lib/tablet/installer";
import { isBusy, localOnly, openTablet, withTabletLock } from "@/lib/tablet/session";
import { progressStream } from "@/lib/tablet/stream";

export const maxDuration = 600;

const installSchema = z.object({ timeZone: z.string().max(64).optional() });

type Context = { params: Promise<{ appId: string }> };

/** POST /api/tablet/apps/:appId { timeZone? }: install the app; progress streams back as NDJSON. */
export async function POST(request: Request, { params }: Context) {
  const denied = localOnly(request);
  if (denied) return denied;
  const { appId } = await params;
  if (!isAppId(appId)) return badRequest("Unknown app.", 404);
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const parsed = installSchema.safeParse(read.body);
  if (!parsed.success) return badRequest("Expected { timeZone? }.");
  if (isBusy()) return Response.json({ error: "busy", message: "Something is already being installed on the tablet." }, { status: 409 });
  return progressStream((report) =>
    withTabletLock(async () => {
      const tablet = await openTablet();
      try {
        await installApp(tablet, appId, { timeZone: parsed.data.timeZone }, report);
      } finally {
        tablet.close();
      }
    }),
  );
}

/** DELETE /api/tablet/apps/:appId: remove the app (XOVI and AppLoad stay for other apps). */
export async function DELETE(request: Request, { params }: Context) {
  const denied = localOnly(request);
  if (denied) return denied;
  const { appId } = await params;
  if (!isAppId(appId)) return badRequest("Unknown app.", 404);
  if (isBusy()) return Response.json({ error: "busy", message: "Something is already being installed on the tablet." }, { status: 409 });
  return progressStream((report) =>
    withTabletLock(async () => {
      const tablet = await openTablet();
      try {
        await removeApp(tablet, appId, report);
      } finally {
        tablet.close();
      }
    }),
  );
}
