/**
 * What lies beyond the floor's edge on the open-air themes (framework-free pixel generators; Skybox.ts uploads them):
 *   sky:backdrop     320x180  open sky: dithered azure falling to a pale horizon, the sun with its halo, cloud banks,
 *                             far shards of earth adrift in the haze, a sea of cloud below
 *   sky:cloud        4 x 96x40  puffy clouds drifting under and around the shard (parallax)
 *   sky:underside    4 x 48x72  the shard's underside hanging below its brink: earth strata, rock, trailing roots
 *   sky:islet        3 x 28x28  small chunks of earth adrift near the shard
 *   moon:backdrop    320x180  the black sky of the dead moon: stars, a faint nebula band and the cold blue Earth
 *   moon:star        1 x 5x5    a sparkle for the few stars that twinkle
 * Everything is crisp pixel art (nearest filtering), ordered-dithered rather than smooth.
 */
import { Painter, PixelBuffer, bayer, hash2, mix, rng, type Ramp } from './draw/pixel';
import { MATERIALS } from './palette';

const R = (...c: number[]): Ramp => Object.freeze(c);

export const SKY_W = 320;
export const SKY_H = 180;

/** Ordered-dither between the stops of a vertical gradient: t in 0..1 over the stops. */
function gradient(stops: readonly number[], t: number, x: number, y: number): number {
  const n = stops.length - 1;
  const v = Math.max(0, Math.min(0.9999, t)) * n;
  const i = Math.floor(v);
  const f = v - i;
  return f + (bayer(x, y) - 0.5) * 0.9 > 0.5 ? stops[Math.min(n, i + 1)]! : stops[i]!;
}

function noise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const v = (i: number, j: number): number => hash2(i, j, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

const CLOUD = R(0x7a90b4, 0xa8bcd8, 0xc8d8ec, 0xe8f2fa, 0xffffff);
const SKY_STOPS = [0x2a64b8, 0x3a78c8, 0x5a96dc, 0x7ab4e8, 0xa0cef2, 0xc8e4f8, 0xe0f0fa, 0xc0dcf4, 0x9cc4ec, 0x86b4e4];

/** Puffs of cloud: a union of round lobes, lit from above-left, shadowed under, dithered at the fringe. */
function puffs(buf: PixelBuffer, lobes: [number, number, number][], ramp: Ramp, alpha = 255): void {
  let minY = Infinity, maxY = -Infinity;
  for (const [, cy, r] of lobes) { minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r); }
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(buf.h, Math.ceil(maxY) + 1); y++)
    for (let x = 0; x < buf.w; x++) {
      let best = 0, lit = 0;
      for (const [cx, cy, r] of lobes) {
        const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.15) / r;
        if (d < 1 && 1 - d > best) { best = 1 - d; lit = ((cx - x) * 0.6 + (cy - y)) / r; }
      }
      if (best <= 0) continue;
      if (best < 0.08 && bayer(x, y) > best * 9) continue;
      const v = 1.6 + lit * 1.6 + (1 - (y - minY) / (maxY - minY)) * 1.2 + bayer(x, y) * 0.5;
      buf.set(x, y, ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v)))]!, alpha);
    }
}

export function skyBackdrop(): PixelBuffer {
  const b = new PixelBuffer(SKY_W, SKY_H);
  const horizon = 112;
  for (let y = 0; y < SKY_H; y++)
    for (let x = 0; x < SKY_W; x++) {
      // above the horizon the sky pales towards it; below it, the open air under the shard deepens again
      const t = y < horizon ? (y / horizon) * 0.66 : 0.66 + ((y - horizon) / (SKY_H - horizon)) * 0.34;
      b.set(x, y, gradient(SKY_STOPS, t, x, y));
    }
  // the sun: a white-gold disc in a stepped halo, faint rays
  const sx = 58, sy = 34;
  for (let y = 0; y < 90; y++)
    for (let x = 0; x < 130; x++) {
      const d = Math.hypot(x - sx, y - sy);
      const ray = Math.abs(Math.sin(Math.atan2(y - sy, x - sx) * 7)) > 0.94 && d < 64;
      let c = -1;
      if (d < 7) c = 0xfffcf0;
      else if (d < 9) c = 0xfff0c0;
      else if (d < 15 && bayer(x, y) > (d - 9) / 6) c = mix(b.get(x, y) & 0xffffff, 0xfff4d0, 0.55);
      else if (d < 28 && bayer(x, y) > 0.5 + (d - 15) / 26) c = mix(b.get(x, y) & 0xffffff, 0xfff0d0, 0.3);
      else if (ray && bayer(x, y) > 0.7 + d / 220) c = mix(b.get(x, y) & 0xffffff, 0xfff8e0, 0.22);
      if (c >= 0) b.set(x, y, c);
    }
  // far shards of earth adrift in the haze (atmospheric blue, no detail)
  for (const [cx, cy, s] of [[236, 92, 1], [272, 100, 0.6], [128, 98, 0.45]] as const) {
    const p = new Painter(b);
    p.poly([cx - 14 * s, cy, cx + 14 * s, cy, cx + 6 * s, cy + 9 * s, cx, cy + 16 * s, cx - 7 * s, cy + 7 * s]).fill(R(0x6a8cb8, 0x7c9cc4, 0x8eacd0, 0x9cbad8, 0xaac6e0), { mode: 'flat', tone: 1, inner: false });
    p.ellipse(cx, cy, 14 * s, 2.6 * s).fill(R(0x6a9ab0, 0x7aa8bc, 0x8ab4c4, 0x98c0cc, 0xa6cad4), { mode: 'flat', tone: 2, inner: false });
  }
  // cloud banks on the horizon and a sea of cloud far below
  const r = rng(9001);
  const bank = (y0: number, n: number, size: number, ramp: Ramp): void => {
    for (let k = 0; k < n; k++) {
      const cx = r() * (SKY_W + 40) - 20, cy = y0 + (r() - 0.5) * 6;
      const lobes: [number, number, number][] = [];
      const m = 3 + Math.floor(r() * 4);
      for (let j = 0; j < m; j++) lobes.push([cx + (j - m / 2) * size * 0.9 + (r() - 0.5) * size * 0.5, cy - r() * size * 0.5, size * (0.6 + r() * 0.6)]);
      puffs(b, lobes, ramp);
    }
  };
  bank(horizon + 2, 9, 7, R(0x9ab8dc, 0xb4cce6, 0xcadcf0, 0xdeeaf6, 0xf2f8fc));
  bank(SKY_H - 14, 12, 12, CLOUD);
  return b;
}

