import { cloudToken } from '../cloudSession';
import { cloudUrl } from '../runtime';
import type { ChannelLike } from './transport';

// WebRTC plumbing shared by guest and host: ICE servers from the cloud (`GET /turn`: Google STUN + our coturn with
// short-lived credentials), and the RTCPeerConnection subset the bridges use, so tests can supply in-memory fakes.

export interface SessionDesc { type: string; sdp?: string }
export interface PeerLike {
  readonly connectionState: string;
  createDataChannel(label: string, opts?: { ordered?: boolean }): ChannelLike;
  createOffer(): Promise<SessionDesc>;
  createAnswer(): Promise<SessionDesc>;
  setLocalDescription(d: SessionDesc): Promise<void>;
  setRemoteDescription(d: SessionDesc): Promise<void>;
  addIceCandidate(c: RTCIceCandidateInit): Promise<void>;
  onicecandidate: ((ev: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null;
  ondatachannel: ((ev: { channel: ChannelLike }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  close(): void;
}

/** One channel per guest: `label 'cb'`, ordered, reliable (the room protocol assumes TCP-like delivery). */
export const CHANNEL_LABEL = 'cb';

export class P2PError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
let iceCache: { servers: RTCIceServer[]; until: number } | null = null;

/** ICE servers from the cloud; Google STUN alone only if that call fails. Cached for half the credential ttl. */
export async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  try {
    const base = await cloudUrl();
    const token = cloudToken();
    if (!base || !token) throw new Error('not signed in');
    const r = await fetch(`${base}/api/v1/turn`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`turn ${r.status}`);
    const j = (await r.json()) as { iceServers: RTCIceServer[]; ttl?: number };
    if (!Array.isArray(j.iceServers)) throw new Error('bad turn reply');
    iceCache = { servers: j.iceServers, until: Date.now() + Math.max(60, (j.ttl ?? 3600) / 2) * 1000 };
    return j.iceServers;
  } catch {
    return FALLBACK_ICE;
  }
}

export function browserPeer(servers: RTCIceServer[]): PeerLike {
  // RTCPeerConnection matches PeerLike at runtime; its DOM handler signatures are just stricter than the subset's
  return new RTCPeerConnection({ iceServers: servers }) as unknown as PeerLike;
}

export function newSessionId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}
