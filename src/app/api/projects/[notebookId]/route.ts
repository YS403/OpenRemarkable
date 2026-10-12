import { connection } from "next/server";

import { projectSchema } from "@/lib/editor/model";
import { badRequest, readJsonBody, UUID_PATTERN } from "@/lib/http";
import { errorResponse } from "@/lib/remarkable/http";
import { requireSession } from "@/lib/session/session";
import { projectStore } from "@/lib/storage";

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

type Context = { params: Promise<{ notebookId: string }> };

/** GET /api/projects/:notebookId — the saved project, or null if none yet. */
export async function GET(_request: Request, { params }: Context) {
  await connection();
  const { notebookId } = await params;
  if (!UUID_PATTERN.test(notebookId)) return badRequest("Invalid notebook id.");
  try {
    const { userId } = await requireSession();
    return Response.json({ project: await projectStore.load(userId, notebookId) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PUT /api/projects/:notebookId — replace the saved project. */
export async function PUT(request: Request, { params }: Context) {
  const { notebookId } = await params;
  if (!UUID_PATTERN.test(notebookId)) return badRequest("Invalid notebook id.");

  const read = await readJsonBody(request, MAX_PROJECT_BYTES);
  if (!read.ok) return read.response;
  const parsed = projectSchema.safeParse(read.body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_project", message: parsed.error.issues[0]?.message ?? "Invalid project." }, { status: 422 });
  }
  if (parsed.data.notebookId.toLowerCase() !== notebookId.toLowerCase()) return badRequest("Project is for another notebook.");

  try {
    const { userId } = await requireSession();
    const saved = await projectStore.save(userId, parsed.data);
    return Response.json({ updatedAt: saved.updatedAt });
  } catch (error) {
    return errorResponse(error);
  }
}
