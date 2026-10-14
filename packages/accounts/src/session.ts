import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthState, RouteCtx } from './http';
import type { AccountStore } from './types';

// Sessions are random 256-bit tokens, stored server-side only as SHA-256, with a 30-day sliding expiry. How the token
// travels is pluggable: an HttpOnly SameSite=Lax cookie for the local authority (same-origin through the Next.js
// proxy), or `Authorization: Bearer` for the cloud service, where register/login hand the token back in the body.

export const SESSION_COOKIE = 'cb_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`;
}

export function hashToken(t: string): string {
  return crypto.createHash('sha256').update(t).digest('hex');
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = newToken(32);
  return { token, tokenHash: hashToken(token) };
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return TOKEN_RE.test(v) ? v : null;
    }
  }
  return null;
}

export function readBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(h.trim());
  return m ? m[1]! : null;
}

export function sessionCookie(token: string, maxAgeMs = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** How a session token reaches the server and how a new one is handed to the client. */
export interface SessionTransport {
  /** true: register/login return `{ account, token }` and the client sends `Authorization: Bearer` */
  readonly bearer: boolean;
  read(req: IncomingMessage): string | null;
  issue(ctx: RouteCtx, token: string): void;
  clear(ctx: RouteCtx): void;
}

export const cookieTransport: SessionTransport = {
  bearer: false,
  read: (req) => readCookie(req, SESSION_COOKIE),
  issue: (ctx, token) => { ctx.headers['set-cookie'] = sessionCookie(token); },
  clear: (ctx) => { ctx.headers['set-cookie'] = clearSessionCookie(); },
};

export const bearerTransport: SessionTransport = {
  bearer: true,
  read: readBearer,
  issue: () => undefined,
  clear: () => undefined,
};

/** Resolve a presented token to its account, sliding the session expiry forward. */
export async function authenticateToken(store: Pick<AccountStore, 'getSession' | 'getAccount'>, token: string | null): Promise<AuthState | null> {
  if (!token) return null;
  const sessionHash = hashToken(token);
  const now = Date.now();
  const session = await store.getSession(sessionHash, now, now + SESSION_TTL_MS);
  if (!session) return null;
  const account = await store.getAccount(session.accountId);
  return account ? { account, sessionHash } : null;
}

/** Short human label for the sessions list ("Chrome on Windows"); never stores the raw user agent. */
export function deviceLabel(req: IncomingMessage): string {
  const ua = String(req.headers['user-agent'] ?? '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

/** Fixed-window attempt counter keyed by address (and optionally username). */
export class Throttle {
  private hits = new Map<string, { n: number; at: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {
    setInterval(() => { const now = Date.now(); for (const [k, v] of this.hits) if (now - v.at > this.windowMs) this.hits.delete(k); }, 60_000).unref();
  }
  blocked(key: string): boolean {
    const h = this.hits.get(key);
    return !!h && Date.now() - h.at <= this.windowMs && h.n >= this.max;
  }
  hit(key: string): void {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || now - h.at > this.windowMs) this.hits.set(key, { n: 1, at: now });
    else h.n++;
  }
  reset(key: string): void { this.hits.delete(key); }
}
