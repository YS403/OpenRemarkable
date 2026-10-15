import "server-only";

import { type AppId, STORE_APPS, SUPPORTED_FIRMWARE, SUPPORTED_MODEL } from "./catalog";
import { appPackage, PATCHES, XOVI } from "./apps";
import { fetchRelease, RELEASES } from "./downloads";
import { shellQuote, type Tablet, TabletError } from "./ssh";
import type { Step, TabletState } from "./types";

export type { Step, StepStatus, TabletState } from "./types";

/**
 * Installs apps on a reMarkable 2 over SSH, the same way they were installed
 * by hand: XOVI (tethered: it is off again after every reboot), AppLoad, a
 * per-firmware hashtab for XOVI's QML patcher, then the app's files.
 *
 * The tablet's UI (xochitl) may only start 4 times in 10 minutes; the 5th
 * makes it give up and reboot. Every operation here restarts it at most once
 * and refuses to run when it has already been started recently.
 */

export type Report = (step: Step) => void;

const TMP = "/home/root/.openremarkable-tmp";
const SERVICE = `${XOVI}/services/xochitl.service`;
const HASHTAB = `${PATCHES}/hashtab`;
/** records which firmware the hashtab was built for */
const HASHTAB_FOR = `${PATCHES}/hashtab.openremarkable`;
const OURS = `${XOVI}/.openremarkable`;
/** starts already seen in the last 10 minutes beyond which nothing restarts the UI (limit is 4) */
const MAX_RECENT_STARTS = 2;
const TIME_ZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

async function run(tablet: Tablet, script: string, what: string, timeoutMs?: number): Promise<string> {
  const result = await tablet.exec(script, { timeoutMs });
  if (result.code !== 0) throw new TabletError(`${what} failed: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ") || `exit ${result.code}`}`, "command");
  return result.stdout;
}

/** One round trip: firmware, what's installed, whether XOVI is on, recent UI starts. */
export async function readState(tablet: Tablet): Promise<TabletState> {
  const apps = await Promise.all(STORE_APPS.map(async (app) => ({ id: app.id, marker: (await appPackage(app.id)).marker })));
  const flag = (name: string, test: string) => `if ${test}; then echo ${name}=1; else echo ${name}=0; fi`;
  const script = [
    ". /etc/os-release 2>/dev/null; echo \"firmware=$IMG_VERSION\"",
    "echo \"model=$(cat /sys/devices/soc0/machine 2>/dev/null)\"",
    "echo \"tz=$(cat /etc/timezone 2>/dev/null)\"",
    flag("xovi", `[ -f ${XOVI}/xovi.so ] && [ -x ${XOVI}/start ]`),
    flag("appload", `[ -f ${XOVI}/extensions.d/appload.so ]`),
    flag("hashtab", `[ -s ${HASHTAB} ]`),
    flag("running", "[ -f /etc/systemd/system/xochitl.service.d/00-xovi.conf ]"),
    flag("ours", `[ -f ${OURS} ]`),
    `echo "starts=$(journalctl -u xochitl --since "@$(( $(date +%s) - 600 ))" --no-pager -o cat 2>/dev/null | grep -c "Started reMarkable main")"`,
    ...apps.map(({ id, marker }) => flag(`app.${id}`, `[ -f ${shellQuote(marker)} ]`)),
  ].join("\n");
  const values = Object.fromEntries(
    (await run(tablet, script, "Reading the tablet's state"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]),
  );
  const firmware = values.firmware ?? "";
  const model = values.model ?? "";
  return {
    device: { firmware, model, supported: SUPPORTED_FIRMWARE.includes(firmware) && model === SUPPORTED_MODEL, timeZone: values.tz ?? "" },
    platform: {
      xovi: values.xovi === "1",
      appload: values.appload === "1",
      hashtab: values.hashtab === "1",
      running: values.running === "1",
      ours: values.ours === "1",
      recentStarts: Number(values.starts) || 0,
    },
    apps: Object.fromEntries(STORE_APPS.map((app) => [app.id, { installed: values[`app.${app.id}`] === "1" }])) as TabletState["apps"],
  };
}

function step(report: Report, id: string, label: string) {
  report({ id, label, status: "running" });
  return {
    done: (detail?: string) => report({ id, label, status: "done", detail }),
    skipped: (detail?: string) => report({ id, label, status: "skipped", detail }),
  };
}

function assertCanRestart(state: TabletState) {
  if (state.platform.recentStarts > MAX_RECENT_STARTS) {
    throw new TabletError(
      `The tablet's screen has restarted ${state.platform.recentStarts} times in the last 10 minutes. Wait about 10 minutes and try again (it reboots itself after 5).`,
      "command",
    );
  }
}

function assertSupported(state: TabletState) {
  const { firmware, model, supported } = state.device;
  if (!supported) {
    throw new TabletError(
      model !== SUPPORTED_MODEL
        ? `This installer supports the reMarkable 2 only (this is "${model || "unknown"}").`
        : `Firmware ${firmware || "unknown"} isn't supported yet (tested: ${SUPPORTED_FIRMWARE.join(", ")}). Nothing was changed.`,
      "command",
    );
  }
}

