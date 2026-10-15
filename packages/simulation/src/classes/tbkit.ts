import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID, TICK_SEC, type DamageType } from '@cursebound/content';
import { addStagger, hitEnemy, type CohortResult } from '../combat';
import { hooks, registerGlobalHooks, type PlayerDamagedInfo } from '../hooks';
import { moveCircle, norm, q, rayDistance } from '../geometry';
import { nearestFloor } from '../map';
import { areaCoverage, makeHazard } from '../players';
import { B, ONE, breakdown, hitDamage, playerDerived, toFloatClamped, treeFactor } from '../stats';
import { ACTION, type EnemyState, type Hazard, type PlayerState, type SimEvent, type SimState } from '../types';

// Shared kit machinery for the Templar and Berserker modules (owned by those two kits). Deterministic: state,
// arguments and the combat rng stream only. Module-level values are registries filled at import time plus a
// synchronous re-entrancy guard; nothing here persists between ticks outside SimState.
//
// Hazard conventions for kinds owned by these kits (t_* / b_*):
//   inner = owner slot (or the attached player's slot) so the client can find the actor;
//   speed = attachment: 0 fixed, 1 follows the owner player, 2 follows enemy hitSlots[0], 3 follows player hitSlots[0];
//   outer = kind-specific counter (stacks, ring index, flags).
// Scripted movement (leaps, charges, lunges) lives in p.vars mv_* and is stepped by the owning kit's onPlayerTick.

export const DT = TICK_SEC;
export const ZERO = Big.ZERO;
export const ticks = (sec: number) => Math.max(1, Math.round(sec / TICK_SEC));
export const rank = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
export const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;
export const isLive = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();
export const buffActive = (state: SimState, p: PlayerState, id: string) => p.buffs.some((b) => b.id === id && b.until > state.tick);

export function setBuff(p: PlayerState, id: string, until: number, value = 1) {
  const b = p.buffs.find((x) => x.id === id);
  if (b) { b.until = Math.max(b.until, until); b.value = value; } else p.buffs.push({ id, until, value });
}

export function castEv(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number, count?: string) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy, ...(count ? { count } : {}) });
}

export function enemyById(state: SimState, id: number): EnemyState | undefined {
  for (const e of state.enemies) if (e.id === id && isLive(e)) return e;
  return undefined;
}

/** Living enemies touching the circle, nearest first (ties by id). */
export function enemiesIn(state: SimState, x: number, y: number, r: number): EnemyState[] {
  const out: { e: EnemyState; d: number }[] = [];
  for (const e of state.enemies) {
    if (!isLive(e)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d <= (r + e.radius) ** 2) out.push({ e, d });
  }
  out.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return out.map((o) => o.e);
}

// ---------------- damage ----------------

/** Per-class temporary damage factor (Avatar, Undying, Death Wish...). */
const TEMP_DAMAGE: Record<string, (state: SimState, p: PlayerState) => Big> = {};
export function registerTempDamage(classId: string, fn: (state: SimState, p: PlayerState) => Big) { TEMP_DAMAGE[classId] = fn; }
export function tempDamage(state: SimState, p: PlayerState): Big { return TEMP_DAMAGE[p.classId]?.(state, p) ?? ONE; }

/** Evolved skills inherit the base skill's skill-scoped tree modifiers (damage, radius, cooldown). */
const FAMILY: Record<string, string> = {};
export function registerFamily(map: Record<string, string>) { Object.assign(FAMILY, map); }
export function familyOf(skillId: string): string { return FAMILY[skillId] ?? skillId; }

/** Product of the skill's own and its family base's tree factor for a skill-scoped stat kind. */
export function familyFactor(p: PlayerState, skillId: string, kind: 'damage' | 'radius' | 'cooldown'): Big {
  let f = treeFactor(p, `skill.${skillId}.${kind}`).factor;
  const base = FAMILY[skillId];
  if (base && base !== skillId) f = f.mul(treeFactor(p, `skill.${base}.${kind}`).factor);
  return f;
}

export function radiusOf(p: PlayerState, skillId: string, base: number): number {
  return base * toFloatClamped(familyFactor(p, skillId, 'radius'), 1e3);
}

/** Hit damage of a kit skill: its coefficient x its family's damage modifiers x temporary kit factors. */
export function skillDmg(state: SimState, p: PlayerState, skillId: string, dtype?: DamageType): Big {
  const s = SKILL_BY_ID[skillId];
  const t = dtype ?? s.damageType;
  let d = hitDamage(state, p, skillId, t);
  const base = FAMILY[skillId];
  if (base && base !== skillId) d = d.mul(treeFactor(p, `skill.${base}.damage`).factor);
  return d.mul(tempDamage(state, p));
}

