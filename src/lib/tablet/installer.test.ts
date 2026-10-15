import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./downloads", async (original) => ({
  ...(await original<typeof import("./downloads")>()),
  fetchRelease: vi.fn(async (release?: { file: string }) => new TextEncoder().encode(`bytes of ${release?.file}`)),
}));

import { fetchRelease } from "./downloads";
import { installApp, readState, removeApp, type Step, startApps } from "./installer";
import { readRcc } from "./rcc";
import type { ExecResult, Tablet } from "./ssh";

interface FakeOptions {
  firmware?: string;
  model?: string;
  tz?: string;
  xovi?: boolean;
  appload?: boolean;
  hashtab?: boolean;
  hashtabFor?: string;
  running?: boolean;
  starts?: number;
  alarm?: boolean;
}

/** Answers the installer's scripts from a described tablet, and records what it's asked to do. */
function fakeTablet(o: FakeOptions = {}) {
  const commands: string[] = [];
  const puts = new Map<string, Uint8Array>();
  const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
  const tablet: Tablet = {
    async exec(command) {
      commands.push(command);
      if (command.includes("echo \"firmware=")) {
        const b = (v: boolean | undefined) => (v ? 1 : 0);
        return ok(
          [
            `firmware=${o.firmware ?? "3.25.1.1"}`,
            `model=${o.model ?? "reMarkable 2.0"}`,
            `tz=${o.tz ?? "Universal"}`,
            `xovi=${b(o.xovi)}`,
            `appload=${b(o.appload)}`,
            `hashtab=${b(o.hashtab)}`,
            `running=${b(o.running)}`,
            "ours=0",
            `starts=${o.starts ?? 0}`,
            `app.alarm=${b(o.alarm)}`,
          ].join("\n"),
        );
      }
      if (command.startsWith("cat ") && command.includes("hashtab.openremarkable")) return ok(o.hashtabFor ?? "");
      if (command === "date +%s") return ok("1760000000\n");
      if (command.includes("QMLDIFF_HASHTAB_CREATE")) return ok("HASHTAB_OK\n");
      if (command.includes("grep -cF")) return ok("1\n");
      if (command.includes("/usr/share/zoneinfo/")) return ok("SET\n");
      return ok();
    },
    async put(path, bytes) {
      puts.set(path, bytes);
    },
    close() {},
  };
  return { tablet, commands, puts };
}

function recorder() {
  const steps: Step[] = [];
  return { steps, report: (s: Step) => steps.push(s), final: (id: string) => steps.filter((s) => s.id === id).at(-1)?.status };
}

const ALARM_DIR = "/home/root/xovi/exthome/appload/openremarkable-alarm";
const PATCHES = "/home/root/xovi/exthome/qt-resource-rebuilder";

beforeEach(() => vi.mocked(fetchRelease).mockClear());

describe("readState", () => {
  it("parses the tablet's answers", async () => {
    const { tablet } = fakeTablet({ xovi: true, appload: true, running: true, starts: 2, tz: "Europe/London", alarm: true });
    const state = await readState(tablet);
    expect(state.device).toEqual({ firmware: "3.25.1.1", model: "reMarkable 2.0", supported: true, timeZone: "Europe/London" });
    expect(state.platform).toMatchObject({ xovi: true, appload: true, hashtab: false, running: true, recentStarts: 2 });
    expect(state.apps.alarm.installed).toBe(true);
  });
});

