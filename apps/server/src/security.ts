import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ServerConfig } from './config';

// Trust boundaries (REQ SEC01, PRD §22): Host/Origin validation against DNS rebinding and cross-site access,
// unguessable seat tokens kept out of URLs, constant-time token comparison.

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`;
}

export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}

export function hashToken(t: string): string {
  return crypto.createHash('sha256').update(t).digest('hex');
}

export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hostAllowed(cfg: ServerConfig, req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return cfg.allowedHosts.includes(host);
}

/** Origin must be in the allowlist when present. Browser WebSockets always send Origin; require it there. */
export function originAllowed(cfg: ServerConfig, req: IncomingMessage, required: boolean): boolean {
  const origin = req.headers.origin;
  if (!origin) return !required;
  return cfg.allowedOrigins.includes(origin.toLowerCase());
}
