import * as Phaser from 'phaser';
import { AFFIX_RULES } from '@cursebound/content';
import type { SnapEnemy, Snapshot } from '@cursebound/simulation';
import type { SfxId } from '../audio/AudioEngine';
import type { DungeonRenderer } from './DungeonRenderer';
import type { Juice } from './Juice';
import { iso } from './iso';

// Champion / rare presentation (cosmetic only): a pulsing aura ring and a slowly turning ground sigil in the tier
// colour (blue champions, gold rares), an outline glow, affix-specific particles (molten embers, frost motes, plague
// spores, sparks, blood), the shielding bubble, affix hazards (trails, frost orbs, thunder marks, plague pools, blink
// runes) and the one-shot cues sent by the authority as 'elite' events.

export const ELITE_COLOR: Record<number, { main: number; glow: number; css: string }> = {
  1: { main: 0x5aa8ff, glow: 0x3a8cff, css: '#7cc0ff' },
  2: { main: 0xffc23a, glow: 0xffa818, css: '#ffd36a' },
};

export const AFFIX_TINT: Record<string, number> = {
  fast: 0xfff0a0, strong: 0xff5a4a, molten: 0xff7a2a, frozen: 0x9fe0ff, vampiric: 0xd02040,
  shielding: 0x9fd8ff, thunder: 0xc8e8ff, teleport: 0xc08aff, plagued: 0x8ad04a,
  jailer: 0xb8b0a0, blinding: 0x6a4a9a, venomous: 0x7ad04a, glacial: 0xa8e8ff,
};

/** Hazard kinds this module draws. */
export const ELITE_HAZARDS = new Set(['molten', 'moltenBlast', 'frostOrb', 'thunder', 'plague', 'blink']);

type EliteEvent = { t: 'elite'; id: number; fx: string; x: number; y: number; tx?: number; ty?: number; tier?: number };

export interface EliteCtx {
  sfx(id: SfxId, x?: number, y?: number, priority?: number): void;
  bolt(x0: number, y0: number, x1: number, y1: number, color: number): void;
  /** world distance from the local hero (Infinity when unknown) */
  distMe(x: number, y: number): number;
  reduced: boolean;
}

interface Per { lastFx: number; lastTrail: number; warnUntil: number; glow: boolean }

const T = (sec: number) => Math.round(sec * 60);

export class EliteFx {
  private ground: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private sky: Phaser.GameObjects.Graphics;
  private per = new Map<number, Per>();
  private strikes: { pts: { x: number; y: number }[]; until: number; color: number }[] = [];

  constructor(private scene: Phaser.Scene, private juice: Juice, private dungeon: DungeonRenderer) {
    this.ground = scene.add.graphics().setDepth(-66);
    this.over = scene.add.graphics().setDepth(4520);
    this.sky = scene.add.graphics().setDepth(4710);
  }

  /** Call once per frame before drawing elites. */
  begin(now: number) {
    this.ground.clear(); this.over.clear(); this.sky.clear();
    this.strikes = this.strikes.filter((s) => s.until > now);
    for (const s of this.strikes) {
      this.sky.lineStyle(5, s.color, 0.85).strokePoints(s.pts);
      this.sky.lineStyle(2, 0xffffff, 1).strokePoints(s.pts);
    }
  }

  private state(id: number): Per {
    let p = this.per.get(id);
    if (!p) { p = { lastFx: 0, lastTrail: 0, warnUntil: 0, glow: false }; this.per.set(id, p); }
    return p;
  }

  /** Visual scale bump matching the authority's radius bump. */
  static scaleFor(tier: number | undefined): number { return !tier ? 1 : tier >= 2 ? 1.32 : 1.16; }

