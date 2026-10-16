/**
 * Light accumulation for the Vessel Select software renderer. A light buffer holds an RGB multiplier per pixel
 * (Float32 r, g, b interleaved); the renderer multiplies the albedo by it, posterised into dithered bands so pools
 * of light read as pixel art instead of smooth gradients. Framework-free.
 */

export type LightBuf = Float32Array;

export const newLight = (w: number, h: number): LightBuf => new Float32Array(w * h * 3);

/** Elliptical point light (2:1 for a pool on the floor, 1:1 for a halo in the air). Quadratic falloff. */
export function pointLight(L: LightBuf, w: number, h: number, cx: number, cy: number, rx: number, ry: number, col: number, intensity: number): void {
  if (intensity <= 0 || rx <= 0 || ry <= 0) return;
  const r = ((col >> 16) & 255) / 255 * intensity, g = ((col >> 8) & 255) / 255 * intensity, b = (col & 255) / 255 * intensity;
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
  const irx = 1 / rx, iry = 1 / ry;
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) * iry, dy2 = dy * dy;
    if (dy2 >= 1) continue;
    let i = (y * w + x0) * 3;
    for (let x = x0; x <= x1; x++, i += 3) {
      const dx = (x + 0.5 - cx) * irx;
      const d2 = dx * dx + dy2;
      if (d2 >= 1) continue;
      const f = (1 - d2) * (1 - d2);
      L[i] += r * f; L[i + 1] += g * f; L[i + 2] += b * f;
    }
  }
}

/**
 * A vertical cone of light from above (a spotlight or a light shaft): `top` / `bottom` rows, half widths at each,
 * strongest on the axis and toward the bottom.
 */
export function coneLight(L: LightBuf, w: number, h: number, cx: number, top: number, bottom: number, halfTop: number, halfBottom: number, col: number, intensity: number): void {
  if (intensity <= 0 || bottom <= top) return;
  const r = ((col >> 16) & 255) / 255 * intensity, g = ((col >> 8) & 255) / 255 * intensity, b = (col & 255) / 255 * intensity;
  const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(h - 1, Math.ceil(bottom));
  for (let y = y0; y <= y1; y++) {
    const t = (y + 0.5 - top) / (bottom - top);
    const half = halfTop + (halfBottom - halfTop) * t;
    const vert = 0.35 + 0.65 * t;
    const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(w - 1, Math.ceil(cx + half));
    let i = (y * w + x0) * 3;
    for (let x = x0; x <= x1; x++, i += 3) {
      const u = Math.abs(x + 0.5 - cx) / half;
      if (u >= 1) continue;
      const f = (1 - u * u) * vert;
      L[i] += r * f; L[i + 1] += g * f; L[i + 2] += b * f;
    }
  }
}

/** 4x4 ordered-dither thresholds in [0, 1). */
export const BAYER4 = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));
