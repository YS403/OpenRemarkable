import { describe, expect, it } from "vitest";

import { EXPORT_WIDTH_SCALE } from "./constants";
import { ColorCode } from "./palette";
import { ballpointInk, resolveStrokeStyle, Tool } from "./pens";
import type { StrokePoint } from "./types";

const points = (width: number, pressure = 0.5, speed = 0): StrokePoint[] => [
  { x: 0, y: 0, width, pressure, speed },
  { x: 10, y: 0, width: width + 4, pressure, speed },
];

describe("pen styles", () => {
  it("draws fineliners as round polylines at the first point's width", () => {
    const { style } = resolveStrokeStyle(Tool.FinelinerV2, ColorCode.Black, undefined, points(2));
    expect(style.geometry).toEqual({ kind: "polyline", width: 2, cap: "round", join: "round" });
    expect(style.blend).toBe("Normal");
  });

  it("draws highlighters with darken blending and their ARGB color", () => {
    const { style } = resolveStrokeStyle(Tool.HighlighterV2, ColorCode.Argb, 0xffffc38c, points(30));
    expect(style.geometry).toEqual({ kind: "polyline", width: 30, cap: "butt", join: "bevel" });
    expect(style.blend).toBe("Darken");
    expect(style.color).toEqual({ r: 255, g: 195, b: 140, a: 1 });
  });

  it("uses square caps for the v1 highlighter and normal blending for gray", () => {
    const { style } = resolveStrokeStyle(Tool.Highlighter, ColorCode.GrayOverlap, undefined, points(30));
    expect(style.geometry).toMatchObject({ cap: "square" });
    expect(style.blend).toBe("Normal");
  });

  it("thins markers and ballpoints to their measured export width", () => {
    expect(resolveStrokeStyle(Tool.MarkerV2, 0, undefined, points(4)).style.geometry).toEqual({
      kind: "ribbon",
      widthScale: EXPORT_WIDTH_SCALE.marker,
      widthPadding: 0,
    });
    expect(resolveStrokeStyle(Tool.BallpointV2, 0, undefined, points(4)).style.geometry).toMatchObject({
      widthScale: EXPORT_WIDTH_SCALE.ballpoint,
    });
  });

  it("routes both pencils to the grain renderer", () => {
    for (const tool of [Tool.PencilV2, Tool.MechanicalPencilV2]) {
      expect(resolveStrokeStyle(tool, 0, undefined, points(4)).style.geometry).toEqual({ kind: "grain" });
    }
  });

  it("paints erasers in the page color", () => {
    expect(resolveStrokeStyle(Tool.Eraser, 0, undefined, points(4)).style.color).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(resolveStrokeStyle(Tool.EraseArea, 0, undefined, points(4)).style.geometry).toEqual({ kind: "area" });
  });

  it("reports unknown colors and falls back to black", () => {
    const { style, knownColor } = resolveStrokeStyle(Tool.BallpointV2, 99, undefined, points(4));
    expect(knownColor).toBe(false);
    expect(style.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe("ballpoint ink", () => {
  it("darkens with pressure and lightens with speed", () => {
    const at = (pressure: number, speed: number) => ballpointInk({ x: 0, y: 0, width: 1, pressure, speed });
    expect(at(0, 0)).toBeCloseTo(127.5);
    expect(at(1, 0)).toBe(255);
    expect(at(1, 30)).toBe(205);
    expect(at(0.35, 0)).toBeGreaterThan(at(0.1, 0));
  });
});
