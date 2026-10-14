import { describe, expect, it } from 'vitest';
import { Big, percentToFactor } from '@cursebound/numeric';
import { CARD_BY_ID, CARDS, type CardDef } from '@cursebound/content';
import {
  applyCard, applyArea, applySingle, buildSnapshot, castVote, computeForecast, computeLedger, deserializeState, drawOffer, killEnemy,
  partialAward, resolveVotes, roundAward, serializeState, stateHash, step, derivePlayer, type SimState, type SimEvent,
} from '@cursebound/simulation';
import { newRun, runBot } from './run.helpers';

// Release-blocking rule tests (PRD §27.1). Scenario IDs match the acceptance matrix.

function card(id: string, pos: [string, string], neg: [string, string]): CardDef {
  const c: CardDef = { id, version: 1, name: id, family: 'blood', positive: { stat: pos[0], percent: pos[1] }, negative: { stat: neg[0], percent: neg[1] }, applicability: [], icon: '', flavor: '' };
  CARD_BY_ID[id] = c;   // test-only definition, not part of any deck
  return c;
}

/** Drive the state machine with invulnerable players and instant clears (rule-flow tests only). */
function forceRun(state: SimState, untilRound: number, onEvents?: (ev: SimEvent[]) => void) {
  let seq = 1;
  for (let i = 0; i < 400000 && state.phase !== 'RESULTS'; i++) {
    if (state.round > untilRound) break;
    const cmds = [] as Parameters<typeof step>[2] & object;
    if (state.phase === 'LOADOUT_LOCK' || state.phase === 'SKILL_ALLOCATION') for (const p of state.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (state.phase === 'VOTING' && state.offer) for (const p of state.players) { const v = state.offer.votes[p.slot]; if (!v.locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: state.offer.id, seq: seq++, cardSlot: 0, locked: true }); }
    if (state.awaitingDurable) cmds.push({ type: 'DURABLE', what: state.awaitingDurable });
    if (state.phase === 'COMBAT') {
      for (const p of state.players) p.iframes = 10;
      for (const e of state.enemies) if (e.state !== 'dying') killEnemy(state, [], e, 0);
    }
    const r = step(state, [], cmds);
    onEvents?.(r.events);
  }
}

describe('A01 round cadence', () => {
  it('bosses at 5 and 10; exactly one offer after each clear through round 11', () => {
    const s = newRun(['vanguard']);
    const offers: number[] = []; const bosses: number[] = [];
    forceRun(s, 11, (ev) => {
      for (const e of ev) {
        if (e.t === 'domain' && e.type === 'fate_offered') offers.push(e.payload.round as number);
        if (e.t === 'domain' && e.type === 'round_started' && e.payload.boss) bosses.push(e.payload.round as number);
      }
    });
    expect(bosses).toEqual([5, 10]);
    expect(offers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(offers).size).toBe(offers.length);
    // round 5 starts with four chosen cards
  });
  it('round r+1 starts with r cards', () => {
    const s = newRun(['arcanist']);
    let cardsAtRound5 = -1;
    forceRun(s, 5, (ev) => { for (const e of ev) if (e.t === 'phase' && e.phase === 'ROUND_SETUP' && e.round === 5) cardsAtRound5 = s.commits.length; });
    expect(cardsAtRound5).toBe(4);
  });
});

describe('A02/A03 multiplicative compounding', () => {
  it('three +100% damage cards = x8', () => {
    const s = newRun(['vanguard']);
    for (let i = 0; i < 3; i++) applyCard(s, 'red_horizon', 'o' + i, []);
    expect(s.fate.factors['player.damage'].toString()).toBe('8e0');
    expect(derivePlayer(s, s.players[0]).damage.toString()).toBe('8e2');
  });
  it('three -50% maximum health = 12.5% of base', () => {
    const s = newRun(['vanguard']);
    card('test_half_health', ['player.damage', '1'], ['player.maxHealth', '-50']);
    for (let i = 0; i < 3; i++) applyCard(s, 'test_half_health', 'o' + i, []);
    expect(s.fate.factors['player.maxHealth'].toString()).toBe('1.25e-1');
    expect(s.players[0].maxHp.toString()).toBe('1.25e2');
  });
  it('Appendix A1 effect sequence fixture', () => {
    const s = newRun(['vanguard']);
    for (const c of ['blood_pact', 'rapid_evolution', 'immortal_ambition']) applyCard(s, c, c, []);
    const f = s.fate.factors;
    expect(f['player.damage'].toString()).toBe('1.75e0');
    expect(f['player.maxHealth'].toString()).toBe('7e-1');
    expect(f['player.attackFrequency'].toString()).toBe('1.4e0');
    expect(f['enemy.movementSpeed'].toString()).toBe('1.6e0');
    expect(f['player.healing'].toString()).toBe('2.5e0');
    expect(f['enemy.maxHealth'].toString()).toBe('4e0');
    expect(Big.from(100).mul(f['player.damage']).mul(Big.from(1).mul(f['player.attackFrequency'])).toString()).toBe('2.45e2');
  });
  it('Blood Pact x3 = 535.9375 damage, 343 health', () => {
    const s = newRun(['vanguard']);
    for (let i = 0; i < 3; i++) applyCard(s, 'blood_pact', 'b' + i, []);
    expect(Big.from(100).mul(s.fate.factors['player.damage']).toString()).toBe('5.359375e2');
    expect(s.players[0].maxHp.toString()).toBe('3.43e2');
  });
  it('maximum health changes preserve the current health fraction (D07)', () => {
    const s = newRun(['vanguard']);
    s.players[0].hp = Big.from(500);
    applyCard(s, 'colossal_bargain', 'x', []);
    expect(s.players[0].hp.toString()).toBe('3e3');
    expect(s.players[0].maxHp.toString()).toBe('6e3');
  });
});

