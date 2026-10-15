import { Big } from '@cursebound/numeric';
import { AFFLICTION_RULES, BOSS_BY_ID, ENEMY_BY_ID, RULES, TICK_SEC, type EnemyAttackDef } from '@cursebound/content';
import { dropPatch, inflictHit, pushPlayer } from './afflictions';
import { enemyAttackDamage, hitPlayer, tickDots } from './combat';
import { inCone, inLine, lineOfSight, moveCircle, norm, rayDistance, dist2 } from './geometry';
import { findPath, nearestFloor, tileCenter } from './map';
import { hooks } from './hooks';
import { actMul, isFrozen, lureGoal, moveMul } from './cc';
import { inCinematic } from './cinematic';
import { stepKnock } from './knock';
import { bossReinforcements } from './director';
import { bossImmune, bossScript } from './bosses/registry';
import { makeHazard } from './players';
import { nextFloat, nextInt } from './rng';
import { B, ONE, fateFactor, toFloatClamped } from './stats';
import type { EnemyState, Hazard, PlayerState, Projectile, SimEvent, SimState, Telegraph } from './types';

// Enemy intelligence (PRD §14.2): deterministic utility selection above finite state actions, staggered
// perception, A* paths with replanning and stuck recovery, blackboard target reservations, readable
// windup -> release -> recovery attacks. AI never reads inputs, cursor or private loadouts — only visible state.
// Tactics: focus the wounded and the isolated, surround instead of queueing, kite toward open floor, strafe at range,
// casters behind the front line, cowards regroup when hurt, and nobody stands in a hero's fire (constants: AI).

const DT = TICK_SEC;
const DT_B = B(TICK_SEC);
const ZERO = Big.ZERO;
const MAX_PROJECTILE_SPEED = 1e6;

/**
 * Tactics tuning (sim 1.2). Target focus: + focusLowHp x missing health fraction, + focusIsolated when no other hero stands
 * within isolatedR. Melee foes spread onto surround slots once within surroundFrom of their hero. Skirmishers strafe
 * (orbit radians per perception). Casters hold range behind the nearest melee ally within backlineR. Cowards below
 * cowardBelow health fall back to allies within regroupR for fleeSec, once. Foes leave hero ground effects with at
 * least evadeMinTicks left.
 */
const AI = {
  focusLowHp: 4, focusIsolated: 2, isolatedR: 4.5,
  surroundFrom: 4.5, orbit: 0.45, backlineR: 7,
  cowardBelow: 0.3, regroupR: 10, fleeSec: 2.5,
  evadeMinTicks: 30,
};
/** Roles that break off and regroup when badly hurt (ranged casters and skirmishers; melee bruisers never do). */
const COWARDS = new Set(['skirmisher', 'artillery', 'hexer', 'broodcaller', 'wraith', 'shade', 'weaver', /* theme foes */ 'gale', 'blinker']);
/** Roles that keep a melee ally between themselves and the hero. */
const BACKLINE = new Set(['artillery', 'hexer', 'broodcaller', 'weaver', /* theme foes */ 'gale', 'sentry']);

/** Display name of an enemy for recaps and hit sources (a named mini-boss goes by its own name, minibosses.ts). */
function foeName(e: EnemyState): string {
  return e.mini?.name ?? (e.boss ? BOSS_BY_ID[e.kind].name : ENEMY_BY_ID[e.kind].name);
}

function attackDefs(e: EnemyState): EnemyAttackDef[] {
  return e.boss ? BOSS_BY_ID[e.kind].attacks : ENEMY_BY_ID[e.kind].attacks;
}

function alivePlayers(state: SimState): PlayerState[] {
  return state.players.filter((p) => p.lifeState === 'alive');
}

function freq(e: EnemyState): number {
  return toFloatClamped(e.attackFreq, 1e12);
}

// ---------------- Perception & utility ----------------

