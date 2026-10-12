"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef } from "react";

/**
 * A native modal dialog in the app's wireframe style: focus is trapped, Esc
 * and the backdrop close it, and the page behind is inert while it's open.
 * Mark the field that should get focus with `data-autofocus`.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // showModal focuses the first control (the close button); prefer the marked field
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // a click on the backdrop lands on the dialog element itself
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-labelledby={titleId}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] border border-neutral-500 bg-white p-0 font-mono text-sm text-neutral-900 backdrop:bg-black/30"
    >
      <div className="flex items-center gap-2 border-b border-neutral-400 px-4 py-2">
        <h2 id={titleId} className="flex-1 font-bold">
          {title}
        </h2>
        <button onClick={onClose} aria-label="Close" className="p-0.5 text-neutral-600 hover:text-neutral-900">
          <X size={16} aria-hidden />
        </button>
      </div>
      {/* unmount the body when closed so forms start fresh */}
      {open && children}
    </dialog>
  );
}
