import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import { hashToken, newToken } from './security';

// Accounts (username + password). Passwords are hashed with salted scrypt off the main event loop (libuv pool);
// sessions are random 256-bit tokens held in an HttpOnly SameSite=Lax cookie, stored server-side only as SHA-256.
// Login failures are throttled per client address in memory and lock the account briefly in the database.

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = 'cb_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const LOCK_AFTER_FAILURES = 8;
export const LOCK_MS = 5 * 60 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((x) => Number.isSafeInteger(x) && x > 0) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: SCRYPT.maxmem });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Equalises timing for unknown usernames so login responses do not reveal which usernames exist. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('cursebound-timing-equaliser');
  await verifyPassword(password, await dummyHash);
}

/** Problem with a proposed password, or null when acceptable. */
export function passwordProblem(password: unknown, username: string): string | null {
  if (typeof password !== 'string') return 'password required';
  if (password.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `password must be at most ${PASSWORD_MAX} characters`;
  if (password.toLowerCase() === username.toLowerCase()) return 'password must differ from your username';
  if (/^(.)\1+$/.test(password)) return 'password cannot be one repeated character';
  if (COMMON.has(password.toLowerCase())) return 'that password is too common';
  return null;
}

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'qwerty123', 'iloveyou', 'letmein1', 'abc12345', 'baseball', 'football', 'sunshine', 'princess', 'dragon12', 'cursebound']);

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
      return /^[A-Za-z0-9_-]{20,128}$/.test(v) ? v : null;
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAgeMs = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Short human label for the sessions list ("Chrome on Windows"); never stores the raw user agent. */
export function deviceLabel(req: IncomingMessage): string {
  const ua = String(req.headers['user-agent'] ?? '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

/**
 * Client address for throttling. The Next.js dev proxy forwards from loopback, so X-Forwarded-For is honoured
 * only when the TCP peer itself is loopback.
 */
export function clientAddress(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  const loop = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const fwd = req.headers['x-forwarded-for'];
  if (loop && typeof fwd === 'string' && fwd.length < 256) return fwd.split(',')[0]!.trim() || peer;
  return peer;
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
