import * as Phaser from 'phaser';
import type { DungeonRenderer } from './DungeonRenderer';
import type { Juice } from './Juice';
import { gfx, type GfxTier } from '../gfx';

// Death animations by killing damage type (presentation only). The foe's own sprite frame becomes a puppet that is
// tinted, sliced and scattered: fire chars it black and crumbles it top-down into embers and ash; frost encases it in
// ice and shatters it into shards; storm flashes it between a white-hot silhouette and a black x-ray, then crackles it
// out into a line of light; decay melts it into a puddle; astral dissolves it upward into motes; physical topples it
// like a ragdoll and fades the body into the floor as a dim corpse. CombatScene keeps the shared death burst (impact
// flash, light, gore, class flourish) and hands the body here.
//
// Cost: puppets, ice shells and slices are pooled; how many full sequences run at once and how many pieces a body breaks
// into follow the graphics tier, and past that budget (or with reduced effects) a death plays the lite version (tint,
// scale and fade, no slices). Every particle burst goes through Juice, so the tier's particle budget applies as well.
// Motion runs on the presentation clock (Juice.clock): hit-stop freezes it, time dilation slows it.

export type DeathStyle = 'burn' | 'shatter' | 'zap' | 'melt' | 'ascend' | 'topple';

/** Killing damage type -> death style (unknown or physical topples). */
export function deathStyle(dtype?: string): DeathStyle {
  switch (dtype) {
    case 'ember': return 'burn';
    case 'frost': return 'shatter';
    case 'storm': return 'zap';
    case 'decay': return 'melt';
    case 'astral': return 'ascend';
    default: return 'topple';
  }
}

/** Full death sequences running at once per tier; deaths beyond it play the lite version. */
const BUDGET: Record<GfxTier, number> = { low: 5, medium: 10, high: 18, ultra: 26 };
/** Shatter grid [cols, rows] and burn crumble strips per tier. */
const SHARDS: Record<GfxTier, [number, number]> = { low: [2, 2], medium: [3, 2], high: [3, 3], ultra: [4, 3] };
const STRIPS: Record<GfxTier, number> = { low: 3, medium: 4, high: 5, ultra: 6 };

/** Per style: full / lite length (ms). */
const LEN: Record<DeathStyle, [number, number]> = { burn: [960, 560], shatter: [780, 460], zap: [640, 420], melt: [1000, 520], ascend: [920, 600], topple: [1750, 1250] };

const CHAR = 0x241a14, EMBER = 0xff8a3a, ICE = 0xa8e8ff, ICE_SHARD = 0xc8f0ff, ICE_SHELL = 0xe0f8ff, XRAY = 0x0e1426, VOLT = 0xeaf6ff, VOLT_GLOW = 0x8fd0ff;
const ROT = 0x9fd84f, ROT_DEEP = 0x3a5a1a, HOLY = 0xe0d0ff, HOLY_GLOW = 0xd7a8ff, CORPSE = 0x8a7c7c;

export interface DeathOpts {
  /** feet (screen px) and the killing blow's screen direction */
  x: number; y: number; ux: number; uy: number;
  /** crit / overkill / elite: bigger bursts */
  big: boolean; elite: number;
  /** the body's resting scale (elites are drawn bigger) and its look tint (stand-in foes), if any */
  scale: number; tint: number | null;
  /** extra cohort bodies and minor deaths: always the lite version */
  lite?: boolean;
}

interface Piece { img: Phaser.GameObjects.Image; x0: number; y0: number; vx: number; vy: number; spin: number; start: number; life: number; sx: number; sy: number; started: boolean }

