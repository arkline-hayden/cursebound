import type * as Phaser from 'phaser';
import { PROPS, type PropDef } from '../art/dungeon';
import { WALL_H, STUB_H } from './iso';

// Runtime iso texture helpers. The art module owns the authored iso terrain (iso:floor|wall|stub:<theme>); when a
// theme's iso set is missing this derives a serviceable one from the square tiles (resampled floor diamonds, sheared
// and stacked wall faces) so the renderer never draws holes. It also shears wall-mounted props onto the two visible
// block faces (L = south-west face, R = south-east face).

type Px = { data: Uint8ClampedArray; w: number; h: number };

function sourcePixels(scene: Phaser.Scene, key: string): Px | null {
  if (!scene.textures.exists(key)) return null;
  const img = scene.textures.get(key).getSourceImage() as HTMLCanvasElement | HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

function frameRect(scene: Phaser.Scene, key: string, frame: number) {
  const f = scene.textures.get(key).get(frame);
  return { x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight };
}

function sample(px: Px, x: number, y: number): [number, number, number, number] {
  const i = (Math.max(0, Math.min(px.h - 1, y)) * px.w + Math.max(0, Math.min(px.w - 1, x))) * 4;
  return [px.data[i], px.data[i + 1], px.data[i + 2], px.data[i + 3]];
}

/** Inverse map of the 64x32 diamond: returns tile-local (a, b) in [0,1) or null outside. */
export function diamondUV(u: number, v: number): [number, number] | null {
  const du = (u + 0.5 - 32) / 32, dv = (v + 0.5) / 16;
  const a = (du + dv) / 2, b = (dv - du) / 2;
  return a >= 0 && a < 1 && b >= 0 && b < 1 ? [a, b] : null;
}

function addSheet(scene: Phaser.Scene, key: string, frames: ImageData[], fw: number, fh: number) {
  const cols = Math.min(frames.length, 16);
  const rows = Math.ceil(frames.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * fw; c.height = rows * fh;
  const ctx = c.getContext('2d')!;
  frames.forEach((f, i) => ctx.putImageData(f, (i % cols) * fw, Math.floor(i / cols) * fh));
  const tex = scene.textures.addCanvas(key, c);
  if (!tex) return;
  frames.forEach((_, i) => tex.add(i, 0, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh));
  tex.setFilter(1);
}

function shade(p: [number, number, number, number], k: number, tint: [number, number, number] = [1, 1, 1]): [number, number, number, number] {
  return [Math.min(255, p[0] * k * tint[0]), Math.min(255, p[1] * k * tint[1]), Math.min(255, p[2] * k * tint[2]), p[3]];
}

/** Derive iso terrain for a theme from its square tiles if the art module did not provide it. */
export function ensureIsoFallback(scene: Phaser.Scene, theme: string) {
  const floorKey = `iso:floor:${theme}`, wallKey = `iso:wall:${theme}`, stubKey = `iso:stub:${theme}`;
  const sqFloor = scene.textures.exists(`dungeon:floor:${theme}`) ? `dungeon:floor:${theme}` : 'dungeon:floor';
  const sqWall = scene.textures.exists(`dungeon:wall:${theme}`) ? `dungeon:wall:${theme}` : 'dungeon:wall';
  if (!scene.textures.exists(floorKey)) {
    const src = sourcePixels(scene, sqFloor);
    if (src) {
      const frames: ImageData[] = [];
      for (let f = 0; f < 12; f++) {
        const r = frameRect(scene, sqFloor, f);
        const out = new ImageData(64, 32);
        for (let v = 0; v < 32; v++) for (let u = 0; u < 64; u++) {
          const ab = diamondUV(u, v);
          if (!ab) continue;
          const p = sample(src, r.x + Math.floor(ab[0] * r.w), r.y + Math.floor(ab[1] * r.h));
          out.data.set([p[0], p[1], p[2], 255], (v * 64 + u) * 4);
        }
        frames.push(out);
      }
      addSheet(scene, floorKey, frames, 64, 32);
    }
  }
  if (!scene.textures.exists(wallKey) || !scene.textures.exists(stubKey)) {
    const src = sourcePixels(scene, sqWall);
    if (!src) return;
    const LEFT_V = [0, 0, 1, 2, 0, 3, 0, 1, 5, 4, 6, 7, 1, 2, 3, 5];
    const block = (leftVar: number, rightVar: number, capVar: number, faceH: number) => {
      const H = 32 + faceH;
      const out = new ImageData(64, H);
      const put = (u: number, v: number, p: [number, number, number, number]) => { if (v >= 0 && v < H && p[3] > 0) out.data.set([p[0] | 0, p[1] | 0, p[2] | 0, 255], (v * 64 + u) * 4); };
      const cap = frameRect(scene, sqWall, 32 + capVar);          // cap-only frame, no rims
      const lastTop: number[] = new Array(64).fill(0);
      for (let v = 0; v < 32; v++) for (let u = 0; u < 64; u++) {
        const ab = diamondUV(u, v);
        if (!ab) continue;
        lastTop[u] = v;
        put(u, v, shade(sample(src, cap.x + Math.floor(ab[0] * 32), cap.y + Math.floor(ab[1] * 32)), faceH < WALL_H ? 0.7 : 1.05));
      }
      // faces: a column of the (stacked) 32px brick face, sheared to follow the diamond's lower edges
      const faceRow = (variant: number, row: number, col: number) => {
        const r = frameRect(scene, sqWall, variant * 4);
        if (faceH >= 64) {
          if (row < 32) return sample(src, r.x + col, frameRect(scene, sqWall, 0).y + 32 + row);
          return sample(src, r.x + col, r.y + 32 + (row - 32));
        }
        return sample(src, r.x + col, r.y + 32 + (32 - faceH) + row);
      };
      for (let u = 0; u < 64; u++) {
        const left = u < 32;
        const col = left ? u : u - 32;
        const top = lastTop[u] + 1;
        for (let row = 0; row < faceH; row++) {
          let p = faceRow(left ? leftVar : rightVar, row, col);
          p = shade(p, left ? 0.92 : 0.66);
          // string course where the stacked faces meet
          if (faceH >= 64 && (row === 31 || row === 32)) p = shade(p, row === 31 ? 1.35 : 0.45);
          put(u, top + row, p);
        }
        // crisp vertical edges: lit front corner, dark outer silhouette
        if (u === 31 || u === 32) for (let row = 0; row < faceH; row++) put(u, top + row, shade(faceRow(0, row, 16), u === 31 ? 1.25 : 0.5));
      }
      // top lip highlight + dark upper outline
      for (let u = 0; u < 64; u++) {
        const v = lastTop[u];
        put(u, v, shade(sample(src, cap.x + 16, cap.y + 16), 1.5));
        for (let vv = 0; vv < 32; vv++) if (diamondUV(u, vv)) { put(u, vv, [8, 6, 6, 255]); break; }
      }
      return out;
    };
    if (!scene.textures.exists(wallKey)) addSheet(scene, wallKey, LEFT_V.map((lv, i) => block(lv, i % 2, (i >> 1) & 1, WALL_H)), 64, 32 + WALL_H);
    if (!scene.textures.exists(stubKey)) addSheet(scene, stubKey, [0, 1, 2, 3].map((i) => block(i % 2 ? 1 : 0, 0, i & 1, STUB_H)), 64, 32 + STUB_H);
  }
}

/** A wall prop sheared onto a block face. Returns the PROPS-like def to place, or null. */
export function wallPropFor(scene: Phaser.Scene, id: string, side: 'L' | 'R'): (PropDef & { key: string; anim?: string }) | null {
  const base = PROPS[id];
  if (!base || !scene.textures.exists(base.key)) return null;
  const key = `${base.key}:${side}`;
  const anim = base.anim ? `${base.anim}:${side}` : undefined;
  const tex = scene.textures.get(base.key);
  const n = Math.max(1, tex.frameTotal - 1);
  const f0 = tex.get(0);
  const w = f0.cutWidth, h = f0.cutHeight;
  const shift = (c: number) => (side === 'L' ? Math.floor(c / 2) : Math.floor((w - 1 - c) / 2));
  const extra = Math.floor(w / 2) + 1;
  if (!scene.textures.exists(key)) {
    const src = sourcePixels(scene, base.key);
    if (!src) return null;
    const frames: ImageData[] = [];
    for (let i = 0; i < n; i++) {
      const r = frameRect(scene, base.key, i);
      const out = new ImageData(w, h + extra);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = sample(src, r.x + x, r.y + y);
        if (p[3] === 0) continue;
        out.data.set(p, ((y + shift(x)) * w + x) * 4);
      }
      frames.push(out);
    }
    addSheet(scene, key, frames, w, h + extra);
    if (anim && base.anim && scene.anims.exists(base.anim) && !scene.anims.exists(anim)) {
      const a = scene.anims.get(base.anim);
      scene.anims.create({ key: anim, frames: a.frames.map((fr, i) => ({ key, frame: i % n, duration: fr.duration || 100 })), repeat: a.repeat });
    }
  }
  const ax = Math.round(base.originX * w);
  return { ...base, key, anim, originY: (base.originY * h + shift(Math.min(w - 1, ax))) / (h + extra) };
}
