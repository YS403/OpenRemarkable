import type { TextElement } from "@/lib/editor/model";
import { INTER_FACES, type Measure } from "@/lib/editor/text";

/** Family name the editor registers for the bundled Inter files. */
export const EDITOR_FONT = "RM Inter";

let ready: Promise<void> | null = null;

/** Load the same font files the PDF exporter embeds, so measurements agree. */
export function loadEditorFonts(): Promise<void> {
  ready ??= Promise.all(
    INTER_FACES.map(async (face) => {
      const font = new FontFace(EDITOR_FONT, `url(/${face.file})`, {
        weight: face.bold ? "700" : "400",
        style: face.italic ? "italic" : "normal",
      });
      document.fonts.add(await font.load());
    }),
  ).then(() => undefined);
  return ready;
}

export function cssFont(el: Pick<TextElement, "bold" | "italic" | "fontSize">): string {
  return `${el.italic ? "italic " : ""}${el.bold ? 700 : 400} ${el.fontSize}px "${EDITOR_FONT}"`;
}

let context: CanvasRenderingContext2D | null = null;

/**
 * Text width in the element's units, without kerning — the PDF shows glyphs
 * at their plain advance widths, so the editor must measure the same way.
 */
export function measurer(el: Pick<TextElement, "bold" | "italic" | "fontSize">): Measure {
  context ??= document.createElement("canvas").getContext("2d")!;
  const ctx = context;
  return (text) => {
    ctx.font = cssFont(el);
    ctx.fontKerning = "none";
    return ctx.measureText(text).width;
  };
}
