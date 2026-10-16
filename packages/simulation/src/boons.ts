import { Big, formatBig } from '@cursebound/numeric';
import {
  BOSS_BY_ID, CLASS_BY_ID, DODGE, ENEMY_BY_ID, MECHANICS, MECHANIC_BASE_MAGNITUDE, MECHANIC_BY_ID, RULES, SKILL_BY_ID, TICK_SEC,
  type DamageType, type MechanicDef,
} from '@cursebound/content';
import { cohortHpFrac, cohortRadius, healPlayer, hitEnemy, hitPlayer, killEnemy, mitigationFactor, shieldPlayer } from './combat';
import { createEnemy } from './director';
import { dist2, norm } from './geometry';
import { registerGlobalHooks, type EnemyHitInfo, type HitMod, type HitModInfo, type PlayerDamagedInfo, type SimHooks } from './hooks';
import { impactKnock } from './knock';
import { nearestFloor } from './map';
import { areaCoverage, livingEnemies, makeHazard } from './players';
import { nextFloat } from './rng';
import { B, ONE, playerDerived } from './stats';
import type { EnemyState, FateMechanicState, Hazard, PlayerState, SimEvent, SimState } from './types';

// Fate mechanics (boons and banes, content/mechanics.ts) implemented on the SimHooks extension points.
// Registered once globally at import (sim.ts imports this module for its side effect).
//
// Rules of the road:
// - Deterministic: only state, the seeded combat stream (Echo rolls, Hexed Ground placement) and hook arguments.
// - Stacking: a bound mechanic keeps { stacks, acc } where acc is the running product of per-copy factors
//   (compound: 1+m, chance: 1−m, factor: m). The effective magnitude is derived from acc — never a sum.
// - Finite: every follow-up hit carries generation + 1. Thunder, splits, trails and shockwaves never re-trigger
//   themselves; Chain Reaction blasts stop after params.maxGeneration waves.
// - Cohort aware: kills are counted in logical units (EnemyHitInfo.kills); blasts fold the unit count into their
//   area damage (k grouped area hits == one hit of k×d per covered unit), executions act on the front unit or on
//   the whole cohort when area damage wore every unit down.
//
// Presentation contract (client fx/fate.ts):
//   'cast' skills: boon_chain_reaction (x,y = blast centre, dx = radius), boon_thunderous_blows (x,y = strike point),
//   boon_splitting_shots (x,y = from, dx,dy = shard target point), boon_bloodrush, boon_echo, boon_phoenix,
//   boon_warding_rune, boon_retribution (x,y = hero, dx = radius), boon_soul_harvest (x,y = foe, dx,dy = hero),
//   boon_executioner (x,y = foe), bane_hexed_ground (x,y = eruption, dx = radius), bane_relentless (x,y = foe),
//   bane_blood_moon (x,y = map centre, dx = level), bane_brittle (x,y = hero), bane_the_hunt (x,y = Reaper rises).
//   Enemy-sourced casts use slot -1.
//   Hazards: fate_blast (player; pending blast), fate_trail (player; static trail), fate_pyre (enemy; burning pool,
//   arms after armSec), fate_hex (enemy; curse circle, erupts at armSec), fate_reaper (enemy; the Reaper, dx/dy = heading).
//   Rule-changer wave casts: boon_shadow_twin (x,y = shade, dx,dy = struck foe), boon_grave_thralls (x,y = thrall rises),
//   boon_last_stand (x,y = hero), boon_gravity_well (x,y = centre, dx = radius), boon_momentum_ready (x,y = hero),
//   boon_momentum (x,y = struck foe), boon_mirror_ward (x,y = projectile, dx,dy = new heading), boon_pandora (x,y = hero,
//   dx = rolled boon index in MECHANICS or -1, dy = rolled bane index or -1; one per living hero), bane_blood_price
//   (x,y = hero), bane_restless_dead (x,y = wisp rises), bane_wisp_burst (x,y = burst), bane_grave_hands (x,y = hero),
//   bane_shadow_pact (x,y = twin, dx,dy = its elite).
//   Rule-changer wave hazards: fate_shade (player; the shadow twin, dx/dy = facing), fate_thrall (player; a thrall rising
//   for riseSec, dx/dy = heading), fate_wisp (enemy; a hunting wisp rising for riseSec), fate_grasp (enemy; grave hands
//   under a lingering hero: they grip GRASP_WARN_SEC after appearing).
//
// Pandora: state.fate.rolled holds this round's rolled boon/bane as one extra per-copy factor; mech() folds it in, so
// every rule below works the same whether a card or a roll binds it.

const DT = TICK_SEC;
const DT_B = B(TICK_SEC);
const ZERO = Big.ZERO;
const NEVER = Number.MAX_SAFE_INTEGER;   // enemy bane hazards: stepEnemyHazard never pulses them; onTick owns timing
const FOREVER = 60 * 60 * 60;            // round-long hazards (shade, grasp): an hour of ticks; round setup clears hazards
/** Grave Hands: the grasp shows this long before the first claw. */
export const GRASP_WARN_SEC = 0.6;

const ticks = (sec: number) => Math.max(1, Math.round(sec / DT));
const param = (id: string, key: string): number => MECHANIC_BY_ID[id].params[key];

// ---------------- Magnitudes and stacking ----------------

/** Factor one copy of magnitude `m` contributes to the running product (see MechanicStacking). */
export function perCopyFactor(def: MechanicDef, magnitude: string): Big {
  const m = B(magnitude);
  if (def.stacking === 'compound') return ONE.add(m);
  if (def.stacking === 'chance') return ONE.sub(m);
  return m;
}

/** Effective magnitude for a running product. */
export function effectiveFromAcc(def: MechanicDef, acc: Big): Big {
  if (def.stacking === 'compound') return acc.sub(ONE);
  if (def.stacking === 'chance') return ONE.sub(acc);
  return acc;
}

/** Combine a list of per-copy magnitudes into one effective magnitude (Forecast and tests). */
export function stackMagnitudes(id: string, magnitudes: string[]): Big {
  const def = MECHANIC_BY_ID[id];
  let acc = ONE;
  for (const m of magnitudes) acc = acc.mul(perCopyFactor(def, m));
  return effectiveFromAcc(def, acc);
}

export function mechanicState(state: SimState, id: string): FateMechanicState | undefined {
  return state.fate.mechanics?.[id];
}

/** Effective magnitude of a bound mechanic (this round's Pandora roll included), or null when nothing binds it. */
export function mech(state: SimState, id: string): Big | null {
  const s = state.fate.mechanics?.[id];
  const r = state.fate.rolled?.[id];
  const bound = !!s && s.stacks > 0;
  if (!bound && !r) return null;
  const acc = bound ? s.acc : ONE;
  return effectiveFromAcc(MECHANIC_BY_ID[id], r ? acc.mul(r) : acc);
}

