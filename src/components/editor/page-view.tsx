"use client";

import type Konva from "konva";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Layer, Stage, Transformer } from "react-konva";

import type { Element, TextElement } from "@/lib/editor/model";
import { textHeight, wrapText } from "@/lib/editor/text";

import { ElementNode, textLines } from "./element-node";
import { cssFont, EDITOR_FONT, measurer } from "./fonts";
import type { EditorAction, ElementRef, Tool } from "./state";
import { newTextElement } from "./defaults";

/** Largest canvas we let pdf.js allocate (browsers cap around 16k per side / ~268M px). */
const MAX_CANVAS_PIXELS = 24_000_000;
const MAX_CANVAS_SIDE = 16_000;

export interface PageViewProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** notebook page id; null for PDF pages without one (not editable) */
  pageId: string | null;
  size: { width: number; height: number };
  scale: number;
  elements: Element[];
  tool: Tool;
  selection: ElementRef | null;
  editing: ElementRef | null;
  dispatch: (action: EditorAction) => void;
}

export function PageView(props: PageViewProps) {
  const { size, scale, pageNumber } = props;
  const wrapper = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    // render pages within a screen or so of the viewport; drop the rest to save memory
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "1200px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapper}
      className="relative shrink-0 bg-white outline outline-1 outline-neutral-500"
      style={{ width: size.width * scale, height: size.height * scale }}
      aria-label={`Page ${pageNumber}`}
    >
      {near && <PdfCanvas {...props} />}
      {near && props.pageId && <PageOverlay {...props} pageId={props.pageId} />}
    </div>
  );
}

function PdfCanvas({ pdf, pageNumber, size, scale }: PageViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    let pending: ReturnType<typeof pdf.getPage>;
    try {
      pending = pdf.getPage(pageNumber);
    } catch {
      return; // the document was closed (switched or left); its replacement re-renders
    }
    pending.then((page) => {
      if (cancelled || !canvas.current) return;
      const cssWidth = size.width * scale;
      const cssHeight = size.height * scale;
      // sharp on high-DPI screens, but capped for very tall pages
      let ratio = window.devicePixelRatio || 1;
      ratio = Math.min(ratio, Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)), MAX_CANVAS_SIDE / cssHeight);
      const viewport = page.getViewport({ scale: scale * ratio });
      const el = canvas.current;
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = page.render({ canvas: el, viewport });
      task.promise.catch(() => {}); // cancellation rejects; nothing to do
    }, () => {}); // closed while the page was loading
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, size, scale]);

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" />;
}

function PageOverlay({ pageId, size, scale, elements, tool, selection, editing, dispatch }: PageViewProps & { pageId: string }) {
  const transformer = useRef<Konva.Transformer>(null);
  const layer = useRef<Konva.Layer>(null);
  const [, setFontsReady] = useState(false);

  const selectedHere = selection?.pageId === pageId ? elements.find((e) => e.id === selection.elementId) : undefined;
  const editingHere = editing?.pageId === pageId ? elements.find((e) => e.id === editing.elementId) : undefined;

  // redraw once the editor font has loaded (text drawn before that used a fallback)
  useEffect(() => {
    document.fonts.load(`16px "${EDITOR_FONT}"`).then(() => setFontsReady(true));
  }, []);

  // attach the transformer to the selected box element
  useLayoutEffect(() => {
    const tr = transformer.current;
    if (!tr) return;
    const node = selectedHere && selectedHere.type !== "line" && !editingHere ? layer.current?.findOne(`#${selectedHere.id}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedHere, editingHere]);

  const pointer = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => e.target.getStage()!.getRelativePointerPosition()!;

  function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === "select") {
      if (e.target === e.target.getStage()) dispatch({ type: "select", selection: null });
      return;
    }
    // The new text box's editor takes focus right away; stop the browser's own
    // mousedown handling from moving focus back to the page and closing it.
    e.evt.preventDefault();
    const p = pointer(e);
    dispatch({ type: "add", pageId, element: newTextElement(p.x, p.y), edit: true });
  }

  const select = (id: string) => () => {
    if (tool === "select") dispatch({ type: "select", selection: { pageId, elementId: id } });
  };

  return (
    <>
      <Stage
        width={size.width * scale}
        height={size.height * scale}
        scaleX={scale}
        scaleY={scale}
        className="absolute inset-0"
        style={{ cursor: tool === "select" ? "default" : "text" }}
        onMouseDown={onPointerDown}
        onTouchStart={onPointerDown}
      >
        <Layer ref={layer}>
          {elements.map((el) => (
            <ElementNode
              key={el.id}
              element={el}
              draggable={tool === "select"}
              hidden={el.id === editingHere?.id}
              onSelect={select(el.id)}
              onEditText={() => dispatch({ type: "edit", ref: { pageId, elementId: el.id } })}
              onChange={(patch) => dispatch({ type: "update", ref: { pageId, elementId: el.id }, patch })}
            />
          ))}
          <Transformer
            ref={transformer}
            rotateEnabled
            keepRatio={false}
            ignoreStroke
            enabledAnchors={
              selectedHere?.type === "text"
                ? ["middle-left", "middle-right"]
                : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]
            }
            anchorSize={8}
            borderStroke="#111"
            anchorStroke="#111"
            boundBoxFunc={(oldBox, box) => (box.width < 4 || box.height < 4 ? oldBox : box)}
          />
        </Layer>
      </Stage>

      {editingHere?.type === "text" && (
        <TextEditor
          key={editingHere.id}
          el={editingHere}
          scale={scale}
          onDone={(text) => {
            if (text.trim() === "") {
              dispatch({ type: "remove" });
            } else if (text !== editingHere.text || !editingHere.lines) {
              dispatch({
                type: "update",
                ref: { pageId, elementId: editingHere.id },
                patch: { text, lines: wrapText(text, editingHere.width, measurer(editingHere)) },
              });
            }
            dispatch({ type: "edit", ref: null });
          }}
        />
      )}
    </>
  );
}

/** Inline text editing: a textarea laid exactly over the text element. */
function TextEditor({ el, scale, onDone }: { el: TextElement; scale: number; onDone: (text: string) => void }) {
  const [text, setText] = useState(el.text);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  const lines = Math.max(1, text.split("\n").length, textLines({ ...el, text, lines: undefined }).length);

  return (
    <textarea
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
        e.stopPropagation(); // keep editor shortcuts (delete, undo…) out of typing
      }}
      aria-label="Edit text"
      spellCheck
      className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-1 outline-neutral-500"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.width * scale,
        height: textHeight(el, lines) * scale,
        font: cssFont({ ...el, fontSize: el.fontSize * scale }),
        lineHeight: el.lineHeight,
        color: el.color,
        textAlign: el.align,
        opacity: el.opacity,
        transform: `rotate(${el.rotation}deg)`,
        transformOrigin: "0 0",
        fontKerning: "none",
      }}
    />
  );
}
