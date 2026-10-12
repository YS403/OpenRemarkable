import { PDFHexString, PDFName, type PDFDocument, PDFString } from "pdf-lib";

import { keysBetween } from "./sort-key";

/**
 * Pure planning for the synced calendar document: what each day needs, and
 * where new pages go in reMarkable's page order. No I/O, so it is unit tested.
 *
 * The rule that protects handwriting: pages already in the document are never
 * moved, changed or removed. Sync only appends pages to the PDF and inserts
 * them into the page order.
 */

/** Which PDF pages hold which day, kept inside the PDF itself (no database needed). */
export interface CalendarManifest {
  v: 1;
  days: Record<string, { fingerprint: string; versions: { pdfStart: number; pdfCount: number }[] }>;
}

const MANIFEST_KEY = PDFName.of("MyRemarkableCalendar");

export function readManifest(pdf: PDFDocument): CalendarManifest | null {
  const value = pdf.catalog.lookupMaybe(MANIFEST_KEY, PDFString, PDFHexString);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value.decodeText()) as CalendarManifest;
    return parsed?.v === 1 && parsed.days && typeof parsed.days === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeManifest(pdf: PDFDocument, manifest: CalendarManifest): void {
  pdf.catalog.set(MANIFEST_KEY, PDFHexString.fromText(JSON.stringify(manifest)));
}

export type DayAction = "add" | "update" | "keep";

/** New day → add; meetings changed → add an updated page after the old one; same → keep. */
export function decide(manifest: CalendarManifest, day: string, fingerprint: string): DayAction {
  const entry = manifest.days[day];
  if (!entry) return "add";
  return entry.fingerprint === fingerprint ? "keep" : "update";
}

/** The subset of a `.content` page entry the planner reads and writes. */
export interface CPage {
  id: string;
  idx?: { timestamp: string; value: string };
  redir?: { timestamp: string; value: number };
  deleted?: { timestamp: string; value: number };
  template?: { timestamp: string; value: string };
  [key: string]: unknown;
}

export interface Insertion {
  day: string;
  action: "add" | "update";
  /** PDF page indices of the freshly appended pages, in order */
  pdfPages: number[];
}

const TIMESTAMP = "1:2";

/**
 * Page-list entries for newly appended PDF pages, positioned so that:
 * - an updated day's new version sits right after that day's existing pages
 * - a new day sits after the latest earlier day (or before the earliest later day)
 * Existing entries are never changed. `manifest` must already include the new versions.
 */
export function planPageEntries(pages: readonly CPage[], manifest: CalendarManifest, insertions: readonly Insertion[], newId: () => string): CPage[] {
  const dayOfPdfPage = new Map<number, string>();
  for (const [day, entry] of Object.entries(manifest.days)) {
    for (const v of entry.versions) for (let i = 0; i < v.pdfCount; i++) dayOfPdfPage.set(v.pdfStart + i, day);
  }

  // current visible order; grows as insertions are placed so later ones see them
  const order = pages
    .filter((p) => !p.deleted || p.deleted.value === 0)
    .map((p, position) => ({ page: p, key: p.idx?.value ?? "", position }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.position - b.position))
    .map(({ page }) => page);
  const dayAt = (i: number) => (order[i]?.redir ? dayOfPdfPage.get(order[i].redir!.value) : undefined);

  const created: CPage[] = [];
  for (const insertion of [...insertions].sort((a, b) => a.day.localeCompare(b.day))) {
    let anchor = -2; // position to insert after; -1 = before everything

    if (insertion.action === "update") {
      for (let i = order.length - 1; i >= 0; i--) {
        if (dayAt(i) === insertion.day && !insertion.pdfPages.includes(order[i].redir!.value)) {
          anchor = i;
          break;
        }
      }
    }
    if (anchor === -2) {
      // after the last page of the latest earlier day
      for (let i = order.length - 1; i >= 0; i--) {
        const d = dayAt(i);
        if (d !== undefined && d < insertion.day) {
          anchor = i;
          break;
        }
      }
    }
    if (anchor === -2) {
      // before the first page of the earliest later day
      const first = order.findIndex((_, i) => {
        const d = dayAt(i);
        return d !== undefined && d > insertion.day;
      });
      anchor = first === -1 ? order.length - 1 : first - 1;
    }

    const low = order[anchor]?.idx?.value;
    // skip neighbours that share the anchor's key (duplicates happen after merges)
    let next = anchor + 1;
    while (next < order.length && low !== undefined && order[next].idx?.value === low) next++;
    const high = order[next]?.idx?.value;

    let keys: string[];
    try {
      keys = keysBetween(low, high, insertion.pdfPages.length);
    } catch {
      // no room in that gap (rare): place at the end rather than fail the sync
      keys = keysBetween(order.at(-1)?.idx?.value, undefined, insertion.pdfPages.length);
      next = order.length;
    }

    const entries: CPage[] = insertion.pdfPages.map((pdfPage, i) => ({
      id: newId(),
      idx: { timestamp: TIMESTAMP, value: keys[i] },
      redir: { timestamp: TIMESTAMP, value: pdfPage },
      template: { timestamp: TIMESTAMP, value: "Blank" },
    }));
    order.splice(next, 0, ...entries);
    created.push(...entries);
  }
  return created;
}

/**
 * Page entries for a document the tablet hasn't laid out yet (fresh uploads
 * have no `cPages`): one per PDF page, in PDF order, reusing legacy page ids.
 */
export function initialPageEntries(pdfPageCount: number, legacyIds: readonly string[] | undefined, newId: () => string): CPage[] {
  const keys = keysBetween(undefined, undefined, pdfPageCount);
  return Array.from({ length: pdfPageCount }, (_, i) => ({
    id: legacyIds?.[i] ?? newId(),
    idx: { timestamp: TIMESTAMP, value: keys[i] },
    redir: { timestamp: TIMESTAMP, value: i },
    template: { timestamp: TIMESTAMP, value: "Blank" },
  }));
}