/** Float view of the effective magnitude (0 when unbound), clamped for timers and probabilities. */
export function mechNum(state: SimState, id: string, max = 1e6): number {
  const v = mech(state, id);
  if (!v || v.isZero()) return 0;
  if (v.log10() > Math.log10(max)) return max;
  return Math.min(max, v.toNumber());
}

/** Bind one copy of a mechanic (applyCard) and record Ledger provenance. */
export function bindMechanic(state: SimState, id: string, magnitude: string, prov: { offerId: string; cardId: string; seq: number }) {
  const def = MECHANIC_BY_ID[id];
  if (!def) throw new Error(`unknown mechanic ${id}`);
  const all = (state.fate.mechanics ??= {});
  const cur = all[id] ?? { stacks: 0, acc: ONE };
  all[id] = { stacks: cur.stacks + 1, acc: cur.acc.mul(perCopyFactor(def, magnitude)) };
  (state.fate.mechanicEntries ??= []).push({ seq: prov.seq, offerId: prov.offerId, cardId: prov.cardId, round: state.round, mechanic: id, kind: def.kind, magnitude });
}

/** Display text for an effective magnitude: '25%', '56.25%', '×3', '×1.2e15'. */
export function formatMechanicValue(def: MechanicDef, v: Big): string {
  if (def.unit === 'multiplier') return `×${formatBig(v, { decimals: 2 })}`;
  return `${formatBig(v.mul(B(100)), { decimals: 2 })}%`;
}

function anyBound(state: SimState): boolean {
  if (state.fate.rolled && Object.keys(state.fate.rolled).length) return true;
  const m = state.fate.mechanics;
  if (!m) return false;
  for (const k in m) if (m[k].stacks > 0) return true;
  return false;
}

// ---------------- Helpers ----------------

const fv = (e: EnemyState): Record<string, number> => (e.fateVars ??= {});

function baseRadius(e: EnemyState): number {
  return e.boss ? BOSS_BY_ID[e.kind]?.radius ?? e.radius : ENEMY_BY_ID[e.kind]?.radius ?? e.radius;
}

/** Shrink a cohort's collision radius after units were removed, preserving any elite scaling. */
function refreshRadius(e: EnemyState, before: Big) {
  const b = baseRadius(e);
  const scale = e.radius / Math.max(1e-6, cohortRadius(b, before));
  e.radius = cohortRadius(b, e.cohort.count) * scale;
}

/** Health fraction used for thresholds: the front unit for a lone foe, the worn-down "typical" unit for a cohort. */
function thresholdFrac(e: EnemyState): number {
  const c = e.cohort;
  if (c.count.lte(ONE)) return cohortHpFrac(c);
  if (c.unitHp.isZero()) return 0;
  return Math.max(0, Math.min(1, c.unitHp.sub(c.spread).ratio(c.unitHp)));
}

/** "True" bane damage: `frac` of the hero's maximum health after mitigation (armor ignored; shields still absorb). */
function curseHit(state: SimState, ev: SimEvent[], p: PlayerState, frac: Big, attack: string, x: number, y: number, dtype: 'ember' | 'astral' | 'decay') {
  const pd = playerDerived(state, p);
  const raw = p.maxHp.mul(frac).div(pd.incomingFactor.isZero() ? ONE : pd.incomingFactor);
  return hitPlayer(state, ev, p, raw, { attack, source: attack, fromX: x, fromY: y, dtype, hazard: true });
}

function cast(ev: SimEvent[], slot: number, skill: string, x: number, y: number, dx = 0, dy = 0) {
  ev.push({ t: 'cast', slot, skill, x, y, dx, dy });
}

function nearHero(state: SimState, x: number, y: number, r: number): PlayerState[] {
  return state.players.filter((p) => p.lifeState === 'alive' && dist2(p.x, p.y, x, y) <= (r + RULES.playerRadius) ** 2);
}

function areaHit(state: SimState, ev: SimEvent[], x: number, y: number, R: number, perHit: Big, o: { slot: number; skillId: string; dtype: DamageType; generation: number; crit: boolean }) {
  for (const t of livingEnemies(state)) {
    if (dist2(t.x, t.y, x, y) > (R + t.radius) ** 2) continue;
    hitEnemy(state, ev, t, perHit, ONE, { dtype: o.dtype, srcSlot: o.slot, skillId: o.skillId, fromX: x, fromY: y, coverage: areaCoverage(t, R), allowCrit: o.crit, generation: o.generation });
  }
}

// ---------------- Kills ----------------

/** Units of a cohort died. `generation` is that of the killing effect (0 = direct). */
function onUnitsSlain(state: SimState, ev: SimEvent[], e: EnemyState, p: PlayerState | undefined, kills: Big, generation: number) {
  if (kills.isZero()) return;
  if (p && p.lifeState === 'alive') {
    // Bloodrush
    const rush = mechNum(state, 'bloodrush', 1000);
    if (rush > 0) {
      // movement comes from the 'bloodrush' buff (players.moveSpeedOf, mirrored by client prediction via snapshot spd)
      const fresh = (p.vars.boon_rush_until ?? 0) <= state.tick;
      const until = state.tick + ticks(param('bloodrush', 'durationSec'));
      p.vars.boon_rush_until = until;
      p.buffs = p.buffs.filter((b) => b.id !== 'bloodrush');
      p.buffs.push({ id: 'bloodrush', until, value: rush });
      if (fresh) cast(ev, p.slot, 'boon_bloodrush', p.x, p.y);
    }
    // Soul Harvest
    const soul = mechNum(state, 'soul_harvest');
    if (soul > 0) {
      // each kill cuts soul x the full cooldown from every recharging skill (no resource: cooldowns are the gate)
      const n = kills.gte(B(param('soul_harvest', 'maxKills'))) ? param('soul_harvest', 'maxKills') : kills.toNumber();
      let cut = false;
      for (const s of p.skills) {
        if (!s.skillId || s.charges >= s.maxCharges) continue;
        s.cooldown -= (s.full ?? SKILL_BY_ID[s.skillId]?.cooldownSec ?? 0) * Math.min(1, soul * n);
        cut = true;
      }
      if (cut) cast(ev, p.slot, 'boon_soul_harvest', e.x, e.y, p.x, p.y);
    }
    // Grave Thralls: every Nth direct kill (and every slain elite) raises a thrall; thralls' own kills never count
    const thrall = mech(state, 'grave_thralls');
    if (thrall && generation === 0) {
      const every = param('grave_thralls', 'everyKills');
      p.vars.boon_thrall_kills = (p.vars.boon_thrall_kills ?? 0) + (kills.gte(B(every)) ? every : kills.toNumber());
      let raise = (e.elite ?? 0) > 0 && e.cohort.count.isZero();
      if (p.vars.boon_thrall_kills >= every) { p.vars.boon_thrall_kills -= every; raise = true; }
      if (raise) raiseThrall(state, ev, p, e.x, e.y, thrall);
    }
  }
  // Chain Reaction: a pending blast; detonated by hazardTick a heartbeat later
  const chain = mech(state, 'chain_reaction');
  if (chain && generation < param('chain_reaction', 'maxGeneration')) {
    const R = param('chain_reaction', 'radius');
    state.hazards.push(makeHazard(state, {
      kind: 'fate_blast', owner: 'player', ownerId: p ? p.slot : -1, x: e.x, y: e.y, radius: R + Math.min(1.5, Math.max(0, e.radius - 0.5)),
      untilTick: state.tick + ticks(param('chain_reaction', 'delaySec')) + 2, nextTick: state.tick + ticks(param('chain_reaction', 'delaySec')),
      interval: NEVER, damage: e.cohort.unitHp.mul(chain).mul(kills), dtype: 'ember', generation: generation + 1,
    }));
  }
  // Volatile Dead: a telegraphed burning pool
  if (mech(state, 'volatile_dead')) {
    const P = MECHANIC_BY_ID.volatile_dead.params;
    const pools = state.hazards.filter((h) => h.kind === 'fate_pyre' && h.untilTick > state.tick);
    if (pools.length >= P.maxPools) pools[0].untilTick = state.tick;
    const radius = Math.min(3, Math.max(1.1, e.radius + 0.5));
    const arm = ticks(P.armSec);
    state.hazards.push(makeHazard(state, {
      kind: 'fate_pyre', owner: 'enemy', ownerId: -1, x: e.x, y: e.y, radius, untilTick: state.tick + arm + ticks(P.burnSec),
      nextTick: NEVER, interval: ticks(P.pulseSec), damage: ZERO, dtype: 'ember',
    }));
    state.telegraphs.push({ id: state.nextId++, ownerId: -1, shape: { kind: 'circle', radius }, x: e.x, y: e.y, dx: 1, dy: 0, startTick: state.tick, releaseTick: state.tick + arm, attack: 'Volatile Dead' });
  }
  // Restless Dead: one roll per death (seeded combat stream); a hunting wisp rises from the corpse
  const restless = mechNum(state, 'restless_dead', 1);
  if (restless > 0 && nextFloat(state.rng.combat) < restless) {
    const P = MECHANIC_BY_ID.restless_dead.params;
    const live = state.hazards.filter((h) => h.kind === 'fate_wisp' && h.untilTick > state.tick).length;
    if (live < P.max) {
      state.hazards.push(makeHazard(state, {
        kind: 'fate_wisp', owner: 'enemy', ownerId: -1, x: e.x, y: e.y, radius: P.radius,
        untilTick: state.tick + ticks(P.riseSec) + ticks(P.lifeSec), nextTick: NEVER, interval: NEVER, damage: ZERO, dtype: 'astral',
      }));
      cast(ev, -1, 'bane_restless_dead', e.x, e.y);
    }
  }
}

