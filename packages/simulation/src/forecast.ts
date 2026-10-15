import { Big, formatBig, percentToFactor } from '@cursebound/numeric';
import {
  BOSS_BY_ID, CLASS_BY_ID, ENEMY_BY_ID, MECHANICS, MECHANIC_BY_ID, NODES, NODE_BY_ID, RULES, SKILLS, SKILL_BY_ID, STATS, STAT_BY_ID,
  basePoints, cardById, cardMechanics, cardRarity, cardStatEffects, isBossRound, mechanicText, referenceSec,
  type CardDef, type CardRarity, type LedgerGroup, type MechanicDef, type SkillDef,
} from '@cursebound/content';
import { effectiveFromAcc, formatMechanicValue, perCopyFactor } from './boons';
import { nextInt, seedRng } from './rng';
import { expectedFoeCount } from './director';
import { B, ONE, breakdown, derivePlayer, enemyDamage, enemyUnitHealth, f, type PlayerDerived } from './stats';
import type { PlayerState, SimState } from './types';

// Fate Ledger and Forecast (REQ LEDGER01, PRD §10). Static results are exact calculations from the immutable
// pre-choice snapshot; estimates are labelled with their sample, assumptions and model. Never recommends a card,
// never disables a selection.

export type ValueKind = 'static' | 'measured' | 'estimate';

export interface FValue { before: string; after: string; kind: ValueKind }   // Big compact strings ('' when n/a)

export interface PlayerForecast {
  slot: number;
  name: string;
  classId: string;
  maxHp: FValue;
  hp: FValue;
  hitDamage: FValue;
  attackFreq: FValue;
  critChance: { before: number; after: number };
  expectedHit: FValue;
  rawDps: FValue;
  armor: FValue;
  incomingHit: FValue;
  hitsToDown: FValue;
  survivalSec: FValue;
  healing: FValue;
  moveSpeed: FValue;
  cooldownSec: FValue;      // signature cooldown
  recoveryRate: FValue;     // cooldown recovery multiplier
  measuredDps: { value: string; sampleSec: number } | null;
  estimatedDps: FValue | null;
  warnings: string[];
}

export interface StatSideForecast { stat: string; name: string; percent: string; factor: string; applicable: boolean; applicability: string }

/** A boon or bane on an offered card: what it does now vs after binding, in plain numbers. */
export interface MechanicForecast {
  id: string;
  name: string;
  kind: 'boon' | 'bane';
  side: 'gift' | 'price';
  color: string;
  /** this card's per-copy magnitude (decimal string) */
  magnitude: string;
  stacks: { before: number; after: number };
  /** formatted effective magnitude ('25%', '×3'); before is null when not bound yet */
  value: { before: string | null; after: string };
  /** effective magnitude as Big compact strings ('' when not bound) */
  raw: { before: string; after: string };
  /** one-line chip text with the after value */
  short: string;
  /** full rules text with the after value */
  text: string;
  /** 'New rule' or 'Stronger: 25% → 56.25% (2 copies)' */
  change: string;
  /** how copies combine, in plain language */
  stacking: string;
  /** computed numbers for the current party (exact static from the snapshot) */
  details: string[];
  /** dangers this binding creates (also listed in the card warnings) */
  warnings: string[];
  applicable: boolean;
  applicability: string;
}

export interface CardForecast {
  cardId: string;
  slot: number;
  rarity: CardRarity;
  /** stat gift (null on mechanic-only gifts) */
  positive: StatSideForecast | null;
  /** stat price (null on mechanic-only prices) */
  negative: StatSideForecast | null;
  mechanics: MechanicForecast[];
  factorChanges: { stat: string; name: string; before: string; after: string }[];
  players: PlayerForecast[];
  enemy: {
    reference: string;           // reference target description
    health: FValue;
    regenPerSec: FValue;
    armorFactor: FValue;
    incomingHitRaw: FValue;
    logicalCount: FValue;
    telegraphSec: FValue;
    netPartyDps: FValue;
    killTimeSec: FValue;
    noNetProgress: { before: boolean; after: boolean };
  };
  score: { nextRoundPoints: FValue; pressure: FValue };
  consequence: string;
  warnings: string[];
  assumptions: string[];
}

export interface OfferForecast {
  offerId: string;
  round: number;
  snapshotHash: string;
  stateVersion: number;
  nextRound: number;
  nextIsBoss: boolean;
  cards: CardForecast[];
  modelVersion: string;
}

export const FORECAST_MODEL_VERSION = 'forecast-1.0.0';

const S = (b: Big) => b.toCompact();
const fv = (a: Big, b: Big, kind: ValueKind = 'static'): FValue => ({ before: S(a), after: S(b), kind });

export function factorsWithCard(state: SimState, card: CardDef): Record<string, Big> {
  const out: Record<string, Big> = { ...state.fate.factors };
  for (const { effect: eff } of cardStatEffects(card)) out[eff.stat] = (out[eff.stat] ?? ONE).mul(percentToFactor(eff.percent));
  return out;
}

