/**
 * Prismwood Canopy tileset (`tiles:prismwood`, 32x32 frames) + autotile picker + backdrop (`bg:prismwood`).
 * Framework-free. Floors are calm and dark (the action plane); walls are luminous crystal-tree foliage.
 *
 * Frame layout:
 *   0..7    floors (plain, moss glass, crystal flecks, glowing roots, petals, cracked glass, sprigs, flagstone)
 *   8..23   canopy tops: 8 + edgeMask*2 + variant, edgeMask bits: 1 = floor to the N, 2 = floor to the W, 4 = floor to the E
 *   24..31  wall faces (3/4 view): 24 + endMask*2 + variant, endMask bits: 1 = left end, 2 = right end
 *   32..39  decor (transparent): mushrooms x2, crystal shards x2, flowers x2, root tuft, glass pebbles
 */
import { PALETTES } from './palette';
import { Painter, PixelBuffer, Sheet, bayer, hash2, lighten, mix, outlinePass, rng, sparkle, type Ramp } from './draw/pixel';

export const TILE_SIZE = 32;

export const TILE_FRAMES = {
  floorBase: 0,
  floorCount: 8,
  canopyBase: 8,
  faceBase: 24,
  decorBase: 32,
  decorCount: 8,
  total: 40,
} as const;

const FLOOR_PICK = [0, 0, 0, 7, 1, 1, 2, 2, 3, 4, 5, 6, 0, 1, 2, 7];

export function pickTile(isWall: (x: number, y: number) => boolean, x: number, y: number, hash: number): number {
  const h = hash >>> 0;
  if (!isWall(x, y)) return TILE_FRAMES.floorBase + (FLOOR_PICK[h % FLOOR_PICK.length] as number);
  if (!isWall(x, y + 1)) {
    const leftEnd = !isWall(x - 1, y) || isWall(x - 1, y + 1);
    const rightEnd = !isWall(x + 1, y) || isWall(x + 1, y + 1);
    const mask = (leftEnd ? 1 : 0) | (rightEnd ? 2 : 0);
    return TILE_FRAMES.faceBase + mask * 2 + ((h >>> 3) & 1);
  }
  const mask = (!isWall(x, y - 1) ? 1 : 0) | (!isWall(x - 1, y) ? 2 : 0) | (!isWall(x + 1, y) ? 4 : 0);
  return TILE_FRAMES.canopyBase + mask * 2 + ((h >>> 2) & 1);
}

export function decorFrames(): number[] {
  return Array.from({ length: TILE_FRAMES.decorCount }, (_, i) => TILE_FRAMES.decorBase + i);
}

const B = PALETTES.biome;
const T = TILE_SIZE;

/** Seamless (period 32) value noise in 0..1. */
function pnoise(x: number, y: number, cell: number, seed: number): number {
  const n = T / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const v = (i: number, j: number): number => hash2(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function floorBase(buf: PixelBuffer, ox = 0, oy = 0, w = T, h = T): void {
  const ramp = B.floor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x + ox;
      const gy = y + oy;
      const n = pnoise(gx, gy, 8, 11) * 0.65 + pnoise(gx, gy, 4, 23) * 0.35;
      const m = pnoise(gx, gy, 16, 5);
      const v = n + bayer(gx, gy) * 0.1;
      let c = v < 0.36 ? ramp[0]! : v < 0.62 ? ramp[1]! : ramp[2]!;
      if (m > 0.66 && v > 0.45) c = mix(c, B.floorMoss[1]!, 0.5);
      buf.set(x, y, c);
    }
  }
}

function inset(r: () => number, margin = 4): number {
  return margin + r() * (T - margin * 2);
}

