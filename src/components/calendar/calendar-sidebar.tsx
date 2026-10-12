"use client";

import { CaretDoubleRight, CaretDown, GoogleLogo, type Icon, MicrosoftOutlookLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

import { type CalendarConnection, type CalendarProvider, PROVIDERS } from "@/lib/calendar/types";
import type { CalendarClient } from "@/lib/client/calendar";
import { type TemplateId, TEMPLATES } from "@/lib/templates/names";

import { CalendarConnectDialog } from "./calendar-connect-dialog";

const PROVIDER_ICON: Record<CalendarProvider, Icon> = {
  google: GoogleLogo,
  outlook: MicrosoftOutlookLogo,
};

const providerName = (id: CalendarProvider) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/** Right column on the Calendar page: template choice, connected accounts, and providers to connect. */
export function CalendarSidebar({
  client,
  template,
  onTemplate,
  connections,
  onConnectionsChanged,
  onCollapse,
}: {
  client: CalendarClient;
  template: TemplateId;
  onTemplate: (id: TemplateId) => void;
  /** null while loading */
  connections: CalendarConnection[] | null;
  onConnectionsChanged: () => Promise<void>;
  onCollapse: () => void;
}) {
  // which row is busy, and the last message per row (keyed by provider or connection id)
  const [pending, setPending] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // which provider's connect dialog is open, if any
  const [connecting, setConnecting] = useState<CalendarProvider | null>(null);

  async function run(key: string, action: () => Promise<unknown>) {
    setPending(key);
    setNotes((n) => {
      const next = { ...n };
      delete next[key];
      return next;
    });
    try {
      await action();
      await onConnectionsChanged();
    } catch (e) {
      setNotes((n) => ({ ...n, [key]: (e as Error).message }));
    } finally {
      setPending(null);
    }
  }

  const connectedProviders = new Set(connections?.map((c) => c.provider));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-400 px-3 py-2">
        <h2 className="flex-1 font-bold">Calendars</h2>
        <button onClick={onCollapse} aria-label="Hide calendars" title="Hide calendars" className="hidden shrink-0 p-0.5 text-neutral-600 hover:text-neutral-900 md:block">
          <CaretDoubleRight size={16} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Template">
          <li>
            <fieldset>
              <legend className="sr-only">Page template</legend>
              {TEMPLATES.map((t) => (
                <label
                  key={t.id}
                  className={`flex cursor-pointer items-start gap-2 border-b border-dashed border-neutral-300 px-3 py-2 ${
                    template === t.id ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={t.id}
                    checked={template === t.id}
                    onChange={() => onTemplate(t.id)}
                    className="mt-1 accent-current"
                  />
                  <span className="min-w-0">
                    <span className="block">{t.name}</span>
                    <span className={`block text-xs ${template === t.id ? "text-neutral-300" : "text-neutral-500"}`}>{t.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </li>
        </Section>

        <Section title="Connected">
          {connections === null && <li className="px-3 py-2 text-neutral-500">loading…</li>}
          {connections?.length === 0 && (
            <li className="px-3 py-2 text-neutral-500">
              (none yet) connect a calendar below.{" "}
              {!client.demo && (
                <Link href="/calendar?demo=outlook" className="text-neutral-900 underline">
                  preview with sample Outlook data
                </Link>
              )}
            </li>
          )}
          {connections?.map((c) => {
            const ProviderIcon = PROVIDER_ICON[c.provider];
            return (
              <li key={c.id} className="border-b border-dashed border-neutral-300 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ProviderIcon size={16} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.account}</span>
                  <button
                    className="text-xs underline disabled:opacity-40"
                    disabled={pending !== null}
                    onClick={() => run(c.id, () => client.disconnect(c.id))}
                  >
                    {pending === c.id ? "disconnecting…" : "disconnect"}
                  </button>
                </div>
                <p className="text-xs text-neutral-500">
                  {providerName(c.provider)} · {c.method === "ics" ? "calendar link" : "signed in"} · read-only
                </p>
                <Note text={notes[c.id]} />
              </li>
            );
          })}
        </Section>

        <Section title="Connect">
            {PROVIDERS.map(({ id, name }) => {
              const ProviderIcon = PROVIDER_ICON[id];
              return (
                <li key={id} className="border-b border-dashed border-neutral-300 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ProviderIcon size={16} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <button
                      className="border border-neutral-600 px-2 py-0.5 text-xs disabled:opacity-40"
                      disabled={pending !== null}
                      onClick={() => setConnecting(id)}
                    >
                      {pending === id ? "connecting…" : connectedProviders.has(id) ? "add another" : "connect"}
                    </button>
                  </div>
                  <Note text={notes[id]} />
                </li>
              );
            })}
        </Section>

        <details className="group border-b border-neutral-300">
          <summary className="flex cursor-pointer list-none items-center justify-between bg-neutral-50 px-3 py-1 text-xs text-neutral-600 [&::-webkit-details-marker]:hidden">
            How it works
            <CaretDown size={12} className="transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-neutral-300 px-3 py-2">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-neutral-600">
            <li>Connect Google Calendar or Outlook with your calendar&apos;s private link (read-only). Add as many as you like, up to 5.</li>
            <li>Pick a template. The middle shows a day exactly as it will look.</li>
            <li>Sync: today and the next 6 days go into one &quot;Calendar&quot; document on your reMarkable. Sync again any time; days whose meetings changed get an updated page after the old one, so your notes stay put.</li>
            </ol>
          </div>
        </details>
      </div>

      <CalendarConnectDialog
        provider={connecting}
        client={client}
        onClose={() => setConnecting(null)}
        onConnected={() => {
          setConnecting(null);
          void onConnectionsChanged();
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="border-b border-neutral-300 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function Note({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p role="status" className="mt-1 border border-neutral-400 px-2 py-1 text-xs">
      ! {text}
    </p>
  );
}
