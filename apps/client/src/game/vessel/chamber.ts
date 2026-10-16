/**
 * The portal chamber behind the Vessel Select lineup: a corner of an isometric catacomb room built from the game's
 * own iso art (the theme's masonry floor diamonds and wall blocks, candle alcoves, banners and blind arches), lit by
 * two iron braziers, wall candles and a faint cold shaft from above. Baked once per stage size into an albedo
 * layer, an additive emissive layer (candle flames) and a static light map; the renderer adds the live lights.
 * Framework-free.
 */
import { buildIsoFrames, wallFrameFor, type IsoFrames } from '../art/isoTerrain';
import { isoFloorFrame } from '../art/isoFloor';
import { hash2, type PixelBuffer } from '../art/draw/pixel';
import { coneLight, newLight, pointLight, type LightBuf } from './light';

export const CHAMBER_THEME = 'catacombs' as const;

let isoCache: IsoFrames | null = null;
/** The chamber's iso art (built once per session, ~100 ms). */
export function chamberArt(): IsoFrames {
  isoCache ??= buildIsoFrames(CHAMBER_THEME);
  return isoCache;
}
export const chamberArtReady = (): boolean => isoCache !== null;

export interface Chamber {
  w: number;
  h: number;
  /** ARGB albedo (opaque) */
  albedo: Uint32Array;
  /** additive RGB emissive (0 = none): candle flames, glowing details */
  emissive: Uint32Array;
  /** static light multipliers (ambient, braziers, candles, vignette baked in) */
  light: LightBuf;
  /** brazier anchors (bowl rim centre) for the live flames */
  braziers: { x: number; y: number }[];
  /** floor point of the back corner */
  corner: { x: number; y: number };
}

export interface ChamberOpts {
  w: number;
  h: number;
  /** lineup centre and front feet line */
  cx: number;
  baseY: number;
  /** horizontal reach of the outermost plinth from the centre, and how far back it stands */
  reach: number;
  arc: number;
  /** 0..1.3 decor density (graphics tier) */
  decor: number;
  /** iso art, or null for the plain fallback while it builds */
  iso: IsoFrames | null;
}

const AMBIENT = 0x8a90c0;
const BRAZIER = 0xff8a3a;
const CANDLE = 0xffb060;

/** Back-to-front order of the north (L faces) and west (R faces) wall runs, outward from the corner. */
const NORTH_RUN = ['pilaster', 'alcove', 'archL', 'archR', 'banner', 'pilaster', 'skulls', null, 'alcove', 'ring', 'pilaster', 'archL', 'archR', 'niche', null, 'pilaster'] as const;
const WEST_RUN = ['pilaster', 'alcove', 'archR', 'archL', 'banner', 'pilaster', 'ring', null, 'alcove', 'skulls', 'pilaster', 'archR', 'archL', 'niche', null, 'pilaster'] as const;

function blit(dst: Uint32Array, w: number, h: number, src: PixelBuffer, dx: number, dy: number, emissive?: Uint32Array, glow?: PixelBuffer | null): void {
  for (let y = 0; y < src.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= w) continue;
      const c = src.data[y * src.w + x]!;
      const a = c >>> 24;
      const i = ty * w + tx;
      if (a >= 250) dst[i] = c | 0xff000000;
      else if (a > 0) {
        const d = dst[i]!, t = a / 255;
        const r = ((d >> 16) & 255) * (1 - t) + ((c >> 16) & 255) * t;
        const g = ((d >> 8) & 255) * (1 - t) + ((c >> 8) & 255) * t;
        const b = (d & 255) * (1 - t) + (c & 255) * t;
        dst[i] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
      }
      if (emissive && glow) {
        const gc = glow.data[y * glow.w + x]!;
        const ga = gc >>> 24;
        if (ga) {
          const k = ga / 255;
          emissive[i] = ((((gc >> 16) & 255) * k) << 16) | ((((gc >> 8) & 255) * k) << 8) | ((gc & 255) * k);
        }
      }
    }
  }
}

