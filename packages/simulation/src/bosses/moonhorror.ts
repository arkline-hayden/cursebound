import { BOSS_BY_ID, RULES, TICK_SEC, type EnemyAttackDef } from '@cursebound/content';
import { afflict } from '../afflictions';
import { chooseTarget, moveToward } from '../ai';
import { enemyAttackDamage } from '../combat';
import { inLine, isWallAt, norm, rayDistance } from '../geometry';
import { makeHazard } from '../players';
import { nextFloat } from '../rng';
import { B, fateFactor } from '../stats';
import {
  SWEEP, addTelegraph, alive, beginModule, bv, distTo, dropTelegraphs, floorNear, freqOf, hitHero, nextModule, openPhase,
  pushHero, registerBossKit, registerKitHazard, releaseTickFor, stepModule, ticksFor, type KitModule,
} from '../bosskit';
import type { EnemyState, PlayerState, SimEvent, SimState } from '../types';

// The Crater Horror (content MOON_HORROR), boss of the dead moon. It rises from the pit at the heart of its basin and
// stays rooted there (a short leash around its pit). Kit modules:
//   tentacles  Tentacle Eruption: marked circles under every hero and around them; tentacles burst out on release and
//              linger as swaying lanterns that lash anyone who stands against them ('tentacle' hazards).
//   gravwell   Gravity Well: a marked circle near the target; on release it drags heroes inside toward its core (a
//              steady pull, slower than walking: walk or dash out) and the core pulses damage ('gravwell').
//   voidbeam   Void Beam: the whole arc it will sweep is marked, with the starting edge drawn hard; the beam then sweeps
//              that arc from the eye, blocked by rock (hide behind a boulder), hitting at most every 0.4s ('voidbeam').
//   lowgrav    Low Gravity: marked zones under the heroes; on release they linger, slowing every step inside ('lowgrav').
//   lash       Maw Lash: the shared close-range cone (bosskit SWEEP), only when a hero stands within reach.
//   brood      Spawn the Brood (phase 2): crater spawn crawl out at marked spots around the pit (capped).
// Phase 2 (50%) darkens the basin except near the eye and the tentacle lanterns (presentation only).
// Counters (EnemyState.bvars): hx/hy the pit, ph phase opener, b0/b1 beam sweep angles.

const ID = 'moonhorror';
const DT = TICK_SEC;
const K = {
  lead: 0.5, spacing: 1.6, keepOff: 1.2, lashFrac: '0.3', lashRadius: 0.9, lashEvery: 0.8,
  wellPull: 2.2, wellCore: 1.1, wellPulse: 0.5, beamWidth: 1.0, beamHitEvery: 0.4, zoneSpacing: 2.6,
  broodCap: 6, leash: 1.2, maxTentacles: 8, maxZones: 6,
};

const def = () => BOSS_BY_ID[ID];
const attack = (id: string): EnemyAttackDef => def().attacks.find((a) => a.id === id)!;

function home(e: EnemyState): Record<string, number> {
  const v = bv(e);
  if (v.hx === undefined) { v.hx = e.x; v.hy = e.y; }
  return v;
}

/** Marked spots: under every hero (leading their run by `lead` seconds), then scattered around them. */
function spotsAround(state: SimState, e: EnemyState, want: number, lead: number, spacing: number, rMin: number, rMax: number): [number, number][] {
  const map = state.map!;
  const heroes = alive(state);
  const spots: [number, number][] = [];
  const clear = (x: number, y: number) => !isWallAt(map, x, y)
    && (x - e.x) ** 2 + (y - e.y) ** 2 >= (e.radius + K.keepOff) ** 2
    && spots.every(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 >= spacing ** 2);
  for (const p of heroes) {
    if (spots.length >= want) break;
    const [x, y] = floorNear(map, p.x + p.vx * lead, p.y + p.vy * lead);
    if (spots.every(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 >= spacing ** 2)) spots.push([x, y]);
  }
  for (let t = 0; t < want * 10 && spots.length < want && heroes.length; t++) {
    const p = heroes[t % heroes.length];
    const ang = nextFloat(state.rng.ai) * Math.PI * 2, r = rMin + nextFloat(state.rng.ai) * (rMax - rMin);
    const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
    if (clear(x, y)) spots.push([x, y]);
  }
  return spots;
}

