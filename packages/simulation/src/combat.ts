import { Big, sampleBinomial } from '@cursebound/numeric';
import { AFFLICTION_RULES, BOSS_BY_ID, ENEMY_BY_ID, RULES, TICK_SEC, type DamageType } from '@cursebound/content';
import { nextFloat } from './rng';
import { bountyRules } from './bountyRules';
import { B, ONE, fateFactor, playerDerived } from './stats';
import type { Cohort, EnemyState, PlayerState, SimEvent, SimState } from './types';
import { hooks, type HitMod } from './hooks';
// post-run breakdown: observation only, kept outside the hashed state (runStats.ts)
import { tallyDot, tallyDotTick, tallyEnemyHit, tallyFall, tallyHeal, tallyTaken } from './runStats';

// Damage pipeline (REQ COMBAT01, PRD §5.2, §12.1, §12.2). All quantities canonical Big.
// Grouped logical hits ("packets") preserve kill timing per unit via exact cohort arithmetic; crits on k identical
// hits use a deterministic binomial sample (exact Bernoulli trials for k <= 64).

const ZERO = Big.ZERO;
/** Ash Recovery (Arcanist): seconds cut from every recharging skill when a burning objective enemy dies. */
const ASH_RECOVERY_SEC = 0.5;

function ceilDiv(x: Big, d: Big): bigint {
  const qv = x.div(d);
  const qi = qv.floorInt();
  return qv.isInteger() ? qi : qi + 1n;
}

const bigOf = (n: bigint) => Big.from(n);

export interface CohortResult { kills: Big; dealt: Big }

/** m sequential hits of damage d on the cohort front (single-target packets). Overkill is excluded from dealt. */
export function applySingle(c: Cohort, d: Big, m: Big): CohortResult {
  if (c.count.isZero() || d.isZero() || m.isZero()) return { kills: ZERO, dealt: ZERO };
  const E = c.unitHp.sub(c.spread);
  const F = E.sub(c.front);
  const hitsFront = ceilDiv(F, d);
  const mi = m.floorInt();
  if (mi < hitsFront) {
    const dealt = d.mul(m);
    c.front = c.front.add(dealt);
    return { kills: ZERO, dealt };
  }
  let kills = 1n;
  let dealt = F;
  let rem = mi - hitsFront;
  const n = c.count.floorInt();
  const hitsPerUnit = ceilDiv(E, d);
  let more = rem / hitsPerUnit;
  if (more > n - 1n) more = n - 1n;
  if (more > 0n) {
    kills += more;
    dealt = dealt.add(E.mul(bigOf(more)));
    rem -= more * hitsPerUnit;
  }
  if (kills < n) {
    const partial = rem > 0n ? d.mul(bigOf(rem)) : ZERO;
    c.front = partial;
    dealt = dealt.add(partial);
  } else {
    c.front = ZERO;
  }
  c.count = c.count.sub(bigOf(kills));
  return { kills: bigOf(kills), dealt };
}

/** One hit of damage d on each of u units (area coverage). Spread over a partially covered cohort is averaged
 *  (total damage preserved exactly; declared expected-spread approximation, D06). */
export function applyArea(c: Cohort, d: Big, u: Big): CohortResult {
  if (c.count.isZero() || d.isZero() || u.isZero()) return { kills: ZERO, dealt: ZERO };
  const n = c.count;
  if (u.gt(n)) u = n;
  const E = c.unitHp.sub(c.spread);
  const F = E.sub(c.front);
  if (d.gte(E)) {
    // every covered unit dies (front included)
    const dealt = F.add(E.mul(u.sub(ONE)));
    c.count = n.sub(u);
    c.front = ZERO;
    return { kills: u, dealt };
  }
  if (d.gte(F)) {
    // front dies; others take d
    let dealt = F;
    const others = u.sub(ONE);
    c.count = n.sub(ONE);
    c.front = ZERO;
    if (!others.isZero() && !c.count.isZero()) {
      dealt = dealt.add(d.mul(others));
      c.spread = c.spread.add(d.mul(others).div(c.count));
      if (c.spread.gte(c.unitHp)) { const k = c.count; c.count = ZERO; c.spread = ZERO; return { kills: k.add(ONE), dealt }; }
    }
    return { kills: ONE, dealt };
  }
  // no kills: all covered units take d
  const dealt = d.mul(u);
  if (u.eq(n)) {
    c.spread = c.spread.add(d);
  } else {
    c.front = c.front.add(d);
    if (n.gt(ONE)) c.spread = c.spread.add(d.mul(u.sub(ONE)).div(n.sub(ONE)));
  }
  // invariants: spread < H, front < H - spread
  if (c.spread.gte(c.unitHp)) { const k = c.count; c.count = ZERO; c.spread = ZERO; c.front = ZERO; return { kills: k, dealt }; }
  const E2 = c.unitHp.sub(c.spread);
  if (c.front.gte(E2)) { c.count = c.count.sub(ONE); c.front = ZERO; return { kills: ONE, dealt }; }
  return { kills: ZERO, dealt };
}

