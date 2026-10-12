import { PDFDocument } from "pdf-lib";
import { GenerationError } from "rmapi-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudItem } from "./types";

const putPdf = vi.fn();
let listing: CloudItem[] = [];

vi.mock("./client", () => ({ withRemarkable: (call: (api: unknown) => unknown) => call({ putPdf }) }));
vi.mock("./files", () => ({ listCloudItems: vi.fn(async () => listing) }));

const { documentNameFor, inspectPdf, uploadPdfDocument, UploadRejectedError } = await import("./upload");

const FOLDER = "11111111-1111-4111-8111-111111111111";
const TRASHED_FOLDER = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

const item = (id: string, kind: CloudItem["kind"], parent = ""): CloudItem => ({
  id,
  hash: "h",
  name: id,
  kind,
  fileType: kind === "folder" ? null : "pdf",
  parent,
  pinned: false,
  lastModified: null,
});

async function pdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

beforeEach(() => {
  putPdf.mockReset();
  putPdf.mockResolvedValue({ id: "new-doc", hash: "x" });
  listing = [item(FOLDER, "folder"), item(TRASHED_FOLDER, "folder", "trash"), item(DOC, "document")];
});

describe("documentNameFor", () => {
  it.each([
    ["Report.pdf", "Report"],
    ["Report.PDF", "Report"],
    ["  spaced name.pdf  ", "spaced name"],
    ["no-extension", "no-extension"],
    ["archive.pdf.pdf", "archive.pdf"],
    ["tab\there\u0007.pdf", "tabhere"],
    ["Ünïcødé 日本.pdf", "Ünïcødé 日本"],
    [".pdf", "Untitled"],
    ["", "Untitled"],
    ["   ", "Untitled"],
  ])("%j → %j", (input, expected) => expect(documentNameFor(input)).toBe(expected));

  it("caps very long names", () => {
    expect(documentNameFor(`${"x".repeat(500)}.pdf`)).toHaveLength(200);
  });
});

describe("inspectPdf", () => {
  it("accepts a valid PDF and counts its pages", async () => {
    await expect(inspectPdf(await pdf(3))).resolves.toEqual({ pages: 3 });
  });

  it("accepts PDFs with junk before the header", async () => {
    const bytes = await pdf(1);
    const prefixed = new Uint8Array([...new TextEncoder().encode("﻿junk\n"), ...bytes]);
    await expect(inspectPdf(prefixed)).resolves.toEqual({ pages: 1 });
  });

  it("rejects non-PDFs as 415", async () => {
    const err = await inspectPdf(new TextEncoder().encode("<html>not a pdf</html>")).catch((e) => e);
    expect(err).toBeInstanceOf(UploadRejectedError);
    expect(err.status).toBe(415);
  });

  it("rejects damaged PDFs as 422", async () => {
    const err = await inspectPdf(new TextEncoder().encode("%PDF-1.7\n garbage with no objects")).catch((e) => e);
    expect(err).toBeInstanceOf(UploadRejectedError);
    expect(err.status).toBe(422);
  });

  it("accepts encrypted PDFs (the tablet can open owner-password files)", async () => {
    const encrypted = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\n4 0 obj<</Filter/Standard/V 1/R 2/O(x)/U(x)/P -4>>endobj\ntrailer<</Root 1 0 R/Encrypt 4 0 R>>\n%%EOF",
    );
    await expect(inspectPdf(encrypted)).resolves.toEqual({ pages: 1 });
  });
});

describe("uploadPdfDocument", () => {
  it("uploads to the root without a parent option", async () => {
    const result = await uploadPdfDocument({ name: "Doc", bytes: await pdf(2), parent: "" });
    expect(putPdf).toHaveBeenCalledWith("Doc", expect.any(Uint8Array), {});
    expect(result).toEqual({ id: "new-doc", name: "Doc", pages: 2 });
  });

  it("uploads into an existing folder", async () => {
    await uploadPdfDocument({ name: "Doc", bytes: await pdf(), parent: FOLDER });
    expect(putPdf).toHaveBeenCalledWith("Doc", expect.any(Uint8Array), { parent: FOLDER });
  });

  it.each([
    ["the trash", "trash", 400],
    ["a folder in the trash", TRASHED_FOLDER, 400],
    ["a missing folder", "44444444-4444-4444-8444-444444444444", 404],
    ["a document instead of a folder", DOC, 404],
  ])("refuses %s", async (_, parent, status) => {
    const err = await uploadPdfDocument({ name: "Doc", bytes: await pdf(), parent }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadRejectedError);
    expect(err.status).toBe(status);
    expect(putPdf).not.toHaveBeenCalled();
  });

  it("checks the PDF before touching the cloud", async () => {
    await expect(uploadPdfDocument({ name: "x", bytes: new TextEncoder().encode("nope"), parent: "" })).rejects.toBeInstanceOf(UploadRejectedError);
    expect(putPdf).not.toHaveBeenCalled();
  });

  it("retries when the account changed meanwhile, then succeeds", async () => {
    putPdf.mockRejectedValueOnce(new GenerationError()).mockRejectedValueOnce(new GenerationError()).mockResolvedValueOnce({ id: "late", hash: "x" });
    const result = await uploadPdfDocument({ name: "Doc", bytes: await pdf(), parent: "" });
    expect(result.id).toBe("late");
    expect(putPdf).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("gives up after repeated conflicts", async () => {
    putPdf.mockRejectedValue(new GenerationError());
    await expect(uploadPdfDocument({ name: "Doc", bytes: await pdf(), parent: "" })).rejects.toBeInstanceOf(GenerationError);
    expect(putPdf).toHaveBeenCalledTimes(4);
  }, 10_000);

  it("does not retry other errors", async () => {
    putPdf.mockRejectedValue(new Error("network down"));
    await expect(uploadPdfDocument({ name: "Doc", bytes: await pdf(), parent: "" })).rejects.toThrow("network down");
    expect(putPdf).toHaveBeenCalledTimes(1);
  });
});