export function chooseTarget(state: SimState, e: EnemyState): PlayerState | null {
  const alive = alivePlayers(state);
  if (!alive.length) return null;
  // blackboard reservations: melee roles avoid stacking more than 3 attackers on one player
  const reservations = new Map<number, number>();
  for (const o of state.enemies) if (o !== e && o.targetSlot !== null && o.state !== 'dying') reservations.set(o.targetSlot, (reservations.get(o.targetSlot) ?? 0) + 1);
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const p of alive) {
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    const def = e.boss ? null : ENEMY_BY_ID[e.kind];
    const sight = def ? def.perception.sight : 30;
    const visible = d <= sight && lineOfSight(state.map!, e.x, e.y, p.x, p.y);
    let score = -d;
    if (visible) score += 6;
    if (e.targetSlot === p.slot) score += 3;            // hysteresis
    const r = reservations.get(p.slot) ?? 0;
    if (def && (def.role === 'pursuer' || def.role === 'summon') && r >= 3) score -= 5;
    // predators: press the wounded and pick off heroes standing alone (visible state only: health bars, positions)
    if (def && d <= sight) {
      score += AI.focusLowHp * (1 - Math.min(1, p.hp.ratio(p.maxHp)));
      if (alive.length > 1 && alive.every((o) => o === p || dist2(o.x, o.y, p.x, p.y) > AI.isolatedR * AI.isolatedR)) score += AI.focusIsolated;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function inAimLane(state: SimState, e: EnemyState): boolean {
  for (const p of alivePlayers(state)) {
    const vx = e.x - p.x, vy = e.y - p.y;
    const along = vx * p.aimX + vy * p.aimY;
    if (along < 0 || along > 10) continue;
    if (Math.abs(-vx * p.aimY + vy * p.aimX) < 0.9) return true;
  }
  // visible incoming player projectiles
  for (const pr of state.projectiles) {
    if (pr.owner !== 'player') continue;
    const vx = e.x - pr.x, vy = e.y - pr.y;
    const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy) || 1;
    const along = (vx * pr.vx + vy * pr.vy) / sp;
    if (along < 0 || along > 4) continue;
    if (Math.abs(-vx * pr.vy + vy * pr.vx) / sp < e.radius + 0.4) return true;
  }
  return false;
}

function readyAttack(state: SimState, e: EnemyState, target: PlayerState | null): EnemyAttackDef | null {
  if (!target) return null;
  const d = Math.sqrt(dist2(e.x, e.y, target.x, target.y));
  for (const a of attackDefs(e)) {
    if ((e.cooldowns[a.id] ?? 0) > 0) continue;
    if (a.kind === 'shield') {
      if (!wardCandidate(state, e, a.range)) continue;
      return a;
    }
    if (a.kind === 'summon') {
      const alive = state.enemies.filter((o) => o.summonerId === e.id && o.state !== 'dying').length;
      if (alive >= 6) continue;
      if (d > a.range) continue;
      return a;
    }
    if (d > a.range + 0.3) continue;
    if (a.minRange !== undefined && d < a.minRange) continue;   // leaps want a gap to close (theme foes)
    if (a.kind !== 'lob' && !lineOfSight(state.map!, e.x, e.y, target.x, target.y)) continue;
    return a;
  }
  return null;
}

/** Glitch Wraith blink: a floor point at its preferred range from the target, off to one side, in sight of it. */
function blinkSpot(state: SimState, e: EnemyState, target: PlayerState): [number, number] {
  const def = ENEMY_BY_ID[e.kind];
  const want = def ? (def.preferredRange[0] + def.preferredRange[1]) / 2 : 5;
  const base = Math.atan2(e.y - target.y, e.x - target.x);
  for (let k = 0; k < 6; k++) {
    const off = (0.9 + nextFloat(state.rng.ai) * 0.9) * (nextInt(state.rng.ai, 2) ? 1 : -1);
    const [x, y] = nearestFloor(state.map!, target.x + Math.cos(base + off) * want, target.y + Math.sin(base + off) * want);
    if (dist2(x, y, target.x, target.y) > 4 && lineOfSight(state.map!, x, y, target.x, target.y)) return [x, y];
  }
  return [e.x, e.y];
}

function wardCandidate(state: SimState, e: EnemyState, range: number): EnemyState | null {
  let best: EnemyState | null = null; let bf = 0.75;
  for (const o of state.enemies) {
    if (o === e || o.state === 'dying' || o.boss || o.cohort.count.isZero()) continue;
    if (dist2(o.x, o.y, e.x, e.y) > range * range) continue;
    if (o.shieldUntil > state.tick) continue;
    const fr = o.cohort.unitHp.sub(o.cohort.spread).sub(o.cohort.front).ratio(o.cohort.unitHp);
    if (fr < bf) { bf = fr; best = o; }
  }
  return best;
}

/** Damaging player ground effect the enemy stands in (fireline, pools, storms, fields), nearest centre first; null if none. */
function playerHazardAt(state: SimState, e: EnemyState): Hazard | null {
  for (const h of state.hazards) {
    if (h.owner !== 'player' || h.damage.isZero() || h.untilTick - state.tick < AI.evadeMinTicks) continue;
    if (h.length > 0 && h.width > 0) { if (inLine(h.x, h.y, h.dx, h.dy, h.length, h.width / 2, e.x, e.y, e.radius)) return h; }
    else if (h.radius > 0 && dist2(h.x, h.y, e.x, e.y) <= (h.radius + e.radius) ** 2) return h;
  }
  return null;
}

/**
 * Surround slots: melee foes on the same hero spread around it instead of queueing in a conga line. Every melee foe
 * on the target takes the angle of its rank (by id) around the hero, rotated to where the lowest-id member stands.
 */
function surroundSlot(state: SimState, e: EnemyState, target: PlayerState): number {
  let k = 0, m = 0, lead: EnemyState | null = null;
  for (const o of state.enemies) {
    if (o.boss || o.state === 'dying' || o.dormant || o.targetSlot !== target.slot) continue;
    const od = ENEMY_BY_ID[o.kind];
    if (!od || od.preferredRange[1] > 2) continue;
    if (!lead || o.id < lead.id) lead = o;
    if (o.id < e.id) k++;
    m++;
  }
  if (m <= 1 || !lead) return Math.atan2(e.y - target.y, e.x - target.x);
  return Math.atan2(lead.y - target.y, lead.x - target.x) + (k / m) * Math.PI * 2;
}

function perceive(state: SimState, e: EnemyState) {
  const def = ENEMY_BY_ID[e.kind];
  const target = chooseTarget(state, e);
  e.targetSlot = target ? target.slot : null;
  if (!target) { e.action = 'idle'; e.utility = {}; return; }
  const d = Math.sqrt(dist2(e.x, e.y, target.x, target.y));
  const [pmin, pmax] = def.preferredRange;
  const u = def.utility;
  const engaged = state.enemies.filter((o) => o !== e && o.targetSlot === target.slot && o.state !== 'dying').length;
  const ready = readyAttack(state, e, target);
  // cowards (casters and skirmishers) break off once, badly hurt, and fall back to their allies
  const hurt = e.cohort.count.lte(ONE) && cohortFrac(e) < AI.cowardBelow;
  const fleeing = (e.fleeUntil ?? 0) > state.tick;
  const inFire = pmax > 2 ? playerHazardAt(state, e) : null;
  const scores: Record<string, number> = {
    pursue: (u.pursue ?? 0) * (d > pmax ? 1 : 0.1),
    retreat: (u.retreat ?? 0) * (d < pmin ? 1.2 : 0),
    flank: (u.flank ?? 0) * (engaged >= 2 ? 0.8 : 0.25) * (d < pmax + 4 ? 1 : 0.3),
    cast: (u.cast ?? 0) * (ready ? 1.5 : 0),
    reposition: (u.reposition ?? 0) * (inAimLane(state, e) ? 1.4 : 0.05),
    guard: (u.guard ?? 0) * (state.enemies.some((o) => o !== e && !o.boss && o.state !== 'dying' && o.kind !== 'guardian') ? 0.7 : 0),
    rescue: (u.rescue ?? 0) * (ready && ready.kind === 'shield' ? 2 : 0),
    // ranged foes step out of a hero's lingering fire / storm / pool (melee packs are mindless and charge through)
    evade: inFire && pmax > 2 ? (0.3 + (u.reposition ?? 0)) * 1.8 : 0,
    regroup: fleeing ? 9 : COWARDS.has(def.role) && hurt && !e.fled ? 3 : 0,
  };
  let best = 'pursue', bs = -1;
  for (const k of ['regroup', 'cast', 'rescue', 'evade', 'reposition', 'retreat', 'flank', 'guard', 'pursue']) {
    if ((scores[k] ?? 0) > bs) { bs = scores[k]; best = k; }
  }
  if (best === 'regroup' && !fleeing) { e.fled = 1; e.fleeUntil = state.tick + Math.round(AI.fleeSec / DT); }
  if (best === 'pursue' && pmax <= 2) e.slotAng = surroundSlot(state, e, target);
  e.utility = scores;
  e.action = best;
}

const cohortFrac = (e: EnemyState) => e.cohort.unitHp.sub(e.cohort.spread).sub(e.cohort.front).ratio(e.cohort.unitHp);

/** Of a few headings away from (fx, fy), the one with the most open floor ahead (kiting never backs into a wall). */
function openRetreat(state: SimState, e: EnemyState, fx: number, fy: number, dist: number): [number, number] {
  let bx = e.x + fx * dist, by = e.y + fy * dist, bf = -1;
  for (const a of [0, 0.7, -0.7, 1.4, -1.4]) {
    const c = Math.cos(a), s = Math.sin(a);
    const dx = fx * c - fy * s, dy = fx * s + fy * c;
    const free = rayDistance(state.map!, e.x, e.y, dx, dy, dist);
    if (free > bf + 0.25) { bf = free; bx = e.x + dx * Math.max(0.5, free - 0.4); by = e.y + dy * Math.max(0.5, free - 0.4); }
  }
  return nearestFloor(state.map!, bx, by);
}

function goalFor(state: SimState, e: EnemyState, target: PlayerState): [number, number] {
  const def = ENEMY_BY_ID[e.kind];
  const [pmin, pmax] = def.preferredRange;
  const [tx, ty] = norm(target.x - e.x, target.y - e.y);
  switch (e.action) {
    case 'retreat': return openRetreat(state, e, -tx, -ty, 3);   // kite: back off toward open floor
    case 'evade': {
      const h = playerHazardAt(state, e);
      if (!h) return [e.x, e.y];
      let ox: number, oy: number, reach: number;
      if (h.length > 0 && h.width > 0) {
        // a line: step out sideways, on the side the foe already leans to
        const side = (e.x - h.x) * -h.dy + (e.y - h.y) * h.dx >= 0 ? 1 : -1;
        ox = -h.dy * side; oy = h.dx * side; reach = h.width / 2 + e.radius + 0.6;
      } else {
        [ox, oy] = norm(e.x - h.x, e.y - h.y);
        if (ox === 0 && oy === 0) { ox = -tx; oy = -ty; }
        reach = Math.max(0.5, h.radius + e.radius + 0.6 - Math.sqrt(dist2(e.x, e.y, h.x, h.y)));
      }
      return nearestFloor(state.map!, e.x + ox * reach, e.y + oy * reach);
    }
    case 'regroup': {
      // fall back to the nearest allies (their centre), else straight away from the hero
      let cx = 0, cy = 0, n = 0;
      for (const o of state.enemies) {
        if (o === e || o.boss || o.state === 'dying' || o.dormant || dist2(o.x, o.y, e.x, e.y) > AI.regroupR * AI.regroupR) continue;
        if (dist2(o.x, o.y, target.x, target.y) <= dist2(e.x, e.y, target.x, target.y)) continue;   // only allies further back
        cx += o.x; cy += o.y; n++;
      }
      return n ? nearestFloor(state.map!, cx / n, cy / n) : openRetreat(state, e, -tx, -ty, 5);
    }
    case 'flank': {
      const r = (pmin + pmax) / 2 + 1;
      return nearestFloor(state.map!, target.x - ty * r * e.strafeSign - tx * 0.5, target.y + tx * r * e.strafeSign - ty * 0.5);
    }
    case 'reposition': return nearestFloor(state.map!, e.x - ty * 2.5 * e.strafeSign, e.y + tx * 2.5 * e.strafeSign);
    case 'guard': {
      let ally: EnemyState | null = null; let bd = Infinity;
      for (const o of state.enemies) {
        if (o === e || o.boss || o.state === 'dying' || o.kind === 'guardian') continue;
        const d2 = dist2(o.x, o.y, e.x, e.y);
        if (d2 < bd) { bd = d2; ally = o; }
      }
      if (!ally) return [target.x, target.y];
      const [ax, ay] = norm(target.x - ally.x, target.y - ally.y);
      return nearestFloor(state.map!, ally.x + ax * 1.4, ally.y + ay * 1.4);
    }
    default: {
      const want = def.preferredRange[1] > 2 ? (pmin + pmax) / 2 : 0;
      if (want <= 0) {
        // melee: close in on an assigned surround slot (spread around the hero, no conga line); straight on when far
        const d = Math.sqrt(dist2(e.x, e.y, target.x, target.y));
        if (e.slotAng === undefined || d > AI.surroundFrom) return [target.x, target.y];
        const ring = Math.max(0.6, Math.min(1.2, pmax + 0.2) + e.radius * 0.5);
        const [sx, sy] = nearestFloor(state.map!, target.x + Math.cos(e.slotAng) * ring, target.y + Math.sin(e.slotAng) * ring);
        return lineOfSight(state.map!, sx, sy, target.x, target.y) ? [sx, sy] : [target.x, target.y];
      }
      // casters stay behind their front line: hold range on the far side of the nearest melee ally
      let ax = -tx, ay = -ty;
      if (BACKLINE.has(def.role)) {
        let front: EnemyState | null = null, fd = AI.backlineR * AI.backlineR;
        for (const o of state.enemies) {
          if (o === e || o.boss || o.state === 'dying' || o.dormant) continue;
          const od = ENEMY_BY_ID[o.kind];
          if (!od || od.preferredRange[1] > 2) continue;
          const d2o = dist2(o.x, o.y, e.x, e.y);
          if (d2o < fd) { fd = d2o; front = o; }
        }
        if (front) { const [fx, fy] = norm(front.x - target.x, front.y - target.y); if (fx || fy) { ax = fx; ay = fy; } }
      } else {
        // skirmishers circle at range (strafe), so they are never a standing target
        const c = Math.cos(AI.orbit * e.strafeSign), s = Math.sin(AI.orbit * e.strafeSign);
        const [rx, ry] = norm(e.x - target.x, e.y - target.y);
        if (rx || ry) { ax = rx * c - ry * s; ay = rx * s + ry * c; }
      }
      return nearestFloor(state.map!, target.x + ax * want, target.y + ay * want);
    }
  }
}

export function moveToward(state: SimState, e: EnemyState, gx: number, gy: number) {
  const map = state.map!;
  let wx = gx, wy = gy;
  if (!lineOfSight(map, e.x, e.y, gx, gy)) {
    const goalTile = Math.floor(gy) * map.w + Math.floor(gx);
    if (!e.path.length || e.pathAge > 45 || e.pathGoal !== goalTile) {
      e.path = findPath(map, e.x, e.y, gx, gy);
      e.pathGoal = goalTile;
      e.pathAge = 0;
    }
    // advance along path, skipping nodes we can see past
    while (e.path.length > 1) {
      const [nx, ny] = tileCenter(map, e.path[1]);
      if (lineOfSight(map, e.x, e.y, nx, ny)) e.path.shift(); else break;
    }
    if (e.path.length) [wx, wy] = tileCenter(map, e.path[0]);
  } else {
    e.path = [];
  }
  const [dx, dy] = norm(wx - e.x, wy - e.y);
  const d = Math.sqrt(dist2(e.x, e.y, wx, wy));
  const step = Math.min(d, e.moveSpeed * moveMul(state, e) * DT);   // chill slows, freeze / snare stop (cc.ts)
  if (step <= 1e-6) { e.vx = 0; e.vy = 0; return; }
  const r = moveCircle(map, e.x, e.y, dx * step, dy * step, Math.min(e.radius, 0.6));
  e.vx = (r.x - e.x) / DT; e.vy = (r.y - e.y) / DT;
  e.x = r.x; e.y = r.y;
  if (Math.abs(dx) + Math.abs(dy) > 0) { e.fx = dx; e.fy = dy; }
}

function stuckCheck(state: SimState, e: EnemyState) {
  e.stuckTimer += DT;
  if (e.stuckTimer < 2) return;
  const moved = Math.sqrt(dist2(e.x, e.y, e.lastProgressX, e.lastProgressY));
  if (moved < 0.3 && e.action !== 'cast' && e.state !== 'windup') {
    // deterministic alternative movement: flip strafe side and force replanning; never teleport into players
    e.strafeSign = -e.strafeSign;
    e.path = [];
    const ang = nextInt(state.rng.ai, 8);
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const r = moveCircle(state.map!, e.x, e.y, dirs[ang][0] * 0.5, dirs[ang][1] * 0.5, Math.min(e.radius, 0.6));
    e.x = r.x; e.y = r.y;
  }
  e.stuckTimer = 0;
  e.lastProgressX = e.x; e.lastProgressY = e.y;
}

// ---------------- Attacks ----------------

function addTelegraph(state: SimState, e: EnemyState, a: EnemyAttackDef, x: number, y: number, dx: number, dy: number, releaseTick: number): number {
  const t: Telegraph = { id: state.nextId++, ownerId: e.id, shape: a.telegraph, x, y, dx, dy, startTick: state.tick, releaseTick, attack: a.id };
  state.telegraphs.push(t);
  return t.id;
}

function startAttack(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState | null) {
  const f = freq(e);
  let tx = target ? target.x : e.x + e.fx * 3, ty = target ? target.y : e.y + e.fy * 3;
  if (a.kind === 'lob' && target) {
    // aim at a sampled trajectory of the visible player motion (no input reading)
    const flight = Math.sqrt(dist2(e.x, e.y, tx, ty)) / ((a.projectileSpeed ?? 7) * toFloatClamped(fateFactor(state, 'enemy.projectileSpeed'), MAX_PROJECTILE_SPEED));
    const lead = Math.min(1.5, (a.windupSec / f) + flight);
    [tx, ty] = nearestFloor(state.map!, tx + target.vx * lead * 0.7, ty + target.vy * lead * 0.7);
  }
  if (a.kind === 'shield') {
    const ally = wardCandidate(state, e, a.range);
    if (ally) { tx = ally.x; ty = ally.y; }
  }
  // theme foes: a blink marks where it will reappear; a leap marks where it will land (on open floor)
  if (a.kind === 'blink' && target) [tx, ty] = blinkSpot(state, e, target);
  else if (a.kind === 'leap') [tx, ty] = nearestFloor(state.map!, tx, ty);
  let [dx, dy] = norm(tx - e.x, ty - e.y);
  if (dx === 0 && dy === 0) { dx = e.fx; dy = e.fy; }
  e.fx = dx; e.fy = dy;
  const windup = a.windupSec / f;
  const releaseTick = state.tick + Math.max(0, Math.round(windup / DT));
  // circles sit on the target point, except self-centred ones (slam, summon, shield and the theme foes' quake)
  const selfCentred = a.kind === 'slam' || a.kind === 'summon' || a.kind === 'shield' || a.kind === 'quake';
  const ox = (a.telegraph.kind === 'circle' && !selfCentred) ? tx : e.x;
  const oy = (a.telegraph.kind === 'circle' && !selfCentred) ? ty : e.y;
  let telegraphId = -1;
  if (a.kind !== 'lightpool' && a.kind !== 'rootwall') telegraphId = addTelegraph(state, e, a, ox, oy, dx, dy, releaseTick);
  else {
    // multi-shape telegraphs
    const n = a.projectileCount ?? 3;
    const players = alivePlayers(state);
    for (let i = 0; i < n; i++) {
      if (a.kind === 'lightpool') {
        const p = players[i % Math.max(1, players.length)];
        const px = p ? p.x : tx, py = p ? p.y : ty;
        const jx = (nextFloat(state.rng.ai) - 0.5) * 2.4 * (i >= players.length ? 1 : 0.3), jy = (nextFloat(state.rng.ai) - 0.5) * 2.4 * (i >= players.length ? 1 : 0.3);
        const [lx, ly] = nearestFloor(state.map!, px + jx, py + jy);
        addTelegraph(state, e, a, lx, ly, 0, 0, releaseTick);
      } else {
        const spreadA = (i - (n - 1) / 2) * 0.45;
        const c = Math.cos(spreadA), s = Math.sin(spreadA);
        addTelegraph(state, e, a, e.x, e.y, dx * c - dy * s, dx * s + dy * c, releaseTick);
      }
    }
  }
  e.attack = { attackId: a.id, stage: 'windup', timer: windup, ox, oy, dx, dy, tx, ty, hitSlots: [], telegraphId };
  e.state = 'windup';
  ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'windup' });
}