/** Restart the UI with XOVI on, then wait for the app's patch to report in (if it has a ready line). */
async function startXovi(tablet: Tablet, report: Report, readyLog?: string) {
  const s = step(report, "start", "Restarting the tablet's screen with apps on");
  // the tablet's own clock, so the journal window is right even if this computer's differs
  const since = Number((await run(tablet, "date +%s", "Reading the tablet's clock")).trim()) - 2;
  await run(tablet, `${XOVI}/start >/dev/null 2>&1; sleep 3; systemctl is-active xochitl`, "Starting XOVI", 90_000);
  if (!readyLog) return s.done();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const seen = await tablet.exec(`journalctl -u xochitl --since "@${since}" --no-pager -o cat | grep -cF ${shellQuote(readyLog)}`);
    if (Number(seen.stdout.trim()) > 0) return s.done("running");
  }
  throw new TabletError("The tablet restarted, but the app didn't report in. Try “Turn apps on” again, or reinstall.", "command");
}

/** XOVI, AppLoad and the hashtab: what every app here needs. */
async function installPlatform(tablet: Tablet, state: TabletState, report: Report, fetcher?: typeof fetch) {
  const { platform } = state;

  const download = step(report, "download", "Downloading XOVI and AppLoad");
  const needed = [!platform.xovi && RELEASES.xovi, !platform.appload && RELEASES.appload].filter((r) => r !== false);
  const bytes = new Map<string, Uint8Array>();
  for (const release of needed) bytes.set(release.file, await fetchRelease(release, fetcher));
  if (needed.length) download.done(needed.map((r) => r.name).join(" and "));
  else download.skipped("already on the tablet");

  const xovi = step(report, "xovi", "Installing XOVI");
  if (!platform.xovi) {
    await run(tablet, `mkdir -p ${TMP}`, "Preparing");
    await tablet.put(`${TMP}/xovi.tar.gz`, bytes.get(RELEASES.xovi.file)!);
    await run(tablet, `tar -xzf ${TMP}/xovi.tar.gz -C /home/root && touch ${OURS} && rm -f ${TMP}/xovi.tar.gz`, "Unpacking XOVI");
    xovi.done();
  } else xovi.skipped("already installed");

  const appload = step(report, "appload", "Installing AppLoad");
  if (!platform.appload) {
    await run(tablet, `mkdir -p ${TMP}`, "Preparing");
    await tablet.put(`${TMP}/appload.zip`, bytes.get(RELEASES.appload.file)!);
    await run(tablet, `unzip -o -q ${TMP}/appload.zip appload.so -d ${XOVI}/extensions.d/ && rm -f ${TMP}/appload.zip`, "Unpacking AppLoad");
    appload.done();
  } else appload.skipped("already installed");

  // XOVI_ROOT is the service folder, so it must see the extensions (the bundle
  // ships these as links; older hand installs may lack them)
  await run(
    tablet,
    [
      `[ -e ${SERVICE}/extensions.d ] || ln -s ${XOVI}/extensions.d ${SERVICE}/extensions.d`,
      `[ -e ${SERVICE}/exthome ] || ln -s ${XOVI}/exthome ${SERVICE}/exthome`,
      // a per-file link folder (from a hand install) needs links for new extensions
      `if [ -d ${SERVICE}/extensions.d ] && [ ! -L ${SERVICE}/extensions.d ]; then for so in ${XOVI}/extensions.d/*.so; do ln -sfn "$so" "${SERVICE}/extensions.d/$(basename "$so")"; done; fi`,
      `rmdir ${TMP} 2>/dev/null; true`,
    ].join("\n"),
    "Linking extensions",
  );

  const hashtab = step(report, "hashtab", `Preparing XOVI for firmware ${state.device.firmware}`);
  const builtFor = (await tablet.exec(`cat ${HASHTAB_FOR} 2>/dev/null`)).stdout.trim();
  if (platform.hashtab && (builtFor === state.device.firmware || builtFor === "")) {
    // a hand-built hashtab without our note is taken as current
    if (builtFor === "") await run(tablet, `echo ${shellQuote(state.device.firmware)} > ${HASHTAB_FOR}`, "Recording the hashtab version");
    hashtab.skipped("already prepared");
  } else {
    report({ id: "hashtab", label: `Preparing XOVI for firmware ${state.device.firmware}`, status: "running", detail: "about a minute; the tablet's screen goes blank meanwhile" });
    const out = await run(tablet, hashtabScript(state.device.firmware), "Preparing XOVI", 300_000);
    if (!out.includes("HASHTAB_OK")) throw new TabletError("XOVI couldn't prepare for this firmware (no hashtab was made). The tablet was started normally.", "command");
    hashtab.done();
  }
}

/**
 * Run the UI once with the patcher in "create hashtab" mode and stop it when
 * the table is saved (the bundle's rebuild_hashtable, without the prompts).
 * If anything goes wrong the normal UI is started again.
 */
