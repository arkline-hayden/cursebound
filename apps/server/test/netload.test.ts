import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterAll, describe, expect, it } from 'vitest';
import { CLASSES, contentHash, TICK_RATE } from '@cursebound/content';
import { SNAP_CODEC, SnapDecoder, snapEqual, unpackEvents, type ServerMessage } from '@cursebound/protocol';
import { applyCard, botCommands, botInput, buildSnapshot, createRun, killEnemy, step, type SimState } from '@cursebound/simulation';
import { RunAuthority, type SeatLink } from '../src/authority';
import type { Logger } from '../src/persistence/logger';

// Late-round network load (the "P2P slows to a halt in later rounds" report): a party of four bots at round 19 with
// every Fate card that spawns extra bodies bound (Restless Dead wisps, Shadow Pact twins, Grave Thralls, Volatile Dead
// pyres, ...) fights through the real RunAuthority for 30 s of combat. Three seats are guests that decode what they
// receive (100 ms round trip, 10% of snapshots lost on the way) and acknowledge it like GameConnection does.
// Budgets: authority tick time well inside the 16.7 ms tick, and the bytes each guest receives per second.
// NL_ROUND / NL_SEC / NL_DUMP=<dir> (write the largest snapshot and event batch) tune it for measurement.

const SPAWNERS = ['necromancers_due', 'shadow_twin', 'haunted_spoils', 'gravediggers_bargain', 'lord_of_graves', 'doppelganger', 'cataclysm'];
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; }, async close() {} };

function lateRun(round: number, party: string[]): SimState {
  const st = createRun({
    runId: 'netload', seed: 'NETLOAD_' + round, mode: 'coop', trust: 'local', contentHash: contentHash(),
    roster: party.map((c, i) => ({ slot: i, profileId: 'p' + i, name: 'P' + i, classId: c })), bounty: null,
  });
  const ctx = { seq: 0, voteSeq: 1 };
  const pick = (cards: string[]) => Math.max(0, cards.findIndex((c) => SPAWNERS.includes(c)));
  for (let i = 0; i < 2_000_000 && st.phase !== 'RESULTS'; i++) {
    if (st.round === round && st.phase === 'COMBAT') break;
    if (st.phase === 'COMBAT') {
      for (const p of st.players) p.iframes = 10;
      for (const e of st.enemies) if (e.state !== 'dying') killEnemy(st, [], e, 0);
    }
    const cmds = st.players.flatMap((p) => botCommands(st, p.slot, ctx.voteSeq, pick));
    if (cmds.some((c) => c.type === 'VOTE')) ctx.voteSeq++;
    step(st, st.phase === 'COMBAT' ? st.players.map((p) => botInput(st, p.slot, ++ctx.seq)) : [], cmds);
  }
  for (const c of SPAWNERS) applyCard(st, c, 'netload', []);
  for (const p of st.players) { p.iframes = 0; p.hp = p.maxHp; }
  return st;
}

interface LoadResult {
  round: number; combatTicks: number; peak: { enemies: number; projectiles: number; hazards: number; pickups: number; telegraphs: number };
  tickMs: { mean: number; p95: number; p99: number; max: number }; stepMs: number; snapshotMs: number;
  guest: { bytesPerSec: number; peakBytesPerSec: number; msgsPerSec: number; snapsPerSec: number; avgSnapBytes: number; maxSnapBytes: number; fullSnapBytes: number; eventsPerSec: number; eventBytesPerSec: number };
  mismatches: number; decoded: number;
}

