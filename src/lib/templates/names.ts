/**
 * Template ids, labels and document names. Kept apart from the renderers so
 * UI code can use them without loading pdf-lib.
 */

export type TemplateId = "planner" | "day" | "meetings";

export const TEMPLATES: readonly { id: TemplateId; name: string; description: string; prefix: string }[] = [
  { id: "planner", name: "Daily planner", description: "Schedule beside top 3, to-dos and notes.", prefix: "Planner" },
  { id: "day", name: "My day", description: "24-hour day with meetings and prayer times, to-dos and notes.", prefix: "Day" },
  { id: "meetings", name: "Meeting notes", description: "Overview, then a notes page per meeting.", prefix: "Meetings" },
];

export const DEFAULT_TEMPLATE: TemplateId = "planner";

export const isTemplateId = (v: string): v is TemplateId => TEMPLATES.some((t) => t.id === v);

/** The document name on the tablet, e.g. "Planner · Mon, 12 Oct 2026". */
export function templateName(id: TemplateId, day: string, locale = "en-GB"): string {
  const [y, m, d] = day.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const prefix = TEMPLATES.find((t) => t.id === id)?.prefix ?? "Agenda";
  return `${prefix} · ${label}`;
}
