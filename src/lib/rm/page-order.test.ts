import { describe, expect, it } from "vitest";

import { orderPages } from "./page-order";

describe("page order", () => {
  it("sorts cPages by index string and drops deleted pages", () => {
    const pages = orderPages({
      cPages: {
        pages: [
          { id: "c", idx: { value: "bb" }, template: { value: "Blank" } },
          { id: "a", idx: { value: "ba" } },
          { id: "gone", idx: { value: "aa" }, deleted: { value: 1 } },
          { id: "b", idx: { value: "baz" } },
        ],
      },
    });
    expect(pages).toEqual([{ id: "a", template: undefined }, { id: "b", template: undefined }, { id: "c", template: "Blank" }]);
  });

  it("falls back to the legacy page list", () => {
    expect(orderPages({ pages: ["x", "y"] })).toEqual([{ id: "x" }, { id: "y" }]);
  });

  it("maps pages to their original PDF page and marks inserted ones", () => {
    const pages = orderPages({
      cPages: {
        pages: [
          { id: "p0", idx: { value: "ba" }, redir: { value: 0 } },
          { id: "new", idx: { value: "bb" } },
          { id: "p1", idx: { value: "bc" }, redir: { value: 1 } },
        ],
      },
    });
    expect(pages.map((p) => p.source)).toEqual([0, undefined, 1]);
    expect(orderPages({ pages: ["a", "b"], redirectionPageMap: [1, -1] }).map((p) => p.source)).toEqual([1, undefined]);
  });
});
