import { BOSS_BY_ID, SKY_FALL, TICK_SEC, type EnemyAttackDef } from '@cursebound/content';
import { chooseTarget, moveToward } from '../ai';
import { enemyAttackDamage } from '../combat';
import { inCone, isWallAt, norm } from '../geometry';
import { makeHazard } from '../players';
import { nextFloat } from '../rng';
import {
  SWEEP, addTelegraph, alive, beginModule, bv, distTo, dropTelegraphs, floorNear, freqOf, hitHero, isVoidAt, nextModule, openPhase,
  pushHero, registerBossKit, registerKitHazard, releaseTickFor, safeSpot, smooth, stepModule, ticksFor, type KitModule,
} from '../bosskit';
import type { EnemyState, PlayerState, SimEvent, SimState } from '../types';

// The Gale Wyrm (content SKY_DRAKE), boss of the sky island. Kit modules:
//   dive      Strafing Dive: a wide lane is marked from the Wyrm through its target; it lifts off and sweeps the lane at
//             speed (flying over chasms and the ring's hole), striking every hero in its path once, and lands at the end.
//   gale      Gale Breath: a marked cone; the breath stings and a gale hazard shoves heroes in the cone away from the
//             Wyrm for the release (SKY_FALL.pushSpeed, about a hero's walking speed: walk into it to hold ground, or
//             dash through it, i-frames ignore it). A hero shoved over the brink takes the long fall (bosskit voidFall):
//             heavy damage and back on solid rock, never an instant death.
//   talon     Talon Rake: the shared close-range cone (bosskit SWEEP).
//   feathers  Lightning Feathers: marked circles under every hero and around them; lightning strikes each on release.
//   soar      Storm Circling (phase 2): it climbs out of reach (immune, bosskit immune), circles the arena raining feather
//             volleys, then stoops onto a marked spot under a hero and lands winded (staggered: vulnerable).
// Counters (EnemyState.bvars): hx/hy home (arena centre), or orbit radius, alt altitude 0..1, ang orbit angle, dir orbit
// direction, nv next volley tick, sx/sy stoop start, lx/ly landing spot. Hazards: 'gale', 'stormfeather'.

const ID = 'skydrake';
const DT = TICK_SEC;
/** orbit angular speed while circling (rad / s, before attack frequency) and the dive's cruising height */
const K = { orbit: (Math.PI * 2) / 5.5, diveAlt: 0.35, featherLead: 0.4, featherSpacing: 1.8 };

const def = () => BOSS_BY_ID[ID];
const attack = (id: string): EnemyAttackDef => def().attacks.find((a) => a.id === id)!;

/** Home point and orbit radius: the arena's centre (the ring's hole) on boss floors, the spawn point elsewhere. */
function home(state: SimState, e: EnemyState): Record<string, number> {
  const v = bv(e);
  if (v.hx !== undefined) return v;
  const room = state.map?.rooms?.find((r) => r.kind === 'arena');
  if (room) {
    v.hx = room.x + room.w / 2; v.hy = room.y + room.h / 2;
    v.or = Math.max(3, Math.min(8, Math.min(room.w, room.h) * 0.33));
  } else {
    v.hx = e.x; v.hy = e.y; v.or = 4.5;
  }
  return v;
}

/** Lightning feather volley: marked circles under each hero (leading their run a little) and scattered around them. */
function featherVolley(state: SimState, e: EnemyState, base: number) {
  const a = attack('feathers');
  const map = state.map!;
  const heroes = alive(state);
  const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 1.1;
  const release = releaseTickFor(state, e, a);
  const dmg = enemyAttackDamage(state, e, a.damageCoef, true);
  const spots: [number, number][] = [];
  const free = (x: number, y: number) => !isWallAt(map, x, y) && spots.every(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 >= K.featherSpacing ** 2);
  for (const p of heroes) {
    const [x, y] = floorNear(map, p.x + p.vx * K.featherLead, p.y + p.vy * K.featherLead);
    spots.push([x, y]);
  }
  const want = base + heroes.length;
  for (let t = 0; t < want * 8 && spots.length < want && heroes.length; t++) {
    const p = heroes[t % heroes.length];
    const ang = nextFloat(state.rng.ai) * Math.PI * 2, r = 1.6 + nextFloat(state.rng.ai) * 3.6;
    const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
    if (free(x, y)) spots.push([x, y]);
  }
  for (const [x, y] of spots) {
    addTelegraph(state, e, 'stormfeather', a.telegraph, x, y, 0, 0, release);
    state.hazards.push(makeHazard(state, {
      kind: 'stormfeather', owner: 'enemy', ownerId: e.id, x, y, radius: R, armTick: release, untilTick: release + 1, interval: 1, damage: dmg, dtype: a.damageType,
    }));
  }
}

