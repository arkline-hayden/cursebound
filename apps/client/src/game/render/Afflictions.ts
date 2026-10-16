import * as Phaser from 'phaser';
import { AFFLICTION_RULES } from '@cursebound/content';
import type { SimEvent, SnapPlayer, Snapshot } from '@cursebound/simulation';
import { ACTOR_IDS } from '../art/actors';
import type { SfxId } from '../audio/AudioEngine';
import { getAudio } from '../audio/bus';
import { foeVoice } from '../audio/fileCues';
import { registerHazardFx, registerProjectileFx } from './fx/registry';
import type { Juice } from './Juice';
import { iso } from './iso';

// Hero afflictions and the new foe attacks (cosmetic only; simulation/src/afflictions.ts is the authority):
//   frozen   - an ice block around the hero        chained  - taut iron links from a ground spike to the hero
//   poisoned - green drips and bubbles             rooted   - webbing at the feet
//   silenced - a hex rune over the head            blinded  - darkness closing in around the local hero (other
//   chill    - frost crystals at the feet, one per stack toward a freeze      heroes: a dark cloud on them)
// Plus the hook / frost bolt / shade bolt / web glob projectiles (with the hook's chain trail), venom puddles and
// webs, the shadow burst and the cues for the 'afflict', 'foe_fx' and 'aggro' events.

const PX = AFFLICTION_RULES.blindVision;

/** Fallback looks for new foes until their sprites exist: a tinted existing actor. */
const FALLBACK: Record<string, { base: string; tint: number }> = {
  gaoler: { base: 'guardian', tint: 0x9a9088 },
  rimewraith: { base: 'skirmisher', tint: 0x9fe8ff },
  gloomshade: { base: 'hexer', tint: 0x4a3a6a },
  webweaver: { base: 'broodcaller', tint: 0xd8d0c0 },
};

/** Actor (and tint) to draw for an enemy kind: its own sprite when registered, else a tinted stand-in. */
export function foeActor(scene: Phaser.Scene, kind: string, boss: boolean, known: boolean): { actor: string; tint: number | null } {
  if (boss) return { actor: kind, tint: null };
  if ((ACTOR_IDS as readonly string[]).includes(kind) || scene.textures.exists(`actor:${kind}`)) return { actor: kind, tint: null };
  const fb = FALLBACK[kind];
  if (fb) return { actor: fb.base, tint: fb.tint };
  return { actor: known ? kind : 'pursuer', tint: null };
}

/** Sprite tint for a hero's afflictions (frozen reads icy, poisoned sickly green), or null. */
export function heroTint(p: SnapPlayer): number | null {
  if (p.buffs.includes('frozen')) return 0x9fe8ff;
  if (p.buffs.includes('poisoned')) return 0xb8f08a;
  if (p.buffs.includes('chill')) return 0xbfe6ff;
  return null;
}

// ---------------- pixel textures for the new projectiles ----------------

function pixelTexture(scene: Phaser.Scene, key: string, w: number, h: number, paint: (px: (x: number, y: number, c: string) => void) => void) {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  const ctx = t.context;
  paint((x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); });
  t.refresh();
  t.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