/** Damage for a kit effect that is not a skill of its own: coef x player damage x type multiplier, optionally scaled by a skill family. */
export function subDmg(state: SimState, p: PlayerState, dtype: DamageType, coef: Big | string, family?: string): Big {
  const pd = playerDerived(state, p);
  let d = pd.damage.mul(pd.typeMult[dtype]).mul(typeof coef === 'string' ? B(coef) : coef);
  if (family) d = d.mul(familyFactor(p, family, 'damage'));
  return d.mul(tempDamage(state, p));
}

export interface KitHit {
  dtype: DamageType; skillId: string; stagger?: number; generation?: number; allowCrit?: boolean;
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
  vuln?: { factor: string; sec: number };
  /** per-target damage multiplier (e.g. bonus against bleeding enemies) */
  scale?: (e: EnemyState) => Big | null;
}

/** Per-class damage multiplier against a specific target (e.g. Hemorrhage vs bleeding enemies), applied by hitOne/hitCircle. */
const TARGET_SCALE: Record<string, (state: SimState, p: PlayerState, e: EnemyState) => Big | null> = {};
export function registerTargetScale(classId: string, fn: (state: SimState, p: PlayerState, e: EnemyState) => Big | null) { TARGET_SCALE[classId] = fn; }
export function targetScale(state: SimState, p: PlayerState, e: EnemyState): Big | null { return TARGET_SCALE[p.classId]?.(state, p, e) ?? null; }

export function hitOne(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, dmg: Big, o: KitHit, fromX: number, fromY: number, coverageR?: number): CohortResult {
  const s = o.scale?.(e);
  const t = targetScale(state, p, e);
  let d = s ? dmg.mul(s) : dmg;
  if (t) d = d.mul(t);
  return hitEnemy(state, ev, e, d, ONE, {
    dtype: o.dtype, srcSlot: p.slot, skillId: o.skillId, fromX, fromY, coverage: coverageR !== undefined ? areaCoverage(e, coverageR) : undefined,
    allowCrit: o.allowCrit ?? true, stagger: o.stagger, generation: o.generation, dot: o.dot, vuln: o.vuln,
  });
}

/** Area hit on every enemy touching the circle. Returns the enemies hit. */
export function hitCircle(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, r: number, dmg: Big, o: KitHit, filter?: (e: EnemyState) => boolean): EnemyState[] {
  const out: EnemyState[] = [];
  for (const e of enemiesIn(state, x, y, r)) {
    if (filter && !filter(e)) continue;
    hitOne(state, ev, p, e, dmg, o, x, y, r);
    out.push(e);
  }
  return out;
}

// ---------------- crowd control ----------------

/** Stun an enemy (AI frozen). Bosses take stagger instead. */
export function stun(state: SimState, ev: SimEvent[], e: EnemyState, sec: number, bossStagger: number) {
  if (!isLive(e)) return;
  if (e.boss) { if (bossStagger > 0) addStagger(state, ev, e, bossStagger); return; }
  const s = e.ccResistUntil > state.tick ? sec * 0.5 : sec;
  const until = state.tick + ticks(s);
  if (until > e.staggerUntil) e.staggerUntil = until;
  e.attack = null; e.state = 'stagger'; e.vx = 0; e.vy = 0;
}

/** Pull toward a point (never overshooting). Bosses are immovable. */
export function pull(state: SimState, e: EnemyState, x: number, y: number, dist: number) {
  if (dist <= 0 || e.boss || !isLive(e) || !state.map) return;
  const dx = x - e.x, dy = y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.35) return;
  const m = Math.min(dist, d - 0.3);
  const r = moveCircle(state.map, e.x, e.y, (dx / d) * m, (dy / d) * m, Math.min(e.radius, 0.6));
  e.x = r.x; e.y = r.y;
}

/** Knockback with control resistance (same rule as the core); returns true when the enemy was slammed into a wall. */
export function shove(state: SimState, e: EnemyState, dirX: number, dirY: number, dist: number): boolean {
  if (dist <= 0 || e.boss || !isLive(e) || !state.map) return false;
  let [nx, ny] = norm(dirX, dirY);
  if (nx === 0 && ny === 0) { nx = 1; ny = 0; }
  const d = e.ccResistUntil > state.tick ? dist * 0.3 : dist;
  const r = moveCircle(state.map, e.x, e.y, nx * d, ny * d, Math.min(e.radius, 0.6));
  e.x = r.x; e.y = r.y;
  e.ccResistUntil = state.tick + ticks(RULES.crowdControlResistSec);
  if (e.attack && e.attack.stage === 'windup') { e.attack = null; e.state = 'recovery'; e.cooldowns['_recover'] = 0.4; }
  return r.hitWall;
}

