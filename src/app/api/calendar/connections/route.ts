import { connection } from "next/server";
import { z } from "zod";

import { connectCalendarLink, listConnections } from "@/lib/calendar/service";
import { badRequest, readJsonBody } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { requireSession } from "@/lib/session/session";

const connectSchema = z.discriminatedUnion("method", [
  z.object({ provider: z.enum(["outlook", "google"]), method: z.literal("ics"), url: z.string().trim().min(1).max(2048) }),
  z.object({ provider: z.enum(["outlook", "google"]), method: z.literal("oauth") }),
]);

/** GET /api/calendar/connections — the user's connected calendars (links are never returned). */
export async function GET() {
  await connection();
  try {
    const { userId } = await requireSession();
    return Response.json({ connections: await listConnections(userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

// connecting fetches and parses the whole calendar once
export const maxDuration = 30;

/** POST /api/calendar/connections — connect a calendar by subscription link. */
export async function POST(request: Request) {
  const read = await readJsonBody(request, 8 * 1024);
  if (!read.ok) return read.response;
  const parsed = connectSchema.safeParse(read.body);
  if (!parsed.success) return badRequest("Paste a calendar link to connect.");
  if (parsed.data.method === "oauth") {
    const who = parsed.data.provider === "google" ? "Google" : "Microsoft";
    return Response.json({ error: "not_available", message: `Signing in with ${who} isn't available yet. Use a calendar link for now.` }, { status: 501 });
  }
  try {
    const { userId } = await requireSession();
    return Response.json({ connection: await connectCalendarLink(userId, parsed.data.provider, parsed.data.url) });
  } catch (error) {
    return errorResponse(error);
  }
}