  /** Per-frame elite dressing for one visible enemy (ground aura + sigil, glow, particles, bubble). */
  draw(sprite: Phaser.GameObjects.Sprite, e: SnapEnemy, wx: number, wy: number, now: number) {
    const tier = e.el ?? 0;
    if (!tier || e.st === 'dying') return;
    const col = ELITE_COLOR[tier] ?? ELITE_COLOR[1];
    const st = this.state(e.i);
    const { x: px, y: py } = iso.p(wx, wy);
    const R = Math.max(0.55, Math.min(1.6, e.r)) + 0.25;
    const pulse = 1 + 0.07 * Math.sin(now / 210 + e.i);
    // aura: soft filled ellipse and a bright rim
    this.ground.fillStyle(col.glow, 0.13).fillEllipse(px, py, iso.rx(R * pulse) * 2, iso.ry(R * pulse) * 2, 32);
    this.ground.lineStyle(2, col.main, 0.75).strokeEllipse(px, py, iso.rx(R * pulse) * 2, iso.ry(R * pulse) * 2, 40);
    // sigil: a turning star of runes on the ground plane (gold rares turn the other way, with a second ring)
    const n = tier >= 2 ? 6 : 5, step = tier >= 2 ? 2 : 2;
    const rot = (now / (tier >= 2 ? -1300 : 1700)) + e.i;
    const sr = R * 0.82;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i * step * Math.PI * 2) / n;
      pts.push(iso.p(wx + Math.cos(a) * sr, wy + Math.sin(a) * sr));
    }
    this.ground.lineStyle(1, col.main, 0.55 + 0.25 * Math.sin(now / 300 + e.i));
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + step) % n]; this.ground.lineBetween(a.x, a.y, b.x, b.y); }
    if (tier >= 2) this.ground.lineStyle(1, col.main, 0.5).strokeEllipse(px, py, iso.rx(R * 1.18) * 2, iso.ry(R * 1.18) * 2, 40);
    // (the outline itself is the crisp purple-blue pixel rim from render/Outlines.ts; no fuzzy glow here)
    // glacial: the freezing aura's reach, a frost ring on the ground
    if ((e.af ?? []).includes('glacial')) {
      const gr = AFFIX_RULES.glacialRadius;
      this.ground.fillStyle(AFFIX_TINT.glacial, 0.07).fillEllipse(px, py, iso.rx(gr) * 2, iso.ry(gr) * 2, 40);
      this.ground.lineStyle(1, AFFIX_TINT.glacial, 0.55 + 0.2 * Math.sin(now / 260 + e.i)).strokeEllipse(px, py, iso.rx(gr) * 2, iso.ry(gr) * 2, 40);
    }
    // affix particles (rate-limited)
    const J = this.juice;
    const af = e.af ?? [];
    const chest = py - Math.round(sprite.height * sprite.originY * 0.45);
    if (!this.juice.low && now - st.lastFx > 110) {
      st.lastFx = now;
      for (const a of af) {
        const r = Math.random();
        if (a === 'molten' && r < 0.8) J.embersAt(px + (Math.random() - 0.5) * 14, chest + 6, 1, AFFIX_TINT.molten);
        else if (a === 'frozen' && r < 0.6) J.embersAt(px + (Math.random() - 0.5) * 18, chest, 1, AFFIX_TINT.frozen);
        else if (a === 'plagued' && r < 0.5) J.embersAt(px + (Math.random() - 0.5) * 16, py - 4, 1, AFFIX_TINT.plagued);
        else if (a === 'vampiric' && r < 0.25) J.bleed('pursuer', px, chest, 1);
        else if (a === 'thunder' && r < 0.22) J.sparksAt(px + (Math.random() - 0.5) * 12, chest - 6, 2, AFFIX_TINT.thunder);
        else if (a === 'teleport' && r < 0.4) J.embersAt(px + (Math.random() - 0.5) * 16, chest, 1, AFFIX_TINT.teleport);
      }
    }
    if (af.includes('fast') && e.st === 'move' && now - st.lastTrail > 85) { st.lastTrail = now; J.afterimage(sprite, AFFIX_TINT.fast, 0.3, 160); }
    // shielding: shimmer while warning, bubble while invulnerable
    const h = sprite.height * sprite.originY;
    if (e.sh && af.includes('shielding')) {
      const w = Math.max(28, sprite.width * 0.8), hh = h * 1.05;
      const shimmer = 0.5 + 0.3 * Math.sin(now / 90);
      this.over.fillStyle(0x9fd8ff, 0.12 + 0.06 * shimmer).fillEllipse(px, py - h * 0.48, w, hh, 32);
      this.over.lineStyle(2, 0xdff4ff, 0.55 + 0.35 * shimmer).strokeEllipse(px, py - h * 0.48, w, hh, 32);
      this.over.lineStyle(1, 0xffffff, 0.5).strokeEllipse(px, py - h * 0.48 - hh * 0.18, w * 0.55, hh * 0.25, 20);
    } else if (now < st.warnUntil && Math.floor(now / 70) % 2 === 0) {
      this.over.lineStyle(2, 0xdff4ff, 0.7).strokeEllipse(px, py - h * 0.48, Math.max(28, sprite.width * 0.8), h * 1.05, 28);
    }
  }

  /** Draw an affix hazard on the ground layer. Returns false for kinds this module does not own. */
  drawHazard(g: Phaser.GameObjects.Graphics, h: Snapshot['hazards'][number], tick: number, now: number, reduced: boolean): boolean {
    if (!ELITE_HAZARDS.has(h.k)) return false;
    const c = iso.p(h.x, h.y);
    const x = Math.round(c.x), y = Math.round(c.y);
    const ell = (r: number, color: number, alpha: number) => g.fillStyle(color, alpha).fillEllipse(x, y, iso.rx(r) * 2, iso.ry(r) * 2, 32);
    const rim = (r: number, color: number, alpha: number, lw = 2) => g.lineStyle(lw, color, alpha).strokeEllipse(x, y, iso.rx(r) * 2, iso.ry(r) * 2, 32);
    const flick = 0.8 + 0.2 * Math.sin(now / 60 + h.i * 3);
    switch (h.k) {
      case 'molten': {
        const armed = tick >= h.b + 18;
        const fade = Math.min(1, (h.u - tick) / 40);
        ell(h.r, 0xff5a1a, (armed ? 0.34 : 0.14) * fade * flick);
        ell(h.r * 0.55, 0xffc04a, (armed ? 0.35 : 0.1) * fade * flick);
        if (armed && !reduced && !this.juice.low && Math.random() < 0.12) this.juice.embersAt(x + (Math.random() - 0.5) * iso.rx(h.r), y - 2, 1, 0xff8a3a);
        return true;
      }
      case 'moltenBlast': {
        const total = Math.max(1, h.u - 1 - h.b), prog = Math.min(1, (tick - h.b) / total);
        ell(h.r * (0.3 + 0.7 * prog), 0xff6a1a, 0.18 + 0.25 * prog);
        ell(0.35 + 0.25 * Math.sin(now / 50), 0xfff0b0, 0.5 + 0.4 * prog);
        if (!reduced && !this.juice.low && Math.random() < 0.4) this.juice.embersAt(x, y - 8, 1, 0xffa040);
        return true;
      }
      case 'frostOrb': {
        const total = Math.max(1, h.u - 1 - h.b), prog = Math.min(1, (tick - h.b) / total);
        ell(h.r, 0x7fd0ff, 0.1 + 0.12 * prog);
        rim(h.r * (1 - 0.6 * prog), 0xdff6ff, 0.6, 2);
        // the orb itself hovers at chest height and swells before it bursts
        const lift = 14 + 3 * Math.sin(now / 160 + h.i);
        const rr = 4 + 5 * prog;
        g.fillStyle(0x9fe0ff, 0.35).fillCircle(x, y - lift, rr + 4);
        g.fillStyle(0xe8f8ff, 0.95).fillCircle(x, y - lift, rr);
        g.fillStyle(0xffffff, 1).fillRect(x - 1, y - lift - Math.round(rr * 0.5), 2, 2);
        return true;
      }
      case 'thunder': {
        const total = Math.max(1, h.u - 1 - h.b), prog = Math.min(1, (tick - h.b) / total);
        ell(h.r, 0x101828, 0.18 + 0.3 * prog);   // storm shadow gathering
        if (Math.floor(now / 50) % 3 !== 0) {
          g.lineStyle(1, 0xdff0ff, 0.6 + 0.4 * prog);
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2, r1 = iso.rx(h.r) * (0.2 + Math.random() * 0.6);
            g.lineBetween(x, y, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.5);
          }
        }
        return true;
      }
      case 'plague': {
        const arm = h.b + T(AFFIX_RULES.plagueArm);
        if (tick < arm) {
          rim(h.r, 0x8ad04a, 0.5 + 0.3 * Math.sin(now / 80), 1);
          return true;
        }
        const fade = Math.min(1, (h.u - tick) / 45);
        ell(h.r, 0x4a7a1a, 0.34 * fade);
        ell(h.r * 0.7, 0x7a3a8a, 0.22 * fade);
        rim(h.r, 0x9ae05a, 0.45 * fade, 1);
        if (!reduced) for (let i = 0; i < 3; i++) {
          const a = (now / 700 + i * 2.1 + h.i) % (Math.PI * 2), rr = 0.25 + ((now / 400 + i) % 1) * 0.5;
          const q = iso.p(h.x + Math.cos(a) * h.r * rr, h.y + Math.sin(a) * h.r * rr);
          g.fillStyle(0xb8f07a, 0.55 * fade).fillCircle(Math.round(q.x), Math.round(q.y) - 1, 1.5 + (i % 2));
        }
        return true;
      }
      case 'blink': {
        const rot = now / 240;
        rim(h.r, 0xc08aff, 0.8, 2);
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < 4; i++) { const a = rot + (i * Math.PI) / 2; pts.push(iso.p(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r)); }
        g.lineStyle(1, 0xe0c8ff, 0.8);
        for (let i = 0; i < 4; i++) g.lineBetween(pts[i].x, pts[i].y, pts[(i + 2) % 4].x, pts[(i + 2) % 4].y);
        return true;
      }
    }
    return false;
  }

  /** Lightning from the sky onto a screen point. */
  private skyStrike(x: number, y: number, color: number) {
    const pts: { x: number; y: number }[] = [{ x: x + (Math.random() - 0.5) * 30, y: y - 190 }];
    const n = 7;
    for (let i = 1; i < n; i++) pts.push({ x: Math.round(x + (Math.random() - 0.5) * 22), y: Math.round(y - 190 + (190 * i) / n) });
    pts.push({ x, y });
    this.strikes.push({ pts, until: this.scene.time.now + 140, color });
  }

  /** One-shot cues from 'elite' sim events. */
  onEvent(e: EliteEvent, ctx: EliteCtx) {
    const J = this.juice;
    const p = iso.p(e.x, e.y);
    const t = e.tx !== undefined && e.ty !== undefined ? iso.p(e.tx, e.ty) : p;
    const near = ctx.distMe(e.tx ?? e.x, e.ty ?? e.y) < 5;
    switch (e.fx) {
      case 'spawn': {
        const col = ELITE_COLOR[e.tier ?? 1] ?? ELITE_COLOR[1];
        J.ring(p.x, p.y, iso.rx(2.4), col.main, 520);
        J.ring(p.x, p.y, iso.rx(1.4), 0xffffff, 300);
        J.embersAt(p.x, p.y - 14, 18, col.main);
        this.dungeon.flashLight(p.x, p.y - 12, 220, col.main, 2.2, 600);
        break;   // the named callout is raised by the scene once the snapshot knows the elite
      }
      case 'molten_arm':
        J.ring(p.x, p.y, iso.rx(AFFIX_RULES.moltenBlastRadius), 0xff7a2a, 500);
        J.embersAt(p.x, p.y - 10, 14, 0xff8a3a);
        ctx.sfx('telegraph_warn', e.x, e.y, 2);
        break;
      case 'molten_blast':
        J.ring(p.x, p.y, iso.rx(AFFIX_RULES.moltenBlastRadius), 0xffa040, 380);
        J.ring(p.x, p.y, iso.rx(AFFIX_RULES.moltenBlastRadius * 0.6), 0xffffff, 240);
        J.embersAt(p.x, p.y - 8, 26, 0xff8a3a);
        J.dust(p.x, p.y, 10, 0x3a2418);
        J.impact(p.x, p.y - 12, 0xffc070, 2.4);
        this.dungeon.flashLight(p.x, p.y - 10, 300, 0xff7a2a, 2.8, 420);
        this.dungeon.addDecal('scorch', p.x, p.y + 2, 0x2a1408, 1.8);
        if (near) J.shake(0.012, 240);
        ctx.sfx('signature_slam', e.x, e.y, 2);
        break;
      case 'frost_cast':
        J.sparksAt(p.x, p.y - 18, 8, 0x9fe0ff);
        ctx.sfx('telegraph_warn', e.tx, e.ty, 1);
        break;
      case 'frost_burst':
        J.sparksAt(p.x, p.y - 12, 14, 0xdff6ff);
        J.ring(p.x, p.y, iso.rx(AFFIX_RULES.frozenRadius), 0x9fe0ff, 300);
        J.embersAt(p.x, p.y - 8, 10, 0xbfeaff);
        this.dungeon.flashLight(p.x, p.y - 10, 160, 0x8fd8ff, 2, 260);
        if (near) J.shake(0.005, 120);
        ctx.sfx('crit', e.x, e.y, 1);
        break;
      case 'shield_warn':
        this.state(e.id).warnUntil = this.scene.time.now + AFFIX_RULES.shieldWarn * 1000;
        J.sparksAt(p.x, p.y - 18, 6, 0xdff4ff);
        break;
      case 'shield_up':
        J.ring(p.x, p.y, iso.rx(1.6), 0xdff4ff, 320);
        this.dungeon.flashLight(p.x, p.y - 14, 160, 0x9fd8ff, 1.8, 300);
        ctx.sfx('shield', e.x, e.y, 1);
        break;
      case 'shield_down':
        J.sparksAt(p.x, p.y - 18, 12, 0xbfe4ff);
        break;
      case 'thunder_mark':
        J.sparksAt(t.x, t.y - 4, 5, 0xdff0ff);
        ctx.sfx('telegraph_warn', e.tx, e.ty, 1);
        break;
      case 'thunder':
        this.skyStrike(p.x, p.y, 0xb8e0ff);
        J.sparksAt(p.x, p.y - 6, 14, 0xdff0ff);
        J.ring(p.x, p.y, iso.rx(AFFIX_RULES.thunderRadius), 0xdff0ff, 220);
        this.dungeon.flashLight(p.x, p.y - 40, 240, 0xc8e8ff, 3, 200);
        if (near) { J.shake(0.008, 140); J.flash(0xc8e8ff, 50); }
        ctx.sfx('skill_arc', e.x, e.y, 2);
        break;
      case 'vamp':
        if (e.tx !== undefined && e.ty !== undefined) ctx.bolt(e.tx, e.ty, e.x, e.y, 0xd02040);
        J.embersAt(p.x, p.y - 16, 6, 0xff3a5a);
        break;
      case 'tele_mark':
        J.ring(t.x, t.y, iso.rx(0.9), 0xc08aff, 400);
        J.embersAt(t.x, t.y - 6, 8, 0xc08aff);
        break;
      case 'tele':
        J.ring(p.x, p.y, iso.rx(1.1), 0xc08aff, 260);
        J.ring(t.x, t.y, iso.rx(1.3), 0xe0c8ff, 320);
        J.sparksAt(t.x, t.y - 14, 10, 0xd8b8ff);
        this.dungeon.flashLight(t.x, t.y - 12, 150, 0xb07aff, 2, 260);
        ctx.sfx('skill_phase', e.tx, e.ty, 1);
        break;
      case 'plague':
        J.embersAt(p.x, p.y - 10, 8, 0x8ad04a);
        break;
    }
  }

  forget(id: number) { this.per.delete(id); }

  destroy() { this.ground.destroy(); this.over.destroy(); this.sky.destroy(); this.per.clear(); }
}
