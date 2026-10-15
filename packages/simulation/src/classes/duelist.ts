import { Big } from '@cursebound/numeric';
import { BOSS_BY_ID, CLASS_BY_ID, DODGE, ENEMY_BY_ID, RULES, SKILL_BY_ID, TICK_SEC, type EnemyAttackDef } from '@cursebound/content';
import { addDot, addStagger, cohortHpFrac, healPlayer, hitEnemy, mitigationFactor, shieldPlayer, type CohortResult } from '../combat';
import { inCone, inLine, moveCircle, norm, q, rayDistance } from '../geometry';
import { registerClassHooks } from '../hooks';
import { nearestFloor } from '../map';
import { areaCoverage, cosHalf, cutCooldowns, flinch, knockback, livingEnemies, makeHazard } from '../players';
import { B, ONE, breakdown, hitDamage, playerDerived, toFloatClamped, treeFactor } from '../stats';
import { ACTION, type EnemyState, type Hazard, type PlayerState, type Projectile, type SimEvent, type SimState } from '../types';

// Duelist kit (content: packages/content/src/classes/duelist.ts). Deterministic: only state, the combat rng
// stream (unused here) and inputs. Per-player counters live in p.vars (plain numbers, serialized with the state):
//   combo/comboT        Combo meter and the tick it last grew (ui_combo / ui_comboMax mirror it for the HUD)
//   fangChain/fangLast  connecting basic swings in the current chain (Fang Finisher cadence)
//   parry*              Riposte-family stance; fangs* Hundred Fangs flurry; whirl* Crimson Whirl spins
//   rush*/tc*           Phantom Rush / Thousand Cuts blink sequences (rv0.. / tv0.. hold visited enemy ids)
//   ambushUntil, critT, danceT, coupT, pend*  timers and deferred refunds
// Cosmetic cast events (skill ids starting with d_fx_ / d_clone_slash / d_fang_finisher) only drive client fx.
// Blink events carry the departure in x,y and the arrival in dx,dy.

const DT = TICK_SEC;
const ZERO = Big.ZERO;
const T = (sec: number) => Math.round(sec / DT);
const rank = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;

/** Branch skill families: evolutions inherit the base skill's tree damage modifiers and slot rules. */
const FAMILY: Record<string, 'd_rend' | 'd_shadowstep' | 'd_riposte'> = {
  d_rend: 'd_rend', d_crimson_whirl: 'd_rend', d_execution: 'd_rend',
  d_shadowstep: 'd_shadowstep', d_phantom_rush: 'd_shadowstep', d_death_mark: 'd_shadowstep',
  d_riposte: 'd_riposte', d_mirror_guard: 'd_riposte', d_hundred_fangs: 'd_riposte',
};
const SLOT = { d_rend: 0, d_shadowstep: 1, d_riposte: 2 } as const;
/** Momentum: seconds cut from recharging skills by a connecting swing / critical swing / parry / Execution kill. */
const MOMENTUM = { swing: 0.06, crit: 0.12, parry: 1, execution: 1 } as const;
const MELEE_KINDS = new Set(['melee', 'charge', 'sweep', 'slam']);

// ---------------- small helpers ----------------

function fx(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy });
}

/** Damage of a family skill: its own coefficient x the base skill's tree damage factor (for evolutions). */
function famHit(state: SimState, p: PlayerState, skillId: string): Big {
  const base = FAMILY[skillId];
  let d = hitDamage(state, p, skillId, 'physical');
  if (base && base !== skillId) d = d.mul(treeFactor(p, `skill.${base}.damage`).factor);
  return d;
}

/** coef x player damage (physical), for kit effects that are not a skill of their own. */
function baseHit(state: SimState, p: PlayerState, coef: string): Big {
  const pd = playerDerived(state, p);
  return pd.damage.mul(pd.typeMult.physical).mul(B(coef));
}

const bleedCache = new WeakMap<PlayerState, { v: number; f: Big }>();
function bleedF(state: SimState, p: PlayerState): Big {
  const c = bleedCache.get(p);
  if (c && c.v === state.stateVersion) return c.f;
  const f = breakdown(state, p, 'player.bleedDamage').result;
  bleedCache.set(p, { v: state.stateVersion, f });
  return f;
}

const alive = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();
const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

function comboMax(p: PlayerState) { return has(p, 'd_endless_waltz') ? 40 : 20; }
function combo(p: PlayerState) { return p.vars.combo ?? 0; }
function setCombo(p: PlayerState, c: number) { p.vars.combo = c; p.vars.ui_combo = c; }
function addCombo(state: SimState, p: PlayerState, n: number) {
  setCombo(p, Math.min(comboMax(p), combo(p) + n));
  p.vars.comboT = state.tick;
}
/** Momentum (no resource): cut `sec` from every recharging skill except hotbar slot `except`. */
function gainMomentum(p: PlayerState, sec: number, except = -1) {
  cutCooldowns(p, sec, except);
}

function bleeding(state: SimState, e: EnemyState, slot: number) {
  return e.dots.some((d) => d.src === slot && d.type === 'physical' && d.until > state.tick);
}

function attackDef(e: EnemyState, id: string): EnemyAttackDef | undefined {
  const list = e.boss ? BOSS_BY_ID[e.kind]?.attacks : ENEMY_BY_ID[e.kind]?.attacks;
  return list?.find((a) => a.id === id);
}

/** Cancel a non-boss enemy's windup (no control resistance: an interrupt, not a stun). */
function interrupt(state: SimState, e: EnemyState) {
  if (e.boss || !e.attack || e.attack.stage !== 'windup') return;
  e.attack = null; e.state = 'recovery'; e.cooldowns['_recover'] = 0.4;
  state.telegraphs = state.telegraphs.filter((t) => t.ownerId !== e.id);
}