const TENTACLES: KitModule = {
  start(state, ev, e, a, target) {
    const want = Math.min(K.maxTentacles, (a.projectileCount ?? 4) + alive(state).length - 1);
    const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 1;
    const release = releaseTickFor(state, e, a);
    const dmg = enemyAttackDamage(state, e, a.damageCoef, true);
    const every = ticksFor(e, K.lashEvery);
    for (const [x, y] of spotsAround(state, e, want, K.lead, K.spacing, 1.8, 4.5)) {
      addTelegraph(state, e, a.id, a.telegraph, x, y, 0, 0, release);
      state.hazards.push(makeHazard(state, {
        // inner: the burst tick, replicated for the client (the tentacle rises as the telegraph closes)
        kind: 'tentacle', owner: 'enemy', ownerId: e.id, x, y, radius: R, inner: release, armTick: release, untilTick: release + ticksFor(e, a.duration ?? 4.5),
        interval: every, nextTick: release + every, damage: dmg, dtype: a.damageType, vars: {},
      }));
    }
    const [dx, dy] = norm(target.x - e.x, target.y - e.y);
    beginModule(state, ev, e, a, dx, dy, target.x, target.y);
  },
};

const GRAVWELL: KitModule = {
  start(state, ev, e, a, target) {
    const [ux, uy] = norm(e.x - target.x, e.y - target.y);
    const [cx, cy] = floorNear(state.map!, target.x + ux * 1.2, target.y + uy * 1.2);
    const t = addTelegraph(state, e, a.id, a.telegraph, cx, cy, 0, 0, releaseTickFor(state, e, a));
    beginModule(state, ev, e, a, -ux, -uy, cx, cy, t.id);
  },
  release(state, ev, e, a) {
    const at = e.attack!;
    const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 4;
    const pulse = ticksFor(e, K.wellPulse);
    state.hazards.push(makeHazard(state, {
      kind: 'gravwell', owner: 'enemy', ownerId: e.id, x: at.tx, y: at.ty, radius: R, inner: K.wellCore, speed: K.wellPull,
      untilTick: state.tick + ticksFor(e, a.duration ?? 3), interval: pulse, nextTick: state.tick + pulse, damage: enemyAttackDamage(state, e, a.damageCoef, false), dtype: a.damageType,
    }));
    dropTelegraphs(state, e, a.id);
    ev.push({ t: 'foe_fx', id: e.id, fx: 'gravwell', x: at.tx, y: at.ty, r: R });
  },
};

const VOIDBEAM: KitModule = {
  start(state, ev, e, a, target) {
    const th = Math.atan2(target.y - e.y, target.x - e.x);
    const sign = e.patternIndex % 2 ? 1 : -1;
    const arc = a.telegraph.kind === 'cone' ? a.telegraph.arcDeg : 110;
    const half = (arc / 2) * Math.PI / 180;
    const v = bv(e);
    v.b0 = th - sign * half; v.b1 = th + sign * half;
    const release = releaseTickFor(state, e, a);
    // the arc it will sweep, and the hard edge it starts from
    addTelegraph(state, e, a.id, a.telegraph, e.x, e.y, Math.cos(th), Math.sin(th), release);
    addTelegraph(state, e, 'voidbeam_start', { kind: 'line', length: a.range, width: K.beamWidth }, e.x, e.y, Math.cos(v.b0), Math.sin(v.b0), release);
    beginModule(state, ev, e, a, Math.cos(th), Math.sin(th), target.x, target.y);
  },
  release(state, ev, e, a) {
    const v = bv(e);
    const dur = a.releaseSec / freqOf(e);
    state.hazards.push(makeHazard(state, {
      kind: 'voidbeam', owner: 'enemy', ownerId: e.id, x: e.x, y: e.y, dx: Math.cos(v.b0), dy: Math.sin(v.b0), length: a.range, width: K.beamWidth,
      speed: (v.b1 - v.b0) / Math.max(0.05, dur), untilTick: state.tick + ticksFor(e, a.releaseSec), interval: ticksFor(e, K.beamHitEvery),
      damage: enemyAttackDamage(state, e, a.damageCoef, true), dtype: a.damageType, vars: {},
    }));
    dropTelegraphs(state, e, a.id);
    dropTelegraphs(state, e, 'voidbeam_start');
    ev.push({ t: 'foe_fx', id: e.id, fx: 'voidbeam', x: e.x, y: e.y });
  },
  tick(state, _ev, e, _a, stage, k) {
    // the eye follows the sweep
    if (stage !== 'release') return;
    const v = bv(e);
    const ang = v.b0 + (v.b1 - v.b0) * k;
    e.fx = Math.cos(ang); e.fy = Math.sin(ang);
  },
};

