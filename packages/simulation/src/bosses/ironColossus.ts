import { slagLava, type EnemyAttackDef } from '@cursebound/content';
import { hitPlayer } from '../combat';
import { dist2, norm } from '../geometry';
import { makeHazard } from '../players';
import { nextFloat, nextInt } from '../rng';
import { B, fateFactor, toFloatClamped } from '../stats';
import type { EnemyAttackState, EnemyState, Hazard, PlayerState, SimEvent, SimState } from '../types';
import {
  DT, T, aliveHeroes, beginAttack, bossName, bossPhaseTick, bv, clearTelegraphs, damageOf, face, floorNear, freq,
  hitHero, param, registerBossHazard, releaseTickOf, runPatterns, safeSpot, stepScripted, telegraph, walkToward, type ScriptedAttack, type StartResult,
} from './kit';
import { registerBossScript, type BotHint } from './registry';

// THE IRON COLOSSUS (content bosses/ironColossus.ts): the scripted AI of the Ember Forge's boss. A slow plodder that
// owns the floor instead of chasing: it walks after its target and only swings when the hammer can reach.
//   ic_hammer   impact circle ahead (telegraph circle + a ring hint), then 'ic_quake' ring hazards roll out from the
//               impact one after another: each ring has a gap (hazard dx/dy = gap direction, width = gap half-angle)
//               and is avoided by standing in the gap or by dodge i-frames as it passes.
//   ic_slag     an 'ic_slag' hazard centred on its feet: pattern (inner), parity (outer), radius, clear radius (width),
//               cell size (speed) and the arm delay in ticks (length) for the client; cells glow until armTick, then
//               burn heroes standing on lava (content slagLava, shared with the client) every params.slagTick.
//   ic_stomp    a short circle around itself (roots).
//   ic_overheat the furnace vents: staggerUntil runs for the attack's duration (vulnerable, BossDef.vulnerableMultiplier,
//               standing still) while an 'ic_heat' aura scalds anyone close.

const ID = 'ironcolossus';

// ---------------- quake hammer ----------------

function startHammer(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): StartResult {
  const reach = param(e, 'impactDist', 2.6) + param(e, 'impactRadius', 2.2) + 0.6;
  if (dist2(e.x, e.y, target.x, target.y) > reach * reach) {
    walkToward(state, e, target.x, target.y);
    e.state = 'move';
    return 'wait';
  }
  const [dx, dy] = norm(target.x - e.x, target.y - e.y);
  const dist = param(e, 'impactDist', 2.6);
  const [ix, iy] = floorNear(state, e.x + (dx || e.fx) * dist, e.y + (dy || e.fy) * dist);
  beginAttack(state, ev, e, a, ix, iy);
  const rt = releaseTickOf(state, e, a);
  const R = param(e, 'impactRadius', 2.2);
  telegraph(state, e, a.id, { kind: 'circle', radius: R }, ix, iy, 0, 0, rt);
  telegraph(state, e, a.id, { kind: 'ring', inner: R, outer: R + 1.6 }, ix, iy, 0, 0, rt);
  return 'started';
}

function releaseHammer(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, at: EnemyAttackState) {
  const R = param(e, 'impactRadius', 2.2);
  const dmg = damageOf(state, e, a);
  for (const p of aliveHeroes(state)) if (dist2(p.x, p.y, at.tx, at.ty) <= (R + 0.3) ** 2) hitHero(state, ev, e, p, dmg, a, { fromX: at.tx, fromY: at.ty });
  const n = e.phaseIndex >= 2 ? param(e, 'ringsLate', 3) : param(e, 'rings', 2);
  const speed = (a.projectileSpeed ?? 4) * toFloatClamped(fateFactor(state, 'enemy.projectileSpeed'), 1e6);
  const thick = param(e, 'ringThick', 0.7), reach = param(e, 'ringReach', 11), half = param(e, 'ringGap', 0.42);
  const ringDmg = dmg.mul(B(param(e, 'ringCoef', 0.55)));
  // rings roll out from the edge of the impact a beat after it lands (never on top of a hero that just stepped clear)
  const r0 = R + 0.2;
  for (let k = 0; k < n; k++) {
    const g = nextFloat(state.rng.ai) * Math.PI * 2;
    const born = state.tick + T((param(e, 'ringLead', 0.3) + k * param(e, 'ringDelay', 0.55)) / freq(e));
    state.hazards.push(makeHazard(state, {
      kind: 'ic_quake', owner: 'enemy', ownerId: e.id, x: at.tx, y: at.ty, dx: Math.cos(g), dy: Math.sin(g), width: half,
      inner: r0, outer: r0 + thick, speed, bornTick: born, untilTick: born + Math.ceil((reach - r0) / Math.max(0.1, speed) / DT), interval: 1,
      damage: ringDmg, dtype: a.damageType,
    }));
  }
  ev.push({ t: 'foe_fx', id: e.id, fx: 'ic_hammer', x: at.tx, y: at.ty, r: R });
  clearTelegraphs(state, e, a.id);
}