/** Grave Thralls: a spectral thrall rises where a foe fell (oldest of the hero's thralls crumbles past the cap). */
function raiseThrall(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, v: Big) {
  const P = MECHANIC_BY_ID.grave_thralls.params;
  const mine = state.hazards.filter((h) => h.kind === 'fate_thrall' && h.ownerId === p.slot && h.untilTick > state.tick);
  if (mine.length >= P.max) mine[0].untilTick = state.tick;
  const pd = playerDerived(state, p);
  const rise = ticks(P.riseSec);
  state.hazards.push(makeHazard(state, {
    kind: 'fate_thrall', owner: 'player', ownerId: p.slot, x, y, radius: P.reach, dx: 1, dy: 0,
    untilTick: state.tick + rise + ticks(P.lifeSec), nextTick: state.tick + rise, interval: ticks(P.strikeSec),
    damage: pd.damage.mul(pd.typeMult.physical).mul(v), dtype: 'physical', generation: 1,
  }));
  cast(ev, p.slot, 'boon_grave_thralls', x, y);
}

// ---------------- Hooks ----------------

function onEnemyHit(state: SimState, ev: SimEvent[], p: PlayerState | undefined, e: EnemyState, info: EnemyHitInfo) {
  if (!anyBound(state)) return;
  if (info.kill) {
    const kills = info.kills && !info.kills.isZero() ? info.kills : ONE;
    if (e.cohort.count.isZero()) fv(e).killTick = state.tick;   // killEnemy follows: onKill must not count it again
    onUnitsSlain(state, ev, e, p, kills, info.generation);
  }
  if (!p) return;
  // Vampiric Rite: heal a share of damage dealt, capped per second
  const vamp = mech(state, 'vampiric_rite');
  if (vamp && p.lifeState === 'alive' && !p.maxHp.isZero()) {
    const window = Math.floor(state.tick / 60);
    if (p.vars.boon_vamp_window !== window) { p.vars.boon_vamp_window = window; p.vars.boon_vamp_used = 0; }
    const room = param('vampiric_rite', 'capPerSec') - (p.vars.boon_vamp_used ?? 0);
    if (room > 1e-9) {
      const want = info.dealt.mul(vamp);
      const cap = p.maxHp.mul(Big.from(room.toFixed(9)));
      const base = Big.min(want, cap);
      p.vars.boon_vamp_used = (p.vars.boon_vamp_used ?? 0) + base.ratio(p.maxHp);
      healPlayer(state, ev, p, base);
    }
  }
  if (info.generation === 0) {
    // Thunderous Blows: every Nth direct hit calls lightning
    const thunder = mech(state, 'thunderous_blows');
    if (thunder) {
      p.vars.boon_thunder = (p.vars.boon_thunder ?? 0) + 1;
      if (p.vars.boon_thunder >= param('thunderous_blows', 'everyHits')) {
        p.vars.boon_thunder = 0;
        const pd = playerDerived(state, p);
        const R = param('thunderous_blows', 'radius');
        cast(ev, p.slot, 'boon_thunderous_blows', e.x, e.y);
        areaHit(state, ev, e.x, e.y, R, pd.damage.mul(pd.typeMult.storm).mul(thunder), { slot: p.slot, skillId: 'boon_thunderous_blows', dtype: 'storm', generation: 1, crit: true });
      }
    }
    // Splitting Shots: projectile hits fork shards into the nearest other foes
    const split = mech(state, 'splitting_shots');
    if (split && info.skillId && SKILL_BY_ID[info.skillId]?.shape.kind === 'projectile') {
      const pr = state.projectiles.find((q) => q.owner === 'player' && q.ownerId === p.slot && q.skillId === info.skillId && q.hitIds.length > 0 && q.hitIds[q.hitIds.length - 1] === e.id);
      const weight = pr ? pr.weight : ONE;
      const base = pr ? pr.damage : playerDerived(state, p).damage.mul(B(SKILL_BY_ID[info.skillId].damageCoef));
      const range = param('splitting_shots', 'range');
      const targets = livingEnemies(state)
        .filter((t) => t !== e && dist2(t.x, t.y, e.x, e.y) <= (range + t.radius) ** 2)
        .sort((a, b) => dist2(a.x, a.y, e.x, e.y) - dist2(b.x, b.y, e.x, e.y) || a.id - b.id)
        .slice(0, param('splitting_shots', 'shards'));
      for (const t of targets) {
        cast(ev, p.slot, 'boon_splitting_shots', e.x, e.y, t.x, t.y);
        hitEnemy(state, ev, t, base.mul(split), weight, { dtype: info.dtype, srcSlot: p.slot, skillId: 'boon_splitting_shots', fromX: e.x, fromY: e.y, allowCrit: true, generation: 1 });
      }
    }
    // Shadow Twin: the shade banks your direct damage and repeats a share of it on its next strike (hazardTick)
    if (mech(state, 'shadow_twin')) {
      const shade = shadeOf(state, p);
      if (shade) { shade.damage = shade.damage.add(info.dealt); (shade.vars ??= {}).t = e.id; }
    }
    // Gravity Well: a crit implodes (per-hero cooldown): nearby foes are dragged to the point, then crushed
    const grav = mech(state, 'gravity_well');
    if (grav && info.crit && state.tick >= (p.vars.boon_grav_next ?? 0)) {
      const P = MECHANIC_BY_ID.gravity_well.params;
      p.vars.boon_grav_next = state.tick + ticks(P.cooldownSec);
      const cx = e.x, cy = e.y;
      cast(ev, p.slot, 'boon_gravity_well', cx, cy, P.radius, 0);
      for (const t of livingEnemies(state)) {
        const d = Math.sqrt(dist2(t.x, t.y, cx, cy));
        if (d > P.radius + t.radius || d < 0.4) continue;
        impactKnock(state, t, 2 * t.x - cx, 2 * t.y - cy, Math.min(P.pull, d - 0.3));   // a push away from the mirror point = a pull inward
      }
      const pd = playerDerived(state, p);
      areaHit(state, ev, cx, cy, P.radius, pd.damage.mul(pd.typeMult.astral).mul(grav), { slot: p.slot, skillId: 'boon_gravity_well', dtype: 'astral', generation: 1, crit: false });
    }
  }
  // Executioner: non-boss foes below the line die (front unit, or the whole worn-down cohort)
  const exec = mechNum(state, 'executioner', 1);
  if (exec > 0 && !e.boss && e.state !== 'dying' && !e.cohort.count.isZero()) {
    const c = e.cohort;
    const gen = info.generation + 1;
    if (thresholdFrac(e) < exec) {
      const kills = c.count;
      fv(e).killTick = state.tick;
      cast(ev, p.slot, 'boon_executioner', e.x, e.y);
      killEnemy(state, ev, e, p.slot);
      onUnitsSlain(state, ev, e, p, kills, gen);
    } else if (c.count.gt(ONE) && cohortHpFrac(c) < exec) {
      const before = c.count;
      c.count = c.count.sub(ONE);
      c.front = ZERO;
      refreshRadius(e, before);
      cast(ev, p.slot, 'boon_executioner', e.x, e.y);
      onUnitsSlain(state, ev, e, p, ONE, gen);
    }
  }
}

