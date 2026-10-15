/**
 * Main-thread persistence facade (docs/contracts/PERSISTENCE_CONTRACT.md).
 *
 * The room authority never touches SQLite: every call becomes a request (monotonic request ID) posted
 * to ONE dedicated worker thread that owns the only connection and executes requests FIFO. Each call
 * returns its own promise. Queue depth and per-request queue age (enqueue -> worker start) are tracked.
 * Durability comes from synchronous=FULL transactions in the worker, not from this async queue: a
 * promise resolves only after the worker's COMMIT returned.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Logger } from './logger';
import type { MigrationResult } from './migrate';
import { StoreError, type StoreErrorCode } from './paths';
import type { Store, StoreOp, StoreOptions } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

export * from './types';
export { StoreError, defaultDataDir, dataPaths } from './paths';

export interface OpenStoreOptions extends StoreOptions {
  /** Optional structured logger for open/close/queue diagnostics. */
  logger?: Logger;
}

export interface QueueStats {
  queueDepth: number;
  lastQueueAgeMs: number;
  maxQueueAgeMs: number;
  completedRequests: number;
}

/** Store plus diagnostics that are intentionally not part of the contract interface. */
export interface StoreHandle extends Store {
  readonly schemaVersion: number;
  readonly migration: MigrationResult;
  queueStats(): QueueStats;
  /** TEST ONLY: kill the worker without draining (simulates a process crash). */
  terminateNow(): Promise<void>;
}

/**
 * Resolve how to launch the worker. The thread always starts at the plain-JS `worker-entry.mjs`
 * bootstrap. Running from TypeScript source (tsx, vitest) the bootstrap registers the tsx ESM hooks
 * inside the worker and then imports `worker.ts`; a compiled build imports the sibling `worker.js`.
 */
function workerLaunch(): { bootstrap: URL; entry: string } {
  const here = import.meta.url;
  const isTs = fileURLToPath(here).endsWith('.ts');
  return { bootstrap: new URL('./worker-entry.mjs', here), entry: new URL(isTs ? './worker.ts' : './worker.js', here).href };
}

const nowHr = () => performance.timeOrigin + performance.now();

interface Pending {
  op: string;
  enqueuedAt: number;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

class WorkerStore implements StoreHandle {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closing: Promise<void> | null = null;
  private failure: StoreError | null = null;
  private lastAge = 0;
  private maxAge = 0;
  private completed = 0;

