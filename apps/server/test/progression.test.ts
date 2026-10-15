import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOUNTY_BY_ID, BOUNTY_MODIFIERS, BOUNTY_PERIOD_MS, RULES_VERSION, contentHash, totalXpForLevel, xpForRun } from '@cursebound/content';
import { startServer } from '../src/main';
import { BountyService } from '../src/bounty';
import { createLogger } from '../src/persistence/logger';
import { openStore, type StoreHandle } from '../src/persistence/store';

// Player progression and the daily bounty on the local authority: the local bounty job (polled + lazy, never a repeat,
// never a double roll), XP credited at finalization (doubled once per bounty), and the class gate on seats.

const CONTENT = { hash: contentHash(), rulesVersion: RULES_VERSION, manifestPath: 'packages/content' };

describe('local bounty job', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-bounty-'));
  let store: StoreHandle;
  const log = createLogger({ dataDir: dir, build: 'test' });
  beforeAll(async () => { store = await openStore({ dataDir: dir }); });
  afterAll(async () => { await store.close(); await log.close(); });

  it('rolls the first bounty, keeps it for 24 h, then rerolls a different modifier', async () => {
    let now = 1_700_000_000_000;
    const svc = new BountyService(store, log, { now: () => now });
    const first = await svc.check();
    expect(first.rolled).toBe(true);
    expect(BOUNTY_BY_ID[first.bounty.modifierId]).toBeTruthy();
    expect(first.bounty.expiresAt - first.bounty.createdAt).toBe(BOUNTY_PERIOD_MS);
    now += BOUNTY_PERIOD_MS - 1;
    const same = await svc.check();
    expect(same).toEqual({ bounty: first.bounty, rolled: false });
    now += 1;
    const next = await svc.check();
    expect(next.rolled).toBe(true);
    expect(next.bounty.id).not.toBe(first.bounty.id);
    expect(next.bounty.modifierId).not.toBe(first.bounty.modifierId);
  });

  it('never repeats the previous modifier, even when the shuffle puts it first', async () => {
    let now = 1_800_000_000_000;
    // random() = 0.999…: Fisher-Yates swaps nothing, so the candidate order is the content order every time
    const svc = new BountyService(store, log, { now: () => now, random: () => 0.9999999 });
    let prev = (await svc.check()).bounty.modifierId;
    for (let i = 0; i < 6; i++) {
      now += BOUNTY_PERIOD_MS;
      const b = (await svc.check()).bounty;
      expect(b.modifierId).not.toBe(prev);
      prev = b.modifierId;
    }
    expect([BOUNTY_MODIFIERS[0].id, BOUNTY_MODIFIERS[1].id]).toContain(prev);
  });

  it('two concurrent checks never double-roll', async () => {
    let now = 1_900_000_000_000;
    const a = new BountyService(store, log, { now: () => now });
    const b = new BountyService(store, log, { now: () => now });
    await a.check();
    now += BOUNTY_PERIOD_MS + 5;
    const results = await Promise.all([a.check(), b.check(), a.check(), b.check(), a.current(), b.current()].map((p) => Promise.resolve(p)));
    const rolled = results.filter((r) => typeof r === 'object' && 'rolled' in r && r.rolled);
    expect(rolled).toHaveLength(1);
    const ids = new Set(results.map((r) => ('bounty' in r ? r.bounty.id : r.id)));
    expect(ids.size).toBe(1);
  });

  it('the polled job starts, rolls when due and stops', async () => {
    let now = 2_000_000_000_000;
    const svc = new BountyService(store, log, { now: () => now, pollMs: 10 });
    svc.start();
    await new Promise((r) => setTimeout(r, 30));
    const before = await store.ensureBounty({ now, periodMs: BOUNTY_PERIOD_MS, candidates: ['ironhide', 'barren'] });
    expect(before.rolled).toBe(false);
    now += BOUNTY_PERIOD_MS;
    await new Promise((r) => setTimeout(r, 40));
    svc.stop();
    const after = await store.ensureBounty({ now, periodMs: BOUNTY_PERIOD_MS, candidates: ['ironhide', 'barren'] });
    expect(after.rolled).toBe(false);   // the job already rolled this period
    expect(after.bounty.id).not.toBe(before.bounty.id);
  });
});

