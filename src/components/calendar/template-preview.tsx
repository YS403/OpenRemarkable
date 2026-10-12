"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { openPdf } from "../editor/pdf";
import { SyncButton } from "./sync-button";

const PAGE_PADDING = 16;
/** reMarkable paper is 1404 × 1872 px */
const PAGE_ASPECT = 1404 / 1872;

/**
 * The middle of the Calendar page: a toolbar to pick the day and save, and the
 * template exactly as it will appear on the tablet, fitted to the space.
 */
export function TemplatePreview({
  dayLabel,
  pdf,
  stale,
  error,
  canSync,
  fileName,
  onDay,
  onSync,
}: {
  dayLabel: string;
  /** the rendered template; null until the first render */
  pdf: Uint8Array | null;
  /** true while a newer version is being prepared */
  stale: boolean;
  error: string | null;
  canSync: boolean;
  fileName: string;
  onDay: (delta: number) => void;
  /** bring the calendar document on reMarkable up to date (today + 6 days) */
  onSync: () => Promise<{ message: string }>;
}) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const shownPage = Math.min(page, pageCount);
  const [note, setNote] = useState<string | null>(null);

  /** true when the sync succeeded, so the button can confirm it */
  async function sync(): Promise<boolean> {
    setNote(null);
    try {
      setNote((await onSync()).message);
      return true;
    } catch (e) {
      setNote(`! ${(e as Error).message}`);
      return false;
    }
  }

  function download() {
    if (!pdf) return;
    const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName}.pdf` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const busy = pdf === null || stale;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-300 px-3 py-1.5">
        <div className="flex flex-1 items-center gap-2">
          <button className="border border-neutral-500 p-1" onClick={() => onDay(-1)} aria-label="Previous day">
            <CaretLeft size={14} aria-hidden />
          </button>
          {/* the day this template page is for, between the arrows */}
          <h1 className="min-w-[11rem] truncate text-center font-bold" aria-live="polite">
            {dayLabel}
          </h1>
          <button className="border border-neutral-500 p-1" onClick={() => onDay(1)} aria-label="Next day">
            <CaretRight size={14} aria-hidden />
          </button>
        </div>
        {pageCount > 1 && (
          <span className="flex items-center gap-1 text-xs">
            <button className="border border-neutral-500 p-0.5 disabled:opacity-40" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)} aria-label="Previous page">
              <CaretLeft size={12} aria-hidden />
            </button>
            <span aria-live="polite">
              page {shownPage}/{pageCount}
            </span>
            <button className="border border-neutral-500 p-0.5 disabled:opacity-40" disabled={shownPage >= pageCount} onClick={() => setPage(shownPage + 1)} aria-label="Next page">
              <CaretRight size={12} aria-hidden />
            </button>
          </span>
        )}
        <span className="text-xs text-neutral-500">{busy ? "rendering…" : "template ready"}</span>
        <button className="border border-neutral-600 px-2 py-0.5 disabled:opacity-40" disabled={busy} onClick={download}>
          download
        </button>
        <SyncButton
          disabled={!canSync}
          title={canSync ? "Adds today and the next 6 days to your Calendar document" : "Connect your reMarkable first"}
          onSync={sync}
        />
      </div>

      {note && (
        <p role="status" className="flex items-center gap-3 border-b border-neutral-300 px-4 py-1.5 text-xs">
          <span className="flex-1">{note}</span>
          <button className="underline" onClick={() => setNote(null)}>
            dismiss
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="border-b border-neutral-300 px-4 py-1.5 text-xs">
          ! Couldn&apos;t render the template: {error}
        </p>
      )}

      <PageCanvas pdf={pdf} pageNumber={shownPage} dimmed={stale} onPageCount={setPageCount} />
    </div>
  );
}

/** Fit one portrait page into the available space and paint it with pdf.js. */
function PageCanvas({
  pdf,
  pageNumber,
  dimmed,
  onPageCount,
}: {
  pdf: Uint8Array | null;
  pageNumber: number;
  dimmed: boolean;
  onPageCount: (count: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // the open document plus a liveness check: it is destroyed when `pdf` changes or on unmount
  const [doc, setDoc] = useState<{ pdf: PDFDocumentProxy; isOpen: () => boolean } | null>(null);

  // the largest page that fits, keeping the paper's proportions
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width - PAGE_PADDING * 2;
      const h = entry.contentRect.height - PAGE_PADDING * 2;
      const width = Math.max(120, Math.min(w, h * PAGE_ASPECT));
      setSize({ width: Math.floor(width), height: Math.floor(width / PAGE_ASPECT) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf) return;
    let closed = false;
    let close: (() => Promise<void>) | null = null;
    // pdf.js takes ownership of the buffer, so hand it a copy
    openPdf(pdf.slice().buffer).then(
      (opened) => {
        close = opened.close;
        if (closed) void opened.close();
        else {
          setDoc({ pdf: opened.pdf, isOpen: () => !closed });
          onPageCount(opened.pdf.numPages);
        }
      },
      () => {},
    );
    return () => {
      closed = true;
      void close?.();
    };
  }, [pdf, onPageCount]);

  useEffect(() => {
    // a document closed by a newer render (or an unmount) can't be drawn from; its replacement will be
    if (!doc || !doc.isOpen() || !size || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    let pending: Promise<PDFPageProxy>;
    try {
      pending = doc.pdf.getPage(Math.min(pageNumber, doc.pdf.numPages));
    } catch {
      return; // closed between the check and the call
    }
    pending.then((page) => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (size.width / base.width) * ratio });
      // draw off-screen, then swap in, so the page never flashes blank
      const scratch = document.createElement("canvas");
      scratch.width = Math.floor(viewport.width);
      scratch.height = Math.floor(viewport.height);
      task = page.render({ canvas: scratch, viewport });
      task.promise.then(
        () => {
          const el = canvas.current;
          if (cancelled || !el) return;
          el.width = scratch.width;
          el.height = scratch.height;
          el.getContext("2d")?.drawImage(scratch, 0, 0);
        },
        () => {}, // cancelled
      );
    }, () => {}); // the document was closed while loading the page
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, size, pageNumber]);

  return (
    <div ref={box} className="grid min-h-0 flex-1 place-items-center overflow-hidden">
      {size && (
        <div
          className={`relative bg-white outline outline-1 outline-neutral-500 transition-opacity ${dimmed || !doc ? "opacity-60" : ""}`}
          style={{ width: size.width, height: size.height }}
          aria-label="Template preview"
          role="img"
        >
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
          {!doc && <span className="absolute inset-0 grid place-items-center text-xs text-neutral-500">rendering…</span>}
        </div>
      )}
    </div>
  );
}
