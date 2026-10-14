// Game transports (docs/contracts/ONLINE_CONTRACT.md "Peer-to-peer co-op"): the room protocol is unchanged; it rides
// either a WebSocket to an authority (local / LAN, and the host bridge's own leg) or a guest's RTCDataChannel to the
// host bridge, which pipes it verbatim to the host's authority.

export type TransportState = 'connecting' | 'open' | 'closed';

export interface GameTransport {
  readonly readyState: TransportState;
  send(data: string): void;
  /** fires on the transition to open only: a transport handed over already open (a guest's channel after the join
   * handshake) does not fire it, so attach handlers, then check readyState */
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  /** code/reason follow WebSocket close semantics (4001-4004 = refused by the authority) */
  onclose: ((code: number, reason: string) => void) | null;
  close(): void;
}

/** The subset of RTCDataChannel the transports and bridges use (tests supply fakes). */
export interface ChannelLike {
  readonly label: string;
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}

/** Control frames share the channel with the verbatim game stream; the bridge writes `rpc` first so a prefix test
 * tells them apart without parsing every game message. */
export const RPC_PREFIX = '{"rpc":';
export const rpcFrame = (m: { rpc: string } & Record<string, unknown>) => JSON.stringify(m);

const WS_STATE: TransportState[] = ['connecting', 'open', 'closed', 'closed'];

export function wsTransport(url: string, Impl: typeof WebSocket = WebSocket): GameTransport {
  const ws = new Impl(url);
  const t: GameTransport = {
    get readyState() { return WS_STATE[ws.readyState] ?? 'closed'; },
    send(data) { if (ws.readyState === 1) ws.send(data); },
    onopen: null, onmessage: null, onclose: null,
    close() { ws.close(); },
  };
  ws.onopen = () => t.onopen?.();
  ws.onmessage = (e) => t.onmessage?.(String(e.data));
  ws.onclose = (e) => t.onclose?.(e.code, e.reason);
  ws.onerror = () => undefined;
  return t;
}

/**
 * A guest's game stream over an open data channel. `{"rpc":"closed",code,reason}` from the bridge reports the host's
 * authority closing this seat's socket (so refusals keep their WebSocket close code); `onDispose` tears the peer down.
 */
export function channelTransport(ch: ChannelLike, onDispose?: () => void): GameTransport {
  let state: TransportState = ch.readyState === 'open' ? 'open' : ch.readyState === 'connecting' ? 'connecting' : 'closed';
  let done = false;
  const finish = (code: number, reason: string) => {
    if (done) return;
    done = true;
    state = 'closed';
    try { ch.close(); } catch { /* already closed */ }
    onDispose?.();
    t.onclose?.(code, reason);
  };
  const t: GameTransport = {
    get readyState() { return state; },
    send(data) { if (state === 'open' && ch.readyState === 'open') ch.send(data); },
    onopen: null, onmessage: null, onclose: null,
    close() { finish(1000, 'closed'); },
  };
  ch.onopen = () => { state = 'open'; t.onopen?.(); };
  ch.onmessage = (e) => {
    const s = String(e.data);
    if (s.startsWith(RPC_PREFIX)) {
      try {
        const m = JSON.parse(s) as { rpc: string; code?: number; reason?: string };
        if (m.rpc === 'closed') finish(m.code ?? 1006, m.reason ?? '');
      } catch { /* malformed control frame: ignore */ }
      return;
    }
    t.onmessage?.(s);
  };
  ch.onclose = () => finish(1006, 'peer connection lost');
  // usually already open (the join handshake ran on it): no onopen event follows, see GameTransport.onopen
  return t;
}
