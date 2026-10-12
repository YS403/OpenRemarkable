import { z } from "zod";

import { syncCalendar } from "@/lib/calendar/sync";
import { badRequest, readJsonBody } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { requireSession } from "@/lib/session/session";
import { TEMPLATES, type TemplateId } from "@/lib/templates/names";

const DAY_MS = 86_400_000;

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const bodySchema = z.object({
  template: z.enum(TEMPLATES.map((t) => t.id) as [TemplateId, ...TemplateId[]]),
  timeZone: z.string().max(64).refine(isTimeZone, "Unknown time zone."),
  // the viewer's "today"; must be within a day of the server's, whatever the time zone
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => Math.abs(Date.parse(`${d}T12:00:00Z`) - Date.now()) < 2 * DAY_MS, "today is not today."),
});

// reads 7 days of calendars, renders pages and writes to the reMarkable cloud
export const maxDuration = 60;

/** POST /api/calendar/sync — bring the calendar document on reMarkable up to date (today + 6 days). */
export async function POST(request: Request) {
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request.");
  }
  try {
    const { userId } = await requireSession();
    const result = await syncCalendar(userId, parsed.data);
    console.info(`[calendar] sync: +${result.added.length} days, ${result.updated.length} updated, created=${result.created}`);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
