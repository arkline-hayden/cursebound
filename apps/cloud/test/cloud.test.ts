import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { clientAddress, originAllowed } from '../src/http';
import { CLOUD_MIGRATIONS, CLOUD_SCHEMA_VERSION, migrate } from '../src/migrations';
import type { PresenceDeps } from '../src/presence';
import { startCloud, type CloudServer } from '../src/server';
import { openPglite } from '../src/sql';

// The cloud service over real HTTP with a real Postgres (PGlite, in memory): bearer-token accounts, lockout,
// friends (and the presence wiring), builds, run summaries with friend/mine boards, TURN credentials and CORS.

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ENV = { PORT: '0', HOST: '127.0.0.1', REGISTER_PER_HOUR: '1000', RATE_PER_MINUTE: '100000', CORS_ORIGINS: 'https://play.cursebound.example' };

async function boot(env: Record<string, string> = {}, presence?: (deps: PresenceDeps) => void): Promise<CloudServer> {
  const sql = await openPglite();
  return startCloud({
    env: { ...ENV, ...env }, sql, log: silent,
    presence: presence ? (_server, deps) => { presence(deps); return { connections: () => 0, close: async () => undefined }; } : undefined,
  });
}

/** One simulated player: keeps the bearer token register/login hand back. */
class Player {
  token: string | null = null;
  constructor(private readonly base: string, private readonly origin = 'http://127.0.0.1:51234') {}
  async call<T = any>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const h: Record<string, string> = { 'content-type': 'application/json', origin: this.origin, ...headers };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    const r = await fetch(`${this.base}/api/v1${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as T, headers: r.headers };
  }
  async ok<T = any>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, p, body);
    if (r.status !== 200) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  async register(username: string, password: string, extra: Record<string, unknown> = {}) {
    const r = await this.ok('POST', '/auth/register', { username, password, ...extra });
    this.token = r.token;
    return r.account;
  }
}

const KEY = 'rules-1|content-x|score-1|n2|coop|open|casual';
const runBody = (runId: string, scoreText: string, participants: { accountId: string | null; name: string; classId: string }[], extra: Record<string, unknown> = {}) => ({
  runId, boardKey: KEY, scoreText, depth: 4, activeTicks: 9000, mode: 'coop', n: participants.length, challengeId: null, practice: false, participants,
  summary: { runId, round: 5, endReason: 'wipe', players: participants.map((p, slot) => ({ slot, name: p.name, classId: p.classId, ranks: {}, mastery: { damage: 1, health: 0, regen: 0 } })) },
  ...extra,
});

describe('cloud service', () => {
  let srv: CloudServer;
  let base: string;
  let deps: PresenceDeps | null = null;
  const pushed: string[] = [];
  beforeAll(async () => {
    srv = await boot({}, (d) => {
      deps = d;
      d.onFriendsChanged?.((id) => pushed.push(id));
    });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => { await srv?.close(); });
  const player = () => new Player(base);

  it('runs migrations once, idempotently, and refuses a newer schema', async () => {
    const again = await migrate(srv.sql);
    expect(again).toEqual({ from: CLOUD_SCHEMA_VERSION, to: CLOUD_SCHEMA_VERSION, applied: [] });
    const v = await srv.sql.query('SELECT version FROM schema_version ORDER BY version');
    expect(v.rows.map((r) => Number(r.version))).toEqual(CLOUD_MIGRATIONS.map((m) => m.version));
    const fresh = await openPglite();
    try {
      await migrate(fresh);
      await fresh.query("INSERT INTO schema_version(version, name, applied_at) VALUES (99, 'future', 0)");
      await expect(migrate(fresh)).rejects.toThrow(/newer than this build/);
    } finally { await fresh.close(); }
  });

  // Regression: v1 ordered friend pairs with the database collation while the store orders them like JavaScript
  // (code units). On Cloud SQL's linguistic collation mixed-case ids disagreed and every such request failed as
  // "invalid input". v2 makes the CHECK byte-wise; this upgrades a v1 database the way production did.
  it('upgrades v1 friendships to a byte-wise pair order and befriends mixed-case ids', async () => {
    const db = await openPglite();
    try {
      await migrate(db, undefined, CLOUD_MIGRATIONS.slice(0, 1));
      await migrate(db);
      const defs = (await db.query<{ def: string }>(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'friendships'::regclass AND contype = 'c'",
      )).rows.map((r) => r.def);
      const order = defs.filter((d) => d.includes('account_a') && d.includes('<'));
      expect(order).toHaveLength(1);
      expect(order[0]).toContain('COLLATE "C"');
    } finally { await db.close(); }
    // ids whose JavaScript order ('Z' < 'a') differs from a case-insensitive order
    for (const [id, name] of [['acc_Zulu00', 'Zulu_one'], ['acc_alpha0', 'alpha_two']] as const) {
      await srv.sql.query('INSERT INTO accounts(id, username, display_name, password_hash, created_at) VALUES ($1, $2, $2, $3, $4)', [id, name, 'x', Date.now()]);
    }
    expect(await srv.store.requestFriend('acc_alpha0', 'acc_Zulu00')).toBe('outgoing');
    expect(await srv.store.requestFriend('acc_Zulu00', 'acc_alpha0')).toBe('friends');
  });

  it('serves health with build info, security headers and a request id', async () => {
    const r = await player().call('GET', '/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, minClientBuild: null });
    expect(typeof r.body.build).toBe('string');
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.requestId).toBe(r.headers.get('x-request-id'));
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toMatch(/max-age/);
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const missing = await player().call('GET', '/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ requestId: expect.any(String), error: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(missing.body)).not.toMatch(/at .*\.ts/);
  });

  it('registers and signs in with bearer tokens, never cookies', async () => {
    const a = player();
    const reg = await a.call('POST', '/auth/register', { username: 'Ivy_Bold', password: 'lantern-in-the-deep', displayName: 'Ivy the Bold', claimProfileId: 'prof_x' });
    expect(reg.status).toBe(200);
    expect(reg.headers.get('set-cookie')).toBeNull();
    expect(reg.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reg.body.account).toMatchObject({ username: 'Ivy_Bold', displayName: 'Ivy the Bold' });
    expect(reg.body.account.profileId).toBe(reg.body.account.id); // claimProfileId is ignored in the cloud
    expect(reg.body.account.passwordHash).toBeUndefined();
    a.token = reg.body.token;
    expect((await a.ok('GET', '/auth/me')).account.username).toBe('Ivy_Bold');
    // the token is stored only as a SHA-256 hash
    const hashes = await srv.sql.query('SELECT token_hash FROM sessions');
    expect(hashes.rows.map((r) => r.token_hash)).toContain(crypto.createHash('sha256').update(a.token!).digest('hex'));
    expect(JSON.stringify(hashes.rows)).not.toContain(a.token!);

    const dup = await player().call('POST', '/auth/register', { username: 'ivy_bold', password: 'another-long-one' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USERNAME_TAKEN');

    const old = a.token;
    await a.ok('POST', '/auth/logout');
    expect((await a.ok('GET', '/auth/me')).account).toBeNull();
    a.token = null;
    expect((await a.ok('GET', '/auth/me')).account).toBeNull();
    expect((await new Player(base).call('GET', '/builds', undefined, { authorization: `Bearer ${old}` })).status).toBe(401);

    const bad = await a.call('POST', '/auth/login', { username: 'Ivy_Bold', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await a.call('POST', '/auth/login', { username: 'Nobody_Here', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    const login = await a.ok('POST', '/auth/login', { username: 'IVY_BOLD', password: 'lantern-in-the-deep' });
    expect(login.token).toBeTruthy();
    expect(login.token).not.toBe(old);
    a.token = login.token;
    expect((await a.ok('GET', '/auth/me')).account.username).toBe('Ivy_Bold');
  });

  it('rejects weak passwords, malformed usernames and oversized bodies', async () => {
    const b = player();
    expect((await b.call('POST', '/auth/register', { username: 'ok_name', password: 'short' })).body.error.code).toBe('WEAK_PASSWORD');
    expect((await b.call('POST', '/auth/register', { username: 'no spaces!', password: 'long-enough-pass' })).status).toBe(400);
    expect((await b.call('POST', '/auth/login', { username: 'x', password: 'y'.repeat(70 * 1024) })).status).toBe(413);
    expect((await b.call('POST', '/auth/login', 'x', { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('locks an account after repeated failures without touching live sessions', async () => {
    const owner = player();
    await owner.register('Locksmith', 'iron-keys-and-bolts');
    const attacker = player();
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await attacker.call('POST', '/auth/login', { username: 'Locksmith', password: `guess-${i}-xxxx` })).status;
    expect([423, 429]).toContain(last);
    expect([423, 429]).toContain((await player().call('POST', '/auth/login', { username: 'Locksmith', password: 'iron-keys-and-bolts' })).status);
    expect((await owner.ok('GET', '/auth/me')).account.username).toBe('Locksmith');
  });

  it('lists sessions, revokes others and rotates on password change', async () => {
    const a = player();
    await a.register('Two_Faces', 'first-secret-word');
    const b = player();
    b.token = (await b.ok('POST', '/auth/login', { username: 'Two_Faces', password: 'first-secret-word' })).token;
    const list = (await a.ok('GET', '/auth/sessions')).sessions;
    expect(list).toHaveLength(2);
    expect(list.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    expect((await a.ok('POST', '/auth/sessions/revoke-others')).revoked).toBe(1);
    expect((await b.ok('GET', '/auth/me')).account).toBeNull();
    b.token = (await b.ok('POST', '/auth/login', { username: 'Two_Faces', password: 'first-secret-word' })).token;
    expect((await a.call('POST', '/auth/password', { current: 'nope-nope-nope', next: 'second-secret-word' })).status).toBe(401);
    await a.ok('POST', '/auth/password', { current: 'first-secret-word', next: 'second-secret-word' });
    expect((await b.ok('GET', '/auth/me')).account).toBeNull();
    expect((await a.ok('GET', '/auth/me')).account.username).toBe('Two_Faces');
    expect((await player().call('POST', '/auth/login', { username: 'Two_Faces', password: 'first-secret-word' })).status).toBe(401);
  });

  it('updates the profile and saves, edits, validates and deletes builds per account', async () => {
    const a = player();
    await a.register('Builder', 'stone-upon-stone');
    const acc = (await a.ok('PUT', '/account', { displayName: 'Master Builder', motto: '  one\u0000 stone ', favoriteClass: 'vanguard' })).account;
    expect(acc).toMatchObject({ displayName: 'Master Builder', motto: 'one stone', favoriteClass: 'vanguard' });
    expect((await a.call('PUT', '/account', { favoriteClass: 'not_a_class' })).status).toBe(400);
    expect((await player().call('GET', '/builds')).status).toBe(401);
    const { NODES, CLASSES } = await import('@cursebound/content');
    const cls = CLASSES[0]!;
    const node = NODES.find((x) => x.classId === cls.id && !x.starting)!;
    const other = NODES.find((x) => x.classId !== cls.id)!;
    const saved = (await a.ok('POST', '/builds', { name: 'Glass cannon', classId: cls.id, ranks: { [node.id]: 1 }, notes: 'all in' })).build;
    expect(saved).toMatchObject({ name: 'Glass cannon', classId: cls.id, ranks: { [node.id]: 1 }, notes: 'all in' });
    expect((await a.call('POST', '/builds', { name: 'Bad', classId: cls.id, ranks: { [other.id]: 1 } })).status).toBe(400);
    const edited = (await a.ok('PUT', `/builds/${saved.id}`, { name: 'Glass cannon II' })).build;
    expect(edited).toMatchObject({ id: saved.id, name: 'Glass cannon II', ranks: { [node.id]: 1 } });
    const b = player();
    await b.register('Thief', 'sticky-fingers-9');
    expect((await b.ok('GET', '/builds')).builds).toHaveLength(0);
    expect((await b.call('PUT', `/builds/${saved.id}`, { name: 'mine now' })).status).toBe(404);
    expect((await b.call('DELETE', `/builds/${saved.id}`)).status).toBe(404);
    expect((await a.ok('GET', '/builds')).max).toBe(60);
    await a.ok('DELETE', `/builds/${saved.id}`);
    expect((await a.ok('GET', '/builds')).builds).toHaveLength(0);
  });

  it('replays an idempotent mutation instead of saving twice', async () => {
    const a = player();
    await a.register('Retrier', 'again-and-again-1');
    const body = { name: 'Once', classId: 'vanguard', ranks: {} };
    const r1 = await a.call('POST', '/builds', body, { 'idempotency-key': 'k-1' });
    const r2 = await a.call('POST', '/builds', body, { 'idempotency-key': 'k-1' });
    expect(r2.body.build.id).toBe(r1.body.build.id);
    expect((await a.ok('GET', '/builds')).builds).toHaveLength(1);
  });

  it('runs the friend lifecycle, notifies presence and authenticates presence tokens', async () => {
    const a = player();
    const b = player();
    const c = player();
    const A = await a.register('Friend_A', 'hand-in-hand-1');
    const B = await b.register('Friend_B', 'hand-in-hand-2');
    const C = await c.register('Friend_C', 'hand-in-hand-3');
    pushed.length = 0;
    expect((await a.ok('POST', '/friends', { username: 'friend_b' })).state).toBe('outgoing');
    expect(pushed.sort()).toEqual([A.id, B.id].sort());
    expect((await b.ok('GET', '/friends')).friends).toMatchObject([{ username: 'Friend_A', state: 'incoming' }]);
    expect((await a.call('POST', `/friends/${B.id}/accept`)).status).toBe(404);
    pushed.length = 0;
    await b.ok('POST', `/friends/${A.id}/accept`);
    expect(pushed.sort()).toEqual([A.id, B.id].sort());
    expect((await a.ok('GET', '/friends')).friends).toMatchObject([{ username: 'Friend_B', state: 'friends', accountId: B.id }]);
    expect((await a.call('POST', '/friends', { username: 'Nobody_Real' })).status).toBe(404);
    expect((await a.call('POST', '/friends', { username: 'Friend_A' })).status).toBe(400);
    await c.ok('POST', '/friends', { username: 'Friend_A' });
    expect((await a.ok('POST', '/friends', { username: 'Friend_C' })).state).toBe('friends');

    // presence deps: bearer → identity, accepted friends only
    expect(deps).not.toBeNull();
    expect(await deps!.authenticate(a.token!)).toEqual({ accountId: A.id, username: 'Friend_A', displayName: 'Friend_A', favoriteClass: null });
    expect(await deps!.authenticate('not-a-real-token-at-all-xxxxxxxx')).toBeNull();
    expect((await deps!.friendIds(A.id)).sort()).toEqual([B.id, C.id].sort());

    pushed.length = 0;
    await a.ok('DELETE', `/friends/${B.id}`);
    expect(pushed.sort()).toEqual([A.id, B.id].sort());
    expect((await b.ok('GET', '/friends')).friends).toHaveLength(0);
    expect(await deps!.friendIds(B.id)).toEqual([]);
    const card = await a.ok('GET', '/players/Friend_C');
    expect(card).toMatchObject({ player: { username: 'Friend_C' }, relation: 'friends', stats: { runs: 0 }, recentRuns: [] });
  });

  it('accepts run summaries from participants, dedupes them and scopes boards to friends and self', async () => {
    const host = player();
    const guest = player();
    const friend = player();
    const stranger = player();
    const H = await host.register('Host_Hana', 'lead-the-way-11');
    const G = await guest.register('Guest_Gus', 'follow-along-22');
    await friend.register('Pal_Pia', 'cheer-them-on-3');
    await stranger.register('Odd_Otto', 'who-are-you-44');
    await friend.ok('POST', '/friends', { username: 'Host_Hana' });
    await host.ok('POST', '/friends', { username: 'Pal_Pia' });

    // only a listed participant can submit; other accounts in the list are not trusted
    const parts = [{ accountId: H.id, name: 'Hana', classId: 'vanguard' }, { accountId: G.id, name: 'Gus', classId: 'arcanist' }];
    expect((await stranger.call('POST', '/runs', runBody('run_one', '5000', parts))).status).toBe(403);
    expect((await player().call('POST', '/runs', runBody('run_one', '5000', parts))).status).toBe(401);
    const first = await host.ok('POST', '/runs', runBody('run_one', '5000', parts));
    expect(first).toMatchObject({ ok: true, existing: false, rank: 1, trust: 'client-reported' });
    expect((await host.ok('POST', '/runs', runBody('run_one', '5000', parts))).existing).toBe(true);
    let board = await stranger.ok('GET', `/boards?key=${encodeURIComponent(KEY)}`);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]).toMatchObject({ rank: 1, runId: 'run_one', scoreText: '5000', depth: 4, trust: 'client-reported', accounts: ['Host_Hana'], participants: [{ name: 'Hana', classId: 'vanguard' }, { name: 'Gus', classId: 'arcanist' }] });
    // the guest reports the same run: it claims only its own slot, no duplicate row
    expect((await guest.ok('POST', '/runs', runBody('run_one', '5000', [{ accountId: null, name: 'Hana', classId: 'vanguard' }, { accountId: G.id, name: 'Gus', classId: 'arcanist' }]))).existing).toBe(true);
    board = await stranger.ok('GET', `/boards?key=${encodeURIComponent(KEY)}`);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].accounts).toEqual(['Host_Hana', 'Guest_Gus']);

    // more runs for ranking, pagination and scopes
    await guest.ok('POST', '/runs', runBody('run_two', '90000', [{ accountId: G.id, name: 'Gus', classId: 'arcanist' }, { accountId: null, name: 'Bot', classId: 'vanguard' }]));
    const O = (await stranger.ok('GET', '/auth/me')).account;
    expect((await stranger.ok('POST', '/runs', runBody('run_three', '700', [{ accountId: O.id, name: 'Otto', classId: 'vanguard' }]))).rank).toBe(3);
    const practice = await host.ok('POST', '/runs', runBody('run_practice', '999999', [{ accountId: H.id, name: 'Hana', classId: 'vanguard' }], { practice: true }));
    expect(practice.rank).toBeNull();

    const all = await stranger.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&limit=2`);
    expect(all.rows.map((r: { runId: string; rank: number }) => [r.runId, r.rank])).toEqual([['run_two', 1], ['run_one', 2]]);
    expect(all.nextCursor).toBeTruthy();
    const page2 = await stranger.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&limit=2&cursor=${all.nextCursor}`);
    expect(page2.rows.map((r: { runId: string; rank: number }) => [r.runId, r.rank])).toEqual([['run_three', 3]]);
    expect(page2.nextCursor).toBeNull();
    expect((await stranger.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&practice=1`)).rows[0].runId).toBe('run_practice');
    expect((await stranger.call('GET', `/boards?key=${encodeURIComponent(KEY)}&cursor=garbage!`)).status).toBe(400);

    expect((await player().call('GET', `/boards?key=${encodeURIComponent(KEY)}&scope=friends`)).status).toBe(401);
    const friends = await friend.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&scope=friends`);
    expect(friends.rows.map((r: { runId: string }) => r.runId)).toEqual(['run_one']);
    expect((await friend.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&scope=mine`)).rows).toHaveLength(0);
    expect((await guest.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&scope=mine`)).rows.map((r: { runId: string }) => r.runId)).toEqual(['run_two', 'run_one']);
    const keys = await stranger.ok('GET', '/boards/keys');
    expect(keys.keys).toEqual([{ boardKey: KEY, count: 4 }]);
    expect(keys.current).toMatchObject({ contentHash: expect.any(String) });

    // stats and run history aggregate the submitted summaries
    const stats = (await guest.ok('GET', '/account/stats')).stats;
    expect(stats).toMatchObject({ runs: 2, finished: 2, bestScoreText: '90000', bestRunId: 'run_two', deepestRound: 5, coopRuns: 2, totalActiveTicks: 18000 });
    expect(stats.byClass).toEqual([{ classId: 'arcanist', runs: 2, bestScoreText: '90000' }]);
    const runs = (await guest.ok('GET', '/account/runs?limit=10')).runs;
    expect(runs.map((r: { id: string }) => r.id).sort()).toEqual(['run_one', 'run_two']);
    expect(runs[0]).toMatchObject({ status: 'finalized', mode: 'coop', n: 2 });
    expect((await guest.ok('GET', '/account/runs?status=active')).runs).toEqual([]);
    expect((await stranger.ok('GET', '/players/Guest_Gus')).recentRuns).toHaveLength(2);

    // unfinished runs are not accepted
    expect((await host.call('POST', '/runs', { ...runBody('run_bad', '1', parts), summary: { endReason: 'invalidated' } })).status).toBe(400);
    expect((await host.call('POST', '/runs', { ...runBody('run_bad', '01', parts) })).status).toBe(400);
  });

  it('saves a build from a run: summary in the body, or a submitted run by id', async () => {
    const a = player();
    const A = await a.register('Saver_Sam', 'keep-it-safe-55');
    const { NODES } = await import('@cursebound/content');
    const node = NODES.find((x) => x.classId === 'vanguard' && !x.starting)!;
    const summary = { runId: 'run_save', round: 7, players: [{ slot: 0, classId: 'arcanist', ranks: {} }, { slot: 1, classId: 'vanguard', ranks: { [node.id]: 1 }, mastery: { damage: 2, health: 1, regen: 0 }, accountId: A.id }] };
    const b1 = (await a.ok('POST', '/builds/from-run', { summary })).build;
    expect(b1).toMatchObject({ classId: 'vanguard', ranks: { [node.id]: 1 }, sourceRunId: 'run_save', name: 'Vanguard · round 7' });
    expect(JSON.parse(b1.mastery)).toEqual({ damage: 2, health: 1, regen: 0 });
    expect((await a.call('POST', '/builds/from-run', { summary: { runId: 'x', players: [{ slot: 0, classId: 'vanguard', ranks: {} }, { slot: 1, classId: 'vanguard', ranks: {} }] } })).status).toBe(404);
    expect((await a.ok('POST', '/builds/from-run', { name: 'Solo pick', summary: { runId: 'run_solo', round: 2, players: [{ slot: 0, classId: 'vanguard', ranks: {} }] } })).build.name).toBe('Solo pick');

    await a.ok('POST', '/runs', runBody('run_saved', '42', [{ accountId: null, name: 'Other', classId: 'arcanist' }, { accountId: A.id, name: 'Sam', classId: 'vanguard' }]));
    const b2 = (await a.ok('POST', '/builds/from-run', { runId: 'run_saved' })).build;
    expect(b2).toMatchObject({ classId: 'vanguard', sourceRunId: 'run_saved' });
    expect((await player().call('POST', '/builds/from-run', { runId: 'run_saved' })).status).toBe(401);
    const c = player();
    await c.register('Not_Sam', 'not-my-run-666');
    expect((await c.call('POST', '/builds/from-run', { runId: 'run_saved' })).status).toBe(404);
  });

  it('deletes an account (password-confirmed): sessions end, runs stay as guests, friends are told', async () => {
    const a = player();
    const b = player();
    const A = await a.register('Short_Lived', 'mayfly-wings-01');
    const B = await b.register('Mourner', 'black-veil-02');
    await a.ok('POST', '/friends', { username: 'Mourner' });
    await b.ok('POST', `/friends/${A.id}/accept`);
    await a.ok('POST', '/runs', runBody('run_mayfly', '1234', [{ accountId: A.id, name: 'Fly', classId: 'vanguard' }]));
    expect((await a.call('POST', '/account/delete', { password: 'wrong-one-here' })).status).toBe(401);
    pushed.length = 0;
    await a.ok('POST', '/account/delete', { password: 'mayfly-wings-01' });
    expect(pushed).toEqual([B.id]);
    expect((await a.ok('GET', '/auth/me')).account).toBeNull();
    expect((await b.ok('GET', '/friends')).friends).toHaveLength(0);
    const row = (await b.ok('GET', `/boards?key=${encodeURIComponent(KEY)}&limit=100`)).rows.find((r: { runId: string }) => r.runId === 'run_mayfly');
    expect(row).toMatchObject({ accounts: [], participants: [{ name: 'Fly', classId: 'vanguard' }] });
    await player().register('Short_Lived', 'mayfly-wings-02');
  });

  it('answers CORS for loopback desktop origins and configured origins only', async () => {
    const pre = (origin: string) => fetch(`${base}/api/v1/auth/login`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
    for (const origin of ['http://127.0.0.1:61234', 'http://localhost:3000', 'https://play.cursebound.example']) {
      const r = await pre(origin);
      expect(r.status).toBe(204);
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
      expect(r.headers.get('access-control-allow-headers')).toMatch(/authorization/);
      expect(r.headers.get('access-control-allow-credentials')).toBeNull();
    }
    for (const origin of ['https://evil.example', 'http://127.0.0.1.evil.example', 'https://localhost:3000', 'null']) {
      const r = await pre(origin);
      expect(r.status).toBe(403);
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
    }
    const blocked = await new Player(base, 'https://evil.example').call('GET', '/healthz');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('UNAUTHORIZED');
    // non-browser clients send no Origin
    expect((await fetch(`${base}/api/v1/healthz`)).status).toBe(200);
    const simple = await player().call('GET', '/healthz');
    expect(simple.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:51234');
    expect(simple.headers.get('access-control-expose-headers')).toMatch(/x-request-id/);
  });
});

describe('TURN credentials and per-address limits', () => {
  let srv: CloudServer;
  let base: string;
  beforeAll(async () => {
    srv = await boot({ TURN_SECRET: 'coturn-shared-secret', TURN_HOST: 'turn.cursebound.example', RATE_PER_MINUTE: '12', TRUST_PROXY_HOPS: '1', MIN_CLIENT_BUILD: 'b-100' });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => { await srv?.close(); });

  it('issues coturn use-auth-secret credentials for the signed-in account', async () => {
    const p = new Player(base);
    expect((await p.call('GET', '/turn', undefined, { 'x-forwarded-for': '203.0.113.1' })).status).toBe(401);
    const acc = await p.register('Relay_Rex', 'through-the-wire-7');
    const before = Math.floor(Date.now() / 1000);
    const r = await p.ok('GET', '/turn');
    expect(r.ttl).toBe(21600);
    expect(r.iceServers[0]).toEqual({ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] });
    const turn = r.iceServers[1];
    expect(turn.urls).toEqual(['turn:turn.cursebound.example:3478?transport=udp', 'turn:turn.cursebound.example:3478?transport=tcp']);
    const [expiry, who] = turn.username.split(':');
    expect(who).toBe(acc.id);
    expect(Number(expiry)).toBeGreaterThanOrEqual(before + 21600);
    expect(Number(expiry)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 21600);
    expect(turn.credential).toBe(crypto.createHmac('sha1', 'coturn-shared-secret').update(turn.username).digest('base64'));
    expect((await p.ok('GET', '/healthz')).minClientBuild).toBe('b-100');
  });

  it('throttles per client address using the right-most X-Forwarded-For hop', async () => {
    const hit = (xff: string) => fetch(`${base}/api/v1/healthz`, { headers: { 'x-forwarded-for': xff } }).then((r) => r.status);
    const statuses: number[] = [];
    // a spoofed left-most entry does not change the key: the front end's appended address is what counts
    for (let i = 0; i < 14; i++) statuses.push(await hit(`10.0.0.${i}, 198.51.100.7`));
    expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(12)).toEqual([429, 429]);
    expect(await hit('198.51.100.8')).toBe(200);
  });
});

describe('request helpers', () => {
  const req = (remote: string, xff?: string) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as unknown as IncomingMessage;
  it('reads the client address only from trusted proxy hops', () => {
    expect(clientAddress({ trustProxyHops: 0 }, req('10.1.1.1', '1.2.3.4'))).toBe('10.1.1.1');
    expect(clientAddress({ trustProxyHops: 1 }, req('10.1.1.1', '6.6.6.6, 1.2.3.4'))).toBe('1.2.3.4');
    expect(clientAddress({ trustProxyHops: 2 }, req('10.1.1.1', '6.6.6.6, 1.2.3.4, 35.1.1.1'))).toBe('1.2.3.4');
    expect(clientAddress({ trustProxyHops: 1 }, req('10.1.1.1'))).toBe('10.1.1.1');
  });
  it('allows loopback origins on any port and exact configured origins', () => {
    const cfg = { corsOrigins: ['https://play.cursebound.example'] };
    expect(originAllowed(cfg, 'http://127.0.0.1:49152')).toBe(true);
    expect(originAllowed(cfg, 'http://localhost')).toBe(true);
    expect(originAllowed(cfg, 'https://play.cursebound.example')).toBe(true);
    expect(originAllowed(cfg, 'https://play.cursebound.example.evil')).toBe(false);
    expect(originAllowed(cfg, 'http://localhost.evil:80')).toBe(false);
  });
});