export function cohortHpFrac(c: Cohort): number {
  if (c.count.isZero()) return 0;
  return Math.max(0, Math.min(1, c.unitHp.sub(c.spread).sub(c.front).ratio(c.unitHp)));
}

/** Total remaining logical health of a cohort. */
export function cohortTotalHp(c: Cohort): Big {
  if (c.count.isZero()) return ZERO;
  const E = c.unitHp.sub(c.spread);
  return E.mul(c.count).sub(c.front);
}

export function cohortRadius(base: number, count: Big): number {
  if (count.lte(ONE)) return base;
  return Math.min(base * 4, base * (1 + 0.18 * count.log10() * 3.3219));
}

export function mitigationFactor(armor: Big): Big {
  const K = B(RULES.armorK);
  return K.div(K.add(armor));
}

export interface HitOpts {
  dtype: DamageType;
  srcSlot: number;
  skillId: string;
  fromX: number; fromY: number;
  coverage?: number;               // area fraction of cohort covered (undefined = single-target)
  allowCrit: boolean;
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
  vuln?: { factor: string; sec: number };
  generation?: number;
  stagger?: number;
}

/** Player -> enemy damage. perHit is snapshotted damage before crit/vulnerability/mitigation; mult = logical hits. */
export function hitEnemy(state: SimState, ev: SimEvent[], e: EnemyState, perHit: Big, mult: Big, o: HitOpts): CohortResult {
  if (e.state === 'dying' || e.cohort.count.isZero()) return { kills: ZERO, dealt: ZERO };
  const p = state.players[o.srcSlot];
  const pd = p ? playerDerived(state, p) : null;
  let factor = mitigationFactor(e.armor);
  const def = e.boss ? null : ENEMY_BY_ID[e.kind];
  const weak = def?.weaknesses[o.dtype];
  if (weak) factor = factor.mul(B(weak));
  if (e.vulnUntil > state.tick) factor = factor.mul(B(e.vulnFactor));
  if (e.boss && e.staggerUntil > state.tick) factor = factor.mul(B(BOSS_BY_ID[e.kind].vulnerableMultiplier));
  if (e.kind === 'guardian') {
    // frontal plate: hits from the front are reduced; the flank and back are exposed
    const vx = o.fromX - e.x, vy = o.fromY - e.y;
    const l = Math.sqrt(vx * vx + vy * vy) || 1;
    const cos = (vx * e.fx + vy * e.fy) / l;
    factor = factor.mul(cos > 0.5 ? B('0.35') : cos < -0.5 ? B('1.25') : ONE);
  }
  // conditional per-target adjustments from class kits / Fate (hooks.modifyHit: vs frozen, vs marked, ...)
  const mod: HitMod = { dmg: ONE, critMul: ONE, critDmg: ONE, forceCrit: false };
  if (p) hooks.modifyHit(state, p, e, { skillId: o.skillId, dtype: o.dtype, generation: o.generation ?? 0 }, mod);
  const d = perHit.mul(factor).mul(mod.dmg);
  // crits on identical hits
  let units = mult;
  let dBase = d;
  if (o.coverage !== undefined) {
    // area: each covered unit takes every grouped hit; k hits of d on one unit == one hit of k*d (overkill excluded)
    dBase = d.mul(mult);
    const n = e.cohort.count;
    if (n.lte(ONE)) units = ONE;
    else {
      const u = Big.from(Math.max(0, Math.min(1, o.coverage))).mul(n).floorInt();
      units = u < 1n ? ONE : Big.from(u);
      if (units.gt(n)) units = n;
    }
  }
  let crits = ZERO;
  if (o.allowCrit && pd && pd.critQ > 0) {
    let qf = pd.critQ;
    if (!mod.critMul.eq(ONE)) { const c = pd.critC.mul(mod.critMul); qf = c.div(c.add(ONE)).toNumber(); }
    const qScaled = BigInt(Math.round(qf * 1e9));
    crits = mod.forceCrit ? units : sampleBinomial(units, qScaled, 1000000000n, () => nextFloat(state.rng.combat));
  }
  const normal = units.sub(crits);
  let res: CohortResult = { kills: ZERO, dealt: ZERO };
  const shieldAbsorb = (amount: Big): Big => {
    if (e.shield.isZero() || e.shieldUntil <= state.tick) return amount;
    if (e.shield.gte(amount)) { e.shield = e.shield.sub(amount); return ZERO; }
    const rest = amount.sub(e.shield); e.shield = ZERO; return rest;
  };
  const applyPart = (dd: Big, count: Big) => {
    if (count.isZero()) return;
    // enemy shields absorb aggregate damage first, reducing per-hit damage proportionally
    const total = dd.mul(count);
    const after = shieldAbsorb(total);
    if (after.isZero()) return;
    const ddEff = after.eq(total) ? dd : after.div(count);
    const r = o.coverage !== undefined ? applyArea(e.cohort, ddEff, count) : applySingle(e.cohort, ddEff, count);
    res = { kills: res.kills.add(r.kills), dealt: res.dealt.add(r.dealt) };
  };
  if (!crits.isZero() && pd) applyPart(dBase.mul(pd.critMult).mul(mod.critDmg), crits);
  applyPart(dBase, normal);
  e.hitFlash = 6;
  if (o.vuln) { e.vulnUntil = state.tick + Math.round(o.vuln.sec / TICK_SEC); e.vulnFactor = o.vuln.factor; }
  const statSkill = tallyEnemyHit(state, o.srcSlot, o.skillId, res.dealt, res.kills);   // breakdown (runStats.ts)
  if (o.dot && !res.dealt.isZero()) addDot(state, e, o.srcSlot, o.dot.type, perHit.mul(B(o.dot.fractionPerSec)).mul(o.dot.type === 'ember' && pd ? pd.burnRate : ONE).mul(o.coverage !== undefined ? ONE : mult), o.dot.durationSec, statSkill);
  if (o.stagger && e.boss) addStagger(state, ev, e, o.stagger);
  if (p) {
    p.stats.damageDealt = p.stats.damageDealt.add(res.dealt);
    p.dpsBucket = p.dpsBucket.add(res.dealt);
  }
  ev.push({ t: 'hit', target: e.id, targetKind: 'enemy', amount: res.dealt.toCompact(), crit: !crits.isZero(), dtype: o.dtype, x: e.x, y: e.y, count: units.gt(ONE) ? units.toCompact() : undefined, sx: o.fromX, sy: o.fromY, kill: e.cohort.count.isZero() || !res.kills.isZero(), src: o.srcSlot });
  if (!res.dealt.isZero()) hooks.onEnemyHit(state, ev, p, e, { dealt: res.dealt, crit: !crits.isZero(), kill: e.cohort.count.isZero() || !res.kills.isZero(), dtype: o.dtype, skillId: o.skillId, srcSlot: o.srcSlot, fromX: o.fromX, fromY: o.fromY, generation: o.generation ?? 0, kills: res.kills });
  if (e.cohort.count.isZero()) killEnemy(state, ev, e, o.srcSlot);
  else if (!res.kills.isZero()) e.radius = cohortRadius(e.boss ? BOSS_BY_ID[e.kind].radius : ENEMY_BY_ID[e.kind].radius, e.cohort.count);
  // reactions are scheduled for the next simulation slice (generation based, PRD §12.4)
  if (p && o.dtype === 'ember' && (p.ranks['a_inferno'] ?? 0) > 0 && (o.generation ?? 0) === 0 && !res.dealt.isZero() && o.skillId !== 'inferno') {
    state.reactions.push({ kind: 'inferno', slot: o.srcSlot, x: e.x, y: e.y, amount: res.dealt.mul(B('0.2')), tick: state.tick + 1, generation: 1 });
  }
  return res;
}

