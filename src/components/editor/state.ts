import type { Element, Project } from "@/lib/editor/model";

/** Creation tools. Shapes stay in the model (existing ones still render and export) but can't be drawn for now. */
export type Tool = "select" | "text";

export interface ElementRef {
  pageId: string;
  elementId: string;
}

type Pages = Project["pages"];

export interface EditorState {
  pages: Pages;
  past: Pages[];
  future: Pages[];
  selection: ElementRef | null;
  /** text element currently open in the inline editor */
  editing: ElementRef | null;
  tool: Tool;
  /** bumps on every committed change; drives autosave */
  revision: number;
}

export type EditorAction =
  | { type: "load"; pages: Pages }
  | { type: "tool"; tool: Tool }
  | { type: "select"; selection: ElementRef | null }
  | { type: "add"; pageId: string; element: Element; edit?: boolean }
  | { type: "update"; ref: ElementRef; patch: Partial<Element> }
  | { type: "remove" }
  | { type: "duplicate" }
  | { type: "reorder"; to: "forward" | "backward" | "front" | "back" }
  | { type: "edit"; ref: ElementRef | null }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 100;

export const initialEditorState: EditorState = {
  pages: {},
  past: [],
  future: [],
  selection: null,
  editing: null,
  tool: "select",
  revision: 0,
};

export function findElement(pages: Pages, ref: ElementRef | null): Element | undefined {
  return ref ? pages[ref.pageId]?.find((el) => el.id === ref.elementId) : undefined;
}

function commit(state: EditorState, pages: Pages, extra: Partial<EditorState> = {}): EditorState {
  return {
    ...state,
    ...extra,
    pages,
    past: [...state.past, state.pages].slice(-HISTORY_LIMIT),
    future: [],
    revision: state.revision + 1,
  };
}

function mapPage(pages: Pages, pageId: string, fn: (elements: Element[]) => Element[]): Pages {
  return { ...pages, [pageId]: fn(pages[pageId] ?? []) };
}

/** Drop references to elements that no longer exist (after undo/redo). */
function validRef(pages: Pages, ref: ElementRef | null): ElementRef | null {
  return findElement(pages, ref) ? ref : null;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return { ...initialEditorState, pages: action.pages, tool: state.tool };

    case "tool":
      return { ...state, tool: action.tool, selection: action.tool === "select" ? state.selection : null, editing: null };

    case "select":
      return { ...state, selection: action.selection, editing: null };

    case "add": {
      const ref = { pageId: action.pageId, elementId: action.element.id };
      return commit(state, mapPage(state.pages, action.pageId, (els) => [...els, action.element]), {
        selection: ref,
        editing: action.edit ? ref : null,
        tool: "select",
      });
    }

    case "update": {
      const { ref, patch } = action;
      if (!findElement(state.pages, ref)) return state;
      return commit(
        state,
        mapPage(state.pages, ref.pageId, (els) =>
          els.map((el) => (el.id === ref.elementId ? ({ ...el, ...patch, id: el.id, type: el.type } as Element) : el)),
        ),
      );
    }

    case "remove": {
      const ref = state.selection;
      if (!ref || !findElement(state.pages, ref)) return state;
      return commit(state, mapPage(state.pages, ref.pageId, (els) => els.filter((el) => el.id !== ref.elementId)), {
        selection: null,
        editing: null,
      });
    }

    case "duplicate": {
      const ref = state.selection;
      const el = findElement(state.pages, ref);
      if (!ref || !el) return state;
      const copy = { ...el, id: crypto.randomUUID(), x: el.x + 12, y: el.y + 12 } as Element;
      return commit(state, mapPage(state.pages, ref.pageId, (els) => [...els, copy]), {
        selection: { pageId: ref.pageId, elementId: copy.id },
      });
    }

    case "reorder": {
      const ref = state.selection;
      if (!ref || !findElement(state.pages, ref)) return state;
      return commit(
        state,
        mapPage(state.pages, ref.pageId, (els) => {
          const i = els.findIndex((el) => el.id === ref.elementId);
          const next = [...els];
          const [el] = next.splice(i, 1);
          const target = {
            front: next.length,
            back: 0,
            forward: Math.min(next.length, i + 1),
            backward: Math.max(0, i - 1),
          }[action.to];
          next.splice(target, 0, el);
          return next;
        }),
      );
    }

    case "edit":
      return { ...state, editing: action.ref, selection: action.ref ?? state.selection };

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        pages: previous,
        past: state.past.slice(0, -1),
        future: [state.pages, ...state.future],
        selection: validRef(previous, state.selection),
        editing: null,
        revision: state.revision + 1,
      };
    }

    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        pages: next,
        past: [...state.past, state.pages],
        future: state.future.slice(1),
        selection: validRef(next, state.selection),
        editing: null,
        revision: state.revision + 1,
      };
    }
  }
}
