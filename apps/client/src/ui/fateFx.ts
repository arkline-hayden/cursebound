// Fate card particles: a tiny pixel particle system drawn into two low-resolution canvases (one behind the cards for
// the ambient motes of each card's dungeon, one in front for bursts, burns and shockwaves). The canvases are 1/ps of
// the viewport and scaled up nearest-neighbour, so every particle is a crisp square on the cards' own pixel grid.
// Capped (MAX particles), allocation-free per frame, paused while the tab is hidden.

import { themePal } from './fateArt';

type Kind = 'ember' | 'bubble' | 'mote' | 'spore' | 'snow' | 'feather' | 'wind' | 'star' | 'glitch' | 'glyph' | 'drip' | 'spark' | 'petal'
  /** landing dust: soft puffs that spread and grow, fine motes, heavier grit that hops and falls */
  | 'puff' | 'dmote' | 'grit';

interface ThemeFx {
  /** ambient kinds with their share of the emission */
  kinds: readonly (readonly [Kind, number])[];
  colors: readonly number[];
  /** ambient particles per second per card at power 1 */
  rate: number;
}

const FX: Record<string, ThemeFx> = {
  catacombs: { kinds: [['ember', 0.8], ['mote', 0.2]], colors: [0xffe08a, 0xffa04a, 0xe0601a, 0x8a3010], rate: 16 },
  flooded: { kinds: [['bubble', 0.65], ['drip', 0.35]], colors: [0x9af4e8, 0x30d0c0, 0x1a8a8a, 0xc8fff4], rate: 14 },
  ossuary: { kinds: [['mote', 1]], colors: [0xd8f6ff, 0xbfe8ff, 0x6ab8ff, 0x3a6a9a], rate: 13 },
  sanctum: { kinds: [['spark', 0.45], ['petal', 0.55]], colors: [0xffc060, 0xff4a30, 0xb02030, 0xfff4c0], rate: 14 },
  fungal: { kinds: [['spore', 1]], colors: [0x40f0b0, 0xff9ae8, 0xb0ffe0, 0x7a50a0], rate: 15 },
  forge: { kinds: [['ember', 1]], colors: [0xfff0a0, 0xffa030, 0xff6010, 0x8a2008], rate: 24 },
  frost: { kinds: [['snow', 1]], colors: [0xffffff, 0xe0f6ff, 0x8ac8ff, 0x5a86aa], rate: 18 },
  sky: { kinds: [['feather', 0.35], ['wind', 0.65]], colors: [0xffffff, 0xfff0c0, 0xffe0a0, 0x8ac8ff], rate: 12 },
  moon: { kinds: [['star', 0.8], ['mote', 0.2]], colors: [0xffffff, 0xcfe4ff, 0x8aa0c8, 0xff4a30], rate: 12 },
  server: { kinds: [['glitch', 0.55], ['glyph', 0.45]], colors: [0x40e8ff, 0xff70f0, 0x50ff9a, 0xc8ffff], rate: 18 },
  courtyard: { kinds: [['mote', 0.6], ['petal', 0.4]], colors: [0xfff0b0, 0xffd070, 0x9ce070, 0xffffff], rate: 10 },
};
const fxOf = (t: string) => FX[t] ?? FX.catacombs!;

const GLYPHS = [0b111101101101111, 0b010110010010111, 0b111001111100111, 0b101101111001001, 0b111100111001111, 0b110101110101110, 0b011100100100011, 0b111010010010010];

const MAX = 640;

/** pixel discs by radius (rows of [dx, dy, width]) for dust puffs */
const PUFF: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 0, 1]],
  [[-1, 0, 3], [0, -1, 1], [0, 1, 1]],
  [[-2, 0, 5], [-1, -1, 3], [-1, 1, 3], [0, -2, 1]],
  [[-3, 0, 7], [-2, -1, 5], [-2, 1, 5], [-1, -2, 3], [-1, 2, 3]],
  [[-4, 0, 9], [-4, -1, 9], [-3, 1, 7], [-3, -2, 7], [-2, 2, 5], [-2, -3, 5], [-1, 3, 3]],
];

