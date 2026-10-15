import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID, TICK_SEC } from '@cursebound/content';
import { addDot, addStagger, healPlayer, hitEnemy, shieldPlayer, type CohortResult } from '../combat';
import { arrived, beyondLeash, blinkTo, clearLane, followStep, ownerSlot, reachableFrom, routeStep, spreadFrom, trackStuck } from '../follow';
import { registerClassHooks, registerGlobalHooks, type SimHooks } from '../hooks';
import { inCone, inLine, moveCircle, norm, rayDistance } from '../geometry';
import { nearestFloor } from '../map';
import { areaCoverage, cosHalf, cutCooldowns, flinch, knockback, livingEnemies, makeHazard, newProjectileId, spawnPlayerProjectiles } from '../players';
import { B, ONE, breakdown, hitDamage, playerDerived, treeFactor } from '../stats';
import type { EnemyState, Hazard, PlayerState, Projectile, SimEvent, SimState } from '../types';

// Warden kit (content: packages/content/src/classes/warden.ts). Deterministic: state, arguments and the seeded rng
// streams only (this kit draws no randomness). Per-player counters live in p.vars ('w_' prefix, ticks for timers).
//
// The sim has no allied units, so spirit beasts are player-owned hazards that move every tick in hazardTick.
// Hazard kinds and the snapshot fields the client reads (SnapHazard: x y dx dy len w r in out sp b u):
//   w_wolf / w_ursa  beast body. dx,dy facing; r body radius; sp current speed (u/s); len leap ticks left (>0 airborne);
//                    w tick of the last bite/swipe; in variant (0 wolf, 1 dire wolf, 2 Ursa); out 1 while frenzied.
//   w_stampede       Wild Hunt lane: origin x,y, direction dx,dy, len lane length, w lane width, sp speed (u/s).
//   w_roots          root patch: circle (r) or, when len > 0, a line (x,y origin, dx,dy, len, w).
//   w_worldroot      Worldroot Eruption line; the eruption front is sp * (tick - b) / 60, then it is a root patch.
//   w_root           per-enemy root marker at the rooted position; vines hold while tick < out (root end tick).
//   w_totem          Verdant Totem at x,y; r heal radius.
//   w_bramble        Bramble Wall line (x,y start, dx,dy along the wall, len, w).
//   w_pod            Ironthorn Pod; detonates at tick out.
//   w_aura           cosmetic aura following the Warden: in thorn armor (0 none, 1 half, 2 full), out 1 Barkskin, len 1 Feral Shift.

const DT = TICK_SEC;
const ticks = (sec: number) => Math.round(sec / DT);
const ZERO = Big.ZERO;
const ROOT_IMMUNE = ticks(1.5);
const HUNT_R = 9;            // beasts hunt enemies within this distance of the Warden
const LEASH_R = 10;          // a target beyond this distance of the Warden is dropped
// beasts beyond RULES.followBlinkRange of the Warden blink back to it (follow.ts leash)
const COS_SPEAR = cosHalf(80);
const COS_MAUL = cosHalf(150);
const COS_SWIPE = cosHalf(120);

const GROVE = new Set(['w_entangle', 'w_verdant_totem', 'w_worldroot']);

const rk = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;
const isLive = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();
const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
/** factor^rank by repeated multiplication (bit-identical on every engine, unlike Math.pow). */
function powr(f: number, r: number): number { let x = 1; for (let i = 0; i < r; i++) x *= f; return x; }

function enemyById(state: SimState, id: number | undefined): EnemyState | undefined {
  if (!id) return undefined;
  for (const e of state.enemies) if (e.id === id && isLive(e)) return e;
  return undefined;
}

/** Living enemies touching the circle, nearest first (ties by id). */
function enemiesNear(state: SimState, x: number, y: number, r: number): EnemyState[] {
  const out: { e: EnemyState; d: number }[] = [];
  for (const e of state.enemies) {
    if (!isLive(e)) continue;
    const d = d2(e.x, e.y, x, y);
    if (d <= (r + e.radius) ** 2) out.push({ e, d });
  }
  out.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return out.map((o) => o.e);
}

function castEv(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number, count?: string) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy, ...(count ? { count } : {}) });
}

/** Aimed ground point, aim distance clamped to [minR, maxR] and stopped short of walls. Always floor. */
function aimPt(state: SimState, p: PlayerState, maxR: number, minR = 1): [number, number] {
  const want = Math.min(maxR, Math.max(minR, p.aimDist || maxR));
  const map = state.map!;
  const free = rayDistance(map, p.x, p.y, p.aimX, p.aimY, want);
  const d = free < want - 1e-6 ? Math.max(0, free - 0.35) : want;
  return nearestFloor(map, p.x + p.aimX * d, p.y + p.aimY * d);
}

// ---------------- derived Warden stats (cached per state version, like playerDerived) ----------------

interface WardenDerived { beast: Big; thorns: Big; rootDur: number; heal: Big }
const wdCache = new WeakMap<PlayerState, { v: number; d: WardenDerived }>();
function wd(state: SimState, p: PlayerState): WardenDerived {
  const c = wdCache.get(p);
  if (c && c.v === state.stateVersion) return c.d;
  const r = (s: string) => breakdown(state, p, s).result;
  const d: WardenDerived = { beast: r('player.beastDamage'), thorns: r('player.thornsDamage'), rootDur: Math.min(1e6, r('player.rootDuration').toNumber()), heal: r('player.natureHealing') };
  wdCache.set(p, { v: state.stateVersion, d });
  return d;
}

/** Skill hit damage; evolved skills also inherit their base skill's damage modifiers. */
function sdmg(state: SimState, p: PlayerState, skillId: string, inherit?: string): Big {
  const d = hitDamage(state, p, skillId, 'physical');
  return inherit ? d.mul(treeFactor(p, `skill.${inherit}.damage`).factor) : d;
}

const growth = (p: PlayerState) => powr(1.15, rk(p, 'w_wild_growth'));

// ---------------- Venom ----------------

function venomOf(state: SimState, p: PlayerState, e: EnemyState): Big {
  let v = ZERO;
  for (const d of e.dots) if (d.src === p.slot && d.type === 'decay' && d.until > state.tick) v = v.add(d.perSec);
  return v;
}
const hasVenom = (state: SimState, p: PlayerState, e: EnemyState) => e.dots.some((d) => d.src === p.slot && d.type === 'decay' && d.until > state.tick);

/** Venom: `frac` of a (pre-mitigation) hit as decay damage per second, x Decay damage. */
function applyVenom(state: SimState, p: PlayerState, e: EnemyState, perHit: Big, frac: string, sec: number) {
  if (!isLive(e)) return;
  addDot(state, e, p.slot, 'decay', perHit.mul(B(frac)).mul(playerDerived(state, p).typeMult.decay), sec);
}
/** Raise an enemy's Venom from this Warden to `perSec` (an enemy keeps the stronger Venom: spreading never snowballs). */
function topUpVenom(state: SimState, p: PlayerState, e: EnemyState, perSec: Big, sec: number) {
  const cur = venomOf(state, p, e);
  if (perSec.gt(cur)) addDot(state, e, p.slot, 'decay', perSec.sub(cur), sec);
}
const venomSec = (p: PlayerState) => (has(p, 'w_festering') ? 6 : 4);

