import { describe, expect, it } from 'vitest';
import { FATES_BLESSING, LEGENDARIES, MAX_BLESSINGS, cardById, cardMechanics, cardStatEffects } from '@cursebound/content';
import {
  buildSnapshot, chooseLegendary, computeForecast, computeLedger, deserializeState, dropLegendary, killEnemy, seedRng, serializeState, stateHash, step,
  type Command, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Fate's Blessing (blessing.ts): a legendary consumable in the legendary drop pool, picked up into the finder's pack,
// spent during the door vote to lift exactly one card's price (negative stat and bane), validated and replay-safe.

const idle = (s: SimState): PlayerInput[] => s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 }));

/** Drive to VOTING of `round` with invulnerable heroes and instant clears (earlier votes lock card 0). */
function toVoting(s: SimState, round = 1): SimState {
  let seq = 1;
  for (let i = 0; i < 200000 && s.phase !== 'RESULTS'; i++) {
    if (s.phase === 'VOTING' && s.round >= round) return s;
    const cmds: Command[] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'VOTING' && s.offer) for (const p of s.players) if (!s.offer.votes[p.slot].locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: seq++, cardSlot: 0, locked: true });
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    if (s.phase === 'COMBAT') {
      for (const p of s.players) p.iframes = 10;
      for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    }
    step(s, [], cmds);
  }
  return s;
}

/** Lock every hero's vote on `card` and step until the commit lands. */
function commitCard(s: SimState, card: number): SimEvent[] {
  const evs: SimEvent[] = [];
  const offer = s.offer!;
  const r = step(s, idle(s), s.players.map((p, i) => ({ type: 'VOTE', slot: p.slot, offerId: offer.id, seq: 100 + i, cardSlot: card, locked: true })));
  evs.push(...r.events);
  for (let i = 0; i < 10 && s.phase === 'VOTING'; i++) evs.push(...step(s, idle(s), []).events);
  return evs;
}

/** The first offer slot whose card carries both a stat price and a bane, else any priced card. */
function pricedSlot(s: SimState): number {
  const cards = s.offer!.cards.map((id) => cardById(id)!);
  const both = cards.findIndex((c) => c.negative && c.bane);
  return both >= 0 ? both : cards.findIndex((c) => c.negative || c.bane);
}

