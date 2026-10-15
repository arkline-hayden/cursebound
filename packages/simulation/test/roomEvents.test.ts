import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { COIN_RULES, LEGENDARIES, MAX_BLESSINGS, RELIC_AMPLIFY, ROOM_EVENT_RULES, RUNNER_KIND, SHRINE_TUNING, isBossRound } from '@cursebound/content';
import {
  altarOffers, botCommands, botInput, buildSnapshot, computeLedger, createEnemy, deserializeState, derivePlayer, dropCoins, generateMap, hitEnemy,
  killEnemy, mitigationFactor, moveSpeedOf, rollCoins, roomEventSpots, seedRng, serializeState, spawnRunner, stateHash, step,
  type Command, type PlayerInput, type RoomEvent, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Room events (roomEvents.ts, coins.ts): shrines placed in typed rooms at a modest seeded rate, party blessings that
// expire, the cursed altar's pacts (bound for the run and recorded in the Ledger), the wandering merchant's validated
// shop, cursed coin drops shared by the party, the fleeing treasure imp, and exact replays across checkpoints.

const idle = (s: SimState): PlayerInput[] => s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 }));

/** Drive to COMBAT (or VOTING) of `round` with invulnerable heroes and instant clears; earlier votes lock card 0. */
function drive(s: SimState, round: number, phase: 'COMBAT' | 'VOTING' = 'COMBAT'): SimState {
  let seq = 1;
  for (let i = 0; i < 200000 && s.phase !== 'RESULTS'; i++) {
    if (s.phase === phase && s.round >= round && (s.cinematicUntilTick ?? 0) <= s.tick) return s;
    const cmds: Command[] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'VOTING' && s.offer) for (const p of s.players) if (!s.offer.votes[p.slot].locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: seq++, cardSlot: 0, locked: true });
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    if (s.phase === 'COMBAT' && !(s.round >= round && phase === 'COMBAT')) {
      for (const p of s.players) p.iframes = 10;
      for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    }
    step(s, [], cmds);
  }
  return s;
}

/** A quiet fight: every foe idle, heroes untouchable. */
function calm(s: SimState): SimState {
  for (const e of s.enemies) e.dormant = true;
  for (const p of s.players) p.iframes = 1e9;
  return s;
}

function put(s: SimState, e: Omit<RoomEvent, 'id'>): RoomEvent {
  const re: RoomEvent = { id: s.nextId++, ...e };
  (s.roomEvents ??= { list: [] }).list.push(re);
  return re;
}

const use = (s: SimState, op: 'shrine' | 'altar' | 'buy', id: number, choice?: number, slot = 0) =>
  step(s, idle(s), [{ type: 'EVENT', slot, op, id, ...(choice !== undefined ? { choice } : {}) }]);

const coinPiles = (s: SimState) => (s.pickups ?? []).filter((k) => k.kind === 'coin');
const coinValue = (s: SimState) => coinPiles(s).reduce((n, k) => n + k.tier, 0);