export function hashtabScript(firmware: string): string {
  return `
mkdir -p ${PATCHES}
rm -f ${HASHTAB}
systemctl stop xochitl
if pidof xochitl >/dev/null; then kill -15 $(pidof xochitl); sleep 1; fi
( sleep 240; if pidof xochitl >/dev/null; then kill -15 $(pidof xochitl); fi ) &
WATCH=$!
QMLDIFF_HASHTAB_CREATE=${HASHTAB} QML_DISABLE_DISK_CACHE=1 LD_PRELOAD=${XOVI}/xovi.so /usr/bin/xochitl 2>&1 | while IFS= read -r line; do
  case "$line" in *"Hashtab saved to"*) kill -15 $(pidof xochitl) ;; esac
done
kill $WATCH 2>/dev/null
if [ -s ${HASHTAB} ]; then echo ${shellQuote(firmware)} > ${HASHTAB_FOR}; echo HASHTAB_OK; else systemctl start xochitl; echo HASHTAB_FAILED; fi
`;
}

export interface InstallOptions {
  /** IANA zone from the browser, e.g. "Europe/London"; set on the tablet if valid */
  timeZone?: string;
  fetcher?: typeof fetch;
}

export async function installApp(tablet: Tablet, app: AppId, options: InstallOptions, report: Report): Promise<void> {
  const check = step(report, "check", "Checking the tablet");
  const state = await readState(tablet);
  assertSupported(state);
  assertCanRestart(state);
  check.done(`reMarkable 2, firmware ${state.device.firmware}`);

  await installPlatform(tablet, state, report, options.fetcher);

  const name = STORE_APPS.find((a) => a.id === app)?.name ?? app;
  const copy = step(report, "app", `Copying ${name}`);
  const pkg = await appPackage(app);
  const dirs = [...new Set(pkg.files.map((f) => f.path.replace(/\/[^/]+$/, "")))];
  await run(tablet, `mkdir -p ${dirs.map(shellQuote).join(" ")}`, "Preparing folders");
  for (const file of pkg.files) await tablet.put(file.path, file.bytes);
  copy.done();

  const zone = options.timeZone;
  const tz = step(report, "timezone", "Setting the tablet's time zone");
  if (zone && TIME_ZONE.test(zone) && zone !== state.device.timeZone) {
    // Qt reads /etc/timezone, timedatectl sets /etc/localtime; both are needed
    const out = await run(
      tablet,
      `if [ -f /usr/share/zoneinfo/${zone} ]; then timedatectl set-timezone ${shellQuote(zone)} && echo ${shellQuote(zone)} > /etc/timezone && echo SET; else echo UNKNOWN; fi`,
      "Setting the time zone",
    );
    if (out.includes("SET")) tz.done(zone);
    else tz.skipped(`${zone} isn't known to the tablet`);
  } else tz.skipped(zone && zone === state.device.timeZone ? `already ${zone}` : "kept as is");

  await startXovi(tablet, report, pkg.readyLog);
}

export async function removeApp(tablet: Tablet, app: AppId, report: Report): Promise<void> {
  const check = step(report, "check", "Checking the tablet");
  const state = await readState(tablet);
  if (state.platform.running) assertCanRestart(state);
  check.done();

  const name = STORE_APPS.find((a) => a.id === app)?.name ?? app;
  const remove = step(report, "remove", `Removing ${name}`);
  const pkg = await appPackage(app);
  const paths = [...pkg.dirs, ...pkg.files.map((f) => f.path).filter((p) => !pkg.dirs.some((d) => p.startsWith(`${d}/`)))];
  await run(tablet, `rm -rf ${paths.map(shellQuote).join(" ")}`, `Removing ${name}`);
  remove.done();

  // the patches stay loaded until the UI restarts
  if (state.platform.running) await startXovi(tablet, report);
  else report({ id: "start", label: "Restarting the tablet's screen", status: "skipped", detail: "apps are off already" });
}

/** After a reboot XOVI is off; this turns it back on (one UI restart). */
export async function startApps(tablet: Tablet, report: Report): Promise<void> {
  const check = step(report, "check", "Checking the tablet");
  const state = await readState(tablet);
  if (!state.platform.xovi) throw new TabletError("No apps are installed on this tablet yet.", "command");
  assertSupported(state);
  assertCanRestart(state);
  check.done();
  const installed = STORE_APPS.filter((app) => state.apps[app.id].installed);
  const readyLog = installed.length ? (await appPackage(installed[0].id)).readyLog : undefined;
  await startXovi(tablet, report, readyLog);
}

/** Put the pairing key into the tablet's authorized_keys (once). */
export async function authorizeKey(tablet: Tablet, publicKey: string): Promise<void> {
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( [\w.@-]+)?$/.test(publicKey)) throw new Error("Unexpected public key format.");
  await run(
    tablet,
    `mkdir -p /home/root/.ssh && chmod 700 /home/root/.ssh && touch /home/root/.ssh/authorized_keys && (grep -qxF ${shellQuote(publicKey)} /home/root/.ssh/authorized_keys || echo ${shellQuote(publicKey)} >> /home/root/.ssh/authorized_keys) && chmod 600 /home/root/.ssh/authorized_keys`,
    "Saving the key on the tablet",
  );
}