/** `codec`: the guests' delta codec (0 = an older client: full snapshots). */
function runLoad(opts: { codec: number; round: number; sec: number; rttTicks?: number; loss?: number }): LoadResult {
  const party = CLASSES.map((c) => c.id).slice(0, 4);
  const st = lateRun(opts.round, party);
  const rtt = opts.rttTicks ?? 6;
  let rng = 0x9e3779b9;
  const lost = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 2 ** 32 < (opts.loss ?? 0); };
  let auth!: RunAuthority;
  const guests = party.map(() => ({
    bytes: 0, msgs: 0, snaps: 0, snapBytes: 0, maxSnap: 0, events: 0, eventBytes: 0, second: 0, peakSecond: 0,
    dec: new SnapDecoder(), acks: [] as { at: number; tick: number }[],
  }));
  let mismatches = 0, decoded = 0;
  let inCombat = false;
  const dumped: Record<string, number> = {};
  const links: SeatLink[] = party.map((_, slot) => {
    const g = guests[slot];
    g.dec.ordered = opts.codec === SNAP_CODEC;
    const deliver = (json: string) => {
      const m = JSON.parse(json) as ServerMessage;
      g.second += json.length;
      if (!inCombat) return;   // budgets are for combat; intermissions carry little
      g.bytes += json.length; g.msgs++;
      if (process.env.NL_FIELDS && slot === 1 && m.t === 'SNAPSHOT' && m.delta) tally(m.delta as Record<string, unknown>);
      if (process.env.NL_DUMP && slot === 1 && json.length > (dumped[m.t] ?? 0)) { dumped[m.t] = json.length; writeFileSync(`${process.env.NL_DUMP}/${m.t}-${opts.codec}.json`, json); }
      if (m.t === 'EVENTS') { g.events += (m.pk ? unpackEvents(m.pk) : m.events ?? []).length; g.eventBytes += json.length; return; }
      if (m.t !== 'SNAPSHOT') return;
      g.snaps++; g.snapBytes += json.length; g.maxSnap = Math.max(g.maxSnap, json.length);
      if (slot > 0 && lost()) return;   // lost on the way (an unreliable channel, or a frame the bridge dropped)
      const snap = g.dec.decode(m);
      if (!snap) return;
      decoded++;
      // the decoded snapshot is exactly the authority's (sampled: the comparison is not free)
      if (decoded % 7 === 0 && !snapEqual(snap, buildSnapshot(st))) mismatches++;
      if (opts.codec) g.acks.push({ at: st.tick + rtt, tick: snap.tick as number });
    };
    return {
      slot, debug: false, connected: true, buffered: () => 0, codec: opts.codec,
      send: (m: ServerMessage) => deliver(JSON.stringify(m)),
      sendRaw: deliver,
    };
  });
  auth = new RunAuthority({ state: st, store: null as never, logger: quiet, host: { links: () => links, onRunEnded() {}, onStateChange() {} }, boardKey: 'x', practice: true, training: true });
  const queues = (auth as unknown as { queues: unknown[][] }).queues;
  const ctx = { seq: 0, voteSeq: 1 };
  const tickMs: number[] = [];
  let stepMs = 0, snapMs = 0, snapN = 0;
  const peak = { enemies: 0, projectiles: 0, hazards: 0, pickups: 0, telegraphs: 0 };
  let combatTicks = 0;
  for (let i = 0; i < 40_000 && combatTicks < opts.sec * TICK_RATE && st.phase !== 'RESULTS'; i++) {
    for (const p of st.players) p.iframes = 1e9;   // keep the party fighting: we measure the crowd, not the outcome
    const cmds = st.players.flatMap((p) => botCommands(st, p.slot, ctx.voteSeq, () => 0));
    if (cmds.some((c) => c.type === 'VOTE')) ctx.voteSeq++;
    for (const c of cmds) auth.submitCommand(c, {});
    if (st.phase === 'COMBAT') for (const p of st.players) queues[p.slot].push(botInput(st, p.slot, ++ctx.seq));
    for (const l of links) {
      const g = guests[l.slot];
      while (g.acks.length && g.acks[0].at <= st.tick) auth.ackSnapshot(l, g.acks.shift()!.tick);
    }
    const combat = st.phase === 'COMBAT';
    inCombat = combat;
    const a = performance.now();
    auth.tick();
    const ms = performance.now() - a;
    if (st.tick % TICK_RATE === 0) for (const g of guests) { g.peakSecond = Math.max(g.peakSecond, g.second); g.second = 0; }
    if (!combat) continue;
    combatTicks++;
    tickMs.push(ms);
    peak.enemies = Math.max(peak.enemies, st.enemies.length); peak.projectiles = Math.max(peak.projectiles, st.projectiles.length);
    peak.hazards = Math.max(peak.hazards, st.hazards.length); peak.pickups = Math.max(peak.pickups, (st.pickups ?? []).length);
    peak.telegraphs = Math.max(peak.telegraphs, st.telegraphs.length);
    if (st.tick % 3 === 0) { const b = performance.now(); buildSnapshot(st); snapMs += performance.now() - b; snapN++; }
  }
  // the sim step alone, measured on a copy of the end state (the authority loop above includes snapshots and sends)
  {
    const t = performance.now();
    let n = 0;
    for (; n < 300 && st.phase === 'COMBAT'; n++) step(st, st.players.map((p) => botInput(st, p.slot, ++ctx.seq)), []);
    stepMs = n ? (performance.now() - t) / n : 0;
  }
  const sorted = tickMs.slice().sort((x, y) => x - y);
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const g = guests[1];
  return {
    round: st.round, combatTicks, peak,
    tickMs: { mean: tickMs.reduce((s, x) => s + x, 0) / Math.max(1, tickMs.length), p95: pct(0.95), p99: pct(0.99), max: pct(1) },
    stepMs, snapshotMs: snapMs / Math.max(1, snapN),
    guest: {
      bytesPerSec: Math.round(g.bytes / (combatTicks / TICK_RATE)), peakBytesPerSec: g.peakSecond, msgsPerSec: g.msgs / (combatTicks / TICK_RATE),
      snapsPerSec: g.snaps / (combatTicks / TICK_RATE), avgSnapBytes: Math.round(g.snapBytes / Math.max(1, g.snaps)), maxSnapBytes: g.maxSnap,
      fullSnapBytes: auth.metrics().snapshotBytes, eventsPerSec: g.events / (combatTicks / TICK_RATE), eventBytesPerSec: Math.round(g.eventBytes / (combatTicks / TICK_RATE)),
    },
    mismatches, decoded,
  };
}

