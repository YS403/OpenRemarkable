import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { PDFDocument, PDFName, type PDFPage } from "pdf-lib";
import { GenerationError, type RawEntry } from "rmapi-js";

import { prayerStore } from "@/lib/prayer/store";
import { type DayPrayers, prayersForDay } from "@/lib/prayer/timetable";
import { withRemarkable } from "@/lib/remarkable/client";
import { addTemplatePages, embedFonts } from "@/lib/templates";
import type { TemplateId } from "@/lib/templates/names";

import { CalendarLinkError, eventsForDay } from "./service";
import { calendarStore } from "./store";
import {
  type CalendarManifest,
  type CPage,
  currentPages,
  decide,
  initialPageEntries,
  type Insertion,
  planPageEntries,
  readManifest,
  writeManifest,
} from "./sync-plan";
import type { CalendarEvent } from "./types";

/** Name of the planner document on the tablet (users can rename it; it's tracked by id). */
export const PLANNER_DOCUMENT_NAME = "Planner";
/** what the document was called before the page was renamed; such documents are renamed on their next sync */
const LEGACY_DOCUMENT_NAME = "Calendar";
/** Days kept in sync: today and the next six. */
export const SYNC_DAYS = 7;

const ROOT = "root";
const MAX_ATTEMPTS = 5;

export interface SyncResult {
  documentName: string;
  created: boolean;
  added: string[];
  updated: string[];
  unchanged: string[];
}

export interface DayPlan {
  day: string;
  events: CalendarEvent[];
  fingerprint: string;
}

/**
 * Bring the user's calendar document up to date for today and the next six
 * days: create it on first sync, then add new days and redraw changed days in
 * place. Handwriting lives in per-page files tied to the page id, so a redrawn
 * day keeps the user's strokes on top of its new background.
 */
export async function syncCalendar(
  userId: string,
  { template, timeZone, today }: { template: TemplateId; timeZone: string; today: string },
): Promise<SyncResult> {
  const days = Array.from({ length: SYNC_DAYS }, (_, i) => shiftDay(today, i));
  const fetched = await Promise.all(days.map((day) => eventsForDay(userId, day, timeZone)));
  // A calendar that couldn't be read would make days look empty; don't record that as the truth.
  const problem = fetched.flatMap((f) => f.problems)[0];
  if (problem) throw new CalendarLinkError(`Couldn't read ${problem.account}: ${problem.message} Nothing was synced.`);

  // prayer windows from the user's timetable, if they have one and it's switched on
  const timetable = await prayerStore.load(userId);
  const prayersFor = (day: string) => (timetable?.enabled ? prayersForDay(timetable, day) : null);

  const plans: DayPlan[] = days.map((day, i) => ({
    day,
    events: fetched[i].events,
    fingerprint: fingerprint(template, fetched[i].events, prayersFor(day)),
  }));
  const render = (pdf: PDFDocument, fonts: Awaited<ReturnType<typeof embedFonts>>, plan: DayPlan) =>
    addTemplatePages(template, pdf, fonts, {
      day: plan.day,
      events: plan.events,
      timeZone,
      prayers: prayersFor(plan.day),
    });

  return withRemarkable(async (api) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const documentId = await calendarStore.getDocumentId(userId);
        const [rootHash, generation, schemaVersion] = await api.raw.getRootHash();
        const root = await api.raw.getEntries({ id: ROOT, hash: rootHash });
        const docEntry = documentId ? root.entries.find((e) => e.id === documentId) : undefined;
        const live = docEntry && (await api.raw.getMetadata(findFile(await api.raw.getEntries(docEntry), ".metadata"))).parent !== "trash";

        if (!docEntry || !live) {
          // first sync (or the old document was deleted): create it with every day
          const pdf = await PDFDocument.create();
          pdf.setTitle(PLANNER_DOCUMENT_NAME);
          pdf.setProducer("openremarkable");
          const fonts = await embedFonts(pdf);
          const manifest: CalendarManifest = { v: 1, days: {} };
          for (const plan of plans) {
            const pdfStart = pdf.getPageCount();
            const pdfCount = render(pdf, fonts, plan);
            manifest.days[plan.day] = {
              fingerprint: plan.fingerprint,
              versions: [{ pdfStart, pdfCount }],
              pages: Array.from({ length: pdfCount }, (_, i) => pdfStart + i),
            };
          }
          writeManifest(pdf, manifest);
          const ref = await api.uploadPdf(PLANNER_DOCUMENT_NAME, await pdf.save());
          await calendarStore.setDocumentId(userId, ref.id);
          return { documentName: PLANNER_DOCUMENT_NAME, created: true, added: days, updated: [], unchanged: [] };
        }

        return await updateDocument(api, { docEntry, root: root.entries, generation, schemaVersion, plans, render });
      } catch (error) {
        // someone else (usually the tablet) changed the account meanwhile: start over from the new state
        if (error instanceof GenerationError && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
  });
}

