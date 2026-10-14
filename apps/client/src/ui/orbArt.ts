// Diablo-style liquid orb, drawn at native pixel scale into a 64x64 RGBA buffer: an ornate bronze socket on a carved
// stone cradle with iron talons gripping a glass sphere; inside, liquid whose level is the value (0..1) with a
// wobbling pixel surface, rising bubbles, a "recent loss" ghost band, a shield arc and a glass glint.
// Pure buffer code (no DOM), so the HUD component only blits it to a canvas.

import { PAL as P, Px, dither, hash, ramp, type RGB } from './pixelSkin';

export const ORB_W = 64;
export const ORB_H = 64;
const CX = 32, CY = 30, R = 21;

/** Palette key: 'life', a resource style ('mana' | 'resolve') or a class id. Unknown keys derive from an accent. */
export type OrbKind = string;

export interface OrbPalette { liquid: readonly RGB[]; glass: readonly RGB[]; ghost: RGB; foam: RGB }
const RESOLVE: OrbPalette = { liquid: [0x261204, 0x552a06, 0x8e500c, 0xcc8618, 0xf4be40, 0xfff0a0], glass: [0x0a0603, 0x161008, 0x241a0e], ghost: 0xffe2a8, foam: 0xfff6cc };
const MANA: OrbPalette = { liquid: [0x08072a, 0x13105a, 0x262196, 0x463fd2, 0x8480ff, 0xcfcaff], glass: [0x05050f, 0x0b0a1c, 0x16142c], ghost: 0xb8b0ff, foam: 0xe4e0ff };
export const ORB_PALETTES: Record<string, OrbPalette> = {
  life: { liquid: [0x220205, 0x47060e, 0x760c18, 0xa81826, 0xd8383a, 0xff8e76], glass: [0x0a0405, 0x160709, 0x24100f], ghost: 0xe8b0a0, foam: 0xffc2b0 },
  mana: MANA,
  resolve: RESOLVE,
  // per-class resource liquids (classes without an entry derive one from their accent colour)
  vanguard: RESOLVE,                                                                                       // amber resolve
  arcanist: MANA,                                                                                          // violet-blue mana
  duelist: { liquid: [0x1c0210, 0x3e0624, 0x6c0c3c, 0xa4185a, 0xdc3a80, 0xffa0c8], glass: [0x0a0306, 0x16060e, 0x240c18], ghost: 0xf0b0c8, foam: 0xffd0e0 }, // crimson
  hexbinder: { liquid: [0x0c1404, 0x1e2e08, 0x3a520e, 0x62801a, 0x9cbc30, 0xdcf08a], glass: [0x050803, 0x0c1206, 0x18200c], ghost: 0xd0e0a0, foam: 0xeef8c0 }, // sickly green
  artificer: { liquid: [0x041416, 0x08302f, 0x0e5652, 0x1a8a80, 0x48c8b4, 0xc0f4e8], glass: [0x030909, 0x081414, 0x0e2020], ghost: 0xb0e8e0, foam: 0xf0fffa }, // teal steam
};

const hsl2rgb = (h: number, s: number, l: number): RGB => {
  const k = (n: number) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
};
/** Hue/saturation of a #rrggbb colour (lightness discarded). */
function hueSat(hex: string): [number, number] {
  const v = parseInt(hex.replace('#', ''), 16) || 0xc08040;
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d === 0) return [0, 0];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s];
}
/** A liquid ramp in the accent's hue: dark depths to a pale crest, so any class gets a coherent orb. */
export function orbFromAccent(hex: string): OrbPalette {
  const [h, s0] = hueSat(hex), s = Math.max(0.45, Math.min(0.85, s0));
  return {
    liquid: [0.07, 0.15, 0.26, 0.4, 0.58, 0.82].map((l) => hsl2rgb(h, s, l)),
    glass: [0.03, 0.06, 0.1].map((l) => hsl2rgb(h, s * 0.45, l)),
    ghost: hsl2rgb(h, s * 0.6, 0.78), foam: hsl2rgb(h, s * 0.7, 0.9),
  };
}
const derived = new Map<string, OrbPalette>();
export function orbPalette(kind: OrbKind, accent?: string): OrbPalette {
  const named = ORB_PALETTES[kind];
  if (named) return named;
  if (!accent) return RESOLVE;
  let p = derived.get(accent);
  if (!p) { p = orbFromAccent(accent); derived.set(accent, p); }
  return p;
}
/** CSS colour of the liquid's bright tone (used for the plaque label). */
export const orbLabelColor = (p: OrbPalette) => '#' + p.liquid[4].toString(16).padStart(6, '0');