describe('XP awards at finalization', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-xp-'));
  let store: StoreHandle;
  beforeAll(async () => { store = await openStore({ dataDir: dir }); await store.ensureContentVersion(CONTENT); });
  afterAll(async () => { await store.close(); });

  async function finishRun(runId: string, profileIds: string[], o: { bountyId?: string | null; eligible?: boolean; status?: 'finalized' | 'aborted' } = {}) {
    await store.createRun({
      id: runId, seed: 's-' + runId, contentHash: CONTENT.hash, scoreVersion: 'score-1', mode: 'solo', trust: 'local', n: profileIds.length, boardKey: 'b', challengeId: null,
      members: profileIds.map((profileId, slot) => ({ slot, profileId, classId: 'vanguard', buildJson: '{}' })),
    });
    return store.finalizeRun({
      runId, status: o.status ?? 'finalized', endReason: 'wipe', scoreText: '2500', depth: 4, activeTicks: 100, boardKey: 'b', trust: 'local',
      participantsJson: '[]', summaryJson: '{}', practice: false,
      progress: { members: profileIds.map((profileId) => ({ profileId, baseXp: xpForRun({ scoreText: '2500', depth: 4 }) })), bountyId: o.bountyId ?? null, bountyEligible: o.eligible ?? true },
    });
  }

  it('credits each member once per run (idempotent finalize)', async () => {
    const a = await store.createProfile('A'), b = await store.createProfile('B');
    const base = xpForRun({ scoreText: '2500', depth: 4 });
    const r = await finishRun('xp-run-1', [a.id, b.id]);
    expect(r.awards.map((x) => [x.xp, x.bounty])).toEqual([[base, false], [base, false]]);
    const again = await store.finalizeRun({
      runId: 'xp-run-1', status: 'finalized', endReason: 'wipe', scoreText: '2500', depth: 4, activeTicks: 100, boardKey: 'b', trust: 'local',
      participantsJson: '[]', summaryJson: '{}', practice: false, progress: { members: [{ profileId: a.id, baseXp: 999 }], bountyId: null, bountyEligible: false },
    });
    expect(again.existing).toBe(true);
    expect(again.awards.find((x) => x.profileId === a.id)?.xp).toBe(base);
    expect((await store.getProgress(a.id))?.xp).toBe(base);
    expect((await store.getProgress(b.id))?.xp).toBe(base);
  });

  it('doubles only the first bounty completion, and only for eligible runs', async () => {
    const p = await store.createProfile('Bountiful');
    const base = xpForRun({ scoreText: '2500', depth: 4 });
    const early = await finishRun('xp-b0', [p.id], { bountyId: 'bty_x', eligible: false });   // cleared no round: no completion
    expect(early.awards[0]).toMatchObject({ xp: base, bounty: false });
    expect(await store.bountyCompleted('bty_x', p.id)).toBe(false);
    const first = await finishRun('xp-b1', [p.id], { bountyId: 'bty_x' });
    expect(first.awards[0]).toMatchObject({ xp: base * 2, baseXp: base, bounty: true, xpBefore: base });
    expect(await store.bountyCompleted('bty_x', p.id)).toBe(true);
    const second = await finishRun('xp-b2', [p.id], { bountyId: 'bty_x' });
    expect(second.awards[0]).toMatchObject({ xp: base, bounty: false });
    const nextDay = await finishRun('xp-b3', [p.id], { bountyId: 'bty_y' });
    expect(nextDay.awards[0]).toMatchObject({ xp: base * 2, bounty: true });
    expect((await store.getProgress(p.id))?.xp).toBe(base * 6);
  });

  it('aborted runs earn nothing', async () => {
    const p = await store.createProfile('Unlucky');
    const r = await finishRun('xp-ab', [p.id], { status: 'aborted' });
    expect(r.awards).toEqual([]);
    expect((await store.getProgress(p.id))?.xp).toBe(0);
  });
});

