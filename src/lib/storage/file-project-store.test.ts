import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { emptyProject } from "@/lib/editor/model";

import { FileProjectStore } from "./file-project-store";

const root = await mkdtemp(path.join(tmpdir(), "projects-"));
afterAll(() => rm(root, { recursive: true, force: true }));

const ALICE = "a".repeat(32);
const BOB = "b".repeat(32);
const NOTEBOOK = "2240482a-0000-4000-8000-000000000000";

describe("FileProjectStore", () => {
  const store = new FileProjectStore(root);

  it("keeps each user's projects separate", async () => {
    await store.save(ALICE, emptyProject(NOTEBOOK, "hash"));
    expect(await store.load(ALICE, NOTEBOOK)).toMatchObject({ notebookId: NOTEBOOK });
    expect(await store.load(BOB, NOTEBOOK)).toBeNull();
  });

  it("rejects ids that could escape its directory", async () => {
    await expect(store.load("../etc", NOTEBOOK)).rejects.toThrow("Invalid user id");
    await expect(store.load(ALICE, "../../x")).rejects.toThrow("Invalid notebook id");
  });
});
