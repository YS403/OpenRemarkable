"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { CalendarConnection, CalendarEvent, CalendarProvider } from "@/lib/calendar/types";
import { type ConnectionStatus, fetchStatus } from "@/lib/client/api";
import { type CalendarClient, demoCalendar, liveCalendar } from "@/lib/client/calendar";
import { createLocalSetting } from "@/lib/client/local-setting";
import { DEFAULT_TEMPLATE, isTemplateId, type TemplateId, templateName } from "@/lib/templates/names";

import { NavRail } from "../nav-rail";
import { SidePanel } from "../side-panel";
import { CalendarSidebar } from "./calendar-sidebar";
import { dayKey, dayLabel, shiftDay, viewerTimeZone } from "./day";
import { TemplatePreview } from "./template-preview";

const isProvider = (v: string | null): v is CalendarProvider => v === "outlook" || v === "google";

/** Real calendars by default; `?demo=outlook` previews the page with sample meetings. */
const DEMO_BY_DEFAULT = false;

/** the chosen template, remembered per browser */
const templateSetting = createLocalSetting<TemplateId>("calendar-template", DEFAULT_TEMPLATE, (raw) => (isTemplateId(raw) ? raw : undefined));

/**
 * The Calendar page: the reMarkable page that would be created for the chosen
 * day in the middle, connected calendars and that day's meetings on the right.
 */
export function CalendarShell() {
  const demoParam = useSearchParams().get("demo");
  const demo = demoParam === null ? DEMO_BY_DEFAULT : demoParam !== "0";
  const client: CalendarClient = useMemo(
    () => (demo ? demoCalendar(isProvider(demoParam) ? demoParam : "outlook") : liveCalendar),
    [demo, demoParam],
  );

  const [status, setStatus] = useState<ConnectionStatus>({ state: "loading" });
  const [connections, setConnections] = useState<CalendarConnection[] | null>(null);
  const [day, setDay] = useState(() => dayKey(new Date()));
  const template = templateSetting.use();
  // events are tagged with the day and connections they were fetched for, so stale ones never show
  const [fetched, setFetched] = useState<{ key: string; events: CalendarEvent[]; problems: string[] } | null>(null);
  const [pdf, setPdf] = useState<{ key: string; bytes: Uint8Array } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchStatus().then(
      (next) => active && setStatus(next),
      () => active && setStatus({ state: "loading" }),
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    client.connections().then(
      (list) => active && setConnections(list),
      () => active && setConnections([]),
    );
    return () => {
      active = false;
    };
  }, [client]);

  const eventsKey = `${day}|${connections?.map((c) => c.id).join(",") ?? ""}`;
  useEffect(() => {
    if (connections === null) return;
    let active = true;
    client.events(day, viewerTimeZone()).then(
      ({ events, problems }) =>
        active && setFetched({ key: eventsKey, events, problems: problems.map((p) => `${p.account}: ${p.message}`) }),
      (e: Error) => active && setFetched({ key: eventsKey, events: [], problems: [e.message] }),
    );
    return () => {
      active = false;
    };
  }, [client, day, connections, eventsKey]);

  const events = fetched?.key === eventsKey ? fetched.events : null;
  const problems = fetched?.key === eventsKey ? fetched.problems : [];

  // Render whenever the template or the day's meetings change. The preview
  // shows these exact bytes, which are also what gets saved.
  const pdfKey = `${template}|${eventsKey}`;
  useEffect(() => {
    if (events === null) return;
    let active = true;
    import("@/lib/templates")
      .then(({ renderTemplate }) => renderTemplate(template, { day, events, timeZone: viewerTimeZone() }))
      .then(
        (bytes) => {
          if (!active) return;
          setPdf({ key: pdfKey, bytes });
          setRenderError(null);
        },
        (e: Error) => active && setRenderError(e.message),
      );
    return () => {
      active = false;
    };
  }, [events, day, template, pdfKey]);

  async function refreshConnections() {
    setConnections(await client.connections());
  }

  return (
    <div className="flex h-dvh">
      <NavRail status={status} refreshing={false} />
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,40%)_minmax(0,1fr)] font-mono text-sm md:flex md:grid-rows-none">
        <main className="order-last flex min-h-0 flex-col md:order-first md:min-w-0 md:flex-1">
          {client.demo && (
            <div role="note" className="flex items-center gap-3 border-b border-dashed border-neutral-500 bg-neutral-50 px-4 py-1.5 text-xs">
              <span className="flex-1">Demo · sample meetings, not your real calendar. Saving still creates the page on your reMarkable.</span>
              <Link href="/calendar" className="underline">
                exit demo
              </Link>
            </div>
          )}
          {problems.map((problem) => (
            <p key={problem} role="alert" className="border-b border-neutral-300 px-4 py-1.5 text-xs">
              ! {problem}
            </p>
          ))}
          <TemplatePreview
            dayLabel={dayLabel(day)}
            pdf={pdf?.bytes ?? null}
            stale={pdf?.key !== pdfKey}
            error={renderError}
            canSync={status.state === "connected"}
            onDay={(delta) => setDay(shiftDay(day, delta))}
            onSync={() => client.sync({ template, timeZone: viewerTimeZone(), today: dayKey(new Date()) })}
            fileName={templateName(template, day)}
          />
        </main>
        <SidePanel storageKey="calendars" label="Calendars">
          {(collapse) => (
            <CalendarSidebar
              client={client}
              template={template}
              onTemplate={templateSetting.set}
              connections={connections}
              onConnectionsChanged={refreshConnections}
              onCollapse={collapse}
            />
          )}
        </SidePanel>
      </div>
    </div>
  );
}
