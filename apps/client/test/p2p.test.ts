import { afterEach, describe, expect, it } from 'vitest';
import { SNAP_CODEC, encodeSnapDelta, packEvents } from '@cursebound/protocol';
import { HostBridge, type HostDeps, type SeatReply } from '../src/lib/p2p/host';
import { openGuestLink, type GuestDeps } from '../src/lib/p2p/guest';
import { P2PError, type PeerLike, type SessionDesc } from '../src/lib/p2p/peer';
import type { PeerId, SignalData, SignalIn, Signaling } from '../src/lib/p2p/presence';
import { channelTransport, type ChannelLike, type GameTransport, type TransportState } from '../src/lib/p2p/transport';
import { GameConnection, netStore } from '../src/lib/net';

// Guest ⇄ host bridge without a browser: an in-memory signal bus that stamps `from` like the cloud hub, fake peer
// connections whose data channels pair up when offer/answer complete, and a fake authority socket.

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('condition not met'); await tick(5); }
}

class Bus {
  private subs = new Map<string, Set<(m: SignalIn) => void>>();
  log: { from: string; to: string; data: SignalData }[] = [];
  endpoint(who: PeerId): Signaling {
    return {
      send: (to, session, data) => {
        this.log.push({ from: who.accountId, to, data });
        // the hub stamps the verified sender; the sender cannot choose it
        setTimeout(() => this.subs.get(to)?.forEach((f) => f({ from: who, session, data })), 0);
      },
      onSignal: (fn) => {
        if (!this.subs.has(who.accountId)) this.subs.set(who.accountId, new Set());
        this.subs.get(who.accountId)!.add(fn);
        return () => { this.subs.get(who.accountId)?.delete(fn); };
      },
    };
  }
  /** deliver a raw signal as if the hub relayed it from `from` */
  inject(to: string, m: SignalIn) { this.subs.get(to)?.forEach((f) => f(m)); }
}

class FakeChannel implements ChannelLike {
  readyState: ChannelLike['readyState'] = 'connecting';
  peer: FakeChannel | null = null;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  /** queued bytes as a test sets them (a real channel's grows when the path is slower than the sender) */
  bufferedAmount = 0;
  sent: string[] = [];
  constructor(public label: string, public opts: { ordered?: boolean; maxRetransmits?: number } = {}) {}
  send(data: string) {
    if (this.readyState !== 'open') throw new Error('channel not open');
    this.sent.push(data);
    const peer = this.peer;
    setTimeout(() => { if (peer?.readyState === 'open') peer.onmessage?.({ data }); }, 0);
  }
  open() { this.readyState = 'open'; this.onopen?.(); }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    setTimeout(() => { this.onclose?.(); this.peer?.close(); }, 0);
  }
}

let peerSeq = 0;
const bySdp = new Map<string, FakePeer>();
class FakePeer implements PeerLike {
  id = ++peerSeq;
  connectionState = 'new';
  channels: FakeChannel[] = [];
  /** answerer side: labels it refuses like an older build (closes them on arrival) */
  constructor(private refuse: string[] = []) {}
  remote: SessionDesc | null = null;
  candidates: RTCIceCandidateInit[] = [];
  onicecandidate: PeerLike['onicecandidate'] = null;
  ondatachannel: PeerLike['ondatachannel'] = null;
  onconnectionstatechange: (() => void) | null = null;
  createDataChannel(label: string, opts?: { ordered?: boolean; maxRetransmits?: number }) { const c = new FakeChannel(label, opts); this.channels.push(c); return c; }
  async createOffer() { return { type: 'offer', sdp: `offer-${this.id}` }; }
  async createAnswer() { return { type: 'answer', sdp: `answer-${this.id}` }; }
  async setLocalDescription(d: SessionDesc) {
    bySdp.set(d.sdp!, this);
    setTimeout(() => this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `cand-${this.id}`, sdpMid: '0' }) } }), 0);
  }
  async setRemoteDescription(d: SessionDesc) {
    this.remote = d;
    if (d.type !== 'answer') return;
    // offerer got the answer: hand the answerer its end of the channel, then open both
    const answerer = bySdp.get(d.sdp!)!;
    const pairs = this.channels.map((a) => { const b = new FakeChannel(a.label, a.opts); a.peer = b; b.peer = a; answerer.channels.push(b); return [a, b] as const; });
    setTimeout(() => {
      this.connectionState = answerer.connectionState = 'connected';
      for (const [a, b] of pairs) {
        b.open(); a.open();
        if (answerer.refuse.includes(b.label)) { b.close(); continue; }   // an older build closes unknown channels
        answerer.ondatachannel?.({ channel: b });
      }
    }, 0);
  }
  async addIceCandidate(c: RTCIceCandidateInit) { this.candidates.push(c); }
  close() { this.connectionState = 'closed'; for (const c of this.channels) c.close(); }
}

