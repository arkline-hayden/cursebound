import { describe, expect, it } from 'vitest';
import { SnapDecoder, SnapHistory, applySnapDelta, encodeSnapDelta, packEvents, parseClientMessage, snapEqual, unpackEvents, type SnapDelta } from '../src/index';

// Delta snapshots (snapcodec.ts): what the decoder rebuilds is exactly the snapshot the authority built, whatever
// changed in between (entities born, gone, reordered; optional fields appearing and vanishing; tuples changing).

type Obj = Record<string, unknown>;
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** a random walk of snapshot-shaped states */
function* walk(seed: number, steps: number): Generator<Obj> {
  const r = rng(seed);
  let nextId = 1;
  let enemies: Obj[] = [];
  const players = [0, 1, 2].map((s) => ({ s, n: 'P' + s, x: 1, y: 1, cd: [['a', 0, 1, 1], ['b', 0, 0, 1]], buffs: [] as string[] }));
  let hazards: Obj[] = [];
  for (let tick = 3; tick < 3 + steps * 3; tick += 3) {
    if (r() < 0.4) enemies.push({ i: nextId++, k: r() < 0.5 ? 'pursuer' : 'hexer', x: r() * 40, y: r() * 30, st: 'idle', hp: 1, ...(r() < 0.3 ? { dor: 1 } : {}) });
    enemies = enemies.filter(() => r() > 0.08).map((e) => {
      const o = { ...e };
      if (r() < 0.6) { o.x = Math.round((o.x as number) + r() * 100) / 1000; o.y = Math.round((o.y as number) * 1000 - 50) / 1000; }
      if (r() < 0.2) { if (o.dor) delete o.dor; else o.ch = 1; }
      if (r() < 0.1) o.af = ['fast', r() < 0.5 ? 'venomous' : 'vampiric'];
      if (r() < 0.1) o.st = 'windup';
      return o;
    });
    if (r() < 0.1 && enemies.length > 2) enemies.reverse();   // an order the decoder cannot infer
    if (r() < 0.3) hazards.push({ i: nextId++, k: 'fate_pyre', x: r() * 10, y: r() * 10, u: tick + 300 });
    hazards = hazards.filter((h) => (h.u as number) > tick);
    for (const p of players) {
      p.x = Math.round(p.x * 1000 + r() * 80) / 1000;
      p.cd = p.cd.map((c) => [c[0], r() < 0.5 ? Math.round(r() * 1000) / 1000 : c[1], r() < 0.1 ? 1 : c[2], 1]);
      if (r() < 0.2) p.buffs = r() < 0.5 ? ['rally'] : [];
    }
    const snap: Obj = {
      tick, phase: tick > steps * 2 ? 'VOTING' : 'COMBAT', round: 3,
      players: wire(players), enemies: wire(enemies), hazards: wire(hazards), projectiles: [],
      enc: tick % 9 === 0 ? null : { round: 3, activeTicks: tick, wave: 1, ...(tick % 2 ? { packs: 4 } : {}) },
      retire: [], lt: [],
    };
    if (tick > steps * 2) snap.doors = [{ i: 0, x: 1, y: 2, v: [] }, { i: 1, x: 3, y: 2, v: [Math.floor(r() * 3)] }];
    if (r() < 0.2) snap.cu = tick + 60;
    yield snap;
  }
}

