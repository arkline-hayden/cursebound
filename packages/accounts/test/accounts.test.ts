import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
  HttpError, SESSION_COOKIE, Throttle, authenticateToken, bearerTransport, cookieTransport, hashToken, hashPassword, maxScore, newSessionToken,
  parseBuild, passwordProblem, routePattern, sanitizeDisplayName, sanitizeFreeText, verifyPassword, type RouteCtx,
} from '../src/index';

// Unit coverage of the shared account logic; the routes run end to end in apps/server/test/auth.test.ts (cookie,
// SQLite) and apps/cloud/test/cloud.test.ts (bearer, Postgres).

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
const ctx = (): RouteCtx => ({ headers: {}, auth: async () => null, requireAuth: async () => { throw new Error('no'); } });

describe('passwords', () => {
  it('hashes with salted scrypt and applies the policy', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).not.toBe(await hashPassword('correct horse battery'));
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batteries', h)).toBe(false);
    expect(await verifyPassword('x', 'scrypt$99999999$8$1$a$b')).toBe(false);
    expect(passwordProblem(undefined, 'ivy')).toMatch(/required/);
    expect(passwordProblem('x'.repeat(129), 'ivy')).toMatch(/at most/);
    expect(passwordProblem('cursebound', 'ivy')).toMatch(/common/);
    expect(passwordProblem('a lantern in the deep', 'ivy')).toBeNull();
  });
});

describe('session transports', () => {
  const { token, tokenHash } = newSessionToken();
  it('reads and issues cookie sessions', () => {
    expect(hashToken(token)).toBe(tokenHash);
    expect(cookieTransport.bearer).toBe(false);
    expect(cookieTransport.read(req({ cookie: `a=b; ${SESSION_COOKIE}=${token}` }))).toBe(token);
    expect(cookieTransport.read(req({ cookie: `${SESSION_COOKIE}=bad token` }))).toBeNull();
    const c = ctx();
    cookieTransport.issue(c, token);
    expect(c.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    cookieTransport.clear(c);
    expect(c.headers['set-cookie']).toMatch(/Max-Age=0$/);
  });
  it('reads bearer tokens and never sets cookies', () => {
    expect(bearerTransport.bearer).toBe(true);
    expect(bearerTransport.read(req({ authorization: `Bearer ${token}` }))).toBe(token);
    expect(bearerTransport.read(req({ authorization: `Basic ${token}` }))).toBeNull();
    expect(bearerTransport.read(req({ authorization: 'Bearer short' }))).toBeNull();
    expect(bearerTransport.read(req({ cookie: `${SESSION_COOKIE}=${token}` }))).toBeNull();
    const c = ctx();
    bearerTransport.issue(c, token);
    bearerTransport.clear(c);
    expect(c.headers).toEqual({});
  });
  it('authenticates a token through the store, sliding its expiry', async () => {
    const calls: unknown[][] = [];
    const account = { id: 'acc_1', username: 'Ivy', profileId: 'acc_1', displayName: 'Ivy', favoriteClass: null, motto: '', createdAt: 0, lastLoginAt: null };
    const store = {
      getSession: async (...a: unknown[]) => { calls.push(a); return a[0] === tokenHash ? { tokenHash, accountId: 'acc_1', createdAt: 0, lastSeenAt: 0, expiresAt: Infinity, label: '' } : null; },
      getAccount: async () => account,
    };
    expect(await authenticateToken(store, token)).toEqual({ account, sessionHash: tokenHash });
    expect(calls[0]![2]).toBeGreaterThan(calls[0]![1] as number);
    expect(await authenticateToken(store, 'x'.repeat(43))).toBeNull();
    expect(await authenticateToken(store, null)).toBeNull();
  });
});

describe('helpers', () => {
  it('throttles per key within a window', () => {
    const t = new Throttle(2, 60_000);
    t.hit('a'); expect(t.blocked('a')).toBe(false);
    t.hit('a'); expect(t.blocked('a')).toBe(true);
    expect(t.blocked('b')).toBe(false);
    t.reset('a'); expect(t.blocked('a')).toBe(false);
  });
  it('compiles route patterns with captures', () => {
    expect('/api/v1/friends/acc_9/accept'.match(routePattern('/friends/:id/accept'))?.[1]).toBe('acc_9');
    expect(routePattern('/friends/:id/accept').test('/api/v1/friends/a/b/accept')).toBe(false);
  });
  it('sanitises player text like the local store', () => {
    expect(sanitizeDisplayName('  Hel\u0000lo \t\n  World‮  ')).toBe('Hel lo World');
    expect(() => sanitizeDisplayName('  \u0001 ')).toThrow();
    expect(sanitizeFreeText('a\n\n\n\nb', 10, true)).toBe('a\n\nb');
    expect(maxScore('99', '100')).toBe('100');
  });
  it('validates builds against the content', async () => {
    const { NODES } = await import('@cursebound/content');
    const node = NODES.find((x) => x.classId === 'vanguard' && !x.starting)!;
    expect(parseBuild({ name: 'x', classId: 'vanguard', ranks: { [node.id]: 1 }, mastery: { damage: 2 } })).toMatchObject({ ranks: { [node.id]: 1 }, mastery: '{"damage":2,"health":0,"recovery":0}' });
    expect(() => parseBuild({ classId: 'nope', ranks: {} })).toThrow(HttpError);
    expect(() => parseBuild({ classId: 'vanguard', ranks: { [node.id]: 999 } })).toThrow(/rank of/);
  });
});