class FakeSocket implements GameTransport {
  readyState: TransportState = 'connecting';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  constructor() { setTimeout(() => { this.readyState = 'open'; this.onopen?.(); }, 0); }
  send(d: string) { this.sent.push(d); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; }
  /** the authority ends the connection */
  serverClose(code: number, reason: string) { this.readyState = 'closed'; this.onclose?.(code, reason); }
}

const HOST: PeerId = { accountId: 'host', username: 'host', displayName: 'Host' };
const GUEST: PeerId = { accountId: 'guest', username: 'guest', displayName: 'Guest' };
const GUEST2: PeerId = { accountId: 'guest2', username: 'guest2', displayName: 'Guest Two' };
const ROOM = { roomId: 'room-1', code: 'ABC123', maxSeats: 5 };

function setup(maxSeats = 5, hostRefuses: string[] = []) {
  const bus = new Bus();
  const sockets: FakeSocket[] = [];
  const linked: PeerId[] = [];
  const joins: { code: string; profileId: string; classId: string }[] = [];
  let slot = 0;
  const deps: HostDeps = {
    signaling: bus.endpoint(HOST),
    iceServers: async () => [],
    createPeer: () => new FakePeer(hostRefuses),
    linkProfile: async (who) => { linked.push(who); return { id: `p-${who.accountId}` }; },
    joinRoom: async (code, profileId, classId): Promise<SeatReply> => {
      joins.push({ code, profileId, classId });
      return { roomId: ROOM.roomId, code, seatToken: `tok-${profileId}`, slot: ++slot };
    },
    openSocket: async () => { const s = new FakeSocket(); sockets.push(s); return s; },
  };
  const bridge = new HostBridge(deps);
  bridge.start({ ...ROOM, maxSeats });
  const guestDeps = (who: PeerId, timeoutMs = 1000): GuestDeps => ({ signaling: bus.endpoint(who), iceServers: async () => [], createPeer: () => new FakePeer(), timeoutMs });
  return { bus, bridge, sockets, linked, joins, guestDeps };
}

let bridges: HostBridge[] = [];
afterEach(() => { bridges.forEach((b) => b.stop()); bridges = []; });