function onKill(state: SimState, ev: SimEvent[], e: EnemyState, p: PlayerState | undefined) {
  if (!anyBound(state)) return;
  if (e.fateVars?.killTick === state.tick) return;    // already counted by onEnemyHit / execution
  fv(e).killTick = state.tick;
  onUnitsSlain(state, ev, e, p, ONE, 0);              // damage-over-time and other indirect deaths
}

function onPlayerDamaged(state: SimState, ev: SimEvent[], p: PlayerState, info: PlayerDamagedInfo) {
  if (!anyBound(state)) return;
  const wounded = lastStanding(state, p);   // judged on health before this blow
  // Brittle: the first hit after a dodge cracks you for extra damage (bypasses shields)
  const brittle = mech(state, 'brittle');
  if (brittle && (p.vars.bane_brittle_until ?? 0) > state.tick) {
    p.vars.bane_brittle_until = 0;
    const extra = info.dealt.mul(brittle);
    const taken = Big.min(extra, p.hp);
    p.hp = p.hp.sub(extra);
    p.stats.damageTaken = p.stats.damageTaken.add(taken);
    ev.push({ t: 'hit', target: p.slot, targetKind: 'player', amount: extra.toCompact(), crit: true, dtype: info.dtype, x: p.x, y: p.y, sx: info.fromX, sy: info.fromY, frac: p.maxHp.isZero() ? 1 : Math.min(1, extra.ratio(p.maxHp)) });
    cast(ev, -1, 'bane_brittle', p.x, p.y);
  }
  // Last Stand: below the line a share of the blow is handed back before hitPlayer subtracts it (lethality included)
  if (wounded && !info.dealt.isZero()) p.hp = p.hp.add(info.dealt.mul(B(param('last_stand', 'reduce'))));
  // Phoenix: once per round, a lethal blow leaves you standing
  const phoenix = mech(state, 'phoenix');
  if (phoenix && info.dealt.gte(p.hp) && p.vars.boon_phoenix_round !== state.round) {
    p.vars.boon_phoenix_round = state.round;
    const keep = p.maxHp.mul(phoenix);
    const total = info.dealt.add(keep);
    if (total.gt(info.dealt)) p.hp = total;          // hitPlayer subtracts `dealt` next, leaving exactly `keep`
    else { p.hp = info.dealt.mul(B(2)); p.vars.boon_phoenix_fix = state.tick; }   // absorbed precision: fixed in onTick
    p.iframes = Math.max(p.iframes, param('phoenix', 'invulnSec'));
    ev.push({ t: 'heal', slot: p.slot, amount: keep.toCompact() });
    cast(ev, p.slot, 'boon_phoenix', p.x, p.y);
  }
  // Retribution: a shockwave of the damage taken
  const ret = mech(state, 'retribution');
  if (ret && !info.dealt.isZero()) {
    const R = param('retribution', 'radius');
    cast(ev, p.slot, 'boon_retribution', p.x, p.y, R, 0);
    areaHit(state, ev, p.x, p.y, R, info.dealt.mul(ret), { slot: p.slot, skillId: 'boon_retribution', dtype: 'physical', generation: 1, crit: false });
  }
}

function onDodge(state: SimState, _ev: SimEvent[], p: PlayerState) {
  if (!anyBound(state)) return;
  if (mech(state, 'static_trail')) {
    p.vars.boon_trail_until = state.tick + ticks(DODGE.durationSec) + 2;
    p.vars.boon_trail_next = state.tick;
  }
  if (mech(state, 'brittle')) p.vars.bane_brittle_until = state.tick + ticks(param('brittle', 'windowSec'));
  if (mech(state, 'mirror_ward')) p.vars.boon_mirror_until = state.tick + ticks(param('mirror_ward', 'windowSec'));
}

