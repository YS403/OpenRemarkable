/**
 * Browser-side upload queue: validates files, uploads them one at a time (so
 * concurrent writes don't collide in the cloud), tracks progress, and supports
 * retry, cancel and clearing finished items. Framework-free, so it is unit
 * tested directly; React subscribes through `subscribe`/`getSnapshot`.
 */

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "cancelled";

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  /** folder it goes into ("" = root) */
  parent: string;
  status: UploadStatus;
  /** 0..1 while uploading */
  progress: number;
  error?: string;
  /** set when done */
  documentId?: string;
  /** false for files rejected before upload (wrong type, empty, too large) */
  retryable: boolean;
}

export interface UploadFile extends Blob {
  name: string;
}

export type Uploader = (
  file: UploadFile,
  options: { parent: string; onProgress: (fraction: number) => void; signal: AbortSignal },
) => Promise<{ id: string }>;

const isPdf = (file: UploadFile) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Why a file can't be uploaded, or null if it can. */
export function rejectReason(file: UploadFile, maxBytes: number): string | null {
  if (!isPdf(file)) return "Only PDF files can be uploaded.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > maxBytes) return `Too large: PDFs can be up to ${formatBytes(maxBytes)} here.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export class UploadQueue {
  private items: UploadItem[] = [];
  private files = new Map<number, UploadFile>();
  private controllers = new Map<number, AbortController>();
  private listeners = new Set<() => void>();
  private completionListeners = new Set<(item: UploadItem) => void>();
  private nextId = 1;
  private running = false;

  constructor(
    private readonly upload: Uploader,
    private maxBytes: number,
    /** called after each successful upload (e.g. to refresh the file list) */
    private onUploaded: (item: UploadItem) => void = () => {},
  ) {}

  /** Update the size limit and success callback (applies to files added afterwards / later successes). */
  configure({ maxBytes, onUploaded }: { maxBytes?: number; onUploaded?: (item: UploadItem) => void }): void {
    if (maxBytes !== undefined) this.maxBytes = maxBytes;
    if (onUploaded !== undefined) this.onUploaded = onUploaded;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly UploadItem[] => this.items;

  /** Be told each time a file finishes uploading (e.g. to animate a confirmation). Returns an unsubscribe. */
  onCompleted(listener: (item: UploadItem) => void): () => void {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }

  /** Queue files for a folder; files that can't be uploaded are listed as failed straight away. */
  add(files: Iterable<UploadFile>, parent: string): void {
    for (const file of files) {
      const id = this.nextId++;
      const reason = rejectReason(file, this.maxBytes);
      this.items = [
        ...this.items,
        { id, name: file.name, size: file.size, parent, status: reason ? "failed" : "queued", progress: 0, error: reason ?? undefined, retryable: !reason },
      ];
      if (!reason) this.files.set(id, file);
    }
    this.emit();
    void this.pump();
  }

  /** Try a failed or cancelled upload again (only ones that passed validation). */
  retry(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || !item.retryable || (item.status !== "failed" && item.status !== "cancelled") || !this.files.has(id)) return;
    this.update(id, { status: "queued", progress: 0, error: undefined });
    void this.pump();
  }

  /** Stop an upload that's queued or in progress. */
  cancel(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.status === "queued") this.update(id, { status: "cancelled" });
    else if (item.status === "uploading") this.controllers.get(id)?.abort();
  }

  /** Drop finished entries (done, failed, cancelled) from the list. */
  clearFinished(): void {
    const keep = this.items.filter((i) => i.status === "queued" || i.status === "uploading");
    for (const item of this.items) if (!keep.includes(item)) this.files.delete(item.id);
    this.items = keep;
    this.emit();
  }

  get busy(): boolean {
    return this.items.some((i) => i.status === "queued" || i.status === "uploading");
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.items.find((i) => i.status === "queued");
        if (!next) break;
        await this.run(next);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(item: UploadItem): Promise<void> {
    const file = this.files.get(item.id);
    if (!file) return this.update(item.id, { status: "failed", error: "The file is no longer available." });
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    this.update(item.id, { status: "uploading", progress: 0 });
    try {
      const result = await this.upload(file, {
        parent: item.parent,
        signal: controller.signal,
        // whole-percent steps, so the list doesn't re-render on every chunk
        onProgress: (fraction) => {
          const current = this.items.find((i) => i.id === item.id);
          const rounded = Math.min(1, Math.round(fraction * 100) / 100);
          if (current && current.status === "uploading" && rounded > current.progress) this.update(item.id, { progress: rounded });
        },
      });
      this.update(item.id, { status: "done", progress: 1, documentId: result.id });
      const done = this.items.find((i) => i.id === item.id)!;
      this.onUploaded(done);
      for (const listener of this.completionListeners) listener(done);
    } catch (error) {
      const aborted = controller.signal.aborted || (error as Error).name === "AbortError";
      this.update(item.id, aborted ? { status: "cancelled" } : { status: "failed", error: (error as Error).message || "Upload failed." });
    } finally {
      this.controllers.delete(item.id);
    }
  }

  private update(id: number, patch: Partial<UploadItem>): void {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
