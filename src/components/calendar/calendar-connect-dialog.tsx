"use client";

import { GoogleLogo, type Icon, MicrosoftOutlookLogo } from "@phosphor-icons/react";
import { useState } from "react";

import type { CalendarConnection, CalendarProvider } from "@/lib/calendar/types";
import type { CalendarClient } from "@/lib/client/calendar";

import { Modal } from "../modal";

interface ProviderCopy {
  title: string;
  icon: Icon;
  placeholder: string;
  intro: string;
  signIn: string;
  signInNote: string;
  steps: React.ReactNode[];
  missing: string;
}

/** Everything that differs between providers lives here; the dialog itself is shared. */
const COPY: Record<CalendarProvider, ProviderCopy> = {
  outlook: {
    title: "Connect Outlook calendar",
    icon: MicrosoftOutlookLogo,
    placeholder: "https://outlook.office365.com/owa/calendar/…/calendar.ics",
    intro: "Works with work and personal Outlook, with no admin approval. Read-only: we only see what the link shows.",
    signIn: "Sign in with Microsoft",
    signInNote: "Coming soon. Work accounts may need IT approval.",
    steps: [
      <>
        Open{" "}
        <a className="underline" href="https://outlook.office.com/calendar/options/calendar/SharedCalendars" target="_blank" rel="noreferrer">
          Outlook settings → Calendar → Shared calendars
        </a>
        .
      </>,
      <>
        Under <b>Publish a calendar</b>, pick your calendar and <b>Can view all details</b>, then <b>Publish</b>.
      </>,
      <>
        Copy the <b>ICS</b> link (not the HTML one) and paste it above.
      </>,
    ],
    missing: 'No "Publish a calendar" section? Your organization has switched it off. Ask IT, or use a personal Outlook account.',
  },
  google: {
    title: "Connect Google Calendar",
    icon: GoogleLogo,
    placeholder: "https://calendar.google.com/calendar/ical/…/basic.ics",
    intro: "Works with personal Google accounts and most Google Workspace accounts. Read-only: we only see what the link shows.",
    signIn: "Sign in with Google",
    signInNote: "Coming soon.",
    steps: [
      <>
        Open{" "}
        <a className="underline" href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">
          Google Calendar settings
        </a>
        .
      </>,
      <>
        On the left, under <b>Settings for my calendars</b>, click the calendar, then <b>Integrate calendar</b>.
      </>,
      <>
        Copy <b>Secret address in iCal format</b> and paste it above. Keep it private: anyone with it can see your calendar.
      </>,
    ],
    missing: "No secret address shown? Your Google Workspace admin has turned it off. Ask them, or use a personal Google account.",
  },
};

/**
 * Connect a calendar: paste its private subscription (iCal) link, or sign in
 * with the provider (shown, not available yet).
 */
export function CalendarConnectDialog({
  provider,
  client,
  onClose,
  onConnected,
}: {
  /** null when closed */
  provider: CalendarProvider | null;
  client: CalendarClient;
  onClose: () => void;
  onConnected: (connection: CalendarConnection) => void;
}) {
  return (
    <Modal open={provider !== null} title={provider ? COPY[provider].title : ""} onClose={onClose}>
      {provider && <ConnectForm key={provider} provider={provider} client={client} onConnected={onConnected} />}
    </Modal>
  );
}

function ConnectForm({
  provider,
  client,
  onConnected,
}: {
  provider: CalendarProvider;
  client: CalendarClient;
  onConnected: (connection: CalendarConnection) => void;
}) {
  const copy = COPY[provider];
  const ProviderIcon = copy.icon;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"link" | "oauth" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  async function connect(method: "ics" | "oauth") {
    if (method === "ics" && !url.trim()) return;
    setBusy(method === "ics" ? "link" : "oauth");
    setError(null);
    try {
      onConnected(await client.connect(method === "ics" ? { provider, method, url: url.trim() } : { provider, method }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void connect("ics");
        }}
      >
        <label htmlFor="ics-url" className="block font-bold">
          Paste your calendar link
        </label>
        <p className="text-xs text-neutral-600">{copy.intro}</p>
        <div className="flex gap-2">
          <input
            id="ics-url"
            data-autofocus
            type="url"
            inputMode="url"
            value={url}
            disabled={busy !== null}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={copy.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 border border-neutral-400 bg-transparent px-2 py-1.5"
          />
          <button
            type="submit"
            disabled={busy !== null || !url.trim()}
            className="border border-neutral-900 bg-neutral-900 px-3 text-white disabled:opacity-40"
          >
            {busy === "link" ? "checking…" : "connect"}
          </button>
        </div>

        <button type="button" className="text-xs underline" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps}>
          {showSteps ? "hide steps" : "where do I find this link?"}
        </button>
        {showSteps && (
          <ol className="list-decimal space-y-1 border border-dashed border-neutral-400 py-2 pr-2 pl-7 text-xs text-neutral-700">
            {copy.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
            <li className="text-neutral-500">{copy.missing}</li>
          </ol>
        )}
      </form>

      <div className="flex items-center gap-3 text-xs text-neutral-500" aria-hidden>
        <span className="h-px flex-1 bg-neutral-300" />
        or
        <span className="h-px flex-1 bg-neutral-300" />
      </div>

      <div className="space-y-1">
        <button
          type="button"
          onClick={() => connect("oauth")}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 border border-neutral-600 px-3 py-2 disabled:opacity-40"
        >
          <ProviderIcon size={16} aria-hidden />
          {busy === "oauth" ? "connecting…" : copy.signIn}
        </button>
        <p className="text-center text-xs text-neutral-500">{copy.signInNote}</p>
      </div>

      {error && (
        <p role="alert" className="border border-neutral-500 p-2 text-xs">
          ! {error}
        </p>
      )}
    </div>
  );
}
