"use client";

import type { Tool } from "./state";

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "text", label: "Text", key: "T" },
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "saved",
  unsaved: "unsaved changes",
  saving: "saving…",
  error: "save failed",
};

export function Toolbar({
  tool,
  canUndo,
  canRedo,
  save,
  exporting,
  onTool,
  onUndo,
  onRedo,
  onDownload,
  onSendToRemarkable,
  children,
}: {
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  save: SaveStatus;
  exporting: "download" | "remarkable" | null;
  onTool: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDownload: () => void;
  onSendToRemarkable: () => void;
  /** style controls for the current selection, shown inline */
  children?: React.ReactNode;
}) {
  const button = "border border-neutral-600 px-1.5 leading-5 disabled:opacity-40";
  // one compact row: tools · history · selection style · save state · export
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-400 px-2 py-1 text-xs" role="toolbar" aria-label="Editing tools">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            onClick={() => onTool(t.tool)}
            aria-pressed={tool === t.tool}
            title={`${t.label} (${t.key})`}
            className={`${button} ${tool === t.tool ? "bg-neutral-900 text-white" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <span className="mx-0.5 h-4 w-px bg-neutral-400" aria-hidden />
      <button className={button} disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)">
        undo
      </button>
      <button className={button} disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Shift+Z)">
        redo
      </button>
      {children && (
        <>
          <span className="mx-0.5 h-4 w-px bg-neutral-400" aria-hidden />
          {children}
        </>
      )}
      <span className="ml-auto text-neutral-500" role="status">
        {SAVE_LABEL[save]}
      </span>
      <button className={button} disabled={exporting !== null} onClick={onDownload}>
        {exporting === "download" ? "exporting…" : "download"}
      </button>
      <button className={button} disabled={exporting !== null} onClick={onSendToRemarkable}>
        {exporting === "remarkable" ? "sending…" : "save to reMarkable"}
      </button>
    </div>
  );
}