interface P {
  on: boolean; front: boolean; kind: Kind;
  x: number; y: number; vx: number; vy: number;
  t: number; life: number; c0: number; c1: number; seed: number; size: number;
}

interface Ring { on: boolean; x: number; y: number; r: number; vr: number; t: number; life: number; c: number }

export interface FxEmitter { theme: string; rect: { left: number; top: number; width: number; height: number }; power: number }

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
function mixHex(a: number, b: number, t: number): number {
  const m = (sh: number) => Math.round(((a >> sh) & 255) + ((((b >> sh) & 255) - ((a >> sh) & 255)) * t));
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

export class FateFx {
  private ps = 2;
  private w = 0;
  private h = 0;
  private pool: P[] = [];
  private rings: Ring[] = [];
  private emitters: FxEmitter[] = [];
  private acc: number[] = [];
  private raf = 0;
  private last = 0;
  private running = false;
  private readonly bctx: CanvasRenderingContext2D | null;
  private readonly fctx: CanvasRenderingContext2D | null;
  /** 0..1 multiplier on ambient emission (reduced effects: 0.5) */
  density = 1;

  constructor(private back: HTMLCanvasElement, private front: HTMLCanvasElement) {
    this.bctx = back.getContext('2d');
    this.fctx = front.getContext('2d');
    for (let i = 0; i < MAX; i++) this.pool.push({ on: false, front: false, kind: 'ember', x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, c0: 0, c1: 0, seed: 0, size: 1 });
    for (let i = 0; i < 12; i++) this.rings.push({ on: false, x: 0, y: 0, r: 0, vr: 0, t: 0, life: 1, c: 0 });
  }

  /** Pixel scale (CSS px per particle pixel): the cards' --ps. */
  setScale(ps: number) { this.ps = Math.max(1, Math.round(ps)); this.resize(); }

  resize() {
    const w = Math.ceil(window.innerWidth / this.ps), h = Math.ceil(window.innerHeight / this.ps);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const c of [this.back, this.front]) { c.width = w; c.height = h; }
  }

  setEmitters(list: FxEmitter[]) {
    this.emitters = list;
    while (this.acc.length < list.length) this.acc.push(Math.random());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (document.hidden) { this.last = 0; return; }
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
      this.last = now;
      this.step(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.bctx?.clearRect(0, 0, this.w, this.h);
    this.fctx?.clearRect(0, 0, this.w, this.h);
  }

  dispose() { this.stop(); this.emitters = []; for (const p of this.pool) p.on = false; }

  /** Stop the clock but keep the current frame on screen (dev frame captures). */
  freeze() { this.running = false; cancelAnimationFrame(this.raf); }

  /** Step the simulation by hand and draw (dev frame captures, deterministic). */
  advance(sec: number) {
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) this.step(sec / n);
    this.draw();
  }

  private spawn(): P | null {
    for (const p of this.pool) if (!p.on) return p;
    return null;
  }

  private emit(kind: Kind, theme: string, x: number, y: number, front: boolean, burst = 0): P | null {
    const p = this.spawn();
    if (!p) return null;
    const f = fxOf(theme), cs = f.colors;
    const r = Math.random;
    p.on = true; p.front = front; p.kind = kind; p.x = x; p.y = y; p.t = 0; p.seed = r() * 100; p.size = 1;
    p.c0 = cs[Math.floor(r() * 2)]!; p.c1 = cs[2 + Math.floor(r() * 2)]!;
    switch (kind) {
      case 'ember': p.vx = (r() - 0.5) * 6; p.vy = -(10 + r() * 16); p.life = 1.2 + r() * 1.4; p.size = r() < 0.15 ? 2 : 1; break;
      case 'bubble': p.vx = (r() - 0.5) * 3; p.vy = -(6 + r() * 8); p.life = 1.6 + r() * 1.6; p.size = r() < 0.4 ? 2 : 1; break;
      case 'mote': p.vx = (r() - 0.5) * 4; p.vy = -(3 + r() * 6); p.life = 2 + r() * 2; break;
      case 'spore': p.vx = (r() - 0.5) * 3; p.vy = -(2 + r() * 5); p.life = 2.6 + r() * 2.4; p.size = r() < 0.3 ? 2 : 1; break;
      case 'snow': p.vx = (r() - 0.3) * 6; p.vy = 6 + r() * 10; p.life = 2.2 + r() * 2; p.size = r() < 0.2 ? 2 : 1; break;
      case 'feather': p.vx = (r() - 0.5) * 4; p.vy = 4 + r() * 4; p.life = 3 + r() * 2; break;
      case 'wind': p.vx = 40 + r() * 40; p.vy = (r() - 0.5) * 2; p.life = 0.5 + r() * 0.5; p.size = 3 + Math.floor(r() * 6); break;
      case 'star': p.vx = 0; p.vy = 0; p.life = 0.8 + r() * 1.4; p.size = r() < 0.3 ? 2 : 1; break;
      case 'glitch': p.vx = 0; p.vy = 0; p.life = 0.12 + r() * 0.3; p.size = 2 + Math.floor(r() * 7); break;
      case 'glyph': p.vx = 0; p.vy = 12 + r() * 10; p.life = 1.4 + r() * 1.2; p.size = Math.floor(r() * GLYPHS.length); p.c0 = 0x50ff9a; p.c1 = 0x1a7a4a; break;
      case 'drip': p.vx = 0; p.vy = 4; p.life = 1.2 + r(); break;
      case 'petal': p.vx = (r() - 0.5) * 6; p.vy = 5 + r() * 6; p.life = 2.4 + r() * 1.6; break;
      case 'spark': {
        const a = burst ? r() * Math.PI * 2 : -Math.PI / 2 + (r() - 0.5) * 1.2;
        const s = burst ? burst * (0.35 + r() * 0.65) : 8 + r() * 12;
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.life = burst ? 0.6 + r() * 0.9 : 1 + r() * 1.2; p.size = r() < 0.25 ? 2 : 1;
        break;
      }
    }
    return p;
  }

  /** A radial burst of the theme's sparks and motes from a rect (CSS px), optionally with shockwave rings. */
  burst(theme: string, rect: { left: number; top: number; width: number; height: number }, n: number, rings = 0, speed = 90) {
    if (!this.running || this.density <= 0) return;
    n = Math.round(n * Math.min(1, this.density));
    const s = this.ps, cx = (rect.left + rect.width / 2) / s, cy = (rect.top + rect.height / 2) / s;
    const f = fxOf(theme);
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - 0.5) * rect.width / s * 0.7, oy = (Math.random() - 0.5) * rect.height / s * 0.7;
      const p = this.emit('spark', theme, cx + ox * 0.3, cy + oy * 0.3, true, speed / 2);
      if (p) { p.c0 = f.colors[Math.floor(Math.random() * 2)]!; p.c1 = f.colors[2 + Math.floor(Math.random() * 2)]!; }
    }
    for (let k = 0; k < rings; k++) {
      const r = this.rings.find((x) => !x.on);
      if (!r) break;
      r.on = true; r.x = cx; r.y = cy; r.r = 4 + k * 6; r.vr = 70 + k * 30; r.t = -k * 0.08; r.life = 0.55; r.c = f.colors[k % 2]!;
    }
  }

  /**
   * A card slapping onto the table (CSS px rect, the card at rest): dust and grit pushed out from under its edges,
   * low and wide, behind the card (the back canvas), so it shows only once it clears the card. The dust is the
   * dungeon's own (its stone, lightened): ash for the forge, powder snow for the frost, regolith for the moon.
   */
  dust(theme: string, rect: { left: number; top: number; width: number; height: number }, n = 190) {
    if (!this.running || this.density <= 0) return;
    n = Math.round(n * Math.min(1, this.density));
    const s = this.ps, L = rect.left / s, T = rect.top / s, W = rect.width / s, H = rect.height / s;
    const st = themePal(theme).stone;
    const light = (c: number, t: number) => mixHex(c, 0xefe4d0, t);
    const cols = [light(st[3]!, 0.55), light(st[4]!, 0.45), light(st[2]!, 0.5), light(st[4]!, 0.7)];
    const r = Math.random;
    const add = (kind: Kind, x: number, y: number, nx: number, ny: number, sp: number, size: number) => {
      const p = this.spawn();
      if (!p) return;
      // out from under the edge, fanned along it; puffs hug the table, grit kicks up and falls back
      p.on = true; p.front = false; p.kind = kind; p.x = x; p.y = y; p.t = 0; p.seed = r() * 100; p.size = size;
      const fan = (r() - 0.5) * sp * 1.1;
      p.vx = nx * sp + (nx === 0 ? fan : fan * 0.25);
      p.vy = ny * sp + (ny === 0 ? fan * 0.25 : 0) - (kind === 'grit' ? 45 + r() * 55 : 0);
      p.life = kind === 'puff' ? 0.55 + r() * 0.6 : kind === 'dmote' ? 0.45 + r() * 0.5 : 0.45 + r() * 0.35;
      p.c0 = cols[Math.floor(r() * cols.length)]!; p.c1 = cols[Math.floor(r() * 3)]!;
      if (kind === 'grit') { p.c0 = light(st[2]!, 0.25); p.c1 = st[3]!; }
    };
    for (let i = 0; i < n; i++) {
      // a radial ring of dust pushed out from under all four edges (a little more along the bottom, where it slapped)
      const e = r();
      let x: number, y: number, nx = 0, ny = 0;
      if (e < 0.34) { x = L + r() * W; y = T + H - 1 - r() * 2; ny = 1; }
      else if (e < 0.58) { x = L + 1 + r() * 2; y = T + r() * H; nx = -1; }
      else if (e < 0.82) { x = L + W - 1 - r() * 2; y = T + r() * H; nx = 1; }
      else { x = L + r() * W; y = T + 1 + r() * 2; ny = -1; }
      const roll = r();
      const kind: Kind = roll < 0.62 ? 'puff' : roll < 0.84 ? 'dmote' : 'grit';
      const sp = kind === 'puff' ? 40 + r() * 70 : kind === 'dmote' ? 70 + r() * 120 : 45 + r() * 80;
      add(kind, x, y, nx, ny, sp, kind === 'puff' ? 1 + Math.floor(r() * 2) : 1);
    }
    // the air escapes hardest at the corners: big billows there
    for (const [cx, cy, nx, ny] of [[L, T + H, -0.7, 0.7], [L + W, T + H, 0.7, 0.7], [L, T, -0.7, -0.7], [L + W, T, 0.7, -0.7]] as const) {
      for (let k = 0; k < Math.round(7 * Math.min(1, this.density)); k++) add('puff', cx - nx * 2, cy - ny * 2, nx, ny, 50 + r() * 60, 2);
    }
  }

  /** Embers rising off a card as it burns away (CSS px rect), in its own theme's colours. */
  burn(theme: string, rect: { left: number; top: number; width: number; height: number }, n: number) {
    if (!this.running || this.density <= 0) return;
    n = Math.round(n * Math.min(1, this.density));
    const s = this.ps;
    for (let i = 0; i < n; i++) {
      const p = this.emit('ember', theme, (rect.left + Math.random() * rect.width) / s, (rect.top + rect.height * (0.3 + Math.random() * 0.7)) / s, true);
      if (p) { p.vy *= 1.4; p.life *= 0.8; }
    }
  }

  private step(dt: number) {
    const s = this.ps;
    // ambient emission around each card
    this.emitters.forEach((e, idx) => {
      const f = fxOf(e.theme);
      this.acc[idx] = (this.acc[idx] ?? 0) + f.rate * e.power * this.density * dt;
      while (this.acc[idx]! >= 1) {
        this.acc[idx]! -= 1;
        let roll = Math.random(), kind: Kind = f.kinds[0]![0];
        for (const [k, w] of f.kinds) { if (roll < w) { kind = k; break; } roll -= w; }
        const L = e.rect.left / s, T = e.rect.top / s, W = e.rect.width / s, H = e.rect.height / s;
        const r = Math.random;
        let x: number, y: number;
        switch (kind) {
          case 'snow': case 'feather': case 'drip': case 'glyph': case 'petal':
            x = L - 6 + r() * (W + 12); y = T - 10 - r() * 14; break;
          case 'wind': x = L - 30 - r() * 20; y = T + r() * H; break;
          case 'star': case 'glitch': {
            const side = r();
            if (side < 0.5) { x = side < 0.25 ? L - 4 - r() * 18 : L + W + 4 + r() * 18; y = T - 10 + r() * (H + 20); }
            else { x = L - 10 + r() * (W + 20); y = side < 0.75 ? T - 6 - r() * 18 : T + H + 4 + r() * 14; }
            break;
          }
          default: {
            // rise from the bottom edge and up the sides
            const side = r();
            if (side < 0.5) { x = L + r() * W; y = T + H + r() * 6; }
            else { x = side < 0.75 ? L - 2 - r() * 8 : L + W + 2 + r() * 8; y = T + H * (0.3 + r() * 0.7); }
          }
        }
        this.emit(kind, e.theme, x, y, false);
      }
    });
    for (const p of this.pool) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life || p.x < -40 || p.y < -40 || p.x > this.w + 40 || p.y > this.h + 40) { p.on = false; continue; }
      const u = p.t;
      switch (p.kind) {
        case 'ember': p.vy -= 6 * dt; p.vx += Math.sin(u * 5 + p.seed) * 10 * dt; break;
        case 'bubble': p.vx = Math.sin(u * 4 + p.seed) * 4; p.vy -= 2 * dt; break;
        case 'mote': p.vx = Math.sin(u * 1.6 + p.seed) * 4; break;
        case 'spore': p.vx = Math.sin(u * 1.1 + p.seed) * 6; break;
        case 'snow': p.vx += Math.sin(u * 2 + p.seed) * 6 * dt; break;
        case 'feather': p.vx = Math.sin(u * 1.8 + p.seed) * 10; break;
        case 'petal': p.vx = Math.sin(u * 2.2 + p.seed) * 8; break;
        case 'drip': p.vy += 60 * dt; break;
        case 'spark': p.vx *= 1 - 2.2 * dt; p.vy = p.vy * (1 - 2.2 * dt) + 14 * dt; break;
        case 'glitch': if (Math.random() < dt * 8) { p.x += (Math.random() - 0.5) * 10; p.y += Math.round((Math.random() - 0.5) * 4); } break;
        case 'puff': p.vx *= 1 - 4.8 * dt; p.vy *= 1 - 4.8 * dt; break;
        case 'dmote': p.vx *= 1 - 4 * dt; p.vy = p.vy * (1 - 4 * dt) + 6 * dt; break;
        case 'grit': p.vx *= 1 - 1.5 * dt; p.vy += 320 * dt; break;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (const r of this.rings) {
      if (!r.on) continue;
      r.t += dt;
      if (r.t >= r.life) { r.on = false; continue; }
      if (r.t > 0) r.r += r.vr * dt;
    }
  }

  private draw() {
    const b = this.bctx, f = this.fctx;
    if (!b || !f) return;
    b.clearRect(0, 0, this.w, this.h);
    f.clearRect(0, 0, this.w, this.h);
    for (const p of this.pool) {
      if (!p.on) continue;
      const ctx = p.front ? f : b;
      const k = p.t / p.life;
      // alpha in three hard steps (pixel art never fades smoothly)
      const fade = k < 0.12 ? 0.5 : k > 0.82 ? (k > 0.92 ? 0.34 : 0.67) : 1;
      const x = Math.round(p.x), y = Math.round(p.y);
      const col = hex(k < 0.55 ? p.c0 : p.c1);
      ctx.globalAlpha = fade;
      ctx.fillStyle = col;
      switch (p.kind) {
        case 'bubble': {
          if (p.size === 2) { ctx.fillRect(x - 1, y - 2, 2, 1); ctx.fillRect(x - 1, y + 1, 2, 1); ctx.fillRect(x - 2, y - 1, 1, 2); ctx.fillRect(x + 1, y - 1, 1, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 1, 1); }
          else { ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
          break;
        }
        case 'spore': {
          if (p.size === 2) { ctx.globalAlpha = fade * 0.5; ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); ctx.globalAlpha = fade; }
          ctx.fillStyle = '#ffffff'; ctx.globalAlpha = fade * 0.9; ctx.fillRect(x, y, 1, 1);
          ctx.fillStyle = col; ctx.globalAlpha = fade; ctx.fillRect(x + (Math.sin(p.t * 6 + p.seed) > 0 ? 1 : -1), y, 1, 1);
          break;
        }
        case 'snow': {
          if (p.size === 2) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } else ctx.fillRect(x, y, 1, 1);
          break;
        }
        case 'feather': {
          const tilt = Math.sin(p.t * 1.8 + p.seed) > 0;
          ctx.fillRect(x, y, 2, 1); ctx.fillRect(tilt ? x + 2 : x - 1, y + (tilt ? -1 : 1), 1, 1);
          ctx.fillStyle = hex(p.c1); ctx.fillRect(tilt ? x - 1 : x + 2, y + (tilt ? 1 : -1), 1, 1);
          break;
        }
        case 'wind': ctx.globalAlpha = fade * 0.6; ctx.fillRect(x, y, p.size, 1); break;
        case 'star': {
          const tw = Math.sin((p.t / p.life) * Math.PI);
          ctx.globalAlpha = tw > 0.66 ? 1 : tw > 0.33 ? 0.6 : 0.3;
          ctx.fillRect(x, y, 1, 1);
          if (p.size === 2 && tw > 0.66) { ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
          break;
        }
        case 'glitch': ctx.fillRect(x, y, p.size, 1); if (p.size > 4) { ctx.fillStyle = hex(p.c1); ctx.fillRect(x + 1, y + 1, p.size - 2, 1); } break;
        case 'glyph': {
          const g = GLYPHS[p.size % GLYPHS.length]!;
          for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if ((g >> (14 - (gy * 3 + gx))) & 1) ctx.fillRect(x + gx, y + gy, 1, 1);
          break;
        }
        case 'drip': ctx.fillRect(x, y, 1, 2); break;
        case 'puff': {
          // a soft round clump that swells as it spreads and thins out: a pixel disc, translucent in hard steps,
          // a lighter core while it is fresh
          const g = Math.min(4, p.size + (k > 0.2 ? 1 : 0) + (k > 0.5 ? 1 : 0));
          ctx.globalAlpha = k < 0.3 ? 0.62 : k < 0.65 ? 0.4 : 0.2;
          for (const [ox, oy, w] of PUFF[g]!) ctx.fillRect(x + ox, y + oy, w, 1);
          if (k < 0.45) { ctx.fillStyle = hex(mixHex(p.c0, 0xffffff, 0.35)); ctx.fillRect(x - 1, y - 1, 2, 1); }
          break;
        }
        case 'dmote': ctx.globalAlpha = fade * 0.85; ctx.fillRect(x, y, 1, 1); break;
        case 'grit': ctx.fillRect(x, y, 1, 1); break;
        case 'petal': ctx.fillRect(x, y, 2, 1); ctx.fillStyle = hex(p.c1); ctx.fillRect(x + (Math.sin(p.t * 3 + p.seed) > 0 ? 1 : 0), y + 1, 1, 1); break;
        default: ctx.fillRect(x, y, p.size, p.size);
      }
    }
    // shockwave rings: midpoint circles, two pixels thick, in hard alpha steps
    for (const r of this.rings) {
      if (!r.on || r.t < 0) continue;
      const k = r.t / r.life;
      f.globalAlpha = k < 0.5 ? 1 : k < 0.8 ? 0.6 : 0.3;
      f.fillStyle = hex(r.c);
      circle(f, Math.round(r.x), Math.round(r.y), Math.round(r.r));
      f.fillStyle = '#ffffff';
      f.globalAlpha *= 0.6;
      circle(f, Math.round(r.x), Math.round(r.y), Math.round(r.r) - 1);
    }
    b.globalAlpha = 1; f.globalAlpha = 1;
  }
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  if (r <= 0) return;
  let x = r, y = 0, err = 1 - r;
  while (x >= y) {
    for (const [dx, dy] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] as const) ctx.fillRect(cx + dx, cy + dy, 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x) + 1; }
  }
}

/** The theme's light as a CSS colour (flash, rays, outline glow). */
export function themeGlowCss(theme: string): string { return hex(themePal(theme).glow); }