function spawnEnemyProjectiles(state: SimState, e: EnemyState, a: EnemyAttackDef, dx: number, dy: number, count: Big, damage: Big, kind: string, lobTarget?: { x: number; y: number; radius: number }) {
  const total = count.floorInt() > 0n ? count.floorInt() : 1n;
  const reps = total < 5n ? Number(total) : 5;
  const base = total / BigInt(reps);
  const residue = Number(total % BigInt(reps));
  const speed = (a.projectileSpeed ?? 8) * toFloatClamped(fateFactor(state, 'enemy.projectileSpeed'), MAX_PROJECTILE_SPEED);
  for (let i = 0; i < reps; i++) {
    const ang = reps === 1 ? 0 : (i - (reps - 1) / 2) * 0.22;
    const c = Math.cos(ang), s = Math.sin(ang);
    const vx = dx * c - dy * s, vy = dx * s + dy * c;
    let lt: Projectile['lobTarget'] = null;
    if (lobTarget) {
      const ox = lobTarget.x + (reps > 1 ? (i - (reps - 1) / 2) * 0.9 * -dy : 0);
      const oy = lobTarget.y + (reps > 1 ? (i - (reps - 1) / 2) * 0.9 * dx : 0);
      const d = Math.sqrt(dist2(e.x, e.y, ox, oy));
      const flightTicks = Math.max(1, Math.round(d / Math.max(0.001, speed) / DT));
      lt = { x: ox, y: oy, radius: lobTarget.radius, landTick: state.tick + Math.min(flightTicks, 600) };
    }
    state.projectiles.push({
      id: state.nextId++, kind, owner: 'enemy', ownerId: e.id, x: e.x + vx * e.radius, y: e.y + vy * e.radius,
      vx: vx * speed, vy: vy * speed, radius: kind === 'orb' ? 0.3 : kind === 'hook' ? 0.28 : 0.2, range: a.range + 2,
      damage, weight: Big.from(base + (i < residue ? 1n : 0n)), dtype: a.damageType, pierce: 0, hitIds: [], skillId: a.id,
      crit: false, lobTarget: lt, bornTick: state.tick,
    });
  }
}

