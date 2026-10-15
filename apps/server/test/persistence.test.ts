import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventHash } from '../src/persistence/db';
import { createLogger, sanitizeLogFields } from '../src/persistence/logger';
import { readSchemaVersion, runMigrations } from '../src/persistence/migrate';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../src/persistence/migrations';
import { loadSqlite } from '../src/persistence/sqlite';
import { openStore, type StoreHandle } from '../src/persistence/store';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const CONTENT = { hash: 'sha256-content-test', rulesVersion: 'rules-1', manifestPath: 'content/manifest.json' };
const BOARD = 'rules-1|sha256-content-test|score-1|n1|endless|open|local';

let dir: string;
let stores: StoreHandle[] = [];

async function open(): Promise<StoreHandle> {
  const s = await openStore({ dataDir: dir });
  stores.push(s);
  return s;
}

async function rawDb() {
  const sqlite = await loadSqlite();
  return new sqlite.DatabaseSync(path.join(dir, 'cursebound.sqlite'));
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

async function setupRun(store: StoreHandle, runId: string, opts: { n?: number; boardKey?: string; profiles?: string[] } = {}) {
  await store.ensureContentVersion(CONTENT);
  const n = opts.n ?? 1;
  const profiles = opts.profiles ?? [];
  while (profiles.length < n) profiles.push((await store.createProfile(`P${profiles.length}-${runId}`.slice(0, 24))).id);
  await store.createRun({
    id: runId,
    seed: `seed-${runId}`,
    contentHash: CONTENT.hash,
    scoreVersion: 'score-1',
    mode: 'endless',
    trust: 'local',
    n,
    boardKey: opts.boardKey ?? BOARD,
    challengeId: null,
    members: profiles.slice(0, n).map((profileId, slot) => ({ slot, profileId, classId: 'warden', buildJson: '{"nodes":[]}' })),
  });
  return profiles;
}

function checkpoint(seq: number, state = `{"round":${seq}}`) {
  return { seq, schemaVersion: 1, stateBlob: state, checksum: sha(state) };
}

function finalize(runId: string, scoreText: string, extra: Partial<{ depth: number; activeTicks: number; practice: boolean; boardKey: string }> = {}) {
  return {
    runId,
    status: 'finalized' as const,
    endReason: 'wipe',
    scoreText,
    depth: extra.depth ?? 1,
    activeTicks: extra.activeTicks ?? 100,
    boardKey: extra.boardKey ?? BOARD,
    trust: 'local',
    participantsJson: JSON.stringify([{ name: 'Ayla', classId: 'warden' }]),
    summaryJson: '{}',
    practice: extra.practice ?? false,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cursebound-persist-'));
  stores = [];
});

afterEach(async () => {
  for (const s of stores) await s.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('creates the latest schema with WAL, FKs and the contract tables', async () => {
    const store = await open();
    expect(store.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(store.migration.backupPath).toBeNull(); // fresh DB: nothing to back up
    const h = await store.health();
    expect(h).toMatchObject({ ok: true, schemaVersion: LATEST_SCHEMA_VERSION });
    expect(h.walBytes).toBeGreaterThanOrEqual(0);
    await store.close();

    const db = await rawDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    for (const t of [
      'schema_meta', 'profiles', 'settings', 'content_versions', 'runs', 'run_members', 'round_results', 'fate_offers', 'fate_votes',
      'run_events', 'fate_commits', 'checkpoints', 'replay_chunks', 'board_entries', 'verification', 'verification_audit',
      'accounts', 'sessions', 'saved_builds', 'friendships',
    ]) {
      expect(tables).toContain(t);
    }
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    db.close();
    for (const d of ['replays', 'backups', 'logs']) expect(existsSync(path.join(dir, d))).toBe(true);
  });

  it('backs up an existing non-empty DB before migrating and refuses a newer schema', async () => {
    const store = await open();
    const p = await store.createProfile('Before Migration');
    await store.close();

    const sqlite = await loadSqlite();
    const db = new sqlite.DatabaseSync(path.join(dir, 'cursebound.sqlite'));
    const L = LATEST_SCHEMA_VERSION;
    const next = { version: L + 1, name: 'test_add_column', sql: 'ALTER TABLE profiles ADD COLUMN test_flag INTEGER NOT NULL DEFAULT 0;' };
    const result = await runMigrations(sqlite, db, [...MIGRATIONS, next], path.join(dir, 'backups'));
    expect(result).toMatchObject({ fromVersion: L, toVersion: L + 1, applied: [L + 1] });
    expect(readSchemaVersion(db)).toBe(L + 1);
    db.close();

    expect(result.backupPath).toMatch(new RegExp(`pre-migration-v${L}-to-v${L + 1}-\\d{8}T\\d+Z\\.sqlite$`));
    expect(existsSync(result.backupPath!)).toBe(true);
    const bak = new sqlite.DatabaseSync(result.backupPath!);
    expect(readSchemaVersion(bak)).toBe(L);
    expect(bak.prepare('SELECT display_name FROM profiles WHERE id = ?').get(p.id)).toMatchObject({ display_name: 'Before Migration' });
    bak.close();

    // this build only knows up to v{L} -> must refuse to open a newer database
    await expectCode(openStore({ dataDir: dir }), 'SCHEMA_TOO_NEW');
  });
});

describe('profiles and settings', () => {
  it('sanitizes display names and bounds settings', async () => {
    const store = await open();
    const p = await store.createProfile('  Hel\u0000lo \t\n  World\u202E  ');
    expect(p.displayName).toBe('Hel lo World');
    const long = await store.createProfile('x'.repeat(40));
    expect(Array.from(long.displayName)).toHaveLength(24);
    await expectCode(store.createProfile('   \u0001  '), 'INVALID_INPUT');
    expect(await store.getProfile(p.id)).toEqual(p);
    expect(await store.getProfile('nope')).toBeNull();

    expect(await store.getSettings(p.id)).toBeNull();
    await store.putSettings(p.id, { volume: 0.5, keys: ['w'] }, 1);
    expect(await store.getSettings(p.id)).toEqual({ volume: 0.5, keys: ['w'] });
    await expect(store.putSettings(p.id, { blob: 'x'.repeat(70000) }, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('fate commit (A14)', () => {
  it('is idempotent across a crash: recommit returns existing and writes exactly one event', async () => {
    let store = await open();
    await setupRun(store, 'run-a14');
    await store.createOffer({ id: 'offer-1', runId: 'run-a14', afterRound: 1, cardsJson: '["c1","c2","c3"]', snapshotHash: 'snap', deadlineTick: 600 });
    // identical createOffer is a no-op; different data conflicts
    await store.createOffer({ id: 'offer-1', runId: 'run-a14', afterRound: 1, cardsJson: '["c1","c2","c3"]', snapshotHash: 'snap', deadlineTick: 600 });
    await expectCode(
      store.createOffer({ id: 'offer-1', runId: 'run-a14', afterRound: 1, cardsJson: '["c9","c2","c3"]', snapshotHash: 'snap', deadlineTick: 600 }),
      'CONFLICT',
    );
    const commit = {
      offerId: 'offer-1',
      runId: 'run-a14',
      cardId: 'blood_pact',
      tieJson: '{"tie":false}',
      stateHash: 'state-after',
      event: { seq: 1, tick: 500, type: 'FATE_COMMITTED', payloadJson: '{"cardId":"blood_pact"}' },
      checkpoint: checkpoint(1),
      round: 1,
      ticks: 500,
      scoreText: '1200',
    };
    expect(await store.commitFate(commit)).toEqual({ existing: false, cardId: 'blood_pact', stateHash: 'state-after', eventSeq: 1 });

    // simulate a crash: kill the worker without a graceful close, then reopen
    await store.terminateNow();
    store = await open();

    const again = await store.commitFate({ ...commit, cardId: 'rapid_evolution', stateHash: 'other' });
    expect(again).toEqual({ existing: true, cardId: 'blood_pact', stateHash: 'state-after', eventSeq: 1 });
    expect(await store.getCommit('offer-1')).toEqual({ cardId: 'blood_pact', stateHash: 'state-after', eventSeq: 1, tieJson: '{"tie":false}' });
    const run = await store.getRun('run-a14');
    expect(run).toMatchObject({ round: 1, ticks: 500, scoreText: '1200', status: 'active' });
    expect(run!.fateTimeline).toEqual([
      expect.objectContaining({ offerId: 'offer-1', commit: expect.objectContaining({ cardId: 'blood_pact', eventSeq: 1 }) }),
    ]);
    expect((await store.latestCheckpoint('run-a14'))?.seq).toBe(1);
    await store.close();

    const db = await rawDb();
    expect(db.prepare("SELECT count(*) AS c FROM run_events WHERE run_id = 'run-a14'").get()).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT count(*) AS c FROM fate_commits').get()).toMatchObject({ c: 1 });
    db.close();
  });

  it('rolls back the whole transaction when any part fails', async () => {
    const store = await open();
    await setupRun(store, 'run-rb');
    await store.createOffer({ id: 'offer-rb', runId: 'run-rb', afterRound: 1, cardsJson: '[]', snapshotHash: 's', deadlineTick: null });
    await store.saveCheckpoint({ runId: 'run-rb', ...checkpoint(1, 'A') });
    // checkpoint seq 1 already exists with different content -> CONFLICT after event insert -> rollback
    await expectCode(
      store.commitFate({
        offerId: 'offer-rb', runId: 'run-rb', cardId: 'x', tieJson: '{}', stateHash: 'h',
        event: { seq: 1, tick: 1, type: 'FATE_COMMITTED', payloadJson: '{}' },
        checkpoint: checkpoint(1, 'B'), round: 1, ticks: 1, scoreText: '5',
      }),
      'CONFLICT',
    );
    expect(await store.getCommit('offer-rb')).toBeNull();
    expect((await store.getRun('run-rb'))!.scoreText).toBe('0');
    expect((await store.appendEvents('run-rb', [{ seq: 1, tick: 1, type: 'X', payloadJson: '{}' }])).lastHash).toHaveLength(64);
  });
});

describe('events', () => {
  it('hash-chains events, is idempotent for identical resends and rejects gaps/conflicts', async () => {
    const store = await open();
    await setupRun(store, 'run-ev');
    const evs = [1, 2, 3].map((seq) => ({ seq, tick: seq * 10, type: 'ROUND_STARTED', payloadJson: `{"r":${seq}}` }));
    const { lastHash } = await store.appendEvents('run-ev', evs);
    let prev = '0'.repeat(64);
    for (const e of evs) prev = eventHash(prev, 'run-ev', e.seq, e.tick, e.type, e.payloadJson);
    expect(lastHash).toBe(prev);
    expect((await store.appendEvents('run-ev', evs.slice(1))).lastHash).toBe(prev);
    await expectCode(store.appendEvents('run-ev', [{ seq: 5, tick: 1, type: 'X', payloadJson: '{}' }]), 'CONFLICT');
    await expectCode(store.appendEvents('run-ev', [{ ...evs[0]!, payloadJson: '{"r":99}' }]), 'CONFLICT');
  });
});

describe('votes', () => {
  it('monotonic upsert only applies strictly newer seq', async () => {
    const store = await open();
    await setupRun(store, 'run-v');
    await store.createOffer({ id: 'offer-v', runId: 'run-v', afterRound: 1, cardsJson: '[]', snapshotHash: 's', deadlineTick: null });
    expect(await store.upsertVote({ offerId: 'offer-v', memberSlot: 0, seq: 5, cardSlot: 'A', locked: false })).toEqual({ applied: true });
    expect(await store.upsertVote({ offerId: 'offer-v', memberSlot: 0, seq: 4, cardSlot: 'B', locked: true })).toEqual({ applied: false });
    expect(await store.upsertVote({ offerId: 'offer-v', memberSlot: 0, seq: 5, cardSlot: 'C', locked: true })).toEqual({ applied: false });
    expect(await store.upsertVote({ offerId: 'offer-v', memberSlot: 0, seq: 6, cardSlot: 'C', locked: true })).toEqual({ applied: true });
    expect(await store.upsertVote({ offerId: 'offer-v', memberSlot: 1, seq: 1, cardSlot: 'B', locked: false })).toEqual({ applied: true });
    await expectCode(store.upsertVote({ offerId: 'offer-v', memberSlot: 0, seq: 7, cardSlot: 'D' as 'A', locked: true }), 'INVALID_INPUT');
    await store.close();
    const db = await rawDb();
    expect(db.prepare("SELECT seq, card_slot, locked FROM fate_votes WHERE offer_id='offer-v' AND member_slot=0").get()).toMatchObject({
      seq: 6, card_slot: 'C', locked: 1,
    });
    db.close();
  });
});

describe('boards', () => {
  it('orders the Appendix A4 fixture by digit length then binary text, then tie-breakers', async () => {
    const store = await open();
    const scores = ['9', '10', '999', '1000', '1000000000000000000000000'];
    for (const [i, s] of scores.entries()) {
      await setupRun(store, `run-a4-${i}`);
      await store.finalizeRun(finalize(`run-a4-${i}`, s));
    }
    // tie-breakers on equal score '999': deeper first, then fewer active ticks
    await setupRun(store, 'run-tie-deep');
    await store.finalizeRun(finalize('run-tie-deep', '999', { depth: 5 }));
    await setupRun(store, 'run-tie-fast');
    await store.finalizeRun(finalize('run-tie-fast', '999', { depth: 5, activeTicks: 50 }));

    const { rows, nextCursor } = await store.queryBoard({ boardKey: BOARD, limit: 100 });
    expect(nextCursor).toBeNull();
    expect(rows.map((r) => r.scoreText)).toEqual(['1000000000000000000000000', '1000', '999', '999', '999', '10', '9']);
    expect(rows.slice(2, 5).map((r) => r.runId)).toEqual(['run-tie-fast', 'run-tie-deep', 'run-a4-2']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows[0]).toMatchObject({ trust: 'local', verification: 'local', practice: false, participants: [{ name: 'Ayla', classId: 'warden' }] });
    expect(await store.listBoardKeys()).toEqual([{ boardKey: BOARD, count: 7 }]);
  });

  it('paginates with keyset cursors without gaps or duplicates and hides practice/invalid by default', async () => {
    const store = await open();
    for (let i = 0; i < 25; i++) {
      await setupRun(store, `run-p-${String(i).padStart(2, '0')}`);
      await store.finalizeRun(finalize(`run-p-${String(i).padStart(2, '0')}`, String(1000 + (i % 7)), { depth: i % 3 }));
    }
    await setupRun(store, 'run-practice');
    await store.finalizeRun(finalize('run-practice', '999999', { practice: true }));

    const all = (await store.queryBoard({ boardKey: BOARD, limit: 100 })).rows;
    expect(all).toHaveLength(25);
    const pages: string[][] = [];
    const ranks: number[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<StoreHandle['queryBoard']>> = await store.queryBoard({ boardKey: BOARD, limit: 10, cursor });
      pages.push(page.rows.map((r) => r.runId));
      ranks.push(...page.rows.map((r) => r.rank));
      cursor = page.nextCursor;
    } while (cursor);
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(all.map((r) => r.runId));
    expect(ranks).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));

    const withPractice = await store.queryBoard({ boardKey: BOARD, limit: 100, includePractice: true });
    expect(withPractice.rows[0]).toMatchObject({ runId: 'run-practice', practice: true });

    await store.setVerification(all[0]!.runId, 'invalid', 'admin', 'test invalidation');
    expect((await store.queryBoard({ boardKey: BOARD, limit: 100 })).rows).toHaveLength(24);

    await expectCode(store.queryBoard({ boardKey: BOARD, limit: 10, cursor: 'not!valid' }), 'INVALID_INPUT');
    await expectCode(store.queryBoard({ boardKey: BOARD, limit: 10, cursor: Buffer.from('[1,2]').toString('base64url') }), 'INVALID_INPUT');
    await expectCode(store.queryBoard({ boardKey: BOARD, limit: 0 }), 'INVALID_INPUT');
    await expectCode(store.queryBoard({ boardKey: BOARD, limit: 101 }), 'INVALID_INPUT');
  });
});

describe('checkpoints', () => {
  it('detects checksum tampering', async () => {
    const store = await open();
    await setupRun(store, 'run-cp');
    await store.saveCheckpoint({ runId: 'run-cp', ...checkpoint(1) });
    await store.saveCheckpoint({ runId: 'run-cp', ...checkpoint(2) });
    await store.saveCheckpoint({ runId: 'run-cp', ...checkpoint(2) }); // identical: no-op
    expect(await store.latestCheckpoint('run-cp')).toEqual(checkpoint(2));
    await expectCode(store.saveCheckpoint({ runId: 'run-cp', seq: 3, schemaVersion: 1, stateBlob: '{}', checksum: sha('other') }), 'CHECKSUM_MISMATCH');

    const db = await rawDb();
    db.prepare("UPDATE checkpoints SET state_blob = '{\"round\":999}' WHERE run_id = 'run-cp' AND seq = 2").run();
    db.close();
    await expectCode(store.latestCheckpoint('run-cp'), 'CHECKSUM_MISMATCH');
    expect(await store.latestCheckpoint('run-none')).toBeNull();
  });
});

describe('replay chunks', () => {
  it('writes atomically, verifies checksums, is idempotent and rejects unsafe run ids', async () => {
    const store = await open();
    await setupRun(store, 'run-rp');
    const json0 = JSON.stringify({ inputs: Array.from({ length: 500 }, (_, i) => [i, i % 4]) });
    const w0 = await store.writeReplayChunk({ runId: 'run-rp', chunkNo: 0, firstTick: 0, lastTick: 499, json: json0 });
    expect(w0.path).toBe('replays/run-rp/0.json.gz');
    const file = path.join(dir, 'replays', 'run-rp', '0.json.gz');
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(w0.checksum);
    expect(w0.byteCount).toBe(readFileSync(file).length);

    expect(await store.writeReplayChunk({ runId: 'run-rp', chunkNo: 0, firstTick: 0, lastTick: 499, json: json0 })).toEqual(w0);
    await expectCode(store.writeReplayChunk({ runId: 'run-rp', chunkNo: 0, firstTick: 0, lastTick: 499, json: '{"x":1}' }), 'CONFLICT');
    await store.writeReplayChunk({ runId: 'run-rp', chunkNo: 1, firstTick: 500, lastTick: 999, json: '{"inputs":[]}' });

    expect(await store.readReplay('run-rp')).toEqual([
      { chunkNo: 0, firstTick: 0, lastTick: 499, json: json0 },
      { chunkNo: 1, firstTick: 500, lastTick: 999, json: '{"inputs":[]}' },
    ]);

    for (const bad of ['../evil', 'a/b', 'C:\\x', '', 'x'.repeat(65)]) {
      await expectCode(store.writeReplayChunk({ runId: bad, chunkNo: 0, firstTick: 0, lastTick: 1, json: '{}' }), 'INVALID_INPUT');
    }

    // corrupt the stored file -> verification fails
    writeFileSync(path.join(dir, 'replays', 'run-rp', '1.json.gz'), 'garbage');
    await expectCode(store.readReplay('run-rp'), 'CHECKSUM_MISMATCH');
  });

  it('collects leftover temp and unpublished chunk files on open', async () => {
    let store = await open();
    await setupRun(store, 'run-gc');
    await store.close();
    const runDir = path.join(dir, 'replays', 'run-gc');
    rmSync(runDir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, '0.json.gz.tmp'), 'partial');
    writeFileSync(path.join(runDir, '3.json.gz'), 'unpublished');
    store = await open();
    expect(readdirSync(runDir)).toEqual([]);
  });
});

describe('finalization', () => {
  it('is idempotent by run id and blocks later mutation', async () => {
    const store = await open();
    await setupRun(store, 'run-fin');
    await store.recordRoundResult({ runId: 'run-fin', roundNo: 1, objectiveTotal: 10, completedWeight: 10, activeTicks: 300, scoreText: '150', cleared: true, detailJson: '{}' });
    // identical re-insert is a no-op, different data is an error
    await store.recordRoundResult({ runId: 'run-fin', roundNo: 1, objectiveTotal: 10, completedWeight: 10, activeTicks: 300, scoreText: '150', cleared: true, detailJson: '{}' });
    await expectCode(
      store.recordRoundResult({ runId: 'run-fin', roundNo: 1, objectiveTotal: 10, completedWeight: 10, activeTicks: 300, scoreText: '151', cleared: true, detailJson: '{}' }),
      'CONFLICT',
    );
    expect(await store.finalizeRun(finalize('run-fin', '150', { depth: 1 }))).toEqual({ existing: false, awards: [] });
    expect(await store.finalizeRun(finalize('run-fin', '99999', { depth: 9 }))).toEqual({ existing: true, awards: [] });

    const run = await store.getRun('run-fin');
    expect(run).toMatchObject({ status: 'finalized', scoreText: '150', endReason: 'wipe', verification: 'local' });
    expect(run!.completedAt).toEqual(expect.any(Number));
    expect(run!.rounds).toHaveLength(1);
    expect(run!.members).toEqual([expect.objectContaining({ slot: 0, classId: 'warden', displayName: expect.any(String) })]);
    const board = await store.queryBoard({ boardKey: BOARD, limit: 10 });
    expect(board.rows.map((r) => [r.runId, r.scoreText])).toEqual([['run-fin', '150']]);

    await expectCode(store.updateRunProgress({ id: 'run-fin', round: 2, ticks: 1, scoreText: '1' }), 'RUN_FINALIZED');
    await expectCode(store.appendEvents('run-fin', [{ seq: 1, tick: 1, type: 'X', payloadJson: '{}' }]), 'RUN_FINALIZED');
    expect(await store.listRuns({ status: 'finalized', limit: 10 })).toEqual([expect.objectContaining({ id: 'run-fin' })]);
  });

  it('keeps pending_storage runs re-finalizable and off the board', async () => {
    const store = await open();
    await setupRun(store, 'run-pend');
    expect(await store.finalizeRun({ ...finalize('run-pend', '10'), status: 'pending_storage' })).toEqual({ existing: false, awards: [] });
    expect((await store.queryBoard({ boardKey: BOARD, limit: 10 })).rows).toHaveLength(0);
    expect(await store.finalizeRun(finalize('run-pend', '10'))).toEqual({ existing: false, awards: [] });
    expect((await store.queryBoard({ boardKey: BOARD, limit: 10 })).rows).toHaveLength(1);
  });
});

describe('score text', () => {
  it("rejects non-canonical '007' in the facade and via the schema CHECK constraint", async () => {
    const store = await open();
    await setupRun(store, 'run-score');
    await expectCode(store.updateRunProgress({ id: 'run-score', round: 1, ticks: 1, scoreText: '007' }), 'INVALID_INPUT');
    await expectCode(store.updateRunProgress({ id: 'run-score', round: 1, ticks: 1, scoreText: '1e5' }), 'INVALID_INPUT');
    await store.updateRunProgress({ id: 'run-score', round: 1, ticks: 1, scoreText: '1000000000000000000000000' });
    expect((await store.getRun('run-score'))!.scoreText).toBe('1000000000000000000000000');
    await store.close();

    const db = await rawDb();
    expect(() => db.prepare("UPDATE runs SET score_text = '007', score_digits = 3 WHERE id = 'run-score'").run()).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("UPDATE runs SET score_text = '7', score_digits = 3 WHERE id = 'run-score'").run()).toThrow(/CHECK constraint failed/);
    expect(() => db.prepare("UPDATE runs SET score_text = '', score_digits = 0 WHERE id = 'run-score'").run()).toThrow(/CHECK constraint failed/);
    db.prepare("UPDATE runs SET score_text = '0', score_digits = 1 WHERE id = 'run-score'").run();
    db.close();
  });
});

describe('policy, moderation and operations', () => {
  it('tracks one ranked attempt per challenge roster', async () => {
    const store = await open();
    const [a] = await setupRun(store, 'run-ch1', { boardKey: 'daily-1' });
    const other = (await store.createProfile('Other')).id;
    expect(await store.hasRankedAttempt('daily-1', [a!])).toBe(true);
    expect(await store.hasRankedAttempt('daily-1', [other])).toBe(false);
    expect(await store.hasRankedAttempt('daily-2', [a!])).toBe(false);
  });

  it('writes verification audit rows and toggles favorite', async () => {
    const store = await open();
    await setupRun(store, 'run-mod');
    await store.finalizeRun(finalize('run-mod', '42'));
    await store.setVerification('run-mod', 'verified', 'reviewer-1', 'replay checked');
    expect((await store.queryBoard({ boardKey: BOARD, limit: 1 })).rows[0]!.verification).toBe('verified');
    await expectCode(store.setVerification('run-mod', 'bogus', 'r', 'x'), 'INVALID_INPUT');
    await store.setFavorite('run-mod', true);
    expect((await store.getRun('run-mod'))!.favorite).toBe(true);
    await expectCode(store.setFavorite('missing-run', true), 'NOT_FOUND');
    await store.close();
    const db = await rawDb();
    expect(db.prepare("SELECT actor, prior_status, new_status, reason FROM verification_audit WHERE run_id='run-mod'").all()).toEqual([
      expect.objectContaining({ actor: 'reviewer-1', prior_status: 'local', new_status: 'verified', reason: 'replay checked' }),
    ]);
    expect(db.prepare("SELECT verified_at FROM board_entries WHERE run_id='run-mod'").get()).toMatchObject({ verified_at: expect.any(Number) });
    db.close();
  });

  it('enforces replay retention without touching favorite or active runs', async () => {
    const store = await open();
    for (const id of ['run-old', 'run-fav', 'run-active']) {
      await setupRun(store, id);
      await store.writeReplayChunk({ runId: id, chunkNo: 0, firstTick: 0, lastTick: 1, json: JSON.stringify({ id, pad: 'x'.repeat(1000) }) });
    }
    await store.finalizeRun(finalize('run-old', '1'));
    await store.finalizeRun(finalize('run-fav', '2'));
    await store.setFavorite('run-fav', true);
    expect(await store.enforceRetention()).toEqual({ evictedRuns: [] }); // far below 1 GiB
    expect(await store.enforceRetention({ replayBytes: 0 })).toEqual({ evictedRuns: ['run-old'] });
    expect(existsSync(path.join(dir, 'replays', 'run-old'))).toBe(false);
    expect(await store.readReplay('run-old')).toEqual([]);
    expect(await store.readReplay('run-fav')).toHaveLength(1);
    expect(await store.readReplay('run-active')).toHaveLength(1);
  });

  it('takes consistent online backups including WAL content', async () => {
    const store = await open();
    const p = await store.createProfile('Backed Up');
    const b = await store.backup('manual-test.sqlite');
    expect(b.path).toBe(path.join(dir, 'backups', 'manual-test.sqlite'));
    expect(b.bytes).toBeGreaterThan(0);
    await expectCode(store.backup('manual-test.sqlite'), 'CONFLICT');
    await expectCode(store.backup(path.join(dir, 'cursebound.sqlite')), 'INVALID_INPUT');
    const sqlite = await loadSqlite();
    const bak = new sqlite.DatabaseSync(b.path);
    expect(bak.prepare('SELECT display_name FROM profiles WHERE id = ?').get(p.id)).toMatchObject({ display_name: 'Backed Up' });
    bak.close();
  });

  it('runs requests FIFO through the worker queue and drains on close', async () => {
    const store = await open();
    await setupRun(store, 'run-q');
    const order: number[] = [];
    const ps = Array.from({ length: 200 }, (_, i) =>
      store.appendEvents('run-q', [{ seq: i + 1, tick: i, type: 'T', payloadJson: '{}' }]).then(() => order.push(i)),
    );
    expect(store.queueStats().queueDepth).toBeGreaterThan(0);
    const closing = store.close(); // must drain the 200 queued appends first
    await expectCode(store.getRun('run-q'), 'STORE_CLOSED');
    await Promise.all(ps);
    await closing;
    expect(order).toEqual(Array.from({ length: 200 }, (_, i) => i));
    const db = await rawDb();
    expect(db.prepare("SELECT count(*) AS c FROM run_events WHERE run_id='run-q'").get()).toMatchObject({ c: 200 });
    db.close();
  });
});

describe('logger', () => {
  it('writes bounded JSON lines with redaction and no IPs', async () => {
    const log = createLogger({ dataDir: dir, build: 'test-build' });
    log.child({ runId: 'run-1' }).info('fate_committed', {
      phase: 'intermission',
      seatToken: 'abc',
      password: 'pw',
      ip: '10.0.0.1',
      note: 'from 192.168.1.20',
      big: 'y'.repeat(2000),
    });
    await log.close();
    const files = readdirSync(path.join(dir, 'logs'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^cursebound-\d{8}\.log$/);
    const line = JSON.parse(readFileSync(path.join(dir, 'logs', files[0]!), 'utf8').trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'info', build: 'test-build', runId: 'run-1', event: 'fate_committed', phase: 'intermission', seatToken: '[redacted]', password: '[redacted]', note: 'from [ip]' });
    expect(line).not.toHaveProperty('ip');
    expect((line.big as string).length).toBeLessThan(600);
    expect(sanitizeLogFields({ nested: { secret: 's', token: 't' } })).toEqual({ nested: { secret: '[redacted]', token: '[redacted]' } });
  });

  it('enforces the rolling total cap by deleting the oldest files', async () => {
    const logs = path.join(dir, 'logs');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(path.join(logs, 'cursebound-20200101.log'), 'x'.repeat(4000));
    writeFileSync(path.join(logs, 'cursebound-20200102.log'), 'x'.repeat(4000));
    const log = createLogger({ dataDir: dir, maxTotalBytes: 6000, maxFileBytes: 3000 });
    log.info('boot');
    await log.close();
    const files = readdirSync(logs).sort();
    expect(files).not.toContain('cursebound-20200101.log');
    expect(files.some((f) => /^cursebound-\d{8}(-\d+)?\.log$/.test(f) && !f.startsWith('cursebound-2020'))).toBe(true);
  });
});