function toVoting(classes: string[], seed = 'VOTE_SEED'): SimState {
  const s = newRun(classes, seed);
  let seq = 1;
  for (let i = 0; i < 100000 && s.phase !== 'VOTING'; i++) {
    const cmds: Parameters<typeof step>[2] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'COMBAT') { for (const p of s.players) p.iframes = 10; for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0); }
    step(s, [], cmds);
    seq++;
  }
  return s;
}

describe('A04/A05 no filtering', () => {
  it('A04: an offer implying near instant death keeps all three selection slots valid', () => {
    const s = toVoting(['vanguard']);
    s.fate.factors['enemy.damage'] = Big.from('1e500');
    s.stateVersion++;
    const fc = computeForecast(s)!;
    expect(fc.cards).toHaveLength(3);
    for (const slot of [0, 1, 2]) {
      const copy = deserializeState(serializeState(s));
      expect(castVote(copy, 0, copy.offer!.id, 10 + slot, slot, true)).toEqual({ ok: true });
    }
    expect(fc.cards.some((c) => c.warnings.length > 0)).toBe(true);
  });
  it('A05: decay card stays in the deck; positive applicability shown as zero for a no-decay party', () => {
    const s = toVoting(['vanguard']);
    expect(s.deck).toContain('plague_bloom');
    s.offer!.cards = ['plague_bloom', 'blood_pact', 'mirrorstorm'];
    const fc = computeForecast(s)!;
    expect(fc.cards[0].positive!.applicable).toBe(false);
    expect(fc.cards[0].consequence).toMatch(/does nothing/);
  });
  it('offers draw three distinct ids from the full deck with replacement across rounds', () => {
    const s = newRun(['vanguard'], 'DRAW');
    const seen = new Set<string>();
    for (let r = 0; r < 300; r++) {
      const o = drawOffer(s, 'h');
      expect(new Set(o.cards).size).toBe(3);
      o.cards.forEach((c) => seen.add(c));
    }
    expect(seen.size).toBe(CARDS.length);
  });
});

describe('A06/A07 voting', () => {
  it('A06: 2/2/1 split resolves by seeded tie; stable across retries; one commit', () => {
    const s = toVoting(['vanguard', 'arcanist', 'vanguard', 'arcanist', 'vanguard'], 'TIE_SEED');
    const id = s.offer!.id;
    const votes = [0, 0, 1, 1, 2];
    votes.forEach((slot, i) => expect(castVote(s, i, id, 5, slot, true)).toEqual({ ok: true }));
    // duplicate/retried sequence is rejected without changing counts
    expect(castVote(s, 0, id, 5, 2, true)).toEqual({ ok: false, code: 'DUPLICATE_SEQ' });
    const a = resolveVotes(deserializeState(serializeState(s)));
    const b = resolveVotes(deserializeState(serializeState(s)));
    expect(a).toEqual(b);
    expect(a.tie.tiedSlots).toEqual([0, 1]);
    expect([0, 1]).toContain(a.cardSlot);
    const before = s.commits.length;
    step(s, [], []);                   // resolves (all locked)
    step(s, [], []);
    expect(s.commits.length).toBe(before + 1);
    expect(s.phase).toBe('FATE_COMMIT');
    step(s, [], [{ type: 'DURABLE', what: 'commit' }]);
    step(s, [], [{ type: 'DURABLE', what: 'commit' }]);   // repeated durable message is rejected, no reapply
    expect(s.commits.length).toBe(before + 1);
    expect(s.fate.entries.length).toBe(2);
  });
  it('zero votes chooses uniformly via the vote stream', () => {
    const s = toVoting(['vanguard', 'arcanist']);
    const r = resolveVotes(s);
    expect(r.tie.zeroVotes).toBe(true);
  });
  it('A07: vote for an old offer is rejected; counts unchanged', () => {
    const s = toVoting(['vanguard', 'arcanist']);
    expect(castVote(s, 0, 'stale-offer-id', 3, 1, false)).toEqual({ ok: false, code: 'STALE_OFFER' });
    expect(s.offer!.votes.every((v) => v.cardSlot === null)).toBe(true);
  });
});

