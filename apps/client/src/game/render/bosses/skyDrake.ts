import type { ActorState } from '../../art/actors';
import { iso } from '../iso';
import { registerBossKit } from './registry';
import { skyBolt } from './skyMoonFx';

// THE GALE WYRM (simulation bosses/skyDrake.ts): aloft, the snapshot's altitude lifts the sprite, shrinks its shadow and
// swaps to the flight cycle; one-shot cues for its dives, the gale, take-off and landing, the feather strikes and the
// long fall (a hero blown off the island). Hazards and projectiles (shared with the Crater Horror, whose kit runs the
// shared layer's per-frame begin): skyMoonFx.ts.
// No camera shake: impacts read through flashes, rings and particles.

const SKY = 0xbfe6ff;
const BOLT = 0xfff7a8;
/** Screen px the Gale Wyrm climbs at altitude 1. */
const WYRM_CLIMB = 78;

/** Per-scene presentation state (sprite lift easing, wind streak pacing). */
const lift = new Map<number, number>();
let lastWind = 0;

registerBossKit('skydrake', {
  look(host, e, delta) {
    const want = (e.alt ?? 0) * WYRM_CLIMB;
    const cur = lift.get(e.i) ?? want;
    const l = cur + (want - cur) * Math.min(1, delta / 70);
    lift.set(e.i, l);
    const aloft = (e.alt ?? 0) >= 0.5;
    let state: ActorState | undefined;
    if (e.st !== 'dying' && e.st !== 'stagger' && !e.stag) {
      if (aloft) state = e.st === 'recovery' ? 'attack' : 'run';   // circling: the flight cycle; the stoop: the strike
      else if (e.atk === 'dive' && e.st === 'attack') state = 'attack';
    }
    // wind streaks off the wings while it flies
    if (aloft && !host.juice.reduced && host.scene.time.now - lastWind > 90) {
      lastWind = host.scene.time.now;
      const p = iso.p(e.x, e.y);
      host.juice.bits('feather', p.x + (Math.random() - 0.5) * 60, p.y - l - 30, 1, 0xe8f6ff, { angle: 90, spread: 30, speed: 0.8 });
    }
    return { lift: l, shadow: Math.max(0.35, 1 - (l / WYRM_CLIMB) * 0.6), state };
  },

  onEvent(host, _layer, e, snap) {
    const J = host.juice;
    if (e.t === 'boss_phase') {
      const b = snap?.enemies.find((x) => x.i === e.id);
      if (b && e.phase >= 1) { host.sfx('drake_screech', b.x, b.y, 5); host.banner('It takes to the storm!', 'danger'); }
      return false;
    }
    if (e.t === 'enemy_attack' && e.stage === 'release') {
      if (e.attack === 'talon') { const b = snap?.enemies.find((x) => x.i === e.id); if (b) host.sfx('swing', b.x, b.y, 2); }
      return false;
    }
    if (e.t !== 'foe_fx') return false;
    const q = iso.p(e.x, e.y);
    const r = e.r ?? 1.5;
    switch (e.fx) {
      case 'drake_takeoff':
        host.sfx('drake_screech', e.x, e.y, 4);
        J.ring(q.x, q.y, iso.rx(3), SKY, 420); J.dust(q.x, q.y, 14, 0x8a8a94);
        J.bits('feather', q.x, q.y - 30, 10, 0xe8f6ff, { angle: -90, spread: 70, speed: 2 });
        break;
      case 'drake_dive':
        host.sfx('drake_dive', e.x, e.y, 3);
        if (e.tx !== undefined && e.ty !== undefined) { const t = iso.p(e.tx, e.ty); J.bitsAlong('feather', q.x, q.y - 30, t.x, t.y - 30, 8, 0xe8f6ff); }
        break;
      case 'drake_gale':
        host.sfx('drake_gale', e.x, e.y, 3);
        if (e.tx !== undefined && e.ty !== undefined) { const t = iso.p(e.tx, e.ty); J.bitsAlong('leaf', q.x, q.y - 20, t.x, t.y - 10, 10, 0xd8f2ff); }
        break;
      case 'drake_land':
        host.sfx('signature_slam', e.x, e.y, 4); host.sfx('drake_screech', e.x, e.y, 3);
        J.shockwave(q.x, q.y, iso.rx(r), SKY, 420); J.ring(q.x, q.y, iso.rx(r * 0.6), 0xffffff, 300);
        J.dust(q.x, q.y, 22, 0x8a8a94); J.impact(q.x, q.y - 20, SKY, 2.4); J.hitStop(70);
        host.dungeon.flashLight(q.x, q.y - 30, 260, SKY, 2.4, 400);
        break;
      case 'feather_strike':
        skyBolt(host.fxCtx(), e.x, e.y, BOLT);
        host.sfx('thunder_feather', e.x, e.y, 2);
        break;
      case 'void_fall': {
        // blown off the island: the hero tumbles into the sky, then the wind sets them back on the rock (teleport fx)
        host.sfx('skyfall', e.x, e.y, 5);
        J.bits('feather', q.x, q.y - 12, 12, 0xe8f6ff, { angle: 90, spread: 50, speed: 3 });
        const me = host.me();
        const mine = snap?.players.some((p) => p.s === me && Math.hypot(p.x - (e.tx ?? p.x), p.y - (e.ty ?? p.y)) < 0.5);
        if (e.tx !== undefined && e.ty !== undefined) { const t = iso.p(e.tx, e.ty); J.number(t.x, t.y - 44, 'BLOWN OFF!', '#bfe6ff', mine ? 'md' : 'sm'); }
        break;
      }
    }
    return false;   // cues only: the scene's generic handling still runs
  },

  destroy() { lift.clear(); },
});