function onCast(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string) {
  if (!anyBound(state)) return;
  const echo = mechNum(state, 'echo', 1);
  if (echo > 0 && nextFloat(state.rng.combat) < echo) {
    const s = p.skills.find((x) => x.skillId === skillId);
    if (s && s.maxCharges > 0 && s.charges < s.maxCharges) {
      s.charges++;
      if (s.charges >= s.maxCharges) s.cooldown = 0;
      cast(ev, p.slot, 'boon_echo', p.x, p.y);
    }
  }
  // Blood Price: the cast is paid in health, never below the floor (not damage: no shields, no on-hit rules)
  const price = mech(state, 'blood_price');
  if (price && p.lifeState === 'alive' && !p.maxHp.isZero()) {
    const floor = p.maxHp.mul(B(param('blood_price', 'floor')));
    if (p.hp.gt(floor)) {
      const cost = Big.min(p.maxHp.mul(price), p.hp.sub(floor));
      p.hp = p.hp.sub(cost);
      p.stats.damageTaken = p.stats.damageTaken.add(cost);
      ev.push({ t: 'hit', target: p.slot, targetKind: 'player', amount: cost.toCompact(), crit: false, dtype: 'physical', x: p.x, y: p.y, sx: p.x, sy: p.y, frac: Math.min(1, cost.ratio(p.maxHp)) });
      cast(ev, -1, 'bane_blood_price', p.x, p.y);
    }
  }
}

/** Last Stand is bound and the hero stands below its health line. */
function lastStanding(state: SimState, p: PlayerState): boolean {
  if (!mech(state, 'last_stand') || p.maxHp.isZero()) return false;
  return p.hp.ratio(p.maxHp) < param('last_stand', 'threshold');
}

/** The hero's shadow twin (Shadow Twin), if one walks. */
function shadeOf(state: SimState, p: PlayerState): Hazard | undefined {
  return state.hazards.find((h) => h.kind === 'fate_shade' && h.ownerId === p.slot && h.untilTick > state.tick);
}

/** Per-target hit adjustments: Last Stand (wounded heroes hit harder) and Momentum (a charged hit). */
function modifyHit(state: SimState, p: PlayerState, e: EnemyState, info: HitModInfo, mod: HitMod) {
  if (!anyBound(state)) return;
  const ls = mech(state, 'last_stand');
  if (ls && lastStanding(state, p)) mod.dmg = mod.dmg.mul(ONE.add(ls));
  const mo = mech(state, 'momentum');
  if (mo && info.generation === 0) {
    // a full charge releases on the first direct hit; every hit landing that same tick shares it
    if (p.vars.boon_mo_tick === state.tick) mod.dmg = mod.dmg.mul(ONE.add(mo));
    else if ((p.vars.boon_mo ?? 0) >= param('momentum', 'chargeDist')) {
      p.vars.boon_mo = 0;
      p.vars.boon_mo_tick = state.tick;
      p.vars.boon_mo_fx = 1; p.vars.boon_mo_x = e.x; p.vars.boon_mo_y = e.y;
      mod.dmg = mod.dmg.mul(ONE.add(mo));
    }
  }
}

function onPlayerTick(state: SimState, ev: SimEvent[], p: PlayerState) {
  if (!anyBound(state)) return;
  if (p.vars.boon_phoenix_fix === state.tick - 1) fixPhoenix(state, p);
  const pd = playerDerived(state, p);
  // Bloodrush: extra logical attack work while the surge lasts (movement is the 'bloodrush' buff)
  if ((p.vars.boon_rush_until ?? 0) > state.tick) {
    const v = mechNum(state, 'bloodrush', 1000);
    const extra = pd.attackFreq.mul(DT_B).mul(Big.from(v));
    if (v > 0 && extra.log10() < 6) p.attackWork += extra.toNumber();   // beyond this the grouped packets already dominate
  }
  // Static Trail: drop crackling segments while dashing
  const trail = mech(state, 'static_trail');
  if (trail && (p.vars.boon_trail_until ?? 0) > state.tick && state.tick >= (p.vars.boon_trail_next ?? 0)) {
    p.vars.boon_trail_next = state.tick + 3;
    const P = MECHANIC_BY_ID.static_trail.params;
    const mine = state.hazards.filter((h) => h.kind === 'fate_trail' && h.ownerId === p.slot && h.untilTick > state.tick);
    if (mine.length >= 40) mine[0].untilTick = state.tick;
    state.hazards.push(makeHazard(state, {
      kind: 'fate_trail', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: P.radius,
      untilTick: state.tick + ticks(P.durationSec), nextTick: state.tick + 1, interval: ticks(P.pulseSec),
      damage: pd.damage.mul(pd.typeMult.storm).mul(trail), dtype: 'storm', generation: 1,
    }));
  }
  // Warding Rune
  const ward = mech(state, 'warding_rune');
  if (ward && state.tick >= (p.vars.boon_ward_next ?? 0)) {
    p.vars.boon_ward_next = state.tick + ticks(param('warding_rune', 'everySec'));
    shieldPlayer(state, ev, p, p.maxHp.mul(ward));
    cast(ev, p.slot, 'boon_warding_rune', p.x, p.y);
  }
  // Shadow Twin: the shade walks at your back (it strikes in hazardTick)
  if (mech(state, 'shadow_twin')) {
    const tx = p.x - p.aimX * 0.8 - p.aimY * 0.35, ty = p.y - p.aimY * 0.8 + p.aimX * 0.35;
    let shade = shadeOf(state, p);
    if (!shade) {
      shade = makeHazard(state, {
        kind: 'fate_shade', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 0.4, untilTick: state.tick + FOREVER,
        nextTick: state.tick + ticks(param('shadow_twin', 'strikeSec')), interval: ticks(param('shadow_twin', 'strikeSec')), damage: ZERO, dtype: 'astral', generation: 1,
      });
      state.hazards.push(shade);
    }
    shade.x += (tx - shade.x) * 0.25; shade.y += (ty - shade.y) * 0.25;
    shade.dx = p.aimX; shade.dy = p.aimY;
  }
  // Momentum: distance travelled charges the next hit (per-tick steps capped so blinks and teleports count as one stride)
  if (mech(state, 'momentum')) {
    const P = MECHANIC_BY_ID.momentum.params;
    if (p.vars.boon_mo_fx) { p.vars.boon_mo_fx = 0; cast(ev, p.slot, 'boon_momentum', p.vars.boon_mo_x ?? p.x, p.vars.boon_mo_y ?? p.y); }
    if (p.vars.boon_mo_init === 1 && (p.vars.boon_mo ?? 0) < P.chargeDist) {
      const d = Math.min(P.stepCap, Math.sqrt(dist2(p.x, p.y, p.vars.boon_mo_lx ?? p.x, p.vars.boon_mo_ly ?? p.y)));
      p.vars.boon_mo = Math.min(P.chargeDist, (p.vars.boon_mo ?? 0) + d);
      if (p.vars.boon_mo >= P.chargeDist) cast(ev, p.slot, 'boon_momentum_ready', p.x, p.y);
    }
    p.vars.boon_mo_init = 1; p.vars.boon_mo_lx = p.x; p.vars.boon_mo_ly = p.y;
  }
  // Mirror Ward: right after a dodge, nearby enemy projectiles turn on their sender
  const mirror = mech(state, 'mirror_ward');
  if (mirror && (p.vars.boon_mirror_until ?? 0) > state.tick) {
    const P = MECHANIC_BY_ID.mirror_ward.params;
    for (const pr of state.projectiles) {
      if (pr.owner !== 'enemy' || pr.lobTarget || dist2(pr.x, pr.y, p.x, p.y) > (P.radius + pr.radius) ** 2) continue;
      const src = state.enemies.find((x) => x.id === pr.ownerId && x.state !== 'dying' && !x.cohort.count.isZero());
      const [dx, dy] = src ? norm(src.x - pr.x, src.y - pr.y) : norm(-pr.vx, -pr.vy);
      const sp = Math.max(8, Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy));
      pr.owner = 'player'; pr.ownerId = p.slot;
      pr.vx = dx * sp; pr.vy = dy * sp; pr.range = P.range; pr.pierce = 0; pr.hitIds = [];
      pr.damage = pd.damage.mul(pd.typeMult[pr.dtype]).mul(mirror); pr.weight = ONE;
      pr.skillId = 'boon_mirror_ward'; pr.crit = false; delete pr.dot;
      cast(ev, p.slot, 'boon_mirror_ward', pr.x, pr.y, dx, dy);
    }
  }
  // Last Stand: announce crossing the line
  if (mech(state, 'last_stand')) {
    const low = lastStanding(state, p);
    if (low && !p.vars.boon_ls_on) cast(ev, p.slot, 'boon_last_stand', p.x, p.y);
    p.vars.boon_ls_on = low ? 1 : 0;
  }
}

