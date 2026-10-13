import { connection, type NextRequest } from "next/server";
import { z } from "zod";

import { badRequest, readJsonBody } from "@/lib/http";
import { prayerStore } from "@/lib/prayer/store";
import { mergeTimetable, parseUpload, prayersForDay, removeMonth, summarize } from "@/lib/prayer/timetable";
import { errorResponse } from "@/lib/remarkable/http";
import { requireSession } from "@/lib/session/session";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** a month of days is ~6 KB; this allows a year or so per upload */
const MAX_UPLOAD_BYTES = 512 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/calendar/prayer?day=YYYY-MM-DD: that day's prayer windows (null when switched off or not covered).
 * GET /api/calendar/prayer: the switch and which months are uploaded.
 */
export async function GET(request: NextRequest) {
  await connection();
  const day = request.nextUrl.searchParams.get("day");
  if (day !== null && !DAY.test(day)) return badRequest("Expected day=YYYY-MM-DD.");
  try {
    const { userId } = await requireSession();
    const stored = await prayerStore.load(userId);
    if (day === null) return Response.json(summarize(stored), { headers: NO_STORE });
    const prayers = stored?.enabled ? prayersForDay(stored, day) : null;
    return Response.json({ prayers }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/calendar/prayer: add a timetable (one or more months); days already stored for the same dates are replaced. */
export async function POST(request: Request) {
  const read = await readJsonBody(request, MAX_UPLOAD_BYTES);
  if (!read.ok) return read.response;
  const parsed = parseUpload(read.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(issue ? describeIssue(read.body, issue.path, issue.message) : "That isn't a prayer timetable.");
  }
  try {
    const { userId } = await requireSession();
    const merged = mergeTimetable(await prayerStore.load(userId), parsed.data);
    await prayerStore.save(userId, merged);
    return Response.json({ ...summarize(merged), added: parsed.data.days.length });
  } catch (error) {
    return errorResponse(error);
  }
}

const patchSchema = z.object({ enabled: z.boolean() });

/** PATCH /api/calendar/prayer { enabled }: switch prayer times on or off (uploaded months are kept either way). */
export async function PATCH(request: Request) {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const parsed = patchSchema.safeParse(read.body);
  if (!parsed.success) return badRequest("Expected { enabled: true | false }.");
  try {
    const { userId } = await requireSession();
    const stored = (await prayerStore.load(userId)) ?? { enabled: true, days: [] };
    const next = { ...stored, enabled: parsed.data.enabled };
    await prayerStore.save(userId, next);
    return Response.json(summarize(next));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/calendar/prayer?month=YYYY-MM: remove one uploaded month. */
export async function DELETE(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return badRequest("Expected month=YYYY-MM.");
  try {
    const { userId } = await requireSession();
    const stored = await prayerStore.load(userId);
    if (!stored) return Response.json(summarize(null));
    const next = removeMonth(stored, month);
    await prayerStore.save(userId, next);
    return Response.json(summarize(next));
  } catch (error) {
    return errorResponse(error);
  }
}

/** "Day 3 (2026-10-03), asr: Expected HH:MM (24-hour)." rather than "days.2.asr: ...". */
function describeIssue(body: unknown, path: PropertyKey[], message: string): string {
  const days = Array.isArray(body) ? body : (body as { days?: unknown })?.days;
  const at = Array.isArray(body) ? path : path[0] === "days" ? path.slice(1) : null;
  if (at && typeof at[0] === "number" && Array.isArray(days)) {
    const date = (days[at[0]] as { date?: unknown })?.date;
    const field = at.slice(1).join(".");
    return `Day ${at[0] + 1}${typeof date === "string" ? ` (${date})` : ""}${field ? `, ${field}` : ""}: ${message}`;
  }
  return path.length ? `${path.join(".")}: ${message}` : message;
}