function thornMul(state: SimState, p: PlayerState, e?: EnemyState): Big {
  const m = wd(state, p).thorns;
  return e && has(p, 'w_festering') && hasVenom(state, p, e) ? m.mul(B('1.3')) : m;
}

// ---------------- beasts: damage helpers ----------------

function marked(state: SimState, p: PlayerState, e: EnemyState): boolean {
  return has(p, 'w_alpha_wild') && p.vars.w_mark === e.id && (p.vars.w_markUntil ?? 0) > state.tick;
}
function beastMul(state: SimState, p: PlayerState, e?: EnemyState): Big {
  const m = wd(state, p).beast;
  return e && marked(state, p, e) ? m.mul(B('1.5')) : m;
}
function wolfMul(state: SimState, p: PlayerState, e: EnemyState): Big {
  const m = beastMul(state, p, e);
  if (has(p, 'w_dire_wolves')) return m.mul(B('2.2'));
  if (has(p, 'w_endless_pack')) return m.mul(B('0.75'));
  return m;
}
const BLEED = ['', '0.12', '0.24'];
const wolfBleed = (p: PlayerState) => {
  const r = Math.min(2, rk(p, 'w_bloodied_fangs'));
  return r > 0 ? { type: 'physical' as const, fractionPerSec: BLEED[r], durationSec: 3 } : undefined;
};
const frenzied = (state: SimState, p: PlayerState) => (p.vars.w_frenzyUntil ?? 0) > state.tick;

/** Spirit Bond / Pack Frenzy bookkeeping after a beast hit. */
function beastAfterHit(state: SimState, p: PlayerState, ev: SimEvent[], e: EnemyState, res: CohortResult) {
  if (res.dealt.isZero()) return;
  if (has(p, 'w_spirit_bond')) healPlayer(state, ev, p, res.dealt.mul(B('0.04')));
  if (!isLive(e) || !res.kills.isZero()) {
    if (has(p, 'w_spirit_bond') && p.lifeState === 'alive') cutCooldowns(p, 0.3);   // beast kills speed the hotbar (no resource)
    if (has(p, 'w_pack_frenzy')) p.vars.w_frenzyUntil = state.tick + ticks(4);
  }
}

// ---------------- roots ----------------

function rootMarker(state: SimState, enemyId: number): Hazard | undefined {
  for (const h of state.hazards) if (h.kind === 'w_root' && h.vars && h.vars.e === enemyId && h.untilTick > state.tick) return h;
  return undefined;
}

/** Root an enemy for `sec` (x Root duration). Bosses are never rooted and take `bossStagger` instead. Returns true if rooted. */
function rootEnemy(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, sec: number, gen = 0, bossStagger = 40): boolean {
  if (!isLive(e)) return false;
  if (e.boss) { addStagger(state, ev, e, bossStagger); return false; }
  const n = Math.max(1, Math.round((sec * wd(state, p).rootDur) / DT));
  // roots never stack or extend: a rooted enemy stays on its current root, a freed one is immune for 1.5s
  const cur = rootMarker(state, e.id);
  if (cur) return state.tick < cur.outer;
  const end = state.tick + n;
  state.hazards.push(makeHazard(state, {
    kind: 'w_root', owner: 'player', ownerId: p.slot, x: e.x, y: e.y, radius: Math.min(1.6, e.radius), inner: state.tick, outer: end,
    untilTick: end + ROOT_IMMUNE, interval: 99999, nextTick: end + ROOT_IMMUNE + 1, damage: ZERO, dtype: 'physical', generation: gen, vars: { e: e.id, done: 0 },
  }));
  if (has(p, 'w_strangling_vines')) {
    addDot(state, e, p.slot, 'physical', hitDamage(state, p, 'w_strangle', 'physical'), n * DT);
    if (e.attack && e.attack.stage === 'windup') { e.attack = null; e.state = 'recovery'; e.cooldowns['_recover'] = 0.4; }
    e.staggerUntil = Math.max(e.staggerUntil, state.tick + ticks(0.6));
  }
  return true;
}

function rootEnded(state: SimState, ev: SimEvent[], h: Hazard, e: EnemyState) {
  const p = state.players[h.ownerId];
  if (!p || !has(p, 'w_worldtree_grasp')) return;
  const secs = Math.min(3, (h.outer - h.inner) * DT);
  if (secs <= 0) return;
  const dmg = hitDamage(state, p, 'w_bloodroot', 'physical').mul(B(secs.toFixed(2)));
  hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_bloodroot', fromX: e.x, fromY: e.y, allowCrit: true, generation: 1 });
  castEv(ev, p, 'w_bloodroot', e.x, e.y, 0, 0);
}

function inHazard(h: Hazard, e: EnemyState, lenOverride?: number): boolean {
  if (h.length > 0) return inLine(h.x, h.y, h.dx, h.dy, lenOverride ?? h.length, h.width / 2, e.x, e.y, e.radius);
  return d2(e.x, e.y, h.x, h.y) <= (h.radius + e.radius) ** 2;
}

function spawnPatch(state: SimState, p: PlayerState, x: number, y: number, radius: number, sec: number, gen: number) {
  state.hazards.push(makeHazard(state, {
    kind: 'w_roots', owner: 'player', ownerId: p.slot, x, y, radius, untilTick: state.tick + ticks(sec),
    interval: ticks(0.5), nextTick: state.tick + ticks(0.5), damage: sdmg(state, p, 'w_root_pulse'), dtype: 'physical', generation: gen,
  }));
}

/** Root patch pulse: 0.25x physical and a 1s root to enemies inside; Heart of the Forest heals allies inside. */
function pulsePatch(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState) {
  const cov = h.length > 0 ? h.width / 2 : h.radius;
  for (const e of livingEnemies(state)) {
    if (!inHazard(h, e)) continue;
    hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_root_pulse', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, cov), allowCrit: false, generation: h.generation > 0 ? 1 : 0 });
    rootEnemy(state, ev, p, e, 1, h.generation, 8);
  }
  if (has(p, 'w_forest_heart')) {
    const heal = wd(state, p).heal;
    for (const a of state.players) {
      if (a.lifeState !== 'alive') continue;
      const inside = h.length > 0 ? inLine(h.x, h.y, h.dx, h.dy, h.length, h.width / 2, a.x, a.y, 0.3) : d2(a.x, a.y, h.x, h.y) <= (h.radius + 0.3) ** 2;
      if (inside) healPlayer(state, ev, a, a.maxHp.mul(B('0.01')).mul(heal));
    }
  }
}