describe('class gate and bounty rooms (HTTP)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-gate-'));
  const port = 27100 + Math.floor(Math.random() * 300);
  let srv: Awaited<ReturnType<typeof startServer>>;
  const call = async <T = any>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as T };
  };
  beforeAll(async () => {
    srv = await startServer({ ...process.env, CURSEBOUND_PORT: String(port), CURSEBOUND_DATA_DIR: dataDir });
    srv.rooms.stop();
  });
  afterAll(async () => { await srv?.shutdown(); });

  it('serves progress for a fresh profile: level 1, the starter five', async () => {
    const p = (await call('POST', '/local/profiles', { displayName: 'Fresh' })).body;
    const pr = (await call('GET', `/local/profiles/${p.id}/progress`)).body;
    expect(pr).toMatchObject({ level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 80, nextUnlock: { classId: 'duelist', level: 3 } });
    expect(pr.unlockedClasses.sort()).toEqual(['arcanist', 'berserker', 'cryomancer', 'ranger', 'vanguard']);
    expect((await call('GET', '/local/profiles/nope/progress')).status).toBe(404);
  });

  it('refuses a locked class when seating a low-level local profile, in rooms, joins and the lobby', async () => {
    const p = (await call('POST', '/local/profiles', { displayName: 'Novice' })).body;
    const locked = await call('POST', '/rooms', { profileId: p.id, mode: 'coop', classId: 'duelist' });
    expect(locked.status).toBe(403);
    expect(locked.body.error).toMatchObject({ code: 'CLASS_LOCKED', message: 'Duelist unlocks at level 3' });
    const ok = await call('POST', '/rooms', { profileId: p.id, mode: 'coop', classId: 'vanguard' });
    expect(ok.status).toBe(200);
    const q = (await call('POST', '/local/profiles', { displayName: 'Joiner' })).body;
    const join = await call('POST', `/rooms/${ok.body.code}/join`, { profileId: q.id, classId: 'warden' });
    expect(join.status).toBe(403);
    expect(join.body.error.code).toBe('CLASS_LOCKED');
    // the lobby class switch is refused too: the seat keeps its class
    const room = srv.rooms.byCode(ok.body.code)!;
    await room.handle(room.seats[0], { t: 'LOBBY', classId: 'templar' });
    expect(room.seats[0].classId).toBe('vanguard');
    await room.handle(room.seats[0], { t: 'LOBBY', classId: 'ranger' });
    expect(room.seats[0].classId).toBe('ranger');
  });

  it('unlocks with level: XP from finished runs, or the cloud XP a linked profile synced', async () => {
    const p = (await call('POST', '/local/profiles', { displayName: 'Veteran' })).body;
    await srv.store.createRun({ id: 'gate-run', seed: 's', contentHash: CONTENT.hash, scoreVersion: 'score-1', mode: 'solo', trust: 'local', n: 1, boardKey: 'b', challengeId: null, members: [{ slot: 0, profileId: p.id, classId: 'vanguard', buildJson: '{}' }] });
    await srv.store.finalizeRun({ runId: 'gate-run', status: 'finalized', endReason: 'wipe', scoreText: '1', depth: 0, activeTicks: 1, boardKey: 'b', trust: 'local', participantsJson: '[]', summaryJson: '{}', practice: false, progress: { members: [{ profileId: p.id, baseXp: totalXpForLevel(3) }], bountyId: null, bountyEligible: false } });
    expect((await call('GET', `/local/profiles/${p.id}/progress`)).body.level).toBe(3);
    expect((await call('POST', '/rooms', { profileId: p.id, mode: 'solo', classId: 'duelist' })).status).toBe(200);
    expect((await call('POST', '/rooms', { profileId: p.id, mode: 'solo', classId: 'artificer' })).status).toBe(403);
    // online self: linking with the client's cloud XP lifts the gate to the cloud level (never lowers it)
    const me = (await call('POST', '/local/profiles/link', { accountId: 'acc_Self', displayName: 'Self', cloudXp: totalXpForLevel(10) })).body;
    expect((await call('GET', `/local/profiles/${me.id}/progress`)).body).toMatchObject({ level: 10, cloudXp: totalXpForLevel(10) });
    expect((await call('POST', '/rooms', { profileId: me.id, mode: 'solo', classId: 'templar' })).status).toBe(200);
    expect((await call('POST', '/rooms', { profileId: me.id, mode: 'solo', classId: 'hexbinder' })).status).toBe(403);
    await call('POST', '/local/profiles/link', { accountId: 'acc_Self', displayName: 'Self', cloudXp: 0 });
    expect((await call('GET', `/local/profiles/${me.id}/progress`)).body.level).toBe(10);
  });

  it('a cloud guest linked by the host bridge is gated by their own client, not here', async () => {
    const host = (await call('POST', '/local/profiles', { displayName: 'Host' })).body;
    const room = (await call('POST', '/rooms', { profileId: host.id, mode: 'coop', classId: 'vanguard' })).body;
    const guest = (await call('POST', '/local/profiles/link', { accountId: 'acc_Guest', displayName: 'Guest' })).body;
    const join = await call('POST', `/rooms/${room.code}/join`, { profileId: guest.id, classId: 'warden' });
    expect(join.status).toBe(200);
  });

  it('serves the local bounty lazily, with completion for a profile', async () => {
    const p = (await call('POST', '/local/profiles', { displayName: 'Hunter' })).body;
    const r = (await call('GET', `/local/bounty?profileId=${p.id}`)).body.bounty;
    expect(BOUNTY_BY_ID[r.modifier.id]).toBeTruthy();
    expect(r).toMatchObject({ completed: false, xpMultiplier: 2 });
    expect(r.expiresAt - r.createdAt).toBe(BOUNTY_PERIOD_MS);
    expect(typeof r.serverNow).toBe('number');
    expect((await call('GET', '/local/bounty')).body.bounty.completed).toBeNull();
  });

  it('starts a bounty run with the local modifier, ranks it in its own division and replays it', async () => {
    const p = (await call('POST', '/local/profiles', { displayName: 'Taker' })).body;
    const cur = (await call('GET', '/local/bounty')).body.bounty;
    const res = await call('POST', '/rooms', { profileId: p.id, mode: 'solo', classId: 'arcanist', bounty: true });
    expect(res.status).toBe(200);
    expect(res.body.bounty).toBe(cur.modifier.id);
    const room = srv.rooms.byCode(res.body.code)!;
    expect(room.bounty).toEqual({ id: cur.id, modifierId: cur.modifier.id });
    expect((room.roomView(0) as { bounty?: string }).bounty).toBe(cur.modifier.id);
    await room.startRun();
    const a = room.authority!;
    expect(a.state.bounty).toBe(cur.modifier.id);
    expect(a.boardKey.endsWith(`|bounty:${cur.modifier.id}`)).toBe(true);
    // retire at once and finish: the journal header carries the bounty, so the replay check reproduces the run
    a.submitCommand({ type: 'RETIRE_VOTE', slot: 0, yes: true });
    for (let i = 0; i < 5; i++) a.tick();
    await a.flush();
    for (let i = 0; i < 5; i++) a.tick();
    expect(a.state.phase).toBe('RESULTS');
    const summary = a.summary();
    expect(summary.bounty).toEqual({ id: cur.id, modifierId: cur.modifier.id });
    const verify = await call('POST', `/runs/${a.state.runId}/verify`);
    expect(verify.body.ok).toBe(true);
    // a cloud bounty passed through by an online client: the modifier must be real content
    expect((await call('POST', '/rooms', { profileId: p.id, mode: 'solo', classId: 'arcanist', bounty: { id: 'bty_cloud1', modifierId: 'nope' } })).status).toBe(400);
    const cloud = await call('POST', '/rooms', { profileId: p.id, mode: 'solo', classId: 'arcanist', bounty: { id: 'bty_cloud1', modifierId: 'barren' } });
    expect(cloud.body.bounty).toBe('barren');
    expect(srv.rooms.byCode(cloud.body.code)!.bounty).toEqual({ id: 'bty_cloud1', modifierId: 'barren' });
  });

  it('a finished bounty run credits doubled XP on RESULTS and marks the bounty completed', async () => {
    const p = (await call('POST', '/local/profiles', { displayName: 'Doubler' })).body;
    const res = (await call('POST', '/rooms', { profileId: p.id, mode: 'solo', classId: 'ranger', bounty: true })).body;
    const room = srv.rooms.byCode(res.code)!;
    await room.startRun();
    const a = room.authority!;
    // a run that cleared two rounds (state shaped directly: this test is about the progression pipeline)
    a.state.lastClear = { round: 2, points: '300', cleared: true };
    a.state.scoreText = '1500';
    a.submitCommand({ type: 'RETIRE_VOTE', slot: 0, yes: true });
    for (let i = 0; i < 5; i++) a.tick();
    await a.flush();
    for (let i = 0; i < 5; i++) a.tick();
    expect(a.state.phase).toBe('RESULTS');
    const base = xpForRun({ scoreText: '1500', depth: 2 });
    expect(a.summary().progress[0]).toMatchObject({ xp: base * 2, baseXp: base, bounty: true, xpBefore: 0, levelBefore: 1 });
    expect((await call('GET', `/local/profiles/${p.id}/progress`)).body.xp).toBe(base * 2);
    expect((await call('GET', `/local/bounty?profileId=${p.id}`)).body.bounty.completed).toBe(true);
  });
});
