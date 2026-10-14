import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { CLASS_BY_ID, CONTENT_MANIFEST, RULES_VERSION, SCORE_VERSION, contentHash, validateContent } from '@cursebound/content';
import { BUILD_ID, PROTOCOL_VERSION, sanitizeName } from '@cursebound/protocol';
import { NUMERIC_VERSION } from '@cursebound/numeric';
import type { ServerConfig } from './config';
import type { Logger } from './persistence/logger';
import type { Store } from './persistence/store';
import { replayJournals } from './replay';
import type { RoomManager } from './rooms';
import { hostAllowed, hashToken, originAllowed } from './security';
import { SESSION_COOKIE, SESSION_TTL_MS, readCookie } from './auth';
import { registerAccountRoutes } from './accountRoutes';
import type { Account } from './persistence/types';

/** The signed-in account behind a request, with the hash of the session token it presented. */
export interface AuthState { account: Account; sessionHash: string }

// HTTP API /api/v1 (PRD §21.1). Mutations accept an Idempotency-Key; errors use explicit codes and never leak
// paths, tokens or stack traces. There is no endpoint that accepts damage or a client score.

const MAX_BODY = 64 * 1024;
const MAX_IMPORT = 8 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

/** Per-request context: response headers to add (Set-Cookie) and the lazily resolved signed-in account. */
export interface RouteCtx {
  headers: Record<string, string | string[]>;
  auth(): Promise<AuthState | null>;
  requireAuth(): Promise<AuthState>;
}
export type RouteFn = (m: RegExpMatchArray, req: IncomingMessage, url: URL, ctx: RouteCtx) => Promise<unknown>;

export function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'TOO_LARGE', 'request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'INVALID_INPUT', 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

