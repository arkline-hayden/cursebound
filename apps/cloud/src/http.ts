import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AccountStoreError, HttpError, ID_RE, Throttle, authenticateToken, bearerTransport, hashToken, readBody, registerAccountRoutes, routePattern,
  sanitizeDisplayName, type AuthState, type RouteCtx, type RouteFn,
} from '@cursebound/accounts';
import { RULES_VERSION, SCORE_VERSION, contentHash } from '@cursebound/content';
import type { CloudConfig } from './config';
import type { CloudLog } from './log';
import type { PgAccountStore, RunSubmission } from './store';
import { createSite } from './site';
import { iceServers } from './turn';

// Cloud HTTP API (docs/contracts/ONLINE_CONTRACT.md, base /api/v1): the shared account routes with bearer sessions,
// plus run summaries, boards, TURN credentials and health. Browsers reach it cross-origin (the desktop app on
// http://127.0.0.1:<random port>, web dev on localhost), so CORS is an allowlist; no cookies are ever used.
// Errors are `{ requestId, error: { code, message } }` and never carry stack traces or internals.

const RUN_BODY = 256 * 1024;
const SCORE_RE = /^(0|[1-9][0-9]{0,4095})$/;
// eslint-disable-next-line no-control-regex
const LINE_RE = /^[^\u0000-\u001f\u007f]{1,256}$/;
const CLASS_RE = /^[a-z0-9_]{1,64}$/;
const UNFINISHED = new Set(['aborted_infrastructure', 'invalidated']);

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-dns-prefetch-control': 'off',
  'x-permitted-cross-domain-policies': 'none',
  'origin-agent-cluster': '?1',
};

/** Loopback origins on any port (desktop apps pick a random port) plus the configured exact origins. */
export function originAllowed(cfg: Pick<CloudConfig, 'corsOrigins'>, origin: string): boolean {
  const o = origin.toLowerCase();
  if (cfg.corsOrigins.includes(o)) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(o);
}

/** Throttle key: the address Cloud Run's front end appended to X-Forwarded-For (right-most hop), else the peer. */
export function clientAddress(cfg: Pick<CloudConfig, 'trustProxyHops'>, req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  const fwd = req.headers['x-forwarded-for'];
  if (cfg.trustProxyHops > 0 && typeof fwd === 'string' && fwd.length < 1024) {
    const hops = fwd.split(',').map((x) => x.trim()).filter(Boolean);
    return hops[hops.length - cfg.trustProxyHops] ?? hops[0] ?? peer;
  }
  return peer;
}

const int = (v: unknown, what: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new HttpError(400, 'INVALID_INPUT', `${what} must be an integer in ${min}..${max}`);
  return v;
};
const playerName = (v: unknown): string => {
  try { return sanitizeDisplayName(typeof v === 'string' ? v : ''); } catch { return 'Wanderer'; }
};

/** The final builds of a summary's players, trimmed to what /builds/from-run needs. */
function trimPlayers(v: unknown): { slot: number; name: string; classId: string; ranks: Record<string, number>; mastery: unknown }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).flatMap((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    if (typeof o.classId !== 'string' || !CLASS_RE.test(o.classId) || typeof o.slot !== 'number' || !Number.isInteger(o.slot) || o.slot < 0 || o.slot > 4) return [];
    const ranks: Record<string, number> = {};
    if (o.ranks && typeof o.ranks === 'object' && !Array.isArray(o.ranks)) {
      for (const [k, r] of Object.entries(o.ranks as Record<string, unknown>).slice(0, 200)) if (/^[a-z0-9_]{1,64}$/.test(k) && typeof r === 'number' && Number.isInteger(r) && r >= 0 && r <= 99) ranks[k] = r;
    }
    const m = o.mastery && typeof o.mastery === 'object' ? (o.mastery as Record<string, unknown>) : null;
    const mastery = m ? { damage: Number(m.damage) || 0, health: Number(m.health) || 0, regen: Number(m.regen) || 0 } : null;
    return [{ slot: o.slot, name: playerName(o.name), classId: o.classId, ranks, mastery }];
  });
}