/** Resolve an attack release. `mult` is the logical attack multiplicity (rapid cadence aggregation). */
function releaseAttack(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, mult: Big) {
  const at = e.attack!;
  const dmgDirect = enemyAttackDamage(state, e, a.damageCoef, true).mul(mult);
  const dmgHazard = enemyAttackDamage(state, e, a.damageCoef, false).mul(mult);
  const src = foeName(e);
  const hit = (p: PlayerState, amount: Big, hazard = false) => {
    const iframed = p.iframes > 0;
    const dealt = hitPlayer(state, ev, p, amount, { attack: a.name, source: src, fromX: e.x, fromY: e.y, dtype: a.damageType, hazard, srcId: e.id });
    // authored affliction (afflictions.ts): dodge i-frames avoid it along with the damage
    if (a.inflict && !iframed) inflictHit(state, ev, p, a.id, { srcId: e.id, source: src, attack: a.name, damage: amount });
    // knockback (theme foes: the Gale Wisp's gust shoves heroes out of its circle); i-frames avoid it too
    if (a.push && !iframed) pushPlayer(state, ev, p, at.ox, at.oy, a.push, e.id);
    return dealt;
  };
  ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'release' });
  const projCount = B(a.projectileCount ?? 1).mul(fateFactor(state, 'enemy.projectileCount'));
  switch (a.kind) {
    case 'melee':
    case 'sweep': {
      const tg = a.telegraph.kind === 'cone' ? a.telegraph : { range: a.range, arcDeg: 90 };
      const ch = Math.cos(((tg.arcDeg ?? 90) / 2) * Math.PI / 180);
      for (const p of alivePlayers(state)) if (inCone(e.x, e.y, at.dx, at.dy, tg.range, ch, p.x, p.y, 0.3)) hit(p, dmgDirect);
      break;
    }
    case 'projectile':
      spawnEnemyProjectiles(state, e, a, at.dx, at.dy, projCount.mul(mult), enemyAttackDamage(state, e, a.damageCoef, true), a.projectileKind ?? (a.id === 'orb' ? 'orb' : 'shard'));
      break;
    case 'lob':
      spawnEnemyProjectiles(state, e, a, at.dx, at.dy, projCount.mul(mult), enemyAttackDamage(state, e, a.damageCoef, true), a.projectileKind ?? 'lob',
        { x: at.tx, y: at.ty, radius: a.telegraph.kind === 'circle' ? a.telegraph.radius : 1.2 });
      break;
    case 'pool':
      state.hazards.push(makeHazard(state, {
        kind: 'pool', owner: 'enemy', ownerId: e.id, x: at.tx, y: at.ty, radius: a.telegraph.kind === 'circle' ? a.telegraph.radius : 1.5,
        untilTick: state.tick + Math.round((a.duration ?? 5) / DT), interval: 30, nextTick: state.tick + 6,
        damage: dmgHazard.mul(B('0.5')), dtype: a.damageType,
      }));
      break;
    case 'summon': {
      const n = a.summonCount ?? 3;
      const q = fateFactor(state, 'encounter.spawnQuantity');
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const [sx, sy] = nearestFloor(state.map!, e.x + Math.cos(ang) * 1.2, e.y + Math.sin(ang) * 1.2);
        state.pendingSpawns.push({ kind: 'mite', x: sx, y: sy, count: q, summonerId: e.id, objective: false, groupId: -1 });
      }
      break;
    }
    case 'shield': {
      const ally = wardCandidate(state, e, a.range);
      if (ally) {
        ally.shield = ally.cohort.unitHp.mul(ally.cohort.count).mul(B('0.3'));
        ally.shieldUntil = state.tick + Math.round((a.duration ?? 4) / DT);
      }
      break;
    }
    case 'charge':
      at.hitSlots = [];
      break;
    case 'burst': {
      // telegraphed circle at the target point detonates (Gloom Shade): damage + affliction, i-frames avoid both
      const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 1.5;
      for (const p of alivePlayers(state)) if (p.iframes <= 0 && dist2(p.x, p.y, at.ox, at.oy) <= (R + 0.3) ** 2) hit(p, dmgDirect);
      ev.push({ t: 'foe_fx', id: e.id, fx: a.id, x: at.ox, y: at.oy, r: R });
      break;
    }
    // ---- theme foes (sim 1.5) ----
    case 'quake': {
      // telegraphed circle around the attacker detonates (Cloud Golem hail slam): damage + affliction, i-frames avoid
      const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 2;
      for (const p of alivePlayers(state)) if (p.iframes <= 0 && dist2(p.x, p.y, e.x, e.y) <= (R + 0.3) ** 2) hit(p, dmgDirect);
      ev.push({ t: 'foe_fx', id: e.id, fx: a.id, x: e.x, y: e.y, r: R });
      break;
    }
    case 'leap':
      // airborne for the release window (stepAttack moves it onto the marked circle and lands it); the landing circle
      // stays marked until it comes down
      at.hitSlots = [];
      state.telegraphs.push({ id: state.nextId++, ownerId: e.id, shape: a.telegraph, x: at.tx, y: at.ty, dx: at.dx, dy: at.dy, startTick: state.tick, releaseTick: state.tick + Math.max(1, Math.round(a.releaseSec / freq(e) / DT)), attack: 'leap_land' });
      ev.push({ t: 'foe_fx', id: e.id, fx: 'leap_off', x: e.x, y: e.y, tx: at.tx, ty: at.ty });
      break;
    case 'blink': {
      // reappear on the marked point (Glitch Wraith); a beat before it may strike again
      const fx0 = e.x, fy0 = e.y;
      const [bx, by] = nearestFloor(state.map!, at.tx, at.ty);
      e.x = bx; e.y = by; e.vx = 0; e.vy = 0; e.path = [];
      for (const k of Object.keys(e.cooldowns)) if (k !== a.id && k !== '_pause') e.cooldowns[k] = Math.max(e.cooldowns[k], 0.5);
      ev.push({ t: 'foe_fx', id: e.id, fx: 'blink', x: fx0, y: fy0, tx: bx, ty: by });
      break;
    }
    case 'ring':
      state.hazards.push(makeHazard(state, {
        kind: 'ring', owner: 'enemy', ownerId: e.id, x: e.x, y: e.y, inner: 0.6, outer: 1.4, speed: (a.projectileSpeed ?? 5) * toFloatClamped(fateFactor(state, 'enemy.projectileSpeed'), MAX_PROJECTILE_SPEED),
        untilTick: state.tick + Math.round(Math.min(10, (a.range / (a.projectileSpeed ?? 5))) / DT), interval: 1, damage: dmgDirect, dtype: a.damageType,
      }));
      break;
    case 'rootwall':
      for (const t of state.telegraphs.filter((t) => t.ownerId === e.id && t.attack === a.id)) {
        const len = rayDistance(state.map!, e.x, e.y, t.dx, t.dy, a.range);
        for (const p of alivePlayers(state)) if (inLine(e.x, e.y, t.dx, t.dy, len, 0.45, p.x, p.y, 0.3)) hit(p, dmgDirect);
        state.hazards.push(makeHazard(state, {
          kind: a.hazardKind ?? 'rootwall', owner: 'enemy', ownerId: e.id, x: e.x, y: e.y, dx: t.dx, dy: t.dy, length: len, width: 0.9,
          untilTick: state.tick + Math.round((a.duration ?? 3) / DT), interval: 30, nextTick: state.tick + 30, damage: dmgHazard.mul(B('0.5')), dtype: a.damageType,
        }));
      }
      break;
    case 'lightpool':
      for (const t of state.telegraphs.filter((t) => t.ownerId === e.id && t.attack === a.id)) {
        state.hazards.push(makeHazard(state, {
          kind: 'lightpool', owner: 'enemy', ownerId: e.id, x: t.x, y: t.y, radius: 1.3, generation: 0,
          untilTick: state.tick + Math.max(1, Math.round((a.duration ?? 1.2) / freq(e) / DT)), interval: 99999, damage: dmgDirect, dtype: a.damageType,
        }));
      }
      break;
    case 'slam': {
      const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 3.5;
      for (const p of alivePlayers(state)) if (dist2(p.x, p.y, e.x, e.y) <= (R + 0.3) ** 2) hit(p, dmgDirect);
      // exposes the vulnerable core for the recovery window
      e.staggerUntil = state.tick + Math.round((a.recoverySec / freq(e)) / DT);
      ev.push({ t: 'stagger', id: e.id });
      break;
    }
  }
  state.telegraphs = state.telegraphs.filter((t) => !(t.ownerId === e.id && (t.id === at.telegraphId || t.attack === a.id)));
}

