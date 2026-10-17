import { api, ApiError } from '../api';
import { roomWsUrl } from '../runtime';
import { createStore } from '../store';
import { CHANNEL_LABEL, SNAP_CHANNEL_LABEL, browserPeer, iceServers, type PeerLike } from './peer';
import { presenceSignaling, type PeerId, type Signaling, type SignalIn } from './presence';
import { RPC_PREFIX, isDeltaFrame, isSnapshotFrame, rpcFrame, wsTransport, type ChannelLike, type GameTransport } from './transport';

// Host bridge (docs/contracts/ONLINE_CONTRACT.md step 2 and 3): a module singleton in the host's window that answers
// guests' offers for the co-op room this window hosts. For each guest it links a local profile to the guest's
// cloud-verified accountId (the signal's `from`, stamped by the hub), takes a seat with the ordinary join endpoint,
// and pipes the data channel ⇄ a WebSocket to its own authority verbatim. The authority still checks HELLO, the
// seat token and every intention, exactly as for a local player; the bridge adds no game logic.

export interface HostRoom { roomId: string; code: string; maxSeats: number }
export interface SeatReply { roomId: string; code: string; seatToken: string; slot: number }

export interface HostDeps {
  signaling: Signaling;
  iceServers(): Promise<RTCIceServer[]>;
  createPeer(servers: RTCIceServer[]): PeerLike;
  /** local profile for a cloud account (POST /local/profiles/link) */
  linkProfile(who: PeerId): Promise<{ id: string }>;
  /** POST /rooms/:code/join */
  joinRoom(code: string, profileId: string, classId: string): Promise<SeatReply>;
  /** a fresh socket to this host's own authority (roomWsUrl()) */
  openSocket(): Promise<GameTransport>;
  log?(msg: string, f?: Record<string, unknown>): void;
}

interface GuestPipe {
  key: string;
  from: PeerId;
  session: string;
  pc: PeerLike;
  ch: ChannelLike | null;
  /** the guest's unreliable snapshot channel (peer.ts SNAP_CHANNEL_LABEL), when its build opens one */
  snapCh: ChannelLike | null;
  /** snapshots dropped because the path was backed up (newest-only backpressure) */
  dropped: number;
  sock: GameTransport | null;
  state: 'signal' | 'rpc' | 'pipe' | 'closed';
  /** joined with a seat (counts toward the room's seats) */
  seated: boolean;
  remoteSet: boolean;
  iceQueue: RTCIceCandidateInit[];
  outQueue: string[];
}

/** The authority locks a room's roster when the run starts (rooms.ts addSeat → ROSTER_LOCKED), so a co-op run is
 * advertised as joinable only while gathering. Flip once the authority seats players mid-run. */
export const MID_RUN_JOIN = false;

/** at most this many unanswered/handshaking sessions at once (guards the host against offer floods) */
const MAX_PENDING = 6;

/** Backpressure (toGuest): a snapshot is dropped, never queued, while this much is already waiting on its channel.
 *  The next snapshot (50 ms later) is newer anyway, and a delta stays decodable because it is encoded against the
 *  newest snapshot the guest acknowledged (protocol snapcodec.ts). Without this a reliable ordered channel on a slow
 *  path (a TURN relay, a busy uplink) queued 20 snapshots a second faster than it drained: seconds of lag, then a
 *  channel the browser closes when its send queue fills. */
export const SNAPSHOT_BACKLOG_BYTES = 48 * 1024;
/** larger frames never go on the unreliable channel (one lost fragment loses all of it; full snapshots go reliably) */
const UNRELIABLE_MAX_BYTES = 32 * 1024;
/** a guest this far behind on reliable frames (events, phases) cannot catch up: end the pipe, it rejoins with a resync */
export const CHANNEL_HARD_LIMIT_BYTES = 4 * 1024 * 1024;

export class HostBridge {
  private room: HostRoom | null = null;
  private pipes = new Map<string, GuestPipe>();
  private unsub: (() => void) | null = null;
  onChange: (() => void) | null = null;

  constructor(private deps: HostDeps) {}