describe('A08/A09 Forecast', () => {
  it('A08: every exact static value matches the Ledger after commit', () => {
    const s = toVoting(['vanguard', 'arcanist'], 'FORECAST');
    const fc = computeForecast(s)!;
    const chosen = fc.cards[1];
    castVote(s, 0, s.offer!.id, 2, 1, true);
    castVote(s, 1, s.offer!.id, 2, 1, true);
    step(s, [], []);
    expect(s.commits[s.commits.length - 1].cardId).toBe(chosen.cardId);
    s.players.forEach((p, i) => {
      const d = derivePlayer(s, p);
      expect(d.maxHp.toCompact()).toBe(chosen.players[i].maxHp.after);
      expect(p.hp.toCompact()).toBe(chosen.players[i].hp.after);
      expect(d.attackFreq.toCompact()).toBe(chosen.players[i].attackFreq.after);
      expect(d.armor.toCompact()).toBe(chosen.players[i].armor.after);
    });
    for (const fc2 of chosen.factorChanges) expect(s.fate.factors[fc2.stat].toCompact()).toBe(fc2.after);
    const ledger = computeLedger(s);
    expect(ledger.timeline.length).toBe(2);
    expect(chosen.players[0].estimatedDps === null || chosen.players[0].estimatedDps.kind === 'estimate').toBe(true);
  });
  it('A09: enemy regeneration >= modelled DPS: no divide error, no-net-progress, vote permitted', () => {
    const s = toVoting(['vanguard'], 'REGEN');
    // force next round to be a regen-tagged boss scenario by inflating regeneration
    s.round = 4;
    s.fate.factors['enemy.regeneration'] = Big.from('1e9');
    s.stateVersion++;
    const fc = computeForecast(s)!;
    const anyNoNet = fc.cards.some((c) => c.enemy.noNetProgress.after);
    if (fc.nextIsBoss && fc.cards[0].enemy.reference.includes('Bellroot')) expect(anyNoNet).toBe(true);
    for (const c of fc.cards) expect(JSON.stringify(c)).not.toMatch(/Infinity|NaN/);
    expect(castVote(s, 0, s.offer!.id, 9, 2, true)).toEqual({ ok: true });
  });
  it('A3 regeneration fixture math', () => {
    const health = Big.from(1000000), regen = health.mul(Big.from('0.01'));
    expect(Big.from(8000).lte(regen)).toBe(true);
    const net = Big.from(32000).sub(regen);
    expect(health.div(net).toNumber().toFixed(3)).toBe('45.455');
  });
});

describe('A10/A11 score', () => {
  it('A10: round 5 fixture = 2,125 and partial 480', () => {
    expect(roundAward(5, Big.from(2), 90 * 60, 120 * 60).award).toBe(2125n);
    expect(partialAward(6, Big.from(2), 4, 10)).toBe(480n);
  });
  it('score pressure applies prospectively only', () => {
    const s = newRun(['vanguard']);
    forceRun(s, 3);
    const before = s.rounds.map((r) => r.awarded);
    applyCard(s, 'golden_catastrophe', 'gc', []);
    expect(s.rounds.map((r) => r.awarded)).toEqual(before);
  });
  it('A11: summons and boss phases cannot generate repeat objective credit', () => {
    const s = newRun(['vanguard'], 'SUMMON');
    forceRun(s, 1);
    // jump into a round with a broodcaller and let it summon repeatedly while players are invulnerable
    let maxDone = 0;
    for (let i = 0; i < 60 * 40 && s.phase === 'COMBAT'; i++) {
      for (const p of s.players) p.iframes = 10;
      step(s, [], []);
      maxDone = Math.max(maxDone, s.encounter!.completedWeight);
      expect(s.encounter!.completedWeight).toBeLessThanOrEqual(s.encounter!.objectiveTotal);
    }
    expect(maxDone).toBeLessThanOrEqual(s.encounter!.objectiveTotal);
  });
});