/** Validates a POST /runs body. Only the submitter's own account id is kept; other participants become guests. */
export function parseRunSubmission(b: Record<string, unknown>, submitterId: string): RunSubmission {
  if (typeof b.runId !== 'string' || !ID_RE.test(b.runId)) throw new HttpError(400, 'INVALID_INPUT', 'invalid runId');
  if (typeof b.boardKey !== 'string' || !LINE_RE.test(b.boardKey)) throw new HttpError(400, 'INVALID_INPUT', 'invalid boardKey');
  if (typeof b.scoreText !== 'string' || !SCORE_RE.test(b.scoreText)) throw new HttpError(400, 'INVALID_INPUT', 'scoreText must be a canonical decimal string');
  if (typeof b.mode !== 'string' || !/^[a-z]{1,16}$/.test(b.mode)) throw new HttpError(400, 'INVALID_INPUT', 'invalid mode');
  if (b.challengeId !== null && b.challengeId !== undefined && (typeof b.challengeId !== 'string' || !/^[A-Za-z0-9:_.-]{1,64}$/.test(b.challengeId))) throw new HttpError(400, 'INVALID_INPUT', 'invalid challengeId');
  if (typeof b.practice !== 'boolean') throw new HttpError(400, 'INVALID_INPUT', 'practice must be true or false');
  if (!Array.isArray(b.participants) || b.participants.length < 1 || b.participants.length > 5) throw new HttpError(400, 'INVALID_INPUT', 'participants must list 1..5 players');
  const participants = b.participants.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    if (typeof o.classId !== 'string' || !CLASS_RE.test(o.classId)) throw new HttpError(400, 'INVALID_INPUT', 'invalid participant classId');
    return { accountId: o.accountId === submitterId ? submitterId : null, name: playerName(o.name), classId: o.classId };
  });
  if (!participants.some((p) => p.accountId === submitterId)) throw new HttpError(403, 'UNAUTHORIZED', 'only a participant of the run can submit it');
  const summary = (b.summary && typeof b.summary === 'object' ? b.summary : {}) as Record<string, unknown>;
  const depth = int(b.depth, 'depth', 0, 1_000_000);
  const endReason = typeof summary.endReason === 'string' && summary.endReason.length <= 64 ? summary.endReason : null;
  if (endReason && UNFINISHED.has(endReason)) throw new HttpError(400, 'INVALID_INPUT', 'only finished runs can be submitted');
  const round = typeof summary.round === 'number' && Number.isSafeInteger(summary.round) && summary.round >= 0 && summary.round <= 1_000_000 ? summary.round : depth;
  const summaryJson = JSON.stringify({ runId: b.runId, round, endReason, players: trimPlayers(summary.players) });
  return {
    runId: b.runId, boardKey: b.boardKey, scoreText: b.scoreText, depth, round, activeTicks: int(b.activeTicks, 'activeTicks', 0, Number.MAX_SAFE_INTEGER),
    mode: b.mode, n: int(b.n, 'n', 1, 5), challengeId: (b.challengeId as string | null | undefined) ?? null, practice: b.practice, endReason, participants, summaryJson,
  };
}

export interface CloudApiDeps {
  cfg: CloudConfig;
  store: PgAccountStore;
  log: CloudLog;
  /** fan-out to presence: these accounts' friend lists changed */
  friendsChanged: (accountIds: string[]) => void;
  /** live presence sockets, reported by /healthz */
  connections: () => number;
  /** injectable for tests (the download site fetches the latest installer) */
  fetchImpl?: typeof fetch;
}

