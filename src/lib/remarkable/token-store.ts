import "server-only";

import { readdir, readFile, rename, rm, mkdir } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, IS_SERVERLESS } from "@/lib/server/config";
import { readSession, startSession } from "@/lib/session/session";

/**
 * One-time migration for local installs from before per-user sessions, which
 * kept a single device token in .data/remarkable-device.json and projects in
 * .data/projects. On the next status check the token moves into this
 * browser's session cookie and the projects move under that user, so nobody
 * has to reconnect. Does nothing on serverless hosts.
 */
export async function adoptLegacyDevice(): Promise<void> {
  if (IS_SERVERLESS) return;
  const tokenFile = path.join(DATA_DIR, "remarkable-device.json");
  let deviceToken: unknown;
  try {
    ({ deviceToken } = JSON.parse(await readFile(tokenFile, "utf8")) as { deviceToken?: unknown });
  } catch {
    return; // nothing to migrate
  }
  if (typeof deviceToken !== "string" || !deviceToken || (await readSession())) return;

  const { userId } = await startSession(deviceToken);
  const legacyProjects = path.join(DATA_DIR, "projects");
  const target = path.join(DATA_DIR, "users", userId, "projects");
  try {
    const files = (await readdir(legacyProjects)).filter((f) => f.endsWith(".json"));
    await mkdir(target, { recursive: true });
    for (const file of files) await rename(path.join(legacyProjects, file), path.join(target, file));
  } catch {
    // no legacy projects
  }
  await rm(tokenFile, { force: true });
  console.info(`[session] adopted the legacy device token into a session for user ${userId}`);
}
