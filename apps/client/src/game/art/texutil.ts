/**
 * Phaser texture/animation upload helpers shared by generate.ts and dungeon.ts.
 * Client-only: touches `document` inside functions, never at import time.
 */
import type Phaser from 'phaser';

/** Phaser.Textures.FilterMode.NEAREST (avoids a runtime import of Phaser here). */
const NEAREST = 1;
const LINEAR = 0;

export function toCanvas(w: number, h: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(w, h);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

/** Adds a canvas texture with numbered frames 0..count-1 laid out row-major. */
export function addFramedTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  rgba: Uint8ClampedArray,
  frameW: number,
  frameH: number,
  count: number,
  smooth = false,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.addCanvas(key, toCanvas(w, h, rgba));
  if (!tex) return;
  const cols = Math.max(1, Math.floor(w / frameW));
  for (let i = 0; i < count; i++) tex.add(i, 0, (i % cols) * frameW, Math.floor(i / cols) * frameH, frameW, frameH);
  // light masks are scaled up a lot, so they use linear filtering; everything else stays crisp
  tex.setFilter(smooth ? LINEAR : NEAREST);
}

export function addAnim(scene: Phaser.Scene, key: string, textureKey: string, durations: readonly number[], loop: boolean): void {
  if (scene.anims.exists(key)) return;
  scene.anims.create({
    key,
    frames: durations.map((duration, i) => ({ key: textureKey, frame: i, duration })),
    repeat: loop ? -1 : 0,
  });
}