/** Vulnerability that never weakens a stronger active one. */
export function vuln(state: SimState, e: EnemyState, factor: string, sec: number) {
  if (!isLive(e)) return;
  if (e.vulnUntil > state.tick && Number(e.vulnFactor) > Number(factor)) return;
  e.vulnFactor = factor;
  e.vulnUntil = Math.max(e.vulnUntil, state.tick + ticks(sec));
}

// ---------------- kit hazards ----------------

export type HazardInit = Partial<Hazard> & Pick<Hazard, 'kind' | 'x' | 'y' | 'untilTick'>;

export function addHazard(state: SimState, p: PlayerState, h: HazardInit): Hazard {
  const hz = makeHazard(state, { owner: 'player', ownerId: p.slot, damage: ZERO, dtype: 'physical', inner: p.slot, interval: 99999, ...h });
  state.hazards.push(hz);
  return hz;
}

export function findHazard(state: SimState, kind: string, slot: number, target?: number): Hazard | undefined {
  for (const h of state.hazards) {
    if (h.kind !== kind || h.owner !== 'player' || h.ownerId !== slot || h.untilTick <= state.tick) continue;
    if (target !== undefined && h.hitSlots[0] !== target) continue;
    return h;
  }
  return undefined;
}

export function endHazard(state: SimState, h: Hazard) { h.untilTick = Math.min(h.untilTick, state.tick); h.interval = 99999; }

/** Keep an attached hazard on its target. Returns false (and ends it) when the target is gone. */
export function followAttachment(state: SimState, h: Hazard): boolean {
  if (h.speed === 1) {
    const p = state.players[h.ownerId];
    if (!p || p.lifeState === 'dead') { endHazard(state, h); return false; }
    h.x = p.x; h.y = p.y;
  } else if (h.speed === 2) {
    const e = enemyById(state, h.hitSlots[0]);
    if (!e) { endHazard(state, h); return false; }
    h.x = e.x; h.y = e.y;
  } else if (h.speed === 3) {
    const a = state.players[h.hitSlots[0]];
    if (!a || a.lifeState !== 'alive') { endHazard(state, h); return false; }
    h.x = a.x; h.y = a.y;
  }
  return true;
}

// ---------------- scripted movement ----------------

export const MV_LEAP = 1, MV_DASH = 2;

export function moving(state: SimState, p: PlayerState): boolean {
  return (p.vars.mv_mode ?? 0) > 0 && (p.vars.mv_last ?? -9) >= state.tick - 1;
}

/** Aimed landing point, clamped to [minR, maxR] and stopped short of walls. Always floor. */
export function landingPoint(state: SimState, p: PlayerState, maxR: number, minR: number, dirX = p.aimX, dirY = p.aimY, want?: number): [number, number] {
  const w = want ?? Math.min(maxR, Math.max(minR, p.aimDist || maxR));
  const free = state.map ? rayDistance(state.map, p.x, p.y, dirX, dirY, w) : w;
  const d = Math.max(0, free - RULES.playerRadius - 0.05);
  const x = p.x + dirX * d, y = p.y + dirY * d;
  if (!state.map) return [q(x), q(y)];
  const [fx, fy] = nearestFloor(state.map, Math.min(state.map.w - 0.5, Math.max(0.5, x)), Math.min(state.map.h - 0.5, Math.max(0.5, y)));
  return [q(fx), q(fy)];
}

/** Aimed point for effects from above (no wall clipping), clamped into the map and moved onto floor. */
export function skyPoint(state: SimState, p: PlayerState, maxR: number, minR = 0.5): [number, number] {
  const w = Math.min(maxR, Math.max(minR, p.aimDist || maxR));
  const x = p.x + p.aimX * w, y = p.y + p.aimY * w;
  if (!state.map) return [q(x), q(y)];
  const [fx, fy] = nearestFloor(state.map, Math.min(state.map.w - 0.5, Math.max(0.5, x)), Math.min(state.map.h - 0.5, Math.max(0.5, y)));
  return [q(fx), q(fy)];
}