type Api = Parameters<Parameters<typeof withRemarkable>[0]>[0];

/** Exported for tests; use `syncCalendar`. */
export async function updateDocument(
  api: Api,
  {
    docEntry,
    root,
    generation,
    schemaVersion,
    plans,
    render,
  }: {
    docEntry: RawEntry;
    root: RawEntry[];
    generation: number;
    schemaVersion: Awaited<ReturnType<Api["raw"]["getRootHash"]>>[2];
    plans: DayPlan[];
    render: (pdf: PDFDocument, fonts: Awaited<ReturnType<typeof embedFonts>>, plan: DayPlan) => number;
  },
): Promise<SyncResult> {
  const { entries } = await api.raw.getEntries(docEntry);
  const pdfEntry = findFile({ entries }, ".pdf");
  const contentEntry = findFile({ entries }, ".content");
  const metadataEntry = findFile({ entries }, ".metadata");

  const [pdfBytes, content, metadata] = await Promise.all([
    api.raw.getHash(pdfEntry),
    api.raw.getContent(contentEntry),
    api.raw.getMetadata(metadataEntry),
  ]);
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const manifest = readManifest(pdf) ?? { v: 1, days: {} };
  const originalPdfPages = pdf.getPageCount();

  const result: SyncResult = { documentName: metadata.visibleName, created: false, added: [], updated: [], unchanged: [] };
  const insertions: Insertion[] = [];
  let fonts: Awaited<ReturnType<typeof embedFonts>> | null = null;

  for (const plan of plans) {
    const action = decide(manifest, plan.day, plan.fingerprint);
    if (action === "keep") {
      result.unchanged.push(plan.day);
      continue;
    }
    fonts ??= await embedFonts(pdf);
    const pdfStart = pdf.getPageCount();
    const pdfCount = render(pdf, fonts, plan);
    const rendered = Array.from({ length: pdfCount }, (_, i) => pdfStart + i);

    if (action === "add") {
      manifest.days[plan.day] = { fingerprint: plan.fingerprint, versions: [{ pdfStart, pdfCount }], pages: rendered };
      insertions.push({ day: plan.day, action, pdfPages: rendered });
      result.added.push(plan.day);
      continue;
    }

    // changed day: redraw its current pages in place, whatever was written on them
    const entry = manifest.days[plan.day];
    const extra = redrawInPlace(pdf, currentPages(entry), pdfStart, pdfCount);
    entry.fingerprint = plan.fingerprint;
    entry.pages = [...currentPages(entry), ...extra];
    if (extra.length) insertions.push({ day: plan.day, action, pdfPages: extra });
    result.updated.push(plan.day);
  }
  // documents still carrying the old default name get the new one (a name the user chose is kept)
  const rename = metadata.visibleName === LEGACY_DOCUMENT_NAME;
  if (rename) result.documentName = PLANNER_DOCUMENT_NAME;
  if (result.added.length === 0 && result.updated.length === 0 && !rename) return result; // nothing changed: no write at all

  // rebuild the file from its pages so replaced backgrounds don't pile up inside it
  const out = await PDFDocument.create({ updateMetadata: false });
  out.setTitle(pdf.getTitle() ?? PLANNER_DOCUMENT_NAME);
  out.setProducer("openremarkable");
  for (const page of await out.copyPages(pdf, pdf.getPageIndices())) out.addPage(page);
  writeManifest(out, manifest);
  const newPdf = await out.save();

  // the page list: fresh uploads have none until the tablet opens them
  const doc = content as unknown as {
    cPages?: { pages: CPage[]; [key: string]: unknown };
    pages?: string[];
    pageCount?: number;
    originalPageCount?: number;
    sizeInBytes?: string;
    formatVersion?: number;
  };
  if (!doc.cPages?.pages?.length) {
    doc.cPages = { ...(doc.cPages ?? {}), pages: initialPageEntries(originalPdfPages, doc.pages ?? undefined, randomUUID) };
    doc.formatVersion = 2;
  }
  doc.cPages.pages.push(...planPageEntries(doc.cPages.pages, manifest, insertions, randomUUID));
  doc.pageCount = doc.cPages.pages.filter((p) => !p.deleted || p.deleted.value === 0).length;
  doc.originalPageCount = out.getPageCount();
  doc.sizeInBytes = String(newPdf.byteLength);

  // upload the new files, then swap them into the document and the root in one commit
  const uploads = await Promise.all([
    api.raw.putFile(pdfEntry.id, newPdf),
    api.raw.putContent(contentEntry.id, content),
    api.raw.putMetadata(metadataEntry.id, { ...metadata, ...(rename ? { visibleName: PLANNER_DOCUMENT_NAME } : {}), lastModified: String(Date.now()) }),
  ]);
  const replaced = new Map(uploads.map((u) => [u.id, u]));
  const docIndex = await api.raw.putEntries(docEntry.id, entries.map((e) => replaced.get(e.id) ?? e), schemaVersion);
  const rootIndex = await api.raw.putEntries(ROOT, root.map((e) => (e.id === docEntry.id ? docIndex : e)), 4);
  // every blob must be on the server before the root points at it
  await Promise.all([...uploads, docIndex, rootIndex].map((pending) => pending[Symbol.asyncDispose]()));
  await api.raw.putRootHash(rootIndex.hash, generation, true);
  return result;
}

