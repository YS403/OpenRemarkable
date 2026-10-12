import type { PDFDocument } from "pdf-lib";

import type { Fonts, TemplateInput } from "./kit";
import { addMeetingPages, renderMeetings } from "./meetings";
import type { TemplateId } from "./names";
import { addPlannerPages, renderPlanner } from "./planner";
import { addSchedulePages, renderSchedule } from "./schedule";

export type { Fonts, TemplateInput } from "./kit";
export { embedFonts, PAGE } from "./kit";
export { DEFAULT_TEMPLATE, isTemplateId, type TemplateId, templateName, TEMPLATES } from "./names";

const RENDERERS: Record<TemplateId, (input: TemplateInput) => Promise<Uint8Array>> = {
  schedule: renderSchedule,
  planner: renderPlanner,
  meetings: renderMeetings,
};

/**
 * Render a template to PDF. Pure and isomorphic: the browser calls this for the
 * preview and the server will call it to upload, so the preview is exactly
 * what lands on the tablet.
 */
export function renderTemplate(id: TemplateId, input: TemplateInput): Promise<Uint8Array> {
  return RENDERERS[id](input);
}

const APPENDERS: Record<TemplateId, (doc: PDFDocument, fonts: Fonts, input: TemplateInput) => number> = {
  schedule: addSchedulePages,
  planner: addPlannerPages,
  meetings: addMeetingPages,
};

/** Append one day's pages to an existing document (used to build the synced calendar). Returns the page count added. */
export function addTemplatePages(id: TemplateId, doc: PDFDocument, fonts: Fonts, input: TemplateInput): number {
  return APPENDERS[id](doc, fonts, input);
}
