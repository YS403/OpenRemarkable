import "server-only";

import type { CalendarProvider } from "../types";

/**
 * Fetch a calendar subscription (ICS) link that a user pasted. The server is
 * fetching a URL chosen by a user, so it only talks to known calendar hosts
 * over HTTPS, re-checks every redirect, and caps time and size.
 */

/** Hosts each provider serves calendar links from; nothing else is ever fetched. */
const PROVIDER_HOSTS: Record<CalendarProvider, { hosts: ReadonlySet<string>; hint: string }> = {
  // Microsoft 365 and Outlook.com "publish a calendar" links
  outlook: {
    hosts: new Set(["outlook.office365.com", "outlook.office.com", "outlook.live.com"]),
    hint: "Paste the ICS link Outlook gives you when you publish a calendar (it starts with https://outlook.office365.com/ or https://outlook.live.com/).",
  },
  // Google Calendar "secret address in iCal format" (and public iCal) links
  google: {
    hosts: new Set(["calendar.google.com"]),
    hint: "Paste your Google Calendar's secret address in iCal format (it starts with https://calendar.google.com/calendar/ical/).",
  },
};

const providerLabel = (provider: CalendarProvider) => (provider === "google" ? "Google Calendar" : "Outlook");

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export class CalendarLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarLinkError";
  }
}

/** Normalise and validate a pasted link for a provider; `webcal://` links are fetched over https. */
export function parseCalendarLink(raw: string, provider: CalendarProvider): URL {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new CalendarLinkError("That doesn't look like a link.");
  }
  if (url.protocol !== "https:") throw new CalendarLinkError("Calendar links must start with https:// or webcal://.");
  const { hosts, hint } = PROVIDER_HOSTS[provider];
  if (!hosts.has(url.hostname.toLowerCase())) throw new CalendarLinkError(hint);
  if (url.username || url.password || (url.port && url.port !== "443")) throw new CalendarLinkError("That link isn't a plain calendar link.");
  return url;
}

export async function fetchCalendarText(link: URL, provider: CalendarProvider): Promise<string> {
  let url = link;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "text/calendar, */*;q=0.5", "User-Agent": "myremarkable-calendar/1.0" },
      });
    } catch {
      throw new CalendarLinkError(`Couldn't reach ${providerLabel(provider)}. Check the link and try again.`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      url = parseCalendarLink(new URL(location, url).toString(), provider);
      continue;
    }
    // providers answer unknown or revoked links with 4xx, and sometimes 500
    if (!response.ok) {
      throw new CalendarLinkError(
        `${providerLabel(provider)} couldn't open this calendar (error ${response.status}). Check you copied the whole link, and that it hasn't been reset.`,
      );
    }
    return readCapped(response);
  }
  throw new CalendarLinkError("The calendar link redirected too many times.");
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new CalendarLinkError("That calendar is too large to read.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new CalendarLinkError("That calendar is too large to read.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