/**
 * Give the day's existing PDF pages (`targets`) the backgrounds just rendered at
 * `start..start+count-1`, keeping each page's position, so the tablet's page
 * ids, and the strokes stored against them, still point at the same pages.
 * Leftover old pages (the day now needs fewer) are blanked; extra rendered
 * pages stay appended and their (shifted) indices are returned.
 */
function redrawInPlace(pdf: PDFDocument, targets: readonly number[], start: number, count: number): number[] {
  const swapped = Math.min(targets.length, count);
  for (let i = 0; i < swapped; i++) replaceBackground(pdf.getPage(targets[i]), pdf.getPage(start + i));
  for (const target of targets.slice(swapped)) {
    const old = pdf.getPage(target);
    const blank = pdf.addPage([old.getWidth(), old.getHeight()]);
    replaceBackground(old, blank);
    pdf.removePage(pdf.getPageCount() - 1);
  }
  // drop the rendered pages that were copied in, highest first so indices stay valid
  for (let i = swapped - 1; i >= 0; i--) pdf.removePage(start + i);
  return Array.from({ length: count - swapped }, (_, i) => start + i);
}

const KEEP_KEYS = new Set(["Type", "Parent"]);

/** Make `target` show what `source` shows (content, resources, size), keeping `target`'s place in the page tree. */
function replaceBackground(target: PDFPage, source: PDFPage): void {
  for (const key of target.node.keys()) if (!KEEP_KEYS.has(key.asString().slice(1))) target.node.delete(key);
  for (const [key, value] of source.node.entries()) if (!KEEP_KEYS.has(key.asString().slice(1))) target.node.set(key, value);
  // inherited attributes the source might rely on
  if (!target.node.get(PDFName.of("MediaBox"))) target.node.set(PDFName.of("MediaBox"), mediaBoxOf(source));
}

const mediaBoxOf = (page: PDFPage) => page.node.context.obj([0, 0, page.getWidth(), page.getHeight()]);

function findFile({ entries }: { entries: RawEntry[] }, extension: string): RawEntry {
  const entry = entries.find((e) => e.id.endsWith(extension) && !e.id.includes("/"));
  if (!entry) throw new Error(`The calendar document is missing its ${extension} file.`);
  return entry;
}

/** What a day's page shows; when it changes, the day's page is redrawn. */
function fingerprint(template: TemplateId, events: readonly CalendarEvent[], prayers: DayPrayers | null): string {
  const significant = events
    .map((e) => [e.title, e.start, e.end, e.allDay, e.location ?? "", (e.attendees ?? []).join(",")])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify([template, significant, prayers])).digest("hex").slice(0, 24);
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