describe('delta snapshot codec', () => {
  it('rebuilds every snapshot exactly from consecutive deltas (through JSON)', () => {
    for (const seed of [1, 2, 3, 42, 777]) {
      let prev: Obj | null = null;
      let decoded: Obj | null = null;
      for (const cur of walk(seed, 120)) {
        if (prev && decoded) {
          const d = wire(encodeSnapDelta(prev, cur));
          decoded = applySnapDelta(decoded, d);
          expect(snapEqual(decoded, cur)).toBe(true);
          expect(snapEqual(wire(decoded), wire(cur))).toBe(true);
        } else decoded = wire(cur);
        prev = cur;
      }
    }
  });

  it('rebuilds from an older acknowledged base (lost and skipped snapshots)', () => {
    const all = [...walk(9, 80)];
    for (let i = 10; i < all.length; i++) {
      const base = all[i - 1 - (i % 9)];
      const out = applySnapDelta(wire(base), wire(encodeSnapDelta(base, all[i])));
      expect(snapEqual(out, all[i])).toBe(true);
    }
  });

  it('sends only what changed', () => {
    const base = { tick: 3, phase: 'COMBAT', enemies: [{ i: 1, k: 'pursuer', x: 1, y: 2, st: 'idle', af: ['fast'] }, { i: 2, k: 'hexer', x: 5, y: 5, st: 'idle', dor: 1 }], players: [{ s: 0, x: 0, cd: [['a', 0.5, 0, 1], ['b', 0, 1, 1], ['c', 0, 1, 1]] }], enc: { round: 1, activeTicks: 3, wave: 1 } };
    const cur = { tick: 6, phase: 'COMBAT', enemies: [{ i: 1, k: 'pursuer', x: 1.25, y: 2, st: 'idle', af: ['fast'] }, { i: 2, k: 'hexer', x: 5, y: 5, st: 'idle' }, { i: 7, k: 'pursuer', x: 0, y: 0, st: 'move' }], players: [{ s: 0, x: 0, cd: [['a', 0.45, 0, 1], ['b', 0, 1, 1], ['c', 0, 1, 1]] }], enc: { round: 1, activeTicks: 6, wave: 1 } };
    const d = encodeSnapDelta(base, cur);
    expect(d).toEqual({
      b: 3, tick: 6,
      p: { enc: { activeTicks: 6 } },
      l: {
        enemies: { u: [{ i: 1, x: 1.25 }, { i: 2, _x: ['dor'] }, { i: 7, k: 'pursuer', x: 0, y: 0, st: 'move' }] },
        players: { u: [{ s: 0, _a: { cd: [0, { 1: 0.45 }] } }] },
      },
    } satisfies SnapDelta);
    expect(snapEqual(applySnapDelta(base, wire(d)), cur)).toBe(true);
    // nothing changed: only the header
    expect(encodeSnapDelta(cur, { ...cur, tick: 9 })).toEqual({ b: 6, tick: 9 });
  });

  it('falls back to whole lists it cannot key, and handles keys appearing and vanishing', () => {
    const base = { tick: 1, enemies: [{ i: 1 }, { i: 1 }], doors: [{ i: 0 }], cu: 99 };
    const cur = { tick: 2, enemies: [{ i: 1, x: 2 }], rev: [{ i: 4, k: 'shrine' }] };
    const d = encodeSnapDelta(base, cur);
    expect(d.s?.enemies).toEqual([{ i: 1, x: 2 }]);
    expect(d.x?.sort()).toEqual(['cu', 'doors']);
    expect(applySnapDelta(base, wire(d))).toEqual(cur);
  });

  it('decoder: deltas need their base; ordered mode drops late snapshots; bases are bounded', () => {
    const s = [...walk(5, 100)];
    const dec = new SnapDecoder(8);
    expect(dec.decode({ delta: encodeSnapDelta(s[0], s[1]) })).toBeNull();   // no base yet
    dec.ordered = true;
    expect(dec.decode({ snap: s[0] })).toBe(s[0]);
    expect(snapEqual(dec.decode({ delta: wire(encodeSnapDelta(s[0], s[2])) }), s[2])).toBe(true);
    expect(dec.decode({ delta: wire(encodeSnapDelta(s[0], s[1])) })).toBeNull();   // older than the newest
    for (let i = 3; i < 20; i++) expect(snapEqual(dec.decode({ delta: wire(encodeSnapDelta(s[i - 1], s[i])) }), s[i])).toBe(true);
    expect(dec.decode({ delta: wire(encodeSnapDelta(s[2], s[20])) })).toBeNull();   // base evicted (keeps 8)
    dec.reset();
    expect(dec.ordered).toBe(false);
    expect(dec.decode({ snap: s[1] })).toBe(s[1]);
    expect(dec.decode({ snap: s[0] })).toBe(s[0]);   // unordered: full snapshots taken as they come
  });

  it('history keeps the newest snapshots by tick', () => {
    const h = new SnapHistory(3);
    for (let t = 1; t <= 5; t++) h.add({ tick: t });
    expect([1, 2, 3, 4, 5].map((t) => !!h.get(t))).toEqual([false, false, true, true, true]);
  });

  it('packs event batches without repeated keys, preserving order and optional fields', () => {
    const evs = [
      { t: 'hit', target: 1, targetKind: 'enemy', amount: '5|1', crit: false, x: 1.5, y: 2 },
      { t: 'cast', slot: 0, skill: 'v_cleave', x: 1, y: 2, dx: 1, dy: 0 },
      { t: 'hit', target: 2, targetKind: 'enemy', amount: '7|1', crit: true, x: 3, y: 4, kill: true },
      { t: 'hit', target: 3, targetKind: 'enemy', amount: '1|1', crit: false, x: 0, y: 0 },
      { t: 'recap', slot: 1, recap: { attack: 'bite', factors: ['a'] } },
    ];
    const p = packEvents(evs);
    expect(p.s).toHaveLength(4);
    expect(unpackEvents(wire(p))).toEqual(evs);
    // a real batch is mostly the same few shapes: keys are sent once per shape
    const batch = Array.from({ length: 40 }, (_, k) => ({ ...evs[k % 4], target: k }));
    expect(unpackEvents(wire(packEvents(batch)))).toEqual(batch);
    expect(JSON.stringify(packEvents(batch)).length).toBeLessThan(JSON.stringify(batch).length * 0.6);
  });

  it('validates the new client fields', () => {
    expect(parseClientMessage('{"t":"SACK","tick":120}')).toEqual({ ok: true, msg: { t: 'SACK', tick: 120 } });
    expect(parseClientMessage('{"t":"SACK","tick":-1}').ok).toBe(false);
    expect(parseClientMessage('{"t":"SACK","tick":1.5}').ok).toBe(false);
    const hello = { t: 'HELLO', protocol: 4, build: 'b', contentHash: 'h', roomId: 'room_1', seatToken: 'tok' };
    expect(parseClientMessage(JSON.stringify(hello)).ok).toBe(true);   // an older client: no snap field
    expect(parseClientMessage(JSON.stringify({ ...hello, snap: 1 })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ ...hello, snap: 'x' })).ok).toBe(false);
  });
});