function fixPhoenix(state: SimState, p: PlayerState) {
  const v = mech(state, 'phoenix');
  p.vars.boon_phoenix_fix = -1;
  if (v && p.lifeState === 'alive') p.hp = Big.min(p.maxHp, p.maxHp.mul(v));
}

/** Player-owned Fate hazards: pending Chain Reaction blasts and Static Trail segments. */
function hazardTick(state: SimState, ev: SimEvent[], h: Hazard): boolean | undefined {
  if (h.kind === 'fate_blast') {
    if (state.tick < h.nextTick) return true;
    h.nextTick = NEVER;
    h.untilTick = state.tick;   // consumed
    cast(ev, h.ownerId, 'boon_chain_reaction', h.x, h.y, h.radius, 0);
    areaHit(state, ev, h.x, h.y, h.radius, h.damage, { slot: h.ownerId, skillId: 'boon_chain_reaction', dtype: 'ember', generation: h.generation, crit: false });
    return true;
  }
  if (h.kind === 'fate_trail') {
    if (state.tick < h.nextTick) return true;
    h.nextTick = state.tick + Math.max(1, h.interval);
    areaHit(state, ev, h.x, h.y, h.radius, h.damage, { slot: h.ownerId, skillId: 'boon_static_trail', dtype: 'storm', generation: h.generation, crit: false });
    return true;
  }
  if (h.kind === 'fate_shade') {
    const v = mech(state, 'shadow_twin');
    if (!v) { h.untilTick = state.tick; return true; }
    if (state.tick < h.nextTick) return true;
    h.nextTick = state.tick + Math.max(1, h.interval);
    if (h.damage.isZero()) return true;
    const banked = h.damage;
    h.damage = ZERO;
    // the foe you last hit, else the nearest foe in reach of the shade; damage banked after armor is re-armored once
    let t = livingEnemies(state).find((e) => e.id === h.vars?.t);
    if (!t) t = nearestFoe(state, h.x, h.y, param('shadow_twin', 'range'));
    if (!t) return true;
    cast(ev, h.ownerId, 'boon_shadow_twin', h.x, h.y, t.x, t.y);
    const f = mitigationFactor(t.armor);
    hitEnemy(state, ev, t, banked.mul(v).div(f.isZero() ? ONE : f), ONE, { dtype: 'astral', srcSlot: h.ownerId, skillId: 'boon_shadow_twin', fromX: h.x, fromY: h.y, allowCrit: false, generation: 1 });
    return true;
  }
  if (h.kind === 'fate_thrall') {
    if (!mech(state, 'grave_thralls')) { h.untilTick = state.tick; return true; }
    const P = MECHANIC_BY_ID.grave_thralls.params;
    if (state.tick - h.bornTick < ticks(P.riseSec)) return true;     // clawing out of the ground
    const t = nearestFoe(state, h.x, h.y, 14);
    const owner = state.players[h.ownerId];
    const gx = t ? t.x : owner?.x ?? h.x, gy = t ? t.y : owner?.y ?? h.y;
    const d = Math.sqrt(dist2(h.x, h.y, gx, gy));
    const stop = t ? h.radius + t.radius * 0.8 : 1.5;
    if (d > 1e-6) {
      h.dx = (gx - h.x) / d; h.dy = (gy - h.y) / d;
      const mv = Math.min(P.speed * DT, Math.max(0, d - stop));
      h.x += h.dx * mv; h.y += h.dy * mv;
    }
    if (t && state.tick >= h.nextTick && dist2(h.x, h.y, t.x, t.y) <= (h.radius + t.radius + 0.2) ** 2) {
      h.nextTick = state.tick + Math.max(1, h.interval);
      hitEnemy(state, ev, t, h.damage, ONE, { dtype: 'physical', srcSlot: h.ownerId, skillId: 'boon_grave_thralls', fromX: h.x, fromY: h.y, allowCrit: true, generation: 1 });
    }
    return true;
  }
  return undefined;
}

/** Nearest living foe within `range` of a point (ties by id). */
function nearestFoe(state: SimState, x: number, y: number, range: number): EnemyState | undefined {
  let best: EnemyState | undefined; let bd = range * range;
  for (const e of livingEnemies(state)) {
    const d = dist2(e.x, e.y, x, y);
    if (d < bd || (d === bd && best && e.id < best.id)) { bd = d; best = e; }
  }
  return best;
}

// ---------------- Pandora ----------------

const PANDORA_IDS = new Set(['pandora', 'pandora_curse']);

/** The party can use a 'projectile' / 'skills' boon at all (Pandora never rolls a dead boon). */
function partyCanUse(state: SimState, def: MechanicDef): boolean {
  if (def.requires === 'skills') return state.players.some((p) => p.skills.some((s) => s.skillId && s.maxCharges > 0));
  if (def.requires === 'projectile') {
    return state.players.some((p) => [CLASS_BY_ID[p.classId]?.basicSkill, ...p.skills.map((s) => s.skillId)].some((id) => !!id && SKILL_BY_ID[id]?.shape.kind === 'projectile'));
  }
  return true;
}

/** One rolled copy: the weakest card magnitude scaled by Pandora's strength (chances capped below 1). */
export function pandoraMagnitude(def: MechanicDef, strength: number): string {
  const base = Number(MECHANIC_BASE_MAGNITUDE[def.id] ?? '0');
  let m = base * strength;
  if (def.stacking === 'chance') m = Math.min(param('pandora', 'chanceCap'), m);
  return String(+m.toFixed(6));
}

