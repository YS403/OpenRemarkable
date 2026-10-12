import { describe, expect, it } from "vitest";

import type { Element } from "@/lib/editor/model";

import { newTextElement } from "./defaults";
import { editorReducer, type EditorState, findElement, initialEditorState } from "./state";

const text = (id: string): Element => ({ ...newTextElement(0, 0), id });

function withElements(...ids: string[]): EditorState {
  return editorReducer(initialEditorState, { type: "load", pages: { p1: ids.map(text) } });
}

describe("editor state", () => {
  it("adds an element, selects it and switches back to the select tool", () => {
    let s = editorReducer(initialEditorState, { type: "tool", tool: "text" });
    s = editorReducer(s, { type: "add", pageId: "p1", element: text("a") });
    expect(s.pages.p1.map((e) => e.id)).toEqual(["a"]);
    expect(s.selection).toEqual({ pageId: "p1", elementId: "a" });
    expect(s.tool).toBe("select");
    expect(s.revision).toBe(1);
  });

  it("undoes and redoes changes, keeping selection valid", () => {
    let s = withElements();
    s = editorReducer(s, { type: "add", pageId: "p1", element: text("a") });
    s = editorReducer(s, { type: "update", ref: { pageId: "p1", elementId: "a" }, patch: { x: 50 } });
    expect(findElement(s.pages, s.selection)?.x).toBe(50);

    s = editorReducer(s, { type: "undo" });
    expect(findElement(s.pages, s.selection)?.x).toBe(0);
    s = editorReducer(s, { type: "undo" });
    expect(s.pages.p1 ?? []).toEqual([]);
    expect(s.selection).toBeNull(); // the element no longer exists

    s = editorReducer(s, { type: "redo" });
    s = editorReducer(s, { type: "redo" });
    expect(s.pages.p1[0].x).toBe(50);
  });

  it("clears the redo stack after a new change", () => {
    let s = withElements("a");
    s = editorReducer(s, { type: "update", ref: { pageId: "p1", elementId: "a" }, patch: { x: 1 } });
    s = editorReducer(s, { type: "undo" });
    s = editorReducer(s, { type: "update", ref: { pageId: "p1", elementId: "a" }, patch: { x: 2 } });
    expect(s.future).toEqual([]);
  });

  it("never changes an element's id or type through a patch", () => {
    let s = withElements("a");
    s = editorReducer(s, { type: "update", ref: { pageId: "p1", elementId: "a" }, patch: { id: "b", type: "rect" } as Partial<Element> });
    expect(s.pages.p1[0]).toMatchObject({ id: "a", type: "text" });
  });

  it("reorders the selected element", () => {
    let s = withElements("a", "b", "c");
    s = editorReducer(s, { type: "select", selection: { pageId: "p1", elementId: "a" } });
    s = editorReducer(s, { type: "reorder", to: "front" });
    expect(s.pages.p1.map((e) => e.id)).toEqual(["b", "c", "a"]);
    s = editorReducer(s, { type: "reorder", to: "backward" });
    expect(s.pages.p1.map((e) => e.id)).toEqual(["b", "a", "c"]);
    s = editorReducer(s, { type: "reorder", to: "back" });
    expect(s.pages.p1.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("duplicates with a new id and an offset", () => {
    let s = withElements("a");
    s = editorReducer(s, { type: "select", selection: { pageId: "p1", elementId: "a" } });
    s = editorReducer(s, { type: "duplicate" });
    expect(s.pages.p1).toHaveLength(2);
    expect(s.pages.p1[1].id).not.toBe("a");
    expect(s.pages.p1[1].x).toBe(12);
    expect(s.selection?.elementId).toBe(s.pages.p1[1].id);
  });

  it("removes the selected element", () => {
    let s = withElements("a", "b");
    s = editorReducer(s, { type: "select", selection: { pageId: "p1", elementId: "b" } });
    s = editorReducer(s, { type: "remove" });
    expect(s.pages.p1.map((e) => e.id)).toEqual(["a"]);
    expect(s.selection).toBeNull();
  });

  it("caps undo history", () => {
    let s = withElements("a");
    for (let i = 0; i < 150; i++) s = editorReducer(s, { type: "update", ref: { pageId: "p1", elementId: "a" }, patch: { x: i } });
    expect(s.past).toHaveLength(100);
  });
});
