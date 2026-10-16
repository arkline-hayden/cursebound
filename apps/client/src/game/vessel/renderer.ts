/**
 * Vessel Select stage renderer: a small software renderer that draws the hero lineup into an RGBA buffer at the
 * stage's internal (art) resolution. Every frame:
 *   1. compose  the baked chamber, then plinths, heroes, chains and braziers back to front into an albedo layer,
 *               writing each pixel's floor-plane depth (so effects can pass behind a hero)
 *   2. light    the chamber's static light map plus live lights: brazier flicker, a glow at every unlocked portal,
 *               the chosen hero's spotlight, key light and floor pool, selection flashes
 *   3. combine  albedo x light, posterised into dithered bands on the floor and walls (smooth on the heroes)
 *   4. emissive additive, depth-tested: candles, flames, portal rings, summoning circles, light columns, rims,
 *               class effects and particles
 * The lineup never moves; selection eases a hero a step forward into the spotlight. Framework-free (the React
 * component owns the canvas, the loop and input).
 */
import { buildChamber, chamberArt, chamberArtReady, type Chamber } from './chamber';
import { burstPortal, drawSpecial, dustPuff, emitPortal, newSpecial, Particles, PK, type PortalCtx, type Raster, type SpecialState } from './fx';
import { HERO_FEET, type SlotPos } from './layout';
import { BAYER4, coneLight, newLight, pointLight, type LightBuf } from './light';
import { flavorOf, isVesselClass, type VesselClass } from './palette';
import {
  CHAIN_DARK, CHAIN_LIGHT, PADLOCK, PLINTH_CX, PLINTH_CY, PLINTH_RUNES, PLINTH_RX, PLINTH_RY, PLINTH_SIDE, RING_RX, RING_RY, RUNES,
  brazierSprite, flameFrames, heroArt, heroArtCached, plinthSprite, wolfFrames, type Anim, type Spr,
} from './sprites';

export interface StageSlot {
  /** hero class id ('' for an open party seat) */
  classId: string;
  locked: boolean;
  /** an open party seat: a dormant plinth, no hero */
  empty?: boolean;
}

export interface StageOptions {
  /** cosmetic particle multiplier (graphics tier; 0 with reduced effects) */
  particles: number;
  /** no easing or flourish movement, still heroes, minimal particles */
  reducedMotion: boolean;
  /** animated decor (brazier embers, drifting dust) */
  animatedDecor: boolean;
  /** 0..1.3 static decor density (wall details, dust motes) */
  decor?: number;
}

type AnimName = 'idle' | 'cast' | 'attack';

interface SlotRt {
  def: StageSlot;
  cls: VesselClass | null;
  x: number;
  y: number;
  depth: number;
  /** eased 0..1: selection, hover */
  sel: number;
  hover: number;
  /** party member portal power (0 = idle glow) */
  emph: number;
  /** 0..1 intro ignition */
  ignite: number;
  anim: AnimName;
  frame: number;
  ft: number;
  idleOff: number;
  jiggle: number;
  /** seconds since the selection pulse (Infinity = none) */
  pulse: number;
  /** 0..1 sink into the portal (confirm) */
  sink: number;
  grow: number;
  acc: Record<string, number>;
  special: SpecialState;
}

interface Flourish { i: number; t: number; dur: number; done: (() => void) | null; burst: boolean }

const TAU = Math.PI * 2;
const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);

export class VesselRenderer implements Raster {
  w = 1;
  h = 1;
  /** RGBA output (ImageData layout) */
  pixels = new Uint8ClampedArray(4);
  private albedo = new Uint32Array(1);
  private depth = new Float32Array(1);
  private light: LightBuf = newLight(1, 1);
  private chamber: Chamber | null = null;
  private chamberIso = false;
  private slots: SlotRt[] = [];
  private order: number[] = [];
  private selected = -1;
  private hovered = -1;
  private cx = 0;
  private baseY = 0;
  private reach = 0;
  private arc = 0;
  private t = 0;
  private reveal = 0;
  private sinceStart = 0;
  private lastDt = 1 / 60;
  private emberAcc = 0;
  private gain = 1;
  private flash = 0;
  private fl: Flourish | null = null;
  private readonly ps = new Particles();
  private readonly plinth = plinthSprite(false);
  private readonly plinthDormant = plinthSprite(true);
  private readonly plinthDepth: Float32Array;
  private readonly brazier = brazierSprite();
  private readonly flames = flameFrames();
  private motes: { x: number; y: number; vx: number; vy: number; ph: number }[] = [];
  private opts: StageOptions;

