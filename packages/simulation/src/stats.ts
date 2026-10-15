import { Big } from '@cursebound/numeric';
import { CLASS_BY_ID, GEAR_SLOTS, LEGENDARY_BY_ID, NODE_BY_ID, RULES, SKILL_BY_ID, type DamageType } from '@cursebound/content';
import type { PlayerState, SimState } from './types';

// Stat pipeline (PRD §8.2): base -> tree and mastery -> persistent Fate factors -> temporary factors
// -> conversions -> damage event resolution. Independent multiplicative modifiers are never collapsed
// into an additive percentage.

export const ONE = Big.ONE;
const bigCache = new Map<string, Big>();
export function B(x: string | number): Big {
  const k = String(x);
  let v = bigCache.get(k);
  if (!v) { v = Big.from(x); bigCache.set(k, v); }
  return v;
}

export function fateFactor(state: SimState, stat: string): Big {
  return state.fate.factors[stat] ?? ONE;
}

export interface Breakdown {
  stat: string;
  base: Big;
  tree: Big;
  mastery: Big;
  fate: Big;
  /** Legendary gear: equipped items' modifiers × live perk factors (gear.ts). */
  gear: Big;
  result: Big;
  treeSources: { node: string; rank: number; factor: string }[];
  gearSources: { item: string; factor: string }[];
  /** Altar pacts and merchant run boons (roomEvents.ts): personal permanent factors after Fate (ONE when none). */
  pact: Big;
  pactSources: { id: string; src: string; factor: string }[];
}

export function playerBase(p: PlayerState, stat: string): Big {
  const cls = CLASS_BY_ID[p.classId];
  switch (stat) {
    case 'player.damage': return B(cls.base.damage);
    case 'player.maxHealth': return B(cls.base.maxHealth);
    case 'player.attackFrequency': return B(cls.base.attackFrequency);
    case 'player.critTendency': return B(cls.base.critTendency);
    case 'player.critPotency': return B(cls.base.critMultiplier);
    case 'player.movementSpeed': return B(cls.base.moveSpeed);
    case 'player.shieldCapacity': return B(cls.base.shieldCapacity);
    case 'player.armor': return B(cls.base.armor);
    case 'player.guardHeal': return B('0.04');
    case 'player.dodgeHeal': return B('0.03');
    default: return ONE;
  }
}

export function treeFactor(p: PlayerState, stat: string): { factor: Big; sources: Breakdown['treeSources'] } {
  let factor = ONE;
  const sources: Breakdown['treeSources'] = [];
  for (const nodeId of Object.keys(p.ranks).sort()) {
    const rank = p.ranks[nodeId];
    if (!rank) continue;
    const node = NODE_BY_ID[nodeId];
    if (!node) continue;
    for (const m of node.modifiers) {
      if (m.stat !== stat) continue;
      factor = factor.mul(B(m.factorPerRank).powInt(rank));
      sources.push({ node: nodeId, rank, factor: m.factorPerRank });
    }
  }
  return { factor, sources };
}

export function masteryFactor(p: PlayerState, stat: string): Big {
  const f = B(RULES.masteryFactor);
  if (stat === 'player.skillDamage' && p.mastery.damage) return f.powInt(p.mastery.damage);
  if (stat === 'player.maxHealth' && p.mastery.health) return f.powInt(p.mastery.health);
  if (stat === 'player.recoveryRate' && p.mastery.recovery) return f.powInt(p.mastery.recovery);
  return ONE;
}

/** Live (perk-driven) gear factors registered by gear.ts: return null when the perk does not touch `stat`. */
export type GearDynamicFactor = (p: PlayerState, stat: string) => { item: string; factor: Big } | null;
const gearDynamics: GearDynamicFactor[] = [];
export function registerGearDynamicFactor(fn: GearDynamicFactor) { if (!gearDynamics.includes(fn)) gearDynamics.push(fn); }