/** Persistent (card-bound) effective magnitude only: Pandora's own strength never comes from a roll. */
function boundNum(state: SimState, id: string): number {
  const s = state.fate.mechanics?.[id];
  if (!s || s.stacks <= 0) return 0;
  return Math.min(1e3, effectiveFromAcc(MECHANIC_BY_ID[id], s.acc).toNumber());
}

/** Round start: clear last round's rolls, then roll a boon (Pandora's Gift) and a bane (Pandora's Curse) for this round. */
export function rollPandora(state: SimState, ev: SimEvent[]) {
  delete state.fate.rolled;
  const gift = boundNum(state, 'pandora'), curse = boundNum(state, 'pandora_curse');
  if (gift <= 0 && curse <= 0) return;
  const rolled: Record<string, Big> = {};
  const roll = (kind: 'boon' | 'bane', strength: number): number => {
    if (strength <= 0) return -1;
    const pool = MECHANICS.filter((m) => m.kind === kind && !PANDORA_IDS.has(m.id) && MECHANIC_BASE_MAGNITUDE[m.id] && partyCanUse(state, m));
    if (!pool.length) return -1;
    const def = pool[Math.min(pool.length - 1, Math.floor(nextFloat(state.rng.combat) * pool.length))];
    rolled[def.id] = perCopyFactor(def, pandoraMagnitude(def, strength));
    return MECHANICS.indexOf(def);
  };
  const bi = roll('boon', gift), ci = roll('bane', curse);
  if (Object.keys(rolled).length) state.fate.rolled = rolled;
  for (const p of state.players) if (p.lifeState === 'alive') cast(ev, p.slot, 'boon_pandora', p.x, p.y, bi, ci);
}

function onRoundStart(state: SimState, ev: SimEvent[]) {
  for (const p of state.players) {
    p.vars.boon_ward_next = state.tick + 60;
    p.vars.boon_rush_until = 0;
    p.vars.boon_trail_until = 0;
    p.vars.bane_brittle_until = 0;
    p.vars.boon_thunder = 0;
    p.vars.boon_mo = 0; p.vars.boon_mo_init = 0; p.vars.boon_mo_fx = 0;
    p.vars.boon_mirror_until = 0;
    p.vars.boon_ls_on = 0;
    p.vars.boon_grav_next = 0;
    p.vars.boon_thrall_kills = 0;
    p.vars.bane_gh_t = -1;
  }
  rollPandora(state, ev);
}