/** `statSkill` (breakdown only, runStats.ts): the skill the damage over time counts for; absent = the attribution context. */
export function addDot(state: SimState, e: EnemyState, src: number, type: DamageType, perSec: Big, durationSec: number, statSkill?: string) {
  if (perSec.isZero()) return;
  // Source-indexed aggregate bucketed by 0.25s expiry: additive rate, independent durations, bounded entries.
  const until = Math.ceil((state.tick + durationSec / TICK_SEC) / 15) * 15;
  let ex = e.dots.find((x) => x.src === src && x.type === type && x.until === until);
  if (ex) ex.perSec = ex.perSec.add(perSec);
  else e.dots.push(ex = { src, type, perSec, until });
  tallyDot(state, ex, src, type, statSkill, perSec);
  if (type === 'ember') e.burning = true;
}

export function tickDots(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (!e.dots.length) return;
  const mit = mitigationFactor(e.armor);
  const dt = B(TICK_SEC);
  let total = ZERO;
  let src = e.dots[0].src;
  for (const d of e.dots) {
    total = total.add(d.perSec);
    src = d.src;
  }
  const ticked = e.dots;   // breakdown: the entries that fed this tick (runStats.ts)
  e.dots = e.dots.filter((d) => d.until > state.tick);
  e.burning = e.dots.some((d) => d.type === 'ember');
  if (total.isZero()) return;
  const amount = total.mul(dt).mul(mit);
  const r = applySingle(e.cohort, amount, ONE);
  tallyDotTick(state, ticked, total, r.dealt, r.kills);
  const p = state.players[src];
  if (p) { p.stats.damageDealt = p.stats.damageDealt.add(r.dealt); p.dpsBucket = p.dpsBucket.add(r.dealt); }
  if (state.tick % 20 === 0) ev.push({ t: 'hit', target: e.id, targetKind: 'enemy', amount: total.mul(mit).toCompact(), crit: false, dtype: e.dots[0]?.type ?? 'ember', x: e.x, y: e.y });
  if (e.cohort.count.isZero()) killEnemy(state, ev, e, src);
}

