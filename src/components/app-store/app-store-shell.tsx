"use client";

import { useCallback, useEffect, useState } from "react";

import { type ConnectionStatus, fetchStatus } from "@/lib/client/api";
import { tablet } from "@/lib/client/tablet";
import { type AppId, STORE_APPS } from "@/lib/tablet/catalog";
import type { Step, TabletStatus } from "@/lib/tablet/types";

import { NavRail } from "../nav-rail";
import { AppCard } from "./app-card";
import { type Operation, ProgressPanel } from "./progress-panel";
import { TabletPanel } from "./tablet-panel";

/** how often to look for the tablet while it isn't plugged in or paired, and once it is */
const POLL_SEARCHING_MS = 4000;
const POLL_CONNECTED_MS = 15000;

/**
 * The App Store page: connect the reMarkable over USB-C, then install apps on
 * it. Installs run on this computer's server (it reaches the tablet at
 * 10.11.99.1 over SSH); progress streams back step by step.
 */
export function AppStoreShell() {
  const [rail, setRail] = useState<ConnectionStatus>({ state: "loading" });
  const [status, setStatus] = useState<TabletStatus | null>(null);
  // set when the tablet routes refuse to work here (e.g. the app is hosted)
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [op, setOp] = useState<Operation | null>(null);
  const running = op !== null && op.result === undefined;

  useEffect(() => {
    let active = true;
    fetchStatus().then(
      (next) => active && setRail(next),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await tablet.status());
      setUnavailable(null);
    } catch (e) {
      setUnavailable((e as Error).message);
    }
  }, []);

  // poll for the tablet; faster while it isn't plugged in or paired. Re-armed
  // when the connection changes, and paused while an install runs.
  const searching = !status?.reachable || !status.paired;
  useEffect(() => {
    if (running) return;
    let active = true;
    const load = () =>
      tablet.status().then(
        (next) => {
          if (!active) return;
          setStatus(next);
          setUnavailable(null);
        },
        (e: Error) => active && setUnavailable(e.message),
      );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, searching ? POLL_SEARCHING_MS : POLL_CONNECTED_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [running, searching]);

  async function run(title: string, action: (onStep: (step: Step) => void) => Promise<{ ok: boolean; message?: string }>) {
    setOp({ title, steps: [] });
    const onStep = (step: Step) =>
      setOp((current) => {
        if (!current) return current;
        const at = current.steps.findIndex((s) => s.id === step.id);
        const steps = at < 0 ? [...current.steps, step] : current.steps.map((s, i) => (i === at ? step : s));
        return { ...current, steps };
      });
    let result: { ok: boolean; message?: string };
    try {
      result = await action(onStep);
    } catch (e) {
      result = { ok: false, message: (e as Error).message };
    }
    setOp((current) => (current ? { ...current, result } : current));
    await refresh();
  }

  const state = status?.state ?? null;
  const ready = Boolean(status?.reachable && status.paired && state?.device.supported) && !running && !status?.busy;
  const appsOff = Boolean(state?.platform.xovi && !state.platform.running);

  const install = (id: AppId, name: string) => run(`Installing ${name}`, (onStep) => tablet.install(id, onStep));
  const remove = (id: AppId, name: string) => run(`Removing ${name}`, (onStep) => tablet.remove(id, onStep));

  return (
    <div className="flex h-dvh">
      <NavRail status={rail} refreshing={false} />
      <main className="min-w-0 flex-1 overflow-y-auto font-mono text-sm">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
          <header className="space-y-1">
            <h1 className="text-lg font-bold">App Store</h1>
            <p className="text-xs text-neutral-600">Apps for your reMarkable 2. Plug it into this computer with a USB-C cable to install them.</p>
          </header>

          <TabletPanel
            status={status}
            unavailable={unavailable}
            running={running}
            appsOff={appsOff}
            onPaired={refresh}
            onForget={async () => {
              await tablet.forget();
              await refresh();
            }}
            onTurnOn={() => run("Turning apps on", (onStep) => tablet.start(onStep))}
          />

          {op && <ProgressPanel op={op} onDismiss={running ? undefined : () => setOp(null)} />}

          <section aria-labelledby="apps-heading" className="space-y-2">
            <h2 id="apps-heading" className="font-bold">
              Apps
            </h2>
            <ul className="space-y-3">
              {STORE_APPS.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  installed={state?.apps[app.id]?.installed ?? null}
                  disabled={!ready}
                  disabledReason={!ready ? reasonDisabled(status, running) : undefined}
                  onInstall={() => install(app.id, app.name)}
                  onRemove={() => remove(app.id, app.name)}
                />
              ))}
            </ul>
          </section>

          <p className="border-t border-dashed border-neutral-300 pt-3 text-xs text-neutral-500">
            Apps run on XOVI and AppLoad, open-source tools for the reMarkable, downloaded from their official releases during the
            install. XOVI switches off whenever the tablet restarts; this page then offers to turn apps back on. Not affiliated with
            reMarkable AS.
          </p>
        </div>
      </main>
    </div>
  );
}

function reasonDisabled(status: TabletStatus | null, running: boolean): string {
  if (running || status?.busy) return "An install is running.";
  if (!status?.reachable) return "Plug in your tablet first.";
  if (!status.paired) return "Connect your tablet first.";
  if (status.state && !status.state.device.supported) return "This tablet's software isn't supported yet.";
  return "Waiting for the tablet.";
}