/** Leap (theme foes, Lunar Leaper): glide onto the marked point over the release window, wall-safe. */
function stepLeap(state: SimState, e: EnemyState, at: NonNullable<EnemyState['attack']>) {
  const dx = at.tx - e.x, dy = at.ty - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-4) return;
  const k = Math.min(1, DT / Math.max(DT, at.timer + DT));
  const r = moveCircle(state.map!, e.x, e.y, dx * k, dy * k, Math.min(e.radius, 0.6));
  e.vx = (r.x - e.x) / DT; e.vy = (r.y - e.y) / DT;
  e.x = r.x; e.y = r.y;
  e.fx = dx / d; e.fy = dy / d;
}

/** Leap landing: a burst where it came down (damage + affliction; i-frames avoid both). */
function landLeap(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef) {
  const R = a.telegraph.kind === 'circle' ? a.telegraph.radius : 1.2;
  const src = foeName(e);
  const dmg = enemyAttackDamage(state, e, a.damageCoef, true);
  for (const p of alivePlayers(state)) {
    if (p.iframes > 0 || dist2(p.x, p.y, e.x, e.y) > (R + 0.3) ** 2) continue;
    hitPlayer(state, ev, p, dmg, { attack: a.name, source: src, fromX: e.x, fromY: e.y, dtype: a.damageType, srcId: e.id });
    if (a.inflict) inflictHit(state, ev, p, a.id, { srcId: e.id, source: src, attack: a.name, damage: dmg });
  }
  e.vx = 0; e.vy = 0;
  state.telegraphs = state.telegraphs.filter((t) => !(t.ownerId === e.id && t.attack === 'leap_land'));
  ev.push({ t: 'foe_fx', id: e.id, fx: 'leap_land', x: e.x, y: e.y, r: R });
}

