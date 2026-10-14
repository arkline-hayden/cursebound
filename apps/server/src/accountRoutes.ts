import type { IncomingMessage } from 'node:http';
import { CLASS_BY_ID, NODE_BY_ID } from '@cursebound/content';
import {
  LOCK_AFTER_FAILURES, LOCK_MS, SESSION_TTL_MS, Throttle, USERNAME_RE,
  burnPasswordCheck, clearSessionCookie, clientAddress, deviceLabel, hashPassword, newSessionToken, passwordProblem, sessionCookie, verifyPassword,
} from './auth';
import { HttpError, readBody, type RouteCtx, type RouteFn } from './http';
import type { Logger } from './persistence/logger';
import type { Account, SavedBuildInput, Store } from './persistence/types';
import { newId } from './security';

// Account API (/api/v1/auth, /account, /players, /builds, /friends). Every account-scoped route resolves the
// caller from the session cookie; ids in paths are only ever matched within the caller's own rows.

const MAX_BUILDS = 60;

interface Deps {
  route: (method: string, path: string, fn: RouteFn) => void;
  store: Store;
  log: Logger;
  assertId: (v: string, what: string) => string;
  registerPerHour: number;
}

const publicAccount = (a: Account) => ({
  id: a.id, username: a.username, displayName: a.displayName, profileId: a.profileId, favoriteClass: a.favoriteClass, motto: a.motto, createdAt: a.createdAt,
});

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'INVALID_INPUT', `${what} must be text of at most ${max} characters`);
  return v;
}

/** Validates a build against the content: class exists, every node belongs to it, ranks within limits. */
function parseBuild(b: Record<string, unknown>): SavedBuildInput {
  const classId = str(b.classId, 'classId', 64);
  const cls = CLASS_BY_ID[classId];
  if (!cls) throw new HttpError(400, 'INVALID_INPUT', 'unknown class');
  const raw = b.ranks;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'INVALID_INPUT', 'ranks must be an object');
  const ranks: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const node = NODE_BY_ID[id];
    if (!node || node.classId !== classId) throw new HttpError(400, 'INVALID_INPUT', `node ${id.slice(0, 64)} is not part of the ${cls.name} tree`);
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > node.rankLimit) throw new HttpError(400, 'INVALID_INPUT', `rank of ${node.name} must be 0..${node.rankLimit}`);
    if (v > 0 && !node.starting) ranks[id] = v;
  }
  let mastery: string | null = null;
  if (b.mastery !== undefined && b.mastery !== null) {
    const m = b.mastery as Record<string, unknown>;
    const ok = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 999;
    if (typeof m !== 'object' || !ok(m.damage ?? 0) || !ok(m.health ?? 0) || !ok(m.regen ?? 0)) throw new HttpError(400, 'INVALID_INPUT', 'invalid mastery');
    mastery = JSON.stringify({ damage: m.damage ?? 0, health: m.health ?? 0, regen: m.regen ?? 0 });
  }
  return {
    name: str(b.name ?? '', 'name', 80),
    classId,
    ranks,
    mastery,
    notes: str(b.notes ?? '', 'notes', 1000),
    sourceRunId: typeof b.sourceRunId === 'string' ? b.sourceRunId : null,
  };
}

