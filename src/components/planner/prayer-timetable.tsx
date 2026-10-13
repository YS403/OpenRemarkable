"use client";

import { DownloadSimple, FileArrowUp, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { EXAMPLE_TIMETABLE, monthLabel, prayerTimetable } from "@/lib/client/prayer";
import type { TimetableSummary } from "@/lib/prayer/timetable";

import { Modal } from "../modal";

/**
 * Sidebar block on the Planner page: a switch for prayer times on pages, and
 * (when on) a button that opens the timetable dialog to upload months of JSON.
 */
export function PrayerTimesSection({ onChanged }: { onChanged: () => void }) {
  // null while loading; "unavailable" when there's no session to store it against
  const [summary, setSummary] = useState<TimetableSummary | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    prayerTimetable.summary().then(
      (s) => active && setSummary(s),
      () => active && setSummary("unavailable"),
    );
    return () => {
      active = false;
    };
  }, []);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setNote(null);
    try {
      setSummary(await prayerTimetable.setEnabled(enabled));
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = summary !== null && summary !== "unavailable";
  const enabled = ready && summary.enabled;
  const months = ready ? summary.months : [];

  // one quiet row: name, timetable button (when on), switch
  return (
    <li className="border-b border-dashed border-neutral-300 px-3 py-2">
      <div className="flex items-center gap-2">
        <span id="prayer-times-label" className="min-w-0 flex-1" title={summary === "unavailable" ? "Connect your reMarkable first" : undefined}>
          Prayer times
        </span>
        {enabled && (
          <button
            onClick={() => setOpen(true)}
            aria-label="Prayer timetable"
            title="Prayer timetable"
            className="p-0.5 text-neutral-600 hover:text-neutral-900"
          >
            <FileArrowUp size={16} aria-hidden />
          </button>
        )}
        <Switch checked={enabled} disabled={!ready || busy} labelledBy="prayer-times-label" onChange={toggle} />
      </div>
      {note && (
        <p role="status" className="mt-1 border border-neutral-400 px-2 py-1 text-xs">
          ! {note}
        </p>
      )}

      <PrayerTimetableDialog
        open={open}
        months={months}
        onClose={() => setOpen(false)}
        onSummary={(next) => {
          setSummary(next);
          onChanged();
        }}
      />
    </li>
  );
}

function Switch({ checked, disabled, labelledBy, onChange }: { checked: boolean; disabled: boolean; labelledBy: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 border border-neutral-600 transition-colors disabled:opacity-40 ${checked ? "bg-neutral-900" : "bg-white"}`}
    >
      <span className={`absolute top-0.5 size-3.5 border border-neutral-600 bg-white transition-[left] ${checked ? "left-[1.1rem]" : "left-0.5"}`} aria-hidden />
    </button>
  );
}

interface FileResult {
  name: string;
  ok: boolean;
  message: string;
}

/** Upload one or more JSON files (any months), see what's stored, and remove months. */
function PrayerTimetableDialog({
  open,
  months,
  onClose,
  onSummary,
}: {
  open: boolean;
  months: TimetableSummary["months"];
  onClose: () => void;
  onSummary: (summary: TimetableSummary) => void;
}) {
  return (
    <Modal open={open} title="Prayer timetable" onClose={onClose}>
      <TimetableBody months={months} onSummary={onSummary} />
    </Modal>
  );
}

function TimetableBody({ months, onSummary }: { months: TimetableSummary["months"]; onSummary: (summary: TimetableSummary) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [dragging, setDragging] = useState(false);

  async function upload(files: File[]) {
    const json = files.filter((f) => f.name.toLowerCase().endsWith(".json") || f.type === "application/json");
    const skipped = files.filter((f) => !json.includes(f)).map((f) => ({ name: f.name, ok: false, message: "not a .json file" }));
    if (!json.length) {
      setResults(skipped);
      return;
    }
    setUploading(true);
    const done: FileResult[] = [];
    // one at a time, so each file's result (and any error) is about that file
    for (const file of json) {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error("not valid JSON");
        }
        const next = await prayerTimetable.upload(parsed);
        onSummary(next);
        done.push({ name: file.name, ok: true, message: `${next.added} day${next.added === 1 ? "" : "s"} added` });
      } catch (e) {
        done.push({ name: file.name, ok: false, message: (e as Error).message });
      }
      setResults([...done, ...skipped]);
    }
    setUploading(false);
    if (input.current) input.current.value = "";
  }

  async function remove(month: string) {
    setRemoving(month);
    try {
      onSummary(await prayerTimetable.removeMonth(month));
    } catch (e) {
      setResults([{ name: monthLabel(month), ok: false, message: (e as Error).message }]);
    } finally {
      setRemoving(null);
    }
  }

  function downloadExample() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(EXAMPLE_TIMETABLE, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "prayer-timetable-example.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <section>
        <h3 className="mb-1 text-xs text-neutral-600">Uploaded months</h3>
        {months.length === 0 ? (
          <p className="border border-dashed border-neutral-400 px-2 py-1.5 text-xs text-neutral-500">None yet.</p>
        ) : (
          <ul className="border border-neutral-400">
            {months.map(({ month, days }) => (
              <li key={month} className="flex items-center gap-2 border-b border-dashed border-neutral-300 px-2 py-1 last:border-b-0">
                <span className="flex-1">{monthLabel(month)}</span>
                <span className="text-xs text-neutral-500">{days} days</span>
                <button
                  className="p-0.5 text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
                  aria-label={`Remove ${monthLabel(month)}`}
                  title="Remove"
                  disabled={removing !== null || uploading}
                  onClick={() => remove(month)}
                >
                  <Trash size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) void upload([...e.dataTransfer.files]);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 border border-dashed px-3 py-4 text-center text-xs ${
          dragging ? "border-neutral-900 bg-neutral-100" : "border-neutral-500 hover:bg-neutral-50"
        }`}
      >
        <FileArrowUp size={20} aria-hidden />
        <span>{uploading ? "uploading…" : "Choose or drop JSON files"}</span>
        <span className="text-neutral-500">Re-uploading a month replaces it.</span>
        <input
          ref={input}
          data-autofocus
          type="file"
          accept=".json,application/json"
          multiple
          disabled={uploading}
          className="sr-only"
          onChange={(e) => void upload([...(e.target.files ?? [])])}
        />
      </label>

      {results.length > 0 && (
        <ul role="status" className="space-y-0.5 text-xs">
          {results.map((r, i) => (
            <li key={`${r.name}-${i}`} className={r.ok ? "" : "border border-neutral-400 px-2 py-1"}>
              {r.ok ? "+" : "!"} <b>{r.name}</b>: {r.message}
            </li>
          ))}
        </ul>
      )}

      <details className="group border border-neutral-300">
        <summary className="cursor-pointer list-none bg-neutral-50 px-2 py-1 text-xs text-neutral-600 [&::-webkit-details-marker]:hidden">File format</summary>
        <div className="space-y-2 border-t border-neutral-300 px-2 py-2 text-xs text-neutral-600">
          <p>
            A <code>days</code> list with one entry per date. Times are 24-hour <code>HH:MM</code> beginning times; <code>jamaat</code> is optional.
          </p>
          <pre className="overflow-x-auto bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-800">{JSON.stringify(EXAMPLE_TIMETABLE, null, 2)}</pre>
          <button className="flex items-center gap-1 underline" onClick={downloadExample}>
            <DownloadSimple size={12} aria-hidden />
            download this example
          </button>
        </div>
      </details>
    </div>
  );
}
