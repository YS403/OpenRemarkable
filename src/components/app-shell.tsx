"use client";

import { useCallback, useEffect, useState } from "react";

import { type ConnectionStatus, disconnect, fetchItems, fetchStatus } from "@/lib/client/api";
import { type CloudItem, ROOT_FOLDER } from "@/lib/remarkable/types";

import { ConnectPanel } from "./connect-panel";
import { FileSidebar } from "./file-sidebar";
import { PreviewPane } from "./preview-pane";
import { NavRail } from "./nav-rail";

/** used until the server reports its limit; matches the serverless default */
const DEFAULT_UPLOAD_MAX = 4 * 1024 * 1024;
import { SidePanel } from "./side-panel";

/**
 * Page layout: the navigation rail on the left, the editor filling the main
 * area, and the file list in a fixed column on the right. On narrow screens
 * the list stacks above the editor.
 */
export function AppShell() {
  const [status, setStatus] = useState<ConnectionStatus>({ state: "loading" });
  const [statusCheck, setStatusCheck] = useState(0);
  const [items, setItems] = useState<CloudItem[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [folder, setFolder] = useState(ROOT_FOLDER);
  const [selected, setSelected] = useState<CloudItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchStatus().then(
      (next) => active && setStatus(next),
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, [statusCheck]);

  const connected = status.state === "connected";

  const applyListing = useCallback((body: { items: CloudItem[]; fetchedAt: string }) => {
    setItems(body.items);
    setFetchedAt(body.fetchedAt);
    // keep the open document in sync with its latest version
    setSelected((current) => (current ? (body.items.find((i) => i.id === current.id) ?? null) : null));
  }, []);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    fetchItems(false).then(
      (body) => active && applyListing(body),
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, [connected, applyListing]);

  async function refresh() {
    setListing(true);
    setError(null);
    try {
      applyListing(await fetchItems(true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setListing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect this reMarkable account from the app?")) return;
    try {
      await disconnect();
      setItems(null);
      setSelected(null);
      setFolder(ROOT_FOLDER);
      setStatus({ state: "loading" });
      setStatusCheck((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex h-dvh">
      <NavRail
        status={status}
        refreshing={listing}
        onRefresh={connected ? refresh : undefined}
        onDisconnect={connected ? handleDisconnect : undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col font-mono text-sm">

        {error && (
          <div role="alert" className="flex items-center gap-3 border-b border-neutral-400 px-4 py-2">
            <span className="flex-1">! {error}</span>
            <button className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}

        {status.state === "disconnected" && (
          <ConnectPanel
            connectUrl={status.connectUrl}
            onConnected={() => {
              setError(null);
              setStatus({ state: "connected" });
            }}
          />
        )}

        {connected && (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,40%)_minmax(0,1fr)] md:flex md:grid-rows-none">
            <main className="order-last min-h-0 md:order-first md:min-w-0 md:flex-1">
              <PreviewPane item={selected} onExported={() => void refresh()} />
            </main>
            <SidePanel storageKey="files" label="Files">
              {(collapse) => (
                <FileSidebar
                  items={items}
                  fetchedAt={fetchedAt}
                  folder={folder}
                  selectedId={selected?.id ?? null}
                  onOpenFolder={setFolder}
                  onSelect={setSelected}
                  onCollapse={collapse}
                  uploadMaxBytes={status.state === "connected" ? (status.uploadMaxBytes ?? DEFAULT_UPLOAD_MAX) : DEFAULT_UPLOAD_MAX}
                  onUploaded={() => void refresh()}
                />
              )}
            </SidePanel>
          </div>
        )}
      </div>
    </div>
  );
}
