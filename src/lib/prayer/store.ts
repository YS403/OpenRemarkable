import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "@/lib/server/config";

import { type StoredTimetable, storedTimetableSchema } from "./timetable";

/** Where a user's prayer timetable (all uploaded months, plus the on/off switch) is kept. A database driver replaces the file one later. */
export interface PrayerTimetableStore {
  load(userId: string): Promise<StoredTimetable | null>;
  save(userId: string, timetable: StoredTimetable): Promise<void>;
}

const USER_ID = /^[0-9a-f]{32}$/;

/** One JSON file per user: DATA_DIR/users/<userId>/prayer-timetable.json. */
class FilePrayerTimetableStore implements PrayerTimetableStore {
  constructor(private readonly root = path.join(DATA_DIR, "users")) {}

  private file(userId: string): string {
    if (!USER_ID.test(userId)) throw new Error("Invalid user id.");
    return path.join(this.root, userId, "prayer-timetable.json");
  }

  async load(userId: string): Promise<StoredTimetable | null> {
    try {
      return storedTimetableSchema.parse(JSON.parse(await readFile(this.file(userId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(userId: string, timetable: StoredTimetable): Promise<void> {
    const file = this.file(userId);
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(storedTimetableSchema.parse(timetable)), "utf8");
    await rename(temp, file);
  }
}

export const prayerStore: PrayerTimetableStore = new FilePrayerTimetableStore();
