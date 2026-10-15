/**
 * Entry point of the ONE dedicated persistence worker thread (the isolated SQLite writer).
 * Requests from the main-thread facade (store.ts) are processed strictly FIFO, one at a time.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { MigrationResult } from './migrate';
import { StoreError } from './paths';
import { PersistenceDb } from './db';

// ------------------------------------------------------------------ worker message loop
export interface WorkerRequest {
  id: number;
  op: string;
  args: unknown[];
}
export type WorkerResponse =
  | { type: 'ready'; schemaVersion: number; migration: MigrationResult; cleanup: { tmpRemoved: number; orphansRemoved: number } }
  | { type: 'init-error'; error: { code: string; message: string } }
  | { type: 'result'; id: number; ok: true; result: unknown; startedAt: number; finishedAt: number }
  | { type: 'result'; id: number; ok: false; error: { code: string; message: string }; startedAt: number; finishedAt: number };

const OPS = new Set<string>([
  'health',
  'createProfile',
  'getProfile',
  'linkCloudProfile',
  'getProgress',
  'ensureBounty',
  'getBounty',
  'bountyCompleted',
  'runAwards',
  'createAccount',
  'getAccountCredentials',
  'getAccount',
  'getAccountByUsername',
  'getAccountByProfile',
  'recordLogin',
  'updateAccount',
  'setPasswordHash',
  'createSession',
  'getSession',
  'deleteSession',
  'listSessions',
  'deleteOtherSessions',
  'listBuilds',
  'saveBuild',
  'deleteBuild',
  'listFriends',
  'requestFriend',
  'respondFriend',
  'removeFriend',
  'friendProfileIds',
  'accountStats',
  'deleteAccount',
  'getSettings',
  'putSettings',
  'ensureContentVersion',
  'createRun',
  'updateRunProgress',
  'recordRoundResult',
  'createOffer',
  'upsertVote',
  'appendEvents',
  'commitFate',
  'getCommit',
  'saveCheckpoint',
  'latestCheckpoint',
  'writeReplayChunk',
  'readReplay',
  'finalizeRun',
  'queryBoard',
  'listBoardKeys',
  'getRun',
  'listRuns',
  'hasRankedAttempt',
  'setFavorite',
  'setVerification',
  'backup',
  'enforceRetention',
  '__close',
]);

function toWireError(err: unknown): { code: string; message: string } {
  if (err instanceof StoreError) return { code: err.code, message: err.message };
  const e = err as { code?: unknown; message?: unknown; errstr?: unknown };
  const message = typeof e?.message === 'string' ? e.message : String(err);
  if (e?.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(message)) return { code: 'CONSTRAINT', message };
  return { code: 'INTERNAL', message };
}

const nowHr = () => performance.timeOrigin + performance.now();

async function main(): Promise<void> {
  const port = parentPort;
  const data = workerData as { role?: unknown; dataDir?: unknown } | null;
  if (!port || !data || data.role !== 'cursebound-persistence' || typeof data.dataDir !== 'string') return;
  const dataDir = data.dataDir;
  let db: PersistenceDb;
  try {
    const opened = await PersistenceDb.open(dataDir);
    db = opened.db;
    port.postMessage({
      type: 'ready',
      schemaVersion: opened.migration.toVersion,
      migration: opened.migration,
      cleanup: opened.cleanup,
    } satisfies WorkerResponse);
  } catch (err) {
    port.postMessage({ type: 'init-error', error: toWireError(err) } satisfies WorkerResponse);
    return;
  }

  const queue: WorkerRequest[] = [];
  let busy = false;
  const pump = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    while (queue.length > 0) {
      const req = queue.shift()!;
      const startedAt = nowHr();
      try {
        if (!OPS.has(req.op)) throw new StoreError('INVALID_INPUT', `unknown op ${req.op}`);
        let result: unknown;
        if (req.op === '__close') {
          db.close();
          result = null;
        } else {
          const fn = (db as unknown as Record<string, (...a: unknown[]) => unknown>)[req.op]!;
          result = await fn.apply(db, req.args);
        }
        port.postMessage({ type: 'result', id: req.id, ok: true, result, startedAt, finishedAt: nowHr() } satisfies WorkerResponse);
        if (req.op === '__close') {
          port.close();
          return;
        }
      } catch (err) {
        port.postMessage({
          type: 'result',
          id: req.id,
          ok: false,
          error: toWireError(err),
          startedAt,
          finishedAt: nowHr(),
        } satisfies WorkerResponse);
      }
    }
    busy = false;
  };
  port.on('message', (msg: WorkerRequest) => {
    queue.push(msg);
    void pump();
  });
}

void main();