/** Entangle burst (also Verdant Totem's eruption): 2.4 radius hit + 2s root, leaving a 4s root patch. */
function entangleBurst(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, skillId: string) {
  const R = 2.4 * growth(p);
  const dmg = sdmg(state, p, skillId, skillId === 'w_entangle' ? undefined : 'w_entangle');
  for (const e of enemiesNear(state, x, y, R)) {
    hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId, fromX: x, fromY: y, coverage: areaCoverage(e, R), allowCrit: true });
    rootEnemy(state, ev, p, e, 2);
  }
  spawnPatch(state, p, x, y, R, 4, 0);
}

// ---------------- thorns ----------------

/** Thorn nova (Thornburst and its evolutions): hit + Venom, x Thorns damage. */
function thornNova(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, R: number, skillId: string, inherit?: string) {
  const base = sdmg(state, p, skillId, inherit);
  const vs = venomSec(p);
  for (const e of enemiesNear(state, x, y, R)) {
    const d = base.mul(thornMul(state, p, e));
    const res = hitEnemy(state, ev, e, d, ONE, { dtype: 'physical', srcSlot: p.slot, skillId, fromX: x, fromY: y, coverage: areaCoverage(e, R), allowCrit: true, stagger: 30 });
    if (!res.dealt.isZero()) applyVenom(state, p, e, d, '0.25', vs);
    flinch(state, e, x, y, 0.3);
  }
}

function grantThornArmor(state: SimState, p: PlayerState, sec: number) {
  p.vars.w_thornUntil = Math.max(p.vars.w_thornUntil ?? 0, state.tick + ticks(sec));
}
/** 2 = full Thorn Armor, 1 = half (Bramblehide), 0 = none. */
function thornStrength(state: SimState, p: PlayerState): number {
  if ((p.vars.w_thornUntil ?? 0) > state.tick) return 2;
  return has(p, 'w_bramblehide') ? 1 : 0;
}

const DIRS8: [number, number][] = [[1, 0], [0.70710678, 0.70710678], [0, 1], [-0.70710678, 0.70710678], [-1, 0], [-0.70710678, -0.70710678], [0, -1], [0.70710678, -0.70710678]];

function podShards(state: SimState, p: PlayerState, x: number, y: number) {
  const skill = SKILL_BY_ID['w_thorn_shard'];
  if (skill.shape.kind !== 'projectile') return;
  const dmg = hitDamage(state, p, 'w_thorn_shard', 'physical').mul(wd(state, p).thorns);
  for (const [dx, dy] of DIRS8) {
    const pr: Projectile = {
      id: newProjectileId(state), kind: 'w_thorn', owner: 'player', ownerId: p.slot, x: x + dx * 0.4, y: y + dy * 0.4,
      vx: dx * skill.shape.speed, vy: dy * skill.shape.speed, radius: skill.shape.radius, range: skill.shape.range, damage: dmg, weight: ONE,
      dtype: 'physical', pierce: skill.shape.pierce, hitIds: [], skillId: 'w_thorn_shard', crit: false, lobTarget: null, bornTick: state.tick,
    };
    state.projectiles.push(pr);
  }
}

// ---------------- the pack ----------------

function packMax(p: PlayerState): number {
  if (has(p, 'w_feral_shift')) return 1;
  let m = has(p, 'w_dire_wolves') ? 2 : has(p, 'w_endless_pack') ? 5 : 3;
  if (has(p, 'w_alpha_wild')) m += 1;
  return m;
}
const beastSpeedMul = (state: SimState, p: PlayerState) => powr(1.1, rk(p, 'w_long_hunt')) * (frenzied(state, p) ? 1.3 : 1);
const wolfLife = (p: PlayerState) => ticks((has(p, 'w_endless_pack') ? 25 : 18) * powr(1.25, rk(p, 'w_long_hunt')));
const biteInterval = (state: SimState, p: PlayerState, base: number) => Math.max(1, ticks(frenzied(state, p) ? base / 1.6 : base));

function myBeasts(state: SimState, p: PlayerState, kind: string): Hazard[] {
  return state.hazards.filter((h) => h.kind === kind && h.ownerId === p.slot && h.untilTick > state.tick);
}

// spawn offsets around the Warden (world units)
const SPAWN_OFF: [number, number][] = [[-0.8, 0.5], [0.8, 0.5], [0, -0.9], [-0.9, -0.5], [0.9, -0.5], [0, 1]];
// follow formation, as (along aim, sideways): behind and to the flanks
const FOLLOW_OFF: [number, number][] = [[-1.1, 0.8], [-1.1, -0.8], [-1.7, 0], [-0.5, 1.3], [-0.5, -1.3], [-2.1, 0.9]];

function startLeap(state: SimState, h: Hazard, e: EnemyState, kind: 1 | 2) {
  const v = h.vars!;
  const dist = Math.sqrt(d2(h.x, h.y, e.x, e.y));
  v.leap = Math.max(5, Math.ceil(dist / 14 / DT));      // 14 u/s, at least 5 ticks airborne
  v.lk = kind;                                           // 1 pounce (0.9x), 2 commanded leap (1.2x)
  v.tgt = e.id;
  v.lx = e.x; v.ly = e.y;
  const [nx, ny] = norm(e.x - h.x, e.y - h.y);
  if (nx || ny) { h.dx = nx; h.dy = ny; }
}

/** Call of the Pack: refresh and fill the pack, then every wolf leaps at the enemy nearest (ax, ay). */
function callPack(state: SimState, ev: SimEvent[], p: PlayerState, ax: number, ay: number) {
  const life = wolfLife(p);
  const max = packMax(p);
  const wolves = myBeasts(state, p, 'w_wolf');
  while (wolves.length > max) wolves.shift()!.untilTick = state.tick;   // dismiss the oldest beyond the limit
  for (const w of wolves) w.untilTick = state.tick + life;
  const used = new Set(wolves.map((w) => w.vars!.i));
  const dire = has(p, 'w_dire_wolves');
  for (let i = 0; wolves.length < max && i < 6; i++) {
    if (used.has(i)) continue;
    const [ox, oy] = SPAWN_OFF[i];
    const r = moveCircle(state.map!, p.x, p.y, ox, oy, 0.25);
    const w = makeHazard(state, {
      kind: 'w_wolf', owner: 'player', ownerId: p.slot, x: r.x, y: r.y, dx: p.aimX, dy: p.aimY, radius: dire ? 0.45 : 0.32, inner: dire ? 1 : 0,
      untilTick: state.tick + life, interval: ticks(0.9), nextTick: state.tick, damage: ZERO, dtype: 'physical',
      vars: { i, tgt: 0, pcd: state.tick + ticks(1), leap: 0, lk: 0, lx: 0, ly: 0, bite: -9999 },
    });
    state.hazards.push(w);
    wolves.push(w);
  }
  let best: EnemyState | undefined; let bd = Infinity;
  for (const e of state.enemies) {
    if (!isLive(e) || d2(e.x, e.y, p.x, p.y) > 64) continue;
    const d = d2(e.x, e.y, ax, ay);
    if (d < bd) { bd = d; best = e; }
  }
  if (best) for (const w of wolves) startLeap(state, w, best, 2);
}

