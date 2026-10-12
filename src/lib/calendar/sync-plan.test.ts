import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { orderPages } from "@/lib/rm/page-order";

import { type CalendarManifest, type CPage, decide, initialPageEntries, planPageEntries, readManifest, writeManifest } from "./sync-plan";

let counter = 0;
const newId = () => `new-${++counter}`;

/** A document with days 10th, 11th, 13th (one PDF page each), as the tablet would hold it. */
function existing(): { pages: CPage[]; manifest: CalendarManifest } {
  const pages = initialPageEntries(3, undefined, (() => { let n = 0; return () => `old-${n++}`; })());
  const manifest: CalendarManifest = {
    v: 1,
    days: {
      "2026-10-10": { fingerprint: "a", versions: [{ pdfStart: 0, pdfCount: 1 }] },
      "2026-10-11": { fingerprint: "b", versions: [{ pdfStart: 1, pdfCount: 1 }] },
      "2026-10-13": { fingerprint: "c", versions: [{ pdfStart: 2, pdfCount: 1 }] },
    },
  };
  return { pages, manifest };
}

const displayed = (pages: CPage[]) => orderPages({ cPages: { pages: pages as never } }).map((p) => p.id);

describe("decide", () => {
  it("adds new days, updates changed ones, keeps the rest", () => {
    const { manifest } = existing();
    expect(decide(manifest, "2026-10-12", "x")).toBe("add");
    expect(decide(manifest, "2026-10-11", "changed")).toBe("update");
    expect(decide(manifest, "2026-10-11", "b")).toBe("keep");
  });
});

describe("planPageEntries", () => {
  it("slots a new day between its neighbours without touching existing pages", () => {
    const { pages, manifest } = existing();
    const before = JSON.stringify(pages);
    manifest.days["2026-10-12"] = { fingerprint: "d", versions: [{ pdfStart: 3, pdfCount: 2 }] };
    const created = planPageEntries(pages, manifest, [{ day: "2026-10-12", action: "add", pdfPages: [3, 4] }], newId);
    expect(JSON.stringify(pages)).toBe(before);
    expect(displayed([...pages, ...created])).toEqual(["old-0", "old-1", created[0].id, created[1].id, "old-2"]);
    expect(created.map((c) => c.redir?.value)).toEqual([3, 4]);
  });

  it("puts an updated version right after the day's existing page", () => {
    const { pages, manifest } = existing();
    manifest.days["2026-10-10"].versions.push({ pdfStart: 3, pdfCount: 1 });
    const created = planPageEntries(pages, manifest, [{ day: "2026-10-10", action: "update", pdfPages: [3] }], newId);
    expect(displayed([...pages, ...created])).toEqual(["old-0", created[0].id, "old-1", "old-2"]);
  });

  it("keeps pages the user added on the tablet where they are", () => {
    const { pages, manifest } = existing();
    // a blank page the user inserted after the 11th (no redir: not from our PDF)
    pages.push({ id: "user-page", idx: { timestamp: "1:2", value: "uz" } });
    manifest.days["2026-10-14"] = { fingerprint: "e", versions: [{ pdfStart: 3, pdfCount: 1 }] };
    const created = planPageEntries(pages, manifest, [{ day: "2026-10-14", action: "add", pdfPages: [3] }], newId);
    const order = displayed([...pages, ...created]);
    expect(order.indexOf("user-page")).toBeLessThan(order.indexOf(created[0].id));
    expect(order.at(-1)).toBe(created[0].id);
  });

  it("handles earlier days and duplicate keys from merges", () => {
    const { pages, manifest } = existing();
    pages.push({ ...pages[0], id: "merge-dup" }); // same key and page as old-0
    manifest.days["2026-10-09"] = { fingerprint: "f", versions: [{ pdfStart: 3, pdfCount: 1 }] };
    const created = planPageEntries(pages, manifest, [{ day: "2026-10-09", action: "add", pdfPages: [3] }], newId);
    expect(displayed([...pages, ...created])[0]).toBe(created[0].id);
  });
});

describe("manifest", () => {
  it("round-trips inside the PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const manifest: CalendarManifest = { v: 1, days: { "2026-10-12": { fingerprint: "z", versions: [{ pdfStart: 0, pdfCount: 1 }] } } };
    writeManifest(pdf, manifest);
    expect(readManifest(await PDFDocument.load(await pdf.save()))).toEqual(manifest);
  });
});
