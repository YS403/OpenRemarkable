/** Browser-side calls for the App Store page: the USB-connected tablet and installs. */
import type { AppId } from "@/lib/tablet/catalog";
import type { ProgressEvent, Step, TabletStatus } from "@/lib/tablet/types";

import { ApiError } from "./api";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.message ?? `Request failed (${response.status}).`, response.status);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/**
 * Follow a streamed install: `onStep` gets each step as it changes. Resolves
 * with the final result; a request refused before it starts throws ApiError.
 */
async function follow(response: Response, onStep: (step: Step) => void): Promise<{ ok: boolean; message?: string }> {
  if (!response.ok || !response.body) await readJson(response);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let result: { ok: boolean; message?: string } = { ok: false, message: "The connection to the app closed before the install finished. Check the tablet, then refresh." };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ProgressEvent;
      if (event.type === "step") onStep(event.step);
      else result = { ok: event.ok, message: event.message };
    }
  }
  return result;
}

export const tablet = {
  status: async () => readJson<TabletStatus>(await fetch("/api/tablet", { cache: "no-store" })),
  /** the password is sent to this app's own server once, to add a key; it isn't stored */
  pair: async (password: string) => readJson<{ paired: true }>(await fetch("/api/tablet/pair", json("POST", { password }))),
  forget: async () => readJson<{ paired: false }>(await fetch("/api/tablet/pair", { method: "DELETE" })),
  install: async (app: AppId, onStep: (step: Step) => void) =>
    follow(await fetch(`/api/tablet/apps/${app}`, json("POST", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })), onStep),
  remove: async (app: AppId, onStep: (step: Step) => void) => follow(await fetch(`/api/tablet/apps/${app}`, { method: "DELETE" }), onStep),
  start: async (onStep: (step: Step) => void) => follow(await fetch("/api/tablet/start", { method: "POST" }), onStep),
};