/** Pick (or keep) a beast's target: the Alpha mark first, else the current target, else the nearest enemy within HUNT_R of the Warden. */
function acquire(state: SimState, h: Hazard, p: PlayerState): EnemyState | undefined {
  const v = h.vars!;
  const unr = (v.unrT ?? 0) > state.tick ? v.unr : 0;   // a target this beast just failed to reach (huntStep)
  if (has(p, 'w_alpha_wild') && (p.vars.w_markUntil ?? 0) > state.tick) {
    const m = enemyById(state, p.vars.w_mark);
    if (m && m.id !== unr && d2(m.x, m.y, p.x, p.y) <= (LEASH_R + 2) ** 2) { v.tgt = m.id; return m; }
  }
  let e = enemyById(state, v.tgt);
  if (e && d2(e.x, e.y, p.x, p.y) > LEASH_R * LEASH_R) e = undefined;
  if (!e) {
    let bd = Infinity;
    for (const c of state.enemies) {
      if (!isLive(c) || c.id === unr || d2(c.x, c.y, p.x, p.y) > HUNT_R * HUNT_R) continue;
      const d = d2(c.x, c.y, h.x, h.y);
      if (d < bd) { bd = d; e = c; }
    }
  }
  v.tgt = e ? e.id : 0;
  return e;
}

// ---------------- beast movement (routing: ../follow.ts) ----------------
// Beasts walk around walls and chasm voids on throttled A* routes, never stay stuck (stalled progress re-paths, then
// blinks back to the Warden's side when following, or gives the target up when hunting), and spread so the pack
// does not stack. Speeds are authored x RULES.minionMoveSpeedMult.

/** Collision radius a beast walks with. */
const beastBody = (h: Hazard) => Math.min(0.4, h.radius);
/** Ursa's own formation slot (it used to share wolf slot 2 and stood inside that wolf). */
const URSA_OFF: [number, number] = [-2.4, -1.0];
/** Ticks a target the beast could not reach is ignored by acquire. */
const UNREACHABLE_TICKS = ticks(1.5);

function beastPeers(state: SimState, p: PlayerState): Hazard[] {
  return state.hazards.filter((h) => (h.kind === 'w_wolf' || h.kind === 'w_ursa') && h.owner === 'player' && h.ownerId === p.slot && h.untilTick > state.tick);
}

/** Formation slot (along aim, sideways) beside the Warden, on the Warden's side of every wall and gap. */
function beastSlot(state: SimState, p: PlayerState, off: [number, number], body: number): [number, number] {
  const [along, side] = off;
  return ownerSlot(state, p, p.aimX * along - p.aimY * side, p.aimY * along + p.aimX * side, body);
}

/** Leash: a beast past the follow range blinks to its formation slot. Returns true if it blinked. */
function leashBeast(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState, off: [number, number]): boolean {
  if (!beyondLeash(h, p)) return false;
  const [sx, sy] = beastSlot(state, p, off, beastBody(h));
  blinkTo(state, ev, h, p, sx, sy);
  h.vars!.tgt = 0;
  return true;
}

function followOwner(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState, off: [number, number], speed: number) {
  const body = beastBody(h);
  const [tx, ty] = beastSlot(state, p, off, body);
  const d = Math.sqrt(d2(h.x, h.y, tx, ty));
  followStep(state, ev, h, p, tx, ty, speed * (d > 3 ? 1.75 : 1.25), body);   // catch up faster when left behind
}

/** Hunt toward (tx, ty) beside target e. A target the beast cannot reach (no route, a long detour around a gap, or
 *  stuck twice) is dropped and ignored for a moment so acquire picks a reachable one. */
function huntStep(state: SimState, h: Hazard, e: EnemyState, tx: number, ty: number, maxStep: number) {
  const v = h.vars!;
  const res = routeStep(state, h, tx, ty, maxStep, beastBody(h));
  const strikes = res === 'fail' ? 2 : trackStuck(state, h, tx, ty, Math.sqrt(d2(h.x, h.y, tx, ty)));
  if (strikes >= 2) { v.unr = e.id; v.unrT = state.tick + UNREACHABLE_TICKS; v.tgt = 0; arrived(h); }
}

/** Approach point at distance `reach` from e on the beast's side, rotated sideways by `side`; reachable from e. */
function besideTarget(state: SimState, h: Hazard, e: EnemyState, reach: number, side: number): [number, number] {
  const [ux, uy] = norm(h.x - e.x, h.y - e.y);
  return reachableFrom(state, e.x, e.y, ux * reach - uy * side, uy * reach + ux * side, beastBody(h));
}

function landLeap(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState) {
  const v = h.vars!;
  const skillId = v.lk === 2 ? 'w_pack_command' : 'w_wolf_pounce';
  const base = hitDamage(state, p, skillId, 'physical');
  const dire = has(p, 'w_dire_wolves');
  for (const e of enemiesNear(state, h.x, h.y, 0.9)) {
    const res = hitEnemy(state, ev, e, base.mul(wolfMul(state, p, e)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId, fromX: h.x, fromY: h.y, coverage: areaCoverage(e, 0.9), allowCrit: true, dot: wolfBleed(p), stagger: 20 });
    beastAfterHit(state, p, ev, e, res);
    if (dire) knockback(state, e, h.x, h.y, 0.8); else flinch(state, e, h.x, h.y, 0.25);
  }
  castEv(ev, p, 'w_wolf_pounce', h.x, h.y, h.dx, h.dy);
  v.leap = 0; v.lk = 0;
  v.bite = state.tick;
  h.nextTick = Math.max(h.nextTick, state.tick + ticks(0.35));
}