export function addStagger(state: SimState, ev: SimEvent[], e: EnemyState, amount: number) {
  if (!e.boss || e.staggerUntil > state.tick) return;
  e.stagger += amount;
  const def = BOSS_BY_ID[e.kind];
  if (e.stagger >= def.staggerMeter) {
    e.stagger = 0;
    e.staggerUntil = state.tick + Math.round(2.5 / TICK_SEC);
    e.attack = null;
    e.state = 'stagger';
    ev.push({ t: 'stagger', id: e.id });
  }
}

export function killEnemy(state: SimState, ev: SimEvent[], e: EnemyState, bySlot: number) {
  if (e.state === 'dying') return;
  e.state = 'dying';
  e.deathTimer = 0.6;
  e.attack = null;
  e.cohort.count = ZERO;
  ev.push({ t: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y, by: bySlot });
  // Ash Recovery (Arcanist): burning objective kills cut every recharging skill cooldown
  const p = state.players[bySlot];
  if (p && e.burning && e.objective && (p.ranks['a_ash_recovery'] ?? 0) > 0 && p.lifeState === 'alive') {
    for (const s of p.skills) if (s.skillId && s.charges < s.maxCharges) s.cooldown -= ASH_RECOVERY_SEC;
  }
  // Follow through: a Sweeping Strike kill restores its charge once per cast
  if (p && p.lastSkill === 'v_sweeping_strike' && (p.ranks['v_follow_through'] ?? 0) > 0) {
    const s = p.skills.find((x) => x.skillId === 'v_sweeping_strike');
    if (s && s.charges < s.maxCharges) { s.charges = s.maxCharges; s.cooldown = 0; }
    p.lastSkill = null;
  }
  hooks.onKill(state, ev, e, p);
  // linked summons vanish with their summoner (non-objective)
  for (const other of state.enemies) {
    if (other.summonerId === e.id && other.state !== 'dying') {
      other.state = 'dying'; other.deathTimer = 0.3; other.cohort.count = ZERO; other.attack = null;
      ev.push({ t: 'death', id: other.id, kind: other.kind, x: other.x, y: other.y });
    }
  }
}

// ---------------- Player damage, healing and shields ----------------

export interface PlayerHitOpts {
  attack: string;
  source: string;
  fromX: number; fromY: number;
  dtype: DamageType;
  hazard?: boolean;
  /** id of the enemy that caused the damage, when known (vampiric affix, recaps) */
  srcId?: number;
}