export function nextBossId(state: SimState, r: number): string | null {
  if (!isBossRound(r)) return null;
  const rng = seedRng(state.seed, 'encounter', r);
  const bosses = ['prismstag', 'bellroot'];
  const idx = Math.floor(r / RULES.bossEvery) - 1;
  return bosses[(idx + nextInt(rng, 2)) % bosses.length];
}

function basicDps(state: SimState, p: PlayerState, d: PlayerDerived): { hit: Big; expected: Big; dps: Big } {
  const cls = CLASS_BY_ID[p.classId];
  const skill = SKILL_BY_ID[cls.basicSkill];
  const coef = B(skill.damageCoef);
  const hit = d.damage.mul(coef).mul(d.typeMult[skill.damageType]);
  // E[hit] = D × ((1−q) + q × critMultiplier)
  const q = d.critC.div(d.critC.add(ONE));
  const expected = hit.mul(ONE.sub(q).add(q.mul(d.critMult)));
  let dps = expected.mul(d.attackFreq);
  if (skill.shape.kind === 'projectile') dps = dps.mul(d.projectileCount);
  // burn adds fraction × duration of hit damage (ember only)
  if (skill.dot && skill.dot.type === 'ember') dps = dps.mul(ONE.add(B(skill.dot.fractionPerSec).mul(B(skill.dot.durationSec)).mul(d.burnRate)));
  return { hit, expected, dps };
}

// ---------------- Generic applicability (works for any class: skills, shapes and owned nodes) ----------------

/** Skills a player can currently use: basic, signature, equipped actives, node grants, and sub-skills attributed
 *  to an owned node through their icon (e.g. a wave projected by a capstone). */
export function availableSkills(p: PlayerState): SkillDef[] {
  const cls = CLASS_BY_ID[p.classId];
  const ids = new Set<string>();
  if (cls) { ids.add(cls.basicSkill); ids.add(cls.signatureSkill); }
  for (const s of p.skills) if (s.skillId) ids.add(s.skillId);
  for (const [nodeId, rank] of Object.entries(p.ranks)) {
    const g = rank > 0 ? NODE_BY_ID[nodeId]?.grantsSkill : undefined;
    if (g) ids.add(g);
  }
  for (const s of SKILLS) {
    if (s.classId !== p.classId || ids.has(s.id) || NODES.some((n) => n.grantsSkill === s.id)) continue;
    const src = s.icon.startsWith('node:') ? s.icon.slice(5) : '';
    if (src && (p.ranks[src] ?? 0) > 0) ids.add(s.id);
  }
  return [...ids].map((id) => SKILL_BY_ID[id]).filter((s): s is SkillDef => !!s);
}

export function firesProjectiles(p: PlayerState): boolean {
  return availableSkills(p).some((s) => s.shape.kind === 'projectile');
}

export function dealsDamageType(p: PlayerState, type: string): boolean {
  return availableSkills(p).some((s) => s.damageType === type || s.dot?.type === type);
}

export function generatesShields(state: SimState, p: PlayerState, mechanics?: Record<string, { stacks: number }>): boolean {
  const m = mechanics ?? state.fate.mechanics;
  if ((m?.warding_rune?.stacks ?? 0) > 0) return true;
  if (availableSkills(p).some((s) => s.shape.kind === 'guard' || /\bshields?\b/i.test(s.description))) return true;
  return Object.entries(p.ranks).some(([id, r]) => r > 0 && /\bshields?\b/i.test(NODE_BY_ID[id]?.description ?? ''));
}

function applicabilityFor(state: SimState, stat: string, mechanics?: Record<string, { stacks: number }>): { applicable: boolean; text: string } {
  const def = STAT_BY_ID[stat];
  if (stat === 'player.decayDamage') {
    const any = state.players.some((p) => dealsDamageType(p, 'decay'));
    return { applicable: any, text: any ? def.applicability : 'No party member deals decay damage: this effect is currently zero.' };
  }
  if (stat === 'player.projectileCount') {
    const any = state.players.some(firesProjectiles);
    return { applicable: any, text: any ? def.applicability : 'No party member fires projectiles yet: this effect is currently zero.' };
  }
  if (stat === 'player.shieldCapacity') {
    const any = state.players.some((p) => generatesShields(state, p, mechanics));
    return { applicable: any, text: any ? def.applicability : 'No party member generates shields yet: currently zero.' };
  }
  return { applicable: true, text: def?.applicability ?? '' };
}

function mechanicApplicability(state: SimState, def: MechanicDef): { applicable: boolean; text: string } {
  if (def.requires === 'projectile') {
    const any = state.players.some(firesProjectiles);
    return { applicable: any, text: any ? def.applicability : 'No party member fires projectiles yet: this boon currently does nothing.' };
  }
  if (def.requires === 'skills') {
    const any = state.players.some((p) => p.skills.some((s) => s.skillId && s.maxCharges > 0));
    return { applicable: any, text: any ? def.applicability : 'No party member has a skill with charges: this boon currently does nothing.' };
  }
  return { applicable: true, text: def.applicability };
}

export const STACKING_TEXT: Record<MechanicDef['stacking'], string> = {
  compound: 'Each copy multiplies by (1 + magnitude): two 25% copies make 56.25%, never a flat sum.',
  chance: 'Each copy multiplies the remaining miss chance: two 25% copies make 43.75%; it never reaches 100%.',
  factor: 'Each copy multiplies the value: two ×3 copies make ×9.',
};