/** Stun a non-boss enemy for `sec` (control resistance applies); bosses take stagger instead. */
function stun(state: SimState, ev: SimEvent[], e: EnemyState, sec: number, bossStagger: number) {
  if (!alive(e)) return;
  if (e.boss) { addStagger(state, ev, e, bossStagger); return; }
  const s = e.ccResistUntil > state.tick ? sec * 0.3 : sec;
  e.staggerUntil = Math.max(e.staggerUntil, state.tick + T(s));
  if (e.attack) state.telegraphs = state.telegraphs.filter((t) => t.ownerId !== e.id);
  e.attack = null; e.state = 'stagger';
  e.ccResistUntil = state.tick + T(RULES.crowdControlResistSec);
}

function aimPoint(p: PlayerState, maxD: number): [number, number] {
  const d = Math.min(Math.max(p.aimDist || 3, 1), maxD);
  return [p.x + p.aimX * d, p.y + p.aimY * d];
}

/** Living enemy nearest the aim point among those within `range` of the player. */
function targetNearAim(state: SimState, p: PlayerState, range: number): EnemyState | null {
  const [ax, ay] = aimPoint(p, range);
  let best: EnemyState | null = null; let bd = Infinity;
  for (const e of livingEnemies(state)) {
    if (d2(e.x, e.y, p.x, p.y) > (range + e.radius) ** 2) continue;
    const d = d2(e.x, e.y, ax, ay);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function nearestFrom(state: SimState, x: number, y: number, range: number, skip?: (e: EnemyState) => boolean): EnemyState | null {
  let best: EnemyState | null = null; let bd = Infinity;
  for (const e of livingEnemies(state)) {
    if (skip?.(e)) continue;
    const d = d2(e.x, e.y, x, y);
    if (d > (range + e.radius) ** 2) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Point just behind `e` as seen from the player. */
function behind(p: PlayerState, e: EnemyState, extra: number): [number, number] {
  let [nx, ny] = norm(e.x - p.x, e.y - p.y);
  if (nx === 0 && ny === 0) { nx = p.aimX; ny = p.aimY; }
  return [e.x + nx * (e.radius + extra), e.y + ny * (e.radius + extra)];
}

/** Instant reposition toward (tx,ty), stopping before walls; emits a styled teleport (client snaps prediction). Returns the departure point. */
function blink(state: SimState, ev: SimEvent[], p: PlayerState, tx: number, ty: number): { ox: number; oy: number } {
  const ox = p.x, oy = p.y;
  const map = state.map;
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (map && d > 1e-6) {
    const free = rayDistance(map, p.x, p.y, dx, dy, d);
    const go = free >= d - 1e-6 ? d : Math.max(0, free - RULES.playerRadius - 0.05);
    const [nx, ny] = nearestFloor(map, p.x + (dx / d) * go, p.y + (dy / d) * go);
    const r = moveCircle(map, nx, ny, 1e-3, 0, RULES.playerRadius);   // settle out of any wall overlap
    p.x = q(r.x); p.y = q(r.y);
    if (Math.abs(p.x - ox) + Math.abs(p.y - oy) > 1e-3) ev.push({ t: 'teleport', slot: p.slot, fx: ox, fy: oy, x: p.x, y: p.y, style: 'shadow' });
  }
  return { ox, oy };
}

function skillSlot(p: PlayerState, family: keyof typeof SLOT) {
  const s = p.skills[SLOT[family]];
  return s && s.skillId && FAMILY[s.skillId] === family ? s : null;
}

function refundCharge(p: PlayerState, family: keyof typeof SLOT, all: boolean) {
  const s = skillSlot(p, family);
  if (!s || s.charges >= s.maxCharges) return;
  s.charges = all ? s.maxCharges : s.charges + 1;
  if (s.charges >= s.maxCharges) s.cooldown = 0;
}

// ---------------- the Duelist hit ----------------

interface StrikeOpts {
  skillId: string;
  fromX: number; fromY: number;
  area?: number;        // area radius for cohort coverage (undefined = single target)
  k?: Big;              // grouped hit count (basic attack packets)
  stagger?: number; flinch?: number; kb?: number;
  bleed?: string; bleedSec?: number;
  mult?: Big;
  gen?: number;
  noExec?: boolean;
}

/** Every Duelist hit: backstab, execute, Thousand Wounds, Crescendo and Perfect Form multipliers, then bleeds. */
function strike(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, perHit: Big, o: StrikeOpts): CohortResult {
  if (!alive(e)) return { kills: ZERO, dealt: ZERO };
  let m = o.mult ?? ONE;
  const vx = o.fromX - e.x, vy = o.fromY - e.y;
  const l = Math.hypot(vx, vy);
  if (l > 1e-6 && (vx * e.fx + vy * e.fy) / l < -0.3) m = m.mul(B('1.25'));          // backstab
  const coup = has(p, 'd_coup_de_grace');
  if (coup || has(p, 'd_executioner')) {
    if (cohortHpFrac(e.cohort) < (coup ? 0.45 : 0.3)) m = m.mul(B(e.boss ? (coup ? '1.4' : '1.25') : (coup ? '2' : '1.5')));
  }
  const wounds = has(p, 'd_thousand_wounds');
  if (wounds && bleeding(state, e, p.slot)) m = m.mul(B('1.15'));
  const cr = rank(p, 'd_crescendo');
  const c = combo(p);
  if (cr > 0 && c > 0) m = m.mul(B('1.007').powInt(c * cr));
  if (p.buffs.some((b) => b.id === 'd_perfect_form')) m = m.mul(B('1.35'));
  const dmg = perHit.mul(m);
  const k = o.k ?? ONE;
  const res = hitEnemy(state, ev, e, dmg, k, {
    dtype: 'physical', srcSlot: p.slot, skillId: o.skillId, fromX: o.fromX, fromY: o.fromY,
    coverage: o.area !== undefined ? areaCoverage(e, o.area) : undefined, allowCrit: true, stagger: o.stagger, generation: o.gen,
  });
  if (!res.dealt.isZero() && alive(e)) {
    const per = o.area !== undefined ? dmg : dmg.mul(k);
    if (o.bleed) addDot(state, e, p.slot, 'physical', per.mul(B(o.bleed)).mul(bleedF(state, p)), o.bleedSec ?? 4);
    if (wounds) addDot(state, e, p.slot, 'physical', per.mul(B('0.15')).mul(bleedF(state, p)), 3);
    if (coup && !e.boss && !o.noExec && cohortHpFrac(e.cohort) <= 0.12) execute(state, ev, p, e);
  }
  if (alive(e)) {
    if (o.kb) knockback(state, e, o.fromX, o.fromY, o.kb);
    else if (o.flinch) flinch(state, e, o.fromX, o.fromY, o.flinch);
  }
  return res;
}

/** Coup de Grâce: slay the front unit outright (the hit covers its remaining health through any mitigation). */
function execute(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState) {
  const c = e.cohort;
  const need = c.unitHp.sub(c.spread).sub(c.front);
  if (need.isZero()) return;
  hitEnemy(state, ev, e, need.mul(B(4)).div(mitigationFactor(e.armor)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'd_coup_de_grace', fromX: p.x, fromY: p.y, allowCrit: false, generation: 1 });
  fx(ev, p, 'd_fx_execute', e.x, e.y, 0, 0);
}

/** Exsanguinate: consume this player's bleeds on `e` for 120% of their remaining damage at once. */
function exsanguinate(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState) {
  let total = ZERO;
  const keep: EnemyState['dots'] = [];
  for (const d of e.dots) {
    if (d.src === p.slot && d.type === 'physical' && d.until > state.tick) total = total.add(d.perSec.mul(Big.from(d.until - state.tick)).div(B(60)));
    else keep.push(d);
  }
  if (total.isZero()) return;
  e.dots = keep;
  e.burning = keep.some((d) => d.type === 'ember');
  hitEnemy(state, ev, e, total.mul(B('1.2')), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'd_exsanguinate', fromX: p.x, fromY: p.y, allowCrit: false, generation: 1 });
  fx(ev, p, 'd_fx_exsang', e.x, e.y, 0, 0);
}

// ---------------- clones, smoke, marks ----------------

function myHazards(state: SimState, p: PlayerState, kind: string): Hazard[] {
  return state.hazards.filter((h) => h.kind === kind && h.owner === 'player' && h.ownerId === p.slot && h.untilTick > state.tick);
}

function spawnClone(state: SimState, p: PlayerState, x: number, y: number) {
  const clones = myHazards(state, p, 'd_clone').sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
  // replace the oldest beyond 3: it expires this tick (and detonates with Legion of Shades)
  for (let i = 0; i <= clones.length - 3; i++) clones[i].untilTick = Math.min(clones[i].untilTick, state.tick + 1);
  state.hazards.push(makeHazard(state, {
    kind: 'd_clone', owner: 'player', ownerId: p.slot, x: q(x), y: q(y), dx: p.aimX, dy: p.aimY, radius: 0.4,
    untilTick: state.tick + T(3), interval: 99999, nextTick: state.tick + 99999, damage: ZERO, dtype: 'physical',
  }));
}

/** Shared bookkeeping for every Shadow-family blink. */
function onDepart(state: SimState, p: PlayerState, ox: number, oy: number, signature = false) {
  if (has(p, 'd_legion_of_shades') || (!signature && has(p, 'd_shadow_clone'))) spawnClone(state, p, ox, oy);
}
function onArrive(state: SimState, p: PlayerState) {
  if (has(p, 'd_smoke_veil')) {
    state.hazards.push(makeHazard(state, {
      kind: 'd_smoke', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 2,
      untilTick: state.tick + T(2), interval: T(0.5), nextTick: state.tick, damage: ZERO, dtype: 'physical',
    }));
  }
  if (has(p, 'd_ambush')) p.vars.ambushUntil = state.tick + T(2);
}

function reaperCost(p: PlayerState) {
  if (has(p, 'd_reapers_path')) p.hp = p.hp.sub(p.hp.mul(B('0.05')));
}
const reaperMult = (p: PlayerState) => (has(p, 'd_reapers_path') ? B('1.5') : ONE);

// ---------------- Edge ----------------

function rend(state: SimState, ev: SimEvent[], p: PlayerState) {
  const dmg = famHit(state, p, 'd_rend');
  const ch = cosHalf(100);
  let hits = 0;
  for (const e of livingEnemies(state)) {
    if (!inCone(p.x, p.y, p.aimX, p.aimY, 2.2, ch, e.x, e.y, e.radius)) continue;
    if (has(p, 'd_exsanguinate')) exsanguinate(state, ev, p, e);
    strike(state, ev, p, e, dmg, { skillId: 'd_rend', fromX: p.x, fromY: p.y, area: 2.2, bleed: '0.3', bleedSec: 4, stagger: 30, flinch: 0.3 });
    hits++;
  }
  if (hits) addCombo(state, p, 2);
  fx(ev, p, 'd_rend', p.x, p.y, p.aimX, p.aimY);
}

function whirlSpin(state: SimState, ev: SimEvent[], p: PlayerState, first: boolean) {
  const dmg = famHit(state, p, 'd_crimson_whirl');
  let hits = 0;
  for (const e of livingEnemies(state)) {
    if (d2(e.x, e.y, p.x, p.y) > (2.4 + e.radius) ** 2) continue;
    if (first && has(p, 'd_exsanguinate')) exsanguinate(state, ev, p, e);
    strike(state, ev, p, e, dmg, { skillId: 'd_crimson_whirl', fromX: p.x, fromY: p.y, area: 2.4, bleed: '0.3', bleedSec: 4, stagger: 15, flinch: 0.25 });
    hits++;
  }
  if (hits) addCombo(state, p, 1);
  fx(ev, p, 'd_fx_whirl', p.x, p.y, p.aimX, p.aimY);
}

function execution(state: SimState, ev: SimEvent[], p: PlayerState) {
  const ax = p.aimX, ay = p.aimY;
  let best: EnemyState | null = null; let bestAlong = Infinity;
  for (const e of livingEnemies(state)) {
    const vx = e.x - p.x, vy = e.y - p.y;
    const along = vx * ax + vy * ay;
    if (along < -e.radius || along > 3 + e.radius) continue;
    if (Math.abs(-vx * ay + vy * ax) > 0.6 + e.radius) continue;
    if (along < bestAlong) { bestAlong = along; best = e; }
  }
  const stop = best ? Math.max(0, bestAlong - best.radius - 0.35) : 3;
  const { ox, oy } = blink(state, ev, p, p.x + ax * stop, p.y + ay * stop);
  if (best) {
    const mult = cohortHpFrac(best.cohort) < 0.35 ? B(2) : ONE;
    if (has(p, 'd_exsanguinate')) exsanguinate(state, ev, p, best);
    const res = strike(state, ev, p, best, famHit(state, p, 'd_execution').mul(mult), { skillId: 'd_execution', fromX: p.x, fromY: p.y, bleed: '0.3', bleedSec: 4, stagger: 60, flinch: 0.5 });
    if (!res.dealt.isZero()) addCombo(state, p, 2);
    if (!res.kills.isZero() || !alive(best)) p.vars.execRefund = 1;   // applied in onCast, after the charge is spent
    fx(ev, p, 'd_fx_execute_hit', best.x, best.y, ax, ay);
  }
  fx(ev, p, 'd_execution', ox, oy, p.x, p.y);
}

// ---------------- Shadow ----------------

function shadowstep(state: SimState, ev: SimEvent[], p: PlayerState) {
  const tgt = targetNearAim(state, p, 6);
  const [tx, ty] = tgt ? behind(p, tgt, 0.6) : aimPoint(p, 6);
  const { ox, oy } = blink(state, ev, p, tx, ty);
  onDepart(state, p, ox, oy);
  const dmg = famHit(state, p, 'd_shadowstep').mul(reaperMult(p));
  let hits = 0;
  for (const e of livingEnemies(state)) {
    if (d2(e.x, e.y, p.x, p.y) > (1.4 + e.radius) ** 2) continue;
    strike(state, ev, p, e, dmg, { skillId: 'd_shadowstep', fromX: p.x, fromY: p.y, area: 1.4, stagger: 40, flinch: 0.4 });
    hits++;
  }
  p.iframes = Math.max(p.iframes, 0.2);
  onArrive(state, p);
  if (hits) addCombo(state, p, 2);
  reaperCost(p);
  fx(ev, p, 'd_shadowstep', ox, oy, p.x, p.y);
}

function clearVisited(p: PlayerState, prefix: string) {
  for (const k of Object.keys(p.vars)) if (k.startsWith(prefix)) delete p.vars[k];
}
function visited(p: PlayerState, prefix: string): Set<number> {
  const s = new Set<number>();
  for (const k of Object.keys(p.vars)) if (k.startsWith(prefix)) s.add(p.vars[k]);
  return s;
}
function visit(p: PlayerState, prefix: string, id: number) {
  let i = 0;
  while (p.vars[prefix + i] !== undefined) i++;
  p.vars[prefix + i] = id;
}

function rushStep(state: SimState, ev: SimEvent[], p: PlayerState) {
  const v = p.vars;
  if (!v.rushLeft) return;
  p.iframes = Math.max(p.iframes, 0.12);
  if (state.tick < v.rushNext) return;
  const seen = visited(p, 'rv');
  const tgt = nearestFrom(state, p.x, p.y, 6, (e) => seen.has(e.id));
  if (!tgt) {
    if (!seen.size) {     // nothing in reach at all: a plain dash toward the aim
      const [tx, ty] = aimPoint(p, 4);
      const { ox, oy } = blink(state, ev, p, tx, ty);
      onDepart(state, p, ox, oy);
      fx(ev, p, 'd_fx_blink', ox, oy, p.x, p.y);
      onArrive(state, p);
    }
    v.rushLeft = 0; clearVisited(p, 'rv');
    p.iframes = Math.max(p.iframes, 0.15);
    return;
  }
  const [tx, ty] = behind(p, tgt, 0.55);
  const { ox, oy } = blink(state, ev, p, tx, ty);
  onDepart(state, p, ox, oy);
  visit(p, 'rv', tgt.id);
  const dmg = famHit(state, p, 'd_phantom_rush').mul(reaperMult(p));
  let hits = 0;
  for (const e of livingEnemies(state)) {
    if (e !== tgt && d2(e.x, e.y, tgt.x, tgt.y) > (1.2 + e.radius) ** 2) continue;
    strike(state, ev, p, e, dmg, { skillId: 'd_phantom_rush', fromX: p.x, fromY: p.y, area: 1.2, stagger: 25, flinch: 0.35 });
    hits++;
  }
  if (hits) addCombo(state, p, 1);
  fx(ev, p, 'd_fx_blink', ox, oy, p.x, p.y);
  v.rushLeft--;
  v.rushNext = state.tick + 6;
  if (v.rushLeft <= 0) { v.rushLeft = 0; clearVisited(p, 'rv'); onArrive(state, p); p.iframes = Math.max(p.iframes, 0.15); }
}

function deathMark(state: SimState, ev: SimEvent[], p: PlayerState) {
  const tgt = targetNearAim(state, p, 6);
  const [tx, ty] = tgt ? behind(p, tgt, 0.6) : aimPoint(p, 6);
  const { ox, oy } = blink(state, ev, p, tx, ty);
  onDepart(state, p, ox, oy);
  if (tgt) {
    const res = strike(state, ev, p, tgt, famHit(state, p, 'd_death_mark').mul(reaperMult(p)), { skillId: 'd_death_mark', fromX: p.x, fromY: p.y, stagger: 40, flinch: 0.4 });
    if (!res.dealt.isZero()) addCombo(state, p, 2);
    state.hazards.push(makeHazard(state, {
      kind: 'd_mark', owner: 'player', ownerId: p.slot, x: tgt.x, y: tgt.y, radius: 1.8, inner: tgt.id,
      untilTick: state.tick + T(2.5), interval: 99999, nextTick: state.tick + 99999, damage: ZERO, dtype: 'physical',
    }));
  }
  p.iframes = Math.max(p.iframes, 0.2);
  onArrive(state, p);
  reaperCost(p);
  fx(ev, p, 'd_death_mark', ox, oy, p.x, p.y);
}

function detonateMark(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  const dmg = famHit(state, p, 'd_death_mark').mul(B('2')).div(B('2.4')).mul(reaperMult(p)).add(h.damage.mul(B('0.4')));
  for (const e of livingEnemies(state)) {
    if (d2(e.x, e.y, h.x, h.y) > (h.radius + e.radius) ** 2) continue;
    strike(state, ev, p, e, dmg, { skillId: 'd_mark_burst', fromX: h.x, fromY: h.y, area: h.radius, stagger: 50, kb: 0.6, gen: 1 });
  }
  fx(ev, p, 'd_fx_mark_burst', h.x, h.y, h.radius, 0);
}

// ---------------- Tempo ----------------

function reflect(state: SimState, p: PlayerState, pr: Projectile, dmg: Big) {
  const src = state.enemies.find((e) => e.id === pr.ownerId && alive(e)) ?? nearestFrom(state, pr.x, pr.y, 9);
  let [dx, dy] = src ? norm(src.x - pr.x, src.y - pr.y) : norm(-pr.vx, -pr.vy);
  if (dx === 0 && dy === 0) { dx = p.aimX; dy = p.aimY; }
  const sp = Math.max(11, Math.min(30, Math.hypot(pr.vx, pr.vy) * 1.4));
  pr.owner = 'player'; pr.ownerId = p.slot; pr.kind = 'd_reflect';
  pr.vx = dx * sp; pr.vy = dy * sp; pr.range = 10; pr.damage = dmg; pr.dtype = 'physical';
  pr.pierce = 1; pr.hitIds = []; pr.skillId = 'd_riposte'; pr.crit = false; pr.lobTarget = null;
  delete pr.dot;
}

function counterDamage(state: SimState, p: PlayerState) {
  return famHit(state, p, 'd_riposte').mul(has(p, 'd_perfect_guard') ? B('1.5') : ONE);
}

function counter(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, swept: { done: boolean }) {
  const dmg = counterDamage(state, p);
  if (has(p, 'd_counterstrike')) {
    if (swept.done) return;
    swept.done = true;
    const sweep = dmg.mul(B('2.4')).div(B('2.6'));
    for (const o of livingEnemies(state)) {
      if (d2(o.x, o.y, p.x, p.y) > (2.4 + o.radius) ** 2) continue;
      strike(state, ev, p, o, sweep, { skillId: 'd_riposte', fromX: p.x, fromY: p.y, area: 2.4, kb: 1.2 });
      stun(state, ev, o, 1, 60);
    }
    fx(ev, p, 'd_fx_counter_sweep', p.x, p.y, 2.4, 0);
    return;
  }
  strike(state, ev, p, e, dmg, { skillId: 'd_riposte', fromX: p.x, fromY: p.y, flinch: 0.5 });
  stun(state, ev, e, 1, 60);
  fx(ev, p, 'd_fx_counter', p.x, p.y, e.x, e.y);
}

function onParry(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number) {
  gainMomentum(p, MOMENTUM.parry, SLOT.d_riposte);
  addCombo(state, p, 3);
  if (has(p, 'd_perfect_guard')) {
    shieldPlayer(state, ev, p, p.maxHp.mul(B('0.12')));
    p.vars.pendGuard = 1;     // refund after this tick's skill bookkeeping
  }
  if (has(p, 'd_perfect_form')) {
    p.buffs = p.buffs.filter((b) => b.id !== 'd_perfect_form');
    p.buffs.push({ id: 'd_perfect_form', until: state.tick + T(4), value: 1 });
  }
  fx(ev, p, 'd_fx_parry', p.x, p.y, x, y);
}

function startFangs(state: SimState, p: PlayerState) {
  const n = Math.min(16, 6 + Math.floor(combo(p) / 2));
  setCombo(p, 0);
  p.vars.fangsLeft = n;
  p.vars.fangsNext = state.tick;
  p.vars.fangsGap = Math.max(1, Math.floor(48 / n));
}

function fangsStep(state: SimState, ev: SimEvent[], p: PlayerState) {
  const v = p.vars;
  if (!v.fangsLeft || state.tick < v.fangsNext) return;
  if (state.tick - v.fangsNext > 60) { v.fangsLeft = 0; return; }
  const dmg = famHit(state, p, 'd_hundred_fangs');
  const ch = cosHalf(90);
  for (const e of livingEnemies(state)) {
    if (!inCone(p.x, p.y, p.aimX, p.aimY, 2.3, ch, e.x, e.y, e.radius)) continue;
    strike(state, ev, p, e, dmg, { skillId: 'd_hundred_fangs', fromX: p.x, fromY: p.y, area: 2.3, stagger: 6, flinch: 0.15 });
  }
  fx(ev, p, 'd_fx_fang_slash', p.x, p.y, p.aimX, p.aimY);
  v.fangsLeft--;
  v.fangsNext = state.tick + v.fangsGap;
}

function parryStep(state: SimState, ev: SimEvent[], p: PlayerState) {
  const v = p.vars;
  const form = v.parryForm ?? 0;
  if (!form) return;
  if (state.tick <= v.parryUntil) {
    const R = form === 2 ? 1.6 : 1.3;
    let at: [number, number] | null = null;
    const reflDmg = famHit(state, p, 'd_riposte').mul(form === 2 ? ONE : B('0.5'));
    for (const pr of state.projectiles) {
      if (pr.owner !== 'enemy' || d2(pr.x, pr.y, p.x, p.y) > R * R) continue;
      at ??= [pr.x, pr.y];
      reflect(state, p, pr, reflDmg);
    }
    const swept = { done: false };
    for (const e of livingEnemies(state)) {
      if (!e.attack || (at && form !== 2)) continue;
      const def = attackDef(e, e.attack.attackId);
      if (!def || !MELEE_KINDS.has(def.kind)) continue;
      const st = e.attack.stage;
      if (!(st === 'release' || (st === 'windup' && e.attack.timer <= 0.25))) continue;
      const reach = Math.min(def.range, 4) + e.radius + 0.8;
      if (d2(e.x, e.y, p.x, p.y) > reach * reach) continue;
      at ??= [e.x, e.y];
      counter(state, ev, p, e, swept);
    }
    if (at) {
      onParry(state, ev, p, at[0], at[1]);
      if (form !== 2) {
        v.parried = 1;
        v.parryForm = 0;
        if (form === 3) startFangs(state, p);
      }
    }
    return;
  }
  // stance expired
  if (form === 1 && !v.parried) {
    const dmg = famHit(state, p, 'd_riposte').mul(B('0.5'));
    for (const e of livingEnemies(state)) {
      if (!inLine(p.x, p.y, p.aimX, p.aimY, 2.4, 0.45, e.x, e.y, e.radius)) continue;
      strike(state, ev, p, e, dmg, { skillId: 'd_riposte', fromX: p.x, fromY: p.y, flinch: 0.3 });
    }
    fx(ev, p, 'd_fx_thrust', p.x, p.y, p.aimX, p.aimY);
  }
  if (form === 3 && !v.parried) startFangs(state, p);
  v.parryForm = 0;
}

// ---------------- Signature ----------------

function cutsStep(state: SimState, ev: SimEvent[], p: PlayerState) {
  const v = p.vars;
  if (!v.tcLeft && !v.tcBurst) return;
  p.iframes = Math.max(p.iframes, 0.12);
  if (state.tick < v.tcNext) return;
  if (state.tick - v.tcNext > 30) { endCuts(p); return; }    // stale (e.g. downed mid-sequence)
  const dmg = hitDamage(state, p, 'd_thousand_cuts', 'physical');
  if (v.tcLeft > 0) {
    const seen = visited(p, 'tv');
    const tgt = nearestFrom(state, p.x, p.y, 5, (e) => seen.has(e.id)) ?? nearestFrom(state, p.x, p.y, 5);
    const [tx, ty] = tgt ? behind(p, tgt, 0.7) : [p.x + p.aimX * 2.5, p.y + p.aimY * 2.5];
    const { ox, oy } = blink(state, ev, p, tx, ty);
    onDepart(state, p, ox, oy, true);
    const len = Math.hypot(p.x - ox, p.y - oy);
    const [dx, dy] = norm(p.x - ox, p.y - oy);
    let hits = 0;
    for (const e of livingEnemies(state)) {
      const inside = len > 1e-3 ? inLine(ox, oy, dx, dy, len, 0.5, e.x, e.y, e.radius) : d2(e.x, e.y, p.x, p.y) <= (1 + e.radius) ** 2;
      if (!inside && e !== tgt) continue;
      strike(state, ev, p, e, dmg, { skillId: 'd_thousand_cuts', fromX: p.x, fromY: p.y, area: 0.5, stagger: 25, flinch: 0.3 });
      hits++;
    }
    if (hits && !v.tcHit) { v.tcHit = 1; addCombo(state, p, 2); }
    if (tgt) visit(p, 'tv', tgt.id);
    fx(ev, p, 'd_fx_blink', ox, oy, p.x, p.y);
    v.tcLeft--;
    v.tcNext = state.tick + 5;
    if (v.tcLeft <= 0) { v.tcLeft = 0; v.tcBurst = 1; }
    return;
  }
  const R = v.tcR || 2.4;
  const burst = dmg.mul(B('2.75'));
  for (const e of livingEnemies(state)) {
    if (d2(e.x, e.y, p.x, p.y) > (R + e.radius) ** 2) continue;
    strike(state, ev, p, e, burst, { skillId: 'd_thousand_cuts', fromX: p.x, fromY: p.y, area: R, kb: 1, stagger: 70 });
  }
  fx(ev, p, 'd_fx_cuts_burst', p.x, p.y, R, 0);
  endCuts(p);
  p.iframes = Math.max(p.iframes, 0.15);
}

function endCuts(p: PlayerState) {
  p.vars.tcLeft = 0; p.vars.tcBurst = 0; p.vars.tcHit = 0;
  clearVisited(p, 'tv');
}

// ---------------- kill effects ----------------

function killEffects(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, died: boolean) {
  if (has(p, 'd_shadow_dance') && state.tick - (p.vars.danceT ?? -1e9) >= T(2)) { p.vars.danceT = state.tick; p.vars.pendDance = 1; }
  if (has(p, 'd_coup_de_grace') && state.tick - (p.vars.coupT ?? -1e9) >= T(1.5)) { p.vars.coupT = state.tick; p.vars.pendCoup = 1; }
  if (died && has(p, 'd_open_veins')) {
    let rate = ZERO;
    for (const d of e.dots) if (d.src === p.slot && d.type === 'physical' && d.until > state.tick) rate = rate.add(d.perSec);
    if (rate.isZero()) return;
    const near = livingEnemies(state).filter((o) => o !== e && d2(o.x, o.y, e.x, e.y) <= (3.5 + o.radius) ** 2)
      .sort((a, b) => d2(a.x, a.y, e.x, e.y) - d2(b.x, b.y, e.x, e.y) || a.id - b.id).slice(0, 2);
    for (const o of near) {
      addDot(state, o, p.slot, 'physical', rate, 3);
      fx(ev, p, 'd_fx_veins', e.x, e.y, o.x, o.y);
    }
  }
}

/** Fang Finisher geometry relative to the Twin Fangs shape: extra reach and the (minimum) arc. */
const FINISHER = { reach: 0.4, arc: 110 };
/** Keen Edge (melee sustain): a critical Twin Fangs or Fang Finisher hit heals this fraction of maximum health, once per swing. */
export const FANG_CRIT_HEAL = '0.008';

// ---------------- hooks ----------------

registerClassHooks('duelist', {
  basicAttack(state, ev, p, k) {
    const v = p.vars;
    const t = state.tick;
    if (t - (v.fangLast ?? -1e9) > 60) v.fangChain = 0;
    const chain = v.fangChain ?? 0;
    const every = p.buffs.some((b) => b.id === 'd_perfect_form') ? 1 : has(p, 'd_flurry') && combo(p) >= 10 ? 2 : 4;
    const fin = (chain + 1) % every === 0;
    const ambush = (v.ambushUntil ?? 0) > t;
    // reach and arc from content (d_twin_fangs shape); the Fang Finisher reaches FINISHER.reach further, wider
    const fs = SKILL_BY_ID['d_twin_fangs'].shape;
    const baseR = fs.kind === 'arc' ? fs.range : 1.6, baseArc = fs.kind === 'arc' ? fs.arcDeg : 75;
    const range = fin ? baseR + FINISHER.reach : baseR;
    const ch = cosHalf(fin ? Math.max(baseArc, FINISHER.arc) : baseArc);
    let mult = fin ? B(2) : ONE;
    if (ambush) mult = mult.mul(B('2.5'));
    const base = hitDamage(state, p, 'd_twin_fangs', 'physical').mul(mult);
    const stagger = (fin ? 12 : 0) + (ambush ? 40 : 0);
    let hits = 0;
    for (const e of livingEnemies(state)) {
      if (!inCone(p.x, p.y, p.aimX, p.aimY, range, ch, e.x, e.y, e.radius)) continue;
      strike(state, ev, p, e, base, { skillId: 'd_twin_fangs', fromX: p.x, fromY: p.y, area: range, k, flinch: ambush ? 0.6 : fin ? 0.4 : 0.12, stagger: stagger || undefined });
      hits++;
    }
    // shadow clones mirror the swing from where they stand
    for (const h of myHazards(state, p, 'd_clone')) {
      h.dx = p.aimX; h.dy = p.aimY;
      for (const e of livingEnemies(state)) {
        if (!inCone(h.x, h.y, p.aimX, p.aimY, range, ch, e.x, e.y, e.radius)) continue;
        strike(state, ev, p, e, base.mul(B('0.5')), { skillId: 'd_clone', fromX: h.x, fromY: h.y, area: range, k, flinch: 0.12 });
      }
      fx(ev, p, 'd_clone_slash', h.x, h.y, p.aimX, p.aimY);
    }
    if (hits > 0) {
      v.fangChain = chain + 1;
      v.fangLast = t;
      gainMomentum(p, v.critT === t ? MOMENTUM.crit : MOMENTUM.swing);
      addCombo(state, p, 1);
      if (ambush) v.ambushUntil = 0;
    }
    ev.push({ t: 'cast', slot: p.slot, skill: fin && hits ? 'd_fang_finisher' : 'd_twin_fangs', x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, count: k.gt(ONE) ? k.toCompact() : undefined });
    return true;
  },

  castSkill(state, ev, p, skillId) {
    const v = p.vars;
    switch (skillId) {
      case 'd_rend': rend(state, ev, p); return true;
      case 'd_crimson_whirl':
        whirlSpin(state, ev, p, true);
        v.whirlLeft = 2; v.whirlNext = state.tick + T(0.25);
        fx(ev, p, 'd_crimson_whirl', p.x, p.y, p.aimX, p.aimY);
        return true;
      case 'd_execution': execution(state, ev, p); return true;
      case 'd_shadowstep': shadowstep(state, ev, p); return true;
      case 'd_phantom_rush':
        clearVisited(p, 'rv');
        v.rushLeft = 4; v.rushNext = state.tick;
        reaperCost(p);
        fx(ev, p, 'd_phantom_rush', p.x, p.y, p.aimX, p.aimY);
        rushStep(state, ev, p);
        return true;
      case 'd_death_mark': deathMark(state, ev, p); return true;
      case 'd_riposte':
      case 'd_mirror_guard':
      case 'd_hundred_fangs': {
        const dur = skillId === 'd_mirror_guard' ? 0.9 : skillId === 'd_hundred_fangs' ? 0.35 : 0.5;
        v.parryForm = skillId === 'd_mirror_guard' ? 2 : skillId === 'd_hundred_fangs' ? 3 : 1;
        v.parryUntil = state.tick + T(dur);
        v.parried = 0;
        p.iframes = Math.max(p.iframes, dur + 0.05);
        fx(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
        return true;
      }
      case 'd_thousand_cuts': {
        let n = 5, R = 2.4;
        if (has(p, 'd_finale') && combo(p) >= 15) { setCombo(p, combo(p) - 15); n += 3; R *= 1.6; }
        endCuts(p);
        v.tcLeft = n; v.tcNext = state.tick; v.tcR = R;
        p.iframes = Math.max(p.iframes, 0.2);
        fx(ev, p, 'd_thousand_cuts', p.x, p.y, p.aimX, p.aimY);
        cutsStep(state, ev, p);
        return true;
      }
    }
    return undefined;
  },

  onCast(state, ev, p, skillId) {
    if (skillId === 'd_execution' && p.vars.execRefund) {
      p.vars.execRefund = 0;
      refundCharge(p, 'd_rend', true);
      gainMomentum(p, MOMENTUM.execution, SLOT.d_rend);
    }
  },

  onEnemyHit(state, ev, p, e, info) {
    if (!p) return;
    if (info.crit) p.vars.critT = state.tick;
    if (info.crit && info.skillId === 'd_twin_fangs' && info.generation === 0 && p.classId === 'duelist' && p.vars.fangHealT !== state.tick) {
      p.vars.fangHealT = state.tick;
      healPlayer(state, ev, p, p.maxHp.mul(B(FANG_CRIT_HEAL)));
    }
    if (info.skillId !== 'd_mark_burst') {
      for (const h of state.hazards) if (h.kind === 'd_mark' && h.ownerId === p.slot && h.inner === e.id && h.untilTick > state.tick) h.damage = h.damage.add(info.dealt);
    }
    // cohort units slain without the cohort dying (full deaths arrive through onKill)
    if (info.kill && !e.cohort.count.isZero()) killEffects(state, ev, p, e, false);
  },

  onKill(state, ev, e, p) {
    if (p) killEffects(state, ev, p, e, true);
  },

  onPlayerDamaged(state, _ev, p, info) {
    if (has(p, 'd_unbroken') || !combo(p)) return;
    if (info.dealt.gte(p.maxHp.mul(B('0.05')))) setCombo(p, Math.floor(combo(p) / 2));
  },

  onDodge(state, ev, p) {
    const r = rank(p, 'd_phantom_dash');
    if (r > 0 && state.map) {
      const pd = playerDerived(state, p);
      // the strike line covers the dash itself: same normalization as players.dodgeSpeedFor (tree / Fate speed
      // lengthens it, the global RULES.playerMoveSpeedMult does not)
      const travel = Math.min(40, DODGE.travel * toFloatClamped(pd.moveSpeed, 1e7) / (CLASS_BY_ID[p.classId].base.moveSpeed * Number(RULES.playerMoveSpeedMult)));
      const dx = p.dodgeDirX, dy = p.dodgeDirY;
      const len = Math.min(travel, rayDistance(state.map, p.x, p.y, dx, dy, travel));
      const ex = p.x + dx * len, ey = p.y + dy * len;
      const dmg = baseHit(state, p, r >= 2 ? '1.04' : '0.8');
      for (const e of livingEnemies(state)) {
        if (!inLine(p.x, p.y, dx, dy, len, 0.6, e.x, e.y, e.radius)) continue;
        strike(state, ev, p, e, dmg, { skillId: 'd_phantom_dash', fromX: ex, fromY: ey, area: 0.6, stagger: 10, flinch: 0.3 });
      }
      fx(ev, p, 'd_fx_phantom', p.x, p.y, ex, ey);
    }
    if (has(p, 'd_ambush')) p.vars.ambushUntil = state.tick + T(2);
  },

  onPlayerTick(state, ev, p) {
    const v = p.vars;
    // Combo timeout
    if (combo(p) > 0 && state.tick - (v.comboT ?? 0) > T(has(p, 'd_unbroken') ? 4 : 2)) setCombo(p, 0);
    if (v.ui_comboMax !== comboMax(p)) v.ui_comboMax = comboMax(p);
    if (v.ui_combo === undefined) v.ui_combo = combo(p);
    parryStep(state, ev, p);
    fangsStep(state, ev, p);
    if (v.whirlLeft && state.tick >= v.whirlNext) {
      if (state.tick - v.whirlNext > 30) v.whirlLeft = 0;
      else { whirlSpin(state, ev, p, false); v.whirlLeft--; v.whirlNext = state.tick + T(0.25); }
    }
    rushStep(state, ev, p);
    cutsStep(state, ev, p);
    // deferred refunds (kills during a cast resolve before that cast spends its charge)
    if (v.pendCoup) { v.pendCoup = 0; refundCharge(p, 'd_rend', true); }
    if (v.pendDance) { v.pendDance = 0; refundCharge(p, 'd_shadowstep', false); }
    if (v.pendGuard) { v.pendGuard = 0; refundCharge(p, 'd_riposte', true); }
    // Reaper's Path: the Shadow skill recharges twice as fast
    if (has(p, 'd_reapers_path')) {
      const s = skillSlot(p, 'd_shadowstep');
      if (s && s.charges < s.maxCharges) s.cooldown -= DT * toFloatClamped(playerDerived(state, p).recovery, 1e12);
    }
    // Endless Waltz: x1.015 basic attack speed per Combo point, as extra logical attack work
    if (has(p, 'd_endless_waltz') && combo(p) > 0 && (p.prevButtons & ACTION.ATTACK) && p.dodgeTimer <= 0 && p.guardTimer <= 0) {
      const bonus = B('1.015').powInt(combo(p)).toNumber() - 1;
      p.attackWork += bonus * toFloatClamped(playerDerived(state, p).attackFreq, 1e9) * DT;
    }
  },

  hazardTick(state, ev, h) {
    const p = state.players[h.ownerId];
    if (!p) return undefined;
    switch (h.kind) {
      case 'd_clone':
        if (state.tick === h.untilTick - 1 && has(p, 'd_legion_of_shades')) {
          const dmg = baseHit(state, p, '1.5');
          for (const e of livingEnemies(state)) {
            if (d2(e.x, e.y, h.x, h.y) > (1.8 + e.radius) ** 2) continue;
            strike(state, ev, p, e, dmg, { skillId: 'd_clone_burst', fromX: h.x, fromY: h.y, area: 1.8, stagger: 20, kb: 0.5, gen: 1 });
          }
          fx(ev, p, 'd_fx_clone_burst', h.x, h.y, 1.8, 0);
        }
        return true;
      case 'd_smoke':
        if (state.tick >= h.nextTick) {
          h.nextTick = state.tick + h.interval;
          for (const e of livingEnemies(state)) {
            if (d2(e.x, e.y, h.x, h.y) > (h.radius + e.radius) ** 2) continue;
            interrupt(state, e);
            e.vulnUntil = Math.max(e.vulnUntil, state.tick + T(3));
            e.vulnFactor = '1.2';
          }
        }
        return true;
      case 'd_mark': {
        const tgt = state.enemies.find((e) => e.id === h.inner);
        if (tgt && alive(tgt)) { h.x = tgt.x; h.y = tgt.y; }
        if (!tgt || !alive(tgt) || state.tick >= h.untilTick - 1) {
          detonateMark(state, ev, p, h);
          h.untilTick = state.tick;
        }
        return true;
      }
    }
    return undefined;
  },

  extraCharges(p, skillId) {
    return FAMILY[skillId] === 'd_shadowstep' && has(p, 'd_twin_shadows') ? 1 : 0;
  },

  onRoundStart(state) {
    for (const p of state.players) {
      if (p.classId !== 'duelist') continue;
      const v = p.vars;
      setCombo(p, 0);
      v.parryForm = 0; v.fangsLeft = 0; v.whirlLeft = 0; v.rushLeft = 0; v.ambushUntil = 0; v.fangChain = 0;
      endCuts(p); clearVisited(p, 'rv');
    }
  },
});