function drawFloor(variant: number): PixelBuffer {
  const buf = new PixelBuffer(T, T);
  floorBase(buf);
  const r = rng(100 + variant * 17);
  const p = new Painter(buf);
  switch (variant) {
    case 1: {
      // moss glass: soft teal moss pads with glassy glints
      for (let k = 0; k < 4; k++) p.ellipse(inset(r, 6), inset(r, 6), 3 + r() * 3, 2 + r() * 2);
      p.fill(B.floorMoss, { mode: 'sphere', dither: true, inner: false, light: -0.2 });
      for (let k = 0; k < 3; k++) buf.set(Math.round(inset(r)), Math.round(inset(r)), B.crystalFleck[1]!);
      break;
    }
    case 2: {
      // crystal flecks
      for (let k = 0; k < 3; k++) {
        const x = Math.round(inset(r));
        const y = Math.round(inset(r));
        const col = k % 2 ? B.crystalFleck : B.canopy;
        buf.set(x, y, col[2]!);
        buf.set(x, y - 1, col[3]!);
        buf.set(x - 1, y, col[1]!);
        buf.set(x + 1, y, col[1]!);
        buf.set(x, y + 1, col[0]!);
      }
      break;
    }
    case 3: {
      // glowing root tendril
      let x = 5 + r() * 4;
      let y = 6 + r() * 4;
      const ang0 = 0.5 + r() * 0.6;
      for (let k = 0; k < 26; k++) {
        const a = ang0 + Math.sin(k * 0.45) * 0.6;
        x += Math.cos(a) * 0.9;
        y += Math.sin(a) * 0.9;
        if (x < 3 || y < 3 || x > T - 4 || y > T - 4) break;
        buf.set(Math.round(x), Math.round(y), k % 6 === 3 ? B.rootGlow[3]! : B.rootGlow[1]!);
        if (k % 6 === 3) {
          buf.blend(Math.round(x) + 1, Math.round(y), B.rootGlow[2]!, 120);
          buf.blend(Math.round(x) - 1, Math.round(y), B.rootGlow[2]!, 120);
        }
      }
      break;
    }
    case 4: {
      // fallen petals
      for (let k = 0; k < 4; k++) {
        const x = Math.round(inset(r));
        const y = Math.round(inset(r));
        buf.set(x, y, B.floorPetal[2]!);
        buf.set(x + 1, y, B.floorPetal[1]!);
        buf.set(x, y - 1, B.floorPetal[3]!);
      }
      break;
    }
    case 5: {
      // cracked glass
      let x = inset(r, 8);
      let y = inset(r, 8);
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2;
        let cx = x;
        let cy = y;
        for (let s = 0; s < 7; s++) {
          cx += Math.cos(a + (r() - 0.5) * 0.8);
          cy += Math.sin(a + (r() - 0.5) * 0.8);
          if (cx < 2 || cy < 2 || cx > T - 3 || cy > T - 3) break;
          buf.set(Math.round(cx), Math.round(cy), B.floor[3]!);
        }
      }
      x = Math.round(x);
      y = Math.round(y);
      buf.set(x, y, B.crystalFleck[1]!);
      break;
    }
    case 6: {
      // tiny leaf sprigs
      for (let k = 0; k < 3; k++) {
        const x = Math.round(inset(r));
        const y = Math.round(inset(r));
        buf.set(x, y, B.canopyTeal[0]!);
        buf.set(x - 1, y - 1, B.canopyTeal[1]!);
        buf.set(x + 1, y - 1, B.canopyTeal[1]!);
        buf.set(x, y - 2, B.canopyTeal[2]!);
      }
      break;
    }
    case 7: {
      // faint flagstone seams (inside the tile so it never forms a grid)
      const sx = 6 + Math.round(r() * 6);
      const sy = 8 + Math.round(r() * 8);
      for (let x = 4; x < T - 4; x++) if (hash2(x, sy, 9) > 0.18) buf.set(x, sy, B.floor[0]!);
      for (let y = 4; y < sy; y++) if (hash2(sx, y, 9) > 0.18) buf.set(sx, y, B.floor[0]!);
      for (let x = 4; x < T - 4; x++) if (hash2(x, sy + 1, 4) > 0.5) buf.set(x, sy + 1, B.floor[2]!);
      break;
    }
    default:
      break;
  }
  return buf;
}

// ---------------------------------------------------------------- canopy (luminous foliage)

const LEAF_RAMPS: Ramp[] = [B.canopy, B.canopy, B.canopyTeal, B.canopyMagenta, B.canopy];