/** A drifting cloud (variant i). */
export function skyCloud(i: number): PixelBuffer {
  const b = new PixelBuffer(96, 40);
  const r = rng(9100 + i * 17);
  const lobes: [number, number, number][] = [];
  const n = 5 + (i % 3);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    lobes.push([12 + t * 72 + (r() - 0.5) * 6, 26 - Math.sin(t * Math.PI) * 9 + (r() - 0.5) * 4, 8 + Math.sin(t * Math.PI) * 7 + r() * 3]);
  }
  puffs(b, lobes, CLOUD);
  return b;
}

const EARTH = R(0x1e1408, 0x34240e, 0x4e3818, 0x6a4e24, 0x8a6a34);
const ROCK = R(0x26221e, 0x3c3630, 0x544c44, 0x6e655a, 0x8a8072);

/** A chunk of the shard's underside (variant i): wide at the top, tapering to a ragged point, roots hanging off it. */
export function skyUnderside(i: number): PixelBuffer {
  const W = 48, H = 72;
  const b = new PixelBuffer(W, H);
  const r = rng(9200 + i * 31);
  const tip = 44 + r() * 24;
  const lean = (r() - 0.5) * 10;
  for (let y = 0; y < H; y++) {
    const t = y / tip;
    if (t > 1) break;
    const half = (W / 2 - 1) * Math.pow(1 - t, 0.75) + (noise(0, y, 5, 9201 + i) - 0.5) * 5;
    const cx = W / 2 + lean * t;
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / Math.max(1, half);
      if (Math.abs(dx) > 1) continue;
      const band = Math.floor((y + noise(x, y, 6, 9202 + i) * 6) / 7);
      const ramp = y < 18 ? EARTH : band % 3 === 2 ? EARTH : ROCK;
      // lit from the upper-left: the left flank catches the sky's light, the right sinks into shadow
      let v = 2.2 - dx * 1.3 - t * 1.4 + (hash2(band, i, 9203) - 0.5) * 0.8 + bayer(x, y) * 0.5;
      if (Math.abs(dx) > 0.86) v -= 0.8;
      let c = ramp[Math.max(0, Math.min(4, Math.floor(v)))]!;
      // atmospheric haze deepens towards the tip
      c = mix(c, 0x8ab4e0, Math.min(0.55, t * 0.6));
      if (t > 0.82 && bayer(x, y) + 0.4 < (t - 0.82) * 6) continue;
      b.set(x, y, c);
    }
  }
  // roots and vines trailing below
  const p = new Painter(b);
  for (let k = 0; k < 4; k++) {
    const x = 8 + r() * 32, y0 = 4 + r() * 18;
    p.capsule(x, y0, x + (r() - 0.5) * 8, y0 + 18 + r() * 26, 1, 0.3);
  }
  p.fill(MATERIALS.root, { mode: 'cyl', dither: true, inner: false });
  for (let k = 0; k < 3; k++) {
    let x = 6 + r() * 36;
    for (let y = 2 + r() * 8; y < 30 + r() * 30; y += 1.5) { x += (r() - 0.5) * 1.4; p.dot(x, y); }
  }
  p.fill(R(0x16300e, 0x285018, 0x3e7a22, 0x5ea432, 0x8ccc50), { mode: 'flat', tone: 2, inner: false });
  return b;
}