/** Leap along a wall-free straight line to (tx, ty) over airSec; untargetable while airborne. */
export function startLeap(state: SimState, p: PlayerState, tx: number, ty: number, airSec: number, tag: number) {
  const v = p.vars;
  v.mv_mode = MV_LEAP; v.mv_tag = tag; v.mv_t = 0; v.mv_n = ticks(airSec); v.mv_last = state.tick;
  v.mv_x0 = p.x; v.mv_y0 = p.y; v.mv_x1 = tx; v.mv_y1 = ty;
  p.iframes = Math.max(p.iframes, airSec + DT * 2);
  p.castAnim = Math.max(p.castAnim, airSec);
}

/** Dash `dist` units along (dx, dy) at `speed` (collision-safe, stops at walls). */
export function startDash(state: SimState, p: PlayerState, dx: number, dy: number, dist: number, speed: number, tag: number) {
  const v = p.vars;
  const [nx, ny] = norm(dx, dy);
  v.mv_mode = MV_DASH; v.mv_tag = tag; v.mv_t = 0; v.mv_last = state.tick;
  v.mv_dx = nx || 1; v.mv_dy = ny; v.mv_spd = speed; v.mv_left = dist; v.mv_cx = p.x; v.mv_cy = p.y; v.mv_x0 = p.x; v.mv_y0 = p.y;
  p.castAnim = Math.max(p.castAnim, dist / speed);
}

export function cancelMove(p: PlayerState) { p.vars.mv_mode = 0; }

/** Advance scripted movement one tick. Returns 'land' / 'end' on the tick it completes, 'moving', or null. */
export function stepMove(state: SimState, p: PlayerState): 'land' | 'end' | 'moving' | null {
  const v = p.vars;
  if (!v.mv_mode) return null;
  if ((v.mv_last ?? -9) < state.tick - 1) { v.mv_mode = 0; return null; }   // stale (downed / round ended mid-move)
  v.mv_last = state.tick;
  if (v.mv_mode === MV_LEAP) {
    v.mv_t++;
    const t = Math.min(1, v.mv_t / v.mv_n);
    p.x = q(v.mv_x0 + (v.mv_x1 - v.mv_x0) * t);
    p.y = q(v.mv_y0 + (v.mv_y1 - v.mv_y0) * t);
    p.vx = 0; p.vy = 0;
    if (t >= 1) { v.mv_mode = 0; return 'land'; }
    return 'moving';
  }
  if (!state.map) { v.mv_mode = 0; return 'end'; }
  v.mv_t++;
  const step = Math.min(v.mv_left, v.mv_spd * DT);
  const r = moveCircle(state.map, v.mv_cx, v.mv_cy, v.mv_dx * step, v.mv_dy * step, RULES.playerRadius);
  const moved = Math.hypot(r.x - v.mv_cx, r.y - v.mv_cy);
  v.mv_cx = r.x; v.mv_cy = r.y; p.x = r.x; p.y = r.y;
  v.mv_left -= step;
  p.vx = v.mv_dx * v.mv_spd; p.vy = v.mv_dy * v.mv_spd;
  if (v.mv_left <= 1e-6 || (r.hitWall && moved < step * 0.5)) { v.mv_mode = 0; p.vx = 0; p.vy = 0; return 'end'; }
  return 'moving';
}

// ---------------- cooldowns & misc ----------------

export function slotOf(p: PlayerState, skillId: string): number {
  return p.skills.findIndex((s) => s.skillId === skillId);
}

/** Button bit of a hotbar slot index. */
export function slotBit(p: PlayerState, i: number): number {
  if (i < 0) return 0;
  return i === p.skills.length - 1 ? ACTION.SIGNATURE : [ACTION.SKILL1, ACTION.SKILL2, ACTION.SKILL3][i] ?? 0;
}

/** Shorten the remaining cooldown of the skill in hotbar slot i. */
export function refundCooldown(p: PlayerState, i: number, sec: number) {
  const s = p.skills[i];
  if (!s || !s.skillId || s.charges >= s.maxCharges || sec <= 0) return;
  s.cooldown -= sec;
}

/** Tree x mastery x Fate factor of a stat, ignoring its base value (cached per state version). */
const factorCache = new WeakMap<PlayerState, { v: number; m: Map<string, number> }>();
export function statFactor(state: SimState, p: PlayerState, stat: string): number {
  let c = factorCache.get(p);
  if (!c || c.v !== state.stateVersion) { c = { v: state.stateVersion, m: new Map() }; factorCache.set(p, c); }
  let f = c.m.get(stat);
  if (f === undefined) {
    const b = breakdown(state, p, stat);
    f = toFloatClamped(b.tree.mul(b.mastery).mul(b.fate), 1e6);
    c.m.set(stat, f);
  }
  return f;
}

export function statBig(state: SimState, p: PlayerState, stat: string): Big {
  const b = breakdown(state, p, stat);
  return b.tree.mul(b.mastery).mul(b.fate);
}