describe('room events: shrine placement', () => {
  it('places shrines in typed rooms at a modest seeded rate, deterministically, clear of the spawn', () => {
    let shrines = 0, altars = 0, floors = 0;
    for (let i = 0; i < 140; i++) {
      const seed = `SHRINE_RATE_${i}`;
      const round = 2 + (i % 3);
      const map = generateMap(seed, round, false);
      if (!map.rooms?.length) continue;
      floors++;
      const spots = roomEventSpots(map, seed, round);
      expect(roomEventSpots(map, seed, round)).toEqual(spots);   // deterministic
      if (spots.some((s) => s.kind === 'shrine')) shrines++;
      if (spots.some((s) => s.kind === 'altar')) altars++;
      const sp = map.playerSpawns[0];
      for (const s of spots) {
        const tx = Math.floor(s.x), ty = Math.floor(s.y);
        expect(map.rooms.some((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h)).toBe(true);   // in a typed room
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(map.tiles[(ty + dy) * map.w + tx + dx]).toBe(0);   // open floor
        expect(Math.hypot(s.x - sp.x, s.y - sp.y)).toBeGreaterThan(ROOM_EVENT_RULES.spawnClearance * 0.5);
      }
    }
    expect(floors).toBeGreaterThan(100);
    expect(shrines / floors).toBeGreaterThan(ROOM_EVENT_RULES.shrineChance - 0.15);
    expect(shrines / floors).toBeLessThan(ROOM_EVENT_RULES.shrineChance + 0.15);
    expect(altars / floors).toBeGreaterThan(0.08);
    expect(altars / floors).toBeLessThan(0.38);
  });

  it('ordinary floors get their events at combat start; boss floors and the first tutorial floor never do', () => {
    let seen = 0;
    for (let i = 0; i < 12; i++) {
      const s = drive(newRun(['vanguard'], `FLOOR_EVENTS_${i}`), 3);
      const spots = roomEventSpots(s.map!, s.seed, 3);
      const list = s.roomEvents?.list ?? [];
      expect(list.filter((e) => e.kind !== 'merchant').map((e) => [e.kind, e.type, e.x, e.y])).toEqual(spots.map((e) => [e.kind, e.type, e.x, e.y]));
      seen += list.length;
    }
    expect(seen).toBeGreaterThan(0);
    const b = drive(newRun(['vanguard'], 'FLOOR_EVENTS_BOSS'), 5);
    expect(isBossRound(b.round)).toBe(true);
    expect(b.roomEvents?.list.filter((e) => e.kind !== 'merchant') ?? []).toEqual([]);
  });
});

describe('room events: shrine blessings', () => {
  it('Fury applies to the party, multiplies hit damage and expires; the shrine goes dark', () => {
    const s = calm(drive(newRun(['vanguard', 'arcanist'], 'SHRINE_FURY'), 2));
    const p = s.players[0];
    const re = put(s, { kind: 'shrine', type: 'fury', x: p.x + 0.5, y: p.y });
    const ev = use(s, 'shrine', re.id);
    expect(ev.outcomes[0].ok).toBe(true);
    expect(ev.events.some((e) => e.t === 'room_event' && e.op === 'shrine' && e.k === 'fury')).toBe(true);
    expect(re.used).toBe(true);
    for (const a of s.players) expect(a.buffs.some((b) => b.id === 'shrine_fury')).toBe(true);
    expect(use(s, 'shrine', re.id).outcomes[0]).toMatchObject({ ok: false, code: 'SPENT' });
    // damage: identical hits with and without the blessing differ by exactly the Fury factor
    const twin = deserializeState(serializeState(s));
    twin.players[0].buffs = twin.players[0].buffs.filter((b) => b.id !== 'shrine_fury');
    const hit = (st: SimState) => {
      const e = createEnemy(st, 'pursuer', st.players[0].x + 1, st.players[0].y, Big.ONE, { objective: false, groupId: -1, summonerId: null });
      st.enemies.push(e);
      return hitEnemy(st, [], e, Big.from(10), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: st.players[0].x, fromY: st.players[0].y, allowCrit: false }).dealt;
    };
    expect(hit(s).ratio(hit(twin))).toBeCloseTo(Number(SHRINE_TUNING.furyDamage), 9);
    // the blessing lasts 30 s
    for (let i = 0; i < 30 * 60 + 2; i++) step(s, idle(s), []);
    expect(s.players[0].buffs.some((b) => b.id === 'shrine_fury')).toBe(false);
  });

  it('Haste speeds heroes and cooldowns; Warding shields; Renewal heals fully; Fortune enriches drops', () => {
    const s = calm(drive(newRun(['vanguard'], 'SHRINE_KINDS'), 2));
    const p = s.players[0];
    const speed0 = moveSpeedOf(s, p);
    p.skills[0].charges = 0; p.skills[0].cooldown = 5;
    use(s, 'shrine', put(s, { kind: 'shrine', type: 'haste', x: p.x, y: p.y }).id);
    expect(moveSpeedOf(s, p)).toBeCloseTo(speed0 * (1 + SHRINE_TUNING.hasteSpeed), 6);
    expect(p.skills[0].cooldown).toBeLessThan(5 * SHRINE_TUNING.hasteCooldownCut + 0.05);
    expect(buildSnapshot(s).players[0].rb?.shrine_haste).toBeGreaterThan(28);
    use(s, 'shrine', put(s, { kind: 'shrine', type: 'warding', x: p.x, y: p.y }).id);
    expect(p.shield.gt(Big.ZERO)).toBe(true);
    p.hp = p.maxHp.mul(Big.from('0.2'));
    use(s, 'shrine', put(s, { kind: 'shrine', type: 'renewal', x: p.x, y: p.y }).id);
    expect(p.hp.eq(p.maxHp)).toBe(true);
    // fortune doubles coins from a champion
    const champ = createEnemy(s, 'pursuer', p.x + 2, p.y, Big.ONE, { objective: true, groupId: -1, summonerId: null });
    champ.elite = 1;
    const before = coinValue(s);
    rollCoins(s, champ);
    expect(coinValue(s) - before).toBe(COIN_RULES.champion);
    use(s, 'shrine', put(s, { kind: 'shrine', type: 'fortune', x: p.x, y: p.y }).id);
    const mid = coinValue(s);
    rollCoins(s, champ);
    expect(coinValue(s) - mid).toBe(COIN_RULES.champion * SHRINE_TUNING.fortuneCoins);
  });

  it('is validated: range, phase and the right kind', () => {
    const s = calm(drive(newRun(['vanguard'], 'SHRINE_RULES'), 2));
    const p = s.players[0];
    const far = put(s, { kind: 'shrine', type: 'fury', x: p.x + ROOM_EVENT_RULES.useRange + 1, y: p.y });
    expect(use(s, 'shrine', far.id).outcomes[0]).toMatchObject({ ok: false, code: 'TOO_FAR' });
    expect(use(s, 'altar', far.id, 0).outcomes[0]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(use(s, 'shrine', 987654).outcomes[0]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const v = drive(newRun(['vanguard'], 'SHRINE_VOTE'), 2, 'VOTING');
    const vp = v.players[0];
    const re = put(v, { kind: 'shrine', type: 'fury', x: vp.x, y: vp.y });
    expect(use(v, 'shrine', re.id).outcomes[0]).toMatchObject({ ok: false, code: 'STALE_PHASE' });   // a shrine belongs to the fight
  });
});

describe('room events: cursed altar', () => {
  it('a pact trades maximum health for power, binds for the run and shows in the Ledger', () => {
    const s = calm(drive(newRun(['vanguard'], 'ALTAR_PACT'), 2));
    const p = s.players[0];
    const relic = LEGENDARIES.find((d) => !d.classId && d.modifiers.some((m) => m.stat === 'player.damage'))!;
    const re = put(s, { kind: 'altar', type: 'altar', x: p.x, y: p.y, offers: ['fury', 'tithe', `relic:${relic.id}`] });
    const d0 = derivePlayer(s, p);
    const hpFrac = p.hp.ratio(p.maxHp);
    expect(use(s, 'altar', re.id, 9).outcomes[0]).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const r = use(s, 'altar', re.id, 0);
    expect(r.outcomes[0].ok).toBe(true);
    expect(r.events.some((e) => e.t === 'room_event' && e.op === 'altar' && e.k === 'fury')).toBe(true);
    const d1 = derivePlayer(s, p);
    expect(d1.maxHp.ratio(d0.maxHp)).toBeCloseTo(0.85, 9);
    expect(d1.damage.ratio(d0.damage)).toBeCloseTo(1.25, 9);
    expect(p.maxHp.eq(d1.maxHp)).toBe(true);
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(hpFrac, 6);   // the health fraction is kept
    expect(p.pacts).toEqual([expect.objectContaining({ id: 'fury', src: 'altar', round: 2 })]);
    expect(use(s, 'altar', re.id, 1).outcomes[0]).toMatchObject({ ok: false, code: 'SPENT' });
    const view = computeLedger(s);
    expect(view.pacts).toEqual([expect.objectContaining({ id: 'fury', src: 'altar', slot: 0, round: 2 })]);
    const dmg = view.groups.flatMap((g) => g.stats).find((x) => x.stat === 'player.damage')!;
    expect(dmg.perPlayer[0].pactSources).toEqual([expect.objectContaining({ id: 'fury', src: 'altar' })]);
    // the pact survives a checkpoint
    const back = deserializeState(serializeState(s));
    expect(derivePlayer(back, back.players[0]).damage.eq(d1.damage)).toBe(true);
    // a relic pact copies a legendary's lines, amplified; the blood tithe takes half the current health, never lethally
    const relicAltar = put(s, { kind: 'altar', type: 'altar', x: p.x, y: p.y, offers: ['fury', 'tithe', `relic:${relic.id}`] });
    use(s, 'altar', relicAltar.id, 2);
    const rec = p.pacts!.find((x) => x.id === 'relic')!;
    expect(rec.item).toBe(relic.id);
    const line = relic.modifiers.find((m) => m.stat === 'player.damage')!;
    expect(Number(rec.mods.find((m) => m.stat === 'player.damage')!.factor)).toBeCloseTo(1 + (Number(line.factorPerRank) - 1) * RELIC_AMPLIFY, 9);
    p.hp = Big.from('0.6');
    use(s, 'altar', put(s, { kind: 'altar', type: 'altar', x: p.x, y: p.y, offers: ['tithe', 'fury', 'edge'] }).id, 0);
    expect(p.hp.gte(Big.from('0.3'))).toBe(true);
    expect(p.lifeState).toBe('alive');
  });

  it('offers three distinct seeded pacts', () => {
    const s = newRun(['vanguard'], 'ALTAR_OFFERS');
    const a = altarOffers(s, seedRng('X', 'altar', 2, 0));
    expect(altarOffers(s, seedRng('X', 'altar', 2, 0))).toEqual(a);
    expect(new Set(a.map((o) => o.split(':')[0])).size).toBe(3);
  });
});

describe('room events: wandering merchant and coins', () => {
  const shelf = (s: SimState, x: number, y: number) => {
    const item = LEGENDARIES.find((d) => !d.classId)!.id;
    return put(s, { kind: 'merchant', type: 'merchant', x, y, stock: [
      { ware: 'draught', price: 8, left: 1 }, { ware: 'tonic', price: 25, left: 1 }, { ware: 'legendary', price: 70, left: 1, item }, { ware: 'blessing', price: 120, left: 1 },
    ] });
  };

  it('validates purchases: funds, stock, range, phase; wares apply', () => {
    const s = drive(newRun(['vanguard'], 'MERCHANT_BUY'), 2, 'VOTING');
    const p = s.players[0];
    const m = shelf(s, p.x + 0.6, p.y);
    expect(use(s, 'buy', m.id, 0).outcomes[0]).toMatchObject({ ok: false, code: 'NO_FUNDS' });
    p.coins = 500;
    expect(use(s, 'buy', m.id, 7).outcomes[0]).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(use(s, 'buy', m.id, 0).outcomes[0].ok).toBe(true);
    expect(p.coins).toBe(492);
    expect(use(s, 'buy', m.id, 0).outcomes[0]).toMatchObject({ ok: false, code: 'SOLD_OUT' });
    const max0 = p.maxHp;
    expect(use(s, 'buy', m.id, 1).outcomes[0].ok).toBe(true);
    expect(p.maxHp.ratio(max0)).toBeCloseTo(1.08, 9);
    expect(p.pacts).toEqual([expect.objectContaining({ id: 'tonic', src: 'merchant' })]);
    const item = m.stock![2].item!;
    const r = use(s, 'buy', m.id, 2);
    expect(r.outcomes[0].ok).toBe(true);
    expect(Object.values(p.gear ?? {})).toContain(item);
    p.bless = MAX_BLESSINGS;
    expect(use(s, 'buy', m.id, 3).outcomes[0]).toMatchObject({ ok: false, code: 'PACK_FULL' });
    p.bless = 0;
    expect(use(s, 'buy', m.id, 3).outcomes[0].ok).toBe(true);
    expect(p.bless).toBe(1);
    expect(p.coins).toBe(500 - 8 - 25 - 70 - 120);
    // out of range, then the wrong phase
    const far = shelf(s, p.x + ROOM_EVENT_RULES.useRange + 2, p.y);
    expect(use(s, 'buy', far.id, 0).outcomes[0]).toMatchObject({ ok: false, code: 'TOO_FAR' });
    const a = drive(newRun(['vanguard'], 'MERCHANT_PHASE'), 1, 'VOTING');
    for (let i = 0; i < 600 && a.phase !== 'SKILL_ALLOCATION'; i++) {
      const cmds: Command[] = a.offer && !a.offer.votes[0].locked ? [{ type: 'VOTE', slot: 0, offerId: a.offer.id, seq: 50 + i, cardSlot: 0, locked: true }] : a.awaitingDurable ? [{ type: 'DURABLE', what: a.awaitingDurable }] : [];
      if (a.phase === 'COMBAT') { for (const pl of a.players) pl.iframes = 10; for (const e of a.enemies) if (e.state !== 'dying') killEnemy(a, [], e, 0); }
      step(a, [], cmds);
    }
    expect(a.phase).toBe('SKILL_ALLOCATION');
    a.players[0].coins = 100;
    const m2 = shelf(a, a.players[0].x, a.players[0].y);
    expect(use(a, 'buy', m2.id, 0).outcomes[0]).toMatchObject({ ok: false, code: 'STALE_PHASE' });
  });

  it('always waits after a boss floor, away from the doors, with a seeded shelf', () => {
    const s = drive(newRun(['vanguard'], 'MERCHANT_BOSS'), 5, 'VOTING');
    const m = s.roomEvents?.list.find((e) => e.kind === 'merchant');
    expect(m).toBeDefined();
    for (const d of s.doors?.list ?? []) expect(Math.hypot(d.x - m!.x, d.y - m!.y)).toBeGreaterThanOrEqual(2.5);
    expect(m!.stock![0].ware).toBe('draught');
    expect(m!.stock!.some((r) => r.ware === 'legendary' && !!r.item)).toBe(true);
    const again = drive(newRun(['vanguard'], 'MERCHANT_BOSS'), 5, 'VOTING');
    expect(again.roomEvents?.list.find((e) => e.kind === 'merchant')).toEqual(m);
    expect(buildSnapshot(s).rev?.some((e) => e.k === 'merchant' && e.s?.length)).toBe(true);
  });

  it('coins drop from foes and caches, and any hero touching a pile pays the whole party', () => {
    const s = calm(drive(newRun(['vanguard', 'ranger'], 'COINS_PARTY'), 2));
    const [a, b] = s.players;
    b.x = a.x; b.y = a.y;
    expect(a.coins ?? 0).toBe(b.coins ?? 0);   // round 1's coins already went to both purses
    const start = a.coins ?? 0;
    dropCoins(s, a.x + 0.4, a.y, 5);
    const evs: SimEvent[] = [];
    for (let i = 0; i < 40; i++) evs.push(...step(s, idle(s), []).events);
    expect(evs.some((e) => e.t === 'pickup' && e.kind === 'coin')).toBe(true);
    expect([a.coins, b.coins]).toEqual([start + 5, start + 5]);
    // drop chances: champions and rares always, ordinary objective foes by chance, summons never
    const foe = createEnemy(s, 'pursuer', a.x + 8, a.y, Big.ONE, { objective: true, groupId: -1, summonerId: null });
    const v0 = coinValue(s);
    const N = 1200;
    for (let i = 0; i < N; i++) rollCoins(s, foe);
    expect((coinValue(s) - v0) / N).toBeGreaterThan(COIN_RULES.foeChance - 0.06);
    expect((coinValue(s) - v0) / N).toBeLessThan(COIN_RULES.foeChance + 0.06);
    expect(coinPiles(s).length).toBeLessThanOrEqual(COIN_RULES.maxPiles);
    const summon = createEnemy(s, 'mite', a.x + 8, a.y, Big.ONE, { objective: false, groupId: -1, summonerId: 1 });
    const v1 = coinValue(s);
    for (let i = 0; i < 50; i++) rollCoins(s, summon);
    expect(coinValue(s)).toBe(v1);
    // round clear sweeps every unclaimed pile into the purses
    const owed = coinValue(s);
    for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    for (let i = 0; i < 400 && s.phase === 'COMBAT'; i++) { for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0); step(s, idle(s), []); }
    expect(s.phase).not.toBe('COMBAT');
    expect(coinPiles(s).length).toBe(0);
    expect(a.coins).toBeGreaterThanOrEqual(start + 5 + owed);
    expect(b.coins).toBe(a.coins);
  });
});

describe('room events: treasure imp', () => {
  it('flees along paths, spills coins as it is hit and bursts into loot when slain', () => {
    const s = calm(drive(newRun(['vanguard'], 'IMP_KILL'), 2));
    const p = s.players[0];
    s.enemies = [];
    const ev: SimEvent[] = [];
    const imp = spawnRunner(s, ev, { x: p.x + 2, y: p.y })!;
    expect(imp.kind).toBe(RUNNER_KIND);
    expect(imp.objective).toBe(false);
    expect(ev.some((e) => e.t === 'room_event' && e.op === 'runner')).toBe(true);
    const d0 = Math.hypot(imp.x - p.x, imp.y - p.y);
    for (let i = 0; i < 120; i++) step(s, idle(s), []);
    expect(Math.hypot(imp.x - p.x, imp.y - p.y)).toBeGreaterThan(d0 + 2);   // it ran
    expect(buildSnapshot(s).rev?.find((e) => e.k === 'runner')?.l).toBeGreaterThan(9);
    // a quarter of its health: two coins spill
    const hit = (frac: number) => hitEnemy(s, [], imp, imp.cohort.unitHp.mul(Big.from(frac)).div(mitigationFactor(imp.armor)), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    const c0 = coinValue(s);
    hit(0.26);
    expect(coinValue(s) - c0).toBe(2);
    hit(5);
    expect(imp.state).toBe('dying');
    const evs = step(s, idle(s), []).events;
    void evs;
    const total = ROOM_EVENT_RULES.runnerCoinSteps + ROOM_EVENT_RULES.showerPiles * ROOM_EVENT_RULES.showerPile;
    expect(coinValue(s) - c0).toBe(total);
    expect((s.pickups ?? []).some((k) => k.kind === 'potion' && k.tier === 2)).toBe(true);
    expect((s.pickups ?? []).some((k) => k.kind === 'orb' && k.tier === 2)).toBe(true);
  });

  it('opens a portal on its timer and escapes without a death or loot', () => {
    const s = calm(drive(newRun(['vanguard'], 'IMP_ESCAPE'), 2));
    const p = s.players[0];
    s.enemies = [];
    const imp = spawnRunner(s, [], { x: p.x + 3, y: p.y })!;
    const evs: SimEvent[] = [];
    const total = Math.round((ROOM_EVENT_RULES.runnerEscapeSec + ROOM_EVENT_RULES.runnerPortalSec) * 60) + 4;
    for (let i = 0; i < total && s.phase === 'COMBAT'; i++) evs.push(...step(s, idle(s), []).events);
    expect(evs.some((e) => e.t === 'room_event' && e.op === 'portal')).toBe(true);
    expect(evs.some((e) => e.t === 'room_event' && e.op === 'escape' && e.id === imp.id)).toBe(true);
    expect(evs.some((e) => e.t === 'death' && e.id === imp.id)).toBe(false);
    expect(evs.some((e) => e.t === 'room_event' && e.op === 'shower')).toBe(false);
    expect(s.enemies.some((e) => e.id === imp.id)).toBe(false);
  });

  it('is scheduled on some ordinary floors and appears mid-fight', () => {
    let scheduled = 0, appeared = 0;
    for (let i = 0; i < 30; i++) {
      const s = calm(drive(newRun(['vanguard'], `IMP_SCHED_${i}`), 2));
      if (s.roomEvents?.runnerAt === undefined) continue;
      scheduled++;
      for (let t = 0; t < 21 * 60 && s.phase === 'COMBAT'; t++) { calm(s); step(s, idle(s), []); }
      if (s.enemies.some((e) => e.kind === RUNNER_KIND) || s.roomEvents?.runnerAt === undefined) appeared++;
    }
    expect(scheduled).toBeGreaterThan(0);
    expect(scheduled).toBeLessThan(18);
    expect(appeared).toBe(scheduled);
  });
});

describe('room events: replay', () => {
  /** A scripted run: bots fight round 2, every event is used, the party crosses the next safe checkpoint. */
  function scenario(restoreAt: number | 'checkpoint' | null): SimState {
    let s = newRun(['vanguard', 'arcanist'], 'EVENTS_REPLAY');
    drive(s, 2);
    const p = s.players[0];
    const shrine = put(s, { kind: 'shrine', type: 'haste', x: p.x, y: p.y });
    const altar = put(s, { kind: 'altar', type: 'altar', x: p.x, y: p.y, offers: ['fury', 'edge', 'tithe'] });
    const merchant = put(s, { kind: 'merchant', type: 'merchant', x: p.x, y: p.y, stock: [{ ware: 'draught', price: 8, left: 2 }, { ware: 'whetstone', price: 25, left: 1 }] });
    p.coins = 40;
    spawnRunner(s, [], { x: p.x + 3, y: p.y + 1 });
    let seq = 1000, voteSeq = 1;
    const script: Record<number, Command[]> = {
      1: [{ type: 'EVENT', slot: 0, op: 'shrine', id: shrine.id }],
      2: [{ type: 'EVENT', slot: 0, op: 'altar', id: altar.id, choice: 1 }],
      3: [{ type: 'EVENT', slot: 0, op: 'buy', id: merchant.id, choice: 1 }, { type: 'EVENT', slot: 0, op: 'buy', id: merchant.id, choice: 0 }],
    };
    let crossed = false;
    for (let t = 0; t < 9000; t++) {
      if (restoreAt !== null && t === restoreAt) s = deserializeState(serializeState(s));
      if (restoreAt === 'checkpoint' && !crossed && s.phase === 'ROUND_SETUP') { crossed = true; s = deserializeState(serializeState(s)); }   // right after SAFE_CHECKPOINT
      const cmds = [...(script[t] ?? []), ...s.players.flatMap((pl) => botCommands(s, pl.slot, voteSeq))];
      if (cmds.some((c) => c.type === 'VOTE')) voteSeq++;
      const inputs = s.phase === 'COMBAT' && t > 3 ? s.players.map((pl) => botInput(s, pl.slot, ++seq)) : idle(s);
      step(s, inputs, cmds);
      if (s.phase === 'COMBAT' && s.round >= 4) break;
    }
    return s;
  }

  it('every event replays exactly across checkpoint round trips (mid-fight and after the next safe checkpoint)', () => {
    const a = scenario(null);
    expect(a.round).toBeGreaterThanOrEqual(3);
    expect(a.players[0].pacts?.map((x) => x.id)).toEqual(['edge', 'whetstone']);
    expect(a.players[0].coins).toBeGreaterThanOrEqual(40 - 25 - 8);
    const hash = stateHash(a);
    for (const at of [60, 2400, 'checkpoint'] as const) expect(stateHash(scenario(at))).toBe(hash);
  });
});

describe('room events: training grounds', () => {
  it('TRAIN event spawns every room event ahead of the hero; refused outside training', () => {
    const s = newRun(['vanguard'], 'TRAIN_EVENTS', { training: true });
    for (let i = 0; i < 600 && s.phase !== 'COMBAT'; i++) step(s, idle(s), []);
    const train = (arg: string) => step(s, idle(s), [{ type: 'TRAIN', slot: 0, op: 'event', arg }]).outcomes[0];
    for (const arg of ['shrine_fury', 'shrine_haste', 'shrine_warding', 'shrine_fortune', 'shrine_renewal', 'altar', 'merchant']) expect(train(arg).ok).toBe(true);
    expect(train('shrine_nope')).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const kinds = s.roomEvents!.list.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'shrine').length).toBeGreaterThanOrEqual(4);
    expect(kinds).toContain('altar');
    expect(kinds).toContain('merchant');
    expect(s.roomEvents!.list.length).toBeLessThanOrEqual(8);
    expect(train('runner').ok).toBe(true);
    expect(s.enemies.some((e) => e.kind === RUNNER_KIND)).toBe(true);
    expect(train('coins').ok).toBe(true);
    expect(coinValue(s)).toBe(30);
    const shrine = s.roomEvents!.list.find((e) => e.kind === 'shrine' && e.type === 'renewal')!;
    s.players[0].x = shrine.x; s.players[0].y = shrine.y;
    expect(use(s, 'shrine', shrine.id).outcomes[0].ok).toBe(true);
    const n = newRun(['vanguard'], 'TRAIN_EVENTS_NO');
    expect(step(n, idle(n), [{ type: 'TRAIN', slot: 0, op: 'event', arg: 'altar' }]).outcomes[0]).toMatchObject({ ok: false, code: 'NOT_TRAINING' });
  });
});
