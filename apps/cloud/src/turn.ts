import crypto from 'node:crypto';

// ICE servers for WebRTC (docs/contracts/ONLINE_CONTRACT.md "GET /turn"): Google's public STUN, plus our coturn relay
// with time-limited credentials (coturn `use-auth-secret`): username "<unixExpiry>:<accountId>",
// credential = base64(HMAC-SHA1(TURN_SECRET, username)). coturn recomputes the HMAC, so nothing is stored.

export const TURN_TTL_S = 6 * 3600;

export interface IceServer { urls: string[]; username?: string; credential?: string }

export function turnCredential(secret: string, accountId: string, nowS: number, ttlS = TURN_TTL_S): { username: string; credential: string } {
  const username = `${nowS + ttlS}:${accountId}`;
  return { username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') };
}

export function iceServers(cfg: { turnSecret: string | null; turnHost: string | null }, accountId: string, nowS = Math.floor(Date.now() / 1000)): { iceServers: IceServer[]; ttl: number } {
  const servers: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (cfg.turnSecret && cfg.turnHost) {
    const host = /:\d+$/.test(cfg.turnHost) ? cfg.turnHost : `${cfg.turnHost}:3478`;
    servers.push({ urls: [`turn:${host}?transport=udp`, `turn:${host}?transport=tcp`], ...turnCredential(cfg.turnSecret, accountId, nowS) });
  }
  return { iceServers: servers, ttl: TURN_TTL_S };
}
