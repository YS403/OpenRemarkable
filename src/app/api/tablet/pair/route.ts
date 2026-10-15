import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/http";
import { authorizeKey } from "@/lib/tablet/installer";
import { forgetHost, keyPair, pinHost, pinnedHost } from "@/lib/tablet/keystore";
import { localOnly, tabletErrorResponse, withTabletLock } from "@/lib/tablet/session";
import { connectTablet } from "@/lib/tablet/ssh";

const bodySchema = z.object({ password: z.string().min(1).max(256) });

/**
 * POST /api/tablet/pair { password }: log in once with the tablet's root
 * password, add this computer's key to it and pin its host key. The password
 * is only used for this login; it isn't stored or logged.
 */
export async function POST(request: Request) {
  const denied = localOnly(request);
  if (denied) return denied;
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return badRequest("Enter the tablet's password.");
  try {
    return await withTabletLock(async () => {
      const pinned = await pinnedHost();
      const { publicKey } = await keyPair();
      // first pairing pins whatever answers on the USB address; later ones must match
      const { tablet, hostFingerprint } = await connectTablet({ password: parsed.data.password }, (fp) => !pinned || fp === pinned);
      try {
        await authorizeKey(tablet, publicKey);
      } finally {
        tablet.close();
      }
      await pinHost(hostFingerprint);
      return Response.json({ paired: true, hostFingerprint });
    });
  } catch (error) {
    return tabletErrorResponse(error);
  }
}

/** DELETE /api/tablet/pair: forget the tablet on this computer (to pair a different one). */
export async function DELETE(request: Request) {
  const denied = localOnly(request);
  if (denied) return denied;
  await forgetHost();
  return Response.json({ paired: false });
}
