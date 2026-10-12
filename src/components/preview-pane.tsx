"use client";

import dynamic from "next/dynamic";

import type { CloudItem } from "@/lib/remarkable/types";

// The editor uses canvas, pdf.js and Konva, which only run in the browser.
const DocumentEditor = dynamic(() => import("./editor/document-editor").then((m) => m.DocumentEditor), {
  ssr: false,
  loading: () => <Placeholder>Loading editor…</Placeholder>,
});

export function PreviewPane({ item, onExported }: { item: CloudItem | null; onExported: () => void }) {
  if (!item) {
    return (
      <Placeholder>
        <p>Select a notebook or PDF from the list to open it.</p>
      </Placeholder>
    );
  }
  if (item.fileType !== "notebook" && item.fileType !== "pdf") {
    return (
      <Placeholder>
        <p className="font-bold">{item.name}</p>
        <p>Opening {item.fileType?.toUpperCase()} documents isn&apos;t supported yet.</p>
      </Placeholder>
    );
  }
  // keyed so switching notebooks (or a new version) starts fresh
  return <DocumentEditor key={`${item.id}:${item.hash}`} item={item} onExported={onExported} />;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-4">
      <div className="w-full max-w-sm space-y-1 border border-dashed border-neutral-400 p-6 text-center">{children}</div>
    </div>
  );
}