function buildTextures(scene: Phaser.Scene) {
  // iron hook (points right; the projectile sprite is rotated along its flight)
  pixelTexture(scene, 'foe:hook', 12, 10, (px) => {
    const D = '#1a1614', M = '#6a6460', L = '#b8b0a0', H = '#e8e0d0';
    for (let x = 0; x < 7; x++) { px(x, 4, M); px(x, 5, D); }
    px(0, 3, L); px(1, 3, L);
    for (const [x, y] of [[7, 4], [8, 3], [9, 2], [10, 3], [10, 4], [10, 5], [9, 6], [8, 7], [7, 7], [6, 6]]) px(x, y, L);
    for (const [x, y] of [[8, 4], [9, 4], [9, 5], [8, 6]]) px(x, y, D);
    px(9, 2, H); px(10, 3, H); px(6, 6, H);
  });
  // frost bolt: a pale ice shard with a cold core
  pixelTexture(scene, 'foe:frostbolt', 12, 7, (px) => {
    const rows = ['....aaa.....', '..aabbbaa...', 'aabbccccbbaa', 'abccddddccbb', 'aabbccccbbaa', '..aabbbaa...', '....aaa.....'];
    const col: Record<string, string> = { a: '#2a5a7a', b: '#5ab0e0', c: '#a8e8ff', d: '#ffffff' };
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) px(x, y, col[ch]); }));
  });
  // shade bolt: an inky wisp with a pale spark
  pixelTexture(scene, 'foe:shadebolt', 10, 7, (px) => {
    const rows = ['..aaa.....', '.abbbaa...', 'abbcbbbaa.', 'abcdcbbbba', 'abbcbbbaa.', '.abbbaa...', '..aaa.....'];
    const col: Record<string, string> = { a: '#140c1c', b: '#3a2a5a', c: '#6a5a9a', d: '#e8e0ff' };
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) px(x, y, col[ch]); }));
  });
  // web glob: a sticky white ball with strands
  pixelTexture(scene, 'foe:web', 10, 10, (px) => {
    const rows = ['...aaaa...', '..abbbba..', '.abccccba.', 'abccddccba', 'abcdccdcba', 'abccddccba', 'abcccccba.', '.abbccba..', '..abbba...', '...aaa....'];
    const col: Record<string, string> = { a: '#6a6458', b: '#b8b0a0', c: '#e8e0d0', d: '#ffffff' };
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) px(x, y, col[ch]); }));
  });
  // cursed cache: an iron-bound chest with a glowing hex lock
  pixelTexture(scene, 'foe:cache', 18, 14, (px) => {
    const rows = [
      '..aaaaaaaaaaaaaa..',
      '.abbbbbbbbbbbbbba.',
      'abccbbbbbbbbbbccba',
      'abccbbbbbbbbbbccba',
      'addddddddddddddda',
      'aeeeeeeffeeeeeeea',
      'abbbbbbfggfbbbbbba'.slice(0, 18),
      'abccbbbfggfbbbccba',
      'abccbbbbffbbbbccba',
      'abbbbbbbbbbbbbbbba',
      'abccbbbbbbbbbbccba',
      'addddddddddddddda.'.slice(0, 18),
      '.aaaaaaaaaaaaaaaa.',
      '..hhhhhhhhhhhhhh..',
    ];
    const col: Record<string, string> = { a: '#0c0806', b: '#4a2e1c', c: '#6a6460', d: '#8a847c', e: '#2a1a10', f: '#3a2a5a', g: '#c08aff', h: '#000000' };
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) px(x, y, col[ch]); }));
  });
  // blindness: stepped (dithered-looking) darkness with a clear centre, 2:1 to match the iso ground plane
  if (!scene.textures.exists('aff:blind')) {
    const W = 256, H = 128;
    const t = scene.textures.createCanvas('aff:blind', W, H);
    if (t) {
      const ctx = t.context;
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
        const d = Math.sqrt(dx * dx + dy * dy);
        const k = Math.max(0, Math.min(1, (d - 0.55) / 0.42));
        let a = Math.round(k * 5) / 5;   // five hard steps: a pixel-art falloff, not a smooth gradient
        if (((x + y) & 1) === 0 && k > 0 && k < 1) a = Math.min(1, a + 0.1);   // checker dither between steps
        const i = (y * W + x) * 4;
        img.data[i] = 4; img.data[i + 1] = 2; img.data[i + 2] = 8; img.data[i + 3] = Math.round(a * 238);
      }
      ctx.putImageData(img, 0, 0);
      t.refresh();
      t.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}

