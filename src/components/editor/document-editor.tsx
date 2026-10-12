"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { downloadEdited, fetchPages, fetchPdf, loadProject, saveProject, sendEditedToRemarkable } from "@/lib/client/api";
import { type Element, type PageInfo, type Project, PROJECT_SCHEMA_VERSION } from "@/lib/editor/model";
import type { CloudItem } from "@/lib/remarkable/types";

import { ContextBar } from "./context-bar";
import { loadEditorFonts } from "./fonts";
import { PageView } from "./page-view";
import { openPdf, pageSizes } from "./pdf";
import { editorReducer, findElement, initialEditorState } from "./state";
import { type SaveStatus, TOOL_KEYS, Toolbar } from "./toolbar";

const AUTOSAVE_DELAY_MS = 800;
/** Space around and between pages, in CSS pixels. */
const PAGE_GAP = 16;
const MAX_SCALE = 2.5;
const RESIZE_SETTLE_MS = 120;

interface Loaded {
  pdf: PDFDocumentProxy;
  sizes: { width: number; height: number }[];
  pages: PageInfo[];
  /** the saved project was made against an older version of the notebook */
  stale: boolean;
}

type Load = { phase: "loading" } | { phase: "error"; message: string } | ({ phase: "ready" } & Loaded);

/** Edit a notebook: its pages as the background, with an editable layer on top. */
export function DocumentEditor({ item, onExported }: { item: CloudItem; onExported: () => void }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [savedRevision, setSavedRevision] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"download" | "remarkable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scroller = useRef<HTMLDivElement>(null);

  // load the PDF, page ids, saved edits and editor fonts together
  useEffect(() => {
    const controller = new AbortController();
    let close: (() => Promise<void>) | null = null;
    (async () => {
      const [blob, pages, project] = await Promise.all([
        fetchPdf(item, controller.signal),
        fetchPages(item, controller.signal),
        loadProject(item.id, controller.signal),
        loadEditorFonts(),
      ]);
      const opened = await openPdf(await blob.arrayBuffer());
      // left (or switched documents) while it was opening: free it right away
      if (controller.signal.aborted) return void opened.close();
      close = opened.close;
      const pdf = opened.pdf;
      const sizes = await pageSizes(pdf);
      if (controller.signal.aborted) return;
      dispatch({ type: "load", pages: project?.pages ?? {} });
      setLoad({ phase: "ready", pdf, sizes, pages, stale: !!project && project.notebookHash !== item.hash });
    })().catch((e: Error) => {
      if (!controller.signal.aborted) setLoad({ phase: "error", message: e.message });
    });
    return () => {
      controller.abort();
      void close?.();
    };
  }, [item]);

  // fit whole pages into the available area
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // First size applies at once; later changes (window or panel resizes) settle
    // before rescaling, so pages aren't re-rendered on every frame of a drag.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      clearTimeout(timer);
      if (first) {
        first = false;
        setViewport(next);
      } else {
        timer = setTimeout(() => setViewport(next), RESIZE_SETTLE_MS);
      }
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [load.phase]);

  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const persist = useCallback(async () => {
    const { pages, revision } = latest.current;
    const project: Project = {
      version: PROJECT_SCHEMA_VERSION,
      notebookId: item.id,
      notebookHash: item.hash,
      // drop pages whose edits were all deleted
      pages: Object.fromEntries(Object.entries(pages).filter(([, els]) => els.length > 0)),
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await saveProject(project);
      setSavedRevision(revision);
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
      throw new Error("Couldn't save your edits. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [item]);

  // autosave shortly after the last change
  useEffect(() => {
    if (state.revision === 0 || state.revision === savedRevision) return;
    const timer = setTimeout(() => void persist().catch(() => {}), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.revision, savedRevision, persist]);

  const saveStatus: SaveStatus = saving ? "saving" : saveFailed ? "error" : state.revision === savedRevision ? "saved" : "unsaved";

  const selected = findElement(state.pages, state.selection);
  const updateSelected = (patch: Partial<Element>) => state.selection && dispatch({ type: "update", ref: state.selection, patch });

  // keyboard shortcuts (typing in inputs and the text editor is left alone)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const s = latest.current;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        dispatch({ type: "duplicate" });
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) {
        e.preventDefault();
        dispatch({ type: "remove" });
      } else if (e.key === "Escape") {
        dispatch({ type: "select", selection: null });
        dispatch({ type: "tool", tool: "select" });
      } else if (e.key === "Enter" && s.selection && findElement(s.pages, s.selection)?.type === "text") {
        e.preventDefault();
        dispatch({ type: "edit", ref: s.selection });
      } else if (e.key.startsWith("Arrow") && s.selection) {
        e.preventDefault();
        const el = findElement(s.pages, s.selection);
        if (!el) return;
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        dispatch({ type: "update", ref: s.selection, patch: { x: el.x + dx, y: el.y + dy } });
      } else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
        dispatch({ type: "tool", tool: TOOL_KEYS[e.key.toLowerCase()] });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function exportTo(target: "download" | "remarkable") {
    let name = `${item.name} (edited)`;
    if (target === "remarkable") {
      const chosen = window.prompt("Name for the new document on your reMarkable:", name);
      if (chosen === null) return;
      name = chosen.trim() || name;
    }
    setExporting(target);
    setNotice(null);
    try {
      // export reads the saved project, so save pending edits first
      if (latest.current.revision !== savedRevision) await persist();
      if (target === "download") {
        const blob = await downloadEdited(item.id);
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: `${item.name} (edited).pdf` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else {
        const uploaded = await sendEditedToRemarkable(item.id, name);
        setNotice(`Saved to your reMarkable as “${uploaded.name}”.`);
        onExported();
      }
    } catch (e) {
      setNotice(`! ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  if (load.phase === "loading") return <Centered>Loading notebook…</Centered>;
  if (load.phase === "error") return <Centered>! {load.message}</Centered>;

  // Fit a whole standard page on screen. Pages that grew taller (scrolled notebook
  // pages) keep the same scale and scroll, so text stays a consistent size.
  const fitWidth = Math.max(...load.sizes.map((s) => s.width));
  const fitHeight = Math.min(...load.sizes.map((s) => s.height));
  const scale =
    viewport.width > 0
      ? Math.min(
          MAX_SCALE,
          Math.max(0.2, Math.min((viewport.width - 2 * PAGE_GAP) / fitWidth, (viewport.height - 2 * PAGE_GAP) / fitHeight)),
        )
      : 0;

  return (
    <section className="flex h-full flex-col" aria-label={`Editing ${item.name}`}>
      <Toolbar
        tool={state.tool}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        save={saveStatus}
        exporting={exporting}
        onTool={(tool) => dispatch({ type: "tool", tool })}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onDownload={() => void exportTo("download")}
        onSendToRemarkable={() => void exportTo("remarkable")}
      >
        {selected && <ContextBar element={selected} dispatch={dispatch} onChange={updateSelected} />}
      </Toolbar>
      {(notice || load.stale) && (
        <div role="status" className="flex items-center gap-3 border-b border-neutral-400 px-2 py-1 text-xs">
          <span className="flex-1">
            {notice ?? "This notebook changed on the tablet since you last edited it; check that your edits still line up."}
          </span>
          {notice && (
            <button className="underline" onClick={() => setNotice(null)}>
              dismiss
            </button>
          )}
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        {scale > 0 && (
          <div className="flex flex-col items-center" style={{ gap: PAGE_GAP, padding: PAGE_GAP }}>
            {load.sizes.map((size, i) => {
              const pageId = load.pages[i]?.id ?? null;
              return (
                <PageView
                  key={i}
                  pdf={load.pdf}
                  pageNumber={i + 1}
                  pageId={pageId}
                  size={size}
                  scale={scale}
                  elements={(pageId && state.pages[pageId]) || EMPTY}
                  tool={state.tool}
                  selection={state.selection}
                  editing={state.editing}
                  dispatch={dispatch}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const EMPTY: Element[] = [];

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-4">
      <p className="border border-dashed border-neutral-400 p-6">{children}</p>
    </div>
  );
}