export function buildChamber(o: ChamberOpts): Chamber {
  const { w, h, cx, baseY } = o;
  const albedo = new Uint32Array(w * h).fill(0xff050407);
  const emissive = new Uint32Array(w * h);
  const light = newLight(w, h);
  // the back corner sits far enough behind the lineup that the outermost plinths stand clear of the walls
  const ox = Math.round(cx), oy = Math.round(baseY - (o.arc + 15 + o.reach / 2 + 6));
  const P = (tx: number, ty: number) => ({ x: ox + (tx - ty) * 32, y: oy + (tx + ty) * 16 });
  const iso = o.iso;

  if (iso) {
    // floor diamonds over everything below the corner
    const smax = Math.ceil((h - oy) / 16) + 2, dmax = Math.ceil(w / 64) + 2;
    for (let s = 0; s <= smax; s++)
      for (let d = -dmax * 2; d <= dmax * 2; d++) {
        if (((s + d) & 1) !== 0) continue;
        const tx = (s + d) / 2, ty = (s - d) / 2;
        if (tx < 0 || ty < 0) continue;
        const p = P(tx, ty);
        if (p.x + 32 < 0 || p.x - 32 >= w || p.y >= h) continue;
        blit(albedo, w, h, iso.floor[isoFloorFrame(tx, ty)]!, p.x - 32, p.y);
      }
    // wall runs, back to front (corner first)
    const blocks: { bx: number; by: number; frame: number }[] = [{ bx: -1, by: -1, frame: 0 }];
    // lower graphics tiers dress fewer blocks (plain stone instead of banners, alcoves and arches)
    const dressed = (k: number, side: number) => hash2(k, side, 91) < o.decor;
    for (let k = 0; k < 16; k++) {
      const nv = dressed(k, 0) ? NORTH_RUN[k % NORTH_RUN.length]! : null, wv = dressed(k, 1) ? WEST_RUN[k % WEST_RUN.length]! : null;
      blocks.push({ bx: k, by: -1, frame: nv ? wallFrameFor(CHAMBER_THEME, nv, 'L') : (k * 7) % 4 });
      blocks.push({ bx: -1, by: k, frame: wv ? wallFrameFor(CHAMBER_THEME, wv, 'R') : (k * 5 + 1) % 4 });
    }
    blocks.sort((a, b) => a.bx + a.by - (b.bx + b.by));
    for (const b of blocks) {
      const p = P(b.bx, b.by);
      if (p.x + 32 < 0 || p.x - 32 >= w || p.y - 64 >= h) continue;
      blit(albedo, w, h, iso.wall[b.frame]!, p.x - 32, p.y - 64, emissive, iso.wallGlow?.[b.frame] ?? null);
    }
  } else {
    // plain fallback while the iso art builds: a dark floor plane and two wall planes
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const wallBase = oy + Math.abs(x - ox) / 2;
        const c = y > wallBase ? ((x + y) & 3 ? 0xff1a1618 : 0xff141114) : y > wallBase - 64 ? 0xff241e1c : 0xff050407;
        albedo[y * w + x] = c;
      }
  }

  // ---- static light: ambient (darker up high), braziers, candles, a cold shaft from above, vignette
  const amb = [((AMBIENT >> 16) & 255) / 255, ((AMBIENT >> 8) & 255) / 255, (AMBIENT & 255) / 255];
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, Math.min(1, (y - (oy - 60)) / Math.max(1, h - (oy - 60))));
    const k = 0.16 + 0.22 * t;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      light[i] = amb[0]! * k; light[i + 1] = amb[1]! * k; light[i + 2] = amb[2]! * k;
    }
  }
  coneLight(light, w, h, cx, oy - 90, baseY + 18, 18, o.reach + 30, 0x9ab0ff, 0.42);
  pointLight(light, w, h, cx, baseY - o.arc / 2, o.reach + 50, (o.reach + 50) / 2, 0x7a86c0, 0.35);
  const braziers: { x: number; y: number }[] = [];
  const bx = o.reach + 30;
  for (const side of [-1, 1]) {
    const x = Math.round(cx + side * bx), y = Math.round(baseY - o.arc - 4);
    braziers.push({ x, y: y - 15 });
    pointLight(light, w, h, x, y, 150, 75, BRAZIER, 1.25);
    pointLight(light, w, h, x, y - 30, 80, 80, BRAZIER, 0.6);
  }
  // wall candles: every emissive cluster lights its wall
  if (iso) {
    const seen: { x: number; y: number }[] = [];
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        if (!emissive[y * w + x]) continue;
        if (seen.some((s) => Math.abs(s.x - x) < 14 && Math.abs(s.y - y) < 14)) continue;
        seen.push({ x, y });
        pointLight(light, w, h, x, y + 4, 30, 26, CANDLE, 0.85);
      }
  }
  // vignette (multiplicative, banded)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w * 0.62), dy = (y + 0.5 - (oy + baseY) / 2) / (h * 0.7);
      const d = Math.sqrt(dx * dx + dy * dy);
      const v = d < 0.6 ? 1 : Math.max(0.25, 1 - Math.ceil((d - 0.6) * 10) / 10 * 1.6);
      const i = (y * w + x) * 3;
      light[i] *= v; light[i + 1] *= v; light[i + 2] *= v;
    }
  return { w, h, albedo, emissive, light, braziers, corner: { x: ox, y: oy } };
}
