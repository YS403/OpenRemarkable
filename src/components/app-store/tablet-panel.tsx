"use client";

import { DeviceTablet, Plug, Power } from "@phosphor-icons/react";
import { useState } from "react";

import { tablet } from "@/lib/client/tablet";
import { SUPPORTED_FIRMWARE } from "@/lib/tablet/catalog";
import type { TabletStatus } from "@/lib/tablet/types";

/**
 * The tablet's connection: waiting for USB-C, asking for the root password
 * once, or showing which tablet is connected (and that apps are off after a
 * restart).
 */
export function TabletPanel({
  status,
  unavailable,
  running,
  appsOff,
  onPaired,
  onForget,
  onTurnOn,
}: {
  status: TabletStatus | null;
  unavailable: string | null;
  running: boolean;
  appsOff: boolean;
  onPaired: () => Promise<void>;
  onForget: () => Promise<void>;
  onTurnOn: () => void;
}) {
  return (
    <section aria-labelledby="tablet-heading" className="border border-neutral-400">
      <h2 id="tablet-heading" className="flex items-center gap-2 border-b border-dashed border-neutral-300 px-3 py-2 font-bold">
        <DeviceTablet size={16} aria-hidden />
        Your tablet
      </h2>
      <div className="space-y-2 px-3 py-3">
        <Body status={status} unavailable={unavailable} running={running} appsOff={appsOff} onPaired={onPaired} onForget={onForget} onTurnOn={onTurnOn} />
      </div>
    </section>
  );
}

function Body({
  status,
  unavailable,
  running,
  appsOff,
  onPaired,
  onForget,
  onTurnOn,
}: Parameters<typeof TabletPanel>[0]) {
  if (unavailable) return <p role="alert">! {unavailable}</p>;
  if (!status) return <p className="text-neutral-500">Looking for your tablet…</p>;

  if (!status.reachable) {
    return (
      <div className="flex items-start gap-2">
        <Plug size={16} className="mt-0.5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>No tablet found.</p>
          <p className="text-xs text-neutral-600">Plug your reMarkable 2 into this computer with a USB-C cable and unlock it. This page checks again every few seconds.</p>
        </div>
      </div>
    );
  }

  if (!status.paired) return <PairForm problem={status.problem} onPaired={onPaired} />;

  const state = status.state;
  if (!state) {
    return <p className="text-neutral-500">{status.busy ? "An install is running…" : (status.problem ? `! ${status.problem}` : "Reading the tablet…")}</p>;
  }

  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
        <dt className="text-neutral-500">model</dt>
        <dd>{state.device.model === "reMarkable 2.0" ? "reMarkable 2" : state.device.model || "unknown"}</dd>
        <dt className="text-neutral-500">software</dt>
        <dd>{state.device.firmware || "unknown"}</dd>
        <dt className="text-neutral-500">time zone</dt>
        <dd>{state.device.timeZone || "not set"}</dd>
      </dl>
      {!state.device.supported && (
        <p role="alert" className="border border-neutral-400 px-2 py-1 text-xs">
          ! Installing isn&apos;t supported on this software version yet (tested: {SUPPORTED_FIRMWARE.join(", ")}). Nothing will be changed.
        </p>
      )}
      {appsOff && (
        <div role="status" className="flex flex-wrap items-center gap-2 border border-neutral-900 px-2 py-1.5 text-xs">
          <Power size={14} aria-hidden />
          <span className="min-w-0 flex-1">Apps are off because the tablet restarted.</span>
          <button onClick={onTurnOn} disabled={running} className="border border-neutral-900 bg-neutral-900 px-2 py-0.5 text-white disabled:opacity-40">
            turn apps on
          </button>
        </div>
      )}
      <button onClick={() => void onForget()} disabled={running} className="text-xs underline disabled:opacity-40">
        forget this tablet
      </button>
    </div>
  );
}

function PairForm({ problem, onPaired }: { problem?: string; onPaired: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tablet.pair(password);
      setPassword("");
      await onPaired();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {problem && <p className="border border-neutral-400 px-2 py-1 text-xs">! {problem}</p>}
      <label htmlFor="tablet-password" className="block">
        Tablet found. Enter its password to connect.
      </label>
      <div className="flex gap-2">
        <input
          id="tablet-password"
          type="password"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 border border-neutral-400 bg-transparent px-2 py-1.5"
        />
        <button type="submit" disabled={busy || !password} className="border border-neutral-900 bg-neutral-900 px-3 text-white disabled:opacity-40">
          {busy ? "connecting…" : "connect"}
        </button>
      </div>
      {error && <p role="alert" className="text-xs">! {error}</p>}
      <button type="button" className="text-xs underline" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
        {showHelp ? "hide" : "where do I find the password?"}
      </button>
      {showHelp && (
        <ol className="list-decimal space-y-1 border border-dashed border-neutral-400 py-2 pr-2 pl-7 text-xs text-neutral-700">
          <li>On the tablet, open Settings → Help → Copyrights and licenses.</li>
          <li>At the bottom of that page you&apos;ll find the password for SSH (it&apos;s different on every tablet).</li>
          <li>It&apos;s used once, to add a key from this computer. It isn&apos;t saved anywhere.</li>
        </ol>
      )}
    </form>
  );
}