registerProjectileFx({
  hook: { key: 'foe:hook', color: 0xb8b0a0 },
  frostbolt: { key: 'foe:frostbolt', color: 0x8fd8ff },
  shadebolt: { key: 'foe:shadebolt', color: 0x6a4a9a },
  web: { key: 'foe:web', color: 0xe8e0d0 },
});

registerHazardFx({
  venom: (ctx, g, h, tick) => {
    const P = ctx.P(h.x, h.y);
    const life = Math.max(1, h.u - h.b), age = tick - h.b, fade = Math.min(1, age / 8) * Math.min(1, (h.u - tick) / 20);
    g.fillStyle(0x2a5a12, 0.45 * fade).fillEllipse(P.x, P.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 24);
    g.fillStyle(0x6ab02a, 0.35 * fade).fillEllipse(P.x, P.y, ctx.rx(h.r * 0.7) * 2, ctx.ry(h.r * 0.7) * 2, 20);
    g.lineStyle(1, 0x9ae04a, 0.8 * fade).strokeEllipse(P.x, P.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 24);
    // bubbles that pop in turn
    for (let i = 0; i < 4; i++) {
      const ph = ((age + i * 13) % 40) / 40;
      const a = (i / 4) * Math.PI * 2 + h.i;
      const bx = Math.round(P.x + Math.cos(a) * ctx.rx(h.r) * 0.5), by = Math.round(P.y + Math.sin(a) * ctx.ry(h.r) * 0.5);
      const r = Math.max(1, Math.round(ph * 3));
      if (ph < 0.9) g.lineStyle(1, 0xc8ff8a, 0.8 * fade).strokeCircle(bx, by - r, r);
    }
    void life;
  },
  web: (ctx, g, h, tick) => {
    const P = ctx.P(h.x, h.y);
    const fade = Math.min(1, (tick - h.b) / 6) * Math.min(1, (h.u - tick) / 20);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    g.fillStyle(0xe8e0d0, 0.08 * fade).fillEllipse(P.x, P.y, rx * 2, ry * 2, 24);
    g.lineStyle(1, 0xe8e0d0, 0.75 * fade);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + h.i * 0.3;
      g.lineBetween(P.x, P.y, Math.round(P.x + Math.cos(a) * rx), Math.round(P.y + Math.sin(a) * ry));
    }
    for (const k of [0.35, 0.65, 0.95]) g.strokeEllipse(P.x, P.y, rx * 2 * k, ry * 2 * k, 8);
  },
  blindBurst: (ctx, g, h, tick) => {
    // shadow gathering inside the marked circle until it bursts (the circle itself is the telegraph)
    const P = ctx.P(h.x, h.y);
    const arm = h.u - 1, total = Math.max(1, arm - h.b), k = Math.min(1, (tick - h.b) / total);
    g.fillStyle(0x0c0614, 0.25 + 0.35 * k).fillEllipse(P.x, P.y, ctx.rx(h.r * (1 - 0.6 * k)) * 2, ctx.ry(h.r * (1 - 0.6 * k)) * 2, 24);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + tick * 0.08;
      const rr = h.r * (1 - k) + 0.2;
      g.fillStyle(0x3a2a5a, 0.8).fillRect(Math.round(P.x + Math.cos(a) * ctx.rx(rr)) - 1, Math.round(P.y + Math.sin(a) * ctx.ry(rr)) - 1, 3, 3);
    }
  },
}, { venom: 0x6ab02a, blindBurst: 0x3a2a5a });

type Sfx = (id: SfxId, x?: number, y?: number, priority?: number) => void;

const STATUS_TEXT: Record<string, [string, string, SfxId | null]> = {
  chained: ['CHAINED', '#d8d0c0', 'chain_bind'],
  frozen: ['FROZEN', '#bfeeff', 'freeze'],
  poisoned: ['POISONED', '#9ae04a', 'poisoned'],
  blinded: ['BLINDED', '#9a8acc', null],
  rooted: ['ROOTED', '#e8e0d0', 'rooted'],
  silenced: ['SILENCED', '#c08aff', 'silenced'],
  slowed: ['SLOWED', '#a8b8c8', null],
};

