import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CARDS, MECHANIC_BY_ID, cardRarity, type CardRarity } from '@cursebound/content';
import {
  B, BOON_HOOKS, applyCard, bindMechanic, buildSnapshot, cohortTotalHp, computeForecast, computeLedger, createEnemy, deserializeState, devSpawn,
  drawOffer, drawWeighted, hitEnemy, hitPlayer, killEnemy, mech, moveSpeedOf, playerDerived, seedRng, serializeState, stackMagnitudes, stateHash,
  step, stepPlayerHazard, type EnemyState, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun, runBot } from './run.helpers';

// Fate mechanics (boons.ts): every boon/bane triggers, stacks multiplicatively, stays finite and deterministic.

const ONE = Big.ONE;

/** A run sitting in round-1 combat with the arena emptied, so tests place their own foes. */
function arena(classes: string[] = ['vanguard'], seed = 'FATE_ARENA'): SimState {
  const s = newRun(classes, seed);
  for (let i = 0; i < 4000 && s.phase !== 'COMBAT'; i++) {
    const cmds = s.phase === 'LOADOUT_LOCK' ? s.players.filter((p) => !p.ready).map((p) => ({ type: 'READY' as const, slot: p.slot, ready: true })) : [];
    step(s, [], cmds);
  }
  expect(s.phase).toBe('COMBAT');
  s.enemies = []; s.projectiles = []; s.hazards = []; s.telegraphs = []; s.pendingSpawns = [];
  // no crit noise in damage comparisons
  s.fate.factors['player.critTendency'] = Big.ZERO;
  s.stateVersion++;
  return s;
}

function toVoting(classes: string[], seed = 'FATE_VOTE'): SimState {
  const s = newRun(classes, seed);
  for (let i = 0; i < 100000 && s.phase !== 'VOTING'; i++) {
    const cmds: Parameters<typeof step>[2] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'COMBAT') { for (const p of s.players) p.iframes = 10; for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0); }
    step(s, [], cmds);
  }
  return s;
}

const bind = (s: SimState, id: string, magnitude: string, copies = 1) => {
  for (let i = 0; i < copies; i++) bindMechanic(s, id, magnitude, { offerId: 'test', cardId: 'test', seq: i });
};

/** Sturdy single foe at an offset from hero 0. */
function foe(s: SimState, dx: number, dy = 0, count = ONE, hp = B('1e12')): EnemyState {
  const p = s.players[0];
  const e = devSpawn(s, 'pursuer', p.x + dx, p.y + dy, count);
  e.cohort.unitHp = hp;
  return e;
}

const strike = (s: SimState, ev: SimEvent[], e: EnemyState, dmg: Big, skillId = 'v_cleave', mult = ONE) =>
  hitEnemy(s, ev, e, dmg, mult, { dtype: 'physical', srcSlot: 0, skillId, fromX: s.players[0].x, fromY: s.players[0].y, allowCrit: false });

/** Advance one tick of the Fate machinery without the round flow: player hazards, the global tick, player ticks. */
function tick(s: SimState, ev: SimEvent[]) {
  s.tick++;
  if (s.encounter) s.encounter.activeTicks++;
  for (const h of [...s.hazards]) if (h.owner === 'player') stepPlayerHazard(s, ev, h);
  s.hazards = s.hazards.filter((h) => h.untilTick > s.tick);
  BOON_HOOKS.onTick!(s, ev);
}

const casts = (ev: SimEvent[], skill: string) => ev.filter((e) => e.t === 'cast' && e.skill === skill).length;
const lost = (e: EnemyState, before: Big) => before.sub(cohortTotalHp(e.cohort));

