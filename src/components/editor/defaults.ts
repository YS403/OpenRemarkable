import type { TextElement } from "@/lib/editor/model";

/** Starting style for a new text box; the context bar changes it afterwards. */
export function newTextElement(x: number, y: number): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x,
    y,
    rotation: 0,
    opacity: 1,
    width: 220,
    text: "",
    fontFamily: "Inter",
    fontSize: 16,
    bold: false,
    italic: false,
    color: "#111111",
    align: "left",
    lineHeight: 1.25,
  };
}