/** Global combat tick: banes (pools, curse circles, the Reaper, Blood Moon, enrage) and the Phoenix fix-up. */
function onTick(state: SimState, ev: SimEvent[]) {
  if (!anyBound(state)) return;
  const enc = state.encounter;
  for (const p of state.players) if (p.vars.boon_phoenix_fix === state.tick) fixPhoenix(state, p);
  if (!enc || !state.map) return;
  const t = enc.activeTicks;

  // Blood Moon: every period all foes deal (1 + v)× more, compounding; late spawns catch up to the current level
  const moon = mech(state, 'blood_moon');
  if (moon) {
    const period = ticks(param('blood_moon', 'everySec'));
    const level = Math.floor(t / period);
    if (level > 0 && t % period === 0) cast(ev, -1, 'bane_blood_moon', state.map.w / 2, state.map.h / 2, level, 0);
    if (level > 0) {
      const f = ONE.add(moon);
      for (const e of state.enemies) {
        if (e.state === 'dying') continue;
        const applied = e.fateVars?.moon ?? 0;
        if (applied >= level) continue;
        e.damage = e.damage.mul(f.powInt(level - applied));
        fv(e).moon = level;
      }
    }
  }

  // Relentless: enrage below the threshold (checked every 6 ticks)
  const rage = mech(state, 'relentless');
  if (rage && state.tick % 6 === 0) {
    const th = param('relentless', 'threshold');
    const f = ONE.add(rage);
    const fn = Math.min(1e6, f.log10() > 6 ? 1e6 : f.toNumber());
    for (const e of state.enemies) {
      if (e.state === 'dying' || e.cohort.count.isZero() || e.fateVars?.enraged) continue;
      if (thresholdFrac(e) >= th) continue;
      fv(e).enraged = 1;
      e.attackFreq = e.attackFreq.mul(f);
      e.moveSpeed = Math.min(1e7, e.moveSpeed * fn);
      cast(ev, -1, 'bane_relentless', e.x, e.y, e.id, 0);
    }
  }

  // Hexed Ground: a telegraphed curse circle beneath every hero each period
  if (mech(state, 'hexed_ground')) {
    const P = MECHANIC_BY_ID.hexed_ground.params;
    const period = ticks(P.everySec);
    if (t % period === Math.floor(period / 2)) {
      for (const p of state.players) {
        if (p.lifeState !== 'alive') continue;
        const ang = nextFloat(state.rng.combat) * Math.PI * 2;
        const rr = nextFloat(state.rng.combat) * 1.2;
        const [x, y] = nearestFloor(state.map, p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr);
        const arm = ticks(P.armSec);
        state.hazards.push(makeHazard(state, { kind: 'fate_hex', owner: 'enemy', ownerId: -1, x, y, radius: P.radius, untilTick: state.tick + arm + 12, nextTick: NEVER, interval: NEVER, damage: ZERO, dtype: 'astral' }));
        state.telegraphs.push({ id: state.nextId++, ownerId: -1, shape: { kind: 'circle', radius: P.radius }, x, y, dx: 1, dy: 0, startTick: state.tick, releaseTick: state.tick + arm, attack: 'Hexed Ground' });
      }
    }
  }

  // The Hunt: the Reaper rises once per round
  const hunt = mech(state, 'the_hunt');
  if (hunt && t === ticks(param('the_hunt', 'delaySec')) && !state.hazards.some((h) => h.kind === 'fate_reaper')) {
    const alive = state.players.filter((p) => p.lifeState === 'alive');
    const cx = alive.length ? alive.reduce((s, p) => s + p.x, 0) / alive.length : state.map.w / 2;
    const cy = alive.length ? alive.reduce((s, p) => s + p.y, 0) / alive.length : state.map.h / 2;
    let best = state.map.enemySpawns[0] ?? { x: state.map.w / 2, y: state.map.h / 2 };
    for (const s of state.map.enemySpawns) if (dist2(s.x, s.y, cx, cy) > dist2(best.x, best.y, cx, cy)) best = s;
    state.hazards.push(makeHazard(state, { kind: 'fate_reaper', owner: 'enemy', ownerId: -1, x: best.x, y: best.y, radius: param('the_hunt', 'radius'), untilTick: state.tick + 60 * 60 * 60 * 24, nextTick: NEVER, interval: NEVER, damage: ZERO, dtype: 'decay' }));
    cast(ev, -1, 'bane_the_hunt', best.x, best.y);
  }

  // Grave Hands: a hero lingering within the leash of one spot is seized after the grace (only while foes are awake)
  const hands = mech(state, 'grave_hands');
  if (hands) {
    const P = MECHANIC_BY_ID.grave_hands.params;
    const grace = ticks(P.graceSec), claw = ticks(P.clawSec), warn = Math.min(grace, ticks(GRASP_WARN_SEC));
    const awake = state.enemies.some((e) => e.state !== 'dying' && !e.cohort.count.isZero() && !e.dormant);
    for (const p of state.players) {
      const ax = p.vars.bane_gh_x ?? p.x, ay = p.vars.bane_gh_y ?? p.y;
      if (!awake || p.lifeState !== 'alive' || (p.vars.bane_gh_t ?? -1) < 0 || dist2(p.x, p.y, ax, ay) > P.leash * P.leash) {
        p.vars.bane_gh_t = state.tick; p.vars.bane_gh_x = p.x; p.vars.bane_gh_y = p.y;
        for (const h of state.hazards) if (h.kind === 'fate_grasp' && h.vars?.slot === p.slot && h.untilTick > state.tick) h.untilTick = state.tick;
        continue;
      }
      const held = state.tick - p.vars.bane_gh_t;
      if (held === grace - warn) {
        state.hazards.push(makeHazard(state, { kind: 'fate_grasp', owner: 'enemy', ownerId: -1, x: ax, y: ay, radius: P.leash + 0.3, untilTick: state.tick + FOREVER, nextTick: NEVER, interval: NEVER, damage: ZERO, dtype: 'decay', vars: { slot: p.slot } }));
      }
      if (held >= grace && (held - grace) % claw === 0) {
        cast(ev, -1, 'bane_grave_hands', p.x, p.y);
        curseHit(state, ev, p, hands, 'Grave Hands', ax, ay, 'decay');
      }
    }
  }

  // Shadow Pact: every champion and rare rolls once for a shadow twin, linked to it (it fades when the elite dies)
  const pact = mechNum(state, 'shadow_pact', 1);
  if (pact > 0) {
    const P = MECHANIC_BY_ID.shadow_pact.params;
    for (const e of [...state.enemies]) {
      if (!e.elite || e.boss || e.mini || e.state === 'dying' || e.cohort.count.isZero() || e.fateVars?.pact) continue;
      fv(e).pact = 1;
      if (nextFloat(state.rng.combat) >= pact) continue;
      const [x, y] = nearestFloor(state.map, e.x - e.fx * 1.4, e.y - e.fy * 1.4);
      const twin = createEnemy(state, e.kind, x, y, ONE, { objective: false, groupId: e.groupId, summonerId: e.id });
      twin.cohort.unitHp = e.cohort.unitHp.mul(B(P.health));
      twin.damage = e.damage.mul(B(P.damage));
      const tv = fv(twin);
      tv.pact = 1;
      if (e.fateVars?.moon) tv.moon = e.fateVars.moon;   // the elite's Blood Moon level is already in its damage
      if (e.pack !== undefined) twin.pack = e.pack;
      if (e.dormant) twin.dormant = true;
      state.enemies.push(twin);
      ev.push({ t: 'spawn', id: twin.id, kind: twin.kind, x, y });
      cast(ev, -1, 'bane_shadow_pact', x, y, e.x, e.y);
    }
  }

  // Enemy-owned bane hazards (timing derived from bornTick; stepEnemyHazard never pulses them)
  for (const h of state.hazards) {
    if (h.owner !== 'enemy' || h.untilTick <= state.tick) continue;
    if (h.kind === 'fate_pyre') {
      const v = mech(state, 'volatile_dead');
      if (!v) continue;
      const arm = ticks(param('volatile_dead', 'armSec'));
      const age = state.tick - h.bornTick;
      if (age < arm || (age - arm) % Math.max(1, h.interval) !== 0) continue;
      for (const p of nearHero(state, h.x, h.y, h.radius)) curseHit(state, ev, p, v, 'Volatile Dead', h.x, h.y, 'ember');
    } else if (h.kind === 'fate_hex') {
      const v = mech(state, 'hexed_ground');
      if (!v) continue;
      if (state.tick - h.bornTick !== ticks(param('hexed_ground', 'armSec'))) continue;
      cast(ev, -1, 'bane_hexed_ground', h.x, h.y, h.radius, 0);
      for (const p of nearHero(state, h.x, h.y, h.radius)) curseHit(state, ev, p, v, 'Hexed Ground', h.x, h.y, 'astral');
    } else if (h.kind === 'fate_reaper') {
      const v = mech(state, 'the_hunt');
      if (!v) continue;
      let target: PlayerState | null = null; let bd = Infinity;
      for (const p of state.players) {
        if (p.lifeState !== 'alive') continue;
        const d = dist2(p.x, p.y, h.x, h.y);
        if (d < bd || (d === bd && target && p.slot < target.slot)) { bd = d; target = p; }
      }
      if (!target) continue;
      const d = Math.sqrt(bd);
      const step = param('the_hunt', 'speed') * DT;
      if (d > 1e-6) {
        h.dx = (target.x - h.x) / d; h.dy = (target.y - h.y) / d;
        const mv = Math.min(step, Math.max(0, d - 0.2));
        h.x += h.dx * mv; h.y += h.dy * mv;
      }
      const cd = ticks(param('the_hunt', 'strikeSec'));
      for (const p of nearHero(state, h.x, h.y, h.radius)) {
        if (p.iframes > 0 || state.tick - (p.vars.bane_reaper_last ?? -NEVER) < cd) continue;
        p.vars.bane_reaper_last = state.tick;
        curseHit(state, ev, p, v, 'The Reaper', h.x, h.y, 'decay');
      }
    } else if (h.kind === 'fate_wisp') {
      if (!mech(state, 'restless_dead')) { h.untilTick = state.tick; continue; }
      const P = MECHANIC_BY_ID.restless_dead.params;
      if (state.tick - h.bornTick < ticks(P.riseSec)) continue;
      let target: PlayerState | null = null; let bd = Infinity;
      for (const p of state.players) {
        if (p.lifeState !== 'alive') continue;
        const d = dist2(p.x, p.y, h.x, h.y);
        if (d < bd) { bd = d; target = p; }
      }
      if (!target) continue;
      const d = Math.sqrt(bd);
      if (d > 1e-6) {
        h.dx = (target.x - h.x) / d; h.dy = (target.y - h.y) / d;
        const mv = Math.min(P.speed * DT, d);
        h.x += h.dx * mv; h.y += h.dy * mv;
      }
      const victim = nearHero(state, h.x, h.y, h.radius).find((p) => p.iframes <= 0);   // a dodge slips through
      if (victim) {
        h.untilTick = state.tick;
        cast(ev, -1, 'bane_wisp_burst', h.x, h.y);
        curseHit(state, ev, victim, B(P.damage), 'Restless Dead', h.x, h.y, 'astral');
      }
    }
  }
}

export const BOON_HOOKS: SimHooks = { onEnemyHit, onKill, onPlayerDamaged, onDodge, onCast, onPlayerTick, hazardTick, onRoundStart, onTick, modifyHit };
registerGlobalHooks(BOON_HOOKS);