/** Static socket layer: cradle, bronze ring, rivets, crown spikes and talons. Transparent where the glass shows. */
export function buildOrbSocket(): Px {
  const px = new Px(ORB_W, ORB_H);
  // carved stone cradle
  const cradle = new Px(ORB_W, ORB_H);
  for (let y = 44; y < ORB_H; y++) {
    const hw = 13 + (y - 44) * 0.62;
    for (let x = Math.floor(CX - hw); x < Math.ceil(CX + hw); x++) {
      const edge = x <= CX - hw + 0.5 || x >= CX + hw - 1.5 || y === ORB_H - 1;
      const n = hash(x, y, 21);
      let c: RGB;
      if (edge) c = P.K;
      else if (y === 44 || y === 45) c = y === 44 ? P.br4 : P.br2;
      else if (y === 46) c = P.K;
      else if (y === ORB_H - 2) c = P.st1;
      else c = n < 0.15 ? P.st1 : n > 0.9 ? P.st4 : (x < CX ? P.st3 : P.st2);
      cradle.p(x, y, c);
    }
  }
  // engraved rune band on the cradle
  for (let x = CX - 14; x < CX + 14; x++) if (x % 4 !== 0) { cradle.p(x, 57, P.K); cradle.p(x, 58, P.st4); }
  cradle.outline(P.K);
  px.blit(cradle, 0, 0);

  // crown spikes
  const spikes = new Px(ORB_W, ORB_H);
  for (const deg of [-90, -122, -58, 180 + 22, -22]) {
    const a = (deg * Math.PI) / 180, len = deg === -90 ? 9 : deg === -122 || deg === -58 ? 7 : 5;
    for (let r = R + 4; r < R + 4 + len; r += 0.5) {
      const w = (1 - (r - R - 4) / len) * 2.2;
      for (let s = -w; s <= w; s += 0.5) spikes.p(CX + Math.cos(a) * r - Math.sin(a) * s, CY + Math.sin(a) * r + Math.cos(a) * s, s < 0 ? P.br4 : P.br2);
    }
  }
  spikes.outline(P.K);
  px.blit(spikes, 0, 0);

  // bronze ring
  for (let y = 0; y < ORB_H; y++) for (let x = 0; x < ORB_W; x++) {
    const dx = x + 0.5 - CX, dy = y + 0.5 - CY, rr = Math.hypot(dx, dy), t = rr - R;
    if (t < 0 || t >= 5.5) continue;
    const lit = 0.5 - (dx + dy) / (rr * 2.4);
    let c: RGB;
    if (t < 1) c = P.K;
    else if (t < 2) c = P.br1;
    else if (t < 4.5) c = ramp([P.br1, P.br2, P.br3, P.br4, P.br5], lit * 1.1 + (t < 3 ? 0.1 : -0.05), x, y);
    else c = P.K;
    px.p(x, y, c);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 10;
    const x = Math.round(CX + Math.cos(a) * (R + 2.8) - 0.5), y = Math.round(CY + Math.sin(a) * (R + 2.8) - 0.5);
    px.p(x, y, P.br6); px.p(x + 1, y + 1, P.br1);
  }

  return px;
}

export interface OrbState {
  level: number; ghost: number; shield: number; t: number;
  bubbles: { x: number; y: number; v: number }[];
}

export function makeOrbState(level: number): OrbState {
  const bubbles = Array.from({ length: 7 }, (_, i) => ({ x: CX - 14 + ((i * 37) % 28), y: CY + R - ((i * 13) % 30), v: 4 + (i % 3) * 3 }));
  return { level, ghost: level, shield: 0, t: 0, bubbles };
}

