import { cloudToken, loadCloudToken, onCloudToken } from '../cloudSession';
import { runtimeConfig, runtimeConfigSync } from '../runtime';
import { createStore } from '../store';

// Client side of the cloud presence + signaling socket (docs/contracts/ONLINE_CONTRACT.md "Presence and signaling").
// One socket per window, kept for the window's life (a module singleton, so client-side route changes keep it):
// connects while a cloud token exists, re-sends auth + the last status on every reconnect, pings every 20 s and
// backs off 1→30 s with jitter. The store feeds the friends panel; guest/host use the signal API.

export interface PeerId { accountId: string; username: string; displayName: string }
export type PresenceState = 'menu' | 'lobby' | 'run' | 'away';
export interface FriendStatus {
  state: PresenceState; build: string; joinable: boolean;
  roomCode?: string; mode?: 'solo' | 'coop'; seats?: number; maxSeats?: number; round?: number; theme?: string;
}
export interface Friend extends PeerId { favoriteClass: string | null; online: boolean; status: FriendStatus | null }
export interface Invite { id: string; from: PeerId; roomCode: string; at: number }

export interface SignalData { kind: 'offer' | 'answer' | 'ice' | 'bye'; sdp?: string; candidate?: RTCIceCandidateInit | null }
export interface SignalIn { from: PeerId; session: string; data: SignalData }
/** what guest/host need from presence (tests pass an in-memory bus) */
export interface Signaling {
  send(to: string, session: string, data: SignalData): void;
  onSignal(fn: (m: SignalIn) => void): () => void;
}

export interface PresenceStore {
  /** off = local mode / signed out; online once the hub said `ready` */
  conn: 'off' | 'connecting' | 'online' | 'retrying';
  you: PeerId | null;
  friends: Friend[];
  invites: Invite[];
  error: { code: string; message: string; at: number } | null;
}

export const presenceStore = createStore<PresenceStore>({ conn: 'off', you: null, friends: [], invites: [], error: null });

const PING_MS = 20_000;
const RESOLVE_TIMEOUT_MS = 8_000;

let started = false;
let ws: WebSocket | null = null;
let wsToken: string | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let lastStatus: Omit<FriendStatus, 'build'> | null = null;
const signalSubs = new Set<(m: SignalIn) => void>();
const resolving = new Map<string, ((host: PeerId | null) => void)[]>();

/** Start (once per window) following the cloud token: connect on sign-in, disconnect on sign-out. */
export function startPresence(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  onCloudToken((t) => { if (t !== wsToken) restart(); });
  void loadCloudToken().then(() => restart());
}

function restart() {
  teardown();
  attempt = 0;
  void connect();
}

function teardown() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (ws) { const old = ws; ws = null; old.onclose = null; old.onmessage = null; old.close(); }
  presenceStore.set({ conn: 'off', you: null, friends: [], invites: [] });
}

async function connect() {
  const token = cloudToken();
  const cfg = await runtimeConfig();
  if (!token || !cfg.cloudUrl || token !== cloudToken()) { presenceStore.set({ conn: 'off' }); return; }
  wsToken = token;
  presenceStore.set({ conn: attempt ? 'retrying' : 'connecting' });
  const sock = new WebSocket(`${cfg.cloudUrl.replace(/^http/, 'ws')}/api/v1/presence`);
  ws = sock;
  // the token travels in the first message, never in the URL
  sock.onopen = () => sock.send(JSON.stringify({ t: 'auth', token }));
  sock.onmessage = (e) => { try { onMessage(JSON.parse(String(e.data))); } catch { /* ignore malformed */ } };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = null;
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    for (const [code, fns] of resolving) { resolving.delete(code); fns.forEach((f) => f(null)); }
    // a rejected token waits for the next sign-in instead of hammering the hub
    if (e.code === 4001) { presenceStore.set({ conn: 'off', you: null, friends: [] }); return; }
    presenceStore.set({ conn: 'retrying' });
    const base = Math.min(30_000, 1000 * 2 ** attempt++);
    retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, base / 2 + Math.random() * base / 2);
  };
  sock.onerror = () => undefined;
}