function stepWolf(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState) {
  const v = h.vars!;
  const ox = h.x, oy = h.y;
  const speed = 7.5 * beastSpeedMul(state, p) * RULES.minionMoveSpeedMult;
  const off = FOLLOW_OFF[v.i % FOLLOW_OFF.length];
  h.outer = frenzied(state, p) ? 1 : 0;
  let faceX = 0, faceY = 0;
  if (v.leap <= 0) leashBeast(state, ev, h, p, off);
  if (v.leap > 0) {
    const e = enemyById(state, v.tgt);
    if (e) {
      const [nx, ny] = norm(h.x - e.x, h.y - e.y);
      v.lx = e.x + nx * (e.radius * 0.5 + 0.15); v.ly = e.y + ny * (e.radius * 0.5 + 0.15);
    }
    const r = moveCircle(state.map!, h.x, h.y, (v.lx - h.x) / v.leap, (v.ly - h.y) / v.leap, 0.25);
    h.x = r.x; h.y = r.y;
    v.leap--;
    if (v.leap <= 0) landLeap(state, ev, h, p);
  } else {
    const e = acquire(state, h, p);
    if (e) {
      const dist = Math.sqrt(d2(h.x, h.y, e.x, e.y));
      const gap = dist - e.radius - h.radius;
      faceX = e.x - h.x; faceY = e.y - h.y;
      if (gap > 1.6 && gap < 4.5 && state.tick >= v.pcd && clearLane(state.map!, h.x, h.y, e.x, e.y, 0.25)) {
        // pounce only along an open lane (never into a wall or across a chasm)
        startLeap(state, h, e, 1);
        v.pcd = state.tick + ticks(4);
      } else if (gap > 0.3) {
        // approach a flank slot around the target so the pack spreads out
        const side = (v.i % 2 ? 1 : -1) * Math.min(2, v.i) * 0.3;
        const [tx, ty] = besideTarget(state, h, e, e.radius + h.radius + 0.15, side);
        huntStep(state, h, e, tx, ty, speed * DT);
      } else {
        arrived(h);   // in bite range: no stuck window running
        if (state.tick >= h.nextTick) {
          const dmg = hitDamage(state, p, 'w_wolf_bite', 'physical').mul(wolfMul(state, p, e));
          const res = hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_wolf_bite', fromX: h.x, fromY: h.y, allowCrit: true, dot: wolfBleed(p) });
          beastAfterHit(state, p, ev, e, res);
          flinch(state, e, h.x, h.y, 0.1);
          h.nextTick = state.tick + biteInterval(state, p, 0.9);
          v.bite = state.tick;
        }
      }
    } else followOwner(state, ev, h, p, off, speed);
    spreadFrom(state, h, beastBody(h), beastPeers(state, p), beastBody);
  }
  finishBeastStep(h, ox, oy, faceX, faceY);
  h.length = Math.max(0, v.leap);
  h.width = v.bite;
}

function finishBeastStep(h: Hazard, ox: number, oy: number, faceX: number, faceY: number) {
  const mx = h.x - ox, my = h.y - oy;
  const moved = Math.sqrt(mx * mx + my * my);
  h.speed = moved / DT;
  if (moved > 1e-4) { h.dx = mx / moved; h.dy = my / moved; }
  else if (faceX || faceY) { const [fx, fy] = norm(faceX, faceY); h.dx = fx; h.dy = fy; }
}