/** Legendary gear factor for a stat: each equipped item's modifier applies once (×factor), then live perk factors. */
export function gearFactor(p: PlayerState, stat: string): { factor: Big; sources: Breakdown['gearSources'] } {
  let factor = ONE;
  const sources: Breakdown['gearSources'] = [];
  const gear = p.gear;
  if (gear) {
    for (const slot of GEAR_SLOTS) {
      const id = gear[slot];
      const def = id ? LEGENDARY_BY_ID[id] : undefined;
      if (!def) continue;
      for (const m of def.modifiers) {
        if (m.stat !== stat) continue;
        factor = factor.mul(B(m.factorPerRank));
        sources.push({ item: def.id, factor: m.factorPerRank });
      }
    }
    for (const fn of gearDynamics) {
      const d = fn(p, stat);
      if (d && !d.factor.eq(ONE)) { factor = factor.mul(d.factor); sources.push({ item: d.item, factor: d.factor.toString() }); }
    }
  }
  return { factor, sources };
}

/** Room events (roomEvents.ts): a hero's altar pacts and merchant run boons for a stat (each record applies once). */
export function pactFactor(p: PlayerState, stat: string): { factor: Big; sources: Breakdown['pactSources'] } {
  let factor = ONE;
  const sources: Breakdown['pactSources'] = [];
  for (const r of p.pacts ?? []) for (const m of r.mods) {
    if (m.stat !== stat) continue;
    factor = factor.mul(B(m.factor));
    sources.push({ id: r.id, src: r.src, factor: m.factor });
  }
  return { factor, sources };
}

export function breakdown(state: SimState, p: PlayerState, stat: string, fateOverride?: Record<string, Big>): Breakdown {
  const base = playerBase(p, stat);
  const t = treeFactor(p, stat);
  const mastery = masteryFactor(p, stat);
  const g = gearFactor(p, stat);
  const fate = fateOverride ? (fateOverride[stat] ?? ONE) : fateFactor(state, stat);
  const pc = pactFactor(p, stat);   // room events: altar pacts / merchant boons (no records = untouched result)
  const result = base.mul(t.factor).mul(mastery).mul(g.factor).mul(fate);
  return { stat, base, tree: t.factor, mastery, fate, gear: g.factor, result: pc.sources.length ? result.mul(pc.factor) : result, treeSources: t.sources, gearSources: g.sources, pact: pc.factor, pactSources: pc.sources };
}

export interface PlayerDerived {
  maxHp: Big;
  armor: Big;
  incomingFactor: Big;
  damage: Big;                       // base hit damage including player.damage and mastery skill damage
  typeMult: Record<DamageType, Big>;
  attackFreq: Big;
  critC: Big;
  critQ: number;
  critMult: Big;
  recovery: Big;
  projectileCount: Big;
  moveSpeed: Big;
  shieldCapFrac: Big;
  healing: Big;
  burnRate: Big;
  reviveSpeed: number;
  guardHeal: Big;
  dodgeHeal: Big;
}

export function derivePlayer(state: SimState, p: PlayerState, fateOverride?: Record<string, Big>): PlayerDerived {
  const r = (stat: string) => breakdown(state, p, stat, fateOverride).result;
  const armor = r('player.armor');
  const K = B(RULES.armorK);
  const critC = r('player.critTendency');
  const critQ = critC.div(critC.add(ONE)).toNumber();
  return {
    maxHp: r('player.maxHealth'),
    armor,
    // armor K/(K+A); melee classes also take Close Quarters (RULES.meleeDamageTakenMult)
    incomingFactor: CLASS_BY_ID[p.classId]?.melee ? K.div(K.add(armor)).mul(B(RULES.meleeDamageTakenMult)) : K.div(K.add(armor)),
    damage: r('player.damage').mul(r('player.skillDamage')),
    typeMult: {
      physical: r('player.physicalDamage'),
      ember: r('player.emberDamage'),
      frost: r('player.frostDamage'),
      storm: r('player.stormDamage'),
      decay: r('player.decayDamage'),
      astral: r('player.astralDamage'),
    },
    attackFreq: r('player.attackFrequency'),
    critC,
    critQ,
    critMult: r('player.critPotency'),
    recovery: r('player.recoveryRate'),
    projectileCount: r('player.projectileCount'),
    moveSpeed: r('player.movementSpeed').mul(B(RULES.playerMoveSpeedMult)),   // global hero speed (dodge distance unaffected)
    shieldCapFrac: r('player.shieldCapacity'),
    healing: r('player.healing'),
    burnRate: r('player.burnRate'),
    reviveSpeed: Math.min(1e9, r('player.reviveSpeed').toNumber()),
    guardHeal: r('player.guardHeal'),
    dodgeHeal: r('player.dodgeHeal'),
  };
}

