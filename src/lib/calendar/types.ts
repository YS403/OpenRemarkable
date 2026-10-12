/** Calendar services a user can connect. */
export type CalendarProvider = "google" | "outlook";

export const PROVIDERS: readonly { id: CalendarProvider; name: string }[] = [
  { id: "google", name: "Google Calendar" },
  { id: "outlook", name: "Outlook" },
];

/** How a calendar is connected: a published subscription (ICS) link, or a sign-in (not built yet). */
export type ConnectionMethod = "ics" | "oauth";

/** A connected calendar. Links and tokens stay on the server; the browser only sees this. */
export interface CalendarConnection {
  id: string;
  provider: CalendarProvider;
  method: ConnectionMethod;
  /** what users see: the calendar's name or the account's email */
  account: string;
  connectedAt: string;
}

/** A meeting read from a connected calendar, used to build a reMarkable template. */
export interface CalendarEvent {
  id: string;
  connectionId: string;
  title: string;
  /** ISO 8601 */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  attendees?: string[];
}
