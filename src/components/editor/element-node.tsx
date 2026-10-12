"use client";

import type Konva from "konva";
import { Ellipse, Group, Line, Rect, Shape } from "react-konva";

import type { Element, LineElement, TextElement } from "@/lib/editor/model";
import { lineHeads, lineShaft } from "@/lib/editor/shapes";
import { alignOffset, baselineY, textHeight, wrapText } from "@/lib/editor/text";

import { cssFont, measurer } from "./fonts";

export interface ElementNodeProps {
  element: Element;
  draggable: boolean;
  hidden: boolean;
  onSelect: () => void;
  onEditText: () => void;
  onChange: (patch: Partial<Element>) => void;
}

/** Lines of a text element: the stored layout, or a fresh wrap if none yet. */
export function textLines(el: TextElement): string[] {
  return el.lines ?? wrapText(el.text, el.width, measurer(el));
}

/** One element on the canvas. Its Konva node id is the element id, for the transformer. */
export function ElementNode({ element: el, draggable, hidden, onSelect, onEditText, onChange }: ElementNodeProps) {
  const common = {
    id: el.id,
    name: "element",
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    draggable,
    visible: !hidden,
    onMouseDown: onSelect,
    onTouchStart: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onChange({ x: e.target.x(), y: e.target.y() }),
  };

  switch (el.type) {
    case "rect":
      return (
        <Rect
          {...common}
          width={el.width}
          height={el.height}
          cornerRadius={el.cornerRadius}
          fill={el.fill ?? undefined}
          stroke={el.stroke ?? undefined}
          strokeWidth={el.stroke ? el.strokeWidth : 0}
          lineJoin="round"
          onTransformEnd={(e) => onChange(boxTransform(e.target, el.width, el.height))}
        />
      );

    case "ellipse":
      return (
        <Ellipse
          {...common}
          // the model's box starts at (x, y); Konva ellipses are centred, so offset them
          offsetX={-el.width / 2}
          offsetY={-el.height / 2}
          radiusX={el.width / 2}
          radiusY={el.height / 2}
          fill={el.fill ?? undefined}
          stroke={el.stroke ?? undefined}
          strokeWidth={el.stroke ? el.strokeWidth : 0}
          onTransformEnd={(e) => onChange(boxTransform(e.target, el.width, el.height))}
        />
      );

    case "line":
      return <LineNode {...common} el={el} />;

    case "text":
      return (
        <Shape
          {...common}
          width={el.width}
          height={textHeight(el, textLines(el).length)}
          onDblClick={onEditText}
          onDblTap={onEditText}
          sceneFunc={(context) => {
            // draw with the native context so kerning can be turned off, as in the PDF
            const ctx = context._context;
            ctx.font = cssFont(el);
            ctx.fontKerning = "none";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = el.color;
            const measure = measurer(el);
            textLines(el).forEach((line, i) => {
              if (line) ctx.fillText(line, alignOffset(el.align, el.width, measure(line)), baselineY(el, i));
            });
          }}
          hitFunc={(context, shape) => {
            context.beginPath();
            context.rect(0, 0, shape.width(), shape.height());
            context.closePath();
            context.fillShape(shape);
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const width = Math.max(20, el.width * node.scaleX());
            node.scaleX(1);
            node.scaleY(1);
            onChange({
              x: node.x(),
              y: node.y(),
              rotation: node.rotation(),
              width,
              lines: wrapText(el.text, width, measurer(el)),
            });
          }}
        />
      );
  }
}

type CommonProps = Omit<ElementNodeProps, "element" | "onEditText" | "onChange" | "hidden" | "onSelect"> & {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  onMouseDown: () => void;
  onTouchStart: () => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

function LineNode({ el, ...common }: CommonProps & { el: LineElement }) {
  const [a, b] = lineShaft(el);
  return (
    <Group {...common}>
      <Line
        points={[a.x, a.y, b.x, b.y]}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        lineCap="round"
        // easier to grab thin lines
        hitStrokeWidth={Math.max(12, el.strokeWidth)}
      />
      {lineHeads(el).map((head, i) => (
        <Line key={i} points={head.flatMap((p) => [p.x, p.y])} closed fill={el.stroke} strokeEnabled={false} />
      ))}
    </Group>
  );
}

/** Fold a transformer's scale into width/height so stroke widths stay true. */
function boxTransform(node: Konva.Node, width: number, height: number): Partial<Element> {
  const patch = {
    x: node.x(),
    y: node.y(),
    rotation: node.rotation(),
    width: Math.max(1, width * node.scaleX()),
    height: Math.max(1, height * node.scaleY()),
  };
  node.scaleX(1);
  node.scaleY(1);
  return patch;
}
