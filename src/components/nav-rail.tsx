"use client";

import { ArrowsClockwise, CalendarBlank, CaretDoubleLeft, CaretDoubleRight, type Icon, Lightbulb, Notebook, SignOut } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { ConnectionStatus } from "@/lib/client/api";
import { createLocalSetting, parseBoolean } from "@/lib/client/local-setting";

import { FeatureRequestDialog } from "./feature-request-dialog";
import { Logo } from "./logo";

const railCollapsed = createLocalSetting("nav-rail-collapsed", false, parseBoolean);

/** Top-level pages, in rail order. */
const PAGES: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "Notebooks", icon: Notebook },
  { href: "/planner", label: "Planner", icon: CalendarBlank },
];

const STATUS_LABEL: Record<ConnectionStatus["state"], string> = {
  loading: "Checking connection",
  connected: "Connected",
  disconnected: "Not connected",
};

/**
 * Left navigation rail in the brand's metallic blue. Expanded it shows labels;
 * collapsed it narrows to icons, and labels move to tooltips.
 */
export function NavRail({
  status,
  refreshing,
  onRefresh,
  onDisconnect,
}: {
  status: ConnectionStatus;
  refreshing: boolean;
  onRefresh?: () => void;
  onDisconnect?: () => void;
}) {
  const collapsed = railCollapsed.use();
  const pathname = usePathname();
  const [requesting, setRequesting] = useState(false);
  const base = "flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm transition-colors active:scale-[0.98]";
  // one text color per state, so classes never compete
  const item = `${base} text-on-brand-muted hover:bg-white/10 hover:text-on-brand disabled:opacity-50 disabled:hover:bg-transparent`;
  const activeItem = `${base} bg-white/15 text-on-brand shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]`;
  const label = collapsed ? "sr-only" : "truncate";

  return (
    <nav
      aria-label="Main"
      className={`surface-metal flex shrink-0 flex-col gap-1 p-2 text-on-brand motion-safe:transition-[width] motion-safe:duration-200 ${collapsed ? "w-14" : "w-52"}`}
    >
      <div className="mb-2 flex h-10 items-center gap-2.5 px-1.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" aria-hidden>
          <Logo size={18} />
        </span>
        <span className={`${label} text-sm font-semibold tracking-tight`}>OpenRemarkable</span>
      </div>

      {PAGES.map(({ href, label: text, icon: PageIcon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={active ? activeItem : item}
            title={collapsed ? text : undefined}
          >
            <PageIcon size={18} weight="regular" className="shrink-0" aria-hidden />
            <span className={label}>{text}</span>
          </Link>
        );
      })}

      <div className="mt-auto flex flex-col gap-1">
        <button
          className={item}
          onClick={() => setRequesting(true)}
          aria-haspopup="dialog"
          title={collapsed ? "Request a feature" : undefined}
        >
          <Lightbulb size={18} className="shrink-0" aria-hidden />
          <span className={label}>Request a feature</span>
        </button>
        <FeatureRequestDialog open={requesting} onClose={() => setRequesting(false)} />
        <div className="flex h-9 items-center gap-3 px-2.5 text-xs text-on-brand-muted" role="status" title={collapsed ? STATUS_LABEL[status.state] : undefined}>
          {/* a real state indicator, not decoration */}
          <span
            className={`size-2 shrink-0 rounded-full ${status.state === "connected" ? "bg-emerald-300" : status.state === "loading" ? "bg-on-brand-muted" : "bg-amber-300"}`}
            aria-hidden
          />
          <span className={label}>{STATUS_LABEL[status.state]}</span>
        </div>
        {onRefresh && (
          <button className={item} onClick={onRefresh} disabled={refreshing} title={collapsed ? "Refresh files" : undefined}>
            <ArrowsClockwise size={18} className={`shrink-0 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden />
            <span className={label}>{refreshing ? "Refreshing" : "Refresh files"}</span>
          </button>
        )}
        {onDisconnect && (
          <button className={item} onClick={onDisconnect} title={collapsed ? "Disconnect" : undefined}>
            <SignOut size={18} className="shrink-0" aria-hidden />
            <span className={label}>Disconnect</span>
          </button>
        )}
        <button
          className={`${item} mt-1 border-t border-white/10 pt-1`}
          onClick={() => railCollapsed.set(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand" : undefined}
        >
          {collapsed ? <CaretDoubleRight size={18} className="shrink-0" aria-hidden /> : <CaretDoubleLeft size={18} className="shrink-0" aria-hidden />}
          <span className={label}>Collapse</span>
        </button>
      </div>
    </nav>
  );
}