export function createApi(cfg: ServerConfig, store: Store, rooms: RoomManager, log: Logger) {
  const idem = new Map<string, { at: number; status: number; body: unknown }>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of idem) if (now - v.at > 10 * 60000) idem.delete(k); }, 60000).unref();

  const send = (res: ServerResponse, status: number, body: unknown, requestId: string, extra: Record<string, string | string[]> = {}) => {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      ...extra,
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
    res.end(json);
  };

  const routes: { method: string; re: RegExp; fn: RouteFn }[] = [];
  const route = (method: string, path: string, fn: RouteFn) =>
    routes.push({ method, re: new RegExp('^/api/v1' + path.replace(/:([a-z]+)/g, '([^/]+)') + '$'), fn });

  const assertId = (v: string, what: string) => { if (!ID_RE.test(v)) throw new HttpError(400, 'INVALID_INPUT', `invalid ${what}`); return v; };

  const resolveAuth = async (req: IncomingMessage): Promise<AuthState | null> => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const sessionHash = hashToken(token);
    const now = Date.now();
    const session = await store.getSession(sessionHash, now, now + SESSION_TTL_MS);
    if (!session) return null;
    const account = await store.getAccount(session.accountId);
    return account ? { account, sessionHash } : null;
  };

  /** A profile that belongs to an account can only be played, resumed or configured by that account's session. */
  const assertProfileUse = async (profileId: string, ctx: RouteCtx) => {
    const owner = await store.getAccountByProfile(profileId);
    if (!owner) return;
    const a = await ctx.auth();
    if (!a || a.account.id !== owner.id) throw new HttpError(403, 'UNAUTHORIZED', 'that profile belongs to an account — sign in to use it');
  };

  route('GET', '/health', async () => {
    const h = await store.health().catch(() => ({ ok: false, schemaVersion: 0, walBytes: 0, queueDepth: 0, lastQueueAgeMs: 0 }));
    return { ok: h.ok, service: 'cursebound', build: BUILD_ID, protocol: PROTOCOL_VERSION, contentHash: contentHash(), rulesVersion: RULES_VERSION, scoreVersion: SCORE_VERSION, numericVersion: NUMERIC_VERSION, persistence: h, lan: cfg.lan, contentValid: validateContent().length === 0 };
  });
  route('GET', '/config', async () => ({ cloudUrl: cfg.cloudUrl, roomWsUrl: null, build: BUILD_ID, desktop: !!cfg.staticDir }));
  route('GET', '/content/:hash', async (m) => {
    if (m[1] !== contentHash()) throw new HttpError(404, 'NOT_FOUND', 'content version not available in this build');
    return { hash: contentHash(), manifest: CONTENT_MANIFEST };
  });
  route('POST', '/local/profiles', async (_m, req) => {
    const b = (await readBody(req)) as { displayName?: string };
    return store.createProfile(sanitizeName(String(b.displayName ?? 'Wanderer')));
  });
  route('GET', '/local/profiles/:id', async (m) => {
    const p = await store.getProfile(assertId(m[1], 'profile'));
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'profile not found');
    const owner = await store.getAccountByProfile(p.id);
    return { ...p, account: owner?.username ?? null };
  });
  route('GET', '/local/settings/:id', async (m, _req, _url, ctx) => {
    const id = assertId(m[1], 'profile');
    await assertProfileUse(id, ctx);
    return { settings: await store.getSettings(id) };
  });
  route('PUT', '/local/settings/:id', async (m, req, _url, ctx) => {
    const b = (await readBody(req)) as { settings?: unknown };
    const id = assertId(m[1], 'profile');
    await assertProfileUse(id, ctx);
    await store.putSettings(id, b.settings ?? {}, 1);
    return { ok: true };
  });
  route('POST', '/rooms', async (_m, req, _url, ctx) => {
    const b = (await readBody(req)) as { profileId?: string; mode?: string; classId?: string; challenge?: string; tutorial?: boolean };
    const profile = await store.getProfile(assertId(String(b.profileId ?? ''), 'profile'));
    if (!profile) throw new HttpError(404, 'NOT_FOUND', 'profile not found');
    await assertProfileUse(profile.id, ctx);
    const mode = b.mode === 'coop' ? 'coop' : 'solo';
    const tutorial = !!b.tutorial && mode === 'solo';
    const challenge = b.challenge === 'daily' ? 'daily' : 'random';
    const room = rooms.createRoom({ mode, challenge: tutorial ? 'tutorial' : challenge, tutorial });
    const { seat, token } = room.addSeat(profile.id, profile.displayName, CLASS_BY_ID[String(b.classId)] ? String(b.classId) : 'vanguard');
    return { roomId: room.id, code: room.code, seatToken: token, slot: seat.slot, mode };
  });
  route('GET', '/rooms/:code', async (m) => {
    const room = rooms.byCode(m[1]);
    if (!room) throw new HttpError(404, 'NOT_FOUND', 'room not found');
    return { roomId: room.id, code: room.code, mode: room.mode, stage: room.stage, seats: room.seats.map((s) => ({ slot: s.slot, name: s.name, classId: s.classId, ready: s.ready })), max: room.mode === 'solo' ? 1 : 5 };
  });
  route('POST', '/rooms/:code/join', async (m, req, _url, ctx) => {
    const b = (await readBody(req)) as { profileId?: string; classId?: string };
    const room = rooms.byCode(m[1]);
    if (!room) throw new HttpError(404, 'NOT_FOUND', 'room not found');
    const profile = await store.getProfile(assertId(String(b.profileId ?? ''), 'profile'));
    if (!profile) throw new HttpError(404, 'NOT_FOUND', 'profile not found');
    await assertProfileUse(profile.id, ctx);
    try {
      const { seat, token } = room.addSeat(profile.id, profile.displayName, String(b.classId ?? 'arcanist'));
      return { roomId: room.id, code: room.code, seatToken: token, slot: seat.slot, mode: room.mode };
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'INVALID_INPUT';
      throw new HttpError(409, code, (err as Error).message);
    }
  });
  route('GET', '/runs', async (_m, _req, url) => {
    const profileId = url.searchParams.get('profileId') ?? undefined;
    if (profileId) assertId(profileId, 'profile');
    const status = url.searchParams.get('status') ?? undefined;
    return { runs: await store.listRuns({ profileId, status, limit: Math.min(100, Number(url.searchParams.get('limit') ?? 30) || 30) }) };
  });
  route('GET', '/runs/:id', async (m) => {
    const r = await store.getRun(assertId(m[1], 'run'));
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'run not found');
    return r;
  });
  route('POST', '/runs/:id/resume', async (m, req, _url, ctx) => {
    const b = (await readBody(req)) as { profileId?: string };
    await assertProfileUse(assertId(String(b.profileId ?? ''), 'profile'), ctx);
    try {
      const r = await rooms.resumeRun(assertId(m[1], 'run'), assertId(String(b.profileId ?? ''), 'profile'));
      return { roomId: r.room.id, code: r.room.code, seatToken: r.token, slot: r.slot, mode: 'solo', resumed: true };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(409, (err as { code?: string }).code ?? 'CONFLICT', (err as Error).message);
    }
  });
  route('POST', '/runs/:id/retire', async () => {
    throw new HttpError(409, 'STALE_PHASE', 'retire through the live room connection (seat-scoped); the request was not recorded');
  });
  route('POST', '/runs/:id/favorite', async (m, req) => {
    const b = (await readBody(req)) as { favorite?: boolean };
    await store.setFavorite(assertId(m[1], 'run'), !!b.favorite);
    return { ok: true };
  });
  route('GET', '/runs/:id/replay', async (m) => {
    const id = assertId(m[1], 'run');
    const run = await store.getRun(id);
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'run not found');
    const chunks = await store.readReplay(id);
    return { format: 'cursebound-replay-1', runId: id, contentHash: run.contentHash, scoreText: run.scoreText, summary: run.summaryJson ? JSON.parse(run.summaryJson) : null, chunks: chunks.map((c) => c.json), trust: 'Local export (casual, unverified)' };
  });
  route('POST', '/runs/:id/verify', async (m) => {
    const id = assertId(m[1], 'run');
    const run = await store.getRun(id);
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'run not found');
    if (run.status !== 'finalized') throw new HttpError(409, 'STALE_PHASE', 'only finalized runs can be verified');
    const chunks = await store.readReplay(id);
    const summary = run.summaryJson ? JSON.parse(run.summaryJson) as { finalStateHash?: string } : {};
    const result = replayJournals(chunks.map((c) => c.json), { scoreText: run.scoreText, finalStateHash: summary.finalStateHash });
    log.info('replay_verify', { runId: id, ok: result.ok, reason: result.reason });
    // local verification is evidence for the machine owner only; it never upgrades a record to trusted
    return { ...result, trust: 'Local replay check (not a verified global record)' };
  });
  route('POST', '/local/import', async (_m, req) => {
    const b = (await readBody(req, MAX_IMPORT)) as { format?: string; chunks?: unknown; scoreText?: string; summary?: { finalStateHash?: string } };
    if (b.format !== 'cursebound-replay-1' || !Array.isArray(b.chunks) || b.chunks.length > 2000 || !b.chunks.every((c) => typeof c === 'string' && c.length < 4 * 1024 * 1024)) {
      throw new HttpError(400, 'INVALID_INPUT', 'not a CURSEBOUND replay export');
    }
    const result = replayJournals(b.chunks as string[], { scoreText: typeof b.scoreText === 'string' ? b.scoreText : undefined, finalStateHash: b.summary?.finalStateHash });
    return { ...result, trust: 'Imported casual run (never ranked)' };
  });
  route('GET', '/boards', async (_m, _req, url, ctx) => {
    const key = url.searchParams.get('key');
    if (!key || key.length > 256) throw new HttpError(400, 'INVALID_INPUT', 'board key required');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25) || 25));
    const scope = url.searchParams.get('scope') ?? 'all';
    let profileIds: string[] | undefined;
    if (scope === 'friends' || scope === 'mine') {
      const a = await ctx.requireAuth();
      profileIds = scope === 'mine' ? [a.account.profileId] : [a.account.profileId, ...(await store.friendProfileIds(a.account.id))];
    }
    const r = await store.queryBoard({ boardKey: key, limit, cursor: url.searchParams.get('cursor'), includePractice: url.searchParams.get('practice') === '1', profileIds });
    return { ...r, trustLabel: 'Local', note: 'Local records are editable by the machine owner and are never verified global competition.' };
  });
  route('GET', '/boards/keys', async () => ({ keys: await store.listBoardKeys(), current: { rulesVersion: RULES_VERSION, scoreVersion: SCORE_VERSION, contentHash: contentHash() } }));
  route('GET', '/metrics', async () => ({ rooms: rooms.metrics(), store: await store.health().catch(() => null), memory: process.memoryUsage() }));
  route('GET', '/lan', async () => ({ enabled: cfg.lan, hosts: rooms.lanHosts(), note: cfg.lan ? 'LAN sharing is on. Others on your network can join with the room code; allow Node.js through the firewall if prompted.' : 'LAN sharing is off. Start with CURSEBOUND_LAN=1 (npm run start -- --lan) to opt in.' }));

  registerAccountRoutes({ route, store, log, assertId, registerPerHour: cfg.registerPerHour });

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const requestId = crypto.randomUUID();
    try {
      if (!hostAllowed(cfg, req)) throw new HttpError(421, 'UNAUTHORIZED', 'host not allowed');
      const method = req.method ?? 'GET';
      const mutating = method !== 'GET' && method !== 'HEAD';
      if (!originAllowed(cfg, req, false)) throw new HttpError(403, 'UNAUTHORIZED', 'origin not allowed');
      if (mutating && req.headers['content-type'] && !String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'INVALID_INPUT', 'JSON required');
      const url = new URL(req.url ?? '/', 'http://localhost');
      // replayed responses are scoped to the session so one account can never receive another's cached reply;
      // auth endpoints set cookies and are never replayed
      const sessionTag = readCookie(req, SESSION_COOKIE)?.slice(0, 12) ?? '-';
      const key = mutating && !url.pathname.startsWith('/api/v1/auth/') ? req.headers['idempotency-key'] : undefined;
      const idemKey = typeof key === 'string' && key.length <= 80 ? `${method}:${url.pathname}:${sessionTag}:${key}` : null;
      if (idemKey) {
        const hit = idem.get(idemKey);
        if (hit) return send(res, hit.status, hit.body, requestId);
      }
      let authMemo: Promise<AuthState | null> | null = null;
      const ctx: RouteCtx = {
        headers: {},
        auth: () => (authMemo ??= resolveAuth(req)),
        requireAuth: async () => {
          const a = await ctx.auth();
          if (!a) throw new HttpError(401, 'UNAUTHENTICATED', 'sign in first');
          return a;
        },
      };
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const body = await r.fn(m, req, url, ctx);
        const out = { requestId, ...(body as object) };
        if (idemKey) idem.set(idemKey, { at: Date.now(), status: 200, body: out });
        return send(res, 200, out, requestId, ctx.headers);
      }
      throw new HttpError(404, 'NOT_FOUND', 'no such endpoint');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { requestId, error: { code: err.code, message: err.message } }, requestId);
      const code = (err as { code?: string }).code;
      const status = code === 'NOT_FOUND' ? 404 : code === 'INVALID_INPUT' || code === 'CONSTRAINT' ? 400 : code === 'CONFLICT' ? 409 : 500;
      log.error('http_error', { err: err as Error, path: req.url?.split('?')[0] });
      return send(res, status, { requestId, error: { code: code ?? 'INTERNAL', message: status === 500 ? 'internal error' : (err as Error).message } }, requestId);
    }
  };
}
