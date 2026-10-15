/**
 * Where the user is on the Notebooks page, so a reload (browser refresh, or a
 * newer version of the open notebook arriving) puts them back in the same place:
 * - which document and folder are open, kept in the address (?doc=…&folder=…)
 * - how far down the open document they've scrolled, kept per document for
 *   this tab, as "page N, this far down it" so it survives window resizes
 */

export interface OpenLocation {
  doc: string | null;
  folder: string | null;
}

const DOC = "doc";
const FOLDER = "folder";

export function readLocation(search: string): OpenLocation {
  const params = new URLSearchParams(search);
  return { doc: params.get(DOC) || null, folder: params.get(FOLDER) || null };
}

/** The query string for `location`, keeping any other parameters (e.g. ?demo). Root folder is left out. */
export function locationSearch(search: string, location: OpenLocation, rootFolder: string): string {
  const params = new URLSearchParams(search);
  // always written in the same order, so the address doesn't reshuffle as you click around
  params.delete(DOC);
  params.delete(FOLDER);
  if (location.doc) params.set(DOC, location.doc);
  if (location.folder && location.folder !== rootFolder) params.set(FOLDER, location.folder);
  const query = params.toString();
  return query ? `?${query}` : "";
}

// ---------------------------------------------------------------- reading position

export interface ReadingPosition {
  /** 0-based page index */
  page: number;
  /** how far down that page the top of the view is, 0..1 */
  offset: number;
}

/**
 * Pages are laid out in a column: `gap` above the first page and between pages.
 * `heights` are the pages' rendered heights.
 */
export function positionFromScroll(scrollTop: number, heights: readonly number[], gap: number): ReadingPosition {
  let top = gap;
  for (let page = 0; page < heights.length; page++) {
    const bottom = top + heights[page];
    // the gap below a page counts as that page's end
    if (scrollTop < bottom + gap || page === heights.length - 1) {
      const offset = heights[page] > 0 ? (scrollTop - top) / heights[page] : 0;
      return { page, offset: Math.min(1, Math.max(0, offset)) };
    }
    top = bottom + gap;
  }
  return { page: 0, offset: 0 };
}

export function scrollFromPosition(position: ReadingPosition, heights: readonly number[], gap: number): number {
  if (heights.length === 0) return 0;
  const page = Math.min(Math.max(0, position.page), heights.length - 1);
  let top = gap;
  for (let i = 0; i < page; i++) top += heights[i] + gap;
  // the first page at offset 0 means "the very top", including the gap above it
  if (page === 0 && position.offset === 0) return 0;
  return top + Math.min(1, Math.max(0, position.offset)) * heights[page];
}

const KEY = (docId: string) => `reading-position:${docId}`;

/** Stored per tab: storage can be missing or throw (private windows), so failures are ignored. */
export function loadPosition(docId: string): ReadingPosition | null {
  try {
    const raw = sessionStorage.getItem(KEY(docId));
    if (!raw) return null;
    const p = JSON.parse(raw) as ReadingPosition;
    return Number.isInteger(p.page) && p.page >= 0 && typeof p.offset === "number" ? p : null;
  } catch {
    return null;
  }
}

export function savePosition(docId: string, position: ReadingPosition): void {
  try {
    sessionStorage.setItem(KEY(docId), JSON.stringify({ page: position.page, offset: Math.round(position.offset * 1000) / 1000 }));
  } catch {
    // not remembering the position is fine
  }
}
