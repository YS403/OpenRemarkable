"use client";

import { ArrowSquareOut, ClipboardText } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { connect } from "@/lib/client/api";

const CODE_LENGTH = 8;

/** Keep only letters, lowercased: codes get copied with spaces, dashes or capitals. */
const cleanCode = (raw: string) => raw.toLowerCase().replace(/[^a-z]/g, "").slice(0, CODE_LENGTH);

export function ConnectPanel({ connectUrl, onConnected }: { connectUrl: string; onConnected: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // Coming back from the reMarkable tab: put the cursor where the code goes.
  useEffect(() => {
    if (!opened) return;
    const focus = () => inputRef.current?.focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [opened]);

  async function submit(value: string) {
    if (busyRef.current || value.length !== CODE_LENGTH) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await connect(value);
      onConnected();
    } catch (e) {
      setError((e as Error).message);
      inputRef.current?.select();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function update(raw: string) {
    const next = cleanCode(raw);
    setCode(next);
    if (error) setError(null);
    // a full code means the user is done: connect without another click
    if (next.length === CODE_LENGTH) void submit(next);
  }

  async function pasteFromClipboard() {
    try {
      update(await navigator.clipboard.readText());
    } catch {
      // permission denied or unsupported: fall back to a normal paste
      inputRef.current?.focus();
      setError("Your browser blocked clipboard access. Click the box and press Ctrl+V (⌘V on Mac).");
    }
  }

  return (
    <main className="grid flex-1 place-items-center p-6">
      <section className="w-full max-w-md border border-neutral-400 p-6">
        <h1 className="mb-1 font-bold">Connect your reMarkable account</h1>
        <p className="mb-5 text-sm text-neutral-600">Two steps. Your password never touches this app.</p>

        <ol className="space-y-5">
          <li>
            <p className="mb-2 text-sm">
              <span className="font-bold">1.</span> Sign in to reMarkable and copy your one-time code.
            </p>
            <a
              href={connectUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpened(true)}
              className="surface-metal inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 font-medium text-[var(--on-brand)] active:scale-[0.99]"
            >
              Get my code
              <ArrowSquareOut size={16} weight="bold" aria-hidden />
            </a>
          </li>

          <li>
            <label htmlFor="otp" className="mb-2 block text-sm">
              <span className="font-bold">2.</span> Paste it here. We connect as soon as it&apos;s in.
            </label>
            <div className="flex gap-2">
              <input
                id="otp"
                ref={inputRef}
                value={code}
                onChange={(e) => update(e.target.value)}
                placeholder="abcdefgh"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
                className="min-w-0 flex-1 border border-neutral-400 bg-transparent px-3 py-2 font-mono text-lg tracking-[0.3em] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={pasteFromClipboard}
                disabled={busy}
                className="inline-flex items-center gap-1.5 border border-neutral-500 px-3 disabled:opacity-40"
              >
                <ClipboardText size={16} aria-hidden />
                Paste
              </button>
            </div>
            <p className="mt-2 text-sm text-neutral-600" aria-live="polite">
              {busy ? "Connecting…" : `${code.length}/${CODE_LENGTH} letters. Codes expire after a few minutes.`}
            </p>
          </li>
        </ol>

        {error && (
          <p role="alert" className="mt-4 border border-neutral-500 p-2 text-sm">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