  start(room: HostRoom) {
    if (this.room && this.room.roomId !== room.roomId) this.closeAll();
    this.room = room;
    this.unsub ??= this.deps.signaling.onSignal((m) => { void this.onSignal(m); });
    this.onChange?.();
  }

  stop() {
    this.room = null;
    this.unsub?.();
    this.unsub = null;
    this.closeAll();
    this.onChange?.();
  }

  hosting(): HostRoom | null { return this.room; }
  /** guests currently connected through the bridge */
  guests(): PeerId[] { return [...this.pipes.values()].filter((p) => p.state === 'pipe').map((p) => p.from); }

  private closeAll() { for (const p of [...this.pipes.values()]) this.close(p); }

  private async onSignal(m: SignalIn) {
    const key = `${m.from.accountId}:${m.session}`;
    const d = m.data;
    if (d.kind === 'offer') {
      if (!this.room || !d.sdp || this.pipes.has(key)) return;
      // a guest reconnecting replaces its own older sessions
      for (const p of [...this.pipes.values()]) if (p.from.accountId === m.from.accountId) this.close(p);
      const pending = [...this.pipes.values()].filter((p) => p.state === 'signal' || p.state === 'rpc').length;
      if (pending >= MAX_PENDING) { this.deps.signaling.send(m.from.accountId, m.session, { kind: 'bye' }); return; }
      await this.answer(key, m, d.sdp);
      return;
    }
    // everything else must belong to a session this account opened: keys include the cloud-verified sender
    const p = this.pipes.get(key);
    if (!p) return;
    if (d.kind === 'ice' && d.candidate) {
      if (p.remoteSet) void p.pc.addIceCandidate(d.candidate).catch(() => undefined); else p.iceQueue.push(d.candidate);
    } else if (d.kind === 'bye') {
      this.close(p, false);
    }
  }