/** A ring's band this tick ([inner, outer] radius; null before it rolls out). */
function ringBand(state: SimState, h: Hazard): [number, number] | null {
  const age = (state.tick - h.bornTick) * DT;
  if (age < 0) return null;
  return [h.inner + h.speed * age, h.outer + h.speed * age];
}

/** Is the hero inside the ring's gap (angle within the half-width, allowing for the hero's body)? */
function inGap(h: Hazard, x: number, y: number, d: number): boolean {
  const a = Math.atan2(y - h.y, x - h.x), g = Math.atan2(h.dy, h.dx);
  let diff = Math.abs(a - g) % (Math.PI * 2);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff <= h.width - 0.3 / Math.max(0.8, d);
}

function tickQuake(state: SimState, ev: SimEvent[], h: Hazard) {
  const band = ringBand(state, h);
  if (!band) return;
  const owner = state.enemies.find((o) => o.id === h.ownerId);
  for (const p of aliveHeroes(state)) {
    if (h.hitSlots.includes(p.slot) || p.iframes > 0) continue;
    const d = Math.sqrt(dist2(p.x, p.y, h.x, h.y));
    if (d + 0.3 < band[0] || d - 0.3 > band[1] || inGap(h, p.x, p.y, d)) continue;
    h.hitSlots.push(p.slot);
    hitPlayer(state, ev, p, h.damage, { attack: 'Quake Ring', source: owner ? bossName(owner) : 'The Iron Colossus', fromX: h.x, fromY: h.y, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  }
}

// ---------------- slag flood ----------------

function startSlag(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState) {
  beginAttack(state, ev, e, a, target.x, target.y);
  const b = bv(e);
  let pattern = nextInt(state.rng.ai, 4);
  if (pattern === b.slagLast) pattern = (pattern + 1 + nextInt(state.rng.ai, 3)) % 4;
  b.slagLast = pattern;
  const arm = releaseTickOf(state, e, a);
  const cx = Math.floor(e.x) + 0.5, cy = Math.floor(e.y) + 0.5;
  state.hazards.push(makeHazard(state, {
    kind: 'ic_slag', owner: 'enemy', ownerId: e.id, x: cx, y: cy, radius: param(e, 'slagRadius', 9), width: param(e, 'slagSafe', 1.6),
    inner: pattern, outer: nextInt(state.rng.ai, 2), speed: param(e, 'slagCell', 2), length: arm - state.tick, armTick: arm,
    untilTick: arm + T((a.duration ?? 4.5) / freq(e)), nextTick: arm, interval: T(param(e, 'slagTick', 0.5)),
    damage: damageOf(state, e, a, false), dtype: a.damageType,
  }));
}

/** Is world point (x, y) on a lava cell of slag hazard h? */
export function onSlag(h: Hazard, x: number, y: number): boolean {
  return slagLava(h.inner, h.outer, Math.floor(h.x), Math.floor(h.y), Math.floor(x), Math.floor(y), h.radius, h.width, h.speed || 2);
}

function tickSlag(state: SimState, ev: SimEvent[], h: Hazard) {
  const arm = h.armTick ?? h.bornTick;
  if (state.tick === arm) ev.push({ t: 'foe_fx', id: h.ownerId, fx: 'ic_slag', x: h.x, y: h.y, r: h.radius });
  if (state.tick < arm || state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  const owner = state.enemies.find((o) => o.id === h.ownerId);
  for (const p of aliveHeroes(state)) {
    if (!onSlag(h, p.x, p.y)) continue;
    hitPlayer(state, ev, p, h.damage, { attack: 'Slag Flood', source: owner ? bossName(owner) : 'The Iron Colossus', fromX: p.x, fromY: p.y, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  }
}

// ---------------- stomp and overheat ----------------

function startStomp(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): StartResult {
  const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 3.2;
  if (dist2(e.x, e.y, target.x, target.y) > (R + 0.4) ** 2) {
    walkToward(state, e, target.x, target.y);
    e.state = 'move';
    return 'wait';
  }
  beginAttack(state, ev, e, a, target.x, target.y);
  telegraph(state, e, a.id, a.telegraph, e.x, e.y, 0, 0, releaseTickOf(state, e, a));
  return 'started';
}

function releaseStomp(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef) {
  const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 3.2;
  const dmg = damageOf(state, e, a);
  for (const p of aliveHeroes(state)) if (dist2(p.x, p.y, e.x, e.y) <= (R + 0.3) ** 2) hitHero(state, ev, e, p, dmg, a);
  ev.push({ t: 'foe_fx', id: e.id, fx: 'ic_stomp', x: e.x, y: e.y, r: R });
  clearTelegraphs(state, e, a.id);
}

function releaseOverheat(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef) {
  const until = state.tick + T((a.duration ?? 4.5) / freq(e));
  e.staggerUntil = until;
  e.stagger = 0;
  state.hazards.push(makeHazard(state, {
    kind: 'ic_heat', owner: 'enemy', ownerId: e.id, x: e.x, y: e.y, radius: param(e, 'heatRadius', 2.6), untilTick: until,
    interval: T(param(e, 'heatTick', 0.5)), nextTick: state.tick + T(0.4), damage: damageOf(state, e, a, false), dtype: a.damageType,
  }));
  ev.push({ t: 'foe_fx', id: e.id, fx: 'ic_overheat', x: e.x, y: e.y, r: param(e, 'heatRadius', 2.6) });
  ev.push({ t: 'stagger', id: e.id });
  // the module ends here: the vulnerable window is the stagger (the pattern moves on afterwards)
  e.attack = null;
  e.state = 'stagger';
  e.patternStep++;
}

function tickHeat(state: SimState, ev: SimEvent[], h: Hazard) {
  const owner = state.enemies.find((o) => o.id === h.ownerId);
  if (owner) { h.x = owner.x; h.y = owner.y; }
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  for (const p of aliveHeroes(state)) {
    if (dist2(p.x, p.y, h.x, h.y) > (h.radius + 0.2) ** 2) continue;
    hitPlayer(state, ev, p, h.damage, { attack: 'Furnace Heat', source: owner ? bossName(owner) : 'The Iron Colossus', fromX: h.x, fromY: h.y, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  }
}

// ---------------- the script ----------------

const ATTACKS: Record<string, ScriptedAttack> = {
  ic_hammer: { release: releaseHammer },
  ic_slag: {},   // the slag hazard arms itself at the release tick
  ic_stomp: { release: releaseStomp },
  ic_overheat: { release: releaseOverheat },
};

function start(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): StartResult {
  switch (a.id) {
    case 'ic_hammer': return startHammer(state, ev, e, a, target);
    case 'ic_slag': startSlag(state, ev, e, a, target); return 'started';
    case 'ic_stomp': return startStomp(state, ev, e, a, target);
    case 'ic_overheat': beginAttack(state, ev, e, a, target.x, target.y); return 'started';
    default: return 'skip';
  }
}

function step(state: SimState, ev: SimEvent[], e: EnemyState): boolean {
  bossPhaseTick(state, ev, e);
  if (e.staggerUntil > state.tick) {
    e.state = 'stagger'; e.vx = 0; e.vy = 0;
    if (e.attack) { clearTelegraphs(state, e, e.attack.attackId); e.attack = null; }
    return true;
  }
  if (e.state === 'stagger') e.state = 'idle';
  if (stepScripted(state, ev, e, ATTACKS)) return true;
  runPatterns(state, ev, e, (target) => {
    // plod after the target between patterns; stand and loom once it is close
    if (target && dist2(e.x, e.y, target.x, target.y) > 3.4 * 3.4) { walkToward(state, e, target.x, target.y); e.state = 'move'; }
    else { if (target) face(e, target.x, target.y); e.vx = 0; e.vy = 0; e.state = 'idle'; }
  }, (a, target) => start(state, ev, e, a, target));
  return true;
}

// ---------------- reference player hints (bot.ts) ----------------

function botHint(state: SimState, p: PlayerState, e: EnemyState): BotHint | null {
  // quake rings first: roll through a ring about to reach the hero (unless standing in its gap)
  for (const h of state.hazards) {
    if (h.kind !== 'ic_quake' || h.ownerId !== e.id || h.hitSlots.includes(p.slot)) continue;
    const age = (state.tick - h.bornTick) * DT;
    if (age < -0.12) continue;
    const band = ringBand(state, h) ?? [h.inner, h.outer];
    const d = Math.sqrt(dist2(p.x, p.y, h.x, h.y));
    if (inGap(h, p.x, p.y, d)) continue;
    // the ring grows outward: it reaches the hero when its outer edge does, and has passed once its inner edge has
    const approach = d - 0.3 - band[1];
    if (approach < 0.7 && d + 0.3 >= band[0]) return { x: h.x, y: h.y, dodge: true };
  }
  // slag: step onto a clear cell before (and while) it burns
  const slag = state.hazards.filter((h) => h.kind === 'ic_slag' && h.ownerId === e.id);
  if (slag.length) {
    const s = safeSpot(state, p, (x, y) => slag.some((h) => onSlag(h, x, y)), 5);
    if (s) return s;
  }
  return null;
}

registerBossScript(ID, { step, botHint });

registerBossHazard('ic_quake', tickQuake);
registerBossHazard('ic_slag', tickSlag);
registerBossHazard('ic_heat', tickHeat);