  constructor(
    private readonly worker: Worker,
    readonly schemaVersion: number,
    readonly migration: MigrationResult,
    private readonly logger?: Logger,
  ) {
    worker.on('message', (msg: WorkerResponse) => this.onMessage(msg));
    worker.on('error', (err) => this.fail(new StoreError('WORKER_FAILED', `persistence worker error: ${err.message}`)));
    worker.on('exit', (code) => {
      if (this.pending.size > 0 || (!this.closing && !this.failure)) {
        this.fail(new StoreError('WORKER_FAILED', `persistence worker exited (code ${code})`));
      }
    });
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type !== 'result') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    const age = Math.max(0, msg.startedAt - p.enqueuedAt);
    this.lastAge = age;
    if (age > this.maxAge) this.maxAge = age;
    this.completed++;
    if (age > 250) this.logger?.warn('persistence_queue_slow', { op: p.op, queueAgeMs: Math.round(age), queueDepth: this.pending.size });
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new StoreError(msg.error.code as StoreErrorCode, msg.error.message));
  }

  private fail(err: StoreError): void {
    if (!this.failure) {
      this.failure = err;
      this.logger?.error('persistence_worker_failed', { message: err.message, pending: this.pending.size });
    }
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send<T>(op: StoreOp | '__close', args: unknown[], allowWhileClosing = false): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing && !allowWhileClosing) return Promise.reject(new StoreError('STORE_CLOSED', 'store is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { op, enqueuedAt: nowHr(), resolve: resolve as (v: unknown) => void, reject });
      const req: WorkerRequest = { id, op, args };
      try {
        this.worker.postMessage(req);
      } catch (err) {
        this.pending.delete(id);
        reject(new StoreError('INVALID_INPUT', `request not serialisable: ${(err as Error).message}`));
      }
    });
  }

  queueStats(): QueueStats {
    return { queueDepth: this.pending.size, lastQueueAgeMs: this.lastAge, maxQueueAgeMs: this.maxAge, completedRequests: this.completed };
  }

  async health() {
    const depth = this.pending.size;
    const h = await this.send<{ ok: boolean; schemaVersion: number; walBytes: number }>('health', []);
    return { ...h, queueDepth: depth, lastQueueAgeMs: this.lastAge };
  }

  createProfile: Store['createProfile'] = (displayName) => this.send('createProfile', [displayName]);
  getProfile: Store['getProfile'] = (id) => this.send('getProfile', [id]);
  linkCloudProfile: Store['linkCloudProfile'] = (accountId, displayName, cloudXp) => this.send('linkCloudProfile', [accountId, displayName, cloudXp ?? null]);
  getProgress: Store['getProgress'] = (profileId) => this.send('getProgress', [profileId]);
  ensureBounty: Store['ensureBounty'] = (q) => this.send('ensureBounty', [q]);
  getBounty: Store['getBounty'] = (id) => this.send('getBounty', [id]);
  bountyCompleted: Store['bountyCompleted'] = (bountyId, profileId) => this.send('bountyCompleted', [bountyId, profileId]);
  runAwards: Store['runAwards'] = (runId) => this.send('runAwards', [runId]);
  createAccount: Store['createAccount'] = a => this.send('createAccount', [a]);
  getAccountCredentials: Store['getAccountCredentials'] = username => this.send('getAccountCredentials', [username]);
  getAccount: Store['getAccount'] = id => this.send('getAccount', [id]);
  getAccountByUsername: Store['getAccountByUsername'] = username => this.send('getAccountByUsername', [username]);
  getAccountByProfile: Store['getAccountByProfile'] = profileId => this.send('getAccountByProfile', [profileId]);
  recordLogin: Store['recordLogin'] = (accountId, ok, lockAfter, lockMs) => this.send('recordLogin', [accountId, ok, lockAfter, lockMs]);
  updateAccount: Store['updateAccount'] = (accountId, patch) => this.send('updateAccount', [accountId, patch]);
  setPasswordHash: Store['setPasswordHash'] = (accountId, passwordHash, keepSessionHash) => this.send('setPasswordHash', [accountId, passwordHash, keepSessionHash]);
  createSession: Store['createSession'] = s => this.send('createSession', [s]);
  getSession: Store['getSession'] = (tokenHash, now, extendTo) => this.send('getSession', [tokenHash, now, extendTo]);
  deleteSession: Store['deleteSession'] = tokenHash => this.send('deleteSession', [tokenHash]);
  listSessions: Store['listSessions'] = accountId => this.send('listSessions', [accountId]);
  deleteOtherSessions: Store['deleteOtherSessions'] = (accountId, keepTokenHash) => this.send('deleteOtherSessions', [accountId, keepTokenHash]);
  listBuilds: Store['listBuilds'] = accountId => this.send('listBuilds', [accountId]);
  saveBuild: Store['saveBuild'] = (accountId, buildId, b, maxBuilds) => this.send('saveBuild', [accountId, buildId, b, maxBuilds]);
  deleteBuild: Store['deleteBuild'] = (accountId, buildId) => this.send('deleteBuild', [accountId, buildId]);
  listFriends: Store['listFriends'] = accountId => this.send('listFriends', [accountId]);
  requestFriend: Store['requestFriend'] = (accountId, targetId) => this.send('requestFriend', [accountId, targetId]);
  respondFriend: Store['respondFriend'] = (accountId, otherId, accept) => this.send('respondFriend', [accountId, otherId, accept]);
  removeFriend: Store['removeFriend'] = (accountId, otherId) => this.send('removeFriend', [accountId, otherId]);
  friendProfileIds: Store['friendProfileIds'] = accountId => this.send('friendProfileIds', [accountId]);
  accountStats: Store['accountStats'] = profileId => this.send('accountStats', [profileId]);
  deleteAccount: Store['deleteAccount'] = accountId => this.send('deleteAccount', [accountId]);
  getSettings: Store['getSettings'] = (profileId) => this.send('getSettings', [profileId]);
  putSettings: Store['putSettings'] = (profileId, json, schemaVersion) => {
    // Serialise on the main thread so non-cloneable values fail fast and the size bound is exact.
    let text: string | undefined;
    try {
      text = JSON.stringify(json);
    } catch (err) {
      return Promise.reject(new StoreError('INVALID_INPUT', `settings not JSON-serialisable: ${(err as Error).message}`));
    }
    if (typeof text !== 'string') return Promise.reject(new StoreError('INVALID_INPUT', 'settings must be JSON-serialisable'));
    if (text.length > 65536) return Promise.reject(new StoreError('INVALID_INPUT', 'settings JSON exceeds 65536 chars'));
    return this.send('putSettings', [profileId, JSON.parse(text) as unknown, schemaVersion]);
  };
  ensureContentVersion: Store['ensureContentVersion'] = (v) => this.send('ensureContentVersion', [v]);
  createRun: Store['createRun'] = (r) => this.send('createRun', [r]);
  updateRunProgress: Store['updateRunProgress'] = (p) => this.send('updateRunProgress', [p]);
  recordRoundResult: Store['recordRoundResult'] = (r) => this.send('recordRoundResult', [r]);
  createOffer: Store['createOffer'] = (o) => this.send('createOffer', [o]);
  upsertVote: Store['upsertVote'] = (v) => this.send('upsertVote', [v]);
  appendEvents: Store['appendEvents'] = (runId, events) => this.send('appendEvents', [runId, events]);
  commitFate: Store['commitFate'] = (c) => this.send('commitFate', [c]);
  getCommit: Store['getCommit'] = (offerId) => this.send('getCommit', [offerId]);
  saveCheckpoint: Store['saveCheckpoint'] = (c) => this.send('saveCheckpoint', [c]);
  latestCheckpoint: Store['latestCheckpoint'] = (runId) => this.send('latestCheckpoint', [runId]);
  writeReplayChunk: Store['writeReplayChunk'] = (c) => this.send('writeReplayChunk', [c]);
  readReplay: Store['readReplay'] = (runId) => this.send('readReplay', [runId]);
  finalizeRun: Store['finalizeRun'] = (f) => this.send('finalizeRun', [f]);
  queryBoard: Store['queryBoard'] = (q) => this.send('queryBoard', [q]);
  listBoardKeys: Store['listBoardKeys'] = () => this.send('listBoardKeys', []);
  getRun: Store['getRun'] = (runId) => this.send('getRun', [runId]);
  listRuns: Store['listRuns'] = (q) => this.send('listRuns', [q]);
  hasRankedAttempt: Store['hasRankedAttempt'] = (boardKey, profileIds) => this.send('hasRankedAttempt', [boardKey, profileIds]);
  setFavorite: Store['setFavorite'] = (runId, favorite) => this.send('setFavorite', [runId, favorite]);
  setVerification: Store['setVerification'] = (runId, status, actor, reason) => this.send('setVerification', [runId, status, actor, reason]);
  backup: Store['backup'] = (destPath) => this.send('backup', [destPath]);
  enforceRetention: Store['enforceRetention'] = (opts) => this.send('enforceRetention', [opts ?? {}]);

  /** Stop accepting requests, let every queued request finish (FIFO), close the DB, stop the worker. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const queued = [...this.pending.values()].length;
      try {
        if (!this.failure) await this.send<null>('__close', [], true);
      } finally {
        await this.worker.terminate();
        this.logger?.info('persistence_closed', { drained: queued, completedRequests: this.completed, maxQueueAgeMs: Math.round(this.maxAge) });
      }
    })();
    return this.closing;
  }

  async terminateNow(): Promise<void> {
    this.closing = Promise.resolve();
    this.fail(new StoreError('STORE_CLOSED', 'store terminated'));
    await this.worker.terminate();
  }
}

export async function openStore(opts: OpenStoreOptions): Promise<StoreHandle> {
  if (!opts || typeof opts.dataDir !== 'string' || opts.dataDir.trim() === '') {
    throw new StoreError('INVALID_INPUT', 'openStore requires dataDir');
  }
  const dataDir = path.resolve(opts.dataDir);
  const { bootstrap, entry } = workerLaunch();
  const worker = new Worker(bootstrap, {
    // do not inherit the parent's loader flags (tsx/vitest); the bootstrap registers what it needs
    execArgv: [],
    workerData: { role: 'cursebound-persistence', dataDir, entry },
    // keep the worker's stdout/stderr flowing to the parent process
    stdout: false,
    stderr: false,
  });
  const ready = await new Promise<Extract<WorkerResponse, { type: 'ready' }>>((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMsg);
      worker.off('error', onErr);
      worker.off('exit', onExit);
    };
    const onMsg = (msg: WorkerResponse) => {
      if (msg.type === 'ready') {
        cleanup();
        resolve(msg);
      } else if (msg.type === 'init-error') {
        cleanup();
        void worker.terminate();
        reject(new StoreError(msg.error.code as StoreErrorCode, `persistence open failed: ${msg.error.message}`));
      }
    };
    const onErr = (err: Error) => {
      cleanup();
      void worker.terminate();
      reject(new StoreError('WORKER_FAILED', `persistence worker failed to start: ${err.message}`));
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new StoreError('WORKER_FAILED', `persistence worker exited during start (code ${code})`));
    };
    worker.on('message', onMsg);
    worker.on('error', onErr);
    worker.on('exit', onExit);
  });
  opts.logger?.info('persistence_opened', {
    schemaVersion: ready.schemaVersion,
    migratedFrom: ready.migration.fromVersion,
    applied: ready.migration.applied,
    preMigrationBackup: ready.migration.backupPath ? path.basename(ready.migration.backupPath) : null,
    tmpChunksRemoved: ready.cleanup.tmpRemoved,
    orphanChunksRemoved: ready.cleanup.orphansRemoved,
  });
  return new WorkerStore(worker, ready.schemaVersion, ready.migration, opts.logger);
}