interface Seq {
  style: DeathStyle; lite: boolean;
  spr: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Image | null;
  pieces: Piece[];
  t0: number; len: number;
  x: number; y: number; ux: number; uy: number;
  big: boolean; sc: number; w: number; h: number;
  /** frame size (px, unscaled) and source flip */
  fw: number; fh: number; flip: boolean;
  stage: number; lastFx: number; side: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function mix(a: number, b: number, k: number): number {
  const t = clamp01(k);
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

export class DeathFx {
  private seqs: Seq[] = [];
  private sprPool: Phaser.GameObjects.Sprite[] = [];
  private slicePool: Phaser.GameObjects.Image[] = [];
  private glowPool: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene, private juice: Juice, private dungeon: DungeonRenderer) {}

  /** Bodies currently animating (tests, debug overlay). */
  get active(): number { return this.seqs.length; }

  /** Take over a fallen foe's body; on true the caller hides its own sprite (false: nothing to animate). */
  play(src: Phaser.GameObjects.Sprite, style: DeathStyle, o: DeathOpts): boolean {
    if (!src.texture || src.texture.key === '__MISSING' || !src.frame) return false;
    const tier = gfx().tier;
    const full = this.seqs.reduce((n, s) => n + (s.lite ? 0 : 1), 0);
    const lite = !!o.lite || this.juice.reduced || full >= (this.juice.low ? Math.ceil(BUDGET[tier] / 2) : BUDGET[tier]);
    const spr = this.sprPool.pop() ?? this.dungeon.litObject(this.scene.add.sprite(0, 0, src.texture.key));
    spr.anims.stop();
    spr.setTexture(src.texture.key, src.frame.name).setOrigin(src.originX, src.originY).setFlipX(src.flipX).setFlipY(false)
      .setPosition(Math.round(o.x), Math.round(o.y)).setScale(o.scale).setRotation(0).setDepth(src.depth).setAlpha(1)
      .setVisible(true).setActive(true).clearTint().setCrop();
    if (o.tint !== null) spr.setTint(o.tint);
    const fw = src.frame.width, fh = src.frame.height;
    const l = Math.hypot(o.ux, o.uy);
    const ux = l > 1e-6 ? o.ux / l : 0, uy = l > 1e-6 ? o.uy / l : 0;
    const seq: Seq = {
      style, lite, spr, glow: null, pieces: [], t0: this.juice.clock, len: LEN[style][lite ? 1 : 0],
      x: Math.round(o.x), y: Math.round(o.y), ux, uy, big: o.big || o.elite > 0, sc: o.scale,
      w: fw * o.scale, h: fh * src.originY * o.scale, fw, fh, flip: src.flipX,
      stage: 0, lastFx: -1e9, side: ux > 0.15 ? 1 : ux < -0.15 ? -1 : (Math.random() < 0.5 ? -1 : 1),
    };
    this.seqs.push(seq);
    this.begin(seq);
    return true;
  }

  /** Drop every running death (round change). */
  clear() { for (const s of this.seqs) this.finish(s, false); this.seqs = []; }

  update() {
    if (!this.seqs.length) return;
    const now = this.juice.clock;
    const keep: Seq[] = [];
    for (const s of this.seqs) {
      const t = now - s.t0;
      if (t >= s.len) { this.finish(s, true); continue; }
      this.step(s, t);
      keep.push(s);
    }
    this.seqs = keep;
  }

  // ---------------------------------------------------------------- per style

  private begin(s: Seq) {
    const J = this.juice;
    const cx = s.x, cy = s.y - s.h * 0.55;
    const k = s.big ? 2 : 1;
    switch (s.style) {
      case 'burn':
        J.starburst(cx, cy, 0xffe0a0, 0.8 + 0.4 * k, 170);
        J.orb(cx, cy, EMBER, 0.6 + 0.3 * k, 240);
        J.embersAt(cx, cy, 8 * k, EMBER);
        break;
      case 'shatter':
        J.bits('ice', cx, cy, 3 * k, 0xd8f6ff);
        if (!s.lite) s.glow = this.shell(s, ICE_SHELL, 0, 1.06);
        break;
      case 'zap':
        s.stage = -1;   // flash counter: the first 45 ms step paints the white-hot frame
        J.starburst(cx, cy, 0xffffff, 0.8 + 0.3 * k, 140);
        J.sparksAt(cx, cy, 6 * k, VOLT_GLOW);
        // the glow sits behind the body, so the dark x-ray frames read as a black silhouette with an electric rim
        if (!s.lite) s.glow = this.shell(s, VOLT_GLOW, 0, 1.14, true);
        break;
      case 'melt':
        J.bits('bubble', cx, cy, 4 * k, ROT);
        J.bits('skull', cx, cy - 6, k, 0xd8f0b0);
        break;
      case 'ascend':
        J.starburst(cx, cy, 0xf0e0ff, 0.8 + 0.3 * k, 180);
        J.beam(s.x, s.y, 110 + 30 * k, 10 + 4 * k, HOLY_GLOW, 420);
        J.bits('star', cx, cy, 4 * k, HOLY_GLOW);
        if (!s.lite) s.glow = this.shell(s, HOLY_GLOW, 0, 1.05);
        break;
      case 'topple':
        break;
    }
  }

  private step(s: Seq, t: number) {
    switch (s.style) {
      case 'burn': return this.burn(s, t);
      case 'shatter': return this.shatter(s, t);
      case 'zap': return this.zap(s, t);
      case 'melt': return this.melt(s, t);
      case 'ascend': return this.ascend(s, t);
      case 'topple': return this.topple(s, t);
    }
  }

  /** Fire: flare hot, char to black, then crumble top-down into embers and ash. */
  private burn(s: Seq, t: number) {
    const J = this.juice;
    const charAt = s.lite ? 240 : 260;
    if (t < charAt) {
      s.spr.setTint(t < 90 ? mix(0xffffff, 0xffa060, t / 90) : mix(0xffa060, CHAR, (t - 90) / (charAt - 90)));
      if (t - s.lastFx > 55) { s.lastFx = t; J.embersAt(s.x + (Math.random() - 0.5) * s.w * 0.6, s.y - Math.random() * s.h, 1, EMBER); }
      return;
    }
    if (s.lite) {
      const k = (t - charAt) / (s.len - charAt);
      s.spr.setTint(CHAR).setAlpha(1 - k).setScale(s.sc, s.sc * (1 - 0.3 * k));
      if (t - s.lastFx > 90) { s.lastFx = t; J.dust(s.x, s.y - s.h * 0.4 * (1 - k), 1, 0x5a5450); }
      return;
    }
    if (s.stage === 0) {
      s.stage = 1;
      const rows = STRIPS[gfx().tier];
      const rh = s.fh / rows;
      for (let i = 0; i < rows; i++) {
        const p = this.slice(s, 0, i * rh, s.fw, rh, CHAR);
        p.start = charAt + i * 70; p.life = 300; p.vx = (Math.random() - 0.5) * 14; p.vy = 6 + Math.random() * 8;
      }
      s.spr.setVisible(false);
    }
    for (const p of s.pieces) {
      const pt = t - p.start;
      if (pt < 0) continue;
      const k = clamp01(pt / p.life);
      if (!p.started) {
        p.started = true;
        J.embersAt(p.x0, p.y0, 2, EMBER);
        J.dust(p.x0, p.y0, 2, 0x5a5450);
      }
      p.img.setPosition(Math.round(p.x0 + p.vx * k), Math.round(p.y0 + p.vy * k + 16 * k * k)).setScale(p.sx, p.sy * (1 - 0.7 * k)).setAlpha(1 - k)
        .setTint(mix(CHAR, 0x5a5450, k));
    }
  }

  /** Frost: freeze into an ice block, then shatter into flying shards. */
  private shatter(s: Seq, t: number) {
    const J = this.juice;
    const freezeAt = s.lite ? 160 : 200;
    if (t < freezeAt) {
      const k = t / freezeAt;
      s.spr.setTint(mix(0xffffff, ICE, k));
      s.glow?.setAlpha(0.55 * k);
      return;
    }
    if (s.lite) {
      const k = (t - freezeAt) / (s.len - freezeAt);
      s.spr.setTint(ICE).setAlpha(1 - k);
      if (s.stage === 0) { s.stage = 1; J.bits('ice', s.x, s.y - s.h * 0.5, s.big ? 8 : 4, 0xd8f6ff); }
      return;
    }
    if (s.stage === 0) {
      s.stage = 1;
      const cx = s.x, cy = s.y - s.h * 0.5;
      J.starburst(cx, cy, 0xffffff, s.big ? 1.6 : 1.1, 160);
      J.bits('ice', cx, cy, s.big ? 16 : 8, 0xd8f6ff);
      J.bits('star', cx, cy, s.big ? 5 : 2, 0xffffff);
      J.ring(s.x, s.y, 18 + (s.big ? 10 : 0), 0xbfeaff, 260);
      this.dungeon.addDecal('ichor', s.x, s.y + 3, 0x9fc8dd, s.big ? 0.8 : 0.55);   // meltwater
      const [cols, rows] = SHARDS[gfx().tier];
      const cw = s.fw / cols, ch = s.fh / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const p = this.slice(s, i * cw, j * ch, cw, ch, ICE_SHARD, false);
        p.img.setTintFill((i + j) % 2 ? ICE_SHARD : ICE);   // frozen through: the pieces are solid ice in the body's shape
        let dx = p.x0 - cx, dy = p.y0 - cy;
        const dl = Math.hypot(dx, dy) || 1;
        dx = dx / dl + s.ux * 0.6; dy = dy / dl * 0.6 + s.uy * 0.4;
        const sp = 70 + Math.random() * 90;
        p.vx = dx * sp; p.vy = dy * sp - 70 - Math.random() * 60; p.spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 7);
        p.start = freezeAt; p.life = 420 + Math.random() * 140;
      }
      s.spr.setVisible(false);
      s.glow?.setVisible(false);
    }
    for (const p of s.pieces) {
      const pt = (t - p.start) / 1000;
      const k = clamp01((t - p.start) / p.life);
      // shards fall back to the floor around the feet (a little depth scatter) and stop spinning there
      const floor = s.y + 2 + ((p.x0 * 7) % 5);
      const y = p.y0 + p.vy * pt + 210 * pt * pt;
      const landed = y >= floor && pt > 0.05;
      p.img.setPosition(Math.round(p.x0 + p.vx * pt * (landed ? 0.8 : 1)), Math.round(landed ? floor : y)).setRotation(landed ? p.img.rotation : p.spin * pt)
        .setAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
    }
  }

  /** Storm: skeleton flash (white-hot silhouette against a black x-ray, twitching), then a crackle-out into light. */
  private zap(s: Seq, t: number) {
    const J = this.juice;
    const flashEnd = s.lite ? 200 : 300;
    if (t < flashEnd) {
      const n = Math.floor(t / 45);
      if (n !== s.stage) {
        s.stage = n;
        const bright = n % 2 === 0;
        if (bright) s.spr.setTintFill(VOLT); else s.spr.setTint(XRAY);
        s.glow?.setVisible(!bright).setAlpha(0.8);
        s.spr.x = s.x + (bright ? 1 : -1);
        if (!s.lite || n % 2 === 0) J.bits('zap', s.x + (Math.random() - 0.5) * s.w * 0.7, s.y - Math.random() * s.h, 1, 0xbfe8ff);
        if (n % 2 === 1) J.sparksAt(s.x, s.y - s.h * (0.3 + Math.random() * 0.5), 2, VOLT_GLOW);
      }
      return;
    }
    const k = clamp01((t - flashEnd) / (s.len - flashEnd));
    s.spr.setTintFill(0xbfe8ff).setX(s.x).setScale(s.sc * (1 - k), s.sc * (1 + 0.15 * k)).setAlpha((0.55 + Math.random() * 0.45) * (1 - k * 0.6));
    s.glow?.setVisible(true).setScale(s.sc * 1.12 * (1 - k), s.sc * 1.12 * (1 + 0.15 * k)).setAlpha(0.6 * (1 - k));
    if (t - s.lastFx > 60) { s.lastFx = t; J.bits('zap', s.x, s.y - s.h * Math.random(), 1, 0xbfe8ff, { angle: -90, spread: 50 }); }
    if (k > 0.92 && s.stage < 1000) {
      s.stage = 1000;
      J.starburst(s.x, s.y - s.h * 0.5, 0xffffff, 0.7, 120);
      this.dungeon.addDecal('scorch', s.x, s.y + 3, 0x101018, 0.5);
    }
  }

  /** Decay: sicken green and melt down into a spreading puddle, bubbling as it goes. */
  private melt(s: Seq, t: number) {
    const J = this.juice;
    const sickAt = s.lite ? 80 : 140;
    if (t < sickAt) { s.spr.setTint(mix(0xffffff, ROT, t / sickAt)); return; }
    const end = s.len - (s.lite ? 120 : 160);
    const k = clamp01((t - sickAt) / (end - sickAt));
    const e = 1 - (1 - k) * (1 - k * 0.5);
    const wob = s.lite ? 0 : Math.sin(t / 38) * 0.04 * (1 - k);
    s.spr.setTint(mix(ROT, ROT_DEEP, k)).setScale(s.sc * (1 + 0.55 * e + wob), s.sc * Math.max(0.06, 1 - 0.94 * e))
      .setAlpha(t < end ? 1 : 1 - (t - end) / (s.len - end));
    if (s.stage === 0 && k > 0.45) {
      s.stage = 1;
      this.dungeon.addDecal('slime', s.x, s.y + 4, ROT_DEEP, s.big ? 1.4 : 1);
    }
    if (!s.lite && t - s.lastFx > 85) {
      s.lastFx = t;
      J.bits('bubble', s.x + (Math.random() - 0.5) * s.w * (0.6 + e), s.y - s.h * (1 - e) * Math.random(), 1, ROT);
    }
  }

  /** Astral: glow lavender, then dissolve feet-first upward into rising motes of light. */
  private ascend(s: Seq, t: number) {
    const J = this.juice;
    const glowAt = s.lite ? 120 : 180;
    if (t < glowAt) {
      const k = t / glowAt;
      s.spr.setTint(mix(0xffffff, HOLY, k));
      s.glow?.setAlpha(0.6 * k);
      return;
    }
    const k = clamp01((t - glowAt) / (s.len - glowAt));
    const lift = 14 * k;
    const keepH = s.fh * (1 - k);
    s.spr.setTint(HOLY).setY(s.y - lift).setCrop(0, 0, s.fw, keepH).setAlpha(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    if (s.glow) s.glow.setY(s.y - lift).setCrop(0, 0, s.fw, keepH).setAlpha(0.6 * (1 - k));
    // the dissolve line sits where the visible body now ends
    const lineY = s.y - lift - s.h + keepH * s.sc * 0.98;
    if (t - s.lastFx > (s.lite ? 90 : 40)) {
      s.lastFx = t;
      J.bits('mote', s.x + (Math.random() - 0.5) * s.w * 0.6, lineY, s.lite ? 1 : 2, 0xf0e0ff);
    }
    if (s.stage === 0 && k > 0.95) { s.stage = 1; J.ring(s.x, s.y, 16, HOLY_GLOW, 260); }
  }

  /** Physical: a ragdoll topple away from the blow with a skid and a bounce, then the body fades into the floor. */
  private topple(s: Seq, t: number) {
    const J = this.juice;
    const fall = 340, bounce = 460, fadeAt = s.len - 600;
    const maxA = 1.45 * s.side;
    const slide = s.big ? 14 : 8;
    let a: number, ox: number, oy: number;
    if (t < fall) {
      const k = t / fall;
      a = maxA * k * k;
      const e = 1 - (1 - k) * (1 - k);
      ox = s.ux * slide * e; oy = s.uy * slide * 0.5 * e - Math.sin(k * Math.PI) * 4;
    } else {
      if (s.stage === 0) { s.stage = 1; J.dust(s.x + s.ux * slide + s.side * s.h * 0.5, s.y + s.uy * slide * 0.5, 3, 0x3a2e28); }
      a = t < bounce ? maxA - s.side * 0.18 * Math.sin(((t - fall) / (bounce - fall)) * Math.PI) : maxA;
      ox = s.ux * slide; oy = s.uy * slide * 0.5;
    }
    s.spr.setRotation(a).setPosition(Math.round(s.x + ox), Math.round(s.y + oy));
    if (t > fadeAt) {
      const k = clamp01((t - fadeAt) / 600);
      s.spr.setAlpha(1 - 0.4 * k).setTint(mix(0xffffff, CORPSE, k));
    }
  }

  // ---------------------------------------------------------------- pieces and pooling

  /** An additive copy of the body (ice shell, x-ray glow, holy light), tinted solid; in front of the body unless `behind`. */
  private shell(s: Seq, color: number, alpha: number, grow: number, behind = false): Phaser.GameObjects.Image {
    const src = s.spr;
    const g = this.glowPool.pop() ?? this.scene.add.image(0, 0, src.texture.key);
    return g.setTexture(src.texture.key, src.frame.name).setOrigin(src.originX, src.originY).setFlipX(src.flipX).setFlipY(false)
      .setPosition(src.x, src.y).setScale(s.sc * grow).setRotation(0).setDepth(src.depth + (behind ? -0.05 : 0.05)).setAlpha(alpha).setTintFill(color)
      .setBlendMode(Phaser.BlendModes.ADD).setVisible(true).setActive(true).setCrop();
  }

  /**
   * One rectangular piece of the body (frame px, unflipped) as its own image, placed exactly where that part of the
   * body is drawn, pivoting on its own centre. Flipped bodies mirror their pieces with a negative x scale.
   */
  private slice(s: Seq, cx: number, cy: number, cw: number, ch: number, tint: number, lit = true): Piece {
    const src = s.spr;
    const img = this.slicePool.pop() ?? this.scene.add.image(0, 0, src.texture.key);
    // charred pieces take the room's light like the body did; ice keeps its own pale glint (unlit)
    if (lit) this.dungeon.litObject(img); else img.resetPipeline();
    const ccx = cx + cw / 2, ccy = cy + ch / 2;
    const dox = src.displayOriginX, doy = src.displayOriginY;
    const x0 = s.x + (s.flip ? s.fw - ccx - dox : ccx - dox) * s.sc;
    const y0 = s.y + (ccy - doy) * s.sc;
    img.setTexture(src.texture.key, src.frame.name).setFlipX(false).setFlipY(false).setCrop(cx, cy, cw, ch).setDisplayOrigin(ccx, ccy)
      .setScale(s.flip ? -s.sc : s.sc, s.sc).setPosition(Math.round(x0), Math.round(y0)).setRotation(0).setAlpha(1).setTint(tint)
      .setDepth(src.depth + 0.01 * (s.pieces.length + 1)).setVisible(true).setActive(true);
    const p: Piece = { img, x0, y0, vx: 0, vy: 0, spin: 0, start: 0, life: 400, sx: s.flip ? -s.sc : s.sc, sy: s.sc, started: false };
    s.pieces.push(p);
    return p;
  }

  private finish(s: Seq, natural: boolean) {
    // a toppled body stays on the floor as a dim corpse; the elemental deaths left their ash, puddle or nothing
    if (natural && s.style === 'topple' && s.spr.visible) {
      const sp = s.spr;
      this.dungeon.stampCorpse(sp.texture.key, sp.frame.name, sp.x, sp.y, sp.originX, sp.originY, sp.flipX, { rotation: sp.rotation, alpha: 0.55, scale: s.sc });
    }
    if (natural && s.style === 'burn') {
      this.dungeon.addDecal('scorch', s.x, s.y + 4, 0x1a1008, s.big ? 1.3 : 0.8);
      this.juice.dust(s.x, s.y - 2, s.big ? 4 : 2, 0x4a4440);
    }
    s.spr.setVisible(false).setActive(false).clearTint().setCrop();
    if (this.sprPool.length < 32) this.sprPool.push(s.spr); else s.spr.destroy();
    if (s.glow) { s.glow.setVisible(false).setActive(false).setCrop(); if (this.glowPool.length < 32) this.glowPool.push(s.glow); else s.glow.destroy(); }
    for (const p of s.pieces) {
      p.img.setVisible(false).setActive(false).setCrop();
      if (this.slicePool.length < 96) this.slicePool.push(p.img); else p.img.destroy();
    }
    s.pieces = [];
  }
}