/** A small islet adrift near the shard (variant i): a grass cap on a little cone of earth. */
export function skyIslet(i: number): PixelBuffer {
  const b = new PixelBuffer(28, 28);
  const r = rng(9300 + i * 13);
  const p = new Painter(b);
  const w = 9 + r() * 3;
  p.poly([14 - w, 9, 14 + w, 9, 14 + w * 0.5, 16, 14 + (r() - 0.5) * 4, 26, 14 - w * 0.6, 15]).fill(EARTH, { mode: 'emboss', dither: true, light: 0.1 });
  p.ellipse(14, 9, w, 3.2).fill(R(0x1e3410, 0x30521a, 0x4a7424, 0x6c9a32, 0x9ac650), { mode: 'sphere', dither: true, light: 0.2 });
  if (i === 1) { p.capsule(16, 8, 18, 1, 0.9, 0.6).fill(R(0x1e140c, 0x342416, 0x4e3820, 0x6a4e2e, 0x8a6a40), { mode: 'cyl' }); p.ellipse(19, 2, 4, 2.6).fill(R(0x16300e, 0x285018, 0x3e7a22, 0x5ea432, 0x8ccc50), { mode: 'sphere' }); }
  if (i === 2) p.ellipse(11, 7, 3, 2).fill(ROCK, { mode: 'sphere', light: 0.3 });
  p.finish(0x10141e, 0.6);
  return b;
}

/** The dead moon's sky: stars of three magnitudes, a faint band of nebula, and the Earth hanging cold and blue. */
export function moonBackdrop(): PixelBuffer {
  const b = new PixelBuffer(SKY_W, SKY_H);
  for (let y = 0; y < SKY_H; y++)
    for (let x = 0; x < SKY_W; x++) {
      let c = gradient([0x010208, 0x02030a, 0x03040c, 0x04060e], y / SKY_H, x, y);
      const band = noise(x, y, 40, 9401) * 0.6 + noise(x, y, 14, 9402) * 0.4;
      const along = Math.abs((y - 30) - (x - 20) * 0.32) / 40;
      const k = Math.max(0, band - 0.45) * Math.max(0, 1 - along) * 1.6;
      if (k > 0 && bayer(x, y) < k * 1.4) c = mix(c, k > 0.3 ? 0x2a1a48 : 0x141c3a, 0.6);
      b.set(x, y, c);
    }
  const r = rng(9403);
  for (let k = 0; k < 300; k++) {
    const x = Math.floor(r() * SKY_W), y = Math.floor(r() * SKY_H);
    const m = r();
    const c = m > 0.97 ? 0xffffff : m > 0.85 ? 0xd8e0ff : m > 0.6 ? 0x9aa4c8 : 0x5a6488;
    b.set(x, y, c);
    if (m > 0.985) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) b.set(x + dx, y + dy, 0x9aa8d8);
  }
  // the Earth: oceans, continents and cloud, lit from the right, a thin atmosphere on the lit limb
  const ex = 196, ey = 46, er = 17;
  for (let y = ey - er - 3; y <= ey + er + 3; y++)
    for (let x = ex - er - 3; x <= ex + er + 3; x++) {
      const dx = (x + 0.5 - ex) / er, dy = (y + 0.5 - ey) / er;
      const d = Math.hypot(dx, dy);
      if (d > 1.12) continue;
      if (d > 1) { if (dx > -0.2 && bayer(x, y) < (1.12 - d) * 7) b.set(x, y, 0x5aa0e8); continue; }
      const z = Math.sqrt(1 - d * d);
      const light = dx * 0.75 - dy * 0.25 + z * 0.55;
      const land = noise(x * 1.1 + 3, y * 1.3, 6, 9404) > 0.58;
      const cloud = noise(x * 1.6, y * 2.2, 4, 9405) > 0.62;
      let c = cloud ? 0xf0f6ff : land ? (dy < -0.7 || dy > 0.75 ? 0xe8f0f8 : noise(x, y, 3, 9406) > 0.5 ? 0x4a7a3a : 0x8a7448) : 0x2a5ab0;
      const shade = Math.max(0, Math.min(1, light + 0.15 + (bayer(x, y) - 0.5) * 0.25));
      c = shade < 0.18 ? mix(0x02040a, c, 0.08) : shade < 0.35 ? mix(0x050a18, c, 0.45) : shade > 0.9 ? mix(c, 0xffffff, 0.2) : c;
      b.set(x, y, c);
    }
  return b;
}

/** A four-point sparkle for twinkling stars (white; tinted at runtime). */
export function moonStar(): PixelBuffer {
  const b = new PixelBuffer(5, 5);
  b.set(2, 2, 0xffffff);
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]] as const) b.set(x, y, 0xffffff, 170);
  for (const [x, y] of [[0, 2], [4, 2], [2, 0], [2, 4]] as const) b.set(x, y, 0xffffff, 70);
  return b;
}

export const SKY_KEYS = { sky: 'sky:backdrop', cloud: 'sky:cloud', underside: 'sky:underside', islet: 'sky:islet', moon: 'moon:backdrop', star: 'moon:star' } as const;