/** Advance the simulation (smooth level, ghost drain, bubbles). dt in seconds. */
export function stepOrb(s: OrbState, target: number, shield: number, dt: number) {
  const tgt = Math.max(0, Math.min(1, target || 0));
  s.t += dt;
  s.level += (tgt - s.level) * Math.min(1, dt * 10);
  if (Math.abs(tgt - s.level) < 0.002) s.level = tgt;
  if (s.ghost < s.level) s.ghost = s.level;
  else s.ghost = Math.max(s.level, s.ghost - dt * 0.35);
  s.shield += (Math.max(0, Math.min(1, shield || 0)) - s.shield) * Math.min(1, dt * 8);
  for (const b of s.bubbles) {
    b.y -= b.v * dt;
    const surf = CY + R - s.level * 2 * R;
    if (b.y < surf + 2) { b.y = CY + R - 1 - Math.random() * 6; b.x = CX - 12 + Math.random() * 24; b.v = 3 + Math.random() * 7; }
  }
}

/** Draw the orb into `out` (64x64). `animate` = false freezes the surface wave. */
export function drawOrb(out: Px, socket: Px, s: OrbState, pal: OrbPalette, animate = true) {
  const d = out.d;
  d.fill(0);
  const t = animate ? s.t : 0;
  const lvl = s.level, surfBase = CY + R - lvl * 2 * R, ghostY = CY + R - s.ghost * 2 * R;
  const amp = Math.min(1, lvl * 8, (1 - lvl) * 8);
  for (let y = CY - R - 1; y <= CY + R + 1; y++) for (let x = CX - R - 1; x <= CX + R + 1; x++) {
    const dx = x + 0.5 - CX, dy = y + 0.5 - CY, r2 = dx * dx + dy * dy;
    if (r2 >= R * R) continue;
    const nx = dx / R, ny = dy / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const diffuse = Math.max(0, -0.45 * nx - 0.55 * ny + 0.7 * nz);
    const surf = Math.round(surfBase + amp * (Math.sin(x * 0.42 + t * 2.6) * 0.9 + Math.sin(x * 0.19 - t * 1.7) * 0.7));
    let c: RGB;
    if (y > surf) {
      c = ramp(pal.liquid, 0.08 + diffuse * 0.82 - (1 - nz) * 0.18, x, y);
    } else if (y === surf) {
      c = pal.foam;
    } else if (y > ghostY && s.ghost > lvl + 0.004) {
      c = dither(x, y, 0.55) ? pal.ghost : pal.liquid[2];
    } else {
      c = ramp(pal.glass, diffuse * 0.9, x, y);
    }
    if (y === surf + 1) c = pal.liquid[4];
    out.p(x, y, c);
  }
  // bubbles
  for (const b of s.bubbles) {
    const bx = Math.round(b.x), by = Math.round(b.y);
    if ((bx + 0.5 - CX) ** 2 + (by + 0.5 - CY) ** 2 < (R - 2) ** 2 && by > surfBase + 1) out.p(bx, by, pal.liquid[4], 0.85);
  }
  // shield arc (pale blue-white), clockwise from the top
  if (s.shield > 0.01) {
    const end = -Math.PI / 2 + s.shield * Math.PI * 2;
    for (let y = CY - R; y <= CY + R; y++) for (let x = CX - R; x <= CX + R; x++) {
      const dx = x + 0.5 - CX, dy = y + 0.5 - CY, rr = Math.hypot(dx, dy);
      if (rr < R - 2.2 || rr >= R) continue;
      let a = Math.atan2(dy, dx);
      if (a < -Math.PI / 2) a += Math.PI * 2;
      if (a > end) continue;
      const shimmer = Math.sin(a * 9 - t * 6) > 0.6;
      out.p(x, y, rr > R - 1.1 ? (shimmer ? 0xffffff : 0xd6f0ff) : 0x8fc8ff, rr > R - 1.1 ? 1 : 0.75);
    }
  }
  // glass glint
  for (let k = 0; k < 14; k++) {
    const a = ((200 + k * 3.6) * Math.PI) / 180;
    out.p(CX + Math.cos(a) * (R - 3.6), CY + Math.sin(a) * (R - 3.6), 0xffffff, k < 2 || k > 11 ? 0.45 : 0.85);
  }
  out.rect(CX - 9, CY - 13, 2, 2, 0xffffff, 0.9);
  out.p(CX - 6, CY - 15, 0xffffff, 0.6);
  for (let k = 0; k < 10; k++) {
    const a = ((25 + k * 4) * Math.PI) / 180;
    out.p(CX + Math.cos(a) * (R - 1.8), CY + Math.sin(a) * (R - 1.8), 0xffffff, 0.22);
  }
  out.blit(socket, 0, 0);
}
