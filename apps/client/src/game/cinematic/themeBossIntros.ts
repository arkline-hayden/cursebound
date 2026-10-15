import * as Phaser from 'phaser';
import type { Juice } from '../render/Juice';
import { iso } from '../render/iso';
import type { Pt } from '../input/path';
import { dirOf, type Puppet } from './puppet';
import { E, type Timeline, type TimelineCtx } from './timeline';

// Grand entrances of the theme bosses (Cinematic.ts startBoss hands them its timeline and helpers). Both act on the
// boss's real sprite through its puppet, with the same beats as every reveal: rumble, the emergence at REVEAL, the
// cry at ROAR, then the name card. The camera never shakes; slow motion, flashes and rings carry the impact.
//   skydrake    a vast shadow sweeps over the ring, the Gale Wyrm drops out of the sky in a long gliding stoop, lands
//               in a gust that flattens the dust, rears and screeches while lightning forks around it
//   moonhorror  the pit glows violet and the regolith trembles, tentacles of light lick the rim, the Crater Horror heaves
//               up out of the crater, and at the cry its great eye snaps open in a pulse of void light

export interface BossIntroApi {
  tl: Timeline;
  J: Juice;
  pup: Puppet | null;
  /** boss spot (world) and its screen point; unit direction toward the party (world) */
  x: number; y: number; sq: { x: number; y: number }; fx: number; fy: number;
  /** the intro's seconds scale (authored for a 4 s hold) and its two beats */
  T: (v: number) => number; REVEAL: number; ROAR: number;
  reduced: boolean; motion: boolean;
  info: { glow: number; css: string; dust: number };
  image(key: string, x: number, y: number, depth: number): Phaser.GameObjects.Image | null;
  sprite(key: string, x: number, y: number, depth: number): Phaser.GameObjects.Sprite | null;
  light(x: number, y: number, radius: number, color: number, intensity: number): Phaser.GameObjects.Light | null;
  flash(x: number, y: number, radius: number, color: number, intensity: number, ms: number): void;
  sfx(ctx: TimelineCtx, id: string, w?: Pt, priority?: number): void;
  debrisAt(x: number, y: number, n: number, tint: number): void;
  zoom(z: number): void;
  /** a scene-owned graphics layer (destroyed with the cutscene) */
  graphics(depth: number): Phaser.GameObjects.Graphics;
}

/** Camera lift (px above the boss's feet) to frame each entrance. */
export const THEME_INTRO_LIFT: Record<string, number> = { skydrake: 60, moonhorror: 70 };

function skydrake(a: BossIntroApi) {
  const { tl, J, pup, x, y, sq, T, REVEAL, ROAR, info } = a;
  const spot = { x, y };
  const lamp = a.light(sq.x, sq.y - 40, 280, info.glow, 0);
  tl.tween(T(0.3), T(1.2), (q) => { if (lamp) lamp.intensity = 2.2 * q; }, E.inQuad, { start: (ctx) => a.sfx(ctx, 'drake_gale', spot, 3) });
  // feathers and leaves racing across the ring on the rising wind
  tl.tween(T(0.2), T(1.8), (_q, ctx) => {
    if (ctx.skipping || a.reduced || Math.random() > 0.35) return;
    const g = iso.p(x + (Math.random() - 0.5) * 9, y + (Math.random() - 0.5) * 9);
    J.bits(Math.random() < 0.5 ? 'feather' : 'leaf', g.x, g.y - 20, 1, 0xe8f6ff, { angle: 200, spread: 20, speed: 3 });
  }, E.linear);
  // the shadow of something vast passes over the ring
  const shade = a.graphics(-59);
  tl.tween(T(0.5), T(1.1), (q) => {
    shade.clear();
    if (q >= 1) return;
    const sx = sq.x + 240 - q * 480, sy = sq.y - 30 + q * 50;
    shade.fillStyle(0x000000, 0.35 * Math.sin(q * Math.PI)).fillEllipse(sx, sy, 150, 46);
  }, E.inOutSine, { start: (ctx) => a.sfx(ctx, 'drake_dive', spot, 3) });
  if (pup) {
    // the stoop: a long glide down out of the sky onto the dais, flapping, then the landing gust
    const from = { x: x + 7, y: y - 7 };
    tl.tween(REVEAL - T(0.7), T(0.7), (q) => {
      pup.alpha = Math.min(1, q * 3);
      pup.x = from.x + (x - from.x) * q; pup.y = from.y + (y - from.y) * q;
      pup.lift = 240 * (1 - q) * (1 - q);
    }, E.outQuad, {
      start: (ctx) => { pup.play('run', dirOf(x - from.x, y - from.y)); a.sfx(ctx, 'cine_whoosh', spot, 2); },
      end: (ctx) => {
        pup.lift = 0; pup.x = x; pup.y = y;
        pup.play('idle', dirOf(a.fx, a.fy));
        if (ctx.skipping) return;
        J.shockwave(sq.x, sq.y, iso.rx(4.5), info.glow, 600);
        J.ring(sq.x, sq.y, iso.rx(2.6), 0xffffff, 380);
        J.dust(sq.x, sq.y, 30, info.dust);
        J.bits('feather', sq.x, sq.y - 30, 16, 0xe8f6ff, { angle: -90, spread: 120, speed: 3 });
        J.hitStop(90);
        a.sfx(ctx, 'boss_emerge', spot, 4);
      },
    });
    tl.call(ROAR - T(0.35), () => pup.play('windup', dirOf(a.fx, a.fy), true));
    tl.call(T(3.2), () => pup.play('idle', dirOf(a.fx, a.fy)));
  }
  // the screech: forked lightning all round, a white flash, slow motion
  tl.call(ROAR, (ctx) => {
    if (!ctx.skipping) {
      for (let k = 0; k < (a.reduced ? 2 : 5); k++) {
        const ang = (k / 5) * Math.PI * 2 + 0.4;
        const g = iso.p(x + Math.cos(ang) * 3.2, y + Math.sin(ang) * 3.2);
        const gfx = a.graphics(4650).setBlendMode(Phaser.BlendModes.ADD);
        let cx = g.x, cy = g.y - 170;
        gfx.lineStyle(5, 0xfff7a8, 0.6);
        for (let s = 0; s < 6; s++) { const nx = g.x + (s % 2 ? 8 : -8) * (1 - s / 6), ny = cy + 28; gfx.lineBetween(cx, cy, nx, ny); cx = nx; cy = ny; }
        gfx.scene.tweens.add({ targets: gfx, alpha: 0, duration: Math.round(T(0.4) * 1000), ease: 'Quad.easeOut' });
        J.sparksAt(g.x, g.y - 6, 8, 0xfff7a8);
      }
      J.ring(sq.x, sq.y, iso.rx(5), info.glow, 900);
      J.flash(0xe8f6ff, 140);
      J.dilate(0.4, 700);
      a.flash(sq.x, sq.y - 60, 420, info.glow, 3.4, 800);
    }
    a.sfx(ctx, 'drake_screech', spot, 5);
    a.sfx(ctx, 'boss_roar', spot, 4);
    if (a.motion) a.zoom(2);
  });
}

