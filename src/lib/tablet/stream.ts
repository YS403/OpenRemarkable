import "server-only";

import type { ProgressEvent, Step } from "./types";
import { TabletError } from "./ssh";

/**
 * Run a long tablet operation and stream its steps as NDJSON. The operation
 * keeps going if the page is closed, so the tablet is never left half done.
 */
export function progressStream(operation: (report: (step: Step) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let send: (event: ProgressEvent) => void = () => {};
  let finish: () => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      send = (event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the page went away; carry on regardless
        }
      };
      finish = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
    },
    cancel() {
      send = () => {};
    },
  });

  let current: Step | null = null;
  void operation((step) => {
    current = step;
    send({ type: "step", step });
  })
    .then(() => send({ type: "result", ok: true }))
    .catch((error: unknown) => {
      if (current && current.status === "running") send({ type: "step", step: { ...current, status: "failed" } });
      const message = error instanceof TabletError || error instanceof Error ? error.message : "Something went wrong.";
      if (!(error instanceof TabletError)) console.error("tablet:", error);
      send({ type: "result", ok: false, message });
    })
    .finally(() => finish());

  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
