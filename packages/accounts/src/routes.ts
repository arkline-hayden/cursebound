import type { IncomingMessage } from 'node:http';
import { CLASS_BY_ID, NODE_BY_ID } from '@cursebound/content';
import { HttpError, readBody, type AuthState, type RouteCtx, type RouteRegistrar } from './http';
import { LOCK_AFTER_FAILURES, LOCK_MS, USERNAME_RE, burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from './password';
import { SESSION_TTL_MS, Throttle, deviceLabel, newId, newSessionToken, type SessionTransport } from './session';
import type { Account, AccountLog, AccountStore, SavedBuildInput } from './types';

// Account API (/api/v1/auth, /account, /players, /builds, /friends), shared by the local authority (cookie sessions,
// SQLite) and the cloud service (bearer tokens, Postgres). Every account-scoped route resolves the caller from the
// session; ids in paths are only ever matched within the caller's own rows.

export const MAX_BUILDS = 60;

/** The player of a finished run whose final build POST /builds/from-run saves. */
export interface RunBuildSource {
  player: { classId: string; ranks: unknown; mastery?: unknown };
  round: number;
  sourceRunId: string | null;
}

export interface AccountRouteDeps {
  route: RouteRegistrar;
  store: AccountStore;
  log: AccountLog;
  assertId: (v: string, what: string) => string;
  registerPerHour: number;
  transport: SessionTransport;
  /** client address used as the throttle key */
  clientAddress: (req: IncomingMessage) => string;
  /** local accounts may adopt this browser's guest profile on registration; the cloud ignores `claimProfileId` */
  claimProfiles?: boolean;
  /** finds the caller's player in a finished run (local: SQLite run history; cloud: the summary in the body) */
  buildFromRun: (auth: AuthState, body: Record<string, unknown>) => Promise<RunBuildSource>;
  /** told about every account whose friend list just changed (presence pushes fresh lists) */
  onFriendsChanged?: (accountIds: string[]) => void;
}

export const publicAccount = (a: Account) => ({
  id: a.id, username: a.username, displayName: a.displayName, profileId: a.profileId, favoriteClass: a.favoriteClass, motto: a.motto, createdAt: a.createdAt,
});

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'INVALID_INPUT', `${what} must be text of at most ${max} characters`);
  return v;
}

/** Validates a build against the content: class exists, every node belongs to it, ranks within limits. */
export function parseBuild(b: Record<string, unknown>): SavedBuildInput {
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
    // the third Mastery is cooldown recovery (sim 1.2); saved builds keep the legacy `regen` key for it (shared with the
    // cloud service and older saves), and accept either name on input
    const recovery = m.recovery ?? m.regen ?? 0;
    if (typeof m !== 'object' || !ok(m.damage ?? 0) || !ok(m.health ?? 0) || !ok(recovery)) throw new HttpError(400, 'INVALID_INPUT', 'invalid mastery');
    mastery = JSON.stringify({ damage: m.damage ?? 0, health: m.health ?? 0, regen: recovery });
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

export function registerAccountRoutes(deps: AccountRouteDeps) {
  const { route, store, log, assertId, registerPerHour, transport, clientAddress, buildFromRun } = deps;
  const loginThrottle = new Throttle(12, 10 * 60_000);
  const registerThrottle = new Throttle(registerPerHour, 60 * 60_000);
  const friendsChanged = (...ids: string[]) => {
    try { deps.onFriendsChanged?.(ids); } catch (err) { log.warn('friends_changed_hook_failed', { err: err as Error }); }
  };

  /** Creates a session; a bearer transport returns the token for the response body. */
  const startSession = async (req: IncomingMessage, ctx: RouteCtx, account: Account): Promise<{ token?: string }> => {
    const { token, tokenHash } = newSessionToken();
    const now = Date.now();
    await store.createSession({ tokenHash, accountId: account.id, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS, label: deviceLabel(req) });
    transport.issue(ctx, token);
    return transport.bearer ? { token } : {};
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
    if (deps.claimProfiles && typeof b.claimProfileId === 'string' && b.claimProfileId) {
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
    const session = await startSession(req, ctx, account);
    log.info('account_created', { accountId: account.id, claimed: !!claim });
    return { account: publicAccount(account), ...session };
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
    const session = await startSession(req, ctx, account);
    return { account: publicAccount(account), ...session };
  });

  route('POST', '/auth/logout', async (_m, _req, _url, ctx) => {
    const a = await ctx.auth();
    if (a) await store.deleteSession(a.sessionHash);
    transport.clear(ctx);
    return { ok: true };
  });

  route('GET', '/auth/me', async (_m, _req, _url, ctx) => {
    const a = await ctx.auth();
    if (!a) {
      // drop a stale cookie so the browser stops presenting it
      transport.clear(ctx);
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
    const friends = deps.onFriendsChanged ? await store.listFriends(a.account.id) : [];
    await store.deleteAccount(a.account.id);
    transport.clear(ctx);
    friendsChanged(...friends.map((f) => f.accountId));
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
    const b = (await readBody(req)) as Record<string, unknown>;
    const { player: p, round, sourceRunId } = await buildFromRun(a, b);
    const name = typeof b.name === 'string' && b.name.trim() ? b.name : `${CLASS_BY_ID[p.classId]?.name ?? p.classId} · round ${round}`;
    const input = parseBuild({ name, classId: p.classId, ranks: p.ranks, mastery: p.mastery ?? null, notes: '', sourceRunId });
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
    const state = await store.requestFriend(a.account.id, target.id);
    friendsChanged(a.account.id, target.id);
    return { state, friend: target.username };
  });

  route('POST', '/friends/:id/accept', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const other = assertId(m[1]!, 'account');
    await store.respondFriend(a.account.id, other, true);
    friendsChanged(a.account.id, other);
    return { ok: true };
  });

  route('POST', '/friends/:id/decline', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const other = assertId(m[1]!, 'account');
    await store.respondFriend(a.account.id, other, false);
    friendsChanged(a.account.id, other);
    return { ok: true };
  });

  route('DELETE', '/friends/:id', async (m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    const other = assertId(m[1]!, 'account');
    await store.removeFriend(a.account.id, other);
    friendsChanged(a.account.id, other);
    return { ok: true };
  });
}