/** Per-tick cache of derived player stats; invalidated by stateVersion changes (Fate commits, allocations, equips)
 *  and by the per-player live gear version p.vars['lg.dv'] (perk stacks that change stats mid-combat). */
const derivedCache = new WeakMap<PlayerState, { version: number; dyn: number; d: PlayerDerived }>();
export function playerDerived(state: SimState, p: PlayerState): PlayerDerived {
  const c = derivedCache.get(p);
  const dyn = p.vars?.['lg.dv'] ?? 0;
  if (c && c.version === state.stateVersion && c.dyn === dyn) return c.d;
  const d = derivePlayer(state, p);
  derivedCache.set(p, { version: state.stateVersion, dyn, d });
  return d;
}

export function skillCoef(p: PlayerState, skillId: string): Big {
  const skill = SKILL_BY_ID[skillId];
  let coef = B(skill.damageCoef);
  const t = treeFactor(p, `skill.${skillId}.damage`);
  coef = coef.mul(t.factor);
  if (p.gear) coef = coef.mul(gearFactor(p, `skill.${skillId}.damage`).factor);   // legendary skill modifiers and sigils
  return coef;
}

/** Damage of one hit before crit, vulnerability and target mitigation (snapshotted at attack creation). */
export function hitDamage(state: SimState, p: PlayerState, skillId: string, dtype: DamageType): Big {
  const d = playerDerived(state, p);
  return d.damage.mul(skillCoef(p, skillId)).mul(d.typeMult[dtype]);
}

// ---------------- Enemy scaling (PRD §11.1, §4.1) ----------------

const healthScaleCache = new Map<number, Big>();
const damageScaleCache = new Map<number, Big>();
export function healthScale(r: number): Big {
  let v = healthScaleCache.get(r);
  if (!v) { v = B(RULES.enemyHealthGrowth).powInt(Math.max(0, r - 1)).mul(B(RULES.lateHealthGrowth).powInt(Math.max(0, r - RULES.lateRampFrom))); healthScaleCache.set(r, v); }   // ramp past lateRampFrom
  return v;
}
export function damageScale(r: number): Big {
  let v = damageScaleCache.get(r);
  if (!v) { v = B(RULES.enemyDamageGrowth).powInt(Math.max(0, r - 1)).mul(B(RULES.lateDamageGrowth).powInt(Math.max(0, r - RULES.lateRampFrom))); damageScaleCache.set(r, v); }
  return v;
}
export function partyHealthMult(n: number): Big {
  return ONE.add(B(RULES.partyHealthCoef).mul(B(n - 1)));
}
export function partyBudgetMult(n: number): Big {
  return ONE.add(B(RULES.partyBudgetCoef).mul(B(n - 1)));
}

export function enemyUnitHealth(state: SimState, baseHealth: number, round: number, bossFactor: number, fateOverride?: Record<string, Big>): Big {
  const m = fateOverride ? (fateOverride['enemy.maxHealth'] ?? ONE) : fateFactor(state, 'enemy.maxHealth');
  return B(baseHealth).mul(healthScale(round)).mul(partyHealthMult(state.n)).mul(B(bossFactor)).mul(m);
}

export function enemyDamage(state: SimState, baseDamage: number, round: number, fateOverride?: Record<string, Big>): Big {
  const m = fateOverride ? (fateOverride['enemy.damage'] ?? ONE) : fateFactor(state, 'enemy.damage');
  return B(baseDamage).mul(damageScale(round)).mul(m);
}

export function f(state: SimState, stat: string, fateOverride?: Record<string, Big>): Big {
  return fateOverride ? (fateOverride[stat] ?? ONE) : fateFactor(state, stat);
}

/** Convert a Big to a float clamped into [0, max] (for velocities and display ratios only). */
export function toFloatClamped(x: Big, max: number): number {
  if (x.isZero()) return 0;
  if (x.log10() > Math.log10(max)) return max;
  return Math.min(max, x.toNumber());
}