  constructor(opts: StageOptions) {
    this.opts = opts;
    // floor-plane depth of every plinth pixel, relative to the plinth's top centre (top face vs cylinder wall)
    const p = this.plinth;
    this.plinthDepth = new Float32Array(p.w * p.h);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const dx = (x + 0.5 - PLINTH_CX) / PLINTH_RX, dy = (y + 0.5 - PLINTH_CY) / PLINTH_RY;
        const top = dx * dx + dy * dy <= 1;
        const yEdge = PLINTH_CY + PLINTH_RY * Math.sqrt(Math.max(0, 1 - dx * dx));
        this.plinthDepth[y * p.w + x] = (top ? y + 0.5 : yEdge) - PLINTH_CY + PLINTH_SIDE;
      }
  }

  setOptions(o: StageOptions): void {
    const redecorate = (o.decor ?? 1) !== (this.opts.decor ?? 1);
    this.opts = o;
    if (o.particles <= 0) this.ps.clear();
    if (redecorate && this.chamber) this.rebuildChamber();
  }

  /** Size the stage and place the slots (keeps each slot's state when its class is unchanged). */
  layout(w: number, h: number, cx: number, baseY: number, arc: number, pos: readonly SlotPos[], defs: readonly StageSlot[]): void {
    const resized = w !== this.w || h !== this.h;
    if (resized) {
      this.w = w; this.h = h;
      this.pixels = new Uint8ClampedArray(w * h * 4);
      this.albedo = new Uint32Array(w * h);
      this.depth = new Float32Array(w * h);
      this.light = newLight(w, h);
      this.motes = Array.from({ length: Math.round(36 * (this.opts.decor ?? 1)) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2, ph: Math.random() * TAU }));
    }
    const prev = this.slots;
    this.slots = defs.map((def, i) => {
      const p = pos[i] ?? { x: cx, y: baseY, depth: 0 };
      const old = prev[i];
      const cls = isVesselClass(def.classId) ? def.classId : null;
      if (old && old.def.classId === def.classId && old.def.empty === def.empty) {
        old.def = def; old.x = p.x; old.y = p.y; old.depth = p.depth;
        return old;
      }
      return {
        def, cls, x: p.x, y: p.y, depth: p.depth, sel: 0, hover: 0, emph: 0, ignite: old?.ignite ?? (this.reveal >= 1 ? 1 : 0),
        anim: 'idle', frame: 0, ft: 0, idleOff: Math.random() * 1000, jiggle: 0, pulse: Infinity, sink: 0, grow: 0, acc: {}, special: newSpecial(),
      } satisfies SlotRt;
    });
    this.order = this.slots.map((_, i) => i).sort((a, b) => this.slots[a]!.y - this.slots[b]!.y || Math.abs(this.slots[b]!.x - cx) - Math.abs(this.slots[a]!.x - cx));
    const reach = this.slots.reduce((m, s) => Math.max(m, Math.abs(s.x - cx)), 0);
    if (resized || cx !== this.cx || baseY !== this.baseY || reach !== this.reach || arc !== this.arc || !this.chamber) {
      this.cx = cx; this.baseY = baseY; this.reach = reach; this.arc = arc;
      this.rebuildChamber();
    }
    if (this.selected >= this.slots.length) this.selected = -1;
  }

  private rebuildChamber(): void {
    const iso = chamberArtReady() ? chamberArt() : null;
    this.chamber = buildChamber({ w: this.w, h: this.h, cx: this.cx, baseY: this.baseY, reach: this.reach, arc: this.arc, decor: this.opts.decor ?? 1, iso });
    this.chamberIso = !!iso;
  }

  /**
   * Build the next missing asset (the selected hero first, then the chamber art, then the other heroes outward).
   * Returns true while more remain; call it from short timer slices so no single frame stalls.
   */
  warm(): boolean {
    const sel = this.slots[this.selected];
    if (sel?.cls && !heroArtCached(sel.cls)) { heroArt(sel.cls); return true; }
    if (!chamberArtReady()) { chamberArt(); this.rebuildChamber(); return true; }
    if (!this.chamberIso) { this.rebuildChamber(); return true; }
    const rest = this.slots.map((s, i) => ({ s, k: Math.abs(i - Math.max(0, this.selected)) })).sort((a, b) => a.k - b.k);
    for (const { s } of rest) if (s.cls && !heroArtCached(s.cls)) { heroArt(s.cls); return true; }
    if (this.slots.some((s) => s.cls === 'warden')) wolfFrames();
    return false;
  }

  /** Assets for a first frame are in (the selected hero and the chamber art). */
  get ready(): boolean {
    const sel = this.slots[this.selected];
    return this.chamberIso && (!sel?.cls || !!heroArtCached(sel.cls));
  }

  /** Highlight a slot; `pulse` plays its selection flourish (burst, pose, flash; a rattle and dust when locked). */
  select(i: number, pulse: boolean): void {
    if (i === this.selected && !pulse) return;
    this.selected = i;
    const s = this.slots[i];
    if (!s || !pulse || s.def.empty) return;
    if (s.def.locked) {
      s.jiggle = 0.32;
      if (this.opts.particles > 0) dustPuff(this.ctx(s, 0));
      return;
    }
    s.pulse = 0;
    s.grow = Math.min(s.grow, 0.2);
    if (!this.opts.reducedMotion && s.cls) this.play(s, flavorOf(s.cls).flourish);
    if (this.opts.particles > 0 && s.cls) burstPortal(this.ctx(s, 1));
    this.flash = Math.max(this.flash, 0.6);
  }

  hover(i: number | null): void { this.hovered = i ?? -1; }

  /** Party stage: a member's portal burns at `power` (0..1) and a newly ready member strikes their pose. */
  emphasis(i: number, power: number, pose = false): void {
    const s = this.slots[i];
    if (!s) return;
    s.emph = power;
    if (pose && s.cls && !s.def.locked) {
      if (!this.opts.reducedMotion) this.play(s, 'cast');
      s.pulse = 0;
      if (this.opts.particles > 0) burstPortal(this.ctx(s, 0.8), 0.6);
    }
  }

  /** The confirm flourish: the portal flares and the hero steps down into it. `done` fires once at the end (or on skip). */
  flourish(i: number, done: () => void): void {
    const s = this.slots[i];
    if (!s || !s.cls) { done(); return; }
    this.fl = { i, t: 0, dur: this.opts.reducedMotion ? 0.3 : 1.35, done, burst: false };
    if (!this.opts.reducedMotion) this.play(s, 'cast');
    this.flash = 1;
  }

  get flourishing(): boolean { return this.fl !== null && this.fl.done !== null; }

  /** End the confirm flourish now (any key or click skips it). */
  skipFlourish(): void {
    const f = this.fl;
    if (!f?.done) return;
    const d = f.done;
    f.done = null;
    f.t = f.dur;
    d();
  }

  /** Bring a sunk hero back (the run failed to start). */
  resetFlourish(): void {
    this.fl = null;
    for (const s of this.slots) s.sink = 0;
  }

  private play(s: SlotRt, a: AnimName): void { s.anim = a; s.frame = 0; s.ft = 0; }

  private ctx(s: SlotRt, power: number): PortalCtx {
    const off = this.slideOf(s);
    return { cls: s.cls ?? 'vanguard', x: s.x, y: s.y + off, d: s.y + off + PLINTH_SIDE, fy: s.y + off + PLINTH_SIDE, power, density: this.opts.particles, t: this.t, acc: s.acc, ps: this.ps };
  }

  private slideOf(s: SlotRt): number { return Math.round(s.sel * 5); }

  // ------------------------------------------------------------------------------------------------ update

  step(dt: number): void {
    dt = Math.min(0.1, Math.max(0, dt));
    this.lastDt = dt;
    this.t += dt;
    this.sinceStart += dt;
    const rm = this.opts.reducedMotion;
    if (this.ready || this.sinceStart > 1.2) this.reveal = rm ? 1 : Math.min(1, this.reveal + dt / 0.9);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const f = this.fl;
    if (f) {
      f.t += dt;
      const s = this.slots[f.i];
      if (s && !rm) s.sink = Math.max(0, Math.min(1, (f.t - 0.42) / 0.5)) ** 1.6;
      if (s && !f.burst && f.t >= (rm ? 0 : 0.9)) {
        f.burst = true;
        s.pulse = 0;
        this.flash = 1;
        if (this.opts.particles > 0) burstPortal(this.ctx(s, 2), 2.4);
      }
      if (f.t >= f.dur && f.done) { const d = f.done; f.done = null; d(); }
    }
    const sel = this.selected;
    this.slots.forEach((s, i) => {
      const k = Math.abs(i - Math.max(0, sel));
      if (this.reveal > 0) s.ignite = rm ? 1 : Math.min(1, s.ignite + dt * (this.reveal * 3 - k * 0.25 > 0 ? 2.5 : 0));
      const tSel = i === sel ? 1 : 0;
      s.sel = rm ? tSel : ease(s.sel, tSel, 14, dt);
      s.hover = rm ? (i === this.hovered ? 1 : 0) : ease(s.hover, i === this.hovered ? 1 : 0, 16, dt);
      s.jiggle = Math.max(0, s.jiggle - dt);
      s.pulse += dt;
      s.grow = i === sel && !s.def.locked ? Math.min(1, s.grow + dt * 2.2) : Math.max(0, s.grow - dt * 3);
      // animation
      const art = s.cls ? heroArtCached(s.cls) : null;
      if (!art) return;
      const anim = art[s.anim];
      if (rm && s.anim === 'idle' && i !== sel) { s.frame = 0; return; }
      s.ft += dt * 1000;
      const dur = anim.durations[s.frame] ?? 150;
      if (s.ft >= dur) {
        s.ft -= dur;
        s.frame++;
        if (s.frame >= anim.frames.length) {
          if (s.anim === 'idle') s.frame = 0;
          else if (this.fl && this.fl.i === i) s.frame = anim.frames.length - 1;   // hold the raised pose while sinking
          else this.play(s, 'idle');
        }
      }
    });
    // particles: every lit portal emits at its power
    if (this.opts.particles > 0 && this.reveal > 0.3) {
      for (const s of this.slots) {
        const pw = this.powerOf(s);
        if (pw > 0) emitPortal(this.ctx(s, pw), dt);
      }
    }
    // embers climbing off the braziers
    if (this.opts.animatedDecor && !rm && this.opts.particles > 0 && this.chamber) {
      this.emberAcc += dt * 7 * this.opts.particles;
      while (this.emberAcc >= 1) {
        this.emberAcc -= 1;
        const b = this.chamber.braziers[Math.floor(Math.random() * this.chamber.braziers.length)];
        if (b) this.ps.spawn({ kind: PK.Ember, x: b.x + (Math.random() - 0.5) * 8, y: b.y - 6, vx: (Math.random() - 0.5) * 6, vy: -14 - Math.random() * 16, max: 1 + Math.random() * 1.2, col: 0xffd890, col2: 0xd8400a, d: b.y + 16, wob: 2, wobF: 3 + Math.random() * 2 });
      }
    }
    this.ps.step(dt);
    if (this.opts.animatedDecor && !rm) {
      for (const m of this.motes) {
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.y < -2) { m.y = this.h + 2; m.x = Math.random() * this.w; }
        if (m.x < -2) m.x = this.w + 1; else if (m.x > this.w + 2) m.x = -1;
      }
    }
  }

  /** Portal power: the selected unlocked hero 1 (2 while confirming), party members their emphasis, else a trickle. */
  private powerOf(s: SlotRt): number {
    if (s.def.locked || s.def.empty || !s.cls) return 0;
    const i = this.slots.indexOf(s);
    const f = this.fl;
    const base = i === this.selected ? (f && f.i === i ? 1 + Math.min(1, f.t / 0.4) : 1) : s.emph > 0 ? s.emph : 0.12;
    return base * s.ignite * (this.opts.reducedMotion ? 0.35 : 1);
  }

  // ------------------------------------------------------------------------------------------------ raster (emissive)

  add(x: number, y: number, col: number, a: number, d: number): void {
    if (a <= 0.004 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.depth[i]! > d) return;
    const k = a * this.gain, o = i * 4, P = this.pixels;
    P[o] = P[o]! + ((col >> 16) & 255) * k;
    P[o + 1] = P[o + 1]! + ((col >> 8) & 255) * k;
    P[o + 2] = P[o + 2]! + (col & 255) * k;
  }

  sprAdd(s: Spr, x: number, y: number, a: number, d: number, flip = false, tint = 0xffffff, tintAmt = 0): void {
    if (a <= 0.004) return;
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
    for (let yy = s.y0; yy <= s.y1; yy++) {
      const py = y + yy;
      if (py < 0 || py >= this.h) continue;
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const c = s.px[yy * s.w + (flip ? s.w - 1 - xx : xx)]!;
        const ca = c >>> 24;
        if (!ca) continue;
        const px = x + xx;
        if (px < 0 || px >= this.w) continue;
        const i = py * this.w + px;
        if (this.depth[i]! > d) continue;
        const k = (ca / 255) * a * this.gain;
        let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        if (tintAmt > 0) {
          const l = (r * 77 + g * 151 + b * 28) / 256 / 255;
          r += (tr * l * 1.3 - r) * tintAmt; g += (tg * l * 1.3 - g) * tintAmt; b += (tb * l * 1.3 - b) * tintAmt;
        }
        const o = i * 4, P = this.pixels;
        P[o] = P[o]! + r * k; P[o + 1] = P[o + 1]! + g * k; P[o + 2] = P[o + 2]! + b * k;
      }
    }
  }

  sprBlend(s: Spr, x: number, y: number, a: number, d: number, flip = false, lit = 1): void {
    for (let yy = s.y0; yy <= s.y1; yy++) {
      const py = y + yy;
      if (py < 0 || py >= this.h) continue;
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const c = s.px[yy * s.w + (flip ? s.w - 1 - xx : xx)]!;
        const ca = c >>> 24;
        if (!ca) continue;
        const px = x + xx;
        if (px < 0 || px >= this.w) continue;
        const i = py * this.w + px;
        if (this.depth[i]! > d) continue;
        const k = (ca / 255) * a * Math.min(1, this.gain * 1.2);
        const o = i * 4, P = this.pixels;
        P[o] = P[o]! * (1 - k) + ((c >> 16) & 255) * lit * k;
        P[o + 1] = P[o + 1]! * (1 - k) + ((c >> 8) & 255) * lit * k;
        P[o + 2] = P[o + 2]! * (1 - k) + (c & 255) * lit * k;
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, col: number, a: number, d: number): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.add(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), col, a, d);
  }

  /** 1px additive ellipse outline with brightness modulated around it (dashes rotating with `phase`). */
  private ring(cx: number, cy: number, rx: number, ry: number, col: number, a: number, dOff: number, phase = 0, dashes = 0, dashAmt = 0.6): void {
    const steps = Math.ceil(TAU * Math.max(rx, ry) * 1.6);
    let lx = -9999, ly = -9999;
    for (let k = 0; k < steps; k++) {
      const ang = (k / steps) * TAU;
      const x = Math.round(cx + Math.cos(ang) * rx), y = Math.round(cy + Math.sin(ang) * ry);
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      const m = dashes ? 1 - dashAmt + dashAmt * Math.max(0, Math.cos(ang * dashes - phase)) ** 3 : 1;
      this.add(x, y, col, a * m, y + dOff);
    }
  }

  /** Banded soft glow (a halo in additive light). */
  private halo(cx: number, cy: number, rx: number, ry: number, col: number, a: number, d: number | null): void {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dd = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
        if (dd >= 1) continue;
        const v = Math.ceil((1 - dd) * 4) / 4;
        this.add(x, y, col, a * v * v, d ?? y);
      }
  }

  // ------------------------------------------------------------------------------------------------ render

  render(): void {
    const ch = this.chamber;
    if (!ch) return;
    const { w, h } = this;
    const A = this.albedo, D = this.depth, L = this.light;
    A.set(ch.albedo);
    D.fill(-1);
    L.set(ch.light);
    const t = this.t;
    const flick = 0.85 + 0.15 * Math.sin(t * 9.3) * Math.sin(t * 5.1 + 1.3);

    // ---- 1. compose (back to front)
    const braz = ch.braziers.map((b) => ({ ...b, fy: b.y + 15 }));
    let bi = 0;
    const drawBraziersUpTo = (y: number) => {
      while (bi < braz.length && braz[bi]!.fy <= y) { const b = braz[bi]!; this.blitAlbedo(this.brazier, b.x - 8, b.y - 1, () => b.fy, 1); bi++; }
    };
    braz.sort((a, b) => a.fy - b.fy);
    for (const idx of this.order) {
      const s = this.slots[idx]!;
      drawBraziersUpTo(s.y + PLINTH_SIDE);
      const off = this.slideOf(s);
      const py = s.y + off;
      const dormant = s.def.locked || s.def.empty;
      const pl = dormant ? this.plinthDormant : this.plinth;
      const pd = this.plinthDepth;
      this.blitAlbedo(pl, s.x - PLINTH_CX, py - PLINTH_CY, (i) => py + pd[i]!, 1);
      if (s.def.empty || !s.cls) continue;
      const art = heroArtCached(s.cls);
      if (!art) continue;
      const fr = this.frameOf(s, art);
      const sinkPx = Math.round(s.sink * 46);
      const hx = s.x - 24, hy = py - HERO_FEET + sinkPx;
      const hd = py + PLINTH_SIDE;
      this.blitHero(fr, hx, hy, hd, s.def.locked, s.depth, s.sink > 0 ? py + 1 : null);
      if (s.def.locked) this.drawChains(hx, hy, hd + 0.5, s.jiggle);
    }
    drawBraziersUpTo(1e9);

    // ---- 2. live light
    for (const b of ch.braziers) pointLight(L, w, h, b.x, b.y + 6, 60, 42, 0xff8a3a, 0.35 * flick + 0.1);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const off = this.slideOf(s), py = s.y + off;
      if (s.def.empty) continue;
      const fl = s.cls ? flavorOf(s.cls) : null;
      const ign = s.ignite;
      if (s.def.locked || !fl) {
        pointLight(L, w, h, s.x, py - 20, 22, 26, 0x5a6890, (0.35 + s.hover * 0.4 + s.sel * 0.5) * this.reveal);
        if (s.sel > 0.01) coneLight(L, w, h, s.x, py - 160, py + 14, 6, 26, 0x8090c0, 0.7 * s.sel * this.reveal);
        continue;
      }
      const pw = this.powerOf(s);
      const pulse = s.pulse < 0.5 ? 1 - s.pulse / 0.5 : 0;
      pointLight(L, w, h, s.x, py + PLINTH_SIDE, 26 + 30 * s.sel, 13 + 15 * s.sel, fl.light, (0.55 + 0.9 * s.sel + 0.6 * pulse + 0.5 * Math.max(0, pw - 1)) * ign);
      pointLight(L, w, h, s.x, py - 20, 24 + 10 * s.sel, 28 + 12 * s.sel, 0xd8c8b8, (0.42 + 0.3 * s.hover) * (1 - 0.3 * s.sel) * ign * this.reveal);
      if (s.sel > 0.01) {
        pointLight(L, w, h, s.x, py - 18, 40, 46, fl.light, (0.4 + 0.35 * pulse + 0.6 * Math.max(0, pw - 1)) * s.sel * ign);
        coneLight(L, w, h, s.x, py - 170, py + 14, 7, 26, 0xfff0d8, 0.6 * s.sel * this.reveal);
      }
      if (s.emph > 0 && i !== this.selected) pointLight(L, w, h, s.x, py, 40, 22, fl.light, 0.6 * s.emph * ign);
    }

    // ---- 3. combine (albedo x light; dithered bands on the scenery, smooth on the actors)
    const P = this.pixels;
    const scale = this.reveal * (1 + this.flash * 0.18);
    for (let y = 0, i = 0; y < h; y++) {
      const brow = (y & 3) << 2;
      for (let x = 0; x < w; x++, i++) {
        const c = A[i]!;
        let lr = L[i * 3]! * scale, lg = L[i * 3 + 1]! * scale, lb = L[i * 3 + 2]! * scale;
        if (D[i]! < 0) {
          const th = BAYER4[brow | (x & 3)]!;
          lr = Math.floor(lr * 6 + th) / 6; lg = Math.floor(lg * 6 + th) / 6; lb = Math.floor(lb * 6 + th) / 6;
        } else {
          // actors: a soft shoulder so a hero in the spotlight stays coloured instead of blowing out to white
          if (lr > 1) lr = 1 + (lr - 1) / (1 + (lr - 1) * 1.6);
          if (lg > 1) lg = 1 + (lg - 1) / (1 + (lg - 1) * 1.6);
          if (lb > 1) lb = 1 + (lb - 1) / (1 + (lb - 1) * 1.6);
        }
        const o = i * 4;
        P[o] = ((c >> 16) & 255) * lr;
        P[o + 1] = ((c >> 8) & 255) * lg;
        P[o + 2] = (c & 255) * lb;
        P[o + 3] = 255;
      }
    }

    // ---- 4. emissive
    this.gain = this.reveal;
    const E = ch.emissive;
    const cf = 0.8 + 0.2 * flick;
    for (let i = 0; i < E.length; i++) {
      const e = E[i]!;
      if (!e || D[i]! >= 0) continue;
      const o = i * 4;
      P[o] = P[o]! + ((e >> 16) & 255) * cf * this.gain; P[o + 1] = P[o + 1]! + ((e >> 8) & 255) * cf * this.gain; P[o + 2] = P[o + 2]! + (e & 255) * cf * this.gain;
    }
    for (const b of ch.braziers) {
      const fr = this.flames[Math.floor(t * 10 + b.x) % this.flames.length]!;
      this.sprAdd(fr, b.x - 7, b.y - 17, 0.95, b.y + 16);
      this.halo(b.x, b.y - 6, 12, 10, 0xff8a3a, 0.22 * flick, b.y + 16);
    }
    if (this.opts.animatedDecor && !this.opts.reducedMotion) {
      for (const m of this.motes) this.add(Math.round(m.x), Math.round(m.y), 0xc8b8a0, 0.1 + 0.08 * Math.sin(t * 2 + m.ph), -0.5);
    }
    this.drawLeyLine();
    for (const idx of this.order) this.drawPortal(this.slots[idx]!, idx);
    this.ps.draw(this, t);
    this.gain = 1;
  }

  private frameOf(s: SlotRt, art: { idle: Anim; cast: Anim; attack: Anim }): Spr {
    const a = art[s.anim];
    if (s.anim === 'idle' && s.frame === 0 && s.ft === 0 && this.opts.reducedMotion) return a.frames[0]!;
    const n = a.frames.length;
    if (s.anim === 'idle' && this.slots[this.selected] !== s && !this.opts.reducedMotion) {
      // unselected heroes breathe on their own clocks
      const total = a.durations.reduce((p, q) => p + q, 0);
      let tt = (this.t * 1000 + s.idleOff) % total, k = 0;
      while (k < n - 1 && tt >= a.durations[k]!) { tt -= a.durations[k]!; k++; }
      return a.frames[k]!;
    }
    return a.frames[Math.min(n - 1, s.frame)]!;
  }

  private blitAlbedo(s: Spr, x: number, y: number, depthAt: (i: number) => number, dim: number): void {
    const { w, h } = this;
    for (let yy = s.y0; yy <= s.y1; yy++) {
      const py = y + yy;
      if (py < 0 || py >= h) continue;
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const si = yy * s.w + xx;
        const c = s.px[si]!;
        const a = c >>> 24;
        if (a < 128) continue;
        const px = x + xx;
        if (px < 0 || px >= w) continue;
        const i = py * w + px;
        this.albedo[i] = dim === 1 ? c | 0xff000000 : 0xff000000 | (((c >> 16) & 255) * dim << 16) | (((c >> 8) & 255) * dim << 8) | ((c & 255) * dim);
        this.depth[i] = depthAt(si);
      }
    }
  }

  private blitHero(s: Spr, x: number, y: number, d: number, locked: boolean, fog: number, clipY: number | null): void {
    const { w, h } = this;
    const f = locked ? 0 : fog * 0.28;
    for (let yy = s.y0; yy <= s.y1; yy++) {
      const py = y + yy;
      if (py < 0 || py >= h) continue;
      if (clipY !== null && py >= clipY) break;
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const c = s.px[yy * s.w + xx]!;
        const a = c >>> 24;
        if (a < 24) continue;
        const px = x + xx;
        if (px < 0 || px >= w) continue;
        const i = py * w + px;
        let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        if (locked) {
          const l = (r * 77 + g * 151 + b * 28) >> 8;
          r = 6 + l * 0.05; g = 6 + l * 0.045; b = 10 + l * 0.07;
        } else if (f > 0) {
          r = r * (1 - f) + 0x1a * f; g = g * (1 - f) + 0x1c * f; b = b * (1 - f) + 0x2c * f;
        }
        if (a >= 200) {
          this.albedo[i] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
          this.depth[i] = d;
        } else {
          const k = a / 255, dc = this.albedo[i]!;
          const rr = ((dc >> 16) & 255) * (1 - k) + r * k, gg = ((dc >> 8) & 255) * (1 - k) + g * k, bb = (dc & 255) * (1 - k) + b * k;
          this.albedo[i] = (0xff000000 | (rr << 16) | (gg << 8) | bb) >>> 0;
          if (a >= 128) this.depth[i] = d;
        }
      }
    }
  }

  /** Iron chains crossed over a locked hero, a padlock where they meet. */
  private drawChains(hx: number, hy: number, d: number, jiggle: number): void {
    const { w, h } = this;
    const put = (x: number, y: number, c: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      this.albedo[i] = c;
      this.depth[i] = d;
    };
    for (const [x0, y0, x1, y1] of [[13, 15, 35, 38], [35, 15, 13, 38]] as const) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(hx + x0 + ((x1 - x0) * k) / n), y = Math.round(hy + y0 + ((y1 - y0) * k) / n);
        put(x, y, k % 3 === 0 ? CHAIN_DARK : CHAIN_LIGHT);
        if (k % 3 === 1) put(x, y - 1, CHAIN_DARK);
      }
    }
    const jx = jiggle > 0 ? Math.round(Math.sin(jiggle * 60)) : 0;
    const lx = hx + 21 + jx, ly = hy + 23;
    const p = PADLOCK;
    for (let yy = 0; yy < p.h; yy++)
      for (let xx = 0; xx < p.w; xx++) {
        const c = p.px[yy * p.w + xx]!;
        if ((c >>> 24) >= 128) put(lx + xx, ly + yy, c | 0xff000000);
      }
  }

  /** Portal ring, summoning circle, light column, rims, class pieces. */
  private drawPortal(s: SlotRt, idx: number): void {
    const off = this.slideOf(s), py = s.y + off;
    const hd = py + PLINTH_SIDE;
    const t = this.t;
    const art = s.cls ? heroArtCached(s.cls) : null;
    if (s.def.empty) return;
    if (s.def.locked || !s.cls) {
      // dormant: a faint cold rim on the silhouette, brighter on hover
      if (art) this.rim(this.frameOf(s, art), s.x - 24, py - HERO_FEET, hd, 0x8a9ac0, 0.32 + 0.4 * s.hover + 0.5 * s.sel, 0x4a5878, 0.18 + 0.2 * s.hover + 0.3 * s.sel);
      if (art && s.hover > 0.05) this.outline(this.frameOf(s, art), s.x - 24, py - HERO_FEET, hd, 0xa8b4d0, 0.35 * s.hover);
      if (s.sel > 0.02 && !s.def.empty) {
        // highlighted but sealed: a cold, broken summoning circle that will not light, and a thin grey beam
        const fy = py + PLINTH_SIDE, a = s.sel * this.reveal;
        const flick = s.jiggle > 0 ? 0.5 + 0.5 * Math.sin(s.jiggle * 50) : 1;
        this.ring(s.x, fy, 31, 15.5, 0x8a9ac0, 0.6 * a * flick, 0.01, 1.3, 5, 0.75);
        this.ring(s.x, fy, 25, 12.5, 0x6a7898, 0.45 * a * flick, 0.01, -0.7, 3, 0.75);
        this.ring(s.x, py, RING_RX, RING_RY, 0x8a9ac0, 0.45 * a, PLINTH_SIDE + 0.01, 0.4, 4, 0.9);
        for (let y = Math.max(0, py - 170); y < py; y++) {
          const v = (y - (py - 170)) / 170, half = 6 + 14 * v;
          for (let x = Math.floor(s.x - half); x <= Math.ceil(s.x + half); x++) {
            const u = Math.abs(x + 0.5 - s.x) / half;
            if (u > 1 || (1 - u) * 0.9 * v < BAYER4[((y & 3) << 2) | (x & 3)]! * 0.9) continue;
            this.add(x, y, 0xa8b8d8, 0.12 * a, hd - 1);
          }
        }
      }
      return;
    }
    const fl = flavorOf(s.cls);
    const pw = this.powerOf(s);
    const ign = s.ignite;
    if (ign <= 0) return;
    const sel = s.sel, rm = this.opts.reducedMotion;
    const spin = rm ? 0 : t * (1.2 + sel * 1.8 + Math.max(0, pw - 1) * 6);
    const pulse = s.pulse < 0.6 ? s.pulse / 0.6 : 1;

    // rune slots on the plinth face
    for (const ox of PLINTH_RUNES) {
      const x = s.x + ox, yTop = Math.round(py + PLINTH_RY * Math.sqrt(Math.max(0, 1 - (ox / PLINTH_RX) ** 2))) + 2;
      const a = (0.35 + 0.65 * sel + 0.3 * s.hover) * ign * (0.8 + 0.2 * Math.sin(t * 3 + ox));
      for (let k = 0; k < 3; k++) this.add(x, yTop + k, k === 1 ? fl.core : fl.light, a, hd + 20);
    }
    // the carved ring on the plinth top
    const ringA = (0.45 + 0.55 * sel + 0.25 * s.hover + 0.3 * Math.max(0, pw - 1)) * ign;
    this.ring(s.x, py, RING_RX, RING_RY, fl.light, ringA, PLINTH_SIDE + 0.01, spin * 1.5, 3, 0.5);
    this.ring(s.x, py, RING_RX - 1, RING_RY - 1, fl.core, ringA * (0.3 + 0.5 * sel), PLINTH_SIDE + 0.01, -spin * 2, 2, 0.8);
    // inner swirl (two arms) on the plinth top
    if (sel > 0.05 || s.emph > 0) {
      const sa = Math.max(sel, s.emph * 0.7) * ign;
      for (let arm = 0; arm < 2; arm++)
        for (let k = 0; k < 14; k++) {
          const u = k / 14;
          const ang = spin * 2.4 + arm * Math.PI + u * 4.2;
          const x = Math.round(s.x + Math.cos(ang) * (RING_RX - 2) * (1 - u * 0.8)), y = Math.round(py + Math.sin(ang) * (RING_RY - 1) * (1 - u * 0.8));
          this.add(x, y, u > 0.7 ? fl.core : fl.light, sa * (0.25 + 0.5 * u), y + PLINTH_SIDE + 0.01);
        }
    }
    // the hero's own pieces of magic
    const ctx = this.ctx(s, pw);
    if (pw > 0.3 && !rm) drawSpecial(ctx, s.special, this, this.lastDt, s.grow);
    if (sel <= 0.02 && s.emph <= 0) {
      if (art && s.hover > 0.05) this.outline(this.frameOf(s, art), s.x - 24, py - HERO_FEET, hd, fl.light, 0.55 * s.hover);
      return;
    }
    const k = Math.max(sel, s.emph * 0.6);
    const fy = py + PLINTH_SIDE;
    // summoning circle on the floor around the plinth: double ring with orbiting runes
    if (sel > 0.02) {
      const ca = sel * ign;
      this.ring(s.x, fy, 31, 15.5, fl.light, 0.55 * ca, 0.01, spin, 6, 0.5);
      this.ring(s.x, fy, 25, 12.5, fl.light, 0.4 * ca, 0.01, -spin, 4, 0.6);
      for (let r = 0; r < 10; r++) {
        const ang = (r / 10) * TAU - spin * 0.35;
        const x = Math.round(s.x + Math.cos(ang) * 28 - 1), y = Math.round(fy + Math.sin(ang) * 14 - 2);
        this.sprAdd(RUNES[r % RUNES.length]!, x, y, 0.75 * ca, fy + Math.sin(ang) * 14 + 0.01, false, fl.light, 1);
      }
      // selection pulse: a ring racing outward over the floor
      if (pulse < 1) this.ring(s.x, fy, 16 + pulse * 40, 8 + pulse * 20, fl.core, (1 - pulse) * 0.9, 0.01);
    }
    // light column from the portal (behind the hero, with a faint front sheet)
    // on confirm the column swells, then after the flare collapses to a white-hot thread and fades
    const fl2 = this.fl && this.fl.i === idx ? this.fl : null;
    const collapse = fl2 ? Math.max(0, Math.min(1, (fl2.t - 0.95) / 0.35)) : 0;
    const colA = (k * (0.55 + 0.25 * Math.sin(t * 5.3)) + Math.max(0, pw - 1) * 0.8) * ign * (1 - collapse * 0.75);
    if (colA > 0.02) {
      const top = Math.max(0, py - 190);
      const wBase = (11 + Math.max(0, pw - 1) * 8) * (1 - collapse * 0.85);
      for (let y = top; y < py + 1; y++) {
        const v = (y - top) / (py + 1 - top);
        const half = Math.max(1, wBase * (0.6 + 0.4 * v));
        const flow = 0.8 + 0.2 * Math.sin(y * 0.35 + t * 9);
        const fade = (0.5 + 0.5 * v) * flow * colA;
        for (let x = Math.floor(s.x - half); x <= Math.ceil(s.x + half); x++) {
          const u = Math.abs(x + 0.5 - s.x) / half;
          if (u > 1) continue;
          const band = u < 0.16 ? fl.core : u < 0.6 ? fl.light : fl.deep;
          const a = fade * (u < 0.16 ? 0.8 : u < 0.6 ? 0.55 : 0.3);
          this.add(x, y, band, a, hd - 0.5);
          this.add(x, y, band, a * 0.18, hd + 8);
        }
      }
      // a glow around the chosen hero, behind them
      this.halo(s.x, py - 20, 22 + 8 * Math.max(0, pw - 1), 28, fl.light, (0.2 + 0.2 * (1 - pulse)) * k * ign, hd - 0.5);
      // visible spotlight beam in the air
      if (sel > 0.02) {
        for (let y = Math.max(0, py - 170); y < py; y += 1) {
          const v = (y - (py - 170)) / 170;
          const half = 7 + 19 * v;
          for (let x = Math.floor(s.x - half); x <= Math.ceil(s.x + half); x++) {
            const u = Math.abs(x + 0.5 - s.x) / half;
            if (u > 1) continue;
            const th = BAYER4[((y & 3) << 2) | (x & 3)]!;
            if ((1 - u) * 0.9 * v < th * 0.9) continue;
            this.add(x, y, 0xfff0d8, 0.12 * sel, hd - 1);
          }
        }
      }
    }
    // rim light from the column / outline on hover
    if (art) {
      const fr = this.frameOf(s, art);
      const sinkPx = Math.round(s.sink * 46);
      if (s.sink > 0) this.sinkGlow(fr, s.x - 24, py - HERO_FEET + sinkPx, py, hd, fl);
      else this.rim(fr, s.x - 24, py - HERO_FEET, hd, fl.light, 0.5 * k + 0.2 * s.hover, fl.core, 0.25 * k);
      if (s.hover > 0.05 && idx !== this.selected) this.outline(fr, s.x - 24, py - HERO_FEET, hd, fl.light, 0.5 * s.hover);
    }
  }

  /**
   * A faint ley line on the floor through every plinth (the arc of the lineup), brightest around the highlighted
   * hero in their colour: the portals read as one ritual circle.
   */
  private drawLeyLine(): void {
    const n = this.slots.length;
    if (n < 2) return;
    const sel = this.slots[this.selected];
    const col = sel?.cls && !sel.def.locked ? flavorOf(sel.cls).light : 0x8a7a6a;
    const t = this.t;
    for (let i = 0; i < n - 1; i++) {
      const a = this.slots[i]!, b = this.slots[i + 1]!;
      const ay = a.y + this.slideOf(a) + PLINTH_SIDE + 9, by = b.y + this.slideOf(b) + PLINTH_SIDE + 9;
      const steps = Math.max(1, Math.abs(b.x - a.x));
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const x = Math.round(a.x + (b.x - a.x) * u), y = Math.round(ay + (by - ay) * u);
        const dist = sel ? Math.abs(x - sel.x) : 999;
        const near = Math.max(0, 1 - dist / 70);
        const flow = 0.6 + 0.4 * Math.sin(x * 0.4 - t * 4);
        this.add(x, y, near > 0.05 ? col : 0x8a7a6a, (0.12 + 0.5 * near * near * flow) * this.reveal, y + 0.01);
      }
    }
    // the great sigil on the chamber floor behind the lineup, burning faintly in the chosen class's colour
    const gx = this.cx, gy = this.baseY - this.arc - 40, rx = Math.max(60, this.reach * 0.62), ry = rx / 2;
    const spin = this.opts.reducedMotion ? 0 : t * 0.12;
    const ga = (0.16 + 0.05 * Math.sin(t * 1.7)) * this.reveal;
    this.ring(gx, gy, rx, ry, col, ga, 0.01, spin * 3, 8, 0.5);
    this.ring(gx, gy, rx - 7, ry - 3.5, col, ga * 0.8, 0.01, -spin * 3, 6, 0.6);
    this.ring(gx, gy, rx * 0.42, ry * 0.42, col, ga * 0.7, 0.01);
    const pts = Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * TAU + spin; return [Math.round(gx + Math.cos(a) * (rx - 8)), Math.round(gy + Math.sin(a) * (ry - 4))] as const; });
    for (let k = 0; k < 6; k++) { const p = pts[k]!, q = pts[(k + 2) % 6]!; this.line(p[0], p[1], q[0], q[1], col, ga * 0.55, Math.max(p[1], q[1]) + 0.01); }
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * TAU - spin;
      const x = Math.round(gx + Math.cos(a) * (rx - 3.5) - 1), y = Math.round(gy + Math.sin(a) * (ry - 1.75) - 2);
      this.sprAdd(RUNES[k % RUNES.length]!, x, y, ga * 1.2, y + 2, false, col, 1);
    }
  }

  /** Edge light on a silhouette: `col` on top / left edges, `col2` on right edges. */
  private rim(s: Spr, x: number, y: number, d: number, col: number, a: number, col2: number, a2: number): void {
    if (a <= 0.01 && a2 <= 0.01) return;
    for (let yy = s.y0; yy <= s.y1; yy++)
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const e = s.edge[yy * s.w + xx]!;
        if (!e) continue;
        if (e & 3) this.add(x + xx, y + yy, col, a, d);
        else if (e & 4) this.add(x + xx, y + yy, col2, a2, d);
      }
  }

  /** 1px outline just outside a silhouette. */
  private outline(s: Spr, x: number, y: number, d: number, col: number, a: number): void {
    for (let yy = s.y0; yy <= s.y1; yy++)
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const e = s.edge[yy * s.w + xx]!;
        if (!e) continue;
        if (e & 1) this.add(x + xx, y + yy - 1, col, a, d + 0.2);
        if (e & 2) this.add(x + xx - 1, y + yy, col, a, d + 0.2);
        if (e & 4) this.add(x + xx + 1, y + yy, col, a, d + 0.2);
      }
  }

  /** While a hero sinks, the pixels nearest the portal burn white-hot and the rest glow in the class colour. */
  private sinkGlow(s: Spr, x: number, y: number, clipY: number, d: number, fl: { light: number; core: number }): void {
    for (let yy = s.y0; yy <= s.y1; yy++) {
      const py = y + yy;
      if (py >= clipY + 1) break;
      const near = clipY - py;
      const a = near < 3 ? 1 : near < 8 ? 0.55 : 0.18;
      for (let xx = s.x0; xx <= s.x1; xx++) {
        const c = s.px[yy * s.w + xx]!;
        if ((c >>> 24) < 128) continue;
        this.add(x + xx, py, near < 3 ? fl.core : fl.light, a, d + 0.1);
      }
    }
  }
}

