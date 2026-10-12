/** The parts of a document's .content file that decide page order. */
export interface PageOrderSource {
  cPages?: {
    pages?: readonly {
      id: string;
      idx?: { value: string };
      deleted?: { value: number };
      template?: { value: string };
      /** index of the original PDF/EPUB page shown here; absent for inserted pages */
      redir?: { value: number };
    }[];
  } | null;
  pages?: readonly string[] | null;
  /** legacy equivalent of `redir`, parallel to `pages`; -1 for inserted pages */
  redirectionPageMap?: readonly number[] | null;
}

export interface OrderedPage {
  id: string;
  /** background template name, e.g. "Blank" or "P Day"; absent in old documents */
  template?: string;
  /** 0-based page of the original PDF shown here; undefined for inserted blank pages */
  source?: number;
}

/**
 * Pages in display order. Newer documents keep pages in `cPages`, sorted by
 * fractional index strings and soft-deleted with a `deleted` marker; older ones
 * list ids in `pages`.
 */
export function orderPages(content: PageOrderSource): OrderedPage[] {
  const cPages = content.cPages?.pages;
  if (cPages && cPages.length > 0) {
    return cPages
      .filter((page) => !page.deleted || page.deleted.value === 0)
      .map((page, position) => ({ page, idx: page.idx?.value ?? "", position }))
      .sort((a, b) => (a.idx < b.idx ? -1 : a.idx > b.idx ? 1 : a.position - b.position))
      .map(({ page }) => ({ id: page.id, template: page.template?.value, source: validSource(page.redir?.value) }));
  }
  const map = content.redirectionPageMap;
  return (content.pages ?? []).map((id, i) => {
    const source = map ? validSource(map[i]) : undefined;
    return source === undefined ? { id } : { id, source };
  });
}

const validSource = (n: number | undefined) => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined);