const LOWGRAV: KitModule = {
  start(state, ev, e, a, target) {
    const want = Math.min(K.maxZones, (a.projectileCount ?? 3) + alive(state).length - 1);
    const release = releaseTickFor(state, e, a);
    for (const [x, y] of spotsAround(state, e, want, 0, K.zoneSpacing, 2, 4.5)) addTelegraph(state, e, a.id, a.telegraph, x, y, 0, 0, release);
    const [dx, dy] = norm(target.x - e.x, target.y - e.y);
    beginModule(state, ev, e, a, dx, dy, target.x, target.y);
  },
  release(state, ev, e, a) {
    const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 2;
    for (const t of state.telegraphs.filter((x) => x.ownerId === e.id && x.attack === a.id)) {
      state.hazards.push(makeHazard(state, {
        kind: 'lowgrav', owner: 'enemy', ownerId: e.id, x: t.x, y: t.y, radius: R, untilTick: state.tick + ticksFor(e, a.duration ?? 6), interval: 10,
        damage: B(0), dtype: a.damageType,
      }));
    }
    dropTelegraphs(state, e, a.id);
    ev.push({ t: 'foe_fx', id: e.id, fx: 'lowgrav', x: e.x, y: e.y });
  },
};

const BROOD: KitModule = {
  start(state, ev, e, a, target) {
    const n = a.summonCount ?? 2;
    const release = releaseTickFor(state, e, a);
    const a0 = Math.atan2(target.y - e.y, target.x - e.x);
    for (let i = 0; i < n; i++) {
      const ang = a0 + ((i + 0.5) / n - 0.5) * Math.PI * 0.9;
      const [x, y] = floorNear(state.map!, e.x + Math.cos(ang) * (e.radius + 1.3), e.y + Math.sin(ang) * (e.radius + 1.3));
      addTelegraph(state, e, a.id, a.telegraph, x, y, 0, 0, release);
    }
    beginModule(state, ev, e, a, Math.cos(a0), Math.sin(a0), target.x, target.y);
  },
  release(state, ev, e, a) {
    const q = fateFactor(state, 'encounter.spawnQuantity');
    for (const t of state.telegraphs.filter((x) => x.ownerId === e.id && x.attack === a.id)) {
      state.pendingSpawns.push({ kind: 'craterspawn', x: t.x, y: t.y, count: q, summonerId: e.id, objective: false, groupId: -1, hpMul: RULES.bossReinforceHealth, dmgMul: RULES.bossReinforceDamage });
      ev.push({ t: 'foe_fx', id: e.id, fx: 'brood_emerge', x: t.x, y: t.y });
    }
    dropTelegraphs(state, e, a.id);
  },
};

const MODULES: Record<string, KitModule> = { tentacle: TENTACLES, gravwell: GRAVWELL, beam: VOIDBEAM, slowzone: LOWGRAV, sweep: SWEEP, brood: BROOD };

const broodAlive = (state: SimState, e: EnemyState) => state.enemies.filter((o) => o.summonerId === e.id && o.kind === 'craterspawn' && o.state !== 'dying').length
  + state.pendingSpawns.filter((s) => s.summonerId === e.id && s.kind === 'craterspawn').length;

function face(e: EnemyState, p: PlayerState) {
  const [fx, fy] = norm(p.x - e.x, p.y - e.y);
  if (fx || fy) { e.fx = fx; e.fy = fy; }
}

registerBossKit(ID, {
  step(state: SimState, ev: SimEvent[], e: EnemyState) {
    const d0 = def();
    const v = home(e);
    if (e.attack) { stepModule(state, ev, e, d0, MODULES); return; }
    openPhase(e);
    const target = chooseTarget(state, e);
    if (!target) { e.state = 'idle'; return; }
    face(e, target);
    const d = distTo(e, target);
    const a = nextModule(e, d0);
    if (!a) {
      // rooted in its pit: lean toward the prey a little, never leave the crater
      if (d > 4) moveToward(state, e, target.x, target.y);
      const ox = e.x - v.hx, oy = e.y - v.hy, od = Math.hypot(ox, oy);
      if (od > K.leash) { e.x = v.hx + (ox / od) * K.leash; e.y = v.hy + (oy / od) * K.leash; }
      e.state = Math.abs(e.vx) + Math.abs(e.vy) > 0.01 && d > 4 ? 'move' : 'idle';
      face(e, target);
      return;
    }
    // nobody within reach of the lash, or the brood already crawling: move on to the next module
    if ((a.kind === 'sweep' && d > a.range + e.radius * 0.5) || (a.kind === 'brood' && broodAlive(state, e) >= K.broodCap)) { e.patternStep++; return; }
    MODULES[a.kind]?.start(state, ev, e, a, target);
    if (!e.attack) e.patternStep++;
  },
});