const DIVE: KitModule = {
  start(state, ev, e, a, target) {
    const map = state.map!;
    let [dx, dy] = norm(target.x - e.x, target.y - e.y);
    if (!dx && !dy) { dx = e.fx; dy = e.fy; }
    // the lane runs through the target and a few tiles past; it ends on rock (the Wyrm lands there)
    let L = Math.max(6, Math.min(a.range, distTo(e, target) + 4));
    for (; L > 3; L -= 0.5) if (!isWallAt(map, e.x + dx * L, e.y + dy * L) && !isVoidAt(map, e.x + dx * L, e.y + dy * L)) break;
    const w = a.telegraph.kind === 'line' ? a.telegraph.width : 2;
    const t = addTelegraph(state, e, a.id, { kind: 'line', length: L, width: w }, e.x, e.y, dx, dy, releaseTickFor(state, e, a));
    beginModule(state, ev, e, a, dx, dy, e.x + dx * L, e.y + dy * L, t.id);
  },
  tick(state, ev, e, a, stage, k) {
    const at = e.attack!, v = bv(e);
    if (stage === 'windup') { v.alt = K.diveAlt * smooth(k); return; }
    if (stage === 'recovery') { v.alt = K.diveAlt * (1 - smooth(k * 1.6)); return; }
    // release: sweep the lane, striking every hero in the Wyrm's path once
    const fromX = e.x, fromY = e.y;
    e.x = at.ox + (at.tx - at.ox) * k; e.y = at.oy + (at.ty - at.oy) * k;
    v.alt = K.diveAlt;
    const seg = Math.hypot(e.x - fromX, e.y - fromY);
    for (const p of alive(state)) {
      if (at.hitSlots.includes(p.slot)) continue;
      const vx = p.x - fromX, vy = p.y - fromY;
      const along = vx * at.dx + vy * at.dy;
      if (along < -e.radius || along > seg + e.radius) continue;
      if (Math.abs(-vx * at.dy + vy * at.dx) > e.radius + 0.3) continue;
      at.hitSlots.push(p.slot);
      hitHero(state, ev, e, p, a);
    }
  },
  release(state, ev, e, a) {
    dropTelegraphs(state, e, a.id);
    ev.push({ t: 'foe_fx', id: e.id, fx: 'drake_dive', x: e.x, y: e.y, tx: e.attack!.tx, ty: e.attack!.ty });
  },
  recover(state, _ev, e) {
    const at = e.attack!;
    [e.x, e.y] = floorNear(state.map!, at.tx, at.ty);
  },
  end(_state, _ev, e) { bv(e).alt = 0; },
};

