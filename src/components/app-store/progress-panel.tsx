"use client";

import { Check, CircleNotch, Minus, X } from "@phosphor-icons/react";

import type { Step } from "@/lib/tablet/types";

export interface Operation {
  title: string;
  steps: Step[];
  /** set when the operation has finished */
  result?: { ok: boolean; message?: string };
}

const ICON = {
  running: <CircleNotch size={14} className="motion-safe:animate-spin" aria-hidden />,
  done: <Check size={14} aria-hidden />,
  skipped: <Minus size={14} className="text-neutral-400" aria-hidden />,
  failed: <X size={14} aria-hidden />,
};

/** Live steps of an install, remove or "turn apps on", and how it ended. */
export function ProgressPanel({ op, onDismiss }: { op: Operation; onDismiss?: () => void }) {
  const finished = op.result !== undefined;
  return (
    <section aria-live="polite" aria-labelledby="progress-heading" className="border border-neutral-900">
      <div className="flex items-center gap-2 border-b border-dashed border-neutral-300 px-3 py-2">
        <h2 id="progress-heading" className="min-w-0 flex-1 font-bold">
          {op.title}
        </h2>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs underline">
            close
          </button>
        )}
      </div>
      <ol className="space-y-1 px-3 py-2 text-xs">
        {op.steps.length === 0 && !finished && <li className="text-neutral-500">Starting…</li>}
        {op.steps.map((step) => (
          <li key={step.id} className={`flex items-start gap-2 ${step.status === "skipped" ? "text-neutral-500" : ""}`}>
            <span className="mt-0.5 shrink-0">{ICON[step.status]}</span>
            <span className="min-w-0 flex-1">
              {step.label}
              {step.detail && <span className="text-neutral-500"> · {step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {finished && (
        <p role={op.result!.ok ? "status" : "alert"} className="border-t border-dashed border-neutral-300 px-3 py-2">
          {op.result!.ok ? "Done. Look for it in the tablet's sidebar." : `! ${op.result!.message ?? "It didn't finish."}`}
        </p>
      )}
      {!finished && <p className="border-t border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500">Keep the tablet plugged in. Its screen restarts near the end.</p>}
    </section>
  );
}
