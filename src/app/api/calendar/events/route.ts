import type { NextRequest } from "next/server";

import { eventsForDay } from "@/lib/calendar/service";
import { badRequest } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { requireSession } from "@/lib/session/session";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const maxDuration = 30;

/** GET /api/calendar/events?day=YYYY-MM-DD&tz=Area/City — meetings around a day from every connected calendar. */
export async function GET(request: NextRequest) {
  const day = request.nextUrl.searchParams.get("day") ?? "";
  const tz = request.nextUrl.searchParams.get("tz") ?? "UTC";
  if (!DAY.test(day)) return badRequest("Expected day=YYYY-MM-DD.");
  if (tz.length > 64 || !isTimeZone(tz)) return badRequest("Unknown time zone.");
  try {
    const { userId } = await requireSession();
    const result = await eventsForDay(userId, day, tz);
    // private: personal data; short max-age so stepping back and forth between days is instant
    return Response.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return errorResponse(error);
  }
}
