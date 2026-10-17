import { describe, expect, it } from 'vitest';
import { contentHash } from '@cursebound/content';
import { SNAP_CODEC, SnapDecoder, snapEqual, unpackEvents, type ServerMessage } from '@cursebound/protocol';
import { buildSnapshot, createRun, type SimEvent } from '@cursebound/simulation';
import { RunAuthority, wireEvent, type SeatLink } from '../src/authority';
import type { Logger } from '../src/persistence/logger';

// The authority's snapshot stream per seat: full snapshots until a delta seat acknowledges one, then deltas against the
// newest acknowledgement; a backed-up link skips snapshots (vital events still go); a trailing acknowledgement lowers
// that seat's rate; every payload is serialized once.

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; }, async close() {} };

interface FakeLink extends SeatLink { got: string[]; queued: number }

function rig(codecs: number[]) {
  const state = createRun({
    runId: 'stream', seed: 'STREAM', mode: 'coop', trust: 'local', contentHash: contentHash(),
    roster: codecs.map((_, i) => ({ slot: i, profileId: 'p' + i, name: 'P' + i, classId: 'vanguard' })),
  });
  const links: FakeLink[] = codecs.map((codec, slot) => {
    const l: FakeLink = {
      slot, debug: false, connected: true, codec, got: [], queued: 0,
      buffered: () => l.queued,
      send: (m: ServerMessage) => { l.got.push(JSON.stringify(m)); },
      sendRaw: (s: string) => { l.got.push(s); },
    };
    return l;
  });
  const auth = new RunAuthority({ state, store: null as never, logger: quiet, host: { links: () => links, onRunEnded() {}, onStateChange() {} }, boardKey: 'x', practice: true, training: true });
  return { state, links, auth };
}

const snaps = (l: FakeLink) => l.got.map((s) => JSON.parse(s) as ServerMessage).filter((m): m is Extract<ServerMessage, { t: 'SNAPSHOT' }> => m.t === 'SNAPSHOT');

describe('authority snapshot stream', () => {
  it('sends full snapshots until a delta seat acknowledges, then deltas it can decode; older clients always get full ones', () => {
    const { state, links, auth } = rig([SNAP_CODEC, 0]);
    const dec = new SnapDecoder();
    auth.sendSnapshot();
    expect(snaps(links[0])[0].snap).toBeTruthy();
    const first = dec.decode(snaps(links[0])[0])!;
    auth.ackSnapshot(links[0], first.tick as number);
    auth.ackSnapshot(links[1], first.tick as number);    // no codec: ignored
    auth.ackSnapshot(links[0], state.tick + 999);          // never acknowledges the future
    for (let i = 0; i < 6; i++) auth.tick();
    auth.sendSnapshot();
    const last = snaps(links[0]).at(-1)!;
    expect(last.delta).toBeTruthy();
    expect(last.snap).toBeUndefined();
    expect(snapEqual(dec.decode(last), buildSnapshot(state))).toBe(true);
    expect(snaps(links[1]).every((m) => m.snap && !m.delta)).toBe(true);
    // the bridge recognizes snapshots by prefix
    expect(links[0].got.filter((s) => s.startsWith('{"t":"SNAPSHOT","ack":')).length).toBe(snaps(links[0]).length);
  });

  it('serializes each payload once for every seat that gets it', () => {
    const { links, auth } = rig([0, 0, 0]);
    auth.sendSnapshot();
    expect(links[1].got[0]).toBe(links[2].got[0]);    // the same string object content, one stringify
    expect(new Set(links.map((l) => snaps(l)[0].snap ? JSON.stringify(snaps(l)[0].snap) : '')).size).toBe(1);
  });

  it('skips snapshots for a backed-up link but still sends its vital events', () => {
    const { links, auth } = rig([SNAP_CODEC, SNAP_CODEC]);
    const buf = (auth as unknown as { eventBuffer: SimEvent[] }).eventBuffer;
    buf.push({ t: 'hit', target: 1, targetKind: 'enemy', amount: '1|1', crit: false, dtype: 'physical', x: 1, y: 1 } as SimEvent, { t: 'downed', slot: 1 });
    links[1].queued = 1 << 20;
    auth.sendSnapshot();
    expect(snaps(links[0])).toHaveLength(1);
    expect(snaps(links[1])).toHaveLength(0);
    const ev = (l: FakeLink) => l.got.map((s) => JSON.parse(s) as ServerMessage).flatMap((m) => (m.t === 'EVENTS' ? unpackEvents(m.pk!) : []));
    expect(ev(links[0]).map((e) => e.t)).toEqual(['hit', 'downed']);
    expect(ev(links[1]).map((e) => e.t)).toEqual(['downed']);
  });

  it('lowers a seat’s snapshot rate while its acknowledgements trail far behind', () => {
    const { state, links, auth } = rig([SNAP_CODEC]);
    auth.sendSnapshot();
    auth.ackSnapshot(links[0], state.tick);
    for (let i = 0; i < 60; i++) auth.tick();   // a second of snapshots, none acknowledged
    const before = snaps(links[0]).length;
    for (let i = 0; i < 8; i++) auth.sendSnapshot();
    expect(snaps(links[0]).length - before).toBeLessThanOrEqual(4);
    // caught up: every snapshot again
    auth.ackSnapshot(links[0], state.tick);
    const mid = snaps(links[0]).length;
    for (let i = 0; i < 4; i++) auth.sendSnapshot();
    expect(snaps(links[0]).length - mid).toBe(4);
  });

  it('rounds event floats for the wire without touching the sim’s event', () => {
    const e = { t: 'cast', slot: 0, skill: 'v_cleave', x: 31.138671875, y: 18.6376953125, dx: -0.7466598432279095, dy: -0.6652060421485012 } as SimEvent;
    const w = wireEvent(e) as unknown as Record<string, number>;
    expect([w.x, w.y, w.dx, w.dy]).toEqual([31.139, 18.638, -0.747, -0.665]);
    expect((e as unknown as Record<string, number>).x).toBe(31.138671875);
    const whole = { t: 'downed', slot: 1 } as SimEvent;
    expect(wireEvent(whole)).toBe(whole);
  });
});