describe("Fate's Blessing", () => {
  it('is one more entry of the legendary drop pool (same chance as any single legendary)', () => {
    const s = newRun(['vanguard'], 'BLESS_POOL');
    const counts = new Map<string, number>();
    s.rng.loot = seedRng('BLESS_POOL', 'probe');
    const N = 20000;
    for (let i = 0; i < N; i++) { const id = chooseLegendary(s)!; counts.set(id, (counts.get(id) ?? 0) + 1); }
    const pool = LEGENDARIES.filter((d) => !d.classId || d.classId === 'vanguard').length + 1;
    const blessing = counts.get(FATES_BLESSING.id) ?? 0;
    expect(blessing / N).toBeGreaterThan(0.7 / pool);
    expect(blessing / N).toBeLessThan(1.3 / pool);
  });

  it('drops on the ground and goes into the finder\'s pack (capped)', () => {
    const s = newRun(['vanguard', 'arcanist'], 'BLESS_PICK');
    for (let i = 0; i < 400 && s.phase !== 'COMBAT'; i++) step(s, [], s.players.map((p) => ({ type: 'READY', slot: p.slot, ready: true }) as Command));
    for (let i = 0; i < 300; i++) step(s, idle(s), []);   // past the boss-free round start
    const finder = s.players[1];
    const ev: SimEvent[] = [];
    const it = dropLegendary(s, ev, finder.x, finder.y, 'enemy', FATES_BLESSING.id)!;
    expect(it.itemId).toBe(FATES_BLESSING.id);
    expect(ev.some((e) => e.t === 'loot' && e.itemId === FATES_BLESSING.id)).toBe(true);
    expect(buildSnapshot(s).lt.some((l) => l.it === FATES_BLESSING.id)).toBe(true);
    finder.x = it.x; finder.y = it.y;
    s.players[0].x = it.x + 5; s.players[0].y = it.y;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60 && (finder.bless ?? 0) === 0; i++) evs.push(...step(s, [], []).events);
    expect(finder.bless).toBe(1);
    expect(s.players[0].bless).toBeUndefined();
    expect(evs.some((e) => e.t === 'blessing' && e.op === 'pickup' && e.slot === 1)).toBe(true);
    expect(s.loot!.some((l) => l.itemId === FATES_BLESSING.id)).toBe(false);
    expect(buildSnapshot(s).players[1].bl).toBe(1);
    // a full pack leaves it for an ally
    finder.bless = MAX_BLESSINGS;
    const it2 = dropLegendary(s, [], finder.x, finder.y, 'enemy', FATES_BLESSING.id)!;
    finder.x = it2.x; finder.y = it2.y;
    for (let i = 0; i < 60; i++) step(s, [], []);
    expect(finder.bless).toBe(MAX_BLESSINGS);
    expect(s.loot!.some((l) => l.id === it2.id)).toBe(true);
  });

  it('BLESS is validated: phase, offer, a held blessing, one per card, a card with a price', () => {
    const s = newRun(['vanguard'], 'BLESS_VALID');
    const bless = (offerId: string, cardSlot: number) => step(s, idle(s), [{ type: 'BLESS', slot: 0, offerId, cardSlot }]).outcomes[0];
    for (let i = 0; i < 400 && s.phase !== 'COMBAT'; i++) step(s, [], [{ type: 'READY', slot: 0, ready: true }]);
    s.players[0].bless = 2;
    expect(bless('x', 0)).toMatchObject({ ok: false, code: 'STALE_PHASE' });
    toVoting(s);
    const offer = s.offer!;
    expect(bless('wrong-offer', 0)).toMatchObject({ ok: false, code: 'STALE_OFFER' });
    expect(bless(offer.id, 3)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const slot = pricedSlot(s);
    expect(bless(offer.id, slot)).toMatchObject({ ok: true });
    expect(s.players[0].bless).toBe(1);
    expect(bless(offer.id, slot)).toMatchObject({ ok: false, code: 'ALREADY_BLESSED' });
    expect(s.players[0].bless).toBe(1);
    const real = offer.cards[(slot + 1) % 3];
    offer.cards[(slot + 1) % 3] = 'no_such_card';
    expect(bless(offer.id, (slot + 1) % 3)).toMatchObject({ ok: false, code: 'NO_CURSE' });
    offer.cards[(slot + 1) % 3] = real;
    s.players[0].bless = undefined;
    expect(bless(offer.id, (slot + 2) % 3)).toMatchObject({ ok: false, code: 'NO_BLESSING' });
    expect(offer.blessed).toEqual([{ card: slot, slot: 0 }]);
  });

  it('removes exactly the curse of the committed card, is consumed, announced and shown as Blessed', () => {
    const plain = toVoting(newRun(['vanguard', 'arcanist'], 'BLESS_CURSE'));
    const blessed = toVoting(newRun(['vanguard', 'arcanist'], 'BLESS_CURSE'));
    const slot = pricedSlot(blessed);
    const card = cardById(blessed.offer!.cards[slot])!;
    blessed.players[1].bless = 1;
    const r = step(blessed, idle(blessed), [{ type: 'BLESS', slot: 1, offerId: blessed.offer!.id, cardSlot: slot }]);
    expect(r.outcomes[0].ok).toBe(true);
    expect(blessed.players[1].bless).toBeUndefined();
    expect(r.events.some((e) => e.t === 'blessing' && e.op === 'apply' && e.card === slot && e.slot === 1)).toBe(true);
    expect(r.events.some((e) => e.t === 'domain' && e.type === 'fate_blessed')).toBe(true);
    expect(buildSnapshot(blessed).doors![slot].bl).toBe(1);
    expect(buildSnapshot(blessed).doors!.filter((d) => d.bl)).toHaveLength(1);
    // the forecast drops the price of the blessed card only
    const fc = computeForecast(blessed)!;
    if (card.negative) expect(fc.cards[slot].negative).toBeNull();
    const before = { entries: plain.fate.entries.length };
    commitCard(plain, slot);
    commitCard(blessed, slot);
    const gift = cardStatEffects(card).filter((x) => x.side === 'gift').map((x) => x.effect.stat);
    const price = cardStatEffects(card).filter((x) => x.side === 'price').map((x) => x.effect.stat);
    const mine = (s: SimState) => s.fate.entries.slice(before.entries).filter((e) => e.cardId === card.id).map((e) => e.stat);
    expect(mine(plain)).toEqual([...gift, ...price]);
    expect(mine(blessed)).toEqual(gift);
    const bane = cardMechanics(card).find((x) => x.side === 'price')?.effect.id;
    const boon = cardMechanics(card).find((x) => x.side === 'gift')?.effect.id;
    if (bane) { expect(plain.fate.mechanics?.[bane]).toBeTruthy(); expect(blessed.fate.mechanics?.[bane]).toBeUndefined(); }
    if (boon) expect(blessed.fate.mechanics?.[boon]?.stacks).toBe(plain.fate.mechanics?.[boon]?.stacks);
    const rec = blessed.commits[blessed.commits.length - 1];
    expect(rec.blessed).toBe(1);
    expect(plain.commits[plain.commits.length - 1].blessed).toBeUndefined();
    expect(computeLedger(blessed).blessings).toEqual([{ round: rec.round, cardId: card.id, slot: 1, name: 'P1' }]);
    expect(computeLedger(plain).blessings).toBeUndefined();
  });

  it('replays identically, including across a checkpoint taken mid-vote', () => {
    const run = () => {
      let s = toVoting(newRun(['vanguard'], 'BLESS_REPLAY'));
      s.players[0].bless = 1;
      const slot = pricedSlot(s);
      step(s, idle(s), [{ type: 'BLESS', slot: 0, offerId: s.offer!.id, cardSlot: slot }]);
      s = deserializeState(serializeState(s));
      commitCard(s, slot);
      for (let i = 0; i < 400; i++) step(s, idle(s), s.awaitingDurable ? [{ type: 'DURABLE', what: s.awaitingDurable }] : []);
      return s;
    };
    const a = run(), b = run();
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.commits[a.commits.length - 1].blessed).toBe(0);
  });
});
