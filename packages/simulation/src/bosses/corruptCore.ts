import { Big } from '@cursebound/numeric';
import type { EnemyAttackDef } from '@cursebound/content';
import { hitPlayer } from '../combat';
import { createEnemy } from '../director';
import { dist2, inLine, isWall, norm } from '../geometry';
import { registerGlobalHooks } from '../hooks';
import { makeHazard } from '../players';
import { nextFloat, nextInt } from '../rng';
import { B, ONE, fateFactor, toFloatClamped } from '../stats';
import type { EnemyAttackState, EnemyState, Hazard, PlayerState, SimEvent, SimState } from '../types';
import {
  DT, T, aliveHeroes, attackOf, beginAttack, bossName, bossPhaseTick, bv, clearTelegraphs, damageOf, face, floorNear, freq,
  hitHero, openRadius, param, registerBossHazard, releaseTickOf, runPatterns, safeSpot, stepScripted, telegraph, telegraphsOf, walkToward, type ScriptedAttack, type StartResult,
} from './kit';
import { registerBossScript, type BotHint } from './registry';

// THE CORRUPTED CORE (content bosses/corruptCore.ts): the scripted AI of the server room's boss.
// It hovers over the raised core platform of its vault (its "home", the dais it rose on) and drifts back there between
// patterns; nothing it does needs range: the laser grid, the firewalls and the purge cover the whole vault, the glitch
// jump brings it to the heroes. State lives in EnemyState.bvars (hx, hy home, R vault radius, spl split active).
// Mirror Split: two echoes (the same kind, boss: true, summonerId = the Core, bvars.echo = 1, bvars.rot = angle)
// copy the Core every tick, rotated about the home point by their angle: position, facing, state and attack. The tell
// is the eye (the snapshot facing): the real Core faces the hero it hunts; the echoes face that hero's rotated mirror
// image, i.e. empty floor. Echoes are fragile (params.echoHealth), never drop loot (gear.ts) and burst into corrupted
// tiles when destroyed; when the split runs out (params.splitSec) or both echoes fall, the rest dissolve back in.

const ID = 'corruptcore';
const ADDS = new Set(['coredrone', 'coreturret']);
const TAU = Math.PI * 2;

const live = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();
const rot = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/** The home point (dais) and vault radius, measured once. */
function home(state: SimState, e: EnemyState): { x: number; y: number; R: number } {
  const b = bv(e);
  if (b.R === undefined) {
    b.hx = e.x; b.hy = e.y;
    b.R = openRadius(state, e.x, e.y, param(e, 'arenaMin', 6), param(e, 'arenaMax', 10.5));
  }
  return { x: b.hx, y: b.hy, R: b.R };
}

function echoesOf(state: SimState, e: EnemyState): EnemyState[] {
  return state.enemies.filter((o) => o.summonerId === e.id && o.kind === ID && o.bvars?.echo && live(o));
}

/** The Core and its live echoes (every body that acts while split). */
function bodies(state: SimState, e: EnemyState): EnemyState[] {
  return [e, ...echoesOf(state, e)];
}

/** Where a point lands for a body: the real Core keeps it, an echo sees it rotated about home by its angle. */
function mirrorPt(state: SimState, core: EnemyState, body: EnemyState, x: number, y: number): [number, number] {
  if (body === core) return [x, y];
  const h = home(state, core);
  const [rx, ry] = rot(x - h.x, y - h.y, body.bvars?.rot ?? 0);
  return floorNear(state, h.x + rx, h.y + ry);
}

// ---------------- laser grid ----------------

interface Lane { x: number; y: number; dx: number; dy: number; len: number }

/**
 * Lanes of a grid across the vault at angle `theta` (lane normal), `w` wide: each lane is cut into the floor runs of
 * its centre line inside the vault circle (racks and pylons break it). Every `every`-th lane stays dark (a random
 * phase), so a dark lane is always within reach wherever a hero stands.
 */
