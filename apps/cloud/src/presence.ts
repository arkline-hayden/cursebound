import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

// Presence + signaling WebSocket (docs/contracts/ONLINE_CONTRACT.md "Presence and signaling").
// One in-memory hub per process (Cloud Run max-instances=1): who is online, what they are doing, friend fan-out,
// party invites, room-code resolution and the WebRTC signal relay. Gameplay never passes through here.
// Several sockets of one account (two windows) are one presence: online while any socket lives, status = the most
// recent status any of them sent. Every relayed signal carries a `from` stamped by the hub, never by the sender.

export interface PresenceIdentity { accountId: string; username: string; displayName: string; favoriteClass: string | null }

export interface PresenceDeps {
  /** resolve a bearer token to the signed-in account, or null */
  authenticate(token: string): Promise<PresenceIdentity | null>;
  /** accepted friends of an account */
  friendIds(accountId: string): Promise<string[]>;
  /** the HTTP side calls the registered function when an account's friend list changes (request accepted, removed…) */
  onFriendsChanged?: (subscribe: (accountId: string) => void) => void;
  /** optional: names for friends who are offline (the `friends` snapshot lists them too). Without it, offline friends
   * this process has never seen online are listed with their id as the name. */
  identities?(accountIds: string[]): Promise<PresenceIdentity[]>;
  log: { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };
}

export interface PresenceHandle {
  /** live socket count, for /healthz and metrics */
  connections(): number;
  close(): Promise<void>;
}

/** Timings and limits; the defaults are the contract's. Tests shorten them. */
export interface PresenceTuning {
  authTimeoutMs: number;
  /** a socket silent this long is dropped (clients ping every 20 s) */
  idleMs: number;
  /** how often the idle sweep runs */
  sweepMs: number;
  /** a resolved room code lets the resolver signal that host for this long */
  resolveTtlMs: number;
  maxMessageBytes: number;
  /** per-socket token bucket: burst size and refill per second (trickle ICE bursts ~20 candidates) */
  rateBurst: number;
  ratePerSec: number;
}

export const PRESENCE_PATH = '/api/v1/presence';
const DEFAULT_TUNING: PresenceTuning = {
  authTimeoutMs: 10_000, idleMs: 45_000, sweepMs: 5_000, resolveTtlMs: 10 * 60_000, maxMessageBytes: 16 * 1024, rateBurst: 60, ratePerSec: 20,
};

/** Close codes (4000-4999 are application codes). */
export const CLOSE = { authTimeout: 4000, unauthorized: 4001, idle: 4002, protocol: 4003, rateLimited: 4008, shutdown: 1001 } as const;

export type PresenceState = 'menu' | 'lobby' | 'run' | 'away';
export interface PresenceStatus {
  state: PresenceState; build: string; joinable: boolean;
  roomCode?: string; mode?: 'solo' | 'coop'; seats?: number; maxSeats?: number; round?: number; theme?: string;
}

type SignalKind = 'offer' | 'answer' | 'ice' | 'bye';

interface Conn {
  ws: WebSocket;
  id: number;
  account: Account | null;
  lastSeen: number;
  status: PresenceStatus | null;
  statusAt: number;
  tokens: number;
  refillAt: number;
  strikes: number;
  authTimer: ReturnType<typeof setTimeout> | null;
}

interface Account {
  who: PresenceIdentity;
  conns: Set<Conn>;
  friends: Set<string>;
  /** host accountId → expiry: hosts this account resolved by room code (may signal them, and they may reply) */
  resolved: Map<string, number>;
}

