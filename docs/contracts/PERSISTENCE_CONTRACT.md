# Persistence contract (REQ DATA01, PRD §20, §23.3)

Location: `apps/server/src/persistence/`. Uses Node's built-in `node:sqlite` (`DatabaseSync`, Node >= 22.13) — no native npm module.
The database runs in ONE dedicated `worker_threads` worker (the "isolated SQLite writer"); the main thread (room authority) never blocks on disk.
The main-thread facade is `Store` (async, promise per request, FIFO queue, request IDs). Measure queue age per request.

Pragmas at open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL` (durable commits for score/checkpoint transactions — do not claim durability from the async queue alone).

Data dir default: `<repo>/data` (override with env `CURSEBOUND_DATA_DIR`). Files: `data/cursebound.sqlite`, `data/replays/<runId>/<chunkNo>.json.gz`, `data/backups/`, `data/logs/`.

## Migrations
`migrations.ts` — ordered array `{version:number, name:string, sql:string}`; table `schema_meta(version INTEGER NOT NULL)`.
Before applying any migration to an existing non-empty DB, create a backup using `node:sqlite`'s `backup(db, path)` (fall back to `VACUUM INTO`) at `data/backups/pre-migration-v<from>-to-v<to>-<timestamp>.sqlite`. Never copy the raw file while ignoring WAL.
Document rollback instructions in `docs/OPERATIONS.md` (restore the pre-migration backup with `npm run db:restore -- <file>` while server is stopped).

## Schema (PRD §20.2) — exact tables
- profiles(id TEXT PK, display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 24), created_at INTEGER NOT NULL)
- settings(profile_id TEXT PK REFERENCES profiles(id), schema_version INTEGER NOT NULL, json TEXT NOT NULL CHECK(length(json) <= 65536))
- content_versions(hash TEXT PK, rules_version TEXT NOT NULL, manifest_path TEXT NOT NULL, created_at INTEGER NOT NULL)
- runs(id TEXT PK, seed TEXT NOT NULL, content_hash TEXT NOT NULL REFERENCES content_versions(hash), score_version TEXT NOT NULL, mode TEXT NOT NULL,
       trust TEXT NOT NULL, n INTEGER NOT NULL CHECK(n BETWEEN 1 AND 5), status TEXT NOT NULL, end_reason TEXT, round INTEGER NOT NULL DEFAULT 0,
       ticks INTEGER NOT NULL DEFAULT 0, score_text TEXT NOT NULL DEFAULT '0', score_digits INTEGER NOT NULL DEFAULT 1,
       board_key TEXT NOT NULL, challenge_id TEXT, resumed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
       summary_json TEXT, created_at INTEGER NOT NULL, completed_at INTEGER,
       CHECK(score_text GLOB '0' OR (score_text GLOB '[1-9]*' AND score_text NOT GLOB '*[^0-9]*')), CHECK(score_digits = length(score_text)))
  index on (board_key, score_digits DESC, score_text DESC)
  status values: 'active' | 'finalized' | 'pending_storage' | 'aborted' | 'invalidated'
- run_members(run_id TEXT REFERENCES runs(id), slot INTEGER CHECK(slot BETWEEN 0 AND 4), profile_id TEXT REFERENCES profiles(id), class_id TEXT NOT NULL,
       build_json TEXT NOT NULL, PRIMARY KEY(run_id, slot), UNIQUE(run_id, profile_id))
- round_results(run_id, round_no INTEGER, objective_total INTEGER, completed_weight INTEGER, active_ticks INTEGER, score_text TEXT, cleared INTEGER, detail_json TEXT, PRIMARY KEY(run_id, round_no))  — finalized once (INSERT only; conflicting insert with different data is an error, identical is a no-op)
- fate_offers(id TEXT PK, run_id TEXT REFERENCES runs(id), after_round INTEGER, cards_json TEXT, snapshot_hash TEXT, deadline_tick INTEGER NULL, UNIQUE(run_id, after_round))
- fate_votes(offer_id TEXT REFERENCES fate_offers(id), member_slot INTEGER, seq INTEGER, card_slot TEXT CHECK(card_slot IN ('A','B','C')), locked INTEGER, PRIMARY KEY(offer_id, member_slot))  — monotonic upsert: only update when new seq > stored seq
- run_events(run_id TEXT, seq INTEGER, tick INTEGER, type TEXT, payload_json TEXT, prev_hash TEXT, hash TEXT, created_at INTEGER, PRIMARY KEY(run_id, seq))
  hash = sha256hex(prev_hash + '|' + run_id + '|' + seq + '|' + tick + '|' + type + '|' + payload_json); first prev_hash = '0'*64. Computed in the worker.
- fate_commits(offer_id TEXT PK REFERENCES fate_offers(id), card_id TEXT, run_id TEXT, event_seq INTEGER, tie_json TEXT, state_hash TEXT,
       FOREIGN KEY(run_id, event_seq) REFERENCES run_events(run_id, seq))
- checkpoints(run_id TEXT, seq INTEGER, schema_version INTEGER, state_blob TEXT, checksum TEXT, created_at INTEGER, PRIMARY KEY(run_id, seq))
- replay_chunks(run_id TEXT, chunk_no INTEGER, first_tick INTEGER, last_tick INTEGER, path TEXT, checksum TEXT, byte_count INTEGER, PRIMARY KEY(run_id, chunk_no))
- board_entries(board_key TEXT, run_id TEXT REFERENCES runs(id), score_text TEXT, score_digits INTEGER, depth INTEGER, active_ticks INTEGER, completed_at INTEGER,
       verified_at INTEGER NULL, trust TEXT NOT NULL, participants_json TEXT NOT NULL, practice INTEGER NOT NULL DEFAULT 0, UNIQUE(board_key, run_id))
  index (board_key, practice, score_digits DESC, score_text DESC, depth DESC, active_ticks ASC, completed_at ASC, run_id ASC)
- verification(run_id TEXT PK REFERENCES runs(id), status TEXT CHECK(status IN ('local','pending','verified','invalid','archived')), reason_code TEXT, reviewer TEXT, updated_at INTEGER)
- verification_audit(id INTEGER PK AUTOINCREMENT, run_id TEXT, actor TEXT, prior_status TEXT, new_status TEXT, reason TEXT, created_at INTEGER)

- v4 (progression and the daily bounty): `profiles.xp INTEGER NOT NULL DEFAULT 0`, `profiles.cloud_xp INTEGER NULL`;
  xp_awards(run_id, profile_id, xp, base_xp, bounty, xp_before, created_at, PRIMARY KEY(run_id, profile_id));
  daily_bounties(id TEXT PK, modifier_id, created_at, expires_at); bounty_completions(bounty_id, profile_id, run_id, completed_at,
  PRIMARY KEY(bounty_id, profile_id)). `finalizeRun({ …, progress })` credits each member in the same transaction (finalized runs
  only, once per run and profile) and returns `{ existing, awards }`; `ensureBounty` rolls inside one transaction.

Timestamps are epoch ms UTC integers. Score is ONLY ever TEXT (never REAL/INTEGER).

## Store facade (`apps/server/src/persistence/store.ts`)
```ts
export interface StoreOptions { dataDir: string; }
export async function openStore(opts: StoreOptions): Promise<Store>;
export interface Store {
  health(): Promise<{ ok: boolean; schemaVersion: number; walBytes: number; queueDepth: number; lastQueueAgeMs: number }>;
  createProfile(displayName: string): Promise<{ id: string; displayName: string; createdAt: number }>;  // sanitize: trim, collapse whitespace, strip control chars, max 24
  getProfile(id: string): Promise<{ id: string; displayName: string; createdAt: number } | null>;
  getSettings(profileId: string): Promise<unknown | null>;
  putSettings(profileId: string, json: unknown, schemaVersion: number): Promise<void>; // JSON.stringify length <= 65536 else throw
  ensureContentVersion(v: { hash: string; rulesVersion: string; manifestPath: string }): Promise<void>;
  createRun(r: { id: string; seed: string; contentHash: string; scoreVersion: string; mode: string; trust: string; n: number; boardKey: string; challengeId: string | null;
                 members: { slot: number; profileId: string; classId: string; buildJson: string }[] }): Promise<void>;
  updateRunProgress(p: { id: string; round: number; ticks: number; scoreText: string; status?: string }): Promise<void>;
  recordRoundResult(r: { runId: string; roundNo: number; objectiveTotal: number; completedWeight: number; activeTicks: number; scoreText: string; cleared: boolean; detailJson: string }): Promise<void>;
  createOffer(o: { id: string; runId: string; afterRound: number; cardsJson: string; snapshotHash: string; deadlineTick: number | null }): Promise<void>; // idempotent on identical
  upsertVote(v: { offerId: string; memberSlot: number; seq: number; cardSlot: 'A'|'B'|'C'; locked: boolean }): Promise<{ applied: boolean }>;
  appendEvents(runId: string, events: { seq: number; tick: number; type: string; payloadJson: string }[]): Promise<{ lastHash: string }>;
  /** ONE transaction: insert run_event (hash chained), fate_commits row, update runs.round/status, insert checkpoint. Idempotent: if a commit for offerId
   *  exists, return it unchanged (existing: true) and write nothing. */
  commitFate(c: { offerId: string; runId: string; cardId: string; tieJson: string; stateHash: string;
                  event: { seq: number; tick: number; type: string; payloadJson: string };
                  checkpoint: { seq: number; schemaVersion: number; stateBlob: string; checksum: string };
                  round: number; ticks: number; scoreText: string }): Promise<{ existing: boolean; cardId: string; stateHash: string; eventSeq: number }>;
  getCommit(offerId: string): Promise<{ cardId: string; stateHash: string; eventSeq: number; tieJson: string } | null>;
  saveCheckpoint(c: { runId: string; seq: number; schemaVersion: number; stateBlob: string; checksum: string }): Promise<void>;
  latestCheckpoint(runId: string): Promise<{ seq: number; schemaVersion: number; stateBlob: string; checksum: string } | null>; // verify checksum (sha256 hex of stateBlob) in worker; throw on mismatch
  writeReplayChunk(c: { runId: string; chunkNo: number; firstTick: number; lastTick: number; json: string }): Promise<{ path: string; checksum: string; byteCount: number }>;
       // gzip json -> write data/replays/<runId>/<chunkNo>.json.gz.tmp, fsync, verify checksum by re-reading, atomic rename, THEN insert DB row. Idempotent per (run, chunk).
       // runId must match /^[A-Za-z0-9_-]{1,64}$/ (no client supplied paths ever)
  readReplay(runId: string): Promise<{ chunkNo: number; firstTick: number; lastTick: number; json: string }[]>; // verifies checksums
  /** Idempotent by runId. Writes runs final fields, board_entries row (practice flag), verification row status 'local'. */
  finalizeRun(f: { runId: string; status: 'finalized' | 'aborted' | 'invalidated' | 'pending_storage'; endReason: string; scoreText: string; depth: number; activeTicks: number;
                   boardKey: string; trust: string; participantsJson: string; summaryJson: string; practice: boolean }): Promise<{ existing: boolean }>;
  queryBoard(q: { boardKey: string; limit: number; cursor?: string | null; includePractice?: boolean }): Promise<{ rows: BoardRow[]; nextCursor: string | null }>;
       // keyset pagination: cursor = base64url(JSON of the full last sort tuple). limit 1..100. Order: score_digits DESC, score_text DESC, depth DESC, active_ticks ASC, completed_at ASC, run_id ASC
  listBoardKeys(): Promise<{ boardKey: string; count: number }[]>;
  getRun(runId: string): Promise<RunSummary | null>; // run row + members + round results + fate timeline (offers joined with commits)
  listRuns(q: { profileId?: string; status?: string; limit: number }): Promise<RunListItem[]>;
  hasRankedAttempt(boardKey: string, profileIds: string[]): Promise<boolean>; // for one-attempt-per-challenge policy
  setFavorite(runId: string, favorite: boolean): Promise<void>;
  setVerification(runId: string, status: string, actor: string, reason: string): Promise<void>; // writes audit row
  backup(destPath: string): Promise<{ path: string; bytes: number }>;
  enforceRetention(opts?: { replayBytes?: number }): Promise<{ evictedRuns: string[] }>; // default 1 GiB replays; never evict favorite or active runs
  close(): Promise<void>; // flush queue, close db, terminate worker
}
export interface BoardRow { rank: number; runId: string; scoreText: string; depth: number; activeTicks: number; completedAt: number; trust: string; participants: { name: string; classId: string }[]; verification: string; practice: boolean }
```
Also `apps/server/src/persistence/logger.ts`: structured JSON-lines local logger (REQ TEL01) writing `data/logs/cursebound-YYYYMMDD.log`, rolling total cap 100 MB (delete oldest files), fields `{ts, level, build, runId?, event, phase?, ...bounded fields}`; redacts keys named token/seatToken/secret/password; no IPs.

CLI: `apps/server/src/cli/backup.ts` (`npm run db:backup -- [dest]`) and `apps/server/src/cli/restore.ts` (`npm run db:restore -- <file>`; refuses while server port 2567 is in use; copies current DB to backups first).

Tests: `apps/server/test/persistence.test.ts` with a temp data dir: migrations, fate commit idempotency (A14: commit, simulate crash by reopening store, recommit same offer -> existing:true, one event), vote monotonic upsert, board ordering with Appendix A4 fixture, keyset cursor pagination, checkpoint checksum tamper detection, replay chunk atomic write + checksum, finalize idempotency, score text CHECK constraint rejects '007'.