/** Recorded takes for statuses landing on the local hero (tier 3), played instead of the shared cue when present. */
const STATUS_FILE: Record<string, string> = { slowed: 'slowed' };

export class AfflictionFx {
  private under: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private trails: Phaser.GameObjects.Graphics;
  private blindImg: Phaser.GameObjects.Image | null = null;
  private blindRim: Phaser.GameObjects.Graphics;
  private blindK = 0;
  private hookFrom = new Map<number, { x: number; y: number }>();
  private lastDrip = new Map<number, number>();
  private caches = new Map<number, { spr: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null }>();
  private now = 0;

  constructor(private scene: Phaser.Scene, private juice: Juice, private sfx: Sfx) {
    buildTextures(scene);
    this.under = scene.add.graphics().setDepth(-64);
    this.trails = scene.add.graphics().setDepth(4580);
    this.over = scene.add.graphics().setDepth(4515);
    this.blindRim = scene.add.graphics().setDepth(4801);
    if (scene.textures.exists('aff:blind')) this.blindImg = scene.add.image(0, 0, 'aff:blind').setDepth(4800).setVisible(false);
  }

  /** Once per frame, before heroes are drawn. */
  begin(now: number) {
    this.now = now;
    this.under.clear(); this.over.clear(); this.trails.clear();
  }