const GALE: KitModule = {
  start(state, ev, e, a, target) {
    let [dx, dy] = norm(target.x - e.x, target.y - e.y);
    if (!dx && !dy) { dx = e.fx; dy = e.fy; }
    const t = addTelegraph(state, e, a.id, a.telegraph, e.x, e.y, dx, dy, releaseTickFor(state, e, a));
    beginModule(state, ev, e, a, dx, dy, target.x, target.y, t.id);
  },
  release(state, ev, e, a) {
    const at = e.attack!;
    const tg = a.telegraph.kind === 'cone' ? a.telegraph : { range: a.range, arcDeg: 70 };
    const ch = Math.cos((tg.arcDeg / 2) * Math.PI / 180);
    for (const p of alive(state)) if (inCone(e.x, e.y, at.dx, at.dy, tg.range, ch, p.x, p.y, 0.3)) hitHero(state, ev, e, p, a);
    state.hazards.push(makeHazard(state, {
      kind: 'gale', owner: 'enemy', ownerId: e.id, x: e.x, y: e.y, dx: at.dx, dy: at.dy, radius: tg.range, inner: ch, speed: SKY_FALL.pushSpeed,
      untilTick: state.tick + ticksFor(e, a.releaseSec), interval: 1, damage: enemyAttackDamage(state, e, a.damageCoef, false), dtype: a.damageType,
    }));
    dropTelegraphs(state, e, a.id);
    ev.push({ t: 'foe_fx', id: e.id, fx: 'drake_gale', x: e.x, y: e.y, tx: e.x + at.dx * tg.range, ty: e.y + at.dy * tg.range, r: tg.range });
  },
};

const FEATHERS: KitModule = {
  start(state, ev, e, a, target) {
    featherVolley(state, e, a.projectileCount ?? 5);
    const [dx, dy] = norm(target.x - e.x, target.y - e.y);
    beginModule(state, ev, e, a, dx, dy, target.x, target.y);
  },
};

const SOAR: KitModule = {
  start(state, ev, e, a, target) {
    home(state, e);
    const [dx, dy] = norm(target.x - e.x, target.y - e.y);
    beginModule(state, ev, e, a, dx, dy, target.x, target.y);
    ev.push({ t: 'foe_fx', id: e.id, fx: 'drake_takeoff', x: e.x, y: e.y });
  },
  tick(state, ev, e, a, stage, k) {
    const v = home(state, e), at = e.attack!;
    if (stage === 'windup') { v.alt = smooth(k); return; }
    if (stage === 'release') {
      // circling out of reach: orbit the arena centre, a feather volley every `duration` seconds
      v.alt = 1;
      v.ang += K.orbit * freqOf(e) * DT * v.dir;
      e.x = v.hx + Math.cos(v.ang) * v.or; e.y = v.hy + Math.sin(v.ang) * v.or;
      e.fx = -Math.sin(v.ang) * v.dir; e.fy = Math.cos(v.ang) * v.dir;
      if (state.tick >= v.nv) { featherVolley(state, e, a.projectileCount ?? 3); v.nv = state.tick + ticksFor(e, a.duration ?? 1.4); }
      return;
    }
    // the stoop: glide over the marked spot, then drop onto it
    const glide = smooth(Math.min(1, k / 0.72));
    e.x = v.sx + (v.lx - v.sx) * glide; e.y = v.sy + (v.ly - v.sy) * glide;
    v.alt = k < 0.72 ? 1 : 1 - smooth((k - 0.72) / 0.28);
    const [fx, fy] = norm(at.tx - e.x, at.ty - e.y);
    if (fx || fy) { e.fx = fx; e.fy = fy; }
  },
  release(state, _ev, e) {
    const v = home(state, e);
    e.dots = []; e.burning = false;   // nothing burns that high
    v.ang = Math.atan2(e.y - v.hy, e.x - v.hx);
    v.dir = e.patternIndex % 2 ? -1 : 1;
    v.nv = state.tick + ticksFor(e, 0.4);
  },
  recover(state, ev, e, a) {
    // pick the landing spot under a hero, on rock well clear of the brink
    const v = home(state, e), at = e.attack!;
    const target = chooseTarget(state, e);
    const [lx, ly] = safeSpot(state.map!, target ? target.x : v.hx, target ? target.y : v.hy, 1);
    v.sx = e.x; v.sy = e.y; v.lx = lx; v.ly = ly;
    at.tx = lx; at.ty = ly;
    addTelegraph(state, e, a.id, a.telegraph, lx, ly, 0, 0, state.tick + ticksFor(e, a.recoverySec));
  },
  end(state, ev, e, a) {
    // touchdown: the stoop strikes everyone under it and leaves the Wyrm winded on the ground
    const v = bv(e);
    e.x = v.lx; e.y = v.ly; v.alt = 0;
    const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 2.4;
    for (const p of alive(state)) if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 <= (R + 0.3) ** 2) hitHero(state, ev, e, p, a);
    dropTelegraphs(state, e, a.id);
    ev.push({ t: 'foe_fx', id: e.id, fx: 'drake_land', x: e.x, y: e.y, r: R });
    e.staggerUntil = state.tick + ticksFor(e, 2.6);
    e.state = 'stagger';
    ev.push({ t: 'stagger', id: e.id });
  },
};