function gridLanes(state: SimState, e: EnemyState, theta: number, every: number): Lane[] {
  const h = home(state, e);
  const w = param(e, 'laneWidth', 1.6);
  const nx = Math.cos(theta), ny = Math.sin(theta), dx = -ny, dy = nx;
  const K = Math.ceil((h.R * 2) / w);
  const L = (K * w) / 2;
  const runs: Lane[][] = [];
  for (let k = 0; k < K; k++) {
    const o = -L + (k + 0.5) * w;
    const lane: Lane[] = [];
    if (Math.abs(o) < h.R - 0.3) {
      const half = Math.sqrt(h.R * h.R - o * o);
      const cx = h.x + nx * o, cy = h.y + ny * o;
      let s0: number | null = null;
      for (let s = -half; s <= half + 1e-6; s += 0.25) {
        const px = cx + dx * s, py = cy + dy * s;
        const open = !isWall(state.map!, Math.floor(px), Math.floor(py));
        if (open && s0 === null) s0 = s;
        if ((!open || s + 0.25 > half) && s0 !== null) {
          const s1 = open ? s : s - 0.25;
          if (s1 - s0 >= 0.6) lane.push({ x: cx + dx * s0, y: cy + dy * s0, dx, dy, len: s1 - s0 });
          s0 = null;
        }
      }
    }
    runs.push(lane);
  }
  // dark lanes: every `every`-th lane from a random phase
  const S = Math.max(2, Math.round(every));
  const o0 = nextInt(state.rng.ai, S);
  return runs.flatMap((l, k) => ((k - o0) % S === 0 ? [] : l));
}

function markGrid(state: SimState, e: EnemyState, attack: string, theta: number, every: number, releaseTick: number) {
  const w = param(e, 'laneWidth', 1.6);
  for (const l of gridLanes(state, e, theta, every)) telegraph(state, e, attack, { kind: 'line', length: l.len, width: w }, l.x, l.y, l.dx, l.dy, releaseTick);
}

/** Fire the lanes marked for `attack`: heroes inside a lane are hit once; one beam cue per lane. */
function fireGrid(state: SimState, ev: SimEvent[], e: EnemyState, attack: string, a: EnemyAttackDef) {
  const dmg = damageOf(state, e, a);
  const hit = new Set<number>();
  for (const t of telegraphsOf(state, e, attack)) {
    const sh = t.shape as { kind: 'line'; length: number; width: number };
    for (const p of aliveHeroes(state)) {
      if (hit.has(p.slot) || !inLine(t.x, t.y, t.dx, t.dy, sh.length, sh.width / 2, p.x, p.y, 0.25)) continue;
      hit.add(p.slot);
      hitHero(state, ev, e, p, dmg, a, { fromX: p.x - t.dy, fromY: p.y + t.dx });
    }
    ev.push({ t: 'foe_fx', id: e.id, fx: 'cc_laser', x: t.x, y: t.y, tx: t.x + t.dx * sh.length, ty: t.y + t.dy * sh.length, r: sh.width });
  }
  clearTelegraphs(state, e, attack);
}

// ---------------- firewall ----------------

interface WallPlan { mx: number; my: number; gap: number }

/** Two walls on opposite rims, closing in along `theta`, each with its port at a random offset. */
function wallPlans(state: SimState, e: EnemyState): WallPlan[] {
  const h = home(state, e);
  const theta = (nextInt(state.rng.ai, 4) * Math.PI) / 4;
  const out: WallPlan[] = [];
  for (const s of [1, -1]) {
    const gap = (nextFloat(state.rng.ai) * 2 - 1) * h.R * 0.55;
    out.push({ mx: Math.cos(theta) * s, my: Math.sin(theta) * s, gap });
  }
  return out;
}

/** A wall's along-direction (its left normal is the way it moves) and start point (the rim behind it). */
function wallFrame(state: SimState, e: EnemyState, w: WallPlan): { sx: number; sy: number; dx: number; dy: number; len: number } {
  const h = home(state, e);
  const dx = w.my, dy = -w.mx;
  return { sx: h.x - w.mx * h.R - dx * h.R, sy: h.y - w.my * h.R - dy * h.R, dx, dy, len: h.R * 2 };
}

