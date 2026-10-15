"use client";

import { AlarmIcon, type Icon } from "@phosphor-icons/react";

import type { AppId, StoreApp } from "@/lib/tablet/catalog";

const ICONS: Record<AppId, Icon> = { alarm: AlarmIcon };

/** One app in the store: what it does, whether it's on the tablet, install / remove. */
export function AppCard({
  app,
  installed,
  disabled,
  disabledReason,
  onInstall,
  onRemove,
}: {
  app: StoreApp;
  /** null while the tablet isn't connected */
  installed: boolean | null;
  disabled: boolean;
  disabledReason?: string;
  onInstall: () => void;
  onRemove: () => void;
}) {
  const AppIcon = ICONS[app.id];
  return (
    <li className="flex gap-3 border border-neutral-400 px-3 py-3">
      <span className="grid size-10 shrink-0 place-items-center border border-neutral-900" aria-hidden>
        <AppIcon size={22} />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold">{app.name}</h3>
          {installed !== null && (
            <span className={`border px-1.5 text-xs ${installed ? "border-neutral-900" : "border-dashed border-neutral-400 text-neutral-500"}`}>
              {installed ? "installed" : "not installed"}
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-700">{app.summary}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-600">
          {app.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={onInstall}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="border border-neutral-900 bg-neutral-900 px-3 py-1 text-white disabled:opacity-40"
          >
            {installed ? "reinstall" : "install"}
          </button>
          {installed && (
            <button onClick={onRemove} disabled={disabled} className="border border-neutral-600 px-3 py-1 disabled:opacity-40">
              remove
            </button>
          )}
          {disabled && disabledReason && <span className="text-xs text-neutral-500">{disabledReason}</span>}
        </div>
      </div>
    </li>
  );
}
