"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { submitFeatureRequest } from "@/lib/client/feedback";
import { createLocalSetting } from "@/lib/client/local-setting";
import { featureRequestSchema, MESSAGE_MAX } from "@/lib/feedback/schema";

import { Modal } from "./modal";

/** an unsent request survives closing the dialog or reloading */
const draft = createLocalSetting<string>("feature-request-draft", "", (raw) => raw);

type State = { step: "form" } | { step: "sending" } | { step: "done"; sent: boolean };

/**
 * A one-box feature request form in a modal dialog. Only the request itself is
 * required; email is optional, and the current page is attached automatically.
 */
export function FeatureRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Request a feature" onClose={onClose}>
      <FeatureRequestForm onClose={onClose} />
    </Modal>
  );
}

/** Lives only while the dialog is open, so each opening starts fresh (except the saved draft). */
function FeatureRequestForm({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const message = draft.use();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ step: "form" });

  const close = onClose;

  async function submit() {
    const parsed = featureRequestSchema.safeParse({ message, email, page: pathname });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    setError(null);
    setState({ step: "sending" });
    try {
      const { sent } = await submitFeatureRequest(parsed.data);
      draft.set("");
      setEmail("");
      setState({ step: "done", sent });
    } catch (e) {
      setError((e as Error).message);
      setState({ step: "form" });
    }
  }

  const sending = state.step === "sending";

  return (
    <>
      {state.step === "done" ? (
        <div className="space-y-3 p-4">
          <p className="font-bold">Thanks, that&apos;s noted.</p>
          {!state.sent && (
            <p className="border border-dashed border-neutral-500 p-2 text-xs text-neutral-600">
              Demo: requests aren&apos;t sent anywhere yet. This form will be connected soon.
            </p>
          )}
          <div className="flex justify-end">
            <button autoFocus onClick={close} className="border border-neutral-600 px-3 py-1">
              close
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor="feature-message" className="mb-1 block">
              What should we build?
            </label>
            <textarea
              id="feature-message"
              data-autofocus
              rows={5}
              maxLength={MESSAGE_MAX}
              value={message}
              disabled={sending}
              onChange={(e) => draft.set(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Export a notebook page as PNG"
              className="block w-full resize-y border border-neutral-400 bg-transparent px-2 py-1.5"
            />
            <p className="mt-1 text-right text-xs text-neutral-500">
              {message.length}/{MESSAGE_MAX}
            </p>
          </div>

          <div>
            <label htmlFor="feature-email" className="mb-1 block">
              Email <span className="text-neutral-500">(optional, if you&apos;d like a reply)</span>
            </label>
            <input
              id="feature-email"
              type="email"
              value={email}
              disabled={sending}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="block w-full border border-neutral-400 bg-transparent px-2 py-1.5"
            />
          </div>

          {error && (
            <p role="alert" className="border border-neutral-500 p-2 text-xs">
              ! {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <span className="flex-1 text-xs text-neutral-500">Ctrl+Enter to send</span>
            <button type="button" onClick={close} className="underline">
              cancel
            </button>
            <button
              type="submit"
              disabled={sending || message.trim().length === 0}
              className="border border-neutral-900 bg-neutral-900 px-3 py-1 text-white disabled:opacity-40"
            >
              {sending ? "sending…" : "send"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