/** Seamless foliage texture for canopy tops (period 32). */
function foliage(variant: number, clipTop: number, clipLeft: number, clipRight: number): PixelBuffer {
  const big = new PixelBuffer(T * 3, T * 3);
  const p = new Painter(big);
  const r = rng(500 + variant * 13);
  // dark understory
  for (let y = 0; y < big.h; y++) for (let x = 0; x < big.w; x++) big.set(x, y, mix(B.canopy[0]!, 0x0c0820, 0.35));
  const clusters: [number, number, number, Ramp][] = [];
  for (let k = 0; k < 16; k++) clusters.push([r() * T, r() * T, 3.6 + r() * 3.4, LEAF_RAMPS[Math.floor(r() * LEAF_RAMPS.length)]!]);
  clusters.sort((a, b) => a[1] - b[1]);
  for (const [cx, cy, rad, ramp] of clusters) {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = cx + T + ox * T;
        const y = cy + T + oy * T;
        p.ellipse(x, y, rad, rad * 0.85).fill(ramp, { mode: 'sphere', dither: true });
        // leaf tips
        p.gpx(x - rad * 0.4, y - rad * 0.5, ramp[3]!, ramp[2]!);
      }
    }
  }
  // glowing crystal buds
  for (let k = 0; k < 3; k++) {
    const x = r() * T;
    const y = r() * T;
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const gx = x + T + ox * T;
        const gy = y + T + oy * T;
        p.gpx(gx, gy, 0xffffff, B.crystalFleck[2]!).gpx(gx, gy + 1, B.crystalFleck[2]!, B.crystalFleck[2]!);
      }
  }
  p.finish(PALETTES.outline, 0.6);
  const out = new PixelBuffer(T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) out.set(x, y, big.get(x + T, y + T));
  // edges toward floor: bumpy leafy rim over floor
  if (clipTop || clipLeft || clipRight) {
    const under = new PixelBuffer(T, T);
    floorBase(under);
    const edgeR = rng(900 + variant);
    const bumpsTop = Array.from({ length: 9 }, () => edgeR());
    const bumpsSide = Array.from({ length: 9 }, () => edgeR());
    const rim = (t: number, arr: number[]): number => {
      const i = Math.floor(t * 8);
      const f = t * 8 - i;
      const a = arr[i] as number;
      const b = arr[Math.min(8, i + 1)] as number;
      return 3 + (a + (b - a) * f) * 3 + Math.abs(Math.sin(t * Math.PI * 4)) * 1.5;
    };
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        let outside = false;
        if (clipTop && y < rim(x / T, bumpsTop)) outside = true;
        if (clipLeft && x < rim(y / T, bumpsSide)) outside = true;
        if (clipRight && T - 1 - x < rim(y / T, bumpsSide)) outside = true;
        if (outside) out.set(x, y, under.get(x, y), 0);
      }
    }
    // rim highlight + outline
    const src = out.clone();
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (src.alpha(x, y) === 0) continue;
        const up = y > 0 && src.alpha(x, y - 1) === 0;
        const lf = x > 0 && src.alpha(x - 1, y) === 0;
        const rt = x < T - 1 && src.alpha(x + 1, y) === 0;
        if (up || lf) out.set(x, y, lighten(src.get(x, y) & 0xffffff, 0.35));
        else if (rt) out.set(x, y, mix(src.get(x, y) & 0xffffff, PALETTES.outline, 0.4));
      }
    }
    outlinePass(out, PALETTES.outline);
    // composite over floor; soft drop shadow on the floor
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (out.alpha(x, y) === 0) {
          const shadow = (clipTop && y >= 0 && out.alpha(x, Math.min(T - 1, y + 2)) > 0) || false;
          out.set(x, y, shadow ? mix(under.get(x, y) & 0xffffff, 0x05030c, 0.4) : under.get(x, y) & 0xffffff);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- wall face (3/4 view crystal trunks)

function drawFace(variant: number, leftEnd: boolean, rightEnd: boolean): PixelBuffer {
  const out = new PixelBuffer(T, T);
  floorBase(out);
  const capH = 11;
  const buf = new PixelBuffer(T, T);
  const p = new Painter(buf);
  const r = rng(700 + variant * 31);
  const x0 = leftEnd ? 3 : 0;
  const x1 = rightEnd ? T - 3 : T;
  // deep shadowed hollow behind the trunks
  p.rect(x0, capH - 2, x1 - x0, T - capH - 1).fill([0x0a0618, 0x120a2a, 0x1a1040, 0x24164e], { mode: 'emboss', dither: true, light: -0.3, inner: false });
  // crystal glass trunks (period 32 so neighbouring faces line up)
  const trunks: [number, number][] = [
    [5 + variant * 3, 4.2],
    [18 + variant * 2, 5.2],
    [29 + variant, 3.6],
  ];
  for (const [tx, tw] of trunks) {
    for (const off of [-T, 0, T]) {
      const cx = tx + off;
      if (cx + tw < x0 || cx - tw > x1) continue;
      p.poly([cx - tw, capH - 2, cx + tw, capH - 2, cx + tw * 1.25, T - 2, cx - tw * 1.25, T - 2]);
    }
  }
  p.fill(B.trunk, { mode: 'cyl', light: 0.05 });
  // glass sheen on trunks
  for (const [tx, tw] of trunks) {
    for (const off of [-T, 0, T]) {
      const cx = tx + off - tw * 0.45;
      for (let y = capH; y < T - 3; y++) if ((y + variant) % 7 !== 0 && cx >= x0 && cx < x1) buf.blend(Math.round(cx), y, B.trunk[4]!, 150);
    }
  }
  // glowing root veins at the base
  for (let k = 0; k < 3; k++) {
    const sx = x0 + 2 + r() * (x1 - x0 - 4);
    p.capsule(sx, T - 2, sx + (r() - 0.5) * 6, T - 7 - r() * 4, 1, 0.5);
  }
  p.fill(B.rootGlow, { mode: 'emboss', glow: B.rootGlow[3]!, light: 0.3 });
  // hanging glow crystals
  for (let k = 0; k < 2; k++) {
    const gx = x0 + 3 + r() * (x1 - x0 - 6);
    const gy = capH + 3 + r() * 6;
    p.poly([gx, gy - 2, gx + 1.6, gy + 1, gx, gy + 4, gx - 1.6, gy + 1]).fill(k ? B.crystalFleck : B.canopyMagenta, {
      mode: 'facet',
      facets: 4,
      glow: (k ? B.crystalFleck : B.canopyMagenta)[3]!,
      inner: false,
    });
  }
  // foliage cap with overhanging bumps
  const caps: [number, number, number, Ramp][] = [];
  for (let k = 0; k < 9; k++) caps.push([x0 + ((k + r() * 0.6) / 8.6) * (x1 - x0), 4 + r() * 3, 3.6 + r() * 2.4, LEAF_RAMPS[Math.floor(r() * LEAF_RAMPS.length)]!]);
  p.rect(x0, 0, x1 - x0, capH - 3).fill(B.canopy, { mode: 'emboss', dither: true });
  for (const [cx, cy, rad, ramp] of caps) {
    p.ellipse(cx, cy + 3, rad, rad * 0.85).fill(ramp, { mode: 'sphere', dither: true });
    p.gpx(cx - rad * 0.3, cy + 3 - rad * 0.5, ramp[3]!, ramp[2]!);
  }
  p.finish(PALETTES.outline, 0.6);
  // clip ends + composite
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const c = buf.get(x, y);
      if (c >>> 24 === 0) continue;
      out.blend(x, y, c & 0xffffff, c >>> 24);
    }
  }
  // contact shadow along the base
  for (let x = x0; x < x1; x++) {
    out.set(x, T - 1, mix(out.get(x, T - 1) & 0xffffff, 0x05030c, 0.6));
  }
  return out;
}

