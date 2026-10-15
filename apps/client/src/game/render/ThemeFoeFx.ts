import * as Phaser from 'phaser';
import { MINIBOSS_MECHANIC_BY_ID } from '@cursebound/content';
import type { SimEvent, SnapEnemy, Snapshot } from '@cursebound/simulation';
import type { SfxId } from '../audio/AudioEngine';
import { registerHazardFx, registerProjectileFx } from './fx/registry';
import { GORE, type Juice } from './Juice';
import { iso } from './iso';

// Theme foes and named mini-bosses (cosmetic only; simulation ai.ts / minibosses.ts are the authority).
//   Theme foes: projectile looks (wind darts, static bolts, tractor beams, survey lasers, glitch bolts), the Firewall
//   Sentinel's burning quarantine line, gore colours, and cues for the gust shove, hail slam, leap take-off / landing,
//   glitch blinks and bolt impacts ('foe_fx' events).
//   Mini-bosses ('miniboss' events, SnapEnemy.mb / mm / enr): a bigger sprite in a colour variant, a gold crown over
//   the head, a molten-orange aura with a turning rune ring (red and faster when enraged), the special nameplate
//   colour, an announcement banner when found and a victory banner (with the score burst) when slain, plus cues for
//   the slam, summons, ward and enrage.

/** Nameplate / bar / minimap colour of a named mini-boss. */
export const MINIBOSS_CSS = '#ff9a3c';
export const MINIBOSS_COLOR = 0xff9a3c;
/** Sprite scale of a mini-boss (its sim radius is RULES.miniBossRadius x its kind's). */
export const MINIBOSS_SCALE = 1.5;
/** Colour variants (light multiply tints) picked per name, so two mini-bosses of one kind look apart. */
const VARIANTS = [0xffd8a0, 0xffb4a8, 0xc8f0b8, 0xe0c8ff, 0xb8e4ff, 0xfff0a0];

export function miniBossTint(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return VARIANTS[h % VARIANTS.length]!;
}

/** Terse mechanic names for a mini-boss's hover plate ("Ground Slam · Enrage"). */
export function miniBossMechNames(mm: string[] | undefined): string {
  return (mm ?? []).map((m) => MINIBOSS_MECHANIC_BY_ID[m]?.name ?? m).join(' · ');
}

// gore for the theme foes (Juice reads GORE[kind]; absent kinds fall back to the hound's blood)
Object.assign(GORE, {
  harpy: { color: 0x8a1c1c, decal: 'blood', shards: 0x46587e },
  galewisp: { color: 0xa8dcf0, decal: 'ichor', shards: 0xe0f6ff },
  stormhawk: { color: 0x7a1420, decal: 'blood', shards: 0x323c72 },
  cloudgolem: { color: 0xb4bed0, decal: 'ichor', shards: 0x5e5866 },
  mooncrawler: { color: 0x98dc2c, decal: 'slime', shards: 0xa49cb4 },
  moonleaper: { color: 0x3a6aa8, decal: 'ichor', shards: 0x5e6c84 },
  lunarsentry: { color: 0xd8a430, decal: 'ichor', shards: 0xd0d6e0 },
  voidshambler: { color: 0x5418aa, decal: 'ichor', shards: 0xbcbcc4 },
  maintdrone: { color: 0x8ac8ff, decal: 'ichor', shards: 0x4a7280 },
  firewall: { color: 0xff7a1e, decal: 'ichor', shards: 0x343a48 },
  glitchwraith: { color: 0x4ae8ff, decal: 'ichor', shards: 0x141e3a },
  malware: { color: 0x98dc2c, decal: 'slime', shards: 0x6e1a66 },
} satisfies Record<string, { color: number; decal: 'blood' | 'ichor' | 'slime'; shards: number }>);

// ---------------- pixel textures ----------------

function pixelTexture(scene: Phaser.Scene, key: string, rows: string[], col: Record<string, string>) {
  if (scene.textures.exists(key)) return;
  const h = rows.length, w = rows[0]!.length;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  const ctx = t.context;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { const c = col[ch]; if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } }));
  t.refresh();
  t.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