const STATES = new Set<PresenceState>(['menu', 'lobby', 'run', 'away']);
const KINDS = new Set<SignalKind>(['offer', 'answer', 'ice', 'bye']);
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Attach the presence WebSocket endpoint (`/api/v1/presence`) to the cloud HTTP server. */
export function attachPresence(server: http.Server, deps: PresenceDeps, tuning: Partial<PresenceTuning> = {}): PresenceHandle {
  const T: PresenceTuning = { ...DEFAULT_TUNING, ...tuning };
  const wss = new WebSocketServer({ noServer: true, maxPayload: T.maxMessageBytes, perMessageDeflate: false });
  const conns = new Set<Conn>();
  const accounts = new Map<string, Account>();
  /** names seen this process, for offline friends when deps.identities is absent */
  const seen = new Map<string, PresenceIdentity>();
  /** `${accountId}:${session}` → the socket of that account that took part in the session (multi-window routing) */
  const routes = new Map<string, { conn: Conn; at: number }>();
  let nextId = 1;
  let closed = false;

  const onUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== PRESENCE_PATH) {
      // leave other upgrade paths to other listeners; with none, refuse instead of letting the socket hang
      if (server.listenerCount('upgrade') <= 1) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); }
      return;
    }
    if (closed) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws));
  };
  server.on('upgrade', onUpgrade);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const c of conns) if (now - c.lastSeen > T.idleMs) { c.ws.close(CLOSE.idle, 'idle'); c.ws.terminate(); drop(c); }
    for (const [k, r] of routes) if (now - r.at > T.resolveTtlMs || !conns.has(r.conn)) routes.delete(k);
    for (const a of accounts.values()) for (const [h, exp] of a.resolved) if (exp <= now) a.resolved.delete(h);
  }, T.sweepMs);
  sweep.unref?.();

  deps.onFriendsChanged?.((accountId) => { void refreshFriends(accountId, true); });

  // ---- connection lifecycle ----

  function accept(ws: WebSocket) {
    const now = Date.now();
    const c: Conn = { ws, id: nextId++, account: null, lastSeen: now, status: null, statusAt: 0, tokens: T.rateBurst, refillAt: now, strikes: 0, authTimer: null };
    conns.add(c);
    c.authTimer = setTimeout(() => { if (!c.account) { ws.close(CLOSE.authTimeout, 'auth timeout'); drop(c); } }, T.authTimeoutMs);
    ws.on('message', (data, isBinary) => { void onMessage(c, data, isBinary); });
    ws.on('close', () => drop(c));
    ws.on('error', () => drop(c));
  }

  function drop(c: Conn) {
    if (!conns.delete(c)) return;
    if (c.authTimer) clearTimeout(c.authTimer);
    const a = c.account;
    if (!a) return;
    const before = effectiveStatus(a);
    a.conns.delete(c);
    if (a.conns.size === 0) {
      accounts.delete(a.who.accountId);
      broadcast(a, { t: 'presence', accountId: a.who.accountId, online: false, status: null });
      deps.log.info('presence_offline', { accountId: a.who.accountId });
    } else if (!sameStatus(before, effectiveStatus(a))) {
      broadcast(a, { t: 'presence', accountId: a.who.accountId, online: true, status: effectiveStatus(a) });
    }
  }

  function send(c: Conn, m: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  }
  function sendAccount(a: Account, m: unknown) { for (const c of a.conns) send(c, m); }
  function error(c: Conn, code: string, message: string) { send(c, { t: 'error', code, message }); }

  /** the status a friend sees: the most recently updated among the account's live sockets */
  function effectiveStatus(a: Account): PresenceStatus | null {
    let best: Conn | null = null;
    for (const c of a.conns) if (c.status && (!best || c.statusAt > best.statusAt)) best = c;
    return best?.status ?? null;
  }

  /** tell every online friend of `a` */
  function broadcast(a: Account, m: unknown) {
    for (const f of a.friends) { const fa = accounts.get(f); if (fa && fa.friends.has(a.who.accountId)) sendAccount(fa, m); }
  }

  function rateOk(c: Conn): boolean {
    const now = Date.now();
    c.tokens = Math.min(T.rateBurst, c.tokens + ((now - c.refillAt) / 1000) * T.ratePerSec);
    c.refillAt = now;
    if (c.tokens >= 1) { c.tokens -= 1; return true; }
    return false;
  }

  async function onMessage(c: Conn, data: RawData, isBinary: boolean) {
    if (!conns.has(c)) return;
    c.lastSeen = Date.now();
    if (isBinary) { c.ws.close(CLOSE.protocol, 'text frames only'); drop(c); return; }
    if (!rateOk(c)) {
      if (++c.strikes > T.rateBurst) { c.ws.close(CLOSE.rateLimited, 'rate limited'); drop(c); return; }
      error(c, 'RATE_LIMITED', 'slow down');
      return;
    }
    let m: Record<string, unknown>;
    try {
      const v = JSON.parse(data.toString()) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      m = v as Record<string, unknown>;
    } catch { error(c, 'BAD_MESSAGE', 'invalid JSON'); return; }

    if (!c.account) {
      if (m.t !== 'auth' || typeof m.token !== 'string' || m.token.length > 512) { c.ws.close(CLOSE.unauthorized, 'auth required'); drop(c); return; }
      await authenticate(c, m.token);
      return;
    }
    const a = c.account;
    switch (m.t) {
      case 'ping': send(c, { t: 'pong' }); return;
      case 'auth': error(c, 'ALREADY_AUTHED', 'already signed in on this socket'); return;
      case 'status': return onStatus(c, a, m);
      case 'invite': return onInvite(c, a, m);
      case 'resolve': return onResolve(c, a, m);
      case 'signal': return onSignal(c, a, m);
      default: error(c, 'BAD_MESSAGE', 'unknown message type');
    }
  }

  async function authenticate(c: Conn, token: string) {
    let who: PresenceIdentity | null = null;
    try { who = await deps.authenticate(token); } catch (err) { deps.log.warn('presence_auth_failed', { err: String(err) }); }
    if (!conns.has(c)) return;
    if (!who) { error(c, 'UNAUTHORIZED', 'sign in again'); c.ws.close(CLOSE.unauthorized, 'unauthorized'); drop(c); return; }
    if (c.authTimer) { clearTimeout(c.authTimer); c.authTimer = null; }
    seen.set(who.accountId, who);
    let a = accounts.get(who.accountId);
    const first = !a;
    if (!a) {
      let friends: string[] = [];
      try { friends = await deps.friendIds(who.accountId); } catch (err) { deps.log.warn('presence_friends_failed', { err: String(err) }); }
      if (!conns.has(c)) return;
      a = accounts.get(who.accountId);   // another socket of this account may have finished first
      if (!a) { a = { who, conns: new Set(), friends: new Set(friends), resolved: new Map() }; accounts.set(who.accountId, a); }
    }
    a.who = who;
    a.conns.add(c);
    c.account = a;
    send(c, { t: 'ready', you: { accountId: who.accountId, username: who.username, displayName: who.displayName } });
    send(c, { t: 'friends', list: await friendList(a) });
    if (first && a.conns.size === 1) {
      broadcast(a, { t: 'presence', accountId: who.accountId, online: true, status: null });
      deps.log.info('presence_online', { accountId: who.accountId });
    }
  }

  async function friendList(a: Account) {
    const ids = [...a.friends];
    const known = new Map<string, PresenceIdentity>();
    const missing: string[] = [];
    for (const id of ids) { const w = accounts.get(id)?.who ?? seen.get(id); if (w) known.set(id, w); else missing.push(id); }
    if (missing.length && deps.identities) {
      try { for (const w of await deps.identities(missing)) { known.set(w.accountId, w); seen.set(w.accountId, w); } } catch (err) { deps.log.warn('presence_identities_failed', { err: String(err) }); }
    }
    return ids.map((id) => {
      const w = known.get(id);
      const fa = accounts.get(id);
      return {
        accountId: id, username: w?.username ?? id, displayName: w?.displayName ?? w?.username ?? id, favoriteClass: w?.favoriteClass ?? null,
        online: !!fa, status: fa ? effectiveStatus(fa) : null,
      };
    });
  }

  /** reload an account's friends; with `cascade`, also refresh accounts that were added or removed (symmetry) */
  async function refreshFriends(accountId: string, cascade: boolean) {
    const a = accounts.get(accountId);
    if (!a) return;
    let next: string[];
    try { next = await deps.friendIds(accountId); } catch (err) { deps.log.warn('presence_friends_failed', { err: String(err) }); return; }
    const before = a.friends;
    a.friends = new Set(next);
    sendAccount(a, { t: 'friends', list: await friendList(a) });
    if (!cascade) return;
    const changed = [...new Set([...before, ...a.friends])].filter((id) => before.has(id) !== a.friends.has(id));
    for (const id of changed) if (accounts.has(id)) await refreshFriends(id, false);
  }

  // ---- messages ----

  function onStatus(c: Conn, a: Account, m: Record<string, unknown>) {
    const state = m.state as PresenceState;
    if (!STATES.has(state)) { error(c, 'BAD_MESSAGE', 'invalid state'); return; }
    const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);
    const st: PresenceStatus = { state, build: typeof m.build === 'string' ? m.build.slice(0, 64) : '', joinable: false };
    if (typeof m.roomCode === 'string' && CODE_RE.test(m.roomCode.toUpperCase())) st.roomCode = m.roomCode.toUpperCase();
    if (m.mode === 'solo' || m.mode === 'coop') st.mode = m.mode;
    const seats = int(m.seats, 16), maxSeats = int(m.maxSeats, 16), round = int(m.round, 1_000_000);
    if (seats !== undefined) st.seats = seats;
    if (maxSeats !== undefined) st.maxSeats = maxSeats;
    if (round !== undefined) st.round = round;
    if (typeof m.theme === 'string') st.theme = m.theme.slice(0, 32);
    // joinable only means something for a co-op room with a code and a free seat
    st.joinable = m.joinable === true && st.mode === 'coop' && !!st.roomCode && (state === 'lobby' || state === 'run')
      && (st.seats === undefined || st.maxSeats === undefined || st.seats < st.maxSeats);
    const before = effectiveStatus(a);
    c.status = st;
    c.statusAt = Date.now();
    const after = effectiveStatus(a);
    if (!sameStatus(before, after)) broadcast(a, { t: 'presence', accountId: a.who.accountId, online: true, status: after });
  }

  function onInvite(c: Conn, a: Account, m: Record<string, unknown>) {
    const to = typeof m.to === 'string' ? m.to : '';
    if (!a.friends.has(to)) { error(c, 'NOT_FRIENDS', 'you can only invite friends'); return; }
    const st = effectiveStatus(a);
    if (!st?.joinable || !st.roomCode) { error(c, 'NO_ROOM', 'host a co-op room with an open seat first'); return; }
    const target = accounts.get(to);
    if (!target) { error(c, 'OFFLINE', 'that friend is offline'); return; }
    sendAccount(target, { t: 'invite', from: stamp(a), roomCode: st.roomCode });
  }

  function onResolve(c: Conn, a: Account, m: Record<string, unknown>) {
    const raw = typeof m.code === 'string' ? m.code.trim().toUpperCase() : '';
    if (!CODE_RE.test(raw)) { send(c, { t: 'resolved', code: raw, host: null }); return; }
    let host: Account | null = null;
    for (const h of accounts.values()) {
      if (h === a) continue;
      const st = effectiveStatus(h);
      if (st?.joinable && st.roomCode === raw) { host = h; break; }
    }
    if (host) a.resolved.set(host.who.accountId, Date.now() + T.resolveTtlMs);
    send(c, { t: 'resolved', code: raw, host: host ? stamp(host) : null });
  }

  /** friends, or a host the sender resolved recently, or a reply from that host to its resolver */
  function maySignal(from: Account, to: string): boolean {
    if (from.friends.has(to)) { const t = accounts.get(to); return !t || t.friends.has(from.who.accountId); }
    const now = Date.now();
    if ((from.resolved.get(to) ?? 0) > now) return true;
    return (accounts.get(to)?.resolved.get(from.who.accountId) ?? 0) > now;
  }

  function onSignal(c: Conn, a: Account, m: Record<string, unknown>) {
    const to = typeof m.to === 'string' ? m.to : '';
    const session = typeof m.session === 'string' ? m.session : '';
    const d = m.data as Record<string, unknown> | undefined;
    if (!ID_RE.test(to) || !ID_RE.test(session) || !d || typeof d !== 'object' || !KINDS.has(d.kind as SignalKind)) { error(c, 'BAD_MESSAGE', 'invalid signal'); return; }
    if (to === a.who.accountId) { error(c, 'BAD_MESSAGE', 'cannot signal yourself'); return; }
    if (!maySignal(a, to)) { error(c, 'FORBIDDEN', 'you can only connect to friends or a room code you entered'); return; }
    const target = accounts.get(to);
    if (!target) { error(c, 'OFFLINE', 'that player is offline'); return; }
    const data: Record<string, unknown> = { kind: d.kind };
    if (typeof d.sdp === 'string') data.sdp = d.sdp;
    if (d.candidate !== undefined) data.candidate = d.candidate;
    // replies to this sender for this session go back to this window only
    const now = Date.now();
    routes.set(`${a.who.accountId}:${session}`, { conn: c, at: now });
    const bound = routes.get(`${to}:${session}`);
    const msg = { t: 'signal', from: stamp(a), session, data };
    if (bound && conns.has(bound.conn) && target.conns.has(bound.conn)) { bound.at = now; send(bound.conn, msg); } else sendAccount(target, msg);
  }

  function stamp(a: Account) { return { accountId: a.who.accountId, username: a.who.username, displayName: a.who.displayName }; }

  return {
    connections: () => conns.size,
    async close() {
      closed = true;
      clearInterval(sweep);
      server.off('upgrade', onUpgrade);
      for (const c of [...conns]) { c.ws.close(CLOSE.shutdown, 'shutting down'); drop(c); }
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}

function sameStatus(a: PresenceStatus | null, b: PresenceStatus | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
