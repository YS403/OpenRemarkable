import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import { orderPages } from "@/lib/rm/page-order";
import { addTemplatePages, embedFonts } from "@/lib/templates";

vi.mock("@/lib/remarkable/client", () => ({ withRemarkable: vi.fn() }));
vi.mock("./store", () => ({ calendarStore: {} }));
vi.mock("./service", () => ({ eventsForDay: vi.fn(), CalendarLinkError: class extends Error {} }));

const { updateDocument } = await import("./sync");
const { initialPageEntries, readManifest, writeManifest } = await import("./sync-plan");

const DOC = "doc-1";
const TZ = "Europe/London";
const ev = (id: string, start: string, end: string) => ({ id, connectionId: "c", title: id, start, end, allDay: false });

/** An in-memory stand-in for the reMarkable cloud's raw API. */
function fakeCloud() {
  const blobs = new Map<string, Uint8Array>();
  const log: string[] = [];
  const pending = (id: string, bytes: Uint8Array) => {
    const hash = createHash("sha256").update(bytes).digest("hex");
    blobs.set(hash, bytes);
    return { id, hash, type: 0, subfiles: 0, size: bytes.length, [Symbol.asyncDispose]: async () => void log.push(`uploaded ${id}`) };
  };
  const text = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const raw = {
    getEntries: async ({ id }: { id: string }) => ({ entries: (raw as unknown as { lists: Record<string, unknown[]> }).lists[id] }),
    getHash: async ({ hash }: { hash: string }) => blobs.get(hash)!,
    getContent: async ({ hash }: { hash: string }) => JSON.parse(new TextDecoder().decode(blobs.get(hash))),
    getMetadata: async ({ hash }: { hash: string }) => JSON.parse(new TextDecoder().decode(blobs.get(hash))),
    putFile: async (id: string, bytes: Uint8Array) => pending(id, bytes),
    putContent: async (id: string, content: unknown) => pending(id, text(content)),
    putMetadata: async (id: string, meta: unknown) => pending(id, text(meta)),
    putEntries: async (id: string, entries: unknown[]) => {
      (raw as unknown as { lists: Record<string, unknown[]> }).lists[id] = entries;
      return pending(id, text(entries));
    },
    putRootHash: async (hash: string, generation: number) => {
      log.push(`commit ${generation}`);
      return [hash, generation + 1];
    },
    lists: {} as Record<string, unknown[]>,
  };
  return { raw, blobs, log, pending, text };
}

async function seed(cloud: ReturnType<typeof fakeCloud>) {
  // a calendar document already holding the 12th and 13th, with handwriting on the 12th
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  addTemplatePages("planner", pdf, fonts, { day: "2026-10-12", events: [], timeZone: TZ });
  addTemplatePages("planner", pdf, fonts, { day: "2026-10-13", events: [], timeZone: TZ });
  writeManifest(pdf, {
    v: 1,
    days: {
      "2026-10-12": { fingerprint: "fp-12", versions: [{ pdfStart: 0, pdfCount: 1 }] },
      "2026-10-13": { fingerprint: "fp-13", versions: [{ pdfStart: 1, pdfCount: 1 }] },
    },
  });
  const pages = initialPageEntries(2, undefined, (() => { let n = 0; return () => `page-${n++}`; })());
  const files = [
    cloud.pending(`${DOC}.pdf`, await pdf.save()),
    cloud.pending(`${DOC}.content`, cloud.text({ fileType: "pdf", formatVersion: 2, cPages: { pages } })),
    cloud.pending(`${DOC}.metadata`, cloud.text({ visibleName: "Calendar", parent: "", type: "DocumentType" })),
    cloud.pending(`${DOC}/page-0.rm`, new Uint8Array([1, 2, 3])), // the user's handwriting
  ];
  cloud.raw.lists[DOC] = files;
  const docEntry = cloud.pending(DOC, cloud.text(files));
  cloud.raw.lists.root = [docEntry, { id: "other-doc", hash: "x" }];
  return docEntry;
}

describe("updateDocument (against a fake cloud)", () => {
  it("appends new and changed days, keeps everything else, and commits after uploads finish", async () => {
    const cloud = fakeCloud();
    const docEntry = await seed(cloud);
    const plans = [
      { day: "2026-10-12", events: [ev("New meeting", "2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z")], fingerprint: "fp-12-changed" },
      { day: "2026-10-13", events: [], fingerprint: "fp-13" },
      { day: "2026-10-14", events: [], fingerprint: "fp-14" },
    ];
    const result = await updateDocument({ raw: cloud.raw } as never, {
      docEntry: docEntry as never,
      root: cloud.raw.lists.root as never,
      generation: 7,
      schemaVersion: 4 as never,
      plans,
      render: (pdf, fonts, plan) => addTemplatePages("planner", pdf, fonts, { day: plan.day, events: plan.events, timeZone: TZ }),
    });

    expect(result).toMatchObject({ added: ["2026-10-14"], updated: ["2026-10-12"], unchanged: ["2026-10-13"] });

    // committed once, only after every upload finished
    expect(cloud.log.at(-1)).toBe("commit 7");
    expect(cloud.log.filter((l) => l.startsWith("uploaded")).length).toBeGreaterThanOrEqual(5);

    const files = cloud.raw.lists[DOC] as { id: string; hash: string }[];
    expect(files.find((f) => f.id === `${DOC}/page-0.rm`)?.hash).toBe(createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex"));
    expect((cloud.raw.lists.root as { id: string }[]).map((e) => e.id)).toEqual([DOC, "other-doc"]);

    const pdf = await PDFDocument.load(cloud.blobs.get(files.find((f) => f.id === `${DOC}.pdf`)!.hash)!);
    expect(pdf.getPageCount()).toBe(4); // 2 old + updated 12th + new 14th
    expect(readManifest(pdf)?.days["2026-10-12"].versions).toHaveLength(2);

    const content = JSON.parse(new TextDecoder().decode(cloud.blobs.get(files.find((f) => f.id === `${DOC}.content`)!.hash)));
    const order = orderPages(content).map((p) => p.source);
    expect(order).toEqual([0, 2, 1, 3]); // 12th, updated 12th, 13th, 14th
    expect(content.pageCount).toBe(4);
  });

  it("writes nothing when no day changed", async () => {
    const cloud = fakeCloud();
    const docEntry = await seed(cloud);
    const result = await updateDocument({ raw: cloud.raw } as never, {
      docEntry: docEntry as never,
      root: cloud.raw.lists.root as never,
      generation: 7,
      schemaVersion: 4 as never,
      plans: [{ day: "2026-10-13", events: [], fingerprint: "fp-13" }],
      render: () => 0,
    });
    expect(result.unchanged).toEqual(["2026-10-13"]);
    expect(cloud.log.some((l) => l.startsWith("commit"))).toBe(false);
  });
});