const fields: Record<string, number> = {};
function tally(d: Record<string, unknown>) {
  const add = (k: string, v: unknown) => { fields[k] = (fields[k] ?? 0) + JSON.stringify(v).length; };
  for (const [k, v] of Object.entries((d.s ?? {}) as Record<string, unknown>)) add('s.' + k, v);
  for (const [k, ld] of Object.entries((d.l ?? {}) as Record<string, { u?: Record<string, unknown>[]; r?: unknown; o?: unknown }>)) {
    if (ld.r) add(k + '.r', ld.r);
    if (ld.o) add(k + '.o', ld.o);
    for (const u of ld.u ?? []) for (const [f, v] of Object.entries(u)) add(k + '.' + f, v);
  }
}
afterAll(() => { if (process.env.NL_FIELDS) console.log(Object.entries(fields).sort((a, b) => b[1] - a[1]).slice(0, 40)); });

const fmt =(r: LoadResult) => JSON.stringify(r, (_, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));

describe('late-round network load', () => {
  const round = Number(process.env.NL_ROUND ?? 19);
  const sec = Number(process.env.NL_SEC ?? 30);

  it('keeps host tick time and per-guest bandwidth inside budget with delta snapshots', () => {
    const r = runLoad({ codec: SNAP_CODEC, round, sec, loss: 0.1 });
    console.log(`[netload] delta  ${fmt(r)}`);
    expect(r.combatTicks).toBeGreaterThan(sec * TICK_RATE * 0.9);
    expect(r.peak.enemies).toBeGreaterThan(40);          // the scenario really is crowded
    expect(r.mismatches).toBe(0);                        // every decoded snapshot equals the authority's
    expect(r.decoded).toBeGreaterThan(sec * 15);
    // budgets (the full-snapshot stream it replaced measured ~550 KB/s mean and ~790 KB/s peak per guest in this fight)
    expect(r.guest.bytesPerSec).toBeLessThan(110_000);
    expect(r.guest.peakBytesPerSec).toBeLessThan(260_000);
    expect(r.guest.eventBytesPerSec).toBeLessThan(25_000);
    expect(r.tickMs.mean).toBeLessThan(4);
    expect(r.tickMs.p95).toBeLessThan(10);
  });

  it('still serves an older client full snapshots (no codec), within the old envelope', () => {
    const r = runLoad({ codec: 0, round, sec: Math.min(sec, 10) });
    console.log(`[netload] full   ${fmt(r)}`);
    expect(r.mismatches).toBe(0);
    expect(r.guest.avgSnapBytes).toBeGreaterThan(3000);   // whole snapshots, every time
    expect(r.tickMs.mean).toBeLessThan(4);
  });
});