describe('peer-to-peer guest ⇄ host bridge', () => {
  it('joins through the bridge with the cloud-verified identity and gets a seat', async () => {
    const s = setup(); bridges.push(s.bridge);
    const open = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'arcanist', code: 'abc123' });
    expect(open.reply).toEqual({ rpc: 'joined', roomId: 'room-1', seatToken: 'tok-p-guest', slot: 1, code: 'ABC123' });
    expect(s.linked).toEqual([GUEST]);
    expect(s.joins).toEqual([{ code: 'ABC123', profileId: 'p-guest', classId: 'arcanist' }]);
    // trickle ICE flowed both ways over the bus
    expect(s.bus.log.filter((l) => l.data.kind === 'ice').map((l) => l.from).sort()).toEqual(['guest', 'host']);
    await until(() => s.bridge.guests().length === 1);
    expect(s.bridge.guests()).toEqual([GUEST]);
  });

  it('pipes the room protocol verbatim both ways, opening the authority socket on the guest’s first frame', async () => {
    const s = setup(); bridges.push(s.bridge);
    const open = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    await tick(10);
    expect(s.sockets).toHaveLength(0);
    const t = channelTransport(open.channel, open.dispose);
    const got: string[] = [];
    t.onmessage = (d) => got.push(d);
    // handed over already open: no onopen event follows (GameTransport contract)
    expect(t.readyState).toBe('open');
    const hello = JSON.stringify({ t: 'HELLO', protocol: 1, roomId: 'room-1', seatToken: 'tok-p-guest' });
    t.send(hello);
    t.send('{"t":"PING","c":1}');
    await until(() => s.sockets[0]?.sent.length === 2);
    expect(s.sockets).toHaveLength(1);
    expect(s.sockets[0].sent).toEqual([hello, '{"t":"PING","c":1}']);
    s.sockets[0].onmessage!('{"t":"WELCOME","slot":1}');
    s.sockets[0].onmessage!('{"t":"PONG","c":1,"serverTick":9}');
    await until(() => got.length === 2);
    expect(got).toEqual(['{"t":"WELCOME","slot":1}', '{"t":"PONG","c":1,"serverTick":9}']);
  });

  it('forwards the authority’s close code to the guest transport and frees the pipe', async () => {
    const s = setup(); bridges.push(s.bridge);
    const open = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    const t = channelTransport(open.channel, open.dispose);
    const closed = new Promise<[number, string]>((r) => { t.onclose = (c, why) => r([c, why]); });
    await tick(5);
    t.send('{"t":"HELLO"}');
    await until(() => s.sockets.length === 1 && s.sockets[0].readyState === 'open');
    s.sockets[0].serverClose(4004, 'seat not found');
    expect(await closed).toEqual([4004, 'seat not found']);
    await until(() => s.bridge.guests().length === 0);
  });

  it('closes the host’s authority socket when the guest leaves', async () => {
    const s = setup(); bridges.push(s.bridge);
    const open = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    const t = channelTransport(open.channel, open.dispose);
    await tick(5);
    t.send('{"t":"HELLO"}');
    await until(() => s.sockets[0]?.readyState === 'open');
    t.close();
    await until(() => s.sockets[0].readyState === 'closed' && s.bridge.guests().length === 0);
  });

  it('enforces the room’s seat limit', async () => {
    const s = setup(2); bridges.push(s.bridge);
    await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    const err = await openGuestLink(s.guestDeps(GUEST2), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' }).catch((e: P2PError) => e);
    expect(err).toBeInstanceOf(P2PError);
    expect((err as P2PError).code).toBe('ROOM_FULL');
    expect(s.joins).toHaveLength(1);
  });

  it('rejoins with the stored seat (no second seat) and refuses another room', async () => {
    const s = setup(); bridges.push(s.bridge);
    const first = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    first.dispose();
    const again = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'rejoin', roomId: 'room-1', code: 'ABC123' });
    expect(again.reply).toEqual({ rpc: 'joined', roomId: 'room-1', code: 'ABC123' });
    expect(s.joins).toHaveLength(1);
    const wrong = await openGuestLink(s.guestDeps(GUEST2), HOST, { rpc: 'rejoin', roomId: 'room-9', code: 'ABC123' }).catch((e: P2PError) => e);
    expect((wrong as P2PError).code).toBe('NOT_FOUND');
  });

  it('ignores signals for a session from any other account', async () => {
    const s = setup(); bridges.push(s.bridge);
    await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    const offer = s.bus.log.find((l) => l.data.kind === 'offer')!;
    expect(offer.from).toBe('guest');
    // a third party that learned the session id cannot end or poison the guest's pipe
    const pipes = (s.bridge as unknown as { pipes: Map<string, { session: string }> }).pipes;
    const real = [...pipes.values()][0].session;
    s.bus.inject('host', { from: GUEST2, session: real, data: { kind: 'bye' } });
    s.bus.inject('host', { from: GUEST2, session: real, data: { kind: 'offer', sdp: 'offer-x' } });
    await tick(20);
    expect(s.bridge.guests()).toEqual([GUEST]);
    s.bus.inject('host', { from: GUEST, session: real, data: { kind: 'bye' } });
    await until(() => s.bridge.guests().length === 0);
  });

  /** a joined guest with its transport, past HELLO, and the host-side ends of its channels */
  async function piped(s: ReturnType<typeof setup>) {
    const open = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    await tick(5);
    const t = channelTransport(open.channel, open.dispose, open.snapChannel);
    const got: string[] = [];
    t.onmessage = (d) => got.push(d);
    t.send('{"t":"HELLO"}');
    await until(() => s.sockets[0]?.readyState === 'open');
    const pipe = [...(s.bridge as unknown as { pipes: Map<string, { ch: FakeChannel; snapCh: FakeChannel | null }> }).pipes.values()][0];
    return { open, t, got, sock: s.sockets[0], pipe };
  }
  const DELTA = (tick: number) => `{"t":"SNAPSHOT","ack":1234567890,"held":12,"delta":{"b":${tick - 3},"tick":${tick}}}`;
  const FULL = (tick: number) => `{"t":"SNAPSHOT","ack":3,"snap":{"tick":${tick},"players":[]}}`;

  it('sends delta snapshots on the unreliable channel and everything else reliably', async () => {
    const s = setup(); bridges.push(s.bridge);
    const { open, got, sock, pipe } = await piped(s);
    expect(open.snapChannel).not.toBeNull();
    expect(pipe.snapCh?.label).toBe('cbs');
    expect(pipe.snapCh?.opts).toEqual({ ordered: false, maxRetransmits: 0 });
    sock.onmessage!(FULL(3));
    sock.onmessage!(DELTA(6));
    sock.onmessage!('{"t":"EVENTS","tick":6,"events":[]}');
    await until(() => got.length === 3);
    expect(pipe.snapCh!.sent).toEqual([DELTA(6)]);
    expect(pipe.ch.sent).toEqual([expect.stringContaining('"rpc":"joined"'), FULL(3), '{"t":"EVENTS","tick":6,"events":[]}']);
    expect(got.sort()).toEqual([FULL(3), DELTA(6), '{"t":"EVENTS","tick":6,"events":[]}'].sort());
  });

  it('drops snapshots (never queues them) while a channel is backed up; other frames still go', async () => {
    const s = setup(); bridges.push(s.bridge);
    const { sock, pipe } = await piped(s);
    pipe.snapCh!.bufferedAmount = 1 << 20;
    pipe.ch.bufferedAmount = 1 << 20;
    const before = pipe.ch.sent.length;
    sock.onmessage!(DELTA(6));
    sock.onmessage!(FULL(9));
    sock.onmessage!('{"t":"PHASE","phase":"VOTING"}');
    expect(pipe.snapCh!.sent).toEqual([]);
    expect(pipe.ch.sent.slice(before)).toEqual(['{"t":"PHASE","phase":"VOTING"}']);
    expect(s.bridge.droppedSnapshots()).toEqual({ guest: 2 });
    // drained: the newest snapshot goes out
    pipe.snapCh!.bufferedAmount = 0; pipe.ch.bufferedAmount = 0;
    sock.onmessage!(DELTA(12));
    expect(pipe.snapCh!.sent).toEqual([DELTA(12)]);
  });

  it('ends a pipe whose reliable backlog can no longer catch up (the guest rejoins with a resync)', async () => {
    const s = setup(); bridges.push(s.bridge);
    const { sock, pipe } = await piped(s);
    pipe.ch.bufferedAmount = 64 << 20;
    sock.onmessage!('{"t":"EVENTS","tick":6,"events":[]}');
    await until(() => s.bridge.guests().length === 0);
  });

  it('works with a host build that refuses the snapshot channel: everything rides the main channel', async () => {
    const s = setup(5, ['cbs']); bridges.push(s.bridge);
    const { open, got, sock, pipe } = await piped(s);
    await until(() => open.snapChannel === null);
    expect(pipe.snapCh).toBeNull();
    sock.onmessage!(DELTA(6));
    sock.onmessage!(FULL(9));
    await until(() => got.length === 2);
    expect(got).toEqual([DELTA(6), FULL(9)]);
    expect(s.bridge.guests()).toEqual([GUEST]);
  });

  it('does not answer when no room is hosted (the guest times out)', async () => {
    const s = setup(); bridges.push(s.bridge);
    s.bridge.stop();
    const err = await openGuestLink(s.guestDeps(GUEST, 150), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' }).catch((e: P2PError) => e);
    expect((err as P2PError).code).toBe('TIMEOUT');
  });
});