interface EnemyRef { label: string; health: Big; hit: Big; regen: Big; armor: Big; windup: number; cycle: number; count: Big }

function enemyRef(state: SimState, r: number, fo?: Record<string, Big>): EnemyRef {
  const bossId = nextBossId(state, r);
  const M = f(state, 'encounter.spawnQuantity', fo);
  const dmgDirect = f(state, 'enemy.attackDamage', fo);
  const freq = f(state, 'enemy.attackFrequency', fo);
  const fq = Math.max(1e-300, Math.min(1e300, freq.toNumber()));
  if (bossId) {
    const b = BOSS_BY_ID[bossId];
    const atk = b.attacks.reduce((m, a) => (Number(a.damageCoef) > Number(m.damageCoef) ? a : m), b.attacks[0]);
    const health = enemyUnitHealth(state, b.refUnitHealth, r, b.bossFactor, fo);
    const regen = b.tags.includes('regen') ? health.mul(B(RULES.enemyBaseRegenFrac)).mul(f(state, 'enemy.regeneration', fo)) : Big.ZERO;
    return {
      label: `${b.name} (round ${r} boss)`, health, regen,
      hit: enemyDamage(state, b.baseDamage, r, fo).mul(B(atk.damageCoef)).mul(dmgDirect),
      armor: B(b.armor).mul(f(state, 'enemy.armor', fo)),
      windup: atk.windupSec / fq, cycle: (atk.windupSec + atk.releaseSec + atk.recoverySec + 1.2) / fq, count: ONE,
    };
  }
  const e = ENEMY_BY_ID['pursuer'];
  const atk = e.attacks[0];
  return {
    label: `${e.name} reference unit (round ${r})`,
    health: enemyUnitHealth(state, e.baseHealth, r, 1, fo),
    regen: Big.ZERO,
    hit: enemyDamage(state, e.baseDamage, r, fo).mul(B(atk.damageCoef)).mul(dmgDirect).mul(M.floorInt() > 0n ? Big.from(M.floorInt()) : ONE),
    armor: B(e.armor).mul(f(state, 'enemy.armor', fo)),
    windup: atk.windupSec / fq, cycle: (atk.windupSec + atk.releaseSec + atk.recoverySec + atk.cooldownSec) / fq,
    count: B(expectedFoeCount(state.n, r)).mul(M),   // population packs + reinforcements (director.ts)
  };
}

