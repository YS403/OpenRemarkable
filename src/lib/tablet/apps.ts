import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AppId } from "./catalog";
import { buildRcc } from "./rcc";

export const XOVI = "/home/root/xovi";
export const APPLOAD_APPS = `${XOVI}/exthome/appload`;
export const PATCHES = `${XOVI}/exthome/qt-resource-rebuilder`;

export interface AppFile {
  /** absolute path on the tablet */
  path: string;
  bytes: Uint8Array;
}

export interface AppPackage {
  files: AppFile[];
  /** a file whose presence means the app is installed */
  marker: string;
  /** directories the app owns entirely (removed on uninstall) */
  dirs: string[];
  /** journal line that shows the app's patch is running after a restart */
  readyLog?: string;
}

const SOURCES = path.join(process.cwd(), "src", "lib", "tablet", "apps");

/** a source file, with Windows line endings removed for the tablet */
async function source(app: AppId, name: string): Promise<Uint8Array> {
  const text = await readFile(path.join(SOURCES, app, name), "utf8");
  return new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
}

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 4)}\n`);

/** Everything an app puts on the tablet. AppLoad app bundles are built here (manifest + resources.rcc). */
export async function appPackage(app: AppId): Promise<AppPackage> {
  switch (app) {
    case "alarm": {
      const dir = `${APPLOAD_APPS}/openremarkable-alarm`;
      return {
        marker: `${dir}/manifest.json`,
        dirs: [dir],
        readyLog: "[openremarkable-alarm] layer ready",
        files: [
          {
            path: `${dir}/manifest.json`,
            bytes: json({
              id: "openremarkable-alarm",
              name: "Alarm",
              loadsBackend: false,
              entry: "/ui/alarm.qml",
              supportsScaling: false,
              canHaveMultipleFrontends: false,
            }),
          },
          { path: `${dir}/resources.rcc`, bytes: buildRcc([{ path: "ui/alarm.qml", data: await source("alarm", "alarm.qml") }]) },
          // the alarm itself and its notification, running in the main UI
          { path: `${PATCHES}/alarm-island.qmd`, bytes: await source("alarm", "alarm-island.qmd") },
          // the "Alarm" entry in the sidebar
          { path: `${PATCHES}/alarm-sidebar.qmd`, bytes: await source("alarm", "alarm-sidebar.qmd") },
        ],
      };
    }
  }
}