describe('GameConnection over a transport', () => {
  it('sends HELLO on open, reconnects through the factory, and stops on a refusal', async () => {
    const made: FakeSocket[] = [];
    const c = new GameConnection('room-1', 'seat-tok', async () => { const s = new FakeSocket(); made.push(s); return s; });
    c.connect();
    await until(() => made[0]?.sent.length >= 1);
    const hello = JSON.parse(made[0].sent[0]);
    expect(hello).toMatchObject({ t: 'HELLO', roomId: 'room-1', seatToken: 'seat-tok' });
    expect(netStore.get().status).toBe('open');
    made[0].serverClose(1006, 'lost');
    expect(netStore.get().status).toBe('reconnecting');
    await until(() => made.length === 2 && made[1].sent.length >= 1, 2000);
    expect(JSON.parse(made[1].sent[0]).seatToken).toBe('seat-tok');
    made[1].serverClose(4004, 'seat not found');
    expect(netStore.get()).toMatchObject({ status: 'error', error: 'seat not found' });
    c.close();
  });

  it('offers delta snapshots, decodes them and packed events, and acknowledges each snapshot once the authority agrees', async () => {
    const made: FakeSocket[] = [];
    const c = new GameConnection('room-1', 'seat-tok', async () => { const s = new FakeSocket(); made.push(s); return s; });
    c.connect();
    await until(() => made[0]?.sent.length >= 1);
    const sock = made[0];
    expect(JSON.parse(sock.sent[0])).toMatchObject({ t: 'HELLO', snap: SNAP_CODEC });
    const s3 = { tick: 3, phase: 'COMBAT', round: 2, players: [], enemies: [{ i: 1, k: 'pursuer', x: 1, y: 1 }, { i: 2, k: 'hexer', x: 5, y: 5, dor: 1 }], enc: { round: 2, activeTicks: 3 } };
    const s6 = { tick: 6, phase: 'COMBAT', round: 2, players: [], enemies: [{ i: 2, k: 'hexer', x: 5, y: 5 }, { i: 3, k: 'skirmisher', x: 9, y: 2 }], enc: { round: 2, activeTicks: 6 } };
    sock.onmessage!(JSON.stringify({ t: 'WELCOME', slot: 0, snap: SNAP_CODEC }));
    sock.onmessage!(JSON.stringify({ t: 'SNAPSHOT', ack: 0, snap: s3 }));
    sock.onmessage!(JSON.stringify({ t: 'SNAPSHOT', ack: 0, delta: encodeSnapDelta(s3, s6) }));
    // a late snapshot (unordered channel) and a delta against a base this client never had are dropped
    sock.onmessage!(JSON.stringify({ t: 'SNAPSHOT', ack: 0, snap: { ...s3, tick: 4 } }));
    sock.onmessage!(JSON.stringify({ t: 'SNAPSHOT', ack: 0, delta: { b: 5, tick: 9 } }));
    expect(c.snaps.map((x) => x.snap.tick)).toEqual([3, 6]);
    expect(c.snaps[1].snap).toEqual(s6);
    expect(sock.sent.slice(1).map((m) => JSON.parse(m)).filter((m) => m.t === 'SACK')).toEqual([{ t: 'SACK', tick: 3 }, { t: 'SACK', tick: 6 }]);
    const evs = [{ t: 'hit', target: 2, x: 1.5 }, { t: 'death', id: 2, kind: 'hexer', x: 1, y: 2 }, { t: 'hit', target: 3, x: 2 }];
    sock.onmessage!(JSON.stringify({ t: 'EVENTS', tick: 6, pk: packEvents(evs) }));
    expect(c.events.slice(-3)).toEqual(evs);
    c.close();
  });

  it('never acknowledges snapshots to an authority that did not confirm the codec (an older build)', async () => {
    const made: FakeSocket[] = [];
    const c = new GameConnection('room-1', 'seat-tok', async () => { const s = new FakeSocket(); made.push(s); return s; });
    c.connect();
    await until(() => made[0]?.sent.length >= 1);
    const sock = made[0];
    sock.onmessage!(JSON.stringify({ t: 'WELCOME', slot: 0 }));
    sock.onmessage!(JSON.stringify({ t: 'SNAPSHOT', ack: 0, snap: { tick: 9, phase: 'COMBAT', players: [] } }));
    sock.onmessage!(JSON.stringify({ t: 'SNAPSHOT', ack: 0, snap: { tick: 3, phase: 'COMBAT', players: [] } }));
    expect(c.snaps.map((x) => x.snap.tick)).toEqual([9, 3]);   // full snapshots taken as they come, as before
    expect(sock.sent.some((m) => m.includes('SACK'))).toBe(false);
    c.close();
  });

  it('runs a guest end to end: join through the bridge, then HELLO over the already-open channel, then rejoin', async () => {
    const s = setup(); bridges.push(s.bridge);
    const first = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'join', classId: 'vanguard', code: 'ABC123' });
    let claimed = false;
    // like guest.ts: the join's channel on first use, a re-signalled rejoin afterwards
    const factory = async () => {
      if (!claimed) { claimed = true; return channelTransport(first.channel, first.dispose); }
      const again = await openGuestLink(s.guestDeps(GUEST), HOST, { rpc: 'rejoin', roomId: 'room-1', code: 'ABC123' });
      return channelTransport(again.channel, again.dispose);
    };
    const c = new GameConnection('room-1', first.reply.seatToken!, factory);
    c.connect();
    await until(() => s.sockets[0]?.sent.length === 1);
    expect(JSON.parse(s.sockets[0].sent[0])).toMatchObject({ t: 'HELLO', roomId: 'room-1', seatToken: 'tok-p-guest' });
    expect(netStore.get().status).toBe('open');
    s.sockets[0].onmessage!(JSON.stringify({ t: 'PAUSED', paused: true, reason: 'test' }));
    await until(() => netStore.get().paused.paused);
    // the host's authority drops the socket (not a refusal): the guest re-signals and says HELLO again
    s.sockets[0].serverClose(1006, 'lost');
    await until(() => s.sockets.length === 2 && s.sockets[1].sent.length === 1, 3000);
    expect(JSON.parse(s.sockets[1].sent[0]).seatToken).toBe('tok-p-guest');
    expect(s.joins).toHaveLength(1);
    c.close();
  });
});
