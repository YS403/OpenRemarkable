import type { StrokePoint } from "./types";

/**
 * Pencil grain, following the app's pencil fill (FUN_140bad080): a pixel is
 * inked when a grain value is at most a pressure-driven threshold
 * (35 + 165·pressure, out of 255), softened toward the stroke edge on wide
 * strokes. The grain mixes value-noise octaves at 1, 3 and 7 cycles per pixel,
 * anchored to the page, so overlapping strokes share one paper texture.
 *
 * The noise uses its own seeded permutation, not the app's table, so the grain
 * looks the same in character but is not pixel-identical. The app also mixes
 * in a small (1/8) term that moves with the stroke; it is left out here.
 */

/** A 1-bit coverage mask covering a page region. */
export interface PencilMask {
  width: number;
  height: number;
  /** one byte per pixel, 1 = inked */
  pixels: Uint8Array;
}

const PERM = buildPermutation(0x5eed);

function buildPermutation(seed: number): Uint8Array {
  // mulberry32
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const doubled = new Uint8Array(512);
  doubled.set(p);
  doubled.set(p, 256);
  return doubled;
}

/** Bilinear value noise in 0–255 with 8-bit fixed-point weights, as in the app. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = ((x - xi) * 255) | 0;
  const fy = ((y - yi) * 255) | 0;
  const x0 = xi & 255;
  const x1 = (xi + 1) & 255;
  const r0 = PERM[yi & 255];
  const r1 = PERM[(yi + 1) & 255];
  const a = PERM[r0 + x0];
  const b = PERM[r0 + x1];
  const c = PERM[r1 + x0];
  const d = PERM[r1 + x1];
  return ((b * fx + a * (255 - fx)) * (255 - fy) + (d * fx + c * (255 - fx)) * fy) >> 16;
}

/** Grain value 0–255 at a page pixel: 2:3:1 mix of octaves at 1, 3 and 7 cycles per pixel. */
function grain(x: number, y: number): number {
  return (valueNoise(x, y) * 2 + valueNoise(x * 3, y * 3) * 3 + valueNoise(x * 7, y * 7)) / 6;
}

const smoothstep = (t: number) => (3 - 2 * t) * t * t;

/**
 * Rasterise pencil strokes into a mask of the given size. `offset` maps scene
 * coordinates to mask pixels (the page frame offset).
 */
export function rasterizePencil(
  strokes: readonly (readonly StrokePoint[])[],
  width: number,
  height: number,
  offset: { x: number; y: number },
): PencilMask {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const pixels = new Uint8Array(w * h);

  for (const points of strokes) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[Math.min(i + 1, points.length - 1)];
      const ax = a.x + offset.x;
      const ay = a.y + offset.y;
      const bx = b.x + offset.x;
      const by = b.y + offset.y;
      const reach = Math.max(a.width, b.width) / 2 + 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + reach));
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const index = py * w + px;
          if (pixels[index]) continue;
          // sample at the pixel centre
          const cx = px + 0.5;
          const cy = py + 0.5;
          const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / len2));
          const half = (a.width + t * (b.width - a.width)) / 2;
          const dist = Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy));
          if (dist > half) continue;

          let threshold = 35 + 165 * (a.pressure + t * (b.pressure - a.pressure));
          // wide strokes fade over the outer half of their radius
          if (half > 2) {
            const d = dist / half;
            if (d >= 0.5) threshold *= 1 - smoothstep(Math.min(1, (d - 0.5) * 2));
          }
          // sample the grain in scene coordinates so it stays put across masks
          if (grain(cx - offset.x, cy - offset.y) <= threshold) pixels[index] = 1;
        }
      }
    }
  }
  return { width: w, height: h, pixels };
}

/** Pack a mask into PDF image-mask rows (1 bit per pixel, MSB first, 0 = paint). */
export function packImageMask(mask: PencilMask): Uint8Array {
  const rowBytes = Math.ceil(mask.width / 8);
  const out = new Uint8Array(rowBytes * mask.height).fill(0xff);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.pixels[y * mask.width + x]) out[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return out;
}
