import type { IncomingMessage } from 'node:http';

// Accounts (username + password). The hashing, policy, throttle and session helpers live in @cursebound/accounts so
// the cloud service runs the same code; locally, sessions ride in an HttpOnly SameSite=Lax cookie. Login failures
// are throttled per client address in memory and lock the account briefly in the database.

export {
  LOCK_AFTER_FAILURES, LOCK_MS, PASSWORD_MAX, PASSWORD_MIN, SESSION_COOKIE, SESSION_TTL_MS, Throttle, USERNAME_RE,
  burnPasswordCheck, clearSessionCookie, deviceLabel, hashPassword, newSessionToken, passwordProblem, readCookie, sessionCookie, verifyPassword,
} from '@cursebound/accounts';

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
