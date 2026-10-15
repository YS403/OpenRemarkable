/** Shapes shared by the tablet routes and the App Store page. */
import type { AppId } from "./catalog";

export interface TabletState {
  device: { firmware: string; model: string; supported: boolean; timeZone: string };
  platform: {
    xovi: boolean;
    appload: boolean;
    hashtab: boolean;
    /** XOVI is active right now (it is off after every reboot) */
    running: boolean;
    /** XOVI was installed by this app */
    ours: boolean;
    /** UI starts in the last 10 minutes */
    recentStarts: number;
  };
  apps: Record<AppId, { installed: boolean }>;
}

export interface TabletStatus {
  /** plugged in over USB-C (its SSH port answers) */
  reachable: boolean;
  /** this computer has a key on the tablet */
  paired: boolean;
  /** an install is running */
  busy: boolean;
  state: TabletState | null;
  /** why the tablet couldn't be read, when it's plugged in */
  problem?: string;
}

export type StepStatus = "running" | "done" | "skipped" | "failed";

export interface Step {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

/** One line of the NDJSON progress stream sent while installing. */
export type ProgressEvent = { type: "step"; step: Step } | { type: "result"; ok: boolean; message?: string };
