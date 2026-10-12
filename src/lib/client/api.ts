/** Browser-side calls to the app's API routes. */
import type { PageInfo, Project } from "@/lib/editor/model";
import type { CloudItem } from "@/lib/remarkable/types";

export type ConnectionStatus =
  | { state: "loading" }
  | { state: "disconnected"; connectUrl: string }
  | { state: "connected"; /** largest PDF the server accepts for upload */ uploadMaxBytes?: number };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.message ?? `Request failed (${response.status}).`, response.status);
  return body as T;
}

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function fetchStatus(): Promise<ConnectionStatus> {
  const body = await readJson<{ connected: boolean; connectUrl: string; uploadMaxBytes?: number }>(await fetch("/api/remarkable/status"));
  return body.connected
    ? { state: "connected", uploadMaxBytes: body.uploadMaxBytes }
    : { state: "disconnected", connectUrl: body.connectUrl };
}

export async function connect(code: string): Promise<void> {
  await readJson(await postJson("/api/remarkable/connect", { code }));
}

export async function disconnect(): Promise<void> {
  await readJson(await postJson("/api/remarkable/disconnect", {}));
}

export async function fetchItems(refresh: boolean): Promise<{ items: CloudItem[]; fetchedAt: string }> {
  return readJson(await fetch(`/api/remarkable/files${refresh ? "?refresh=1" : ""}`));
}

/** PDF endpoint for a notebook; the hash changes the URL whenever the notebook changes. */
export function pdfUrl(item: CloudItem, download = false): string {
  return `/api/remarkable/documents/${item.id}/pdf?v=${item.hash.slice(0, 12)}${download ? "&download=1" : ""}`;
}

/** Download a notebook's PDF as a blob, surfacing API errors as messages. */
export async function fetchPdf(item: CloudItem, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(pdfUrl(item), { signal });
  if (!response.ok) await readJson(response);
  return response.blob();
}

/** Page ids in PDF order, so edits can be keyed to stable page ids. */
export async function fetchPages(item: CloudItem, signal?: AbortSignal): Promise<PageInfo[]> {
  const body = await readJson<{ pages: PageInfo[] }>(await fetch(`/api/remarkable/documents/${item.id}/pages`, { signal }));
  return body.pages;
}

export async function loadProject(notebookId: string, signal?: AbortSignal): Promise<Project | null> {
  return (await readJson<{ project: Project | null }>(await fetch(`/api/projects/${notebookId}`, { signal }))).project;
}

export async function saveProject(project: Project): Promise<void> {
  await readJson(
    await fetch(`/api/projects/${project.notebookId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(project),
    }),
  );
}

/** Export the notebook with its saved edits as a downloaded PDF. */
export async function downloadEdited(notebookId: string): Promise<Blob> {
  const response = await postJson(`/api/projects/${notebookId}/export`, { target: "download" });
  if (!response.ok) await readJson(response);
  return response.blob();
}

/** Upload the notebook with its saved edits to reMarkable as a new PDF document. */
export async function sendEditedToRemarkable(notebookId: string, name: string): Promise<{ id: string; name: string }> {
  return readJson(await postJson(`/api/projects/${notebookId}/export`, { target: "remarkable", name }));
}

export interface UploadedDocument {
  id: string;
  name: string;
  pages: number;
}

/**
 * Upload one PDF into a folder ("" = root), reporting progress (0..1).
 * Uses XMLHttpRequest because fetch can't report upload progress.
 */
export function uploadPdf(
  file: Blob & { name: string },
  { parent, onProgress, signal }: { parent: string; onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<UploadedDocument> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Upload cancelled.", "AbortError"));
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams({ name: file.name, parent });
    xhr.open("POST", `/api/remarkable/upload?${query}`);
    xhr.setRequestHeader("content-type", "application/pdf");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (UploadedDocument & { message?: string }) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else reject(new ApiError(body?.message ?? `Upload failed (${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Network error while uploading. Check your connection and try again.", 0));
    xhr.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