export function healPlayer(state: SimState, ev: SimEvent[], p: PlayerState, amount: Big) {
  if (p.lifeState !== 'alive' || amount.isZero()) return;
  const pd = playerDerived(state, p);
  let eff = amount.mul(pd.healing);
  // poisoned heroes (afflictions.ts) receive reduced healing from every source
  if (p.buffs.length && p.buffs.some((b) => b.id === 'poisoned' && b.until > state.tick)) eff = eff.mul(B(AFFLICTION_RULES.poisonHealFactor));
  const before = p.hp;
  p.hp = Big.min(p.maxHp, p.hp.add(eff));
  const gained = p.hp.sub(before);
  if (!gained.isZero()) {
    p.stats.healing = p.stats.healing.add(gained);
    tallyHeal(state, p, gained);   // breakdown (runStats.ts)
    ev.push({ t: 'heal', slot: p.slot, amount: gained.toCompact() });
  }
}

export function shieldPlayer(state: SimState, ev: SimEvent[], p: PlayerState, amount: Big) {
  if (p.lifeState !== 'alive' || amount.isZero()) return;
  const pd = playerDerived(state, p);
  const baseFrac = B('0.6');
  const gain = amount.mul(pd.shieldCapFrac).div(baseFrac);
  const cap = p.maxHp.mul(pd.shieldCapFrac);
  p.shield = Big.min(cap, p.shield.add(gain));
  ev.push({ t: 'shield', slot: p.slot, amount: gain.toCompact() });
}

export function hitPlayer(state: SimState, ev: SimEvent[], p: PlayerState, raw: Big, o: PlayerHitOpts): Big {
  if (raw.isZero()) return ZERO;
  if (p.lifeState === 'dead') return ZERO;
  if (p.lifeState === 'downed') {
    // downed players are not damaged further, but damage interrupts a solo self revive channel (-> death)
    if (p.selfReviveChannel > 0) {
      p.selfReviveChannel = 0;
      p.lifeState = 'dead';
      recordRecap(state, p, raw, o, true, ev);
      ev.push({ t: 'dead', slot: p.slot });
      ev.push({ t: 'domain', type: 'player_dead', payload: { slot: p.slot, round: state.round } });
    }
    return ZERO;
  }
  if (p.iframes > 0) return ZERO;
  const pd = playerDerived(state, p);
  // Guard stance: frontal damage is absorbed and partially converted to shield
  if (p.guardTimer > 0) {
    // Unbreakable (Vanguard keystone) guards every direction
    const arc = (p.ranks['v_unbreakable'] ?? 0) > 0 ? 360 : (p.ranks['v_shield_reach'] ?? 0) > 0 ? 120 : 90;
    const cosHalf = arc === 360 ? -2 : arc === 120 ? 0.5 : 0.70710678;
    const vx = o.fromX - p.x, vy = o.fromY - p.y;
    const l = Math.sqrt(vx * vx + vy * vy) || 1;
    if ((vx * p.aimX + vy * p.aimY) / l >= cosHalf) {
      const absorbed = raw.mul(pd.incomingFactor);
      p.guardAbsorbed = p.guardAbsorbed.add(absorbed);
      p.stats.prevented = p.stats.prevented.add(absorbed);
      const conv = absorbed.mul(B('0.3'));
      shieldPlayer(state, ev, p, conv);
      if ((p.ranks['v_shared_shelter'] ?? 0) > 0) {
        let best: PlayerState | null = null; let bd = 9;
        for (const a of state.players) {
          if (a === p || a.lifeState !== 'alive') continue;
          const d2 = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
          if (d2 < bd) { bd = d2; best = a; }
        }
        if (best) shieldPlayer(state, ev, best, conv.mul(B('0.2')));
      }
      return ZERO;
    }
  }
  let amount = raw.mul(pd.incomingFactor);
  // Bastion shelter fields
  for (const h of state.hazards) {
    if (h.kind === 'bastion' && (p.x - h.x) ** 2 + (p.y - h.y) ** 2 <= h.radius * h.radius) { amount = amount.mul(B('0.6')); break; }
  }
  if (!p.shield.isZero()) {
    if (p.shield.gte(amount)) { p.shield = p.shield.sub(amount); p.stats.prevented = p.stats.prevented.add(amount); amount = ZERO; }
    else { amount = amount.sub(p.shield); p.stats.prevented = p.stats.prevented.add(p.shield); p.shield = ZERO; }
  }
  if (amount.isZero()) return ZERO;
  const hpFracBefore = p.hp.ratio(p.maxHp);
  p.lastHitBy = o.source; p.lastHitAttack = o.attack; p.lastHitAmount = amount; p.lastHitHpFrac = hpFracBefore;
  p.stats.damageTaken = p.stats.damageTaken.add(amount);
  tallyTaken(state, p, amount, o);   // breakdown: damage taken by source + the recap timeline (runStats.ts)
  p.reviveProgress = 0;
  ev.push({ t: 'hit', target: p.slot, targetKind: 'player', amount: amount.toCompact(), crit: false, dtype: o.dtype, x: p.x, y: p.y, sx: o.fromX, sy: o.fromY, frac: Math.min(1, amount.ratio(p.maxHp)) });
  hooks.onPlayerDamaged(state, ev, p, { dealt: amount, attack: o.attack, source: o.source, fromX: o.fromX, fromY: o.fromY, dtype: o.dtype, hazard: !!o.hazard, srcId: o.srcId });
  if (amount.gte(p.hp)) {
    p.hp = ZERO;
    downOrKill(state, ev, p, amount, o);
  } else {
    p.hp = p.hp.sub(amount);
  }
  return amount;
}