function raw(m: unknown): boolean {
  if (ws?.readyState !== WebSocket.OPEN || presenceStore.get().conn !== 'online') return false;
  ws.send(JSON.stringify(m));
  return true;
}

function onMessage(m: any) {
  switch (m?.t) {
    case 'ready':
      attempt = 0;
      presenceStore.set({ conn: 'online', you: m.you });
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => raw({ t: 'ping' }), PING_MS);
      if (lastStatus) sendStatus();
      break;
    case 'friends': presenceStore.set({ friends: sortFriends(m.list as Friend[]) }); break;
    case 'presence':
      presenceStore.set((s) => ({ friends: sortFriends(s.friends.map((f) => (f.accountId === m.accountId ? { ...f, online: m.online, status: m.status } : f))) }));
      break;
    case 'invite': {
      const inv: Invite = { id: `${m.from.accountId}:${m.roomCode}`, from: m.from, roomCode: m.roomCode, at: Date.now() };
      presenceStore.set((s) => ({ invites: [...s.invites.filter((i) => i.id !== inv.id), inv].slice(-3) }));
      break;
    }
    case 'signal': signalSubs.forEach((f) => f({ from: m.from, session: m.session, data: m.data })); break;
    case 'resolved': {
      const fns = resolving.get(m.code);
      resolving.delete(m.code);
      fns?.forEach((f) => f(m.host ?? null));
      break;
    }
    case 'error': presenceStore.set({ error: { code: m.code, message: m.message, at: Date.now() } }); break;
  }
}

/** online first, joinable first, then by name */
function sortFriends(list: Friend[]): Friend[] {
  const rank = (f: Friend) => (f.online ? (f.status?.joinable ? 0 : 1) : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
}

function sendStatus() {
  if (!lastStatus) return;
  raw({ t: 'status', ...lastStatus, build: runtimeConfigSync()?.build ?? 'unknown' });
}

/** Report what this window is doing; remembered and re-sent after reconnects. Unchanged statuses are not re-sent. */
export function setStatus(s: Omit<FriendStatus, 'build'>): void {
  if (lastStatus && JSON.stringify(lastStatus) === JSON.stringify(s)) return;
  lastStatus = s;
  void runtimeConfig().then(() => sendStatus());
}

export function presenceOnline(): boolean {
  return presenceStore.get().conn === 'online';
}

/** Resolves true once the hub is ready (or already was), false after `ms`. */
export function whenPresenceOnline(ms: number): Promise<boolean> {
  if (presenceOnline()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => { un(); resolve(false); }, ms);
    const un = presenceStore.subscribe(() => { if (presenceOnline()) { clearTimeout(t); un(); resolve(true); } });
  });
}

export function invite(accountId: string): boolean {
  return raw({ t: 'invite', to: accountId });
}

export function dismissInvite(id: string): void {
  presenceStore.set((s) => ({ invites: s.invites.filter((i) => i.id !== id) }));
}

/** The friend or stranger currently hosting a joinable room with this code, or null (also when offline). */
export function resolveCode(code: string): Promise<PeerId | null> {
  const c = code.trim().toUpperCase();
  return new Promise((resolve) => {
    if (!raw({ t: 'resolve', code: c })) { resolve(null); return; }
    const t = setTimeout(() => done(null), RESOLVE_TIMEOUT_MS);
    const done = (h: PeerId | null) => { clearTimeout(t); const list = resolving.get(c); if (list) { const i = list.indexOf(done); if (i >= 0) list.splice(i, 1); } resolve(h); };
    resolving.set(c, [...(resolving.get(c) ?? []), done]);
  });
}

export function sendSignal(to: string, session: string, data: SignalData): boolean {
  return raw({ t: 'signal', to, session, data });
}

export function onSignal(fn: (m: SignalIn) => void): () => void {
  signalSubs.add(fn);
  return () => { signalSubs.delete(fn); };
}

/** The presence socket as the guest/host signaling channel. */
export const presenceSignaling: Signaling = { send: (to, session, data) => { sendSignal(to, session, data); }, onSignal };