function stepAttack(state: SimState, ev: SimEvent[], e: EnemyState) {
  const at = e.attack!;
  const a = attackDefs(e).find((x) => x.id === at.attackId)!;
  const f = freq(e);
  at.timer -= DT * actMul(state, e);   // chill slows attack timing, freeze stops it (cc.ts)
  if (at.stage === 'windup') {
    if (at.timer > 0) return;
    at.stage = 'release';
    at.timer += a.releaseSec / f;
    e.state = 'attack';
    releaseAttack(state, ev, e, a, ONE);
  }
  if (at.stage === 'release') {
    if (a.kind === 'charge') {
      // charge travels the telegraphed lane; speed scales literally with enemy movement speed
      const baseSpeed = (a.telegraph.kind === 'line' ? a.telegraph.length : a.range) / Math.max(0.05, a.releaseSec);
      const speed = baseSpeed * toFloatClamped(fateFactor(state, 'enemy.movementSpeed'), 1e7);
      const r = moveCircle(state.map!, e.x, e.y, at.dx * speed * DT, at.dy * speed * DT, Math.min(e.radius, 0.9));
      const fromX = e.x, fromY = e.y;
      e.x = r.x; e.y = r.y;
      for (const p of alivePlayers(state)) {
        if (at.hitSlots.includes(p.slot)) continue;
        const vx = p.x - fromX, vy = p.y - fromY;
        const seg = Math.sqrt(dist2(fromX, fromY, e.x, e.y));
        const along = vx * at.dx + vy * at.dy;
        if (along < -e.radius || along > seg + e.radius) continue;
        if (Math.abs(-vx * at.dy + vy * at.dx) > e.radius + 0.3) continue;
        at.hitSlots.push(p.slot);
        hitPlayer(state, ev, p, enemyAttackDamage(state, e, a.damageCoef, true), { attack: a.name, source: foeName(e), fromX: e.x, fromY: e.y, dtype: a.damageType, srcId: e.id });
      }
      if (r.hitWall && e.boss) {
        // charging into a wall staggers the Prism Stag (readable punish window)
        e.staggerUntil = state.tick + Math.round(1.5 / DT);
        e.state = 'stagger';
        ev.push({ t: 'stagger', id: e.id });
        at.timer = 0;
      } else if (r.hitWall) at.timer = 0;
    }
    if (a.kind === 'leap') stepLeap(state, e, at);   // theme foes: airborne toward the marked circle
    if (at.timer > 0) return;
    if (a.kind === 'leap') landLeap(state, ev, e, a);
    at.stage = 'recovery';
    at.timer += a.recoverySec / f;
    e.state = 'recovery';
  }
  if (at.stage === 'recovery') {
    if (at.timer > 0) return;
    e.cooldowns[a.id] = a.cooldownSec / f;
    e.attack = null;
    e.state = 'idle';
    if (e.boss) e.patternStep++;
  }
}

/** Rapid cadence: when a windup is shorter than one tick, attacks resolve as grouped cycles each tick
 *  (no hidden minimum windup; the threat envelope stays visible). */
function rapidAttack(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState) {
  const cycle = a.windupSec + a.releaseSec + a.recoverySec + a.cooldownSec;
  e.rapidWork = e.rapidWork.add(e.attackFreq.mul(DT_B).div(B(cycle)));
  const k = e.rapidWork.floorInt();
  if (k <= 0n) return;
  e.rapidWork = e.rapidWork.sub(Big.from(k));
  startAttack(state, ev, e, a, target);
  releaseAttack(state, ev, e, a, Big.from(k));
  if (a.kind === 'leap' && e.attack) {
    // theme foes: at a sub-tick cadence the leap lands at once (no airborne window to glide through)
    const r = moveCircle(state.map!, e.x, e.y, e.attack.tx - e.x, e.attack.ty - e.y, Math.min(e.radius, 0.6));
    e.x = r.x; e.y = r.y;
    landLeap(state, ev, e, a);
  }
  e.attack = null;
  e.state = 'attack';
  // keep a one-tick telegraph envelope visible
  state.telegraphs.push({ id: state.nextId++, ownerId: e.id, shape: a.telegraph, x: a.telegraph.kind === 'circle' ? target.x : e.x, y: a.telegraph.kind === 'circle' ? target.y : e.y, dx: e.fx, dy: e.fy, startTick: state.tick, releaseTick: state.tick + 1, attack: a.id });
}

// ---------------- Per-tick enemy update ----------------

// ---------------- Idle packs (director.ts population) ----------------

/**
 * Wake an idle pack: every dormant member of `src`'s pack, plus dormant packs with a member within aggroCallRadius
 * of a woken foe (one level: called packs do not call further).
 */
export function wakePack(state: SimState, ev: SimEvent[], src: EnemyState) {
  const woke: EnemyState[] = [];
  for (const o of state.enemies) {
    if (!o.dormant) continue;
    if (o === src || (src.pack !== undefined && o.pack === src.pack)) { o.dormant = false; woke.push(o); }
  }
  const R2 = RULES.aggroCallRadius * RULES.aggroCallRadius;
  const called = new Set<number>();
  for (const o of state.enemies) {
    if (!o.dormant || o.pack === undefined || called.has(o.pack)) continue;
    for (const w of woke) if (dist2(o.x, o.y, w.x, w.y) <= R2) { called.add(o.pack); break; }
  }
  for (const o of state.enemies) if (o.dormant && o.pack !== undefined && called.has(o.pack)) { o.dormant = false; woke.push(o); }
  for (const o of woke) o.perceiveIn = Math.min(o.perceiveIn, 1 + (o.id % 4));
  ev.push({ t: 'aggro', id: src.id, pack: src.pack ?? -1, x: src.x, y: src.y });
}

/** Cheap idle check: only every aggroCheckTicks ticks (staggered by id), or at once when hurt. True = woke up. */
function dormantTick(state: SimState, ev: SimEvent[], e: EnemyState): boolean {
  const hurt = e.hitFlash > 0 || e.dots.length > 0 || !e.cohort.front.isZero() || !e.cohort.spread.isZero();
  if (!hurt) {
    if ((state.tick + e.id) % RULES.aggroCheckTicks !== 0 || inCinematic(state) || !state.map) return false;
    const H2 = RULES.aggroHearing * RULES.aggroHearing, A2 = RULES.aggroRadius * RULES.aggroRadius;
    let seen = false;
    for (const p of state.players) {
      if (p.lifeState !== 'alive') continue;
      const d2 = dist2(e.x, e.y, p.x, p.y);
      if (d2 <= H2 || (d2 <= A2 && lineOfSight(state.map, e.x, e.y, p.x, p.y))) { seen = true; break; }
    }
    if (!seen) return false;
  }
  wakePack(state, ev, e);
  return true;
}

