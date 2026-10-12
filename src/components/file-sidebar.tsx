"use client";

import { CaretDoubleRight } from "@phosphor-icons/react";
import { useMemo } from "react";

import { type CloudItem, ROOT_FOLDER, TRASH_FOLDER } from "@/lib/remarkable/types";

import { UploadButton, UploadDropZone, UploadList, useUploadQueue } from "./upload-panel";

interface Crumb {
  id: string;
  name: string;
}

const byKindThenName = (a: CloudItem, b: CloudItem) =>
  a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "folder" ? -1 : 1;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export function FileSidebar({
  items,
  fetchedAt,
  folder,
  selectedId,
  onOpenFolder,
  onSelect,
  onCollapse,
  uploadMaxBytes,
  onUploaded,
}: {
  items: CloudItem[] | null;
  fetchedAt: string | null;
  folder: string;
  selectedId: string | null;
  onOpenFolder: (id: string) => void;
  onSelect: (item: CloudItem) => void;
  onCollapse: () => void;
  /** largest PDF the server accepts */
  uploadMaxBytes: number;
  /** called after each successful upload, to refresh the list */
  onUploaded: () => void;
}) {
  const uploads = useUploadQueue(uploadMaxBytes, onUploaded);
  const byId = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);

  const children = useMemo(
    () => (items ?? []).filter((item) => item.parent === folder).sort(byKindThenName),
    [items, folder],
  );

  const trail = useMemo(() => {
    const crumbs: Crumb[] = [];
    let id = folder;
    // walk up through parents; the depth cap guards against cycles in bad data
    while (id && id !== TRASH_FOLDER && byId.has(id) && crumbs.length < 64) {
      const item = byId.get(id)!;
      crumbs.unshift({ id, name: item.name });
      id = item.parent;
    }
    if (folder === TRASH_FOLDER) crumbs.unshift({ id: TRASH_FOLDER, name: "Trash" });
    return crumbs;
  }, [folder, byId]);

  const trashCount = useMemo(() => (items ?? []).filter((item) => item.parent === TRASH_FOLDER).length, [items]);
  // can't upload into the trash, or into a folder that's itself in the trash
  const inTrash = folder === TRASH_FOLDER || byId.get(folder)?.parent === TRASH_FOLDER;
  const folderName = folder === ROOT_FOLDER ? "My files" : (byId.get(folder)?.name ?? "this folder");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-1 border-b border-neutral-400 px-3 py-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label="Folder path">
          <button className="underline" onClick={() => onOpenFolder(ROOT_FOLDER)}>
            My files
          </button>
          {trail.map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <button className="underline" onClick={() => onOpenFolder(crumb.id)}>
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <UploadButton queue={uploads} folder={folder} disabled={inTrash} />
        <button onClick={onCollapse} aria-label="Hide files" title="Hide files" className="hidden shrink-0 p-0.5 text-neutral-600 hover:text-neutral-900 md:block">
          <CaretDoubleRight size={16} aria-hidden />
        </button>
      </div>

      <UploadDropZone queue={uploads} folder={folder} folderName={folderName} disabled={inTrash}>
      <ul className="h-full overflow-y-auto" aria-label="Folder contents">
        {items === null && <li className="px-3 py-2 text-neutral-500">loading…</li>}
        {items !== null && children.length === 0 && <li className="px-3 py-2 text-neutral-500">(empty)</li>}

        {children.map((item) => {
          const isFolder = item.kind === "folder";
          const selected = item.id === selectedId;
          return (
            <li key={item.id} className="border-b border-dashed border-neutral-300">
              <button
                onClick={() => (isFolder ? onOpenFolder(item.id) : onSelect(item))}
                aria-current={selected ? "true" : undefined}
                className={`flex w-full flex-col items-start px-3 py-2 text-left ${selected ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
              >
                <span className="w-full truncate">
                  {isFolder ? "▸ " : "  "}
                  {item.name}
                  {item.pinned ? " *" : ""}
                </span>
                <span className={`text-xs ${selected ? "text-neutral-300" : "text-neutral-500"}`}>
                  {isFolder ? "folder" : item.fileType} · {formatDate(item.lastModified)}
                </span>
              </button>
            </li>
          );
        })}

        {folder === ROOT_FOLDER && trashCount > 0 && (
          <li className="border-b border-dashed border-neutral-300">
            <button
              onClick={() => onOpenFolder(TRASH_FOLDER)}
              className="flex w-full flex-col items-start px-3 py-2 text-left text-neutral-500 hover:bg-neutral-100"
            >
              <span>▸ Trash</span>
              <span className="text-xs">{trashCount} items</span>
            </button>
          </li>
        )}
      </ul>

      </UploadDropZone>

      <UploadList queue={uploads} />

      <p className="border-t border-neutral-400 px-3 py-2 text-xs text-neutral-500">
        {items ? `${items.length} items` : ""}
        {fetchedAt ? ` · updated ${new Date(fetchedAt).toLocaleTimeString()}` : ""}
      </p>
    </div>
  );
}
