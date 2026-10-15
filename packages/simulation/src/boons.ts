import { Big, formatBig } from '@cursebound/numeric';
import {
  BOSS_BY_ID, DODGE, ENEMY_BY_ID, MECHANIC_BY_ID, RULES, SKILL_BY_ID, TICK_SEC,
  type MechanicDef,
} from '@cursebound/content';
import { cohortHpFrac, cohortRadius, healPlayer, hitEnemy, hitPlayer, killEnemy, shieldPlayer } from './combat';
import { dist2 } from './geometry';
import { registerGlobalHooks, type EnemyHitInfo, type PlayerDamagedInfo, type SimHooks } from './hooks';
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

const DT = TICK_SEC;
const DT_B = B(TICK_SEC);
const ZERO = Big.ZERO;
const NEVER = Number.MAX_SAFE_INTEGER;   // enemy bane hazards: stepEnemyHazard never pulses them; onTick owns timing

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

/** Effective magnitude of a bound mechanic, or null when no copy is bound. */
export function mech(state: SimState, id: string): Big | null {
  const s = state.fate.mechanics?.[id];
  if (!s || s.stacks <= 0) return null;
  return effectiveFromAcc(MECHANIC_BY_ID[id], s.acc);
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

function areaHit(state: SimState, ev: SimEvent[], x: number, y: number, R: number, perHit: Big, o: { slot: number; skillId: string; dtype: 'ember' | 'storm' | 'physical'; generation: number; crit: boolean }) {
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
}

function onCast(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string) {
  const echo = mechNum(state, 'echo', 1);
  if (echo <= 0) return;
  if (nextFloat(state.rng.combat) >= echo) return;
  const s = p.skills.find((x) => x.skillId === skillId);
  if (!s || s.maxCharges <= 0 || s.charges >= s.maxCharges) return;
  s.charges++;
  if (s.charges >= s.maxCharges) s.cooldown = 0;
  cast(ev, p.slot, 'boon_echo', p.x, p.y);
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
  return undefined;
}

function onRoundStart(state: SimState, _ev: SimEvent[]) {
  for (const p of state.players) {
    p.vars.boon_ward_next = state.tick + 60;
    p.vars.boon_rush_until = 0;
    p.vars.boon_trail_until = 0;
    p.vars.bane_brittle_until = 0;
    p.vars.boon_thunder = 0;
  }
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
    }
  }
}

export const BOON_HOOKS: SimHooks = { onEnemyHit, onKill, onPlayerDamaged, onDodge, onCast, onPlayerTick, hazardTick, onRoundStart, onTick };
registerGlobalHooks(BOON_HOOKS);