const MODULES: Record<string, KitModule> = { dive: DIVE, gale: GALE, sweep: SWEEP, feathers: FEATHERS, soar: SOAR };

function approach(state: SimState, e: EnemyState, target: PlayerState): boolean {
  moveToward(state, e, target.x, target.y);
  e.state = 'move';
  e.stuckTimer += DT;
  if (e.stuckTimer > 3) { e.patternStep++; e.stuckTimer = 0; return false; }   // never stall a pattern forever
  return true;
}

registerBossKit(ID, {
  step(state: SimState, ev: SimEvent[], e: EnemyState) {
    const d0 = def();
    const v = home(state, e);
    if (e.attack) { stepModule(state, ev, e, d0, MODULES); return; }
    openPhase(e);
    // between modules the Wyrm is on the ground (a stagger can cut a dive short: land on rock)
    if (v.alt) v.alt = 0;
    if (state.map && isWallAt(state.map, e.x, e.y)) [e.x, e.y] = floorNear(state.map, e.x, e.y);
    const target = chooseTarget(state, e);
    if (!target) { e.state = 'idle'; return; }
    const d = distTo(e, target);
    const a = nextModule(e, d0);
    if (!a) {
      // between patterns: stalk to a striking distance, facing the prey
      if (d > 4.5) { moveToward(state, e, target.x, target.y); e.state = 'move'; } else e.state = 'idle';
      const [fx, fy] = norm(target.x - e.x, target.y - e.y); if (fx || fy) { e.fx = fx; e.fy = fy; }
      return;
    }
    if ((a.kind === 'sweep' && d > a.range + 0.5) || (a.kind === 'gale' && d > a.range - 1)) { approach(state, e, target); return; }
    e.stuckTimer = 0;
    MODULES[a.kind]?.start(state, ev, e, a, target);
    if (!e.attack) e.patternStep++;
  },
  // aloft only while a module carries it (a stagger drops it out of the sky)
  immune: (_state, e) => !!e.attack && (e.bvars?.alt ?? 0) >= 0.5,
  altitude: (_state, e) => (e.attack ? e.bvars?.alt ?? 0 : 0),
});

/** Gale: shove every hero in the cone (not dashing) away from the Wyrm; over the brink is the long fall. */
registerKitHazard('gale', (state, ev, h, owner) => {
  if (!owner || owner.state === 'dying') { h.untilTick = state.tick; return; }
  const fell = (h.vars ??= {});
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || p.iframes > 0 || fell['x' + p.slot]) continue;   // one fall per gale
    if (!inCone(h.x, h.y, h.dx, h.dy, h.radius, h.inner, p.x, p.y, 0.3)) continue;
    let [ux, uy] = norm(p.x - h.x, p.y - h.y);
    if (!ux && !uy) { ux = h.dx; uy = h.dy; }
    if (pushHero(state, ev, p, ux * h.speed * DT, uy * h.speed * DT, owner)) fell['x' + p.slot] = 1;
  }
});

/** Lightning feather: strikes its marked circle once, on release. */
registerKitHazard('stormfeather', (state, ev, h, owner) => {
  if (state.tick < (h.armTick ?? h.bornTick)) return;
  const a = attack('feathers');
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || (p.x - h.x) ** 2 + (p.y - h.y) ** 2 > (h.radius + 0.3) ** 2) continue;
    if (owner) hitHero(state, ev, owner, p, a, h.damage, h.x, h.y);
  }
  ev.push({ t: 'foe_fx', id: h.ownerId, fx: 'feather_strike', x: h.x, y: h.y, r: h.radius });
  h.untilTick = state.tick;   // spent
});