// ---------------------------------------------------------------- decor

function drawDecor(i: number): PixelBuffer {
  const buf = new PixelBuffer(T, T);
  const p = new Painter(buf);
  const r = rng(1300 + i * 7);
  const cx = 16;
  const by = 24;
  switch (i) {
    case 0:
    case 1: {
      // glow mushrooms
      const ramp = i === 0 ? B.crystalFleck : B.canopyMagenta;
      const n = 3;
      for (let k = 0; k < n; k++) {
        const x = cx - 6 + k * 6 + (r() - 0.5) * 2;
        const h = 4 + r() * 5;
        p.capsule(x, by, x, by - h, 1, 1).fill(PALETTES.biome.trunk, { mode: 'cyl' });
        p.ellipse(x, by - h - 1, 3 + r(), 2).fill(ramp, { mode: 'sphere', glow: ramp[3]!, light: 0.15 });
      }
      break;
    }
    case 2:
    case 3: {
      // crystal shards
      const ramp = i === 2 ? B.crystalFleck : B.canopy;
      for (let k = 0; k < 3; k++) {
        const x = cx - 5 + k * 5;
        const h = 6 + r() * 7 + (k === 1 ? 4 : 0);
        const lean = (k - 1) * 2;
        p.poly([x - 2, by, x + 2, by, x + lean + 0.5, by - h, x + lean - 0.5, by - h - 1]).fill(ramp, { mode: 'facet', facets: 3, glow: ramp[3]!, rot: 0.4 });
      }
      break;
    }
    case 4:
    case 5: {
      // flowers
      const petal = i === 4 ? B.floorPetal : B.gold;
      for (let k = 0; k < 3; k++) {
        const x = cx - 6 + k * 6;
        const h = 4 + r() * 4;
        p.line(x, by, x, by - h).fill(B.canopyTeal, { mode: 'flat', tone: 1, inner: false });
        for (let q = 0; q < 4; q++) {
          const a = (q / 4) * Math.PI * 2;
          p.circle(x + Math.cos(a) * 1.6, by - h + Math.sin(a) * 1.4, 1.2);
        }
        p.fill(petal, { mode: 'sphere' });
        p.gpx(x, by - h, 0xfff6c0, petal[3]!);
      }
      break;
    }
    case 6: {
      // glowing root tuft
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (k - 1.5) * 0.45;
        p.capsule(cx, by, cx + Math.cos(a) * 9, by + Math.sin(a) * 9, 1.2, 0.5);
      }
      p.fill(B.rootGlow, { mode: 'emboss', glow: B.rootGlow[3]! });
      break;
    }
    default: {
      // glass pebbles
      for (let k = 0; k < 4; k++) p.ellipse(cx - 6 + k * 4 + r(), by - 1 - r() * 2, 1.8 + r(), 1.3);
      p.fill(B.crystalFleck, { mode: 'sphere' });
      break;
    }
  }
  p.finish();
  return buf;
}