describe('stacking is multiplicative, never additive', () => {
  it('compound, chance and factor rules', () => {
    expect(stackMagnitudes('chain_reaction', ['0.25', '0.25']).toString()).toBe('5.625e-1');
    expect(stackMagnitudes('echo', ['0.3', '0.3']).toString()).toBe('5.1e-1');
    expect(stackMagnitudes('executioner', ['0.5', '0.5', '0.5']).toString()).toBe('8.75e-1');
    expect(stackMagnitudes('thunderous_blows', ['3', '3']).toString()).toBe('9e0');
    expect(stackMagnitudes('chain_reaction', ['0.25', '0.6']).toString()).toBe('1e0');
  });
  it('applyCard binds one copy per card with Ledger provenance', () => {
    const s = newRun(['vanguard']);
    applyCard(s, 'chain_reaction', 'o1', []);
    applyCard(s, 'chain_reaction', 'o2', []);
    applyCard(s, 'cataclysm', 'o3', []);
    expect(s.fate.mechanics!.chain_reaction.stacks).toBe(3);
    expect(mech(s, 'chain_reaction')!.toString()).toBe('1.5e0');           // 1.25 × 1.25 × 1.6 − 1
    expect(mech(s, 'volatile_dead')!.toString()).toBe('8e-2');
    expect(s.fate.factors['enemy.maxHealth'].toString()).toBe('3.24e0');
    const seqs = [...s.fate.entries.map((e) => e.seq), ...s.fate.mechanicEntries!.map((e) => e.seq)].sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i));
    const back = deserializeState(serializeState(s));
    expect(stateHash(back)).toBe(stateHash(s));
    expect(mech(back, 'chain_reaction')!.toString()).toBe('1.5e0');
  });
  it('the tutorial card applies (it lives outside the deck)', () => {
    const s = newRun(['vanguard']);
    applyCard(s, 'tutorial_twin_blades', 'o1', []);
    expect(s.fate.factors['player.damage'].toString()).toBe('2e0');
  });
});

describe('deterministic, rarity-weighted offers', () => {
  it('same seed, same offers; distinct cards per offer', () => {
    const a = newRun(['vanguard'], 'OFFERS');
    const b = newRun(['vanguard'], 'OFFERS');
    for (let i = 0; i < 60; i++) {
      const oa = drawOffer(a, 'h'), ob = drawOffer(b, 'h');
      expect(oa.cards).toEqual(ob.cards);
      expect(new Set(oa.cards).size).toBe(3);
    }
    expect(drawOffer(newRun(['vanguard'], 'OTHER'), 'h').cards).not.toEqual(drawOffer(newRun(['vanguard'], 'OFFERS'), 'h').cards);
  });
  it('first slot follows 60/30/10 and every card stays possible', () => {
    const s = newRun(['vanguard'], 'RARITY');
    const counts: Record<CardRarity, number> = { common: 0, rare: 0, mythic: 0 };
    const seen = new Set<string>();
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const o = drawOffer(s, 'h');
      counts[cardRarity(CARDS.find((c) => c.id === o.cards[0])!)]++;
      o.cards.forEach((c) => seen.add(c));
    }
    expect(Math.abs(counts.common / N - 0.6)).toBeLessThan(0.03);
    expect(Math.abs(counts.rare / N - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(counts.mythic / N - 0.1)).toBeLessThan(0.02);
    expect(seen.size).toBe(CARDS.length);
  });
  it('decks without some rarities, and unknown ids, still draw', () => {
    const rng = seedRng('x');
    const commons = CARDS.filter((c) => cardRarity(c) === 'common').map((c) => c.id);
    expect(drawWeighted(rng, commons.slice(0, 3), 3).sort()).toEqual(commons.slice(0, 3).sort());
    expect(drawWeighted(rng, ['mystery_a', 'mystery_b', 'cataclysm'], 3)).toHaveLength(3);
  });
});

