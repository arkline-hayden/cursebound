import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachPresence, CLOSE, PRESENCE_PATH, type PresenceHandle, type PresenceIdentity } from '../src/presence';

// Presence hub over a plain node http server with fake deps: tokens are `t-<accountId>`, friendships a mutable map.

interface Client {
  ws: WebSocket;
  msgs: any[];
  closed: Promise<{ code: number; reason: string }>;
  send(m: unknown): void;
  next(pred: (m: any) => boolean, ms?: number): Promise<any>;
  none(pred: (m: any) => boolean, ms?: number): Promise<void>;
}

let server: http.Server;
let hub: PresenceHandle;
let url: string;
let friendships: Map<string, Set<string>>;
let notifyFriends: ((id: string) => void) | null;

const who = (id: string): PresenceIdentity => ({ accountId: id, username: id, displayName: id.toUpperCase(), favoriteClass: 'vanguard' });
const befriend = (a: string, b: string) => {
  if (!friendships.has(a)) friendships.set(a, new Set());
  if (!friendships.has(b)) friendships.set(b, new Set());
  friendships.get(a)!.add(b); friendships.get(b)!.add(a);
};

async function start(tuning = {}) {
  server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
  hub = attachPresence(server, {
    async authenticate(token) { return token.startsWith('t-') ? who(token.slice(2)) : null; },
    async friendIds(id) { return [...(friendships.get(id) ?? [])]; },
    async identities(ids) { return ids.map(who); },
    onFriendsChanged(sub) { notifyFriends = sub; },
    log: { info() {}, warn() {}, error() {} },
  }, { authTimeoutMs: 300, idleMs: 5000, sweepMs: 50, ...tuning });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${PRESENCE_PATH}`;
}

function open(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs: any[] = [];
    const waiters = new Set<() => void>();
    ws.on('message', (d) => { msgs.push(JSON.parse(String(d))); waiters.forEach((w) => w()); });
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
    const c: Client = {
      ws, msgs, closed,
      send: (m) => ws.send(JSON.stringify(m)),
      next(pred, ms = 1500) {
        return new Promise((res, rej) => {
          const check = () => { const i = msgs.findIndex(pred); if (i >= 0) { const [m] = msgs.splice(i, 1); waiters.delete(check); clearTimeout(t); res(m); } };
          const t = setTimeout(() => { waiters.delete(check); rej(new Error('timed out waiting; have ' + JSON.stringify(msgs))); }, ms);
          waiters.add(check);
          check();
        });
      },
      async none(pred, ms = 250) {
        await new Promise((r) => setTimeout(r, ms));
        expect(msgs.filter(pred)).toEqual([]);
      },
    };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
  });
}

async function signIn(id: string): Promise<Client> {
  const c = await open();
  c.send({ t: 'auth', token: `t-${id}` });
  await c.next((m) => m.t === 'ready');
  await c.next((m) => m.t === 'friends');
  return c;
}

async function restart(tuning: Record<string, number>) {
  await hub.close();
  await new Promise<void>((r) => server.close(() => r()));
  await start(tuning);
}

const clients: Client[] = [];
const track = (c: Client) => { clients.push(c); return c; };

beforeEach(async () => {
  friendships = new Map();
  notifyFriends = null;
  await start();
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await hub.close();
  await new Promise<void>((r) => server.close(() => r()));
});

const coopStatus = { t: 'status', state: 'lobby', build: 'b1', joinable: true, roomCode: 'ABC123', mode: 'coop', seats: 1, maxSeats: 5 };

describe('presence hub', () => {
  it('closes a socket that does not authenticate within the timeout', async () => {
    const c = track(await open());
    const { code } = await c.closed;
    expect(code).toBe(CLOSE.authTimeout);
    expect(hub.connections()).toBe(0);
  });

  it('rejects a bad token and anything before auth', async () => {
    const a = track(await open());
    a.send({ t: 'auth', token: 'nope' });
    expect((await a.next((m) => m.t === 'error')).code).toBe('UNAUTHORIZED');
    expect((await a.closed).code).toBe(CLOSE.unauthorized);
    const b = track(await open());
    b.send({ t: 'ping' });
    expect((await b.closed).code).toBe(CLOSE.unauthorized);
  });

  it('sends ready and a friends snapshot, and fans status out to online friends only', async () => {
    befriend('alice', 'bob');
    const bob = track(await signIn('bob'));
    const carol = track(await signIn('carol'));
    const alice = track(await open());
    alice.send({ t: 'auth', token: 't-alice' });
    expect((await alice.next((m) => m.t === 'ready')).you).toEqual({ accountId: 'alice', username: 'alice', displayName: 'ALICE' });
    const snap = await alice.next((m) => m.t === 'friends');
    expect(snap.list).toEqual([{ accountId: 'bob', username: 'bob', displayName: 'BOB', favoriteClass: 'vanguard', online: true, status: null }]);
    expect(await bob.next((m) => m.t === 'presence')).toEqual({ t: 'presence', accountId: 'alice', online: true, status: null });

    alice.send(coopStatus);
    const p = await bob.next((m) => m.t === 'presence' && m.status);
    expect(p.status).toMatchObject({ state: 'lobby', joinable: true, roomCode: 'ABC123', seats: 1, maxSeats: 5, build: 'b1' });
    await carol.none((m) => m.t === 'presence');

    // solo or full rooms are never joinable, whatever the client claims
    alice.send({ ...coopStatus, mode: 'solo' });
    expect((await bob.next((m) => m.t === 'presence' && m.status)).status.joinable).toBe(false);
    alice.send({ ...coopStatus, seats: 5 });
    expect((await bob.next((m) => m.t === 'presence' && m.status)).status.joinable).toBe(false);

    alice.ws.close();
    expect(await bob.next((m) => m.t === 'presence' && !m.online)).toEqual({ t: 'presence', accountId: 'alice', online: false, status: null });
  });

  it('re-sends the friends snapshot when the friend list changes', async () => {
    const alice = track(await signIn('alice'));
    const bob = track(await signIn('bob'));
    befriend('alice', 'bob');
    notifyFriends!('alice');
    expect((await alice.next((m) => m.t === 'friends')).list.map((f: any) => [f.accountId, f.online])).toEqual([['bob', true]]);
    expect((await bob.next((m) => m.t === 'friends')).list.map((f: any) => f.accountId)).toEqual(['alice']);
  });

  it('delivers invites between friends only, carrying the host room code', async () => {
    befriend('alice', 'bob');
    const alice = track(await signIn('alice'));
    const bob = track(await signIn('bob'));
    const carol = track(await signIn('carol'));
    alice.send({ t: 'invite', to: 'bob' });
    expect((await alice.next((m) => m.t === 'error')).code).toBe('NO_ROOM');
    alice.send(coopStatus);
    alice.send({ t: 'invite', to: 'bob' });
    expect(await bob.next((m) => m.t === 'invite')).toEqual({ t: 'invite', from: { accountId: 'alice', username: 'alice', displayName: 'ALICE' }, roomCode: 'ABC123' });
    alice.send({ t: 'invite', to: 'carol' });
    expect((await alice.next((m) => m.t === 'error')).code).toBe('NOT_FRIENDS');
    await carol.none((m) => m.t === 'invite');
  });

  it('resolves a code only to a host advertising it as joinable', async () => {
    const host = track(await signIn('host'));
    const guest = track(await signIn('guest'));
    guest.send({ t: 'resolve', code: 'abc123' });
    expect(await guest.next((m) => m.t === 'resolved')).toEqual({ t: 'resolved', code: 'ABC123', host: null });
    host.send({ ...coopStatus, joinable: false });
    await new Promise((r) => setTimeout(r, 30));
    guest.send({ t: 'resolve', code: 'ABC123' });
    expect((await guest.next((m) => m.t === 'resolved')).host).toBeNull();
    host.send(coopStatus);
    await new Promise((r) => setTimeout(r, 30));
    guest.send({ t: 'resolve', code: 'abc123' });
    expect((await guest.next((m) => m.t === 'resolved')).host).toEqual({ accountId: 'host', username: 'host', displayName: 'HOST' });
  });

  it('relays signals between friends with a verified from, and blocks strangers', async () => {
    befriend('alice', 'bob');
    const alice = track(await signIn('alice'));
    const bob = track(await signIn('bob'));
    const mallory = track(await signIn('mallory'));
    alice.send({ t: 'signal', to: 'bob', session: 's1', data: { kind: 'offer', sdp: 'v=0', from: 'spoofed' }, from: { accountId: 'carol' } });
    const got = await bob.next((m) => m.t === 'signal');
    expect(got).toEqual({ t: 'signal', from: { accountId: 'alice', username: 'alice', displayName: 'ALICE' }, session: 's1', data: { kind: 'offer', sdp: 'v=0' } });
    bob.send({ t: 'signal', to: 'alice', session: 's1', data: { kind: 'answer', sdp: 'v=0' } });
    expect((await alice.next((m) => m.t === 'signal')).data.kind).toBe('answer');

    mallory.send({ t: 'signal', to: 'bob', session: 's2', data: { kind: 'offer', sdp: 'x' } });
    expect((await mallory.next((m) => m.t === 'error')).code).toBe('FORBIDDEN');
    await bob.none((m) => m.t === 'signal');
  });

  it('lets a code resolver signal the host, and the host reply, but nobody else', async () => {
    const host = track(await signIn('host'));
    const guest = track(await signIn('guest'));
    const other = track(await signIn('other'));
    host.send(coopStatus);
    await new Promise((r) => setTimeout(r, 30));
    guest.send({ t: 'signal', to: 'host', session: 'g1', data: { kind: 'offer', sdp: 'x' } });
    expect((await guest.next((m) => m.t === 'error')).code).toBe('FORBIDDEN');
    guest.send({ t: 'resolve', code: 'ABC123' });
    await guest.next((m) => m.t === 'resolved');
    guest.send({ t: 'signal', to: 'host', session: 'g1', data: { kind: 'offer', sdp: 'x' } });
    expect((await host.next((m) => m.t === 'signal')).from.accountId).toBe('guest');
    host.send({ t: 'signal', to: 'guest', session: 'g1', data: { kind: 'answer', sdp: 'y' } });
    expect((await guest.next((m) => m.t === 'signal')).data).toEqual({ kind: 'answer', sdp: 'y' });
    // the host may not use that to reach third parties, and third parties gain nothing
    host.send({ t: 'signal', to: 'other', session: 'g2', data: { kind: 'offer', sdp: 'z' } });
    expect((await host.next((m) => m.t === 'error')).code).toBe('FORBIDDEN');
    other.send({ t: 'signal', to: 'host', session: 'g3', data: { kind: 'offer', sdp: 'z' } });
    expect((await other.next((m) => m.t === 'error')).code).toBe('FORBIDDEN');
    // the grant outlives the guest's socket: a reload mid-run can re-signal the host (even if no longer joinable)
    host.send({ ...coopStatus, state: 'run', joinable: false });
    guest.ws.close();
    await guest.closed;
    const back = track(await signIn('guest'));
    back.send({ t: 'signal', to: 'host', session: 'g4', data: { kind: 'offer', sdp: 'x' } });
    expect((await host.next((m) => m.t === 'signal' && m.session === 'g4')).from.accountId).toBe('guest');
  });

  it('drops a silent socket after the idle window and broadcasts offline; pings keep it alive', async () => {
    await restart({ idleMs: 400 });
    befriend('alice', 'bob');
    const bob = track(await signIn('bob'));
    const alice = track(await signIn('alice'));
    await bob.next((m) => m.t === 'presence' && m.online);
    const keep = setInterval(() => bob.send({ t: 'ping' }), 100);
    try {
      expect((await alice.closed).code).toBe(CLOSE.idle);
      expect(await bob.next((m) => m.t === 'presence' && !m.online)).toMatchObject({ accountId: 'alice', online: false });
      await bob.next((m) => m.t === 'pong');
      expect(bob.ws.readyState).toBe(WebSocket.OPEN);
    } finally { clearInterval(keep); }
  });

  it('counts several sockets of one account as one presence', async () => {
    befriend('alice', 'bob');
    const bob = track(await signIn('bob'));
    const a1 = track(await signIn('alice'));
    await bob.next((m) => m.t === 'presence' && m.online);
    const a2 = track(await signIn('alice'));
    await bob.none((m) => m.t === 'presence', 150);
    expect(hub.connections()).toBe(3);

    // the latest status from either window wins
    a2.send(coopStatus);
    expect((await bob.next((m) => m.t === 'presence')).status.roomCode).toBe('ABC123');
    // invites and signals reach both windows
    bob.send({ t: 'signal', to: 'alice', session: 'm1', data: { kind: 'offer', sdp: 'x' } });
    await a1.next((m) => m.t === 'signal');
    await a2.next((m) => m.t === 'signal');
    // once a window answers, that session's further messages go to it alone
    a2.send({ t: 'signal', to: 'bob', session: 'm1', data: { kind: 'answer', sdp: 'y' } });
    await bob.next((m) => m.t === 'signal');
    bob.send({ t: 'signal', to: 'alice', session: 'm1', data: { kind: 'ice', candidate: { candidate: 'c' } } });
    await a2.next((m) => m.t === 'signal' && m.data.kind === 'ice');
    await a1.none((m) => m.t === 'signal' && m.data.kind === 'ice');

    // closing the window that set the status falls back to the other window's (none): still online
    a2.ws.close();
    expect(await bob.next((m) => m.t === 'presence')).toEqual({ t: 'presence', accountId: 'alice', online: true, status: null });
    a1.ws.close();
    expect(await bob.next((m) => m.t === 'presence')).toEqual({ t: 'presence', accountId: 'alice', online: false, status: null });
  });

  it('enforces the message size and the per-socket rate limit', async () => {
    await restart({ rateBurst: 5, ratePerSec: 1 });
    const a = track(await signIn('alice'));
    for (let i = 0; i < 8; i++) a.send({ t: 'ping' });
    expect((await a.next((m) => m.t === 'error')).code).toBe('RATE_LIMITED');
    const b = track(await signIn('bob'));
    b.send({ t: 'status', state: 'menu', build: 'x'.repeat(20 * 1024), joinable: false });
    expect((await b.closed).code).toBe(1009);
  });
});
