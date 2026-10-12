import { disconnectCalendar } from "@/lib/calendar/service";
import { badRequest, UUID_PATTERN } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { requireSession } from "@/lib/session/session";

/** DELETE /api/calendar/connections/:id — forget a connected calendar. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return badRequest("Invalid connection id.");
  try {
    const { userId } = await requireSession();
    await disconnectCalendar(userId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
