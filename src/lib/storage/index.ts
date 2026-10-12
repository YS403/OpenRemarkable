import "server-only";

import type { Project } from "@/lib/editor/model";
import { STORAGE_DRIVER } from "@/lib/server/config";

import { FileProjectStore } from "./file-project-store";

/**
 * Persistence for user data, always scoped to one user. The app only talks to
 * these interfaces; adding a database means adding a driver here.
 */
export interface ProjectStore {
  load(userId: string, notebookId: string): Promise<Project | null>;
  /** stamps `updatedAt` and returns what was stored */
  save(userId: string, project: Project): Promise<Project>;
}

function createProjectStore(): ProjectStore {
  switch (STORAGE_DRIVER) {
    case "fs":
      return new FileProjectStore();
    // case "postgres": return new PostgresProjectStore(process.env.DATABASE_URL!);
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${STORAGE_DRIVER}".`);
  }
}

export const projectStore: ProjectStore = createProjectStore();
