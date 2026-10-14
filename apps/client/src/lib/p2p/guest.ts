import { CHANNEL_LABEL, P2PError, browserPeer, iceServers, newSessionId, type PeerLike } from './peer';
import { presenceSignaling, whenPresenceOnline, type PeerId, type Signaling, type SignalIn } from './presence';
import { RPC_PREFIX, channelTransport, type ChannelLike, type GameTransport } from './transport';

// Guest side of peer-to-peer co-op (docs/contracts/ONLINE_CONTRACT.md step 1 and 3): offer a data channel to the
// host over the presence signal relay (trickle ICE), then ask the host bridge for a seat with `{rpc:'join'}`.
// After `joined` the channel carries the unchanged room protocol; the guest sends HELLO with its seat token itself.
// Reconnecting re-signals a fresh peer connection and asks for `{rpc:'rejoin'}`, reusing the stored seat token.

export type GuestRpc = { rpc: 'join'; classId: string; code: string } | { rpc: 'rejoin'; roomId: string; code: string };
export interface JoinedReply { rpc: 'joined'; roomId: string; code: string; seatToken?: string; slot?: number }

export interface GuestDeps {
  signaling: Signaling;
  iceServers(): Promise<RTCIceServer[]>;
  createPeer(servers: RTCIceServer[]): PeerLike;
  /** give up on a host that does not answer (offline, other build, unreachable network) */
  timeoutMs?: number;
}

export interface GuestLinkOpen { reply: JoinedReply; channel: ChannelLike; dispose(): void }

/** One connection attempt to a host; the returned channel is open and past the RPC handshake. */
export async function openGuestLink(deps: GuestDeps, host: PeerId, rpc: GuestRpc): Promise<GuestLinkOpen> {
  const session = newSessionId();
  const pc = deps.createPeer(await deps.iceServers());
  const ch = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
  const iceQueue: RTCIceCandidateInit[] = [];
  let remoteSet = false;
  let settled = false;
  let disposed = false;
  const signal = deps.signaling;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsub();
    signal.send(host.accountId, session, { kind: 'bye' });
    try { ch.close(); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
  };

  let fail: (e: P2PError) => void = () => undefined;
  const unsub = signal.onSignal((m: SignalIn) => {
    // only the host we called, on this session: `from` is stamped by the cloud
    if (m.session !== session || m.from.accountId !== host.accountId) return;
    const d = m.data;
    if (d.kind === 'answer' && d.sdp && !remoteSet) {
      pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).then(() => {
        remoteSet = true;
        for (const c of iceQueue.splice(0)) void pc.addIceCandidate(c).catch(() => undefined);
      }).catch(() => fail(new P2PError('SIGNAL_FAILED', 'The host sent an answer this client could not use.')));
    } else if (d.kind === 'ice' && d.candidate) {
      if (remoteSet) void pc.addIceCandidate(d.candidate).catch(() => undefined); else iceQueue.push(d.candidate);
    } else if (d.kind === 'bye') {
      fail(new P2PError('HOST_LEFT', 'The host closed the connection.'));
      dispose();
    }
  });

  pc.onicecandidate = (e) => { if (e.candidate) signal.send(host.accountId, session, { kind: 'ice', candidate: e.candidate.toJSON() }); };

  const result = new Promise<GuestLinkOpen>((resolve, reject) => {
    const timer = setTimeout(() => fail(new P2PError('TIMEOUT', 'The host did not answer. They may have left, or be on another build.')), deps.timeoutMs ?? 20_000);
    fail = (e) => { if (settled) return; settled = true; clearTimeout(timer); dispose(); reject(e); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') fail(new P2PError('UNREACHABLE', 'Could not reach the host’s computer.')); };
    ch.onopen = () => ch.send(JSON.stringify(rpc));
    ch.onclose = () => fail(new P2PError('HOST_LEFT', 'The host closed the connection.'));
    ch.onmessage = (e) => {
      const s = String(e.data);
      if (settled || !s.startsWith(RPC_PREFIX)) return;
      let m: { rpc: string; code?: string; message?: string };
      try { m = JSON.parse(s); } catch { return; }
      if (m.rpc === 'joined') {
        settled = true;
        clearTimeout(timer);
        ch.onopen = null; ch.onmessage = null; ch.onclose = null;
        resolve({ reply: m as JoinedReply, channel: ch, dispose });
      } else if (m.rpc === 'error') {
        fail(new P2PError(m.code ?? 'JOIN_FAILED', m.message ?? 'The host refused the join.'));
      }
    };
  });

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal.send(host.accountId, session, { kind: 'offer', sdp: offer.sdp });
  } catch {
    fail(new P2PError('SIGNAL_FAILED', 'Could not start a connection.'));
  }
  return result;
}

// ---- browser singleton: the live link survives the route change from the title screen to /play ----

const SESSION_KEY = 'cursebound.p2p';
export interface GuestSession { host: PeerId; code: string; roomId: string }
export interface GuestSeat { roomId: string; seatToken: string; slot: number; code: string }

let live: { roomId: string; open: GuestLinkOpen; claimed: boolean } | null = null;

const browserDeps = (): GuestDeps => ({ signaling: presenceSignaling, iceServers, createPeer: browserPeer });

/** This tab's peer-to-peer seat (set by joinViaHost), or null for local / LAN play. */
export function guestSession(): GuestSession | null {
  try { const v = sessionStorage.getItem(SESSION_KEY); return v ? (JSON.parse(v) as GuestSession) : null; } catch { return null; }
}

export function clearGuestSession(): void {
  live?.open.dispose();
  live = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** Join a host's room over WebRTC. Returns the seat to store with setSeat(); the open channel waits for /play. */
export async function joinViaHost(host: PeerId, code: string, classId: string): Promise<GuestSeat> {
  clearGuestSession();
  if (!(await whenPresenceOnline(8000))) throw new P2PError('OFFLINE', 'Not connected to the online service.');
  const open = await openGuestLink(browserDeps(), host, { rpc: 'join', classId, code: code.toUpperCase() });
  const r = open.reply;
  if (!r.seatToken || r.slot === undefined) { open.dispose(); throw new P2PError('JOIN_FAILED', 'The host sent an incomplete seat.'); }
  live = { roomId: r.roomId, open, claimed: false };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ host, code: r.code, roomId: r.roomId } satisfies GuestSession)); } catch { /* ignore */ }
  return { roomId: r.roomId, seatToken: r.seatToken, slot: r.slot, code: r.code };
}

/** Transport for GameConnection: the channel from the join on first use, else a fresh re-signalled `rejoin`. */
export async function guestTransport(roomId: string): Promise<GameTransport> {
  const release = () => { if (live?.open === cur) live = null; };
  let cur: GuestLinkOpen;
  if (live && live.roomId === roomId && !live.claimed && live.open.channel.readyState === 'open') {
    live.claimed = true;
    cur = live.open;
  } else {
    const s = guestSession();
    if (!s || s.roomId !== roomId) throw new P2PError('NO_SESSION', 'This tab has no peer-to-peer seat.');
    live?.open.dispose();
    live = null;
    if (!(await whenPresenceOnline(15_000))) throw new P2PError('OFFLINE', 'Not connected to the online service.');
    cur = await openGuestLink(browserDeps(), s.host, { rpc: 'rejoin', roomId, code: s.code });
    live = { roomId, open: cur, claimed: true };
  }
  return channelTransport(cur.channel, () => { cur.dispose(); release(); });
}
