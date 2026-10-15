import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOUNTY_BY_ID, BOUNTY_MODIFIERS, BOUNTY_PERIOD_MS, totalXpForLevel, xpForRun } from '@cursebound/content';
import { CloudBountyJob } from '../src/bounty';
import { migrate } from '../src/migrations';
import { startCloud, type CloudServer } from '../src/server';
import { openPglite, type Sql } from '../src/sql';
import { PgAccountStore } from '../src/store';

// The cloud's player progression and daily bounty: the polled bounty job (rolls after 24 h, never repeats, never
// double-rolls, lazy check on read), XP credited from submitted runs, and the bounty's double XP on the first run only.

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ENV = { PORT: '0', HOST: '127.0.0.1', REGISTER_PER_HOUR: '1000', RATE_PER_MINUTE: '100000' };

describe('cloud bounty job', () => {
  let sql: Sql;
  let store: PgAccountStore;
  beforeAll(async () => { sql = await openPglite(); await migrate(sql); store = new PgAccountStore(sql); });
  afterAll(async () => { await sql.close(); });

  it('rolls once, keeps the bounty for 24 h, then rolls a different modifier', async () => {
    let now = 1_700_000_000_000;
    const job = new CloudBountyJob(store, silent, { now: () => now });
    const a = await job.check();
    expect(a.rolled).toBe(true);
    expect(BOUNTY_BY_ID[a.bounty.modifierId]).toBeTruthy();
    expect(a.bounty.expiresAt).toBe(now + BOUNTY_PERIOD_MS);
    now += BOUNTY_PERIOD_MS - 1;
    expect(await job.check()).toEqual({ bounty: a.bounty, rolled: false });
    now += 1;
    const b = await job.check();
    expect(b.rolled).toBe(true);
    expect(b.bounty.modifierId).not.toBe(a.bounty.modifierId);
    const rows = await sql.query('SELECT count(*) AS c FROM daily_bounties');
    expect(Number(rows.rows[0]!.c)).toBe(2);
  });

  it('never repeats the previous modifier, even when the shuffle puts it first', async () => {
    let now = 1_800_000_000_000;
    const job = new CloudBountyJob(store, silent, { now: () => now, random: () => 0.9999999 });   // identity shuffle
    let prev = (await job.check()).bounty.modifierId;
    for (let i = 0; i < 8; i++) {
      now += BOUNTY_PERIOD_MS + 1000;
      const b = (await job.check()).bounty;
      expect(b.modifierId).not.toBe(prev);
      prev = b.modifierId;
    }
    expect([BOUNTY_MODIFIERS[0].id, BOUNTY_MODIFIERS[1].id]).toContain(prev);
  });

  it('concurrent checks (the job and lazy reads on two instances) roll exactly once', async () => {
    let now = 1_900_000_000_000;
    const one = new CloudBountyJob(store, silent, { now: () => now });
    const two = new CloudBountyJob(new PgAccountStore(sql), silent, { now: () => now });
    await one.check();
    now += BOUNTY_PERIOD_MS;
    const results = await Promise.all([one.check(), two.check(), one.check(), two.check(), one.check(), two.check()]);
    expect(results.filter((r) => r.rolled)).toHaveLength(1);
    expect(new Set(results.map((r) => r.bounty.id)).size).toBe(1);
  });

  it('the polled job checks on start and on its interval, and stops', async () => {
    let now = 2_000_000_000_000;
    const job = new CloudBountyJob(store, silent, { now: () => now, pollMs: 10 });
    job.start();
    await new Promise((r) => setTimeout(r, 40));
    const first = (await store.ensureBounty({ now, periodMs: BOUNTY_PERIOD_MS, candidates: ['ironhide', 'barren'] }));
    expect(first.rolled).toBe(false);   // the job's start-up check already rolled for this clock
    now += BOUNTY_PERIOD_MS;
    await new Promise((r) => setTimeout(r, 60));
    job.stop();
    const after = await store.ensureBounty({ now, periodMs: BOUNTY_PERIOD_MS, candidates: ['ironhide', 'barren'] });
    expect(after.rolled).toBe(false);   // rolled by the interval, not by this check
    expect(after.bounty.id).not.toBe(first.bounty.id);
  });
});