describe("installApp", () => {
  it("sets up a stock tablet from scratch", async () => {
    const { tablet, commands, puts } = fakeTablet();
    const { report, final } = recorder();
    await installApp(tablet, "alarm", { timeZone: "Europe/London" }, report);

    expect(fetchRelease).toHaveBeenCalledTimes(2);
    expect([...puts.keys()]).toEqual([
      "/home/root/.openremarkable-tmp/xovi.tar.gz",
      "/home/root/.openremarkable-tmp/appload.zip",
      `${ALARM_DIR}/manifest.json`,
      `${ALARM_DIR}/resources.rcc`,
      `${PATCHES}/alarm-island.qmd`,
      `${PATCHES}/alarm-sidebar.qmd`,
    ]);
    expect(commands.some((c) => c.startsWith("tar -xzf"))).toBe(true);
    expect(commands.some((c) => c.startsWith("unzip -o -q"))).toBe(true);
    expect(commands.some((c) => c.includes("QMLDIFF_HASHTAB_CREATE"))).toBe(true);
    expect(commands.some((c) => c.includes("timedatectl set-timezone 'Europe/London'") && c.includes("> /etc/timezone"))).toBe(true);
    expect(commands.filter((c) => c.startsWith("/home/root/xovi/start ")).length).toBe(1);
    for (const id of ["check", "download", "xovi", "appload", "hashtab", "app", "timezone", "start"]) expect(final(id)).toBe("done");
  });

  it("builds a working app bundle", async () => {
    const { tablet, puts } = fakeTablet({ xovi: true, appload: true, hashtab: true });
    await installApp(tablet, "alarm", {}, () => {});
    const manifest = JSON.parse(new TextDecoder().decode(puts.get(`${ALARM_DIR}/manifest.json`)));
    expect(manifest).toMatchObject({ id: "openremarkable-alarm", entry: "/ui/alarm.qml" });
    const [qml] = readRcc(puts.get(`${ALARM_DIR}/resources.rcc`)!);
    expect(qml.path).toBe("ui/alarm.qml");
    const text = new TextDecoder().decode(qml.data);
    expect(text).toContain("openremarkableAlarm");
    expect(text).not.toContain("\r");
    expect(new TextDecoder().decode(puts.get(`${PATCHES}/alarm-island.qmd`))).toContain("AFFECT /qml/device/view/main/MainView.qml");
  });

  it("reuses what's already on the tablet", async () => {
    const { tablet, commands } = fakeTablet({ xovi: true, appload: true, hashtab: true, hashtabFor: "", running: true, tz: "Europe/London" });
    const { report, final } = recorder();
    await installApp(tablet, "alarm", { timeZone: "Europe/London" }, report);
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(commands.some((c) => c.includes("QMLDIFF_HASHTAB_CREATE"))).toBe(false);
    // a hand-built hashtab is taken as current and noted
    expect(commands.some((c) => c.includes("echo '3.25.1.1' >") && c.includes("hashtab.openremarkable"))).toBe(true);
    expect(["download", "xovi", "appload", "hashtab", "timezone"].map(final)).toEqual(["skipped", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("rebuilds the hashtab after a firmware change", async () => {
    const { tablet, commands } = fakeTablet({ xovi: true, appload: true, hashtab: true, hashtabFor: "3.24.0.149" });
    await installApp(tablet, "alarm", {}, () => {});
    expect(commands.some((c) => c.includes("QMLDIFF_HASHTAB_CREATE"))).toBe(true);
  });

  it("refuses unsupported firmware before changing anything", async () => {
    const { tablet, puts, commands } = fakeTablet({ firmware: "3.26.0.68" });
    await expect(installApp(tablet, "alarm", {}, () => {})).rejects.toThrow(/3\.26\.0\.68 isn't supported/);
    expect(puts.size).toBe(0);
    expect(commands.length).toBe(1);
  });

  it("refuses other models", async () => {
    const { tablet } = fakeTablet({ model: "reMarkable Ferrari" });
    await expect(installApp(tablet, "alarm", {}, () => {})).rejects.toThrow(/reMarkable 2 only/);
  });

  it("won't restart the UI again soon after several restarts", async () => {
    const { tablet, puts } = fakeTablet({ starts: 3 });
    await expect(installApp(tablet, "alarm", {}, () => {})).rejects.toThrow(/restarted 3 times/);
    expect(puts.size).toBe(0);
  });

  it("ignores a malformed time zone", async () => {
    const { tablet, commands } = fakeTablet({ xovi: true, appload: true, hashtab: true });
    const { report, final } = recorder();
    await installApp(tablet, "alarm", { timeZone: "Europe/London'; reboot; '" }, report);
    expect(commands.some((c) => c.includes("timedatectl"))).toBe(false);
    expect(final("timezone")).toBe("skipped");
  });
});

describe("removeApp", () => {
  it("deletes the app's files and restarts when XOVI is on", async () => {
    const { tablet, commands } = fakeTablet({ xovi: true, appload: true, running: true, alarm: true });
    await removeApp(tablet, "alarm", () => {});
    const rm = commands.find((c) => c.startsWith("rm -rf"))!;
    expect(rm).toContain(`'${ALARM_DIR}'`);
    expect(rm).toContain(`'${PATCHES}/alarm-island.qmd'`);
    expect(rm).toContain(`'${PATCHES}/alarm-sidebar.qmd'`);
    expect(rm).not.toContain(`${ALARM_DIR}/manifest.json`);
    expect(commands.filter((c) => c.startsWith("/home/root/xovi/start ")).length).toBe(1);
  });

  it("doesn't restart when XOVI is off", async () => {
    const { tablet, commands } = fakeTablet({ xovi: true, appload: true, running: false, alarm: true });
    await removeApp(tablet, "alarm", () => {});
    expect(commands.some((c) => c.startsWith("/home/root/xovi/start "))).toBe(false);
  });
});

describe("startApps", () => {
  it("turns XOVI back on once", async () => {
    const { tablet, commands } = fakeTablet({ xovi: true, appload: true, hashtab: true, alarm: true });
    await startApps(tablet, () => {});
    expect(commands.filter((c) => c.startsWith("/home/root/xovi/start ")).length).toBe(1);
  });

  it("needs XOVI installed", async () => {
    const { tablet } = fakeTablet();
    await expect(startApps(tablet, () => {})).rejects.toThrow(/No apps are installed/);
  });
});
