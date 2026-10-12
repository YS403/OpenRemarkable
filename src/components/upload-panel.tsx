"use client";

import { ArrowsClockwise, Check, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { uploadPdf } from "@/lib/client/api";
import { formatBytes, type UploadItem, UploadQueue } from "@/lib/client/upload-queue";

const STATUS_LABEL: Record<UploadItem["status"], string> = {
  queued: "waiting",
  uploading: "uploading",
  done: "uploaded",
  failed: "failed",
  cancelled: "cancelled",
};

/** One upload queue per file panel; the limit and callback may change between renders. */
export function useUploadQueue(maxBytes: number, onUploaded: () => void): UploadQueue {
  const [queue] = useState(() => new UploadQueue(uploadPdf, maxBytes));
  useEffect(() => {
    queue.configure({ maxBytes, onUploaded: () => onUploaded() });
  }, [queue, maxBytes, onUploaded]);
  return queue;
}

export function useUploads(queue: UploadQueue): readonly UploadItem[] {
  return useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
}

/** How long the "uploaded" confirmation stays on the button. */
const UPLOADED_MS = 2500;

/**
 * The "upload" button with its hidden file picker. It shows progress in
 * itself: a spinner while files upload, then a check that pops in with
 * "uploaded" each time one finishes. More files can be added while busy.
 */
export function UploadButton({ queue, folder, disabled }: { queue: UploadQueue; folder: string; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const items = useUploads(queue);
  const remaining = items.filter((i) => i.status === "queued" || i.status === "uploading").length;
  // bumps on every completion so the animation restarts even if one is already showing
  const [celebrate, setCelebrate] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = queue.onCompleted(() => {
      clearTimeout(timer);
      setCelebrate((n) => n + 1);
      timer = setTimeout(() => setCelebrate(0), UPLOADED_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [queue]);

  const phase = celebrate > 0 ? "uploaded" : remaining > 0 ? "uploading" : "idle";

  return (
    <>
      <button
        onClick={() => input.current?.click()}
        disabled={disabled}
        aria-busy={phase === "uploading"}
        title={disabled ? "Files can't be uploaded into the trash" : "Upload PDFs to this folder"}
        data-phase={phase}
        className={`inline-flex min-w-[8rem] shrink-0 items-center justify-center gap-1 border px-1.5 py-0.5 text-xs transition-colors duration-300 disabled:opacity-40 ${
          phase === "uploaded" ? "sync-flash border-emerald-700 bg-emerald-700 text-white" : "border-neutral-600"
        }`}
      >
        {phase === "idle" && <UploadSimple size={14} aria-hidden />}
        {phase === "uploading" && <ArrowsClockwise size={14} weight="bold" className="motion-safe:animate-spin" aria-hidden />}
        {/* keyed so each completion replays the pop */}
        {phase === "uploaded" && <Check key={celebrate} size={14} weight="bold" className="sync-pop" aria-hidden />}
        <span aria-live="polite">{phase === "idle" ? "upload" : phase === "uploading" ? `uploading ${remaining}` : "uploaded"}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="upload-input"
        onChange={(e) => {
          if (e.target.files?.length) queue.add(Array.from(e.target.files), folder);
          e.target.value = ""; // allow picking the same file again
        }}
      />
    </>
  );
}

/**
 * Wraps the file list: dropping PDFs on it uploads them into the open folder.
 * Shows a dashed outline while files are dragged over.
 */
export function UploadDropZone({
  queue,
  folder,
  folderName,
  disabled,
  children,
}: {
  queue: UploadQueue;
  folder: string;
  folderName: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  // dragenter/leave fire for every child; count them so the outline doesn't flicker
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div
      className="relative min-h-0 flex-1"
      onDragEnter={(e) => {
        if (!hasFiles(e) || disabled) return;
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        queue.add(Array.from(e.dataTransfer.files), folder);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-1 grid place-items-center border-2 border-dashed border-neutral-700 bg-white/85 p-4 text-center">
          Drop PDFs to upload to {folderName}
        </div>
      )}
    </div>
  );
}

/** Per-file progress, with cancel / retry and a way to clear finished rows. */
export function UploadList({ queue }: { queue: UploadQueue }) {
  const items = useUploads(queue);
  if (items.length === 0) return null;
  const finished = items.some((i) => i.status !== "queued" && i.status !== "uploading");

  return (
    <section aria-label="Uploads" className="max-h-56 overflow-y-auto border-t border-neutral-400">
      <div className="flex items-center justify-between border-b border-neutral-300 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">
        <span>Uploads</span>
        {finished && (
          <button className="underline" onClick={() => queue.clearFinished()}>
            clear finished
          </button>
        )}
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="border-b border-dashed border-neutral-300 px-3 py-1.5" data-status={item.status}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={item.name}>
                {item.name}
              </span>
              {(item.status === "queued" || item.status === "uploading") && (
                <button className="text-xs underline" onClick={() => queue.cancel(item.id)}>
                  cancel
                </button>
              )}
              {(item.status === "failed" || item.status === "cancelled") && item.retryable && (
                <button className="text-xs underline" onClick={() => queue.retry(item.id)}>
                  retry
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{formatBytes(item.size)}</span>
              <span aria-live="polite">
                · {STATUS_LABEL[item.status]}
                {item.status === "uploading" ? ` ${Math.round(item.progress * 100)}%` : ""}
              </span>
            </div>
            {item.status === "uploading" && (
              <div className="mt-1 h-1 bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
                <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </div>
            )}
            {item.error && <p className="mt-0.5 text-xs">! {item.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