  private async answer(key: string, m: SignalIn, sdp: string) {
    const pc = this.deps.createPeer(await this.deps.iceServers());
    const p: GuestPipe = { key, from: m.from, session: m.session, pc, ch: null, snapCh: null, dropped: 0, sock: null, state: 'signal', seated: false, remoteSet: false, iceQueue: [], outQueue: [] };
    this.pipes.set(key, p);
    pc.onicecandidate = (e) => { if (e.candidate && p.state !== 'closed') this.deps.signaling.send(p.from.accountId, p.session, { kind: 'ice', candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close(p); };
    pc.ondatachannel = (e) => {
      const c = e.channel;
      if (p.state === 'closed') c.close();
      else if (c.label === CHANNEL_LABEL && !p.ch) this.attach(p, c);
      else if (c.label === SNAP_CHANNEL_LABEL && !p.snapCh) { p.snapCh = c; c.onclose = () => { if (p.snapCh === c) p.snapCh = null; }; }
      else c.close();
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      p.remoteSet = true;
      for (const c of p.iceQueue.splice(0)) void pc.addIceCandidate(c).catch(() => undefined);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      if (p.state === 'closed') return;
      this.deps.signaling.send(p.from.accountId, p.session, { kind: 'answer', sdp: ans.sdp });
    } catch (err) {
      this.deps.log?.('p2p_answer_failed', { err: String(err) });
      this.close(p);
    }
  }

  private attach(p: GuestPipe, ch: ChannelLike) {
    p.ch = ch;
    p.state = 'rpc';
    ch.onclose = () => this.close(p, false);
    ch.onmessage = (e) => {
      const s = String(e.data);
      if (p.state === 'pipe') this.toAuthority(p, s);
      else if (p.state === 'rpc') void this.rpc(p, s);
    };
    this.onChange?.();
  }

  private reply(p: GuestPipe, m: { rpc: string } & Record<string, unknown>) {
    if (p.ch?.readyState === 'open') p.ch.send(rpcFrame(m));
  }

  private refuse(p: GuestPipe, code: string, message: string) {
    this.reply(p, { rpc: 'error', code, message });
    // let the error frame flush before tearing the channel down
    setTimeout(() => this.close(p), 500);
    p.state = 'closed';
  }

  private async rpc(p: GuestPipe, s: string) {
    const room = this.room;
    let m: { rpc?: string; classId?: string; roomId?: string; code?: string };
    try { m = JSON.parse(s); } catch { this.refuse(p, 'BAD_RPC', 'Malformed request.'); return; }
    if (!room) { this.refuse(p, 'NOT_HOSTING', 'That party has closed.'); return; }
    p.state = 'signal';   // one request at a time; further frames before the reply are dropped
    if (m.rpc === 'join') {
      if (m.code && m.code.toUpperCase() !== room.code) { this.refuse(p, 'NOT_FOUND', 'The host is no longer in that room.'); return; }
      const seated = [...this.pipes.values()].filter((x) => x.seated && x.state !== 'closed').length;
      if (seated + 1 >= room.maxSeats) { this.refuse(p, 'ROOM_FULL', 'The party is full.'); return; }
      try {
        const profile = await this.deps.linkProfile(p.from);
        const seat = await this.deps.joinRoom(room.code, profile.id, typeof m.classId === 'string' ? m.classId : 'vanguard');
        if ((p.state as GuestPipe['state']) === 'closed') return;
        p.seated = true;
        p.state = 'pipe';
        this.reply(p, { rpc: 'joined', roomId: seat.roomId, seatToken: seat.seatToken, slot: seat.slot, code: seat.code });
        this.deps.log?.('p2p_guest_joined', { accountId: p.from.accountId, slot: seat.slot });
        this.onChange?.();
      } catch (err) {
        const e = err as { code?: string; message?: string };
        this.refuse(p, e.code ?? 'JOIN_FAILED', e.message ?? 'The host could not seat you.');
      }
    } else if (m.rpc === 'rejoin') {
      // the guest holds its seat token already; the authority verifies it on HELLO
      if (m.roomId !== room.roomId) { this.refuse(p, 'NOT_FOUND', 'The host is no longer in that room.'); return; }
      p.seated = true;
      p.state = 'pipe';
      this.reply(p, { rpc: 'joined', roomId: room.roomId, code: room.code });
      this.onChange?.();
    } else {
      this.refuse(p, 'BAD_RPC', 'Unknown request.');
    }
  }

  /** guest → authority: the socket opens on the guest's first frame (its HELLO), so the authority's HELLO timer
   * starts when the guest is actually ready, not when it joined from the title screen */
  private toAuthority(p: GuestPipe, s: string) {
    if (p.sock?.readyState === 'open') { p.sock.send(s); return; }
    p.outQueue.push(s);
    if (p.outQueue.length > 256) { this.close(p); return; }
    if (p.sock) return;
    void this.deps.openSocket().then((sock) => {
      if (p.state === 'closed') { sock.close(); return; }
      p.sock = sock;
      sock.onopen = () => { for (const q of p.outQueue.splice(0)) sock.send(q); };
      sock.onmessage = (data) => this.toGuest(p, data);
      sock.onclose = (code, reason) => {
        if (p.sock !== sock) return;
        // tell the guest why (4001-4004 refusals are final), then end this pipe; the guest reconnects with rejoin
        this.reply(p, { rpc: 'closed', code, reason });
        p.sock = null;
        setTimeout(() => this.close(p), 200);
      };
      if (sock.readyState === 'open') sock.onopen?.();
    }).catch(() => this.close(p));
  }

  /**
   * authority → guest. Delta snapshots ride the unreliable snapshot channel when the guest opened one; any snapshot is
   * dropped while its channel is backed up (newest only, SNAPSHOT_BACKLOG_BYTES). Everything else (events, phases,
   * acks, full snapshots) goes reliably and in order on `cb`.
   */
  private toGuest(p: GuestPipe, data: string) {
    const ch = p.ch;
    if (ch?.readyState !== 'open') return;
    try {
      if (isSnapshotFrame(data)) {
        const u = p.snapCh;
        if (u?.readyState === 'open' && data.length <= UNRELIABLE_MAX_BYTES && isDeltaFrame(data)) {
          if ((u.bufferedAmount ?? 0) > SNAPSHOT_BACKLOG_BYTES) { p.dropped++; return; }
          try { u.send(data); return; } catch { /* too large for this peer's SCTP limit: reliable below */ }
        }
        if ((ch.bufferedAmount ?? 0) > SNAPSHOT_BACKLOG_BYTES) { p.dropped++; return; }
      } else if ((ch.bufferedAmount ?? 0) > CHANNEL_HARD_LIMIT_BYTES) {
        this.deps.log?.('p2p_guest_backlog', { accountId: p.from.accountId, buffered: ch.bufferedAmount });
        this.close(p);
        return;
      }
      ch.send(data);
    } catch (err) {
      // the browser refuses a send when the channel's queue is full: this pipe is done, the guest rejoins
      this.deps.log?.('p2p_send_failed', { accountId: p.from.accountId, err: String(err) });
      this.close(p);
    }
  }

  /** snapshots dropped for backpressure per connected guest (diagnostics) */
  droppedSnapshots(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.pipes.values()) if (p.state === 'pipe') out[p.from.accountId] = p.dropped;
    return out;
  }

  private close(p: GuestPipe, sayBye = true) {
    if (this.pipes.get(p.key) !== p) return;
    this.pipes.delete(p.key);
    const was = p.state;
    p.state = 'closed';
    const sock = p.sock;
    p.sock = null;
    try { sock?.close(); } catch { /* ignore */ }
    try { p.ch?.close(); } catch { /* ignore */ }
    try { p.snapCh?.close(); } catch { /* ignore */ }
    try { p.pc.close(); } catch { /* ignore */ }
    if (sayBye && was !== 'pipe') this.deps.signaling.send(p.from.accountId, p.session, { kind: 'bye' });
    this.onChange?.();
  }
}

// ---- browser singleton ----

const HOSTING_KEY = 'cursebound.hosting';
export interface HostStore { room: HostRoom | null; guests: PeerId[] }
export const hostStore = createStore<HostStore>({ room: null, guests: [] });

let bridge: HostBridge | null = null;
/** guest profiles created when the authority predates /local/profiles/link (fallback; one per account per window) */
const fallbackProfiles = new Map<string, { id: string }>();

async function linkProfile(who: PeerId): Promise<{ id: string }> {
  try {
    return await api<{ id: string; displayName: string }>('POST', '/local/profiles/link', { accountId: who.accountId, displayName: who.displayName });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404 || !/endpoint/.test(err.message)) throw err;
    const cached = fallbackProfiles.get(who.accountId);
    if (cached) return cached;
    console.warn('[p2p] /local/profiles/link is missing on this authority; seating the guest on a fresh local profile');
    const p = await api<{ id: string }>('POST', '/local/profiles', { displayName: who.displayName });
    fallbackProfiles.set(who.accountId, p);
    return p;
  }
}