export function registerAccountRoutes({ route, store, log, assertId, registerPerHour }: Deps) {
  const loginThrottle = new Throttle(12, 10 * 60_000);
  const registerThrottle = new Throttle(registerPerHour, 60 * 60_000);

  const startSession = async (req: IncomingMessage, ctx: RouteCtx, account: Account) => {
    const { token, tokenHash } = newSessionToken();
    const now = Date.now();
    await store.createSession({ tokenHash, accountId: account.id, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS, label: deviceLabel(req) });
    ctx.headers['set-cookie'] = sessionCookie(token);
  };

  // ---------------------------------------------------------------- auth
  route('POST', '/auth/register', async (_m, req, _url, ctx) => {
    const ip = clientAddress(req);
    if (registerThrottle.blocked(ip)) throw new HttpError(429, 'RATE_LIMITED', 'too many new accounts from here — try again later');
    const b = (await readBody(req)) as { username?: unknown; password?: unknown; displayName?: unknown; claimProfileId?: unknown };
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'INVALID_INPUT', 'username must be 3–20 letters, digits or underscores');
    const problem = passwordProblem(b.password, username);
    if (problem) throw new HttpError(400, 'WEAK_PASSWORD', problem);
    let claim: string | null = null;
    if (typeof b.claimProfileId === 'string' && b.claimProfileId) {
      claim = assertId(b.claimProfileId, 'profile');
      // a profile already owned by an account is silently not claimed; the new account starts fresh instead
      if (await store.getAccountByProfile(claim)) claim = null;
    }
    const displayName = typeof b.displayName === 'string' && b.displayName.trim() ? b.displayName : username;
    registerThrottle.hit(ip);
    const passwordHash = await hashPassword(b.password as string);
    let account: Account;
    try {
      account = await store.createAccount({ id: newId('acc'), username, passwordHash, displayName, claimProfileId: claim });
    } catch (err) {
      if ((err as { code?: string }).code === 'CONFLICT') throw new HttpError(409, 'USERNAME_TAKEN', (err as Error).message);
      throw err;
    }
    await startSession(req, ctx, account);
    log.info('account_created', { accountId: account.id, claimed: !!claim });
    return { account: publicAccount(account) };
  });

  route('POST', '/auth/login', async (_m, req, _url, ctx) => {
    const ip = clientAddress(req);
    const b = (await readBody(req)) as { username?: unknown; password?: unknown };
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' && b.password.length <= 1024 ? b.password : '';
    const key = `${ip}|${username.toLowerCase()}`;
    if (loginThrottle.blocked(ip) || loginThrottle.blocked(key)) throw new HttpError(429, 'RATE_LIMITED', 'too many sign-in attempts — wait a few minutes');
    const bad = () => new HttpError(401, 'BAD_CREDENTIALS', 'that username and password do not match');
    const cred = USERNAME_RE.test(username) ? await store.getAccountCredentials(username) : null;
    if (!cred) {
      loginThrottle.hit(ip);
      await burnPasswordCheck(password);
      throw bad();
    }
    if (cred.lockedUntil > Date.now()) {
      throw new HttpError(423, 'ACCOUNT_LOCKED', `too many failed attempts — try again in ${Math.ceil((cred.lockedUntil - Date.now()) / 60000)} min`);
    }
    if (!password || !(await verifyPassword(password, cred.passwordHash))) {
      loginThrottle.hit(ip);
      loginThrottle.hit(key);
      await store.recordLogin(cred.id, false, LOCK_AFTER_FAILURES, LOCK_MS);
      log.warn('login_failed', { accountId: cred.id });
      throw bad();
    }
    loginThrottle.reset(key);
    await store.recordLogin(cred.id, true, LOCK_AFTER_FAILURES, LOCK_MS);
    const { passwordHash: _p, failedLogins: _f, lockedUntil: _l, ...account } = cred;
    await startSession(req, ctx, account);
    return { account: publicAccount(account) };
  });

  route('POST', '/auth/logout', async (_m, _req, _url, ctx) => {
    const a = await ctx.auth();
    if (a) await store.deleteSession(a.sessionHash);
    ctx.headers['set-cookie'] = clearSessionCookie();
    return { ok: true };
  });

  route('GET', '/auth/me', async (_m, _req, _url, ctx) => {
    const a = await ctx.auth();
    if (!a) {
      // drop a stale cookie so the browser stops presenting it
      ctx.headers['set-cookie'] = clearSessionCookie();
      return { account: null };
    }
    return { account: publicAccount(a.account) };
  });

  route('POST', '/auth/password', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const b = (await readBody(req)) as { current?: unknown; next?: unknown };
    const cred = await store.getAccountCredentials(a.account.username);
    if (!cred || typeof b.current !== 'string' || !(await verifyPassword(b.current, cred.passwordHash))) {
      throw new HttpError(401, 'BAD_CREDENTIALS', 'your current password is wrong');
    }
    const problem = passwordProblem(b.next, a.account.username);
    if (problem) throw new HttpError(400, 'WEAK_PASSWORD', problem);
    await store.setPasswordHash(a.account.id, await hashPassword(b.next as string), a.sessionHash);
    log.info('password_changed', { accountId: a.account.id });
    return { ok: true };
  });

  route('GET', '/auth/sessions', async (_m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const sessions = await store.listSessions(a.account.id);
    return { sessions: sessions.map((s) => ({ label: s.label || 'Unknown device', createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.tokenHash === a.sessionHash })) };
  });

  route('POST', '/auth/sessions/revoke-others', async (_m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    return { revoked: await store.deleteOtherSessions(a.account.id, a.sessionHash) };
  });

  route('POST', '/account/delete', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const b = (await readBody(req)) as { password?: unknown };
    const cred = await store.getAccountCredentials(a.account.username);
    if (!cred || typeof b.password !== 'string' || !(await verifyPassword(b.password, cred.passwordHash))) {
      throw new HttpError(401, 'BAD_CREDENTIALS', 'that password is wrong');
    }
    await store.deleteAccount(a.account.id);
    ctx.headers['set-cookie'] = clearSessionCookie();
    log.info('account_deleted', { accountId: a.account.id });
    return { ok: true };
  });

  // ---------------------------------------------------------------- own account
  route('PUT', '/account', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const b = (await readBody(req)) as { displayName?: unknown; favoriteClass?: unknown; motto?: unknown };
    const patch: { displayName?: string; favoriteClass?: string | null; motto?: string } = {};
    if (b.displayName !== undefined) patch.displayName = str(b.displayName, 'displayName', 64);
    if (b.favoriteClass !== undefined) {
      if (b.favoriteClass !== null && !CLASS_BY_ID[String(b.favoriteClass)]) throw new HttpError(400, 'INVALID_INPUT', 'unknown class');
      patch.favoriteClass = b.favoriteClass === null ? null : String(b.favoriteClass);
    }
    if (b.motto !== undefined) patch.motto = str(b.motto, 'motto', 240);
    return { account: publicAccount(await store.updateAccount(a.account.id, patch)) };
  });

  route('GET', '/account/stats', async (_m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    return { stats: await store.accountStats(a.account.profileId) };
  });

  route('GET', '/account/runs', async (_m, _req, url, ctx) => {
    const a = await ctx.requireAuth();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 30) || 30));
    const status = url.searchParams.get('status') ?? undefined;
    return { runs: await store.listRuns({ profileId: a.account.profileId, status, limit }) };
  });

  // ---------------------------------------------------------------- player cards
  route('GET', '/players/:username', async (m, _req, _url, ctx) => {
    const me = await ctx.requireAuth();
    const target = await store.getAccountByUsername(decodeURIComponent(m[1]!));
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'no such player');
    const [stats, runs, friends] = await Promise.all([
      store.accountStats(target.profileId),
      store.listRuns({ profileId: target.profileId, status: 'finalized', limit: 10 }),
      store.listFriends(me.account.id),
    ]);
    const rel = target.id === me.account.id ? 'self' : (friends.find((f) => f.accountId === target.id)?.state ?? 'none');
    return { player: publicAccount(target), stats, recentRuns: runs, relation: rel };
  });

  // ---------------------------------------------------------------- saved builds
  route('GET', '/builds', async (_m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    return { builds: await store.listBuilds(a.account.id), max: MAX_BUILDS };
  });

  route('POST', '/builds', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const b = parseBuild((await readBody(req)) as Record<string, unknown>);
    return { build: await store.saveBuild(a.account.id, newId('bld'), b, MAX_BUILDS) };
  });

  route('PUT', '/builds/:id', async (m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const id = assertId(m[1]!, 'build');
    const existing = (await store.listBuilds(a.account.id)).find((x) => x.id === id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'build not found');
    const body = (await readBody(req)) as Record<string, unknown>;
    const b = parseBuild({ ...existing, ...body, classId: body.classId ?? existing.classId, mastery: body.mastery !== undefined ? body.mastery : existing.mastery ? JSON.parse(existing.mastery) : null });
    b.sourceRunId = existing.sourceRunId;
    return { build: await store.saveBuild(a.account.id, id, b, MAX_BUILDS) };
  });

  route('DELETE', '/builds/:id', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    await store.deleteBuild(a.account.id, assertId(m[1]!, 'build'));
    return { ok: true };
  });

  /** Save the final build a player of a finished run ended with (own runs only). */
  route('POST', '/builds/from-run', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const b = (await readBody(req)) as { runId?: unknown; slot?: unknown; name?: unknown };
    const run = await store.getRun(assertId(String(b.runId ?? ''), 'run'));
    if (!run || !run.summaryJson) throw new HttpError(404, 'NOT_FOUND', 'finished run not found');
    const mine = run.members.find((x) => x.profileId === a.account.profileId);
    if (!mine) throw new HttpError(403, 'UNAUTHORIZED', 'you can only save builds from your own runs');
    const slot = typeof b.slot === 'number' ? b.slot : mine.slot;
    const sum = JSON.parse(run.summaryJson) as { players?: { slot: number; classId: string; ranks: Record<string, number>; mastery?: unknown }[]; round?: number };
    const p = sum.players?.find((x) => x.slot === slot);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'no such player in that run');
    const name = typeof b.name === 'string' && b.name.trim() ? b.name : `${CLASS_BY_ID[p.classId]?.name ?? p.classId} · round ${sum.round ?? run.round}`;
    const input = parseBuild({ name, classId: p.classId, ranks: p.ranks, mastery: p.mastery ?? null, notes: '', sourceRunId: run.id });
    return { build: await store.saveBuild(a.account.id, newId('bld'), input, MAX_BUILDS) };
  });

  // ---------------------------------------------------------------- friends
  route('GET', '/friends', async (_m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    return { friends: await store.listFriends(a.account.id) };
  });

  route('POST', '/friends', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const b = (await readBody(req)) as { username?: unknown };
    const name = typeof b.username === 'string' ? b.username.trim() : '';
    const target = USERNAME_RE.test(name) ? await store.getAccountByUsername(name) : null;
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'no player with that username');
    if (target.id === a.account.id) throw new HttpError(400, 'INVALID_INPUT', 'that is you');
    return { state: await store.requestFriend(a.account.id, target.id), friend: target.username };
  });

  route('POST', '/friends/:id/accept', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    await store.respondFriend(a.account.id, assertId(m[1]!, 'account'), true);
    return { ok: true };
  });

  route('POST', '/friends/:id/decline', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    await store.respondFriend(a.account.id, assertId(m[1]!, 'account'), false);
    return { ok: true };
  });

  route('DELETE', '/friends/:id', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    await store.removeFriend(a.account.id, assertId(m[1]!, 'account'));
    return { ok: true };
  });
}