function stepUrsa(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState) {
  const v = h.vars!;
  const ox = h.x, oy = h.y;
  const speed = 5 * beastSpeedMul(state, p) * RULES.minionMoveSpeedMult;
  h.outer = frenzied(state, p) ? 1 : 0;
  let faceX = 0, faceY = 0;
  leashBeast(state, ev, h, p, URSA_OFF);
  const e = acquire(state, h, p);
  if (e) {
    const dist = Math.sqrt(d2(h.x, h.y, e.x, e.y));
    const gap = dist - e.radius - h.radius;
    faceX = e.x - h.x; faceY = e.y - h.y;
    if (gap > 0.8) {
      const [tx, ty] = besideTarget(state, h, e, e.radius + h.radius + 0.5, 0);
      huntStep(state, h, e, tx, ty, Math.min(speed * DT, gap - 0.6));
    } else {
      arrived(h);   // in swipe range: no stuck window running
      if (state.tick >= h.nextTick) {
        const [fx, fy] = norm(faceX, faceY);
        const base = hitDamage(state, p, 'w_ursa_swipe', 'physical');
        for (const t of livingEnemies(state)) {
          if (!inCone(h.x, h.y, fx, fy, 1.8 + h.radius, COS_SWIPE, t.x, t.y, t.radius)) continue;
          const res = hitEnemy(state, ev, t, base.mul(beastMul(state, p, t)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_ursa_swipe', fromX: h.x, fromY: h.y, coverage: areaCoverage(t, 1.8), allowCrit: true, stagger: 40 });
          beastAfterHit(state, p, ev, t, res);
          flinch(state, t, h.x, h.y, 0.35);
        }
        castEv(ev, p, 'w_ursa_swipe', h.x, h.y, fx, fy);
        h.nextTick = state.tick + biteInterval(state, p, 1.4);
        v.bite = state.tick;
      }
    }
  } else followOwner(state, ev, h, p, URSA_OFF, speed);
  spreadFrom(state, h, beastBody(h), beastPeers(state, p), beastBody);
  finishBeastStep(h, ox, oy, faceX, faceY);
  h.length = 0;
  h.width = v.bite;
}

/** Wild Hunt stampede: the front sweeps the lane; every enemy is trampled once. */
function stepStampede(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState) {
  const front = Math.min(h.length, h.speed * (state.tick - h.bornTick + 1) * DT);
  const half = h.width / 2;
  let base: Big | null = null;
  for (const e of livingEnemies(state)) {
    if (h.hitSlots.includes(e.id)) continue;
    const vx = e.x - h.x, vy = e.y - h.y;
    const along = vx * h.dx + vy * h.dy;
    if (along < -e.radius || along > front + e.radius) continue;
    if (Math.abs(-vx * h.dy + vy * h.dx) > half + e.radius) continue;
    h.hitSlots.push(e.id);
    base ??= hitDamage(state, p, 'w_wild_hunt', 'physical');
    const res = hitEnemy(state, ev, e, base.mul(beastMul(state, p, e)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_wild_hunt', fromX: e.x - h.dx, fromY: e.y - h.dy, coverage: areaCoverage(e, half), allowCrit: true, stagger: 160 });
    beastAfterHit(state, p, ev, e, res);
    knockback(state, e, e.x - h.dx, e.y - h.dy, 1.5);
  }
}

// ---------------- Alpha Pounce (scripted leap) ----------------

function landAlpha(state: SimState, ev: SimEvent[], p: PlayerState) {
  const R = 2.2;
  const dmg = sdmg(state, p, 'w_alpha_pounce', 'w_call_pack');
  for (const e of enemiesNear(state, p.x, p.y, R)) {
    hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_alpha_pounce', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, R), allowCrit: true, stagger: 80 });
    rootEnemy(state, ev, p, e, 1);
  }
  castEv(ev, p, 'w_alpha_land', p.x, p.y, p.aimX, p.aimY);
  callPack(state, ev, p, p.x, p.y);
}

// ---------------- aura (presentation helper) ----------------

function updateAura(state: SimState, p: PlayerState) {
  const thorns = thornStrength(state, p);
  const bark = (p.vars.w_barkUntil ?? 0) > state.tick ? 1 : 0;
  const feral = has(p, 'w_feral_shift') ? 1 : 0;
  let aura: Hazard | undefined;
  for (const h of state.hazards) if (h.kind === 'w_aura' && h.ownerId === p.slot && h.untilTick > state.tick) { aura = h; break; }
  if (!thorns && !bark && !feral) return;
  if (!aura) {
    aura = makeHazard(state, { kind: 'w_aura', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 0.7, untilTick: state.tick + 3, interval: 99999, damage: ZERO, dtype: 'physical' });
    state.hazards.push(aura);
  }
  aura.x = p.x; aura.y = p.y; aura.dx = p.aimX; aura.dy = p.aimY;
  aura.inner = thorns; aura.outer = bark; aura.length = feral;
  aura.untilTick = state.tick + 3;
}

// ---------------- hooks ----------------

/** Living Sap (melee sustain): fraction of maximum health a connecting Thornspear thrust or Feral maul heals, once per swing. */
export const SAP_HEAL = '0.005';

let inBloom = false;   // Venom Bloom bursts never trigger further bursts (synchronous guard)

const WARDEN: SimHooks = {
  basicAttack(state, ev, p, k) {
    const feral = has(p, 'w_feral_shift');
    const id = feral ? 'w_bear_maul' : 'w_thornspear';
    // spear reach and arc from content (w_thornspear shape); the Feral Shift maul keeps its own wider reach
    const ss = SKILL_BY_ID['w_thornspear'].shape;
    const spearR = ss.kind === 'arc' ? ss.range : 1.8;
    const range = feral ? Math.max(2.3, spearR) : spearR;
    const ch = feral ? COS_MAUL : ss.kind === 'arc' ? cosHalf(ss.arcDeg) : COS_SPEAR;
    castEv(ev, p, id, p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
    const base = hitDamage(state, p, id, 'physical');
    const creeping = has(p, 'w_creeping_venom');
    let first: EnemyState | undefined; let fd = Infinity;
    for (const e of livingEnemies(state)) {
      if (!inCone(p.x, p.y, p.aimX, p.aimY, range, ch, e.x, e.y, e.radius)) continue;
      const d = feral ? base.mul(beastMul(state, p, e)) : base;
      const res = hitEnemy(state, ev, e, d, k, { dtype: 'physical', srcSlot: p.slot, skillId: id, fromX: p.x, fromY: p.y, coverage: areaCoverage(e, range), allowCrit: true });
      if (feral) beastAfterHit(state, p, ev, e, res);
      if (creeping && !res.dealt.isZero()) applyVenom(state, p, e, d, '0.2', 4);
      flinch(state, e, p.x, p.y, feral ? 0.4 : 0.16);
      const dd = d2(e.x, e.y, p.x, p.y);
      if (dd < fd) { fd = dd; first = e; }
    }
    if (has(p, 'w_alpha_wild')) {
      if (first) { p.vars.w_mark = first.id; p.vars.w_markUntil = state.tick + ticks(4); }
      p.vars.w_spear = ((p.vars.w_spear ?? 0) + 1) % 4;
      const m = p.vars.w_spear === 0 && (p.vars.w_markUntil ?? 0) > state.tick ? enemyById(state, p.vars.w_mark) : undefined;
      if (m) for (const w of myBeasts(state, p, 'w_wolf')) startLeap(state, w, m, 1);
    }
    if (!feral) {
      const shard = SKILL_BY_ID['w_thorn_shard'];
      spawnPlayerProjectiles(state, ev, p, shard, k.mul(playerDerived(state, p).projectileCount), hitDamage(state, p, 'w_thorn_shard', 'physical').mul(wd(state, p).thorns), 'w_thorn');
    }
    return true;
  },

  castSkill(state, ev, p, skillId) {
    const aimX = p.aimX, aimY = p.aimY;
    switch (skillId) {
      case 'w_wild_hunt': {
        const len = Math.max(3, Math.min(11, rayDistance(state.map!, p.x, p.y, aimX, aimY, 11)));
        state.hazards.push(makeHazard(state, {
          kind: 'w_stampede', owner: 'player', ownerId: p.slot, x: p.x - aimX * 0.6, y: p.y - aimY * 0.6, dx: aimX, dy: aimY, length: len + 0.6, width: 3.2, speed: 11,
          untilTick: state.tick + Math.ceil((len + 0.6) / 11 / DT) + 12, interval: 99999, damage: ZERO, dtype: 'physical',
        }));
        castEv(ev, p, skillId, p.x, p.y, aimX, aimY);
        return true;
      }
      case 'w_entangle': {
        const [tx, ty] = aimPt(state, p, 7);
        entangleBurst(state, ev, p, tx, ty, skillId);
        castEv(ev, p, skillId, tx, ty, aimX, aimY);
        return true;
      }
      case 'w_verdant_totem': {
        const [tx, ty] = aimPt(state, p, 6);
        entangleBurst(state, ev, p, tx, ty, skillId);
        for (const h of myBeasts(state, p, 'w_totem')) h.untilTick = state.tick;
        state.hazards.push(makeHazard(state, {
          kind: 'w_totem', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: has(p, 'w_forest_heart') ? 6 : 4,
          untilTick: state.tick + ticks(8), interval: ticks(1), nextTick: state.tick + 1, damage: ZERO, dtype: 'physical',
        }));
        castEv(ev, p, skillId, tx, ty, aimX, aimY);
        return true;
      }
      case 'w_worldroot': {
        const len = Math.max(1, Math.min(9, rayDistance(state.map!, p.x, p.y, aimX, aimY, 9)));
        const erupt = Math.ceil(len / 18 / DT);
        state.hazards.push(makeHazard(state, {
          kind: 'w_worldroot', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, dx: aimX, dy: aimY, length: len, width: 1.4 * growth(p), speed: 18,
          untilTick: state.tick + erupt + ticks(4), interval: ticks(0.5), nextTick: state.tick + erupt + ticks(0.5), damage: sdmg(state, p, 'w_root_pulse'), dtype: 'physical',
          vars: { erupt },
        }));
        castEv(ev, p, skillId, p.x, p.y, aimX, aimY);
        return true;
      }
      case 'w_call_pack': {
        const [tx, ty] = aimPt(state, p, 8);
        callPack(state, ev, p, tx, ty);
        castEv(ev, p, skillId, p.x, p.y, aimX, aimY);
        return true;
      }
      case 'w_ursine_call': {
        const [tx, ty] = aimPt(state, p, 6);
        callPack(state, ev, p, tx, ty);
        const R = 2.6;
        const base = sdmg(state, p, skillId, 'w_call_pack');
        for (const e of enemiesNear(state, tx, ty, R)) {
          const res = hitEnemy(state, ev, e, base.mul(beastMul(state, p, e)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId, fromX: tx, fromY: ty, coverage: areaCoverage(e, R), allowCrit: true, stagger: 120 });
          beastAfterHit(state, p, ev, e, res);
          knockback(state, e, tx, ty, 1.5);
        }
        for (const h of myBeasts(state, p, 'w_ursa')) h.untilTick = state.tick;
        state.hazards.push(makeHazard(state, {
          kind: 'w_ursa', owner: 'player', ownerId: p.slot, x: tx, y: ty, dx: aimX, dy: aimY, radius: 0.9, inner: 2,
          untilTick: state.tick + ticks(10 * powr(1.25, rk(p, 'w_long_hunt'))), interval: ticks(1.4), nextTick: state.tick + ticks(0.5), damage: ZERO, dtype: 'physical',
          vars: { i: 9, tgt: 0, bite: state.tick },
        }));
        castEv(ev, p, skillId, tx, ty, aimX, aimY);
        return true;
      }
      case 'w_alpha_pounce': {
        const [tx, ty] = aimPt(state, p, 6, 1.5);
        const dist = Math.sqrt(d2(p.x, p.y, tx, ty));
        const n = ticks(0.3);
        p.vars.w_leapT = n;
        p.vars.w_leapX = (tx - p.x) / n;
        p.vars.w_leapY = (ty - p.y) / n;
        p.iframes = Math.max(p.iframes, 0.3 + DT * 2);
        castEv(ev, p, skillId, p.x, p.y, dist > 1e-3 ? (tx - p.x) / dist : aimX, dist > 1e-3 ? (ty - p.y) / dist : aimY);
        return true;
      }
      case 'w_thornburst': {
        thornNova(state, ev, p, p.x, p.y, 2.8, skillId);
        grantThornArmor(state, p, 4);
        castEv(ev, p, skillId, p.x, p.y, aimX, aimY);
        return true;
      }
      case 'w_bramble_wall': {
        thornNova(state, ev, p, p.x, p.y, 2.8, skillId, 'w_thornburst');
        grantThornArmor(state, p, 4);
        const ahead = Math.max(0.6, Math.min(2.5, rayDistance(state.map!, p.x, p.y, aimX, aimY, 2.5) - 0.3));
        const cx = p.x + aimX * ahead, cy = p.y + aimY * ahead;
        const ux = -aimY, uy = aimX;      // along the wall
        state.hazards.push(makeHazard(state, {
          kind: 'w_bramble', owner: 'player', ownerId: p.slot, x: cx - ux * 3.5, y: cy - uy * 3.5, dx: ux, dy: uy, length: 7, width: 0.9,
          untilTick: state.tick + ticks(6), interval: ticks(0.5), nextTick: state.tick + 1, damage: sdmg(state, p, 'w_bramble_pulse'), dtype: 'physical',
        }));
        castEv(ev, p, skillId, p.x, p.y, aimX, aimY);
        return true;
      }
      case 'w_thorn_pod': {
        const [tx, ty] = aimPt(state, p, 7);
        const det = state.tick + ticks(0.7);
        state.hazards.push(makeHazard(state, {
          kind: 'w_pod', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 3.2, outer: det, untilTick: det + 2, interval: 99999, damage: ZERO, dtype: 'physical', vars: { done: 0 },
        }));
        grantThornArmor(state, p, 4);
        castEv(ev, p, skillId, tx, ty, aimX, aimY);
        return true;
      }
    }
    return undefined;
  },

  onCast(state, ev, p, skillId) {
    if (!GROVE.has(skillId) || !has(p, 'w_barkskin')) return;
    shieldPlayer(state, ev, p, p.maxHp.mul(B('0.14')));
    p.vars.w_barkUntil = state.tick + ticks(5);
    p.vars.w_barkNext = state.tick + ticks(0.5);
    if (has(p, 'w_forest_heart')) {
      for (const a of state.players) {
        if (a === p || a.lifeState !== 'alive' || d2(a.x, a.y, p.x, p.y) > 16) continue;
        shieldPlayer(state, ev, a, a.maxHp.mul(B('0.14')));
      }
    }
  },

  onEnemyHit(state, ev, p, e, info) {
    // Living Sap (melee sustain): a connecting Thornspear thrust (or Feral maul) heals SAP_HEAL of maximum health, once per swing
    if (p && p.classId === 'warden' && info.generation === 0 && (info.skillId === 'w_thornspear' || info.skillId === 'w_bear_maul') && p.vars.w_sapT !== state.tick) {
      p.vars.w_sapT = state.tick;
      healPlayer(state, ev, p, p.maxHp.mul(B(SAP_HEAL)));
    }
    if (!p || info.skillId !== 'w_thorn_shard' || !has(p, 'w_toxic_barbs')) return;
    applyVenom(state, p, e, hitDamage(state, p, 'w_thorn_shard', 'physical').mul(wd(state, p).thorns), '0.25', 4);
  },

  onPlayerDamaged(state, ev, p, info) {
    if (info.hazard || info.srcId === undefined) return;
    const str = thornStrength(state, p);
    if (!str) return;
    const e = enemyById(state, info.srcId);
    if (!e || d2(e.x, e.y, p.x, p.y) > 144) return;
    let d = hitDamage(state, p, 'w_thorn_lash', 'physical').add(info.dealt.mul(B('0.5'))).mul(thornMul(state, p, e));
    if (str === 1) d = d.mul(B('0.5'));
    const heart = has(p, 'w_heart_of_thorns');
    if (heart) d = d.mul(B('2'));
    hitEnemy(state, ev, e, d, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_thorn_lash', fromX: p.x, fromY: p.y, allowCrit: false, generation: 1 });
    castEv(ev, p, 'w_thorn_lash', p.x, p.y, e.x, e.y);
    if (heart && state.tick >= (p.vars.w_novaReady ?? 0)) {
      p.vars.w_novaReady = state.tick + ticks(0.5);
      const base = hitDamage(state, p, 'w_thorn_nova', 'physical');
      for (const t of enemiesNear(state, p.x, p.y, 1.8)) {
        hitEnemy(state, ev, t, base.mul(thornMul(state, p, t)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_thorn_nova', fromX: p.x, fromY: p.y, coverage: areaCoverage(t, 1.8), allowCrit: true, generation: 1 });
      }
      castEv(ev, p, 'w_thorn_nova', p.x, p.y, 0, 0);
    }
  },

  onDodge(state, ev, p) {
    if (has(p, 'w_bramblehide')) grantThornArmor(state, p, 3);
  },

  onPlayerTick(state, ev, p) {
    // Alpha Pounce leap
    const lt = p.vars.w_leapT ?? 0;
    if (lt > 0 && state.map) {
      const r = moveCircle(state.map, p.x, p.y, p.vars.w_leapX ?? 0, p.vars.w_leapY ?? 0, 0.3);
      p.x = r.x; p.y = r.y;
      p.vars.w_leapT = lt - 1;
      if (lt - 1 <= 0) landAlpha(state, ev, p);
    }
    // Barkskin regeneration pulses
    if ((p.vars.w_barkUntil ?? 0) > state.tick && state.tick >= (p.vars.w_barkNext ?? 0)) {
      p.vars.w_barkNext = state.tick + ticks(0.5);
      healPlayer(state, ev, p, p.maxHp.mul(B('0.0075')).mul(wd(state, p).heal));
    }
    updateAura(state, p);
  },

  hazardTick(state, ev, h) {
    if (!h.kind.startsWith('w_')) return undefined;
    const p = state.players[h.ownerId];
    if (!p) { h.untilTick = state.tick; return true; }
    const beast = h.kind === 'w_wolf' || h.kind === 'w_ursa' || h.kind === 'w_aura';
    if (beast && p.lifeState === 'dead') { h.untilTick = state.tick; return true; }
    switch (h.kind) {
      case 'w_wolf': stepWolf(state, ev, h, p); break;
      case 'w_ursa': stepUrsa(state, ev, h, p); break;
      case 'w_stampede': stepStampede(state, ev, h, p); break;
      case 'w_roots':
        if (state.tick >= h.nextTick) { h.nextTick = state.tick + h.interval; pulsePatch(state, ev, h, p); }
        break;
      case 'w_worldroot': {
        const age = state.tick - h.bornTick;
        const erupt = h.vars?.erupt ?? 0;
        if (age <= erupt) {
          const front = Math.min(h.length, h.speed * (age + 1) * DT);
          const dmg = sdmg(state, p, 'w_worldroot', 'w_entangle');
          for (const e of livingEnemies(state)) {
            if (h.hitSlots.includes(e.id) || !inHazard(h, e, front)) continue;
            h.hitSlots.push(e.id);
            hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_worldroot', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, h.width / 2), allowCrit: true, stagger: 40 });
            rootEnemy(state, ev, p, e, 2.5);
          }
        } else if (state.tick >= h.nextTick) { h.nextTick = state.tick + h.interval; pulsePatch(state, ev, h, p); }
        break;
      }
      case 'w_totem':
        if (state.tick >= h.nextTick) {
          h.nextTick = state.tick + h.interval;
          const heal = wd(state, p).heal;
          for (const a of state.players) {
            if (a.lifeState !== 'alive' || d2(a.x, a.y, h.x, h.y) > h.radius * h.radius) continue;
            healPlayer(state, ev, a, a.maxHp.mul(B('0.03')).mul(heal));
          }
        }
        break;
      case 'w_bramble':
        if (state.tick >= h.nextTick) {
          h.nextTick = state.tick + h.interval;
          for (const e of livingEnemies(state)) {
            if (!inHazard(h, e)) continue;
            const d = h.damage.mul(thornMul(state, p, e));
            const res = hitEnemy(state, ev, e, d, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_bramble_pulse', fromX: h.x + h.dx * h.length * 0.5, fromY: h.y + h.dy * h.length * 0.5, coverage: areaCoverage(e, h.width / 2), allowCrit: false });
            if (!res.dealt.isZero()) applyVenom(state, p, e, d, '0.25', 4);
            rootEnemy(state, ev, p, e, 0.75, 0, 8);
          }
        }
        break;
      case 'w_pod':
        if (h.vars && !h.vars.done && state.tick >= h.outer) {
          h.vars.done = 1;
          thornNova(state, ev, p, h.x, h.y, h.radius, 'w_thorn_pod', 'w_thornburst');
          podShards(state, p, h.x, h.y);
          castEv(ev, p, 'w_pod_burst', h.x, h.y, 0, 0);
        }
        break;
      // w_root markers and w_aura are driven by onTick / onPlayerTick
    }
    return true;
  },

  extraCharges(p, skillId) {
    return GROVE.has(skillId) && has(p, 'w_worldtree_grasp') ? 1 : 0;
  },

  onRoundStart(state) {
    for (const p of state.players) if (p.classId === 'warden') { p.vars.w_leapT = 0; p.vars.w_markUntil = 0; p.vars.w_spear = 0; }
  },
};

/** Global: roots hold after enemies stepped; Venom spreading and Overgrowth react to any kill (allies' too). */
const WARDEN_GLOBAL: SimHooks = {
  onTick(state, ev) {
    if (!state.players.some((p) => p.classId === 'warden')) return;
    for (const h of state.hazards) {
      if (h.kind !== 'w_root' || !h.vars || h.vars.done) continue;
      const e = enemyById(state, h.vars.e);
      if (!e) { h.vars.done = 1; h.outer = Math.min(h.outer, state.tick); continue; }
      if (state.tick >= h.outer) { h.vars.done = 1; rootEnded(state, ev, h, e); continue; }
      e.x = h.x; e.y = h.y; e.vx = 0; e.vy = 0;
      if (e.state === 'move') e.state = 'idle';
      const p = state.players[h.ownerId];
      if (p && has(p, 'w_grove_wrath') && (e.vulnUntil <= state.tick || Number(e.vulnFactor) <= 1.2)) {
        e.vulnFactor = '1.2';
        e.vulnUntil = Math.max(e.vulnUntil, state.tick + 2);
      }
    }
    for (const p of state.players) {
      if (p.classId !== 'warden') continue;
      if (p.lifeState !== 'alive') p.vars.w_leapT = 0;
      if (state.tick % 60 !== 0 || !has(p, 'w_creeping_venom')) continue;
      // Creeping Venom: every carrier infects the nearest clean enemy within 2.5 units
      const carriers = state.enemies.filter((e) => isLive(e) && hasVenom(state, p, e)).map((e) => ({ e, v: venomOf(state, p, e) }));
      for (const c of carriers) {
        const t = enemiesNear(state, c.e.x, c.e.y, 2.5).find((x) => x !== c.e && !hasVenom(state, p, x));
        if (!t) continue;
        addDot(state, t, p.slot, 'decay', c.v, 4);
        castEv(ev, p, 'w_contagion', c.e.x, c.e.y, t.x, t.y);
      }
    }
  },

  onKill(state, ev, e) {
    for (const p of state.players) {
      if (p.classId !== 'warden') continue;
      if (has(p, 'w_contagion') || has(p, 'w_venom_bloom')) {
        const venom = venomOf(state, p, e);
        if (!venom.isZero()) {
          if (has(p, 'w_contagion')) {
            for (const t of enemiesNear(state, e.x, e.y, 3.5).slice(0, 3)) {
              topUpVenom(state, p, t, venom, 4);
              castEv(ev, p, 'w_contagion', e.x, e.y, t.x, t.y);
            }
          } else if (!inBloom) {
            inBloom = true;
            try {
              const base = hitDamage(state, p, 'w_venom_burst', 'physical');
              for (const t of enemiesNear(state, e.x, e.y, 2)) {
                hitEnemy(state, ev, t, base.mul(thornMul(state, p, t)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'w_venom_burst', fromX: e.x, fromY: e.y, coverage: areaCoverage(t, 2), allowCrit: true, generation: 1 });
              }
              castEv(ev, p, 'w_venom_bloom', e.x, e.y, 0, 0);
            } finally { inBloom = false; }
          }
        }
      }
      if (has(p, 'w_overgrowth')) {
        const m = rootMarker(state, e.id);
        if (m && m.ownerId === p.slot && state.tick <= m.outer && m.generation < 2) {
          spawnPatch(state, p, e.x, e.y, 1.6 * growth(p), 2.5, m.generation + 1);
          castEv(ev, p, 'w_sprout', e.x, e.y, 0, 0);
        }
      }
    }
  },
};

registerClassHooks('warden', WARDEN);
registerGlobalHooks(WARDEN_GLOBAL);