export function stepEnemy(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (inCinematic(state)) return;   // boss grand entrance: AI holds (cinematic.ts)
  if (e.state === 'dying') { e.deathTimer -= DT; return; }
  stepKnock(state, e);   // impact knockback slide (knock.ts), whatever the foe is doing
  if (e.dormant && !dormantTick(state, ev, e)) { e.vx = 0; e.vy = 0; return; }   // idle pack: nothing else to simulate
  e.hitFlash = Math.max(0, e.hitFlash - 1);
  for (const k of Object.keys(e.cooldowns)) if (e.cooldowns[k] > 0) e.cooldowns[k] = Math.max(0, e.cooldowns[k] - DT);
  // regeneration (regen-tagged only): heals every unit of the cohort
  if (!e.regenFrac.isZero() && (!e.cohort.spread.isZero() || !e.cohort.front.isZero())) {
    const rho = e.cohort.unitHp.mul(e.regenFrac).mul(DT_B);
    const s2 = e.cohort.spread.sub(rho);
    const missing = e.cohort.spread.add(e.cohort.front).sub(rho);
    e.cohort.spread = s2;
    e.cohort.front = missing.sub(s2);
  }
  tickDots(state, ev, e);
  if ((e.state as string) === "dying") return;
  if (e.boss) { stepBoss(state, ev, e); return; }
  if (e.staggerUntil > state.tick) return;
  if (isFrozen(state, e)) { e.vx = 0; e.vy = 0; return; }   // frozen: no movement, no new attacks (cc.ts)
  if (e.attack) { stepAttack(state, ev, e); return; }
  if (e.state === 'attack') e.state = 'idle';

  e.perceiveIn--;
  e.pathAge++;
  if (e.perceiveIn <= 0) {
    perceive(state, e);
    e.perceiveIn = 6;
  }
  const target = e.targetSlot !== null ? state.players[e.targetSlot] : null;
  if (!target || target.lifeState !== 'alive') { e.state = 'idle'; e.vx = 0; e.vy = 0; return; }
  const ready = readyAttack(state, e, target);
  const wantsCast = e.action === 'cast' || e.action === 'rescue' || (ready && (e.action === 'pursue' || e.action === 'guard'));
  if (ready && wantsCast) {
    const f = freq(e);
    if (ready.windupSec / f < DT) rapidAttack(state, ev, e, ready, target);
    else startAttack(state, ev, e, ready, target);
    e.vx = 0; e.vy = 0;
    return;
  }
  const lure = lureGoal(state, e);
  const [gx, gy] = lure ?? goalFor(state, e, target);   // decoys / bait lure movement (cc.ts)
  const px = e.x, py = e.y;
  moveToward(state, e, gx, gy);
  // ranged foes never walk into a hero's lingering fire (they evade out of it instead); lures still drag them
  if (!lure && e.action !== 'evade' && ENEMY_BY_ID[e.kind].preferredRange[1] > 2 && !playerHazardAt(state, { ...e, x: px, y: py }) && playerHazardAt(state, e)) {
    e.x = px; e.y = py; e.vx = 0; e.vy = 0;
  }
  e.state = Math.abs(e.vx) + Math.abs(e.vy) > 0.01 ? 'move' : 'idle';
  // face the target while moving at range
  const [fx, fy] = norm(target.x - e.x, target.y - e.y);
  if (ENEMY_BY_ID[e.kind].preferredRange[1] > 2 || e.kind === 'guardian') { e.fx = fx; e.fy = fy; }
  stuckCheck(state, e);
}

// ---------------- Bosses (PRD §14.3) ----------------

function stepBoss(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (bossScript(e.kind)?.step(state, ev, e)) return;   // scripted bosses run their own AI (bosses/*)
  const def = BOSS_BY_ID[e.kind];
  // phase transitions by health fraction
  const frac = e.cohort.unitHp.sub(e.cohort.spread).sub(e.cohort.front).ratio(e.cohort.unitHp);
  let phase = 0;
  for (let i = 0; i < def.phases.length; i++) if (frac <= def.phases[i].healthFrac) phase = i;
  if (phase > e.phaseIndex) {
    e.phaseIndex = phase;
    e.patternIndex = 0; e.patternStep = 0;
    ev.push({ t: 'boss_phase', id: e.id, phase });
    state.bossPhaseEvents.push(phase);
  }
  // reinforcements: one wave per health threshold crossed (2/3, 1/3), each exactly once
  RULES.bossReinforceAt.forEach((at, i) => { if (frac <= at) bossReinforcements(state, ev, e, i + 1); });
  if (e.staggerUntil > state.tick) { e.state = 'stagger'; e.attack = null; return; }
  if (e.state === 'stagger') e.state = 'idle';
  if (e.attack) { stepAttack(state, ev, e); return; }
  if ((e.cooldowns['_pause'] ?? 0) > 0) {
    const target = chooseTarget(state, e);
    if (target) {
      const d = Math.sqrt(dist2(e.x, e.y, target.x, target.y));
      if (d > 3.2) moveToward(state, e, target.x, target.y);
      const [fx, fy] = norm(target.x - e.x, target.y - e.y); e.fx = fx; e.fy = fy;
      e.state = d > 3.2 ? 'move' : 'idle';
    }
    return;
  }
  const ph = def.phases[e.phaseIndex];
  const pattern = ph.patterns[e.patternIndex % ph.patterns.length];
  if (e.patternStep >= pattern.length) {
    e.patternIndex++;
    e.patternStep = 0;
    e.cooldowns['_pause'] = 1.2 * Number(ph.cadence) / freq(e);
    return;
  }
  const target = chooseTarget(state, e);
  if (!target) { e.state = 'idle'; return; }
  const a = def.attacks.find((x) => x.id === pattern[e.patternStep])!;
  const d = Math.sqrt(dist2(e.x, e.y, target.x, target.y));
  // close distance for short-range modules, otherwise start the module
  if ((a.kind === 'sweep' || a.kind === 'slam') && d > a.range + 0.5) {
    moveToward(state, e, target.x, target.y);
    e.state = 'move';
    e.stuckTimer += DT;
    if (e.stuckTimer > 3) { e.patternStep++; e.stuckTimer = 0; }   // never stall a pattern forever
    return;
  }
  e.stuckTimer = 0;
  if (a.windupSec / freq(e) < DT) { rapidAttack(state, ev, e, a, target); e.patternStep++; }
  else startAttack(state, ev, e, a, target);
}

// ---------------- Enemy projectiles & hazards ----------------

/** Theme foe projectiles with an impact cue ('<kind>_hit' foe_fx): tractor beam, static bolt, glitch bolt. */
const THEME_SHOT_HITS = new Set(['tractor', 'staticbolt', 'glitchbolt']);