function browserBridge(): HostBridge {
  if (bridge) return bridge;
  bridge = new HostBridge({
    signaling: presenceSignaling,
    iceServers,
    createPeer: browserPeer,
    linkProfile,
    joinRoom: (code, profileId, classId) => api<SeatReply>('POST', `/rooms/${encodeURIComponent(code)}/join`, { profileId, classId }),
    openSocket: async () => wsTransport(await roomWsUrl()),
    log: (msg, f) => console.info(`[p2p] ${msg}`, f ?? ''),
  });
  bridge.onChange = () => hostStore.set({ room: bridge!.hosting(), guests: bridge!.guests() });
  return bridge;
}

/** Remember that this tab opened a co-op room (the title screen calls this after POST /rooms). */
export function markHosting(roomId: string, code: string): void {
  try { sessionStorage.setItem(HOSTING_KEY, JSON.stringify({ roomId, code })); } catch { /* ignore */ }
}

export function hostingRecord(): { roomId: string; code: string } | null {
  try { const v = sessionStorage.getItem(HOSTING_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

export function startHostBridge(room: HostRoom): void {
  browserBridge().start(room);
}

export function stopHostBridge(): void {
  bridge?.stop();
  try { sessionStorage.removeItem(HOSTING_KEY); } catch { /* ignore */ }
}

export function hostedRoom(): HostRoom | null {
  return bridge?.hosting() ?? null;
}