function consequenceSentence(changes: { name: string; ratio: number; stat: string }[]): string {
  const words = (x: number): string => {
    const named: Record<number, string> = { 2: 'doubles', 3: 'triples', 4: 'quadruples' };
    if (Math.abs(x - Math.round(x)) < 1e-9 && named[Math.round(x)]) return named[Math.round(x)];
    if (x >= 1) {
      const n = Math.round(x);
      const nums = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
      if (Math.abs(x - n) < 1e-9 && n <= 12) return `grows ${nums[n]}fold`;
      return `grows ×${x < 100 ? x.toFixed(2).replace(/\.?0+$/, '') : x.toExponential(2)}`;
    }
    return `drops to ${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;
  };
  const parts = changes.map((c) => `${c.name} ${words(c.ratio)}`);
  return parts.join('; ') + '.';
}

// ---------------- Mechanic forecasts ----------------

interface MechPlayerCtx { p: PlayerState; d: PlayerDerived; dps: Big; hit: Big; incoming: Big }
interface MechCtx { players: MechPlayerCtx[]; nextRound: number; attacker: string; unit: string; unitHealth: Big; windup: number }

/** Bound mechanics after binding `card` (copy of the aggregate with one more copy of each of its mechanics). */
export function mechanicsWithCard(state: SimState, card: CardDef): Record<string, { stacks: number; acc: Big }> {
  const out: Record<string, { stacks: number; acc: Big }> = { ...(state.fate.mechanics ?? {}) };
  for (const { effect } of cardMechanics(card)) {
    const def = MECHANIC_BY_ID[effect.id];
    if (!def) continue;
    const cur = out[effect.id] ?? { stacks: 0, acc: ONE };
    out[effect.id] = { stacks: cur.stacks + 1, acc: cur.acc.mul(perCopyFactor(def, effect.magnitude)) };
  }
  return out;
}

const N = (x: Big) => formatBig(x, { decimals: 2 });
const PCT = (x: Big) => `${formatBig(x.mul(B(100)), { decimals: 1 })}%`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function mechanicDetails(def: MechanicDef, v: Big, c: MechCtx): string[] {
  const P = def.params;
  const each = (fn: (x: MechPlayerCtx) => string | null) => c.players.map(fn).filter((s): s is string => !!s);
  const onePlus = ONE.add(v);
  switch (def.id) {
    case 'chain_reaction':
      return [`Each ${c.unit} slain blasts about ${N(c.unitHealth.mul(v))} damage into foes within ${P.radius} units (round ${c.nextRound}).`];
    case 'vampiric_rite':
      return each(({ p, d, dps }) => {
        const cap = d.maxHp.mul(B(P.capPerSec));
        return `${p.name}: about ${N(Big.min(dps.mul(v), cap).mul(d.healing))} health per second at full attack (cap ${N(cap.mul(d.healing))}/s).`;
      });
    case 'thunderous_blows':
      return each(({ p, d }) => `${p.name}: a bolt every ${P.everyHits}th hit for about ${N(d.damage.mul(d.typeMult.storm).mul(v))} storm damage.`);
    case 'splitting_shots':
      return each(({ p, hit }) => (firesProjectiles(p) ? `${p.name}: each shard deals about ${N(hit.mul(v))}.` : `${p.name}: fires no projectiles yet.`));
    case 'bloodrush':
      return each(({ p, d }) => `${p.name}: attack speed ${N(d.attackFreq)}/s → ${N(d.attackFreq.mul(onePlus))}/s, movement ${N(d.moveSpeed)} → ${N(d.moveSpeed.mul(onePlus))} for ${P.durationSec}s after a kill.`);
    case 'soul_harvest':
      return each(({ p }) => { const s = p.skills.find((x) => x.skillId && SKILL_BY_ID[x.skillId]?.cooldownSec > 0); const cd = s ? SKILL_BY_ID[s.skillId].cooldownSec : 0; return s ? `${p.name}: each kill cuts about ${N(B(cd).mul(v))}s from ${SKILL_BY_ID[s.skillId].name} (${cd}s cooldown) and every other recharging skill by ${N(v.mul(B(100)))}% of its cooldown.` : `${p.name}: no skill on cooldown to cut yet.`; });
    case 'echo': {
      const miss = ONE.sub(v);
      return [`On average each charge casts ${N(ONE.div(miss.isZero() ? B('1e-9') : miss))} times.`];
    }
    case 'executioner':
      return [`Non-boss foes die at ${PCT(v)} health: about ${N(c.unitHealth.mul(v))} of every ${c.unit} health bar (${N(c.unitHealth)}) is skipped.`];
    case 'phoenix':
      return each(({ p, d }) => `${p.name}: one lethal blow per round leaves you at ${N(d.maxHp.mul(v))} health, then ${P.invulnSec}s invulnerable.`);
    case 'static_trail':
      return each(({ p, d }) => {
        const pulse = d.damage.mul(d.typeMult.storm).mul(v);
        return `${p.name}: about ${N(pulse)} per pulse (${N(pulse.div(B(P.pulseSec)))}/s) to foes in the trail.`;
      });
    case 'retribution':
      return each(({ p, incoming }) => `${p.name}: a ${c.attacker} hit (${N(incoming)}) returns about ${N(incoming.mul(v))} to foes within ${P.radius} units.`);
    case 'warding_rune':
      return each(({ p, d }) => {
        const cap = d.maxHp.mul(d.shieldCapFrac);
        return `${p.name}: a shield of about ${N(Big.min(cap, d.maxHp.mul(v).mul(d.shieldCapFrac).div(B('0.6'))))} every ${P.everySec}s (cap ${N(cap)}).`;
      });
    case 'volatile_dead':
      return each(({ p, d }) => `${p.name}: about ${N(d.maxHp.mul(v))} every ${P.pulseSec}s in the fire (${PCT(v)} of max health); a full ${P.burnSec}s burn deals ${PCT(v.mul(B(P.burnSec / P.pulseSec)))}.`);
    case 'hexed_ground':
      return each(({ p, d }) => `${p.name}: each eruption deals about ${N(d.maxHp.mul(v))} (${PCT(v)} of max health), every ${P.everySec}s.`);
    case 'relentless':
      return [`Below ${PCT(B(P.threshold))} health foes act ${N(onePlus)}x faster: a ${c.attacker} telegraph shrinks from ${c.windup.toFixed(2)}s to ${(c.windup / Math.max(1e-9, onePlus.toNumber())).toFixed(2)}s.`];
    case 'the_hunt':
      return each(({ p, d }) => {
        const q = v.isZero() ? null : ONE.div(v);
        const touches = q ? (q.floorInt() + (q.isInteger() ? 0n : 1n)).toString() : 'no number of';
        return `${p.name}: each touch deals about ${N(d.maxHp.mul(v))}; ${touches} touch${touches === '1' ? '' : 'es'} down you.`;
      });
    case 'blood_moon': {
      const per = P.everySec;
      const par = referenceSec(c.nextRound);
      return [`Enemy damage x${N(onePlus.powInt(Math.floor(30 / per)))} after 30 s, x${N(onePlus.powInt(Math.floor(60 / per)))} after 60 s, x${N(onePlus.powInt(Math.floor(par / per)))} by the ${par}s par time.`];
    }
    case 'brittle':
      return each(({ p, incoming }) => `${p.name}: a ${c.attacker} hit right after a dodge deals ${N(incoming.mul(onePlus))} instead of ${N(incoming)}.`);
  }
  return [];
}

function mechanicDangers(def: MechanicDef, v: Big, c: MechCtx): string[] {
  const P = def.params;
  const out: string[] = [];
  if (def.id === 'hexed_ground' && v.gte(ONE)) out.push('Hexed Ground: a single eruption downs a hero.');
  if (def.id === 'the_hunt' && v.gte(ONE)) out.push('The Hunt: one touch of the Reaper downs a hero.');
  if (def.id === 'volatile_dead' && v.mul(B(P.burnSec / P.pulseSec)).gte(ONE)) out.push('Volatile Dead: standing in a pool for its full burn is lethal.');
  if (def.id === 'blood_moon' && ONE.add(v).powInt(Math.floor(referenceSec(c.nextRound) / P.everySec)).gt(B(10))) out.push('Blood Moon: enemy damage passes x10 by the par time.');
  if (def.id === 'brittle') for (const x of c.players) if (x.incoming.mul(ONE.add(v)).gte(x.d.maxHp)) out.push(`${x.p.name}: a hit right after a dodge would down you.`);
  return out;
}

function mechanicForecast(state: SimState, mo: Record<string, { stacks: number; acc: Big }>, id: string, magnitude: string, side: 'gift' | 'price', c: MechCtx): MechanicForecast {
  const def = MECHANIC_BY_ID[id];
  const before = state.fate.mechanics?.[id];
  const after = mo[id];
  const vB = before && before.stacks > 0 ? effectiveFromAcc(def, before.acc) : null;
  const vA = effectiveFromAcc(def, after.acc);
  const fB = vB ? formatMechanicValue(def, vB) : null;
  const fA = formatMechanicValue(def, vA);
  const app = def.kind === 'boon' ? mechanicApplicability(state, def) : { applicable: true, text: def.applicability };
  return {
    id, name: def.name, kind: def.kind, side, color: def.color, magnitude,
    stacks: { before: before?.stacks ?? 0, after: after.stacks },
    value: { before: fB, after: fA }, raw: { before: vB ? S(vB) : '', after: S(vA) },
    short: mechanicText(def, def.short, fA), text: mechanicText(def, def.description, fA),
    change: fB ? `${def.kind === 'boon' ? 'Stronger' : 'Harsher'}: ${fB} → ${fA} (${after.stacks} copies)` : 'New rule',
    stacking: STACKING_TEXT[def.stacking],
    details: mechanicDetails(def, vA, c),
    warnings: mechanicDangers(def, vA, c),
    applicable: app.applicable, applicability: app.text,
  };
}

export function computeForecast(state: SimState): OfferForecast | null {
  const offer = state.offer;
  if (!offer) return null;
  const nextRound = state.round + 1;
  const cards = offer.cards.map((cardId, slot) => {
    const card = cardById(cardId)!;
    const fo = factorsWithCard(state, card);
    const players: PlayerForecast[] = [];
    const refB = enemyRef(state, nextRound);
    const refA = enemyRef(state, nextRound, fo);
    let partyB = Big.ZERO, partyA = Big.ZERO;
    let measuredParty = Big.ZERO; let anySample = false;
    const pctx: MechPlayerCtx[] = [];
    for (const p of state.players) {
      const dB = derivePlayer(state, p);
      const dA = derivePlayer(state, p, fo);
      const bB = basicDps(state, p, dB), bA = basicDps(state, p, dA);
      partyB = partyB.add(bB.dps); partyA = partyA.add(bA.dps);
      pctx.push({ p, d: dA, dps: bA.dps, hit: bA.hit, incoming: refA.hit.mul(dA.incomingFactor) });
      const hpA = dB.maxHp.isZero() ? Big.ZERO : Big.min(dA.maxHp, p.hp.mul(dA.maxHp).div(dB.maxHp));
      const inB = refB.hit.mul(dB.incomingFactor), inA = refA.hit.mul(dA.incomingFactor);
      const hitsB = inB.isZero() ? Big.ZERO : Big.from(p.maxHp.div(inB).floorInt() + (p.maxHp.div(inB).isInteger() ? 0n : 1n));
      const hitsA = inA.isZero() ? Big.ZERO : Big.from(dA.maxHp.div(inA).floorInt() + (dA.maxHp.div(inA).isInteger() ? 0n : 1n));
      const survB = inB.isZero() ? Big.ZERO : dB.maxHp.div(inB.div(B(Math.max(1e-9, refB.cycle))));
      const survA = inA.isZero() ? Big.ZERO : dA.maxHp.div(inA.div(B(Math.max(1e-9, refA.cycle))));
      const sig = SKILL_BY_ID[CLASS_BY_ID[p.classId].signatureSkill];
      const window = p.dpsWindow.slice(-10);
      let measured: PlayerForecast['measuredDps'] = null;
      let estimated: FValue | null = null;
      if (window.length >= 3) {
        const sum = window.reduce((s, x) => s.add(x), Big.ZERO);
        const avg = sum.div(B(window.length));
        measured = { value: S(avg), sampleSec: window.length };
        measuredParty = measuredParty.add(avg); anySample = true;
        estimated = fv(avg, bB.dps.isZero() ? avg : avg.mul(bA.dps).div(bB.dps), 'estimate');
      }
      const warnings: string[] = [];
      if (!hitsA.isZero() && hitsA.lte(ONE)) warnings.push(`${p.name}: one ${refA.label.split(' (')[0]} hit would down you.`);
      if (dA.maxHp.lt(dB.maxHp)) warnings.push(`${p.name}: maximum health falls to ${(dA.maxHp.ratio(dB.maxHp) * 100).toFixed(1)}% of current.`);
      players.push({
        slot: p.slot, name: p.name, classId: p.classId,
        maxHp: fv(dB.maxHp, dA.maxHp), hp: fv(p.hp, hpA), hitDamage: fv(bB.hit, bA.hit), attackFreq: fv(dB.attackFreq, dA.attackFreq),
        critChance: { before: dB.critQ, after: dA.critQ }, expectedHit: fv(bB.expected, bA.expected), rawDps: fv(bB.dps, bA.dps),
        armor: fv(dB.armor, dA.armor), incomingHit: fv(inB, inA), hitsToDown: fv(hitsB, hitsA), survivalSec: fv(survB, survA, 'estimate'),
        healing: fv(dB.healing, dA.healing), moveSpeed: fv(dB.moveSpeed, dA.moveSpeed),
        cooldownSec: fv(B(sig.cooldownSec).div(dB.recovery), B(sig.cooldownSec).div(dA.recovery)),
        recoveryRate: fv(dB.recovery, dA.recovery), measuredDps: measured, estimatedDps: estimated, warnings,
      });
    }
    const K = B(RULES.armorK);
    const mitB = K.div(K.add(refB.armor)), mitA = K.div(K.add(refA.armor));
    const netB = partyB.mul(mitB).sub(refB.regen);
    const netA = partyA.mul(mitA).sub(refA.regen);
    const rawNetB = partyB.mul(mitB), rawNetA = partyA.mul(mitA);
    const noNetB = rawNetB.lte(refB.regen), noNetA = rawNetA.lte(refA.regen);
    const killB = noNetB ? Big.ZERO : refB.health.div(netB);
    const killA = noNetA ? Big.ZERO : refA.health.div(netA);
    const pressureB = f(state, 'score.pressure'), pressureA = f(state, 'score.pressure', fo);
    const bp = B(basePoints(nextRound).toString());
    const stats = cardStatEffects(card);
    const factorChanges = stats.map(({ effect: e }) => ({
      stat: e.stat, name: STAT_BY_ID[e.stat].name, before: S(state.fate.factors[e.stat] ?? ONE), after: S(fo[e.stat]),
    }));
    const mo = mechanicsWithCard(state, card);
    const mechanics = cardMechanics(card).map(({ side, effect }) => mechanicForecast(state, mo, effect.id, effect.magnitude, side, {
      players: pctx, nextRound, attacker: refA.label.split(' (')[0], unit: ENEMY_BY_ID.pursuer.name, unitHealth: enemyUnitHealth(state, ENEMY_BY_ID.pursuer.baseHealth, nextRound, 1, fo), windup: refA.windup,
    }));
    const warnings: string[] = [];
    if (noNetA) warnings.push('Model predicts no net progress against the reference target (regeneration ≥ effective damage).');
    if (refA.windup < 0.15) warnings.push(`Enemy telegraphs shrink to ${(refA.windup * 1000).toFixed(0)} ms — reaction windows may vanish.`);
    for (const pf of players) warnings.push(...pf.warnings);
    for (const mf of mechanics) warnings.push(...mf.warnings);
    // consequence sentence: the stat changes (price first), then the rules gained or strengthened
    const changes: { name: string; ratio: number; stat: string }[] = [];
    for (const { effect: eff } of [...stats].reverse()) {
      const nm = STAT_BY_ID[eff.stat].name.replace(/^Player /, 'your ').replace(/^Enemy /, 'enemy ');
      changes.push({ name: nm.charAt(0).toUpperCase() + nm.slice(1), ratio: percentToFactor(eff.percent).toNumber(), stat: eff.stat });
    }
    const parts: string[] = [];
    if (changes.length) parts.push(consequenceSentence(changes));
    for (const mf of mechanics) parts.push(mf.stacks.before === 0 ? `${mf.kind === 'boon' ? 'Gain' : 'Suffer'} ${mf.name}: ${lowerFirst(mf.short)}.` : `${mf.name} grows from ${mf.value.before} to ${mf.value.after}.`);
    let consequence = parts.join(' ');
    const posApp = card.positive ? applicabilityFor(state, card.positive.stat, mo) : null;
    if (posApp && !posApp.applicable) consequence += ' The positive effect does nothing for your current builds.';
    const boonF = mechanics.find((m) => m.side === 'gift');
    if (boonF && !boonF.applicable) consequence += ' The boon does nothing for your current builds.';
    if (!killA.isZero() && !killB.isZero()) {
      const ratio = killA.ratio(killB);
      if (ratio > 1.05) consequence += ` Idealized kill time rises ×${ratio < 1000 ? ratio.toFixed(2) : ratio.toExponential(2)}.`;
      else if (ratio < 0.95) consequence += ` Idealized kill time falls to ${(ratio * 100).toFixed(1)}%.`;
    }
    const negApp = card.negative ? applicabilityFor(state, card.negative.stat, mo) : null;
    const side = (eff: CardDef['positive'], app: { applicable: boolean; text: string } | null): StatSideForecast | null =>
      eff && app ? { stat: eff.stat, name: STAT_BY_ID[eff.stat].name, percent: eff.percent, factor: percentToFactor(eff.percent).toString(), applicable: app.applicable, applicability: app.text } : null;
    const cf: CardForecast = {
      cardId, slot, rarity: cardRarity(card),
      positive: side(card.positive, posApp),
      negative: side(card.negative, negApp),
      mechanics,
      factorChanges, players,
      enemy: {
        reference: refA.label,
        health: fv(refB.health, refA.health), regenPerSec: fv(refB.regen, refA.regen), armorFactor: fv(mitB, mitA),
        incomingHitRaw: fv(refB.hit, refA.hit), logicalCount: fv(refB.count, refA.count, 'estimate'),
        telegraphSec: fv(B(refB.windup.toPrecision(6)), B(refA.windup > 0 ? refA.windup.toPrecision(6) : '0')),
        netPartyDps: fv(netB, netA, 'estimate'), killTimeSec: fv(killB, killA, 'estimate'),
        noNetProgress: { before: noNetB, after: noNetA },
      },
      score: { nextRoundPoints: fv(bp.mul(pressureB), bp.mul(pressureA)), pressure: fv(pressureB, pressureA) },
      consequence,
      warnings,
      assumptions: [
        'Static values are exact calculations from the pre-choice snapshot.',
        `Estimates use the reference target (${refA.label}), constant uptime, no crits beyond expectation, regeneration throughout, and ignore geometry, invulnerability phases and multiplayer positioning.`,
        anySample ? 'Measured DPS uses the last up to 10 seconds of combat (current measured rate).' : 'Insufficient combat sample: measured DPS unavailable; showing the static model only.',
        'Survival time assumes one reference attacker, no healing, no avoidance.',
      ],
    };
    void measuredParty;
    return cf;
  });
  return { offerId: offer.id, round: offer.round, snapshotHash: offer.snapshotHash, stateVersion: offer.stateVersion, nextRound, nextIsBoss: isBossRound(nextRound), cards, modelVersion: FORECAST_MODEL_VERSION };
}

// ---------------- Ledger ----------------

export interface LedgerStat {
  stat: string;
  name: string;
  group: LedgerGroup;
  scope: string;
  semantics: string;
  applicability: string;
  fateFactor: string;
  sources: { cardId: string; count: number; factor: string }[];
  perPlayer: { slot: number; base: string; tree: string; mastery: string; fate: string; result: string; treeSources: { node: string; rank: number; factor: string }[]; /** legendary gear factor (gear.ts) */ gear?: string; gearSources?: { item: string; factor: string }[] }[];
  representative: { label: string; value: string } | null;
  kind: ValueKind;
}

export interface LedgerView {
  round: number;
  seed: string;
  mode: string;
  n: number;
  scoreText: string;
  pressure: string;
  groups: { id: LedgerGroup; name: string; stats: LedgerStat[] }[];
  timeline: { seq: number; round: number; cardId: string; stat: string; percent: string; factor: string }[];
  timelineTotal: number;
  measured: { slot: number; dps: string; sampleSec: number }[];
  mastery: { slot: number; damage: number; health: number; recovery: number }[];
  graph: { from: string; to: string }[];
  /** Bound boons and banes: copies and effective magnitude (stacked multiplicatively). */
  mechanics: LedgerMechanic[];
  /** Every mechanic binding in order (seq shares the stat timeline ordering). */
  mechanicTimeline: { seq: number; round: number; cardId: string; mechanic: string; kind: 'boon' | 'bane'; magnitude: string }[];
}

export const LEDGER_GROUP_NAMES: Record<LedgerGroup, string> = {
  party_damage: 'Party damage capacity',
  health_recovery: 'Health and recovery',
  enemy_health: 'Enemy health and regeneration',
  enemy_offense: 'Enemy offense',
  mobility_projectiles: 'Mobility and projectile pressure',
  score_growth: 'Score growth',
};

export function computeLedger(state: SimState, page = 0, pageSize = 50): LedgerView {
  const groups = new Map<LedgerGroup, LedgerStat[]>();
  const counts = new Map<string, Map<string, { count: number; factor: Big }>>();
  for (const e of state.fate.entries) {
    let m = counts.get(e.stat);
    if (!m) { m = new Map(); counts.set(e.stat, m); }
    const c = m.get(e.cardId) ?? { count: 0, factor: ONE };
    c.count++; c.factor = c.factor.mul(e.factor);
    m.set(e.cardId, c);
  }
  const r = Math.max(1, state.round + (state.phase === 'COMBAT' ? 0 : 1));
  for (const def of STATS) {
    const fateF = state.fate.factors[def.id] ?? ONE;
    const sources = [...(counts.get(def.id)?.entries() ?? [])].map(([cardId, v]) => ({ cardId, count: v.count, factor: v.factor.toString() }));
    let perPlayer: LedgerStat['perPlayer'] = [];
    let representative: LedgerStat['representative'] = null;
    if (def.scope === 'player') {
      perPlayer = state.players.map((p) => {
        const b = breakdown(state, p, def.id);
        return { slot: p.slot, base: S(b.base), tree: S(b.tree), mastery: S(b.mastery), fate: S(b.fate), result: S(b.result), treeSources: b.treeSources, gear: S(b.gear), gearSources: b.gearSources };
      });
      if (!def.fateEligible && perPlayer.every((x) => x.tree === '1' && x.mastery === '1' && (x.gear ?? '1') === '1')) continue;
    } else if (def.id === 'enemy.maxHealth') {
      representative = { label: `${ENEMY_BY_ID.pursuer.name} health at round ${r}`, value: S(enemyUnitHealth(state, ENEMY_BY_ID.pursuer.baseHealth, r, 1)) };
    } else if (def.id === 'enemy.damage') {
      representative = { label: `${ENEMY_BY_ID.pursuer.name} bite at round ${r}`, value: S(enemyDamage(state, ENEMY_BY_ID.pursuer.baseDamage, r)) };
    } else if (def.id === 'enemy.regeneration') {
      representative = { label: 'Regeneration of tagged enemies (fraction of max health per second)', value: S(B(RULES.enemyBaseRegenFrac).mul(fateF)) };
    } else if (def.id === 'enemy.armor') {
      const a = B(ENEMY_BY_ID.guardian.armor).mul(fateF);
      representative = { label: `${ENEMY_BY_ID.guardian.name} damage taken factor K/(K+A)`, value: S(B(RULES.armorK).div(B(RULES.armorK).add(a))) };
    } else if (def.id === 'score.pressure') {
      representative = { label: `Points for round ${r}`, value: S(B(basePoints(r).toString()).mul(fateF)) };
    }
    const stat: LedgerStat = {
      stat: def.id, name: def.name, group: def.group, scope: def.scope, semantics: def.semantics, applicability: def.applicability,
      fateFactor: S(fateF), sources, perPlayer, representative, kind: 'static',
    };
    const list = groups.get(def.group) ?? [];
    list.push(stat);
    groups.set(def.group, list);
  }
  const entries = state.fate.entries;
  const start = Math.max(0, entries.length - (page + 1) * pageSize);
  const end = Math.max(0, entries.length - page * pageSize);
  const graph: { from: string; to: string }[] = [];
  for (const s of STATS) for (const a of s.affects) graph.push({ from: s.id, to: a });
  return {
    round: state.round, seed: state.seed, mode: state.mode, n: state.n, scoreText: state.scoreText,
    pressure: S(state.fate.factors['score.pressure'] ?? ONE),
    groups: (Object.keys(LEDGER_GROUP_NAMES) as LedgerGroup[]).map((id) => ({ id, name: LEDGER_GROUP_NAMES[id], stats: groups.get(id) ?? [] })),
    timeline: entries.slice(start, end).map((e) => ({ seq: e.seq, round: e.round, cardId: e.cardId, stat: e.stat, percent: e.percent, factor: e.factor.toString() })),
    timelineTotal: entries.length,
    measured: state.players.map((p) => {
      const w = p.dpsWindow.slice(-10);
      const sum = w.reduce((s, x) => s.add(x), Big.ZERO);
      return { slot: p.slot, dps: w.length ? S(sum.div(B(w.length))) : '0', sampleSec: w.length };
    }),
    mastery: state.players.map((p) => ({ slot: p.slot, ...p.mastery })),
    graph,
    mechanics: ledgerMechanics(state),
    mechanicTimeline: (state.fate.mechanicEntries ?? []).map((m) => ({ seq: m.seq, round: m.round, cardId: m.cardId, mechanic: m.mechanic, kind: m.kind, magnitude: m.magnitude })),
  };
}

export interface LedgerMechanic {
  id: string;
  name: string;
  kind: 'boon' | 'bane';
  color: string;
  stacks: number;
  /** formatted effective magnitude ('56.25%', '×9') and its Big compact form */
  value: string;
  raw: string;
  short: string;
  text: string;
  stacking: string;
  applicability: string;
  /** cards that bound it: copies and per-copy magnitude */
  sources: { cardId: string; count: number; magnitude: string }[];
}

/** Bound mechanics in content order (boons first, then banes). */
export function ledgerMechanics(state: SimState): LedgerMechanic[] {
  const out: LedgerMechanic[] = [];
  const all = state.fate.mechanics ?? {};
  for (const def of [...MECHANICS].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'boon' ? -1 : 1))) {
    const s = all[def.id];
    if (!s || s.stacks <= 0) continue;
    const v = effectiveFromAcc(def, s.acc);
    const value = formatMechanicValue(def, v);
    const src = new Map<string, { cardId: string; count: number; magnitude: string }>();
    for (const e of state.fate.mechanicEntries ?? []) {
      if (e.mechanic !== def.id) continue;
      const k = `${e.cardId}|${e.magnitude}`;
      const cur = src.get(k) ?? { cardId: e.cardId, count: 0, magnitude: e.magnitude };
      cur.count++;
      src.set(k, cur);
    }
    out.push({
      id: def.id, name: def.name, kind: def.kind, color: def.color, stacks: s.stacks, value, raw: S(v),
      short: mechanicText(def, def.short, value), text: mechanicText(def, def.description, value),
      stacking: STACKING_TEXT[def.stacking], applicability: def.applicability, sources: [...src.values()],
    });
  }
  return out;
}