/** Tentacle: bursts out of its marked circle on release, then sways there as a lantern lashing whoever stands against it. */
registerKitHazard('tentacle', (state, ev, h, owner) => {
  if (state.tick < (h.armTick ?? h.bornTick)) return;
  if (!owner || owner.state === 'dying') { h.untilTick = state.tick; return; }
  const a = attack('tentacles');
  const vars = (h.vars ??= {});
  if (!vars.burst) {
    vars.burst = 1;
    for (const p of state.players) if (p.lifeState === 'alive' && (p.x - h.x) ** 2 + (p.y - h.y) ** 2 <= (h.radius + 0.3) ** 2) hitHero(state, ev, owner, p, a, h.damage, h.x, h.y);
    ev.push({ t: 'foe_fx', id: owner.id, fx: 'tentacle_burst', x: h.x, y: h.y, r: h.radius });
    return;
  }
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || (p.x - h.x) ** 2 + (p.y - h.y) ** 2 > (K.lashRadius + 0.3) ** 2) continue;
    hitHero(state, ev, owner, p, a, h.damage.mul(B(K.lashFrac)), h.x, h.y, true);
  }
});

/** Gravity well: drags heroes inside toward the core (walls stop it; i-frames ignore it), the core pulses damage. */
registerKitHazard('gravwell', (state, ev, h, owner) => {
  if (!owner || owner.state === 'dying') { h.untilTick = state.tick; return; }
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || p.iframes > 0) continue;
    const dx = h.x - p.x, dy = h.y - p.y, d = Math.hypot(dx, dy);
    if (d > h.radius + 0.3 || d < 0.15) continue;
    const step = Math.min(h.speed * DT, d - 0.1);
    pushHero(state, ev, p, (dx / d) * step, (dy / d) * step, owner);
  }
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  const a = attack('gravwell');
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || (p.x - h.x) ** 2 + (p.y - h.y) ** 2 > (h.inner + 0.3) ** 2) continue;
    hitHero(state, ev, owner, p, a, h.damage, h.x, h.y, true);
  }
});

/** The current direction of a sweeping void beam (also what the client draws). */
export function voidBeamDir(h: { dx: number; dy: number; speed: number; bornTick: number }, tick: number): [number, number] {
  const ang = Math.atan2(h.dy, h.dx) + h.speed * (tick - h.bornTick) * DT;
  return [Math.cos(ang), Math.sin(ang)];
}

/** Void beam: sweeps its arc from the eye; rock blocks it; each hero is hit at most once per interval. */
registerKitHazard('voidbeam', (state, ev, h, owner) => {
  if (!owner || owner.state === 'dying') { h.untilTick = state.tick; return; }
  const [ux, uy] = voidBeamDir(h, state.tick);
  const len = rayDistance(state.map!, h.x, h.y, ux, uy, h.length);
  const vars = (h.vars ??= {});
  const a = attack('voidbeam');
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || p.iframes > 0 || state.tick < (vars['n' + p.slot] ?? 0)) continue;
    if (!inLine(h.x, h.y, ux, uy, len, h.width / 2, p.x, p.y, 0.3)) continue;
    vars['n' + p.slot] = state.tick + h.interval;
    hitHero(state, ev, owner, p, a, h.damage, h.x, h.y);
  }
});

/** Low gravity: every step inside is slowed (refreshed while standing in it). */
registerKitHazard('lowgrav', (state, ev, h) => {
  if ((state.tick - h.bornTick) % h.interval !== 0) return;
  const inf = attack('lowgrav').inflict;
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || (p.x - h.x) ** 2 + (p.y - h.y) ** 2 > (h.radius + 0.25) ** 2) continue;
    afflict(state, ev, p, 'slowed', inf?.sec ?? 0.5, { value: inf?.value ?? 0.45, quietRefresh: true, srcId: h.ownerId });
  }
});