function buildTextures(scene: Phaser.Scene) {
  // wind dart: a pale curl of air
  pixelTexture(scene, 'foe:wind', ['...aa.....', '.aabba....', 'abbccba.aa', 'abcddcbaab', '.aabbcbbba', '...aabbaa.'], { a: '#3a6a8a', b: '#a8dcf0', c: '#e0f6ff', d: '#ffffff' });
  // static bolt: a jagged yellow spark
  pixelTexture(scene, 'foe:staticbolt', ['..a.....a...', '.aba...aba..', 'abcba.abcbaa', '.abcbabcbcba', '..abcbcba.a.', '...aba.a....'], { a: '#8a7a10', b: '#fff060', c: '#ffffff' });
  // tractor beam: a pulsing violet ring of force
  pixelTexture(scene, 'foe:tractor', ['..aaaa..', '.abbbba.', 'abcccdba', 'abcddcba', 'abcddcba', 'abdcccba', '.abbbba.', '..aaaa..'], { a: '#3a1a6a', b: '#9a6aff', c: '#d8c0ff', d: '#ffffff' });
  // survey laser: a short red streak
  pixelTexture(scene, 'foe:laser', ['.aaaaaaaa..', 'abbbbbbbbaa', 'bccccccccbb', 'abbbbbbbbaa', '.aaaaaaaa..'], { a: '#5a0606', b: '#ff3e2e', c: '#ffd0c0' });
  // glitch bolt: a cyan/magenta block of corrupted pixels
  pixelTexture(scene, 'foe:glitchbolt', ['m.aaaa..', '.abbbba.', 'abccccbm', 'abcddcba', 'mabccbba', '.abbbba.', '..aaaa.m'], { a: '#0a4a5a', b: '#4ae8ff', c: '#c0faff', d: '#ffffff', m: '#ff3ad0' });
  // mini-boss crown: gold with three red gems
  pixelTexture(scene, 'mb:crown', ['a...a...a', 'ba.aba.ab', 'bbabbbabb', 'bcbbcbbcb', 'bbbbbbbbb', 'ddddddddd'], { a: '#fff4b0', b: '#f0b23c', c: '#ff3a4a', d: '#6e3a1a' });
}

registerProjectileFx({
  wind: { key: 'foe:wind', color: 0xa8dcf0, trail: 'mote' },
  staticbolt: { key: 'foe:staticbolt', color: 0xfff060, trail: 'zap' },
  tractor: { key: 'foe:tractor', color: 0x9a6aff, trail: 'mote', spin: 240 },
  laser: { key: 'foe:laser', color: 0xff3e2e, trail: 'none' },
  glitchbolt: { key: 'foe:glitchbolt', color: 0x4ae8ff, trail: 'zap' },
});

registerHazardFx({
  // the Firewall Sentinel's quarantine line: a burning band with flickering flame tongues along it
  firewall: (ctx, g, h, tick) => {
    const fade = Math.min(1, (tick - h.b) / 6) * Math.min(1, (h.u - tick) / 15);
    const px = -h.dy * (h.w / 2), py = h.dx * (h.w / 2);
    const pts = [
      ctx.P(h.x + px, h.y + py), ctx.P(h.x + h.dx * h.len + px, h.y + h.dy * h.len + py),
      ctx.P(h.x + h.dx * h.len - px, h.y + h.dy * h.len - py), ctx.P(h.x - px, h.y - py),
    ];
    g.fillStyle(0xb43a0a, 0.3 * fade).fillPoints(pts, true);
    g.lineStyle(1, 0xffc860, 0.85 * fade).strokePoints(pts, true);
    const n = Math.max(2, Math.round(h.len / 0.6));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const q = ctx.P(h.x + h.dx * h.len * t, h.y + h.dy * h.len * t);
      const fl = 3 + ((tick + i * 7) % 6);
      g.fillStyle(0xff7a1e, 0.8 * fade).fillRect(Math.round(q.x) - 1, Math.round(q.y) - fl, 3, fl);
      g.fillStyle(0xfff4c0, 0.9 * fade).fillRect(Math.round(q.x), Math.round(q.y) - fl + 1, 1, 2);
    }
  },
}, { firewall: 0xff7a1e });

type Sfx = (id: SfxId, x?: number, y?: number, priority?: number) => void;

interface Per { lastFx: number }

export class ThemeFoeFx {
  private ground: Phaser.GameObjects.Graphics;
  private crowns = new Map<number, Phaser.GameObjects.Image>();
  private per = new Map<number, Per>();
  private seen = new Set<number>();

  constructor(private scene: Phaser.Scene, private juice: Juice, private sfx: Sfx, private banner: (text: string, tone: 'danger' | 'good' | 'info') => void) {
    buildTextures(scene);
    this.ground = scene.add.graphics().setDepth(-65);
  }

