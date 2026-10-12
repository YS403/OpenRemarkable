import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Project, projectSchema } from "@/lib/editor/model";
import { DATA_DIR } from "@/lib/server/config";

import type { ProjectStore } from "./index";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID = /^[0-9a-f]{32}$/;

/**
 * One JSON file per project under DATA_DIR/users/<userId>/projects. Durable
 * on a normal server; on serverless hosts DATA_DIR is /tmp, so projects last
 * only as long as the instance (fine for a beta, replace with a database after).
 */
export class FileProjectStore implements ProjectStore {
  constructor(private readonly root = path.join(DATA_DIR, "users")) {}

  private dir(userId: string): string {
    if (!USER_ID.test(userId)) throw new Error("Invalid user id.");
    return path.join(this.root, userId, "projects");
  }

  private file(userId: string, notebookId: string): string {
    if (!UUID.test(notebookId)) throw new Error("Invalid notebook id.");
    return path.join(this.dir(userId), `${notebookId.toLowerCase()}.json`);
  }

  async load(userId: string, notebookId: string): Promise<Project | null> {
    try {
      return projectSchema.parse(JSON.parse(await readFile(this.file(userId, notebookId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(userId: string, project: Project): Promise<Project> {
    const saved = projectSchema.parse({ ...project, updatedAt: new Date().toISOString() });
    const dir = this.dir(userId);
    await mkdir(dir, { recursive: true });
    // write-then-rename so a crash never leaves a half-written project
    const temp = path.join(dir, `.tmp-${randomUUID()}`);
    await writeFile(temp, JSON.stringify(saved), "utf8");
    await rename(temp, this.file(userId, saved.notebookId));
    return saved;
  }
}