function recordRecap(state: SimState, p: PlayerState, amount: Big, o: PlayerHitOpts, final: boolean, ev: SimEvent[]) {
  ev.push(tallyFall(state, p, amount, o, final));   // breakdown: the full recap + the live "You died to…" card (runStats.ts)
  const contributing: string[] = [];
  for (const stat of ['enemy.damage', 'enemy.attackDamage', 'player.maxHealth', 'enemy.attackFrequency', 'enemy.projectileCount', 'encounter.spawnQuantity', 'enemy.movementSpeed', 'player.armor']) {
    const fv = fateFactor(state, stat);
    if (!fv.eq(ONE)) contributing.push(`${stat} x${fv.toString()}`);
  }
  state.deathRecaps.push({
    slot: p.slot, round: state.round, tick: state.tick, attack: o.attack, source: o.source,
    amountText: amount.toCompact(), hpFracBefore: p.lastHitHpFrac, contributingFactors: contributing,
    disconnected: !p.connected, final,
  });
  if (state.deathRecaps.length > 20) state.deathRecaps.splice(0, state.deathRecaps.length - 20);
}

export function downOrKill(state: SimState, ev: SimEvent[], p: PlayerState, amount: Big, o: PlayerHitOpts) {
  p.guardTimer = 0; p.dodgeTimer = 0;
  if (p.downsThisRound < RULES.downsPerRound) {
    p.lifeState = 'downed';
    p.downsThisRound++;
    p.stats.downs++;
    p.downTimer = RULES.downedSec * (bountyRules(state).downedSecFactor ?? 1);   // "Swift Death" bounty: halved
    p.reviveProgress = 0;
    recordRecap(state, p, amount, o, false, ev);
    ev.push({ t: 'downed', slot: p.slot });
    ev.push({ t: 'domain', type: 'player_downed', payload: { slot: p.slot, round: state.round, attack: o.attack } });
    // Solo self revive: once per five-round block, automatic vulnerable channel after downing
    if (state.n === 1) {
      const block = Math.floor((state.round - 1) / RULES.soloSelfReviveBlock);
      if (p.selfReviveBlock !== block) {
        p.selfReviveBlock = block;
        p.selfReviveChannel = RULES.soloSelfReviveChannelSec;
      }
    }
  } else {
    p.lifeState = 'dead';
    recordRecap(state, p, amount, o, true, ev);
    ev.push({ t: 'dead', slot: p.slot });
    ev.push({ t: 'domain', type: 'player_dead', payload: { slot: p.slot, round: state.round, attack: o.attack } });
  }
}

export function enemyAttackDamage(state: SimState, e: EnemyState, coef: string, direct: boolean): Big {
  let d = e.damage.mul(B(coef));
  if (direct) d = d.mul(fateFactor(state, 'enemy.attackDamage'));
  return d.mul(e.cohort.count.isZero() ? ONE : e.cohort.count);
}