export function createCloudApi({ cfg, store, log, friendsChanged, connections, fetchImpl }: CloudApiDeps) {
  const site = createSite({ cfg, log, fetchImpl });
  const idem = new Map<string, { at: number; status: number; body: unknown }>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of idem) if (now - v.at > 10 * 60000) idem.delete(k); }, 60000).unref();
  const rate = new Throttle(cfg.ratePerMinute, 60_000);
  const runThrottle = new Throttle(30, 10 * 60_000);

  const routes: { method: string; re: RegExp; fn: RouteFn }[] = [];
  const route = (method: string, path: string, fn: RouteFn) => routes.push({ method, re: routePattern(path), fn });
  const assertId = (v: string, what: string) => { if (!ID_RE.test(v)) throw new HttpError(400, 'INVALID_INPUT', `invalid ${what}`); return v; };

  registerAccountRoutes({
    route, store, log, assertId,
    registerPerHour: cfg.registerPerHour,
    transport: bearerTransport,
    clientAddress: (req) => clientAddress(cfg, req),
    claimProfiles: false,
    onFriendsChanged: friendsChanged,
    // the summary rides in the body; a run the caller already submitted (POST /runs) can be named by id instead
    buildFromRun: async (a: AuthState, b) => {
      let players: { slot?: unknown; classId: string; ranks: unknown; mastery?: unknown; accountId?: unknown }[];
      let round: number;
      let runId: unknown;
      let slot: unknown = b.slot;
      if (b.summary && typeof b.summary === 'object') {
        const sum = b.summary as Record<string, unknown>;
        players = Array.isArray(sum.players) ? (sum.players.slice(0, 5) as typeof players) : [];
        round = typeof sum.round === 'number' ? sum.round : 0;
        runId = sum.runId;
        if (slot === undefined) {
          const me = players.find((p) => p && p.accountId === a.account.id) ?? (players.length === 1 ? players[0] : undefined);
          slot = me?.slot;
          if (!me) throw new HttpError(404, 'NOT_FOUND', 'your player is not in that run summary');
          if (typeof me.classId !== 'string') throw new HttpError(400, 'INVALID_INPUT', 'invalid player in summary');
          return { player: me, round, sourceRunId: typeof runId === 'string' && ID_RE.test(runId) ? runId : null };
        }
      } else {
        runId = assertId(String(b.runId ?? ''), 'run');
        const found = await store.runForAccount(a.account.id, runId as string);
        if (!found) throw new HttpError(404, 'NOT_FOUND', 'finished run not found');
        const sum = found.summary as { players?: typeof players; round?: number };
        players = Array.isArray(sum.players) ? sum.players : [];
        round = typeof sum.round === 'number' ? sum.round : 0;
        if (slot === undefined) slot = found.slot;
      }
      const p = players.find((x) => x && x.slot === slot);
      if (!p || typeof p.classId !== 'string') throw new HttpError(404, 'NOT_FOUND', 'no such player in that run');
      return { player: p, round, sourceRunId: typeof runId === 'string' && ID_RE.test(runId) ? runId : null };
    },
  });

  // ---------------------------------------------------------------- run summaries & boards
  route('POST', '/runs', async (_m, req, _url, ctx) => {
    const a = await ctx.requireAuth();
    if (runThrottle.blocked(a.account.id)) throw new HttpError(429, 'RATE_LIMITED', 'too many runs submitted — try again later');
    const sub = parseRunSubmission((await readBody(req, RUN_BODY)) as Record<string, unknown>, a.account.id);
    runThrottle.hit(a.account.id);
    const r = await store.submitRun(a.account.id, sub);
    if (!r.existing) log.info('run_submitted', { accountId: a.account.id, runId: sub.runId, n: sub.n, practice: sub.practice });
    return { ok: true, runId: sub.runId, existing: r.existing, rank: r.rank, trust: 'client-reported' };
  });

  route('GET', '/boards', async (_m, _req, url, ctx) => {
    const key = url.searchParams.get('key');
    if (!key || key.length > 256) throw new HttpError(400, 'INVALID_INPUT', 'board key required');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25) || 25));
    const scope = url.searchParams.get('scope') ?? 'all';
    let accountIds: string[] | undefined;
    if (scope === 'friends' || scope === 'mine') {
      const a = await ctx.requireAuth();
      accountIds = scope === 'mine' ? [a.account.id] : [a.account.id, ...(await store.friendProfileIds(a.account.id))];
    }
    const r = await store.queryBoard({ boardKey: key, limit, cursor: url.searchParams.get('cursor'), includePractice: url.searchParams.get('practice') === '1', accountIds });
    return { ...r, trustLabel: 'Online · client-reported', note: 'Online records are reported by the players’ own game clients and are not verified.' };
  });

  route('GET', '/boards/keys', async () => ({ keys: await store.listBoardKeys(), current: { rulesVersion: RULES_VERSION, scoreVersion: SCORE_VERSION, contentHash: contentHash() } }));

  // ---------------------------------------------------------------- WebRTC & health
  route('GET', '/turn', async (_m, _req, _url, ctx) => {
    const a = await ctx.requireAuth();
    return iceServers(cfg, a.account.id);
  });

  route('GET', '/healthz', async () => {
    const ok = await store.health().catch(() => false);
    if (!ok) throw new HttpError(503, 'UNAVAILABLE', 'database unavailable');
    return { ok, build: cfg.build, minClientBuild: cfg.minClientBuild, presence: connections() };
  });

  const corsHeaders = (origin: string | undefined, preflight: boolean): Record<string, string> => {
    if (!origin) return {};
    const h: Record<string, string> = { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': 'x-request-id' };
    if (preflight) {
      h['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      h['access-control-allow-headers'] = 'authorization, content-type, idempotency-key';
      h['access-control-max-age'] = '600';
    }
    return h;
  };

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://cloud.invalid');
    const path = url.pathname === '/healthz' ? '/api/v1/healthz' : url.pathname;
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowed = !origin || originAllowed(cfg, origin);
    let cors = allowed ? corsHeaders(origin, false) : {};
    let status = 200;
    const send = (st: number, body: unknown, extra: Record<string, string | string[]> = {}) => {
      status = st;
      // an oversized body is not read to the end: answer and drop the connection
      res.writeHead(st, { ...SECURITY_HEADERS, ...cors, ...extra, 'x-request-id': requestId, ...(st === 413 ? { connection: 'close' } : {}) });
      res.end(body === null ? undefined : JSON.stringify(body));
    };
    res.on('finish', () => {
      if (path === '/api/v1/healthz' && status === 200) return;
      log.info('http_request', { requestId, method, path: path.slice(0, 200), status, ms: Date.now() - started });
    });
    try {
      if (!allowed) throw new HttpError(403, 'UNAUTHORIZED', 'origin not allowed');
      if (method === 'OPTIONS') {
        cors = corsHeaders(origin, true);
        return send(204, null);
      }
      const ip = clientAddress(cfg, req);
      if (rate.blocked(ip)) throw new HttpError(429, 'RATE_LIMITED', 'too many requests — slow down');
      rate.hit(ip);
      // the public download site (landing page + streamed installer) lives outside the JSON API
      if ((method === 'GET' || method === 'HEAD') && site.handles(path)) { await site.serve(req, res, path, requestId); status = res.statusCode; return; }
      const mutating = method !== 'GET' && method !== 'HEAD';
      if (mutating && req.headers['content-type'] && !String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'INVALID_INPUT', 'JSON required');
      // replayed responses are scoped to the presented token so one account never receives another's cached reply;
      // auth endpoints mint tokens and are never replayed
      const token = bearerTransport.read(req);
      const key = mutating && !path.startsWith('/api/v1/auth/') ? req.headers['idempotency-key'] : undefined;
      const idemKey = typeof key === 'string' && key.length <= 80 ? `${method}:${path}:${token ? hashToken(token).slice(0, 16) : '-'}:${key}` : null;
      if (idemKey) {
        const hit = idem.get(idemKey);
        if (hit) return send(hit.status, hit.body);
      }
      let authMemo: Promise<AuthState | null> | null = null;
      const ctx: RouteCtx = {
        headers: {},
        auth: () => (authMemo ??= authenticateToken(store, token)),
        requireAuth: async () => {
          const a = await ctx.auth();
          if (!a) throw new HttpError(401, 'UNAUTHENTICATED', 'sign in first');
          return a;
        },
      };
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (!m) continue;
        const body = await r.fn(m, req, url, ctx);
        const out = { requestId, ...(body as object) };
        if (idemKey) idem.set(idemKey, { at: Date.now(), status: 200, body: out });
        return send(200, out, ctx.headers);
      }
      throw new HttpError(404, 'NOT_FOUND', 'no such endpoint');
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { requestId, error: { code: err.code, message: err.message } });
      const code = (err as { code?: string }).code;
      if (err instanceof AccountStoreError) {
        const st = code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'INVALID_INPUT' ? 400 : 500;
        if (st !== 500) return send(st, { requestId, error: { code, message: err.message } });
      }
      // Postgres constraint failures are client errors; their text (table/constraint names) is not echoed
      if (code === '23505') return send(409, { requestId, error: { code: 'CONFLICT', message: 'that already exists' } });
      if (code === '23514' || code === '22P02' || code === '22001' || code === '22003') return send(400, { requestId, error: { code: 'INVALID_INPUT', message: 'invalid input' } });
      log.error('http_error', { requestId, err: err as Error, path: path.slice(0, 200) });
      return send(500, { requestId, error: { code: 'INTERNAL', message: 'internal error' } });
    }
  };
}
