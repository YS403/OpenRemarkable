import { describe, expect, it } from "vitest";

import { buildRcc, qtHash, readRcc } from "./rcc";

const text = (s: string) => new TextEncoder().encode(s);

describe("qtHash", () => {
  it("matches Qt's qt_hash", () => {
    // values from Qt's algorithm, computed independently
    expect(qtHash("ui")).toBe(1977);
    expect(qtHash("alarm.qml")).toBe(143689852);
  });
});

describe("buildRcc", () => {
  it("writes a version 3 header", () => {
    const out = buildRcc([{ path: "ui/alarm.qml", data: text("Item {}") }]);
    const view = new DataView(out.buffer);
    expect(String.fromCharCode(...out.subarray(0, 4))).toBe("qres");
    expect(view.getUint32(4)).toBe(3);
  });

  it("round-trips nested files", () => {
    const files = [
      { path: "ui/alarm.qml", data: text("import QtQuick\nItem {}") },
      { path: "ui/parts/Pill.qml", data: text("Rectangle {}") },
      { path: "icon.png", data: new Uint8Array([0, 1, 2, 255]) },
    ];
    const back = readRcc(buildRcc(files));
    const byPath = Object.fromEntries(back.map((f) => [f.path, Array.from(f.data)]));
    expect(Object.keys(byPath).sort()).toEqual(files.map((f) => f.path).sort());
    for (const f of files) expect(byPath[f.path]).toEqual(Array.from(f.data));
  });

  it("orders each directory's children by name hash", () => {
    const names = ["b.qml", "a.qml", "zz.qml", "m.qml"];
    const out = buildRcc(names.map((n) => ({ path: n, data: text(n) })));
    const view = new DataView(out.buffer);
    const tree = view.getUint32(8);
    const namesAt = view.getUint32(16);
    const hashes = [1, 2, 3, 4].map((i) => view.getUint32(namesAt + view.getUint32(tree + i * 22) + 2));
    expect(hashes).toEqual([...hashes].sort((x, y) => x - y));
  });

  it("rejects duplicate paths", () => {
    expect(() => buildRcc([{ path: "a.qml", data: text("") }, { path: "/a.qml", data: text("") }])).toThrow(/Duplicate/);
  });
});
