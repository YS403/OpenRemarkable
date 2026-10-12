"use client";

import { useSyncExternalStore } from "react";

/**
 * A small per-browser UI preference (collapsed panels, widths) kept in
 * localStorage. Storage can be missing or throw (private windows, blocked
 * site data), so every access is guarded and the fallback always works.
 * Values must be primitives so snapshots compare by value.
 */
export function createLocalSetting<T extends string | number | boolean>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
) {
  const event = `local-setting:${key}`;
  let memory: T | undefined;

  const read = (): T => {
    if (memory !== undefined) return memory;
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (parse(raw) ?? fallback);
    } catch {
      return fallback;
    }
  };

  const subscribe = (onChange: () => void) => {
    window.addEventListener(event, onChange);
    return () => window.removeEventListener(event, onChange);
  };

  return {
    use: (): T => useSyncExternalStore(subscribe, read, () => fallback),
    get: read,
    set(value: T) {
      memory = value;
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // kept in memory for this session only
      }
      window.dispatchEvent(new Event(event));
    },
  };
}

export const parseBoolean = (raw: string) => (raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : undefined);

export const parseNumber = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};