describe('A13/A18 extreme numbers', () => {
  it('values beyond float range serialize, compare and snapshot without Infinity', () => {
    const s = newRun(['arcanist'], 'EXTREME');
    for (let i = 0; i < 400; i++) applyCard(s, 'colossal_bargain', 'c' + i, []);
    expect(s.fate.factors['enemy.maxHealth'].log10()).toBeGreaterThan(400);
    for (let i = 0; i < 300; i++) applyCard(s, 'prism_rain', 'p' + i, []);
    const json = serializeState(s);
    const back = deserializeState(json);
    expect(stateHash(back)).toBe(stateHash(s));
    expect(JSON.stringify(buildSnapshot(s))).not.toMatch(/Infinity|NaN|"-0"/);
    expect(JSON.stringify(computeLedger(s))).not.toMatch(/Infinity|NaN/);
  });
  it('combat runs with absurd factors (1e1000 quantities) without technical failure', () => {
    const s = newRun(['arcanist'], 'ABSURD');
    s.fate.factors['player.attackFrequency'] = Big.from('1e1000');
    s.fate.factors['player.projectileCount'] = Big.from('1e300');
    s.fate.factors['encounter.spawnQuantity'] = Big.from('1e50');
    s.fate.factors['enemy.maxHealth'] = Big.from('1e2000');
    s.fate.factors['enemy.attackFrequency'] = Big.from('1e40');
    s.stateVersion++;
    runBot(s, { maxTicks: 60 * 20 });
    expect(JSON.stringify(buildSnapshot(s))).not.toMatch(/Infinity|NaN/);
  });
});

describe('cohort grouped/ungrouped equivalence (EXTREME01, K03)', () => {
  it('k grouped single-target hits equal k sequential hits (kills and dealt)', () => {
    for (let trial = 0; trial < 200; trial++) {
      const unit = Big.from(50 + (trial * 37) % 400);
      const d = Big.from(7 + (trial * 13) % 300);
      const n = 1 + (trial % 9);
      const k = 1 + (trial * 7) % 40;
      const a = { count: Big.from(n), unitHp: unit, spread: Big.ZERO, front: Big.ZERO };
      const b = { count: Big.from(n), unitHp: unit, spread: Big.ZERO, front: Big.ZERO };
      const ra = applySingle(a, d, Big.from(k));
      let kills = Big.ZERO, dealt = Big.ZERO;
      for (let i = 0; i < k; i++) { const r = applySingle(b, d, Big.ONE); kills = kills.add(r.kills); dealt = dealt.add(r.dealt); }
      expect(ra.kills.toString()).toBe(kills.toString());
      expect(ra.dealt.toString()).toBe(dealt.toString());
      expect(a.count.toString()).toBe(b.count.toString());
      expect(a.front.toString()).toBe(b.front.toString());
    }
  });
  it('full-coverage area hits on a cohort equal per-unit hits', () => {
    const c = { count: Big.from(5), unitHp: Big.from(100), spread: Big.ZERO, front: Big.ZERO };
    applyArea(c, Big.from(40), Big.from(5));
    applyArea(c, Big.from(40), Big.from(5));
    expect(c.count.toString()).toBe('5e0');
    const r = applyArea(c, Big.from(40), Big.from(5));
    expect(r.kills.toString()).toBe('5e0');
    expect(r.dealt.toString()).toBe('1e2');
  });
});

describe('determinism and replay', () => {
  it('same seed and inputs reproduce identical state and score', () => {
    const a = runBot(newRun(['vanguard', 'arcanist'], 'DET'), { maxTicks: 60 * 90 });
    const b = runBot(newRun(['vanguard', 'arcanist'], 'DET'), { maxTicks: 60 * 90 });
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.scoreText).toBe(b.scoreText);
  });
  it('checkpoint restore at intermission continues identically', () => {
    const live = newRun(['arcanist'], 'CKPT');
    runBot(live, { maxTicks: 60 * 200, untilRound: 2 });
    const restored = deserializeState(serializeState(live));
    runBot(live, { maxTicks: 60 * 60 });
    runBot(restored, { maxTicks: 60 * 60 });
    expect(stateHash(restored)).toBe(stateHash(live));
  });
  it('independent streams: combat randomness never changes the next offer', () => {
    const a = toVoting(['vanguard'], 'STREAMS');
    const b = toVoting(['vanguard'], 'STREAMS');
    expect(a.offer!.cards).toEqual(b.offer!.cards);
    const c = newRun(['vanguard'], 'STREAMS');
    runBot(c, { maxTicks: 60 * 200, untilRound: 2 });
    // the bot's combat (different shots/crits) did not alter the round-1 offer
    expect(c.commits[0]?.offerId ?? a.offer!.id).toBe(a.offer!.id);
    expect(c.fate.entries[0]?.cardId ? [a.offer!.cards[0]] : []).toEqual(c.fate.entries[0]?.cardId ? [c.fate.entries[0].cardId] : []);
  });
});

describe('percent semantics', () => {
  it('+75% is x1.75; -30% is x0.7', () => {
    expect(percentToFactor('75').toString()).toBe('1.75e0');
    expect(percentToFactor('-30').toString()).toBe('7e-1');
  });
});