  /** Once per frame before foes are drawn. */
  begin() {
    this.ground.clear();
    this.seen.clear();
  }

  /** Once per frame after foes are drawn: drop crowns of mini-bosses no longer drawn. */
  end() {
    for (const [id, c] of this.crowns) if (!this.seen.has(id)) { c.destroy(); this.crowns.delete(id); this.per.delete(id); }
  }

  /** Per-frame dressing of a named mini-boss: aura + rune ring on the ground, crown over the head, embers. */
  drawMiniBoss(sprite: Phaser.GameObjects.Sprite, e: SnapEnemy, wx: number, wy: number, now: number) {
    if (!e.mb || e.st === 'dying') return;
    this.seen.add(e.i);
    const { x: px, y: py } = iso.p(wx, wy);
    const enr = !!e.enr;
    const col = enr ? 0xff3a2a : MINIBOSS_COLOR;
    const R = Math.max(0.7, Math.min(1.8, e.r)) + 0.35;
    const pulse = 1 + (enr ? 0.12 : 0.07) * Math.sin(now / (enr ? 120 : 230) + e.i);
    const g = this.ground;
    g.fillStyle(col, 0.12).fillEllipse(px, py, iso.rx(R * pulse) * 2, iso.ry(R * pulse) * 2, 36);
    g.lineStyle(2, col, 0.8).strokeEllipse(px, py, iso.rx(R * pulse) * 2, iso.ry(R * pulse) * 2, 44);
    g.lineStyle(1, 0xffe08a, 0.5).strokeEllipse(px, py, iso.rx(R * 1.22) * 2, iso.ry(R * 1.22) * 2, 44);
    // turning rune ticks on the outer ring
    const rot = now / (enr ? 500 : 1100) + e.i;
    for (let i = 0; i < 8; i++) {
      const a = rot + (i / 8) * Math.PI * 2;
      const q = iso.p(wx + Math.cos(a) * R * 1.22, wy + Math.sin(a) * R * 1.22);
      g.fillStyle(0xfff0b0, 0.9).fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 2, 2);
    }
    // the crown floats over the head, bobbing gently
    let crown = this.crowns.get(e.i);
    if (!crown) { crown = this.scene.add.image(0, 0, 'mb:crown').setOrigin(0.5, 1); this.crowns.set(e.i, crown); }
    const top = Math.round(sprite.height * sprite.originY * sprite.scaleY);
    // between the health bar (CombatScene: max(40, top + 2) over the feet) and the nameplate
    crown.setPosition(Math.round(px), Math.round(py - Math.max(40, top + 2) - 2 + Math.sin(now / 300 + e.i))).setScale(2).setDepth(4505).setVisible(sprite.visible);   // 2x pixels: reads at play zoom
    // embers rising off it
    const st = this.per.get(e.i) ?? { lastFx: 0 };
    this.per.set(e.i, st);
    if (!this.juice.low && now - st.lastFx > (enr ? 70 : 140)) {
      st.lastFx = now;
      this.juice.embersAt(px + (Math.random() - 0.5) * 18, py - top * 0.5, 1, col);
    }
  }

  /** Presentation for theme foe cues and mini-boss events. Returns true if handled (the scene skips it then). */
  onEvent(e: SimEvent, me: number, snap: Snapshot | null): boolean {
    const J = this.juice;
    if (e.t === 'miniboss') {
      const q = iso.p(e.x, e.y);
      switch (e.op) {
        case 'awake':
          this.banner(`${e.name} awakens!`, 'danger');
          this.sfx('boss_roar', e.x, e.y, 4);
          J.ring(q.x, q.y, 40, MINIBOSS_COLOR, 420); J.embersAt(q.x, q.y - 18, 18, MINIBOSS_COLOR);
          break;
        case 'slain': {
          const pts = e.pts && e.pts !== '0' ? `  +${e.pts}` : '';
          this.banner(`${e.name} slain!${pts}`, 'good');
          this.sfx('chest_open', e.x, e.y, 4);
          J.ring(q.x, q.y, 48, 0xffe08a, 480); J.ring(q.x, q.y, 30, MINIBOSS_COLOR, 360); J.embersAt(q.x, q.y - 16, 28, 0xffd23f);
          break;
        }
        case 'slam_warn':
          this.sfx('boss_telegraph', e.x, e.y, 2);
          J.embersAt(q.x, q.y - 14, 10, MINIBOSS_COLOR);
          break;
        case 'slam':
          this.sfx('boss_ring', e.x, e.y, 3);
          J.ring(q.x, q.y, iso.rx(e.r ?? 3), MINIBOSS_COLOR, 340); J.ring(q.x, q.y, iso.rx((e.r ?? 3) * 0.6), 0xffffff, 240); J.dust(q.x, q.y, 16, 0x5a4a3a);
          break;
        case 'summon':
          this.sfx('wave_spawn', e.x, e.y, 2);
          J.ring(q.x, q.y, 34, 0xb07aff, 320);
          break;
        case 'enrage':
          J.number(q.x, q.y - 56, 'ENRAGED', '#ff5a3a', 'md');
          J.ring(q.x, q.y, 36, 0xff3a2a, 360); J.embersAt(q.x, q.y - 20, 16, 0xff3a2a);
          break;
        case 'shield':
          this.sfx('shield', e.x, e.y, 2);
          J.number(q.x, q.y - 56, 'WARDED', '#9fd8ff', 'md');
          J.ring(q.x, q.y, 34, 0x9fd8ff, 360);
          break;
      }
      return true;
    }
    if (e.t !== 'foe_fx') return false;
    const q = iso.p(e.x, e.y);
    const r = e.r ?? 1.5;
    switch (e.fx) {
      case 'gust':
        J.ring(q.x, q.y, iso.rx(r), 0xe0f6ff, 300); J.ring(q.x, q.y, iso.rx(r * 0.55), 0xa8dcf0, 220);
        J.dust(q.x, q.y, 10, 0x8aa4b4);
        this.sfx('cine_whoosh', e.x, e.y, 1);
        return true;
      case 'push': {
        // the shoved hero: a puff where they stood and a streak to where they landed
        const f = iso.p(e.tx ?? e.x, e.ty ?? e.y);
        J.dust(f.x, f.y, 6, 0x9ab0c0);
        const mine = snap?.players[me];
        if (mine && Math.hypot(mine.x - e.x, mine.y - e.y) < 0.8) J.number(q.x, q.y - 44, 'SHOVED', '#c8e8ff', 'sm');
        return true;
      }
      case 'hailslam':
        J.ring(q.x, q.y, iso.rx(r), 0xd8f0ff, 320); J.sparksAt(q.x, q.y - 4, 14, 0xe8fbff); J.dust(q.x, q.y, 12, 0x8a94a8);
        this.sfx('ice_shatter', e.x, e.y, 2);
        return true;
      case 'voidgaze':
        J.ring(q.x, q.y, iso.rx(r), 0x5418aa, 340); J.ring(q.x, q.y, iso.rx(r * 0.6), 0x0c0614, 260);
        J.embersAt(q.x, q.y - 10, 14, 0x9446f0);
        this.sfx('blind_burst', e.x, e.y, 2);
        return true;
      case 'leap_off':
        J.dust(q.x, q.y, 8, 0x8a8494);
        return true;
      case 'leap_land':
        J.ring(q.x, q.y, iso.rx(r), 0xc0cce0, 300); J.dust(q.x, q.y, 14, 0x8a8494);
        this.sfx('enemy_bite', e.x, e.y, 1);
        return true;
      case 'blink': {
        const t = iso.p(e.tx ?? e.x, e.ty ?? e.y);
        J.embersAt(q.x, q.y - 14, 8, 0xff3ad0); J.ring(q.x, q.y, 18, 0x4ae8ff, 200);
        J.ring(t.x, t.y, 24, 0x4ae8ff, 260); J.embersAt(t.x, t.y - 14, 10, 0x4ae8ff);
        this.sfx('skill_phase', e.tx ?? e.x, e.ty ?? e.y, 1);
        return true;
      }
      case 'tractor_hit':
        J.ring(q.x, q.y, 22, 0x9a6aff, 260); J.sparksAt(q.x, q.y - 14, 8, 0xd8c0ff);
        return true;
      case 'staticbolt_hit':
        J.sparksAt(q.x, q.y - 14, 10, 0xfff060);
        return true;
      case 'glitchbolt_hit':
        J.sparksAt(q.x, q.y - 14, 6, 0x4ae8ff); J.sparksAt(q.x, q.y - 14, 4, 0xff3ad0);
        return true;
    }
    return false;
  }
}