describe('boons', () => {
  it('Chain Reaction: slain foes explode a heartbeat later into their neighbours', () => {
    const s = arena(); bind(s, 'chain_reaction', '0.5');
    const ev: SimEvent[] = [];
    const a = foe(s, 2, 0, ONE, B(1000)), b = foe(s, 3);
    strike(s, ev, a, B('1e6'));
    expect(a.state).toBe('dying');
    expect(s.hazards.filter((h) => h.kind === 'fate_blast')).toHaveLength(1);
    const before = cohortTotalHp(b.cohort);
    for (let i = 0; i < 12; i++) tick(s, ev);
    expect(casts(ev, 'boon_chain_reaction')).toBe(1);
    expect(lost(b, before).gt(Big.ZERO)).toBe(true);
    expect(lost(b, before).lte(B(500))).toBe(true);               // 50% of the dead foe's 1000 max health, before armor
    expect(s.hazards.some((h) => h.kind === 'fate_blast')).toBe(false);
  });
  it('Chain Reaction terminates: blasts stop after the second wave even through endless cohorts', () => {
    const s = arena(); bind(s, 'chain_reaction', '10');
    const ev: SimEvent[] = [];
    const line: EnemyState[] = [];
    for (let i = 0; i < 24; i++) line.push(foe(s, 2 + i * 2.5, 0, Big.from('1000000'), B(100)));
    strike(s, ev, line[0], B('1e300'));
    const gens = new Set<number>();
    let n = 0;
    while (s.hazards.some((h) => h.kind === 'fate_blast') && n < 300) {
      for (const h of s.hazards) if (h.kind === 'fate_blast') gens.add(h.generation);
      tick(s, ev); n++;
    }
    expect(n).toBeLessThan(300);
    expect(Math.max(...gens)).toBeLessThanOrEqual(2);
    expect(line.some((e) => e.state !== 'dying')).toBe(true);    // the chain stopped instead of eating the map
    expect(casts(ev, 'boon_chain_reaction')).toBeLessThanOrEqual(line.length);
  });
  it('Vampiric Rite heals a share of damage dealt, capped per second', () => {
    const s = arena(); bind(s, 'vampiric_rite', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    p.hp = p.maxHp.mul(B('0.5'));
    const before = p.hp;
    const r = strike(s, ev, foe(s, 1), B(10));
    expect(p.hp.toString()).toBe(before.add(r.dealt.mul(B('0.5'))).toString());
    p.hp = p.maxHp.mul(B('0.1'));
    strike(s, ev, foe(s, 1.2), B('1e9'));
    strike(s, ev, foe(s, 1.4), B('1e9'));
    expect(p.hp.ratio(p.maxHp)).toBeLessThanOrEqual(0.1 + 0.12 + 1e-9);   // ≤ 12% of max health per second
  });
  it('Thunderous Blows: every 5th hit calls lightning; copies multiply its damage', () => {
    const run = (copies: number) => {
      const s = arena(); bind(s, 'thunderous_blows', '3', copies);
      const ev: SimEvent[] = [];
      const a = foe(s, 1), b = foe(s, 1.5);
      const before = cohortTotalHp(b.cohort);
      for (let i = 0; i < 5; i++) strike(s, ev, a, B(1));
      expect(casts(ev, 'boon_thunderous_blows')).toBe(1);
      for (let i = 0; i < 4; i++) strike(s, ev, a, B(1));
      expect(casts(ev, 'boon_thunderous_blows')).toBe(1);
      return lost(b, before);
    };
    const one = run(1), two = run(2);
    expect(one.gt(Big.ZERO)).toBe(true);
    expect(two.div(one).toNumber()).toBeCloseTo(3, 9);
  });
  it('Splitting Shots: projectile hits fork into the nearest foes; shards never fork; melee does nothing', () => {
    const s = arena(['arcanist']); bind(s, 'splitting_shots', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const a = foe(s, 2), b = foe(s, 3), c = foe(s, 3.5), far = foe(s, 30);
    s.projectiles.push({ id: 999, kind: 'spark', owner: 'player', ownerId: 0, x: a.x, y: a.y, vx: 1, vy: 0, radius: 0.2, range: 5, damage: B(100), weight: B(3), dtype: 'ember', pierce: 0, hitIds: [a.id], skillId: 'a_spark', crit: false, lobTarget: null, bornTick: s.tick });
    const bB = cohortTotalHp(b.cohort), cB = cohortTotalHp(c.cohort), fB = cohortTotalHp(far.cohort);
    hitEnemy(s, ev, a, B(100), B(3), { dtype: 'ember', srcSlot: 0, skillId: 'a_spark', fromX: p.x, fromY: p.y, allowCrit: false });
    expect(casts(ev, 'boon_splitting_shots')).toBe(2);
    expect(lost(b, bB).gt(Big.ZERO) && lost(c, cB).gt(Big.ZERO)).toBe(true);
    expect(lost(far, fB).isZero()).toBe(true);
    const m = arena(['vanguard']); bind(m, 'splitting_shots', '0.5');
    const ev2: SimEvent[] = [];
    foe(m, 3); strike(m, ev2, foe(m, 2), B(10));
    expect(casts(ev2, 'boon_splitting_shots')).toBe(0);
  });
  it('Bloodrush: kills grant a movement buff and extra attack work', () => {
    const s = arena(); bind(s, 'bloodrush', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const base = moveSpeedOf(s, p);
    strike(s, ev, foe(s, 1, 0, ONE, B(10)), B(1000));
    expect(p.buffs.some((b) => b.id === 'bloodrush')).toBe(true);
    expect(moveSpeedOf(s, p)).toBeCloseTo(base * 1.5, 9);
    p.attackWork = 0;
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(p.attackWork).toBeCloseTo(playerDerived(s, p).attackFreq.toNumber() / 60 * 0.5, 9);
    expect(casts(ev, 'boon_bloodrush')).toBe(1);
  });
  it('Soul Harvest restores resource per kill', () => {
    const s = arena(); bind(s, 'soul_harvest', '0.12');
    const p = s.players[0]; p.resource = 0;
    strike(s, [], foe(s, 1, 0, ONE, B(10)), B(1000));
    expect(p.resource).toBeCloseTo(playerDerived(s, p).resourceMax * 0.12, 9);
  });
  it('Echo refunds charges by the seeded combat stream (deterministic)', () => {
    const count = (bound: boolean) => {
      const s = arena(); if (bound) bind(s, 'echo', '0.6');
      const p = s.players[0]; const ev: SimEvent[] = [];
      const sig = p.skills[p.skills.length - 1];
      let refunds = 0;
      for (let i = 0; i < 200; i++) { sig.charges = 0; BOON_HOOKS.onCast!(s, ev, p, sig.skillId); refunds += sig.charges; }
      return refunds;
    };
    const a = count(true);
    expect(a).toBe(count(true));
    expect(a).toBeGreaterThan(90); expect(a).toBeLessThan(150);
    expect(count(false)).toBe(0);
  });
  it('Executioner: lone foes, cohort front units, worn-down cohorts; never bosses', () => {
    const s = arena(); bind(s, 'executioner', '0.2');
    const ev: SimEvent[] = [];
    const low = foe(s, 1, 0, ONE, B(1000)); low.cohort.front = B(850);
    strike(s, ev, low, B(1));
    expect(low.state).toBe('dying');
    const ok = foe(s, 1, 0, ONE, B(1000)); ok.cohort.front = B(500);
    strike(s, ev, ok, B(1));
    expect(ok.state).not.toBe('dying');
    const pack = foe(s, 1, 0, B(10), B(1000)); pack.cohort.front = B(850);
    strike(s, ev, pack, B(1));
    expect(pack.cohort.count.toString()).toBe('9e0');
    expect(pack.cohort.front.isZero()).toBe(true);
    const worn = foe(s, 1, 0, B(10), B(1000)); worn.cohort.spread = B(850);
    hitEnemy(s, ev, worn, B(1), ONE, { dtype: 'physical', srcSlot: 0, skillId: 'v_cleave', fromX: s.players[0].x, fromY: s.players[0].y, allowCrit: false, coverage: 1 });
    expect(worn.state).toBe('dying');
    const boss = createEnemy(s, 'prismstag', s.players[0].x + 2, s.players[0].y, ONE, { boss: true, objective: false, groupId: -1, summonerId: null });
    s.enemies.push(boss);
    boss.cohort.front = boss.cohort.unitHp.mul(B('0.95'));
    strike(s, ev, boss, B(1));
    expect(boss.state).not.toBe('dying');
    expect(casts(ev, 'boon_executioner')).toBe(3);
  });
  it('Phoenix cheats death once per round', () => {
    const s = arena(); bind(s, 'phoenix', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const lethal = () => hitPlayer(s, ev, p, p.maxHp.mul(B(1000)), { attack: 'test', source: 'test', fromX: p.x, fromY: p.y, dtype: 'physical' });
    lethal();
    expect(p.lifeState).toBe('alive');
    expect(p.hp.toString()).toBe(p.maxHp.mul(B('0.5')).toString());
    expect(p.iframes).toBeGreaterThanOrEqual(2);
    p.iframes = 0;
    lethal();
    expect(p.lifeState).toBe('downed');
    // next round it works again
    s.round++;
    p.lifeState = 'alive'; p.hp = p.maxHp; p.downsThisRound = 0; p.iframes = 0;
    lethal();
    expect(p.lifeState).toBe('alive');
    expect(casts(ev, 'boon_phoenix')).toBe(2);
  });
  it('Phoenix survives absurd hits that absorb the kept health', () => {
    const s = arena(); bind(s, 'phoenix', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    hitPlayer(s, ev, p, B('1e400'), { attack: 'test', source: 'test', fromX: p.x, fromY: p.y, dtype: 'physical' });
    expect(p.lifeState).toBe('alive');
    BOON_HOOKS.onTick!(s, ev);
    expect(p.hp.toString()).toBe(p.maxHp.mul(B('0.5')).toString());
  });
  it('Static Trail: dodging leaves damaging static', () => {
    const s = arena(); bind(s, 'static_trail', '1');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const e = foe(s, 0.2);
    BOON_HOOKS.onDodge!(s, ev, p);
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(s.hazards.filter((h) => h.kind === 'fate_trail').length).toBe(1);
    const before = cohortTotalHp(e.cohort);
    for (let i = 0; i < 30; i++) tick(s, ev);
    expect(lost(e, before).gt(Big.ZERO)).toBe(true);
  });
  it('Retribution: taking damage blasts nearby foes', () => {
    const s = arena(); bind(s, 'retribution', '3');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const e = foe(s, 1), far = foe(s, 20);
    const before = cohortTotalHp(e.cohort), fb = cohortTotalHp(far.cohort);
    hitPlayer(s, ev, p, B(100), { attack: 'test', source: 'test', fromX: p.x, fromY: p.y, dtype: 'physical' });
    expect(lost(e, before).gt(Big.ZERO)).toBe(true);
    expect(lost(far, fb).isZero()).toBe(true);
  });
  it('Warding Rune grants a shield on its cadence', () => {
    const s = arena(); bind(s, 'warding_rune', '0.2');
    const p = s.players[0]; const ev: SimEvent[] = [];
    p.shield = Big.ZERO; p.vars.boon_ward_next = 0;
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(p.shield.ratio(p.maxHp)).toBeCloseTo(0.2, 9);
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(casts(ev, 'boon_warding_rune')).toBe(1);
  });
});

describe('banes', () => {
  it('Volatile Dead: kills leave a telegraphed pool that burns heroes', () => {
    const s = arena(); bind(s, 'volatile_dead', '0.1');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const e = foe(s, 0.3, 0, ONE, B(10));
    strike(s, ev, e, B(1000));
    expect(s.hazards.filter((h) => h.kind === 'fate_pyre')).toHaveLength(1);
    expect(s.telegraphs.some((t) => t.attack === 'Volatile Dead')).toBe(true);
    const full = p.maxHp;
    for (let i = 0; i < 47; i++) tick(s, ev);
    expect(p.hp.toString()).toBe(full.toString());                 // still telegraphing
    tick(s, ev);
    expect(1 - p.hp.ratio(p.maxHp)).toBeCloseTo(0.1, 6);
  });
  it('Hexed Ground: curse circles appear under heroes and erupt after the telegraph', () => {
    const s = arena(); bind(s, 'hexed_ground', '0.3');
    const p = s.players[0]; const ev: SimEvent[] = [];
    s.encounter!.activeTicks = 179;
    tick(s, ev);
    const hex = s.hazards.filter((h) => h.kind === 'fate_hex');
    expect(hex).toHaveLength(1);
    expect(s.telegraphs.some((t) => t.attack === 'Hexed Ground')).toBe(true);
    p.x = hex[0].x; p.y = hex[0].y;
    for (let i = 0; i < 72; i++) tick(s, ev);
    expect(casts(ev, 'bane_hexed_ground')).toBe(1);
    expect(1 - p.hp.ratio(p.maxHp)).toBeCloseTo(0.3, 6);
  });
  it('Relentless: foes below 30% enrage once; healthy cohorts do not', () => {
    const s = arena(); bind(s, 'relentless', '0.5');
    const ev: SimEvent[] = [];
    const hurt = foe(s, 2, 0, ONE, B(1000)); hurt.cohort.front = B(800);
    const pack = foe(s, 3, 0, B(10), B(1000)); pack.cohort.front = B(900);
    const f0 = hurt.attackFreq, s0 = hurt.moveSpeed;
    s.tick = 599; tick(s, ev);                                      // tick 600 is a check tick
    expect(hurt.attackFreq.toString()).toBe(f0.mul(B('1.5')).toString());
    expect(hurt.moveSpeed).toBeCloseTo(s0 * 1.5, 9);
    expect(pack.fateVars?.enraged).toBeUndefined();
    for (let i = 0; i < 12; i++) tick(s, ev);
    expect(hurt.attackFreq.toString()).toBe(f0.mul(B('1.5')).toString());   // once
  });
  it('The Hunt: the Reaper rises, stalks the nearest hero and strikes on a cooldown', () => {
    const s = arena(); bind(s, 'the_hunt', '0.4');
    const p = s.players[0]; const ev: SimEvent[] = [];
    s.encounter!.activeTicks = 359;
    tick(s, ev);
    const reaper = s.hazards.find((h) => h.kind === 'fate_reaper')!;
    expect(reaper).toBeTruthy();
    const d0 = Math.hypot(reaper.x - p.x, reaper.y - p.y);
    tick(s, ev);
    expect(Math.hypot(reaper.x - p.x, reaper.y - p.y)).toBeLessThan(d0);
    reaper.x = p.x + 0.5; reaper.y = p.y;
    tick(s, ev);
    expect(1 - p.hp.ratio(p.maxHp)).toBeCloseTo(0.4, 6);
    const hp1 = p.hp;
    tick(s, ev);
    expect(p.hp.toString()).toBe(hp1.toString());                  // strike cooldown
    for (let i = 0; i < 60; i++) tick(s, ev);
    expect(p.hp.lt(hp1)).toBe(true);
  });
  it('Blood Moon: enemy damage compounds every 10 s; late spawns catch up', () => {
    const s = arena(); bind(s, 'blood_moon', '0.15');
    const ev: SimEvent[] = [];
    const e = foe(s, 2);
    const d0 = e.damage;
    s.encounter!.activeTicks = 599; tick(s, ev);
    expect(e.damage.toString()).toBe(d0.mul(B('1.15')).toString());
    s.encounter!.activeTicks = 1199; tick(s, ev);
    expect(e.damage.toString()).toBe(d0.mul(B('1.15')).mul(B('1.15')).toString());
    const late = foe(s, 3);
    tick(s, ev);
    expect(late.damage.toString()).toBe(d0.mul(B('1.15').powInt(2)).toString());
    expect(casts(ev, 'bane_blood_moon')).toBe(2);
  });
  it('Brittle: the first hit after a dodge deals extra damage, once', () => {
    const s = arena(); bind(s, 'brittle', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const hit = () => hitPlayer(s, ev, p, B(100), { attack: 'test', source: 'test', fromX: p.x, fromY: p.y, dtype: 'physical' });
    BOON_HOOKS.onDodge!(s, ev, p);
    const h0 = p.hp;
    const dealt = hit();
    expect(h0.sub(p.hp).ratio(dealt.mul(B('1.5')))).toBeCloseTo(1, 12);
    const h1 = p.hp;
    const d2 = hit();
    expect(h1.sub(p.hp).ratio(d2)).toBeCloseTo(1, 12);
    expect(casts(ev, 'bane_brittle')).toBe(1);
  });
});

describe('Forecast and Ledger describe mechanics', () => {
  it('new vs stronger, plain numbers, generic applicability', () => {
    const s = toVoting(['vanguard']);
    s.offer!.cards = ['splitting_shots', 'chain_reaction', 'cataclysm'];
    let fc = computeForecast(s)!;
    const [split, chain, cata] = fc.cards;
    expect(split.mechanics[0].applicable).toBe(false);                // vanguard fires no projectiles yet
    expect(split.consequence).toMatch(/does nothing/);
    expect(chain.rarity).toBe('rare');
    expect(chain.positive).toBeNull();
    expect(chain.negative!.stat).toBe('enemy.maxHealth');
    expect(chain.mechanics[0]).toMatchObject({ id: 'chain_reaction', kind: 'boon', change: 'New rule', value: { before: null, after: '25%' }, stacks: { before: 0, after: 1 } });
    expect(chain.mechanics[0].short).toBe('Slain foes explode for 25% of their max HP');
    expect(chain.mechanics[0].details.length).toBeGreaterThan(0);
    expect(cata.rarity).toBe('mythic');
    expect(cata.mechanics.map((m) => m.side)).toEqual(['gift', 'price']);
    expect(cata.positive && cata.negative).toBeTruthy();
    expect(JSON.stringify(fc)).not.toMatch(/Infinity|NaN/);
    applyCard(s, 'chain_reaction', 'x', []);
    fc = computeForecast(s)!;
    expect(fc.cards[1].mechanics[0]).toMatchObject({ value: { before: '25%', after: '56.25%' }, stacks: { before: 1, after: 2 } });
    expect(fc.cards[1].mechanics[0].change).toMatch(/Stronger/);
    expect(fc.cards[2].mechanics[0].value).toEqual({ before: '25%', after: '100%' });
    const arc = toVoting(['arcanist']);
    arc.offer!.cards = ['splitting_shots', 'chain_reaction', 'mirrorstorm'];
    const fa = computeForecast(arc)!;
    expect(fa.cards[0].mechanics[0].applicable).toBe(true);
    expect(fa.cards[2].positive!.applicable).toBe(true);
  });
  it('bane forecasts warn about lethal bindings', () => {
    const s = toVoting(['vanguard']);
    bind(s, 'hexed_ground', '0.5', 2);                                  // 125% now; Stormcaller adds a 35% copy
    s.offer!.cards = ['stormcaller', 'blood_pact', 'mirrorstorm'];
    const fc = computeForecast(s)!;
    expect(fc.cards[0].mechanics[1].id).toBe('hexed_ground');
    expect(fc.cards[0].warnings.join(' ')).toMatch(/eruption downs a hero/);
  });
  it('Ledger lists bound mechanics with stack counts, effective magnitude and sources', () => {
    const s = newRun(['vanguard']);
    applyCard(s, 'chain_reaction', 'o1', []);
    applyCard(s, 'chain_reaction', 'o2', []);
    applyCard(s, 'cataclysm', 'o3', []);
    const l = computeLedger(s);
    const chain = l.mechanics.find((m) => m.id === 'chain_reaction')!;
    expect(chain).toMatchObject({ stacks: 3, value: '150%', kind: 'boon' });
    expect(chain.sources).toEqual([{ cardId: 'chain_reaction', count: 2, magnitude: '0.25' }, { cardId: 'cataclysm', count: 1, magnitude: '0.6' }]);
    expect(l.mechanics.find((m) => m.id === 'volatile_dead')).toMatchObject({ stacks: 1, value: '8%', kind: 'bane' });
    expect(l.mechanicTimeline).toHaveLength(4);
    expect(MECHANIC_BY_ID[l.mechanics[0].id].kind).toBe('boon');
  });
});

describe('mechanics in the real loop', () => {
  it('a bot run with every mechanic bound is deterministic and never produces NaN/Infinity', () => {
    const mk = () => {
      const s = newRun(['vanguard', 'arcanist'], 'MECH_LOOP');
      for (const [id, m] of [['chain_reaction', '0.25'], ['vampiric_rite', '0.05'], ['thunderous_blows', '3'], ['splitting_shots', '0.5'], ['bloodrush', '0.5'],
        ['soul_harvest', '0.1'], ['echo', '0.3'], ['executioner', '0.15'], ['phoenix', '0.5'], ['static_trail', '0.5'], ['retribution', '3'], ['warding_rune', '0.2'],
        ['volatile_dead', '0.02'], ['hexed_ground', '0.05'], ['relentless', '0.5'], ['the_hunt', '0.05'], ['blood_moon', '0.1'], ['brittle', '0.5']] as const) bind(s, id, m);
      return runBot(s, { maxTicks: 60 * 60 });
    };
    const a = mk(), b = mk();
    expect(stateHash(a)).toBe(stateHash(b));
    expect(JSON.stringify(buildSnapshot(a))).not.toMatch(/Infinity|NaN/);
    expect(a.round).toBeGreaterThanOrEqual(1);
  });
});