  /** Per-frame dressing for one hero. (wx, wy) = drawn world position; the sprite gives the body height. */
  drawPlayer(p: SnapPlayer, wx: number, wy: number, sprite: Phaser.GameObjects.Sprite | undefined, isMe: boolean) {
    if (p.life !== 'alive') return;
    const b = p.buffs;
    const { x: px, y: py } = iso.p(wx, wy);
    const h = Math.max(28, Math.round(sprite ? sprite.height * sprite.originY * sprite.scaleY * 0.9 : 36));
    const now = this.now;
    const g = this.over, u = this.under;
    // chained: anchor spike, the leash circle and taut iron links up to the waist
    if (b.includes('chained') && p.teth) {
      const [ax, ay, r] = p.teth;
      const A = iso.p(ax, ay);
      u.lineStyle(1, 0x6a6460, 0.45).strokeEllipse(A.x, A.y, iso.rx(r) * 2, iso.ry(r) * 2, 40);
      const dist = Math.hypot(wx - ax, wy - ay);
      const taut = Math.min(1, dist / Math.max(0.1, r));
      const x0 = A.x, y0 = A.y - 2, x1 = px, y1 = py - Math.round(h * 0.45);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(3, Math.round(len / 5));
      const sag = (1 - taut) * Math.min(14, len * 0.25);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lx = Math.round(x0 + (x1 - x0) * t), ly = Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag);
        if (i % 2 === 0) { g.fillStyle(0x1a1614, 1).fillRect(lx - 2, ly - 1, 4, 3); g.fillStyle(0x9a948c, 1).fillRect(lx - 1, ly - 1, 2, 1); }
        else { g.fillStyle(0x1a1614, 1).fillRect(lx - 1, ly - 2, 3, 4); g.fillStyle(0x6a6460, 1).fillRect(lx, ly - 1, 1, 2); }
      }
      // the spike
      u.fillStyle(0x0c0a08, 0.9).fillEllipse(A.x, A.y + 1, 12, 5, 12);
      g.fillStyle(0x1a1614, 1).fillRect(A.x - 2, A.y - 9, 4, 10);
      g.fillStyle(0x8a847c, 1).fillRect(A.x - 1, A.y - 9, 1, 8);
      g.fillStyle(0x1a1614, 1).fillRect(A.x - 3, A.y - 11, 6, 3);
      g.lineStyle(1, 0xb8b0a0, 1).strokeCircle(A.x, A.y - 12, 2);
    }
    // frozen: an ice block around the body
    if (b.includes('frozen')) {
      const w = 24, top = py - h - 4;
      g.fillStyle(0xbfeeff, 0.28).fillRect(px - w / 2, top, w, h + 6);
      g.lineStyle(1, 0xe8fbff, 0.95).strokeRect(px - w / 2, top, w, h + 6);
      g.fillStyle(0xffffff, 0.8).fillRect(px - w / 2 + 2, top + 2, 2, Math.round(h * 0.6));
      g.fillStyle(0xffffff, 0.6).fillRect(px - w / 2 + 5, top + 2, 6, 1);
      g.lineStyle(1, 0x8fd8ff, 0.7).lineBetween(px + 3, top + 4, px + w / 2 - 3, top + 12).lineBetween(px - 6, top + h - 6, px + 2, top + h);
      u.fillStyle(0xbfeeff, 0.35).fillEllipse(px, py + 1, 30, 12, 16);
    }
    // chill stacks toward a freeze: frost crystals at the feet
    const chs = p.chs ?? 0;
    if (!b.includes('frozen') && chs > 0) {
      for (let i = 0; i < chs; i++) {
        const a = (i / 3) * Math.PI * 2 + now / 900;
        const cx = Math.round(px + Math.cos(a) * 12), cy = Math.round(py + Math.sin(a) * 5);
        g.fillStyle(0x2a5a7a, 1).fillRect(cx - 2, cy - 4, 5, 5);
        g.fillStyle(0xbfeeff, 1).fillRect(cx - 1, cy - 5, 3, 5);
        g.fillStyle(0xffffff, 1).fillRect(cx, cy - 5, 1, 2);
      }
    }
    // rooted: webbing wrapped around the feet
    if (b.includes('rooted')) {
      u.fillStyle(0xe8e0d0, 0.18).fillEllipse(px, py, 34, 14, 16);
      u.lineStyle(1, 0xe8e0d0, 0.9);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        u.lineBetween(px, py, Math.round(px + Math.cos(a) * 17), Math.round(py + Math.sin(a) * 7));
      }
      u.strokeEllipse(px, py, 22, 9, 10).strokeEllipse(px, py, 34, 14, 12);
      g.lineStyle(1, 0xe8e0d0, 0.85).lineBetween(px - 6, py - 2, px + 5, py - 8).lineBetween(px + 6, py - 1, px - 4, py - 9).lineBetween(px - 7, py - 6, px + 7, py - 5);
    } else if (b.includes('slowed')) {
      u.lineStyle(1, 0xa8b8c8, 0.5).strokeEllipse(px, py, 26, 10, 12);
    }
    // poisoned: green drips and rising bubbles
    if (b.includes('poisoned')) {
      for (let i = 0; i < 3; i++) {
        const ph = ((now / 600) + i / 3) % 1;
        const bx = Math.round(px - 8 + i * 8), by = Math.round(py - h * 0.5 - ph * h * 0.6);
        g.lineStyle(1, 0x9ae04a, 1 - ph).strokeCircle(bx, by, 1 + Math.round(ph * 2));
      }
      for (let i = 0; i < 2; i++) {
        const ph = ((now / 450) + i * 0.5) % 1;
        g.fillStyle(0x6ab02a, 1 - ph).fillRect(Math.round(px - 5 + i * 9), Math.round(py - h * 0.4 + ph * h * 0.4), 2, 3);
      }
      const last = this.lastDrip.get(p.s) ?? 0;
      if (now - last > 180 && !this.juice.low) { this.lastDrip.set(p.s, now); this.juice.embersAt(px + (Math.random() - 0.5) * 12, py - h * 0.5, 1, 0x7ad04a); }
    }
    // silenced: a turning hex rune over the head
    if (b.includes('silenced')) {
      const cx = px, cy = py - h - 14, r = 6, t = now / 500;
      g.lineStyle(2, 0x1a0c24, 1).strokeCircle(cx, cy, r + 1);
      g.lineStyle(1, 0xc08aff, 1).strokeCircle(cx, cy, r);
      g.lineBetween(cx - 4, cy + 4, cx + 4, cy - 4);
      for (let i = 0; i < 4; i++) {
        const a = t + (i * Math.PI) / 2;
        g.fillStyle(0xe8c8ff, 1).fillRect(Math.round(cx + Math.cos(a) * (r + 3)) - 1, Math.round(cy + Math.sin(a) * (r + 3)) - 1, 2, 2);
      }
    }
    // blinded (another hero): a dark cloud on them; the local hero gets the darkness overlay instead
    if (b.includes('blinded') && !isMe) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + now / 700;
        g.fillStyle(0x0c0614, 0.75).fillCircle(Math.round(px + Math.cos(a) * 9), Math.round(py - h * 0.8 + Math.sin(a) * 4), 5);
      }
      g.fillStyle(0x3a2a5a, 0.9).fillRect(px - 3, Math.round(py - h * 0.8) - 1, 6, 2);
    }
  }

  /** Blindness around the local hero: the world beyond ~3.5 tiles sinks into darkness (foes there are hidden). */
  drawBlind(me: SnapPlayer | null, wx: number, wy: number, delta: number) {
    const want = me && me.life === 'alive' && me.buffs.includes('blinded') ? 1 : 0;
    this.blindK += (want - this.blindK) * Math.min(1, delta / 140);
    if (this.blindK < 0.02) { this.blindImg?.setVisible(false); this.blindRim.clear(); this.blindK = want ? this.blindK : 0; return; }
    const { x: px, y: py } = iso.p(wx, wy);
    const cy = py - 14;
    // the texture's clear core spans 0.55 of its half-width: scale so that core is the vision radius
    const halfW = iso.rx(PX) / 0.55;
    const scale = halfW / 128;
    const img = this.blindImg;
    const a = Math.min(1, this.blindK);
    if (img) img.setVisible(true).setPosition(Math.round(px), Math.round(cy)).setScale(scale).setAlpha(a);
    // everything beyond the texture: solid darkness to the edge of the view
    const cam = this.scene.cameras.main.worldView;
    const x0 = Math.round(px - halfW), x1 = Math.round(px + halfW), y0 = Math.round(cy - halfW / 2), y1 = Math.round(cy + halfW / 2);
    const g = this.blindRim.clear();
    g.fillStyle(0x040208, 0.93 * a);
    const L = cam.x - 64, R = cam.right + 64, Tp = cam.y - 64, B = cam.bottom + 64;
    if (y0 > Tp) g.fillRect(L, Tp, R - L, y0 - Tp);
    if (B > y1) g.fillRect(L, y1, R - L, B - y1);
    if (x0 > L) g.fillRect(L, y0, x0 - L, y1 - y0);
    if (R > x1) g.fillRect(x1, y0, R - x1, y1 - y0);
  }

  /** Chain trails behind thrown hooks (from where the hook was first seen to where it flies). */
  drawShots(s: Snapshot) {
    const seen = new Set<number>();
    const g = this.trails;
    for (const pr of s.projectiles) {
      if (pr.k !== 'hook') continue;
      seen.add(pr.i);
      let from = this.hookFrom.get(pr.i);
      if (!from) { from = { x: pr.x - pr.vx * 0.05, y: pr.y - pr.vy * 0.05 }; this.hookFrom.set(pr.i, from); this.sfx('chain_throw', pr.x, pr.y, 1); }
      const a = iso.p(from.x, from.y), b = iso.p(pr.x, pr.y);
      const ay = a.y - 14, by = b.y - 14;
      const len = Math.hypot(b.x - a.x, by - ay);
      const n = Math.max(2, Math.round(len / 5));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lx = Math.round(a.x + (b.x - a.x) * t), ly = Math.round(ay + (by - ay) * t);
        g.fillStyle(0x1a1614, 1).fillRect(lx - 1, ly - 1, 3, 3);
        g.fillStyle(i % 2 ? 0x6a6460 : 0xb8b0a0, 1).fillRect(lx, ly - 1, 1, 2);
      }
    }
    for (const id of [...this.hookFrom.keys()]) if (!seen.has(id)) this.hookFrom.delete(id);
  }

  /** Cursed caches (pickups of kind 'cache', simulation/src/caches.ts): a chest with a pulsing hex glow. */
  drawCaches(pickups: Snapshot['pickups']) {
    const seen = new Set<number>();
    for (const pk of pickups) {
      if (pk.k !== 'cache') continue;
      seen.add(pk.i);
      let c = this.caches.get(pk.i);
      const q = iso.p(pk.x, pk.y);
      if (!c) {
        const spr = this.scene.add.image(Math.round(q.x), Math.round(q.y), 'foe:cache').setOrigin(0.5, 0.85);
        const glow = this.scene.textures.exists('light:soft') ? this.scene.add.image(Math.round(q.x), Math.round(q.y) - 6, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(0xa060ff).setScale(0.22) : null;
        c = { spr, glow };
        this.caches.set(pk.i, c);
      }
      c.spr.setPosition(Math.round(q.x), Math.round(q.y)).setDepth(iso.depth(pk.x, pk.y));
      c.glow?.setPosition(Math.round(q.x), Math.round(q.y) - 6).setDepth(iso.depth(pk.x, pk.y) + 1).setAlpha(0.25 + 0.15 * Math.sin(this.now / 320 + pk.i));
      if (!this.juice.low && Math.random() < 0.03) this.juice.embersAt(q.x + (Math.random() - 0.5) * 10, q.y - 8, 1, 0xc08aff);
    }
    for (const [id, c] of this.caches) if (!seen.has(id)) { c.spr.destroy(); c.glow?.destroy(); this.caches.delete(id); }
  }

  /** Presentation for afflict / foe_fx / aggro events and the new foes' attack sounds. Returns true if handled. */
  onEvent(e: SimEvent, me: number, snap: Snapshot | null): boolean {
    const J = this.juice;
    switch (e.t) {
      case 'afflict': {
        const p = snap?.players[e.slot];
        const q = iso.p(p?.x ?? e.x, p?.y ?? e.y);
        const mine = e.slot === me;
        if (e.s === 'chain_break') { this.sfx('chain_break', e.x, e.y, mine ? 2 : 1); J.sparksAt(q.x, q.y - 12, 6, 0xb8b0a0); return true; }
        if (e.s === 'thaw') { this.sfx('ice_shatter', e.x, e.y, mine ? 2 : 1); J.sparksAt(q.x, q.y - 16, 10, 0xbfeeff); J.embersAt(q.x, q.y - 16, 6, 0xe8fbff); return true; }
        if (e.s === 'chill') { this.sfx('freeze_build', e.x, e.y, mine ? 1 : 0); J.embersAt(q.x, q.y - 10, 3, 0xbfeeff); return true; }
        const st = STATUS_TEXT[e.s];
        if (!st) return true;
        if (e.sec <= 0) { if (mine) J.number(q.x, q.y - 44, 'IMMUNE', '#a8a0b0', 'sm'); return true; }
        J.number(q.x, q.y - 44, st[0], st[1], mine ? 'md' : 'sm');
        const file = mine ? STATUS_FILE[e.s] : undefined;
        if (file) getAudio()?.playFile(file, st[2], { priority: 3, volume: 0.8 });
        else if (st[2]) this.sfx(st[2], e.x, e.y, mine ? 3 : 1);
        if (e.s === 'frozen') { J.ring(q.x, q.y, 22, 0xbfeeff, 260); J.sparksAt(q.x, q.y - 16, 8, 0xe8fbff); }
        if (e.s === 'chained' && e.ax !== undefined && e.ay !== undefined) { const A = iso.p(e.ax, e.ay); J.dust(A.x, A.y, 5, 0x3a3430); J.sparksAt(A.x, A.y - 6, 6, 0xb8b0a0); }
        if (e.s === 'rooted') J.dust(q.x, q.y, 4, 0xd8d0c0);
        return true;
      }
      case 'foe_fx': {
        const q = iso.p(e.x, e.y);
        const r = e.r ?? 1.5;
        if (e.fx === 'shadowburst') {
          J.ring(q.x, q.y, iso.rx(r), 0x3a2a5a, 340); J.ring(q.x, q.y, iso.rx(r * 0.6), 0x0c0614, 260);
          J.embersAt(q.x, q.y - 10, 14, 0x3a2a5a); J.dust(q.x, q.y, 10, 0x140c1c);
          this.sfx('blind_burst', e.x, e.y, 2);
        } else if (e.fx === 'venom_splash') {
          J.ring(q.x, q.y, iso.rx(r), 0x6ab02a, 260); J.embersAt(q.x, q.y - 6, 10, 0x9ae04a);
          this.sfx('poison_spit', e.x, e.y, 1);
        } else if (e.fx === 'web_splat') {
          J.ring(q.x, q.y, iso.rx(r), 0xe8e0d0, 240); J.dust(q.x, q.y, 8, 0xd8d0c0);
        } else if (e.fx === 'hook_hit') {
          J.sparksAt(q.x, q.y - 14, 10, 0xd8d0c0); J.impact(q.x, q.y - 14, 0xb8b0a0, 1.1);
        } else if (e.fx === 'frostbolt_hit') {
          J.sparksAt(q.x, q.y - 14, 8, 0xbfeeff);
        }
        return true;
      }
      case 'pickup': {
        if (e.kind !== 'cache') return false;
        const q = iso.p(e.x, e.y);
        J.ring(q.x, q.y, 28, 0xc08aff, 320); J.embersAt(q.x, q.y - 10, 16, 0xc08aff); J.sparksAt(q.x, q.y - 8, 10, 0xffd890);
        this.sfx('chest_open', e.x, e.y, e.slot === me ? 3 : 1);
        const c = this.caches.get(e.id);
        if (c) { c.spr.destroy(); c.glow?.destroy(); this.caches.delete(e.id); }
        return true;
      }
      case 'aggro': {
        const q = iso.p(e.x, e.y);
        J.number(q.x, q.y - 52, '!', '#ff4a3a', 'md');
        return true;
      }
      case 'enemy_attack': {
        if (e.stage !== 'release') return false;
        const en = snap?.enemies.find((x) => x.i === e.id);
        if (!en) return false;
        // the foe's recorded attack voice (the scene plays it) already spits: no second spit on top
        const voice = foeVoice(en.k, 'attack');
        if (voice && getAudio()?.hasFile(voice)) return false;
        if (e.attack === 'webglob') this.sfx('web_spit', en.x, en.y, 1);
        else if (e.attack === 'lob') this.sfx('poison_spit', en.x, en.y, 1);
        return false;   // the scene still plays its generic cue
      }
      case 'elite': {
        if (e.fx === 'hook_throw') { this.sfx('chain_throw', e.x, e.y, 2); return true; }
        if (e.fx === 'blind_warn') { const q = iso.p(e.x, e.y); this.juice.embersAt(q.x, q.y - 14, 8, 0x3a2a5a); return true; }
        if (e.fx === 'blind_burst') { const q = iso.p(e.x, e.y); J.ring(q.x, q.y, iso.rx(2.2), 0x3a2a5a, 340); J.embersAt(q.x, q.y - 10, 14, 0x3a2a5a); this.sfx('blind_burst', e.x, e.y, 2); return true; }
        return false;
      }
    }
    return false;
  }
}