export function stepEnemyProjectile(state: SimState, ev: SimEvent[], pr: Projectile): boolean {
  const owner = state.enemies.find((x) => x.id === pr.ownerId);
  const src = owner ? foeName(owner) : 'Enemy';
  const attackName = owner ? (attackDefs(owner).find((a) => a.id === pr.skillId)?.name ?? pr.skillId) : pr.skillId;
  if (pr.lobTarget) {
    // lobbed: flies over walls, lands on the telegraphed circle
    const lt = pr.lobTarget;
    const remain = lt.landTick - state.tick;
    if (remain <= 0) {
      const dmg = pr.damage.mul(pr.weight);
      for (const p of alivePlayers(state)) {
        if (dist2(p.x, p.y, lt.x, lt.y) > (lt.radius + 0.3) ** 2) continue;
        const iframed = p.iframes > 0;
        hitPlayer(state, ev, p, dmg, { attack: attackName, source: src, fromX: lt.x, fromY: lt.y, dtype: pr.dtype, srcId: pr.ownerId });
        if (!iframed) inflictHit(state, ev, p, pr.skillId, { srcId: pr.ownerId, source: src, attack: attackName, damage: dmg });
      }
      // lingering patches (afflictions.ts): Bile Toad venom puddles, Web Weaver webs
      if (pr.kind === 'lob' && pr.skillId === 'lob') {
        dropPatch(state, pr.ownerId, 'venom', lt.x, lt.y, AFFLICTION_RULES.venomPuddleRadius, AFFLICTION_RULES.venomPuddleSec, dmg.mul(B('0.3')));
        ev.push({ t: 'foe_fx', id: pr.ownerId, fx: 'venom_splash', x: lt.x, y: lt.y, r: lt.radius });
      } else if (pr.kind === 'web') {
        dropPatch(state, pr.ownerId, 'web', lt.x, lt.y, AFFLICTION_RULES.webPatchRadius, AFFLICTION_RULES.webPatchSec, Big.ZERO);
        ev.push({ t: 'foe_fx', id: pr.ownerId, fx: 'web_splat', x: lt.x, y: lt.y, r: lt.radius });
      }
      return false;
    }
    pr.x += (lt.x - pr.x) / remain; pr.y += (lt.y - pr.y) / remain;
    return true;
  }
  const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
  const [dx, dy] = norm(pr.vx, pr.vy);
  const travel = Math.min(sp * DT, pr.range);
  const wallD = rayDistance(state.map!, pr.x, pr.y, dx, dy, travel + pr.radius);
  const segLen = Math.min(travel, Math.max(0, wallD - pr.radius * 0.5));
  let best: PlayerState | null = null; let bt = Infinity;
  for (const p of alivePlayers(state)) {
    const vx = p.x - pr.x, vy = p.y - pr.y;
    const along = vx * dx + vy * dy;
    if (along < -0.3 - pr.radius || along > segLen + 0.3 + pr.radius) continue;
    if (Math.abs(-vx * dy + vy * dx) > 0.3 + pr.radius) continue;
    if (p.iframes > 0) continue;   // dodged through; projectile continues
    if (along < bt) { bt = along; best = p; }
  }
  if (best) {
    const dmg = pr.damage.mul(pr.weight);
    hitPlayer(state, ev, best, dmg, { attack: attackName, source: src, fromX: pr.x - dx, fromY: pr.y - dy, dtype: pr.dtype, srcId: pr.ownerId });
    // hooks chain the hero where they stood; frost bolts chill; curse orbs silence (afflictions.ts)
    inflictHit(state, ev, best, pr.skillId, { srcId: pr.ownerId, source: src, attack: attackName, damage: dmg, anchorX: best.x, anchorY: best.y });
    if (pr.kind === 'hook' || pr.kind === 'frostbolt' || THEME_SHOT_HITS.has(pr.kind)) ev.push({ t: 'foe_fx', id: pr.ownerId, fx: pr.kind + '_hit', x: best.x, y: best.y, tx: pr.x - dx * 6, ty: pr.y - dy * 6 });
    return false;
  }
  pr.x += dx * segLen; pr.y += dy * segLen;
  pr.range -= travel;
  if (segLen < travel - 1e-6) return false;
  return pr.range > 0.01;
}

export function stepEnemyHazard(state: SimState, ev: SimEvent[], h: Hazard) {
  if (hooks.hazardTick(state, ev, h)) return;   // affix hazards (elites.ts) and other module-owned kinds
  const owner = state.enemies.find((x) => x.id === h.ownerId);
  const src = owner ? foeName(owner) : 'Hazard';
  const hit = (p: PlayerState, amount: Big, attack: string) => hitPlayer(state, ev, p, amount, { attack, source: src, fromX: h.x, fromY: h.y, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  if (h.kind === 'ring') {
    const age = (state.tick - h.bornTick) * DT;
    const inner = h.inner + h.speed * age, outer = h.outer + h.speed * age;
    for (const p of alivePlayers(state)) {
      if (h.hitSlots.includes(p.slot)) continue;
      const d = Math.sqrt(dist2(p.x, p.y, h.x, h.y));
      if (d + 0.3 >= inner && d - 0.3 <= outer && p.iframes <= 0) { h.hitSlots.push(p.slot); hit(p, h.damage, 'Ring Pulse'); }
    }
    return;
  }
  if (h.kind === 'lightpool') {
    if (state.tick < h.untilTick - 1) return;
    for (const p of alivePlayers(state)) {
      if (dist2(p.x, p.y, h.x, h.y) > (h.radius + 0.3) ** 2) continue;
      const iframed = p.iframes > 0;
      hit(p, h.damage, 'Splitting Light');
      if (!iframed && owner) inflictHit(state, ev, p, 'lightpools', { srcId: owner.id, source: src, attack: 'Splitting Ghost-fire' });   // ghost-fire bursts blind
    }
    ev.push({ t: 'enemy_attack', id: h.ownerId, attack: 'lightpool_burst', stage: 'release' });
    if (h.generation < 2) {
      // authored finite split: two smaller pools, max two generations
      const offs = [[-1, 0.4], [1, -0.4]];
      for (const [ox, oy] of offs) {
        const [nx, ny] = nearestFloor(state.map!, h.x + ox * 1.4, h.y + oy * 1.4);
        const f = owner ? freq(owner) : 1;
        state.hazards.push(makeHazard(state, {
          kind: 'lightpool', owner: 'enemy', ownerId: h.ownerId, x: nx, y: ny, radius: h.radius * 0.65, generation: h.generation + 1,
          untilTick: state.tick + Math.max(2, Math.round(0.9 / f / DT)), interval: 99999, damage: h.damage.mul(B('0.6')), dtype: h.dtype,
        }));
      }
    }
    h.untilTick = state.tick;   // consumed
    return;
  }
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  for (const p of alivePlayers(state)) {
    let inside = false;
    if (h.kind === 'pool') inside = dist2(p.x, p.y, h.x, h.y) <= (h.radius + 0.2) ** 2;
    // 'firewall': the Firewall Sentinel's lingering quarantine line (theme foes), a line like the Chain Lash's
    else if (h.kind === 'rootwall' || h.kind === 'firewall') inside = inLine(h.x, h.y, h.dx, h.dy, h.length, h.width / 2, p.x, p.y, 0.2);
    if (inside) hit(p, h.damage, h.kind === 'pool' ? 'Thorn Pool' : h.kind === 'firewall' ? 'Firewall' : 'Root Wall');
  }
}

export function separateEnemies(state: SimState) {
  const live = state.enemies.filter((e) => e.state !== 'dying');
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      const R = Math.min(a.radius, 0.8) + Math.min(b.radius, 0.8);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 < 1e-10) continue;
      const d = Math.sqrt(d2);
      const push = (R - d) * 0.25;
      const nx = dx / d, ny = dy / d;
      const wa = a.boss ? 0 : 1, wb = b.boss ? 0 : 1;
      if (wa) { const r = moveCircle(state.map!, a.x, a.y, -nx * push * (wb ? 1 : 2), -ny * push * (wb ? 1 : 2), Math.min(a.radius, 0.6)); a.x = r.x; a.y = r.y; }
      if (wb) { const r = moveCircle(state.map!, b.x, b.y, nx * push * (wa ? 1 : 2), ny * push * (wa ? 1 : 2), Math.min(b.radius, 0.6)); b.x = r.x; b.y = r.y; }
    }
  }
  // soft separation between players and enemies (no permanent trapping)
  for (const p of state.players) {
    if (p.lifeState === 'dead') continue;
    for (const e of live) {
      if (e.boss && bossImmune(state, e)) continue;   // a boss aloft (BossScript.immune) does not shoulder heroes aside
      const R = 0.3 + Math.min(e.radius, 1.2);
      const dx = p.x - e.x, dy = p.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 < 1e-10) continue;
      const d = Math.sqrt(d2);
      const push = (R - d) * 0.5;
      const r = moveCircle(state.map!, p.x, p.y, (dx / d) * push, (dy / d) * push, 0.3);
      p.x = r.x; p.y = r.y;
    }
  }
}

export { ZERO };
