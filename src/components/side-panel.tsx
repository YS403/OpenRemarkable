"use client";

import { CaretDoubleLeft } from "@phosphor-icons/react";
import { useRef } from "react";

import { createLocalSetting, parseBoolean, parseNumber } from "@/lib/client/local-setting";

const MIN_WIDTH = 220;
const DEFAULT_WIDTH = 352;
/** never let the list take more than this share of the window */
const MAX_SHARE = 0.6;
const KEY_STEP = 16;

/** Width and collapsed state are remembered per panel (`files`, `calendars`, …). */
const settings = new Map<string, ReturnType<typeof makeSettings>>();
const makeSettings = (key: string) => ({
  width: createLocalSetting(`${key}-panel-width`, DEFAULT_WIDTH, parseNumber),
  collapsed: createLocalSetting(`${key}-panel-collapsed`, false, parseBoolean),
});
function panelSettings(key: string) {
  let entry = settings.get(key);
  if (!entry) settings.set(key, (entry = makeSettings(key)));
  return entry;
}

/** Stop text getting selected while a resize drag crosses it. */
function setPageSelectable(selectable: boolean) {
  document.body.style.userSelect = selectable ? "" : "none";
}

const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth * MAX_SHARE)));

/**
 * A right-hand column (the file list, the calendar list): resizable by dragging (or arrow keys on) its left
 * edge, and collapsible to a thin strip. Both are remembered per browser.
 * On narrow screens it stacks above the main area at full width instead.
 */
export function SidePanel({
  storageKey,
  label,
  children,
}: {
  storageKey: string;
  /** accessible name, e.g. "Files" */
  label: string;
  children: (collapse: () => void) => React.ReactNode;
}) {
  const { width: panelWidth, collapsed: panelCollapsed } = panelSettings(storageKey);
  const width = panelWidth.use();
  const collapsed = panelCollapsed.use();
  const aside = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  // While dragging, write the width straight to the element; React and the
  // editor only see the final value when the drag ends.
  const preview = (w: number) => aside.current?.style.setProperty("--files-w", `${w}px`);

  return (
    <aside
      ref={aside}
      aria-label={label}
      style={{ "--files-w": `${width}px` } as React.CSSProperties}
      className={`relative min-h-0 w-full border-b border-neutral-400 md:shrink-0 md:border-b-0 md:border-l ${collapsed ? "md:w-10" : "md:w-[var(--files-w)]"}`}
    >
      {collapsed ? (
        <>
          {/* narrow screens ignore the collapsed state */}
          <div className="h-full md:hidden">{children(() => panelCollapsed.set(true))}</div>
          <button
            onClick={() => panelCollapsed.set(false)}
            aria-label={`Show ${label.toLowerCase()}`}
            title={`Show ${label.toLowerCase()}`}
            className="hidden h-full w-full flex-col items-center pt-2 text-neutral-600 hover:bg-neutral-100 md:flex"
          >
            <CaretDoubleLeft size={16} aria-hidden />
          </button>
        </>
      ) : (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${label.toLowerCase()} panel`}
            aria-valuenow={width}
            aria-valuemin={MIN_WIDTH}
            tabIndex={0}
            title="Drag to resize, double-click to reset"
            className="absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none hover:bg-neutral-400/40 focus-visible:bg-neutral-500/50 md:block"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { startX: e.clientX, startWidth: width, width };
              setPageSelectable(false);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              // the panel sits on the right, so moving left makes it wider
              d.width = clampWidth(d.startWidth + d.startX - e.clientX);
              preview(d.width);
            }}
            onPointerUp={() => {
              if (drag.current) panelWidth.set(drag.current.width);
              drag.current = null;
              setPageSelectable(true);
            }}
            onDoubleClick={() => panelWidth.set(DEFAULT_WIDTH)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                panelWidth.set(clampWidth(width + (e.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP)));
              }
            }}
          />
          {children(() => panelCollapsed.set(true))}
        </>
      )}
    </aside>
  );
}
