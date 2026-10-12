"use client";

import { ArrowsClockwise, Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

/** How long the "synced" confirmation stays before the button resets. */
const SYNCED_MS = 2500;

type Phase = "idle" | "syncing" | "synced";

/**
 * "sync to reMarkable" with feedback in the button itself: a spinner while
 * syncing, then a check that pops in with "synced" before resetting. Failures
 * reset straight away (the caller shows the error). Fixed width, so the
 * toolbar doesn't shift as the label changes.
 */
export function SyncButton({ disabled, title, onSync }: { disabled: boolean; title?: string; onSync: () => Promise<boolean> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function run() {
    clearTimeout(timer.current);
    setPhase("syncing");
    const ok = await onSync();
    if (!ok) {
      setPhase("idle");
      return;
    }
    setPhase("synced");
    timer.current = setTimeout(() => setPhase("idle"), SYNCED_MS);
  }

  return (
    <button
      onClick={run}
      disabled={disabled || phase === "syncing"}
      title={title}
      aria-live="polite"
      aria-busy={phase === "syncing"}
      // dimmed only when sync isn't possible; while syncing it stays solid with its spinner
      className={`inline-flex min-w-[11.5rem] items-center justify-center gap-1.5 border px-2 py-0.5 text-white transition-colors duration-300 ${disabled ? "opacity-40" : ""} ${
        phase === "synced" ? "sync-flash border-emerald-700 bg-emerald-700" : "border-neutral-900 bg-neutral-900"
      }`}
    >
      {phase === "syncing" && <ArrowsClockwise size={14} weight="bold" className="motion-safe:animate-spin" aria-hidden />}
      {phase === "synced" && <Check size={14} weight="bold" className="sync-pop" aria-hidden />}
      {phase === "idle" ? "sync to reMarkable" : phase === "syncing" ? "syncing…" : "synced"}
    </button>
  );
}