// ---------------- combined global hooks ----------------

/** Multiplicative damage-taken factor contributions (1 = none). Evaluated for every damaged player. */
type TakenFn = (state: SimState, p: PlayerState, info: PlayerDamagedInfo) => number;
/** Lethal-hit guards: return the health fraction of max health to keep (prevented) or null. */
type LethalFn = (state: SimState, ev: SimEvent[], p: PlayerState, info: PlayerDamagedInfo) => { keep: Big } | null;
/** After the damage was adjusted (transfers, retaliation). */
type AfterFn = (state: SimState, ev: SimEvent[], p: PlayerState, info: PlayerDamagedInfo, factor: number) => void;
type AtkFn = (state: SimState, p: PlayerState) => number;
type PTickFn = (state: SimState, ev: SimEvent[], p: PlayerState) => void;
type TickFn = (state: SimState, ev: SimEvent[]) => void;

const TAKEN: TakenFn[] = [];
const LETHAL: { fn: LethalFn; prio: number }[] = [];
const AFTER: AfterFn[] = [];
const ATK: AtkFn[] = [];
const PTICK: PTickFn[] = [];
const GTICK: TickFn[] = [];
let guard = 0;

export const kitGlobal = {
  taken(fn: TakenFn) { TAKEN.push(fn); },
  /** Lower priority runs first (a player's own guards before allies' interventions). */
  lethal(fn: LethalFn, prio = 0) { LETHAL.push({ fn, prio }); LETHAL.sort((a, b) => a.prio - b.prio); },
  after(fn: AfterFn) { AFTER.push(fn); },
  attackSpeed(fn: AtkFn) { ATK.push(fn); },
  playerTick(fn: PTickFn) { PTICK.push(fn); },
  tick(fn: TickFn) { GTICK.push(fn); },
  /** Run `fn` with kit damage hooks suspended (damage transfers must not recurse). */
  quiet<T>(fn: () => T): T { guard++; try { return fn(); } finally { guard--; } },
};

const relevant = (state: SimState) => state.players.some((p) => p.classId === 'templar' || p.classId === 'berserker');

registerGlobalHooks({
  onPlayerDamaged(state, ev, p, info) {
    if (guard > 0 || info.dealt.isZero() || !relevant(state)) return;
    let f = 1;
    for (const fn of TAKEN) f *= fn(state, p, info);
    // hitPlayer subtracts `dealt` right after this hook: a refund (f < 1) or a surcharge (f > 1) on current health
    // makes the net loss exactly dealt x f.
    if (f < 1) p.hp = p.hp.add(info.dealt.mul(Big.from(Math.round((1 - f) * 1e6) / 1e6)));
    else if (f > 1) p.hp = p.hp.sub(info.dealt.mul(Big.from(Math.round((f - 1) * 1e6) / 1e6)));
    if (info.dealt.gte(p.hp)) {
      for (const { fn } of LETHAL) {
        const r = fn(state, ev, p, info);
        if (!r) continue;
        const keep = r.keep.isZero() ? ONE : r.keep;
        const total = info.dealt.add(keep);
        if (total.gt(info.dealt)) p.hp = total;
        else { p.hp = info.dealt.mul(B(2)); p.vars.tb_fixTick = state.tick; p.vars.tb_fixFrac = Math.min(1, keep.ratio(p.maxHp)); }
        break;
      }
    }
    for (const fn of AFTER) fn(state, ev, p, info, f);
  },
  onPlayerTick(state, ev, p) {
    if (!relevant(state)) return;
    // precision fix for lethal saves absorbed by a huge hit (see onPlayerDamaged)
    if (p.vars.tb_fixTick !== undefined) {
      if (p.vars.tb_fixTick < state.tick) { p.hp = Big.max(ONE, p.maxHp.mul(Big.from(Math.max(1e-9, p.vars.tb_fixFrac ?? 0)))); delete p.vars.tb_fixTick; delete p.vars.tb_fixFrac; }
    }
    let m = 1;
    for (const fn of ATK) m *= fn(state, p);
    if (m > 1 && (p.prevButtons & ACTION.ATTACK) && p.dodgeTimer <= 0 && p.guardTimer <= 0) {
      const extra = toFloatClamped(playerDerived(state, p).attackFreq, 1e6) * DT * (m - 1);
      p.attackWork = Math.min(1e6, p.attackWork + extra);
    }
    for (const fn of PTICK) fn(state, ev, p);
  },
  onTick(state, ev) {
    if (!relevant(state)) return;
    for (const fn of GTICK) fn(state, ev);
  },
});