function moonhorror(a: BossIntroApi) {
  const { tl, J, pup, x, y, sq, T, REVEAL, ROAR, info } = a;
  const spot = { x, y };
  const pit = a.light(sq.x, sq.y - 10, 240, info.glow, 0);
  tl.tween(T(0.3), T(1.5), (q, ctx) => {
    if (pit) pit.intensity = 2.4 * q;
    if (!ctx.skipping && !a.reduced && Math.random() < 0.2) {
      const ang = Math.random() * Math.PI * 2, r = 1 + q * 2.4;
      const g = iso.p(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
      J.dust(g.x, g.y, 2, info.dust);
      J.bits('mote', g.x, g.y - 4, 1, 0xc2f6ff, { angle: -90, spread: 30, speed: 0.6 });
    }
  }, E.linear, { start: (ctx) => a.sfx(ctx, 'gravity_well', spot, 3) });
  // glowing rings welling up out of the pit
  const rings = a.graphics(-58).setBlendMode(Phaser.BlendModes.ADD);
  tl.tween(T(0.5), REVEAL - T(0.5), (q) => {
    rings.clear();
    for (let k = 0; k < 3; k++) {
      const p = (q * 2 + k / 3) % 1;
      rings.lineStyle(2, info.glow, 0.7 * (1 - p)).strokeEllipse(sq.x, sq.y, iso.rx(0.6 + p * 3) * 2, iso.ry(0.6 + p * 3) * 2);
    }
  }, E.linear, { end: () => rings.clear() });
  if (pup) {
    // the Horror heaves up out of the crater: it grows upward from its feet, wreathed in void light
    pup.play('idle', 2);
    tl.tween(REVEAL - T(0.6), T(0.9), (q) => {
      pup.alpha = Math.min(1, q * 2.5);
      pup.sprite.setScale(1, Math.max(0.05, q));
      pup.setGlow(info.glow, Math.max(0, 1 - q * 1.2));
    }, E.outBack, {
      start: (ctx) => {
        a.sfx(ctx, 'tentacle_burst', spot, 3);
        a.sfx(ctx, 'boss_emerge', spot, 4);
        if (ctx.skipping) return;
        J.dust(sq.x, sq.y, 26, info.dust);
        a.debrisAt(sq.x, sq.y - 30, 14, 0x6c6a72);
      },
      end: () => { pup.sprite.setScale(1, 1); pup.setGlow(0, 0); },
    });
    tl.call(ROAR - T(0.3), () => pup.play('windup', 2, true));
    tl.call(ROAR + T(0.15), () => pup.play('attack', 2, true));
    tl.call(T(3.2), () => pup.play('idle', 2));
  }
  // the eye opens: a pulse of void light, the moon's dust lifting, slow motion
  tl.call(ROAR, (ctx) => {
    if (!ctx.skipping) {
      J.shockwave(sq.x, sq.y - 40, iso.rx(5), info.glow, 900);
      J.ring(sq.x, sq.y - 90, iso.rx(2.2), 0xc2f6ff, 600);
      J.flash(0xc0a8ff, 140);
      J.hitStop(80);
      J.dilate(0.4, 800);
      a.flash(sq.x, sq.y - 90, 440, 0xc2f6ff, 3.4, 900);
    }
    a.sfx(ctx, 'horror_moan', spot, 5);
    a.sfx(ctx, 'boss_roar', spot, 4);
    if (a.motion) a.zoom(2);
  });
}

export const THEME_BOSS_INTROS: Record<string, (api: BossIntroApi) => void> = { skydrake, moonhorror };