function startFirewall(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState) {
  const at = beginAttack(state, ev, e, a, target.x, target.y);
  const plans = wallPlans(state, e);
  const b = bv(e);
  b.fw0 = plans[0].gap; b.fw1 = plans[1].gap; b.fwx = plans[0].mx; b.fwy = plans[0].my;
  const rt = releaseTickOf(state, e, a);
  const h = home(state, e);
  const gapW = param(e, 'wallGap', 2.4);
  // mark where each wall rises: its first floor run in from the rim, port left open
  for (const w of plans) {
    const f = wallFrame(state, e, w);
    const inset = 0.9;
    const cx = f.sx + w.mx * inset, cy = f.sy + w.my * inset;
    let s0: number | null = null;
    for (let s = 0; s <= f.len + 1e-6; s += 0.25) {
      const px = cx + f.dx * s, py = cy + f.dy * s;
      const inPort = Math.abs(s - (h.R + w.gap)) < gapW / 2;
      const open = !inPort && !isWall(state.map!, Math.floor(px), Math.floor(py)) && dist2(px, py, h.x, h.y) <= (h.R + 0.5) ** 2;
      if (open && s0 === null) s0 = s;
      if ((!open || s + 0.25 > f.len) && s0 !== null) {
        const s1 = open ? s : s - 0.25;
        if (s1 - s0 >= 0.5) telegraph(state, e, a.id, { kind: 'line', length: s1 - s0, width: param(e, 'wallThick', 0.8) }, cx + f.dx * s0, cy + f.dy * s0, f.dx, f.dy, rt);
        s0 = null;
      }
    }
  }
  void at;
}

function releaseFirewall(state: SimState, e: EnemyState, a: EnemyAttackDef) {
  const b = bv(e);
  const h = home(state, e);
  const speed = param(e, 'wallSpeed', 2.2) * toFloatClamped(fateFactor(state, 'enemy.projectileSpeed'), 1e6);
  const gapW = param(e, 'wallGap', 2.4);
  const dmg = damageOf(state, e, a);
  const plans: WallPlan[] = [{ mx: b.fwx, my: b.fwy, gap: b.fw0 }, { mx: -b.fwx, my: -b.fwy, gap: b.fw1 }];
  for (const w of plans) {
    const f = wallFrame(state, e, w);
    const g0 = h.R + w.gap - gapW / 2;
    state.hazards.push(makeHazard(state, {
      kind: 'cc_firewall', owner: 'enemy', ownerId: e.id, x: f.sx, y: f.sy, dx: f.dx, dy: f.dy, length: f.len, width: param(e, 'wallThick', 0.8),
      inner: g0, outer: g0 + gapW, speed, untilTick: state.tick + Math.ceil((h.R + 0.6) / Math.max(0.1, speed) / DT), interval: 1, damage: dmg, dtype: a.damageType,
    }));
  }
  clearTelegraphs(state, e, a.id);
}

/** A wall's front this tick: offset along its normal from the start line. */
function wallOffset(state: SimState, h: Hazard): number { return Math.max(0, (state.tick - h.bornTick) * DT) * h.speed; }