export interface TilesetSheet {
  key: string;
  frameW: number;
  frameH: number;
  width: number;
  height: number;
  frameCount: number;
  rgba: Uint8ClampedArray;
}

export function buildTileset(): TilesetSheet {
  const sheet = new Sheet(T, T, TILE_FRAMES.total, T * 8);
  for (let v = 0; v < TILE_FRAMES.floorCount; v++) sheet.add(drawFloor(v));
  for (let mask = 0; mask < 8; mask++) for (let v = 0; v < 2; v++) sheet.add(foliage(v, mask & 1, mask & 2, mask & 4));
  for (let mask = 0; mask < 4; mask++) for (let v = 0; v < 2; v++) sheet.add(drawFace(v, (mask & 1) !== 0, (mask & 2) !== 0));
  for (let d = 0; d < TILE_FRAMES.decorCount; d++) sheet.add(drawDecor(d));
  return { key: 'tiles:prismwood', frameW: T, frameH: T, width: sheet.buf.w, height: sheet.buf.h, frameCount: sheet.count, rgba: sheet.buf.toRGBA() };
}

export const BACKDROP_SIZE = { w: 480, h: 270 } as const;

/** Deep gradient sky with distant crystal trees, nebula haze and floating crystal motes. */
export function buildBackdrop(): { key: string; width: number; height: number; rgba: Uint8ClampedArray } {
  const W = BACKDROP_SIZE.w;
  const H = BACKDROP_SIZE.h;
  const buf = new PixelBuffer(W, H);
  const r = rng(4040);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const d = bayer(x, y) * 0.08;
      const tt = Math.min(1, Math.max(0, t + d));
      const c = tt < 0.55 ? mix(B.skyTop, B.skyMid, tt / 0.55) : mix(B.skyMid, B.skyLow, (tt - 0.55) / 0.45);
      buf.set(x, y, c);
    }
  }
  // nebula haze (dithered soft blobs, periodic horizontally)
  const blobs: [number, number, number, number][] = [];
  for (let k = 0; k < 7; k++) blobs.push([r() * W, 30 + r() * 150, 40 + r() * 70, Math.floor(r() * 3)]);
  const hazeCols = [0x3a1c7a, 0x0f4a5a, 0x5a1660];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      let col = 0;
      for (const [bx, by, br, ci] of blobs) {
        for (const off of [-W, 0, W]) {
          const dx = (x - bx - off) / br;
          const dy = (y - by) / (br * 0.5);
          const f = 1 - (dx * dx + dy * dy);
          if (f > v) {
            v = f;
            col = hazeCols[ci] as number;
          }
        }
      }
      if (v > 0 && v * 0.55 + bayer(x, y) * 0.3 > 0.22) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, col, Math.min(0.55, v * 0.6)));
    }
  }
  // stars
  for (let k = 0; k < 140; k++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * H * 0.7);
    buf.set(x, y, mix(0xffffff, B.mote[Math.floor(r() * 4)]!, 0.4), Math.round(120 + r() * 135));
  }
  // distant crystal tree silhouettes (two parallax-ish bands)
  for (const band of [0, 1]) {
    const baseY = band === 0 ? 200 : 240;
    const col = band === 0 ? 0x1c1048 : 0x120a30;
    const rim = band === 0 ? 0x4a3a9a : 0x2c2470;
    const count = band === 0 ? 14 : 10;
    for (let k = 0; k < count; k++) {
      const tx = (k / count) * W + r() * 20;
      const th = (band === 0 ? 60 : 50) + r() * 50;
      const tw = 8 + r() * 10;
      for (let y = Math.floor(baseY - th); y < H; y++) {
        const t = (y - (baseY - th)) / th;
        const hw = y < baseY ? tw * (0.3 + t * 0.7) * (t < 0.15 ? t / 0.15 : 1) : tw;
        for (let x = Math.floor(tx - hw); x <= tx + hw; x++) {
          const xx = ((x % W) + W) % W;
          const edge = Math.abs(x - tx) > hw - 1;
          buf.set(xx, y, edge && y < baseY ? rim : col);
        }
      }
      // glowing crystal tip
      sparkle(buf, Math.round(tx) % W, Math.round(baseY - th), B.mote[k % 4]!, 1, 220);
    }
    for (let y = baseY; y < H; y++) for (let x = 0; x < W; x++) buf.set(x, y, mix(col, 0x05030c, (y - baseY) / (H - baseY + 10)));
  }
  // floating crystal motes with halos
  for (let k = 0; k < 26; k++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(20 + r() * 200);
    const col = B.mote[Math.floor(r() * 4)]!;
    const big = r() > 0.7;
    if (big) {
      buf.blend(x, y - 2, col, 255);
      buf.blend(x - 1, y - 1, col, 255);
      buf.blend(x, y - 1, 0xffffff, 255);
      buf.blend(x + 1, y - 1, col, 255);
      buf.blend(x, y, col, 255);
      for (const [dx, dy] of [[0, -3], [-2, -1], [2, -1], [0, 1], [-1, -2], [1, -2], [-1, 0], [1, 0]] as const) buf.blend(x + dx, y + dy, col, 80);
    } else {
      sparkle(buf, x, y, col, 1, 200);
    }
  }
  return { key: 'bg:prismwood', width: W, height: H, rgba: buf.toRGBA() };
}