describe('cloud progression over HTTP', () => {
  let srv: CloudServer;
  let base: string;
  let now = 2_100_000_000_000;
  beforeAll(async () => {
    srv = await startCloud({ env: ENV, sql: await openPglite(), log: silent, bounty: { now: () => now } });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => { await srv?.close(); });

  const client = () => {
    let token: string | null = null;
    const call = async <T = any>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> => {
      const h: Record<string, string> = { 'content-type': 'application/json', origin: 'http://127.0.0.1:5000' };
      if (token) h.authorization = `Bearer ${token}`;
      const r = await fetch(`${base}/api/v1${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as T };
    };
    return {
      call,
      async register(username: string) {
        const r = await call('POST', '/auth/register', { username, password: 'correct horse battery 9' });
        token = r.body.token;
        return r.body.account as { id: string };
      },
    };
  };
  const run = (runId: string, accountId: string, extra: Record<string, unknown> = {}) => ({
    runId, boardKey: 'k|n1|solo', scoreText: '2500', depth: 4, activeTicks: 900, mode: 'solo', n: 1, challengeId: null, practice: false,
    participants: [{ accountId, name: 'Me', classId: 'vanguard' }], summary: { runId, round: 5, endReason: 'wipe', players: [] }, ...extra,
  });

  it('serves the current bounty to anyone, with completion only for a signed-in caller', async () => {
    const anon = await client().call('GET', '/bounty');
    expect(anon.status).toBe(200);
    expect(anon.body.bounty).toMatchObject({ completed: null, xpMultiplier: 2, serverNow: now });
    expect(BOUNTY_BY_ID[anon.body.bounty.modifier.id]).toBeTruthy();
    const c = client();
    await c.register('bounty_reader');
    expect((await c.call('GET', '/bounty')).body.bounty).toMatchObject({ id: anon.body.bounty.id, completed: false });
  });

  it('rerolls lazily on read once the bounty is a day old (Cloud Run scaled to zero: no job ran)', async () => {
    srv.bounties.stop();
    const before = (await client().call('GET', '/bounty')).body.bounty;
    now += BOUNTY_PERIOD_MS + 1;
    const after = (await client().call('GET', '/bounty')).body.bounty;
    expect(after.id).not.toBe(before.id);
    expect(after.modifier.id).not.toBe(before.modifier.id);
    expect(after.createdAt).toBe(now);
    expect((await client().call('GET', '/bounty')).body.bounty.id).toBe(after.id);
  });

  it('credits XP from submitted runs once, and reports progress', async () => {
    const c = client();
    const me = await c.register('xp_earner');
    expect((await c.call('GET', '/account/progress')).body).toMatchObject({ level: 1, xp: 0, xpForNext: 80, nextUnlock: { classId: 'duelist', level: 3 } });
    expect((await client().call('GET', '/account/progress')).status).toBe(401);
    const base = xpForRun({ scoreText: '2500', depth: 4 });
    const r = await c.call('POST', '/runs', run('run_xp1', me.id));
    expect(r.status).toBe(200);
    expect(r.body.xp).toMatchObject({ xp: base, baseXp: base, bounty: false, xpBefore: 0, levelBefore: 1 });
    const again = await c.call('POST', '/runs', run('run_xp1', me.id));
    expect(again.body.xp).toMatchObject({ xp: base, xpBefore: 0 });   // the same award, not a second one
    const p = (await c.call('GET', '/account/progress')).body;
    expect(p.xp).toBe(base);
    expect(p.level).toBe(base >= totalXpForLevel(2) ? 2 : 1);
  });

  it('a run with the current bounty completes it and doubles only the first run', async () => {
    const c = client();
    const me = await c.register('bounty_taker');
    const b = (await c.call('GET', '/bounty')).body.bounty;
    const bounty = { id: b.id, modifierId: b.modifier.id };
    const base = xpForRun({ scoreText: '2500', depth: 4 });
    // a run that cleared no round does not complete the bounty
    const early = await c.call('POST', '/runs', run('run_b0', me.id, { bounty, depth: 0, scoreText: '50' }));
    expect(early.body.xp.bounty).toBe(false);
    expect((await c.call('GET', '/bounty')).body.bounty.completed).toBe(false);
    const first = await c.call('POST', '/runs', run('run_b1', me.id, { bounty }));
    expect(first.body.xp).toMatchObject({ xp: base * 2, baseXp: base, bounty: true });
    expect((await c.call('GET', '/bounty')).body.bounty.completed).toBe(true);
    const second = await c.call('POST', '/runs', run('run_b2', me.id, { bounty }));
    expect(second.body.xp).toMatchObject({ xp: base, bounty: false });
    // a forged or mismatched bounty never doubles, an unknown modifier is rejected
    const other = client();
    const you = await other.register('bounty_forger');
    expect((await other.call('POST', '/runs', run('run_f1', you.id, { bounty: { id: b.id, modifierId: b.modifier.id === 'barren' ? 'ironhide' : 'barren' } }))).body.xp.bounty).toBe(false);
    expect((await other.call('POST', '/runs', run('run_f2', you.id, { bounty: { id: 'bty_nope', modifierId: 'barren' } }))).body.xp.bounty).toBe(false);
    expect((await other.call('POST', '/runs', run('run_f3', you.id, { bounty: { id: b.id, modifierId: 'nope' } }))).status).toBe(400);
  });

  it('a bounty run reported after the reroll still counts within the grace period, not after it', async () => {
    const c = client();
    const me = await c.register('late_reporter');
    const b = (await c.call('GET', '/bounty')).body.bounty;
    const bounty = { id: b.id, modifierId: b.modifier.id };
    now = b.expiresAt + 60_000;   // rerolled meanwhile
    expect((await c.call('POST', '/runs', run('run_late1', me.id, { bounty }))).body.xp.bounty).toBe(true);
    const d = client();
    const you = await d.register('very_late');
    now = b.expiresAt + 7 * 3600 * 1000;
    expect((await d.call('POST', '/runs', run('run_late2', you.id, { bounty }))).body.xp.bounty).toBe(false);
  });

  it('guests in a co-op run each earn their own XP when they report', async () => {
    const host = client(), guest = client();
    const h = await host.register('coop_host'), g = await guest.register('coop_guest');
    const body = (accountSlot: number, accountId: string) => ({
      ...run('run_coop', accountId), n: 2, mode: 'coop',
      participants: [{ accountId: accountSlot === 0 ? accountId : null, name: 'H', classId: 'vanguard' }, { accountId: accountSlot === 1 ? accountId : null, name: 'G', classId: 'ranger' }],
    });
    const base = xpForRun({ scoreText: '2500', depth: 4 });
    expect((await host.call('POST', '/runs', body(0, h.id))).body.xp.xp).toBe(base);
    expect((await guest.call('POST', '/runs', body(1, g.id))).body.xp.xp).toBe(base);
    expect((await guest.call('GET', '/account/progress')).body.xp).toBe(base);
  });
});
