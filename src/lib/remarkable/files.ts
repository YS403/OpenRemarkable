import "server-only";

import { requireSession } from "@/lib/session/session";

import { withRemarkable } from "./client";
import type { CloudItem } from "./types";

export type { CloudItem };

/** Re-read the account's root at least this often, so hashes don't go stale. */
const MAX_LISTING_AGE_MS = 30_000;
/** when each user's listing was last re-read, in this instance */
const lastRefresh = new Map<string, number>();

/** List every folder and document in the account (templates are skipped). */
export async function listCloudItems(refresh = false): Promise<CloudItem[]> {
  const { userId } = await requireSession();
  const forceRefresh = refresh || Date.now() - (lastRefresh.get(userId) ?? 0) > MAX_LISTING_AGE_MS;
  const entries = await withRemarkable((api) => api.listItems(forceRefresh));
  if (forceRefresh) lastRefresh.set(userId, Date.now());
  const items: CloudItem[] = [];
  for (const entry of entries) {
    if (entry.type === "TemplateType") continue;
    items.push({
      id: entry.id,
      hash: entry.hash,
      name: entry.visibleName,
      kind: entry.type === "CollectionType" ? "folder" : "document",
      fileType: entry.type === "DocumentType" ? entry.fileType : null,
      parent: entry.parent ?? "",
      pinned: entry.pinned,
      lastModified: toIsoDate(entry.lastModified),
    });
  }
  return items;
}

/** The cloud stores lastModified as milliseconds since the epoch, in a string. */
function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const millis = Number(value);
  const date = Number.isFinite(millis) ? new Date(millis) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