function tickFirewall(state: SimState, ev: SimEvent[], h: Hazard) {
  const owner = state.enemies.find((o) => o.id === h.ownerId);
  const off = wallOffset(state, h);
  const mx = -h.dy, my = h.dx;
  for (const p of aliveHeroes(state)) {
    if (h.hitSlots.includes(p.slot) || p.iframes > 0) continue;
    const rx = p.x - h.x, ry = p.y - h.y;
    const along = rx * h.dx + ry * h.dy;
    const across = rx * mx + ry * my - off;
    if (along < 0 || along > h.length || Math.abs(across) > h.width / 2 + 0.3) continue;
    if (along > h.inner + 0.2 && along < h.outer - 0.2) continue;   // through the port
    h.hitSlots.push(p.slot);
    hitPlayer(state, ev, p, h.damage, { attack: 'Firewall', source: owner ? bossName(owner) : 'The Corrupted Core', fromX: p.x - mx, fromY: p.y - my, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  }
}

// ---------------- glitch jump and corrupted tiles ----------------

function glitchDest(state: SimState, e: EnemyState, target: PlayerState): [number, number] {
  const h = home(state, e);
  const dist = param(e, 'glitchDist', 3.4);
  let [ux, uy] = norm(h.x - target.x, h.y - target.y);
  if (!ux && !uy) [ux, uy] = norm(e.x - target.x, e.y - target.y);
  if (!ux && !uy) { ux = 1; uy = 0; }
  const side = nextFloat(state.rng.ai) < 0.5 ? -1 : 1;
  const [rx, ry] = rot(ux, uy, side * (0.35 + nextFloat(state.rng.ai) * 0.5));
  let x = target.x + rx * dist, y = target.y + ry * dist;
  const dh = Math.sqrt(dist2(x, y, h.x, h.y));
  if (dh > h.R - 1.2) { const k = (h.R - 1.2) / dh; x = h.x + (x - h.x) * k; y = h.y + (y - h.y) * k; }
  return floorNear(state, x, y);
}

function corruptAt(state: SimState, e: EnemyState, x: number, y: number) {
  const a = attackOf(e, 'cc_glitch')!;
  state.hazards.push(makeHazard(state, {
    kind: 'cc_corrupt', owner: 'enemy', ownerId: e.id, x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, radius: param(e, 'corruptHalf', 1.5),
    untilTick: state.tick + T(param(e, 'corruptSec', 7)), interval: T(param(e, 'corruptTick', 0.5)), nextTick: state.tick + T(0.25),
    damage: damageOf(state, e, a, false).mul(B(param(e, 'corruptCoef', 0.3))), dtype: 'astral',
  }));
}

function tickCorrupt(state: SimState, ev: SimEvent[], h: Hazard) {
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  const owner = state.enemies.find((o) => o.id === h.ownerId);
  for (const p of aliveHeroes(state)) {
    if (Math.abs(p.x - h.x) > h.radius + 0.15 || Math.abs(p.y - h.y) > h.radius + 0.15) continue;
    hitPlayer(state, ev, p, h.damage, { attack: 'Corrupted Tiles', source: owner ? bossName(owner) : 'The Corrupted Core', fromX: h.x, fromY: h.y, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  }
}

function releaseGlitch(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, at: EnemyAttackState) {
  const dmg = damageOf(state, e, a);
  const R = 1.6 + 0.3;
  const hit = new Set<number>();
  for (const body of bodies(state, e)) {
    const [tx, ty] = mirrorPt(state, e, body, at.tx, at.ty);
    corruptAt(state, e, body.x, body.y);
    ev.push({ t: 'foe_fx', id: body.id, fx: 'cc_glitch', x: body.x, y: body.y, tx, ty });
    body.x = tx; body.y = ty; body.path = [];
    for (const p of aliveHeroes(state)) {
      if (hit.has(p.slot) || dist2(p.x, p.y, tx, ty) > R * R) continue;
      hit.add(p.slot);
      hitHero(state, ev, e, p, dmg, a, { fromX: tx, fromY: ty });
    }
  }
  clearTelegraphs(state, e, a.id);
}

// ---------------- system purge ----------------

function startPurge(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState) {
  beginAttack(state, ev, e, a, target.x, target.y);
  const h = home(state, e);
  const rt = releaseTickOf(state, e, a);
  const n = Math.max(param(e, 'safeMin', 2), Math.min(param(e, 'safeMax', 4), aliveHeroes(state).length + 1));
  const a0 = nextFloat(state.rng.ai) * TAU;
  const sr = param(e, 'safeRadius', 1.3);
  for (let i = 0; i < n; i++) {
    const ang = a0 + (i / n) * TAU + (nextFloat(state.rng.ai) - 0.5) * 0.5;
    const r = h.R * (0.42 + nextFloat(state.rng.ai) * 0.3);
    const [x, y] = floorNear(state, h.x + Math.cos(ang) * r, h.y + Math.sin(ang) * r);
    state.hazards.push(makeHazard(state, { kind: 'cc_safe', owner: 'enemy', ownerId: e.id, x, y, radius: sr, untilTick: rt + T(0.5), armTick: rt, interval: 99999, damage: Big.ZERO, dtype: a.damageType }));
  }
  state.hazards.push(makeHazard(state, { kind: 'cc_purge', owner: 'enemy', ownerId: e.id, x: h.x, y: h.y, radius: h.R, untilTick: rt + T(0.4), armTick: rt, interval: 99999, damage: Big.ZERO, dtype: a.damageType }));
}

function onSafe(state: SimState, e: EnemyState, p: PlayerState): boolean {
  return state.hazards.some((h) => h.kind === 'cc_safe' && h.ownerId === e.id && dist2(p.x, p.y, h.x, h.y) <= (h.radius + 0.2) ** 2);
}

function releasePurge(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef) {
  const h = home(state, e);
  const dmg = damageOf(state, e, a);
  for (const p of aliveHeroes(state)) if (!onSafe(state, e, p)) hitHero(state, ev, e, p, dmg, a, { fromX: h.x, fromY: h.y });
  ev.push({ t: 'foe_fx', id: e.id, fx: 'cc_purge', x: h.x, y: h.y, r: h.R });
}

/** Markers of an attack that a stagger cut short: the purge's flood and safe tiles, every telegraph. */
function cancelMarkers(state: SimState, e: EnemyState) {
  state.hazards = state.hazards.filter((h) => !(h.ownerId === e.id && (h.kind === 'cc_safe' || h.kind === 'cc_purge')));
  state.telegraphs = state.telegraphs.filter((t) => t.ownerId !== e.id || t.attack === 'reinforce');
}

// ---------------- deploy ----------------

function addsOf(state: SimState, e: EnemyState): number {
  return state.enemies.filter((o) => o.summonerId === e.id && ADDS.has(o.kind) && live(o)).length;
}

function startDeploy(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): StartResult {
  const room = param(e, 'addCap', 5) - addsOf(state, e);
  if (room <= 0) return 'skip';
  const plan = (e.phaseIndex >= 1 ? ['coredrone', 'coreturret'] : ['coredrone', 'coredrone']).slice(0, room);
  beginAttack(state, ev, e, a, target.x, target.y);
  const rt = releaseTickOf(state, e, a);
  const bs = bodies(state, e);
  const a0 = nextFloat(state.rng.ai) * TAU;
  plan.forEach((kind, i) => {
    const body = bs[i % bs.length];
    const ang = a0 + (i / plan.length) * TAU;
    const [x, y] = floorNear(state, body.x + Math.cos(ang) * 2.6, body.y + Math.sin(ang) * 2.6);
    telegraph(state, e, kind === 'coreturret' ? 'cc_deploy_t' : 'cc_deploy', { kind: 'circle', radius: 0.9 }, x, y, 0, 0, rt);
  });
  return 'started';
}

function releaseDeploy(state: SimState, ev: SimEvent[], e: EnemyState) {
  const q = fateFactor(state, 'encounter.spawnQuantity');
  const count = q.floorInt() > 0n ? Big.from(q.floorInt()) : ONE;
  for (const t of telegraphsOf(state, e).filter((x) => x.attack === 'cc_deploy' || x.attack === 'cc_deploy_t')) {
    state.pendingSpawns.push({ kind: t.attack === 'cc_deploy_t' ? 'coreturret' : 'coredrone', x: t.x, y: t.y, count, summonerId: e.id, objective: false, groupId: -1 });
    ev.push({ t: 'foe_fx', id: e.id, fx: 'cc_deploy', x: t.x, y: t.y, tx: e.x, ty: e.y });
  }
  clearTelegraphs(state, e, 'cc_deploy');
  clearTelegraphs(state, e, 'cc_deploy_t');
}

// ---------------- mirror split ----------------

function releaseSplit(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef) {
  const h = home(state, e);
  const b = bv(e);
  const R = Math.min(param(e, 'splitRadius', 4.6), h.R - 1.5);
  const a0 = nextFloat(state.rng.ai) * TAU;
  const realSlot = nextInt(state.rng.ai, 3);
  const pos = [0, 1, 2].map((k) => floorNear(state, h.x + Math.cos(a0 + (k * TAU) / 3) * R, h.y + Math.sin(a0 + (k * TAU) / 3) * R));
  const from = { x: e.x, y: e.y };
  [e.x, e.y] = pos[realSlot];
  e.path = [];
  const hpMul = B(param(e, 'echoHealth', 0.12));
  for (let k = 0; k < 3; k++) {
    if (k === realSlot) continue;
    const c = createEnemy(state, ID, pos[k][0], pos[k][1], ONE, { boss: true, objective: false, groupId: -1, summonerId: e.id });
    c.bvars = { echo: 1, rot: ((k - realSlot) * TAU) / 3 };
    c.cohort.unitHp = e.cohort.unitHp.mul(hpMul);
    c.phaseIndex = e.phaseIndex;
    c.cooldowns = {};
    state.enemies.push(c);
    ev.push({ t: 'spawn', id: c.id, kind: c.kind, x: c.x, y: c.y });
  }
  for (const p of pos) ev.push({ t: 'foe_fx', id: e.id, fx: 'cc_split', x: from.x, y: from.y, tx: p[0], ty: p[1] });
  b.spl = 1;
  e.cooldowns['cc_split'] = param(e, 'splitSec', 16);
  e.cooldowns['cc_bolt'] = param(e, 'boltEvery', 2.8) * 0.6;
  void a;
}

/** End the split when it runs out or no echo stands; fire the mirror bolt fans meanwhile. */
function tickSplit(state: SimState, ev: SimEvent[], e: EnemyState) {
  const b = bv(e);
  if (!b.spl) return;
  const echoes = echoesOf(state, e);
  if ((e.cooldowns['cc_split'] ?? 0) <= 0 || !echoes.length) {
    b.spl = 0;
    ev.push({ t: 'foe_fx', id: e.id, fx: 'cc_merge', x: e.x, y: e.y });
    return;
  }
  if ((e.cooldowns['cc_bolt'] ?? 0) > 0 || e.state === 'windup') return;   // never over a telegraph being read
  const a = attackOf(e, 'cc_mirrorbolt')!;
  e.cooldowns['cc_bolt'] = param(e, 'boltEvery', 2.8) / freq(e);
  const dmg = damageOf(state, e, a);
  const speed = (a.projectileSpeed ?? 7) * toFloatClamped(fateFactor(state, 'enemy.projectileSpeed'), 1e6);
  const n = Math.max(1, Math.min(5, Math.round(B(a.projectileCount ?? 3).mul(fateFactor(state, 'enemy.projectileCount')).toNumber())));
  for (const body of [e, ...echoes]) {
    let best: PlayerState | null = null, bd = Infinity;
    for (const p of aliveHeroes(state)) { const d = dist2(p.x, p.y, body.x, body.y); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    const [dx, dy] = norm(best.x - body.x, best.y - body.y);
    for (let i = 0; i < n; i++) {
      const [vx, vy] = rot(dx, dy, (i - (n - 1) / 2) * 0.24);
      state.projectiles.push({
        id: state.nextId++, kind: a.projectileKind ?? 'cc_bolt', owner: 'enemy', ownerId: body.id, x: body.x + vx * 0.8, y: body.y + vy * 0.8,
        vx: vx * speed, vy: vy * speed, radius: 0.22, range: a.range + 2, damage: dmg, weight: ONE, dtype: a.damageType, pierce: 0, hitIds: [],
        skillId: a.id, crit: false, lobTarget: null, bornTick: state.tick,
      });
    }
    ev.push({ t: 'foe_fx', id: body.id, fx: 'cc_bolts', x: body.x, y: body.y, tx: best.x, ty: best.y });
  }
}

/** An echo's tick: copy the Core, rotated about home; dissolve when the split is over. */
function stepEcho(state: SimState, ev: SimEvent[], c: EnemyState) {
  const core = state.enemies.find((o) => o.id === c.summonerId && live(o));
  if (!core || !core.bvars?.spl) {
    c.state = 'dying'; c.deathTimer = 0.35; c.cohort.count = Big.ZERO; c.attack = null;
    ev.push({ t: 'foe_fx', id: c.id, fx: 'cc_dissolve', x: c.x, y: c.y, tx: core?.x, ty: core?.y });
    ev.push({ t: 'death', id: c.id, kind: c.kind, x: c.x, y: c.y });
    return;
  }
  const h = home(state, core);
  const a = c.bvars?.rot ?? 0;
  const [rx, ry] = rot(core.x - h.x, core.y - h.y, a);
  const tx = h.x + rx, ty = h.y + ry;
  if (!isWall(state.map!, Math.floor(tx), Math.floor(ty))) { c.x = tx; c.y = ty; }
  [c.fx, c.fy] = rot(core.fx, core.fy, a);
  c.vx = 0; c.vy = 0;
  c.state = core.state;
  c.attack = core.attack ? { ...core.attack, hitSlots: [] } : null;
  c.phaseIndex = core.phaseIndex;
  c.staggerUntil = core.staggerUntil;
  c.stagger = 0;
}

// ---------------- the script ----------------

const ATTACKS: Record<string, ScriptedAttack> = {
  cc_lasergrid: {
    release: (state, ev, e, a) => {
      fireGrid(state, ev, e, 'cc_lasergrid', a);
      if (e.phaseIndex >= 1) {
        // the crossing grid: perpendicular lanes, marked as the first fires
        const b = bv(e);
        const sec = param(e, 'grid2Sec', 0.95) / freq(e);
        const rt = state.tick + T(sec);
        markGrid(state, e, 'cc_lasergrid2', (b.gth ?? 0) + Math.PI / 2, param(e, 'darkEvery2', 3), rt);
        b.g2 = rt;
        e.attack!.timer = Math.max(e.attack!.timer, sec + DT);
      }
    },
    during: (state, ev, e, a) => {
      const b = bv(e);
      if (b.g2 && state.tick >= b.g2) { b.g2 = 0; fireGrid(state, ev, e, 'cc_lasergrid2', a); }
    },
  },
  cc_firewall: { release: (state, _ev, e, a) => releaseFirewall(state, e, a) },
  cc_deploy: { release: (state, ev, e) => releaseDeploy(state, ev, e) },
  cc_glitch: { release: releaseGlitch },
  cc_purge: { release: releasePurge },
  cc_split: { release: releaseSplit },
};

function start(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): StartResult {
  const b = bv(e);
  switch (a.id) {
    case 'cc_lasergrid': {
      beginAttack(state, ev, e, a, target.x, target.y);
      b.gth = (nextInt(state.rng.ai, 4) * Math.PI) / 4;
      b.g2 = 0;
      markGrid(state, e, 'cc_lasergrid', b.gth, param(e, 'darkEvery', 4), releaseTickOf(state, e, a));
      return 'started';
    }
    case 'cc_firewall': startFirewall(state, ev, e, a, target); return 'started';
    case 'cc_deploy': return startDeploy(state, ev, e, a, target);
    case 'cc_glitch': {
      const [x, y] = glitchDest(state, e, target);
      beginAttack(state, ev, e, a, x, y);
      const rt = releaseTickOf(state, e, a);
      for (const body of bodies(state, e)) {
        const [mx, my] = mirrorPt(state, e, body, x, y);
        telegraph(state, e, a.id, a.telegraph, mx, my, 0, 0, rt);
      }
      return 'started';
    }
    case 'cc_purge': startPurge(state, ev, e, a, target); return 'started';
    case 'cc_split': {
      if (b.spl) return 'skip';
      beginAttack(state, ev, e, a, target.x, target.y);
      return 'started';
    }
    default: return 'skip';
  }
}

function step(state: SimState, ev: SimEvent[], e: EnemyState): boolean {
  if (e.bvars?.echo) { stepEcho(state, ev, e); return true; }
  const h = home(state, e);
  bossPhaseTick(state, ev, e);
  tickSplit(state, ev, e);
  if (e.staggerUntil > state.tick) { e.state = 'stagger'; e.attack = null; e.vx = 0; e.vy = 0; cancelMarkers(state, e); return true; }
  if (e.state === 'stagger') e.state = 'idle';
  if (stepScripted(state, ev, e, ATTACKS)) return true;
  runPatterns(state, ev, e, (target) => {
    if (target) face(e, target.x, target.y);
    // drift back over the platform between patterns (held still while split, so the echoes stay mirrored)
    if (!bv(e).spl && dist2(e.x, e.y, h.x, h.y) > 2.5 * 2.5) {
      walkToward(state, e, h.x, h.y);
      if (target) face(e, target.x, target.y);
      e.state = 'move';
    } else { e.vx = 0; e.vy = 0; e.state = 'idle'; }
  }, (a, target) => start(state, ev, e, a, target));
  return true;
}

// ---------------- reference player hints (bot.ts) ----------------

function botHint(state: SimState, p: PlayerState, e: EnemyState): BotHint | null {
  if (e.bvars?.echo) return null;
  // purge: run for the nearest safe tile
  const safe = state.hazards.filter((h) => h.kind === 'cc_safe' && h.ownerId === e.id);
  if (safe.length) {
    if (onSafe(state, e, p)) return { x: p.x, y: p.y, hold: true };
    let best = safe[0], bd = Infinity;
    for (const h of safe) { const d = dist2(p.x, p.y, h.x, h.y); if (d < bd) { bd = d; best = h; } }
    return { x: best.x, y: best.y, dodge: Math.sqrt(bd) > 3 && (best.armTick ?? 0) - state.tick < 50 };
  }
  // lit laser lanes, corrupted tiles and the flames of every wall arriving soon (outside its port) are bad ground:
  // stand still where none of them reaches, else walk to the nearest such spot, else roll back through a wall
  const lanes = telegraphsOf(state, e).filter((t) => t.attack === 'cc_lasergrid' || t.attack === 'cc_lasergrid2');
  const corrupt = state.hazards.filter((h) => h.kind === 'cc_corrupt' && h.ownerId === e.id);
  // a wall threatens the ground from just behind its flames to where it will be in ~2 s (its port excepted)
  const reachOf = (h: Hazard, x: number, y: number) => (x - h.x) * -h.dy + (y - h.y) * h.dx - wallOffset(state, h);
  const walls = state.hazards.filter((h) => {
    if (h.kind !== 'cc_firewall' || h.ownerId !== e.id || h.hitSlots.includes(p.slot)) return false;
    const across = reachOf(h, p.x, p.y);
    return across > -(h.width / 2 + 0.5) && across < h.speed * 2.2;
  });
  const inLane = (x: number, y: number) => lanes.some((t) => { const sh = t.shape as { length: number; width: number }; return inLine(t.x, t.y, t.dx, t.dy, sh.length, sh.width / 2, x, y, 0.3); });
  const inCorrupt = (x: number, y: number) => corrupt.some((h) => Math.abs(x - h.x) <= h.radius + 0.3 && Math.abs(y - h.y) <= h.radius + 0.3);
  const offPort = (x: number, y: number) => walls.some((h) => {
    const across = reachOf(h, x, y);
    if (across < -(h.width / 2 + 0.45) || across > h.speed * 2.2) return false;
    const along = (x - h.x) * h.dx + (y - h.y) * h.dy;
    return !(along > h.inner + 0.4 && along < h.outer - 0.4);
  });
  if (!lanes.length && !walls.length && !inCorrupt(p.x, p.y)) return null;
  const bad = (x: number, y: number) => inLane(x, y) || inCorrupt(x, y) || offPort(x, y);
  if (!bad(p.x, p.y)) return { x: p.x, y: p.y, hold: lanes.length > 0 || walls.length > 0 };
  const s = safeSpot(state, p, bad, 6, 0.3);
  if (s) return s;
  for (const h of walls) {
    const mx = -h.dy, my = h.dx;
    const across = (p.x - h.x) * mx + (p.y - h.y) * my - wallOffset(state, h);
    if (across < 1.1) return { x: p.x - mx * 3, y: p.y - my * 3, dodge: true };
  }
  return null;
}

registerBossScript(ID, { step, botHint });

registerBossHazard('cc_firewall', tickFirewall);
registerBossHazard('cc_corrupt', tickCorrupt);
registerBossHazard('cc_safe', () => undefined);    // markers: the purge resolves at its release
registerBossHazard('cc_purge', () => undefined);

registerGlobalHooks({
  onKill(state, ev, e) {
    // a destroyed echo bursts into corrupted tiles where it hovered
    if (e.kind !== ID || !e.bvars?.echo) return;
    const core = state.enemies.find((o) => o.id === e.summonerId && live(o));
    ev.push({ t: 'foe_fx', id: e.id, fx: 'cc_echo_pop', x: e.x, y: e.y });
    if (core) corruptAt(state, core, e.x, e.y);
  },
});
