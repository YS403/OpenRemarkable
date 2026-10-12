"use client";

import { useEffect, useRef } from "react";

import type { Element, TextElement } from "@/lib/editor/model";
import { wrapText } from "@/lib/editor/text";

import { measurer } from "./fonts";
import type { EditorAction } from "./state";

/**
 * Properties of the selected element. Changes commit immediately (one undo
 * step each); number inputs commit on change so typing stays responsive.
 */
export function ContextBar({ element, dispatch, onChange }: { element: Element | undefined; dispatch: (a: EditorAction) => void; onChange: (patch: Partial<Element>) => void }) {
  if (!element) return null;

  const field = "flex items-center gap-1";
  const button = "border border-neutral-600 px-1.5 leading-5";

  // text layout depends on font settings, so re-wrap whenever they change
  const textPatch = (el: TextElement, patch: Partial<TextElement>): Partial<TextElement> => {
    const next = { ...el, ...patch };
    return { ...patch, lines: wrapText(next.text, next.width, measurer(next)) };
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Element properties">
      <span className="font-bold uppercase">{element.type}</span>

      {element.type === "text" && (
        <>
          <label className={field}>
            size
            <NumberInput value={element.fontSize} min={2} max={500} onCommit={(fontSize) => onChange(textPatch(element, { fontSize }))} />
          </label>
          <button className={`${button} ${element.bold ? "bg-neutral-900 text-white" : ""}`} aria-pressed={element.bold} onClick={() => onChange(textPatch(element, { bold: !element.bold }))}>
            B
          </button>
          <button className={`${button} italic ${element.italic ? "bg-neutral-900 text-white" : ""}`} aria-pressed={element.italic} onClick={() => onChange(textPatch(element, { italic: !element.italic }))}>
            I
          </button>
          <select className="border border-neutral-600 px-1" value={element.align} onChange={(e) => onChange({ align: e.target.value as TextElement["align"] })} aria-label="Alignment">
            <option value="left">left</option>
            <option value="center">center</option>
            <option value="right">right</option>
          </select>
          <ColorField label="color" value={element.color} onCommit={(color) => onChange({ color })} />
        </>
      )}

      <label className={field}>
        opacity
        <NumberInput value={Math.round(element.opacity * 100)} min={0} max={100} onCommit={(v) => onChange({ opacity: v / 100 })} />%
      </label>

      <span className="flex gap-1">
        <button className={button} onClick={() => dispatch({ type: "reorder", to: "front" })} title="Bring to front">
          front
        </button>
        <button className={button} onClick={() => dispatch({ type: "reorder", to: "back" })} title="Send to back">
          back
        </button>
        <button className={button} onClick={() => dispatch({ type: "duplicate" })} title="Duplicate (Ctrl+D)">
          duplicate
        </button>
        <button className={button} onClick={() => dispatch({ type: "remove" })} title="Delete (Del)">
          delete
        </button>
      </span>
    </div>
  );
}

/** Number field that commits on blur or Enter, not on every keystroke (one undo step per change). */
function NumberInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  return (
    <input
      key={value}
      type="number"
      defaultValue={value}
      min={min}
      max={max}
      step="any"
      className="w-12 border border-neutral-600 px-1"
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== value) onCommit(Math.min(max, Math.max(min, v)));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        e.stopPropagation();
      }}
    />
  );
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // React's onChange fires continuously while dragging in the picker; the
    // native change event fires once when it closes, giving one undo step.
    const listener = () => commit.current(el.value);
    el.addEventListener("change", listener);
    return () => el.removeEventListener("change", listener);
    // the input remounts (new key) whenever the value changes
  }, [value]);

  return (
    <span className="flex items-center gap-1">
      {label}
      <input
        ref={input}
        key={value}
        type="color"
        defaultValue={value}
        aria-label={label}
        className="h-5 w-6 border border-neutral-600"
      />
    </span>
  );
}
