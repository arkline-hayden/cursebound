/**
 * Database operations of the isolated SQLite writer (REQ DATA01). Instantiated ONLY inside the
 * persistence worker (worker.ts); it owns the single connection. Every multi-row write is one short
 * transaction with synchronous=FULL.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { applyPragmas, readSchemaVersion, runMigrations, type MigrationResult } from './migrate';
import { MIGRATIONS } from './migrations';
import {
  assertId,
  assertInt,
  assertJsonText,
  assertScore,
  assertText,
  CONTENT_HASH_RE,
  dataPaths,
  ID_RE,
  sanitizeDisplayName,
  sanitizeFreeText,
  StoreError,
  type DataPaths,
} from './paths';
import { backupDatabase, loadSqlite, type DatabaseSync, type SqliteModule } from './sqlite';
import type {
  Account,
  AccountCredentials,
  AccountStats,
  FriendEntry,
  FriendState,
  SavedBuild,
  SavedBuildInput,
  SessionInfo,
  BoardRow,
  CheckpointInput,
  CommitFateInput,
  CreateRunInput,
  EventInput,
  FateTimelineEntry,
  FinalizeRunInput,
  Profile,
  RunListItem,
  RunStatus,
  RunSummary,
  VerificationStatus,
} from './types';

type Row = Record<string, unknown>;
type SqlValue = string | number | bigint | null | Uint8Array;

const ZERO_HASH = '0'.repeat(64);
const TERMINAL: ReadonlySet<string> = new Set(['finalized', 'aborted', 'invalidated']);
const RUN_STATUSES: ReadonlySet<string> = new Set(['active', 'finalized', 'pending_storage', 'aborted', 'invalidated']);
const VERIFICATION_STATUSES: ReadonlySet<string> = new Set(['local', 'pending', 'verified', 'invalid', 'archived']);
const DEFAULT_REPLAY_BYTES = 1024 * 1024 * 1024;
const MAX_REPLAY_JSON = 64 * 1024 * 1024;
const MAX_BLOB = 16 * 1024 * 1024;

export function sha256hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function eventHash(prevHash: string, runId: string, seq: number, tick: number, type: string, payloadJson: string): string {
  return sha256hex(`${prevHash}|${runId}|${seq}|${tick}|${type}|${payloadJson}`);
}

function bool(v: unknown): boolean {
  return v === 1 || v === 1n || v === true;
}
function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : (v as number);
}
function str(v: unknown): string {
  return v as string;
}
function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : (v as string);
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

interface CursorTuple {
  d: number;
  s: string;
  dep: number;
  at: number;
  ca: number;
  rid: string;
}

function encodeCursor(t: CursorTuple): string {
  return Buffer.from(JSON.stringify([t.d, t.s, t.dep, t.at, t.ca, t.rid]), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorTuple {
  const bad = () => new StoreError('INVALID_INPUT', 'invalid board cursor');
  if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad();
  let arr: unknown;
  try {
    arr = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!Array.isArray(arr) || arr.length !== 6) throw bad();
  const [d, s, dep, at, ca, rid] = arr as unknown[];
  const isInt = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x);
  if (!isInt(d) || typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s) || !isInt(dep) || !isInt(at) || !isInt(ca)) throw bad();
  if (typeof rid !== 'string' || !ID_RE.test(rid)) throw bad();
  return { d: d as number, s, dep: dep as number, at: at as number, ca: ca as number, rid };
}

function parseParticipants(json: string): { name: string; classId: string }[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.slice(0, 5).map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        name: typeof o.name === 'string' ? o.name : typeof o.displayName === 'string' ? o.displayName : '',
        classId: typeof o.classId === 'string' ? o.classId : '',
      };
    });
  } catch {
    return [];
  }
}

const BOARD_AFTER = `(b.score_digits < $d OR (b.score_digits = $d AND (b.score_text < $s OR (b.score_text = $s AND (b.depth < $dep OR (b.depth = $dep AND (b.active_ticks > $at OR (b.active_ticks = $at AND (b.completed_at > $ca OR (b.completed_at = $ca AND b.run_id > $rid))))))))))`;
const BOARD_ORDER = `ORDER BY b.score_digits DESC, b.score_text DESC, b.depth DESC, b.active_ticks ASC, b.completed_at ASC, b.run_id ASC`;
const BOARD_BASE = `FROM board_entries b LEFT JOIN verification v ON v.run_id = b.run_id
  WHERE b.board_key = $bk AND ($inc = 1 OR b.practice = 0) AND coalesce(v.status, 'local') NOT IN ('invalid', 'archived')
  AND ($pids IS NULL OR EXISTS (SELECT 1 FROM run_members m WHERE m.run_id = b.run_id AND m.profile_id IN (SELECT value FROM json_each($pids))))`;

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const ACCOUNT_COLS = `a.id, a.username, a.profile_id, p.display_name, a.favorite_class, a.motto, a.created_at, a.last_login_at`;
const ACCOUNT_FROM = `FROM accounts a JOIN profiles p ON p.id = a.profile_id`;

function toAccount(r: Row): Account {
  return {
    id: str(r.id),
    username: str(r.username),
    profileId: str(r.profile_id),
    displayName: str(r.display_name),
    favoriteClass: strOrNull(r.favorite_class),
    motto: str(r.motto),
    createdAt: num(r.created_at),
    lastLoginAt: numOrNull(r.last_login_at),
  };
}

function toSession(r: Row): SessionInfo {
  return {
    tokenHash: str(r.token_hash),
    accountId: str(r.account_id),
    createdAt: num(r.created_at),
    lastSeenAt: num(r.last_seen_at),
    expiresAt: num(r.expires_at),
    label: str(r.label),
  };
}

function toBuild(r: Row): SavedBuild {
  return {
    id: str(r.id),
    name: str(r.name),
    classId: str(r.class_id),
    ranks: JSON.parse(str(r.ranks_json)) as Record<string, number>,
    mastery: strOrNull(r.mastery),
    notes: str(r.notes),
    sourceRunId: strOrNull(r.source_run_id),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/** Bigger canonical decimal string wins (digit length first, then lexicographic). */
function maxScore(a: string, b: string): string {
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return a >= b ? a : b;
}

function assertRanks(ranks: unknown): Record<string, number> {
  if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks)) throw new StoreError('INVALID_INPUT', 'ranks must be an object');
  const out: Record<string, number> = {};
  const entries = Object.entries(ranks as Record<string, unknown>);
  if (entries.length > 200) throw new StoreError('INVALID_INPUT', 'too many ranked nodes');
  for (const [k, v] of entries) {
    if (!/^[a-z0-9_]{1,64}$/.test(k)) throw new StoreError('INVALID_INPUT', 'invalid node id');
    out[k] = assertInt(v, `rank of ${k}`, 0, 99);
  }
  return out;
}

const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export class PersistenceDb {
  private readonly stmts = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private closed = false;

  private constructor(
    private readonly sqlite: SqliteModule,
    private readonly db: DatabaseSync,
    readonly paths: DataPaths,
  ) {}

  static async open(dataDir: string): Promise<{ db: PersistenceDb; migration: MigrationResult; cleanup: { tmpRemoved: number; orphansRemoved: number } }> {
    const paths = dataPaths(dataDir);
    for (const d of [paths.dataDir, paths.replaysDir, paths.backupsDir, paths.logsDir]) mkdirSync(d, { recursive: true });
    const sqlite = await loadSqlite();
    const raw = new sqlite.DatabaseSync(paths.dbFile);
    try {
      applyPragmas(raw);
      const migration = await runMigrations(sqlite, raw, MIGRATIONS, paths.backupsDir);
      const db = new PersistenceDb(sqlite, raw, paths);
      const cleanup = db.collectReplayGarbage();
      return { db, migration, cleanup };
    } catch (err) {
      raw.close();
      throw err;
    }
  }

  // ---------------------------------------------------------------- helpers
  private st(sql: string) {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }
  private get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.st(sql).get(...params) as Row | undefined;
  }
  private getNamed(sql: string, params: Record<string, SqlValue>): Row | undefined {
    return this.st(sql).get(params) as Row | undefined;
  }
  private all(sql: string, ...params: SqlValue[]): Row[] {
    return this.st(sql).all(...params) as Row[];
  }
  private run(sql: string, ...params: SqlValue[]): { changes: number } {
    const r = this.st(sql).run(...params);
    return { changes: num(r.changes) };
  }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // already rolled back by SQLite
      }
      throw err;
    }
  }
  private requireRun(runId: string): Row {
    const r = this.get('SELECT * FROM runs WHERE id = ?', runId);
    if (!r) throw new StoreError('NOT_FOUND', `run ${runId} not found`);
    return r;
  }
  private requireMutableRun(runId: string): Row {
    const r = this.requireRun(runId);
    if (TERMINAL.has(str(r.status))) throw new StoreError('RUN_FINALIZED', `run ${runId} is ${String(r.status)}`);
    return r;
  }
  private replayFile(runId: string, chunkNo: number): { abs: string; rel: string } {
    assertId(runId, 'runId');
    const rel = `replays/${runId}/${chunkNo}.json.gz`;
    const abs = path.join(this.paths.replaysDir, runId, `${chunkNo}.json.gz`);
    const rootWithSep = this.paths.replaysDir + path.sep;
    if (!abs.startsWith(rootWithSep)) throw new StoreError('INVALID_INPUT', 'replay path escapes data dir');
    return { abs, rel };
  }

  /** Remove *.tmp chunk files and chunk files never published to the DB (crash between rename and insert). */
  private collectReplayGarbage(): { tmpRemoved: number; orphansRemoved: number } {
    let tmpRemoved = 0;
    let orphansRemoved = 0;
    if (!existsSync(this.paths.replaysDir)) return { tmpRemoved, orphansRemoved };
    for (const dir of readdirSync(this.paths.replaysDir, { withFileTypes: true })) {
      if (!dir.isDirectory() || !ID_RE.test(dir.name)) continue;
      const runDir = path.join(this.paths.replaysDir, dir.name);
      for (const f of readdirSync(runDir)) {
        const full = path.join(runDir, f);
        if (f.endsWith('.tmp')) {
          rmSync(full, { force: true });
          tmpRemoved++;
          continue;
        }
        const m = /^(\d{1,9})\.json\.gz$/.exec(f);
        if (!m) continue;
        const ref = this.get('SELECT 1 AS x FROM replay_chunks WHERE run_id = ? AND chunk_no = ?', dir.name, Number(m[1]));
        if (!ref) {
          rmSync(full, { force: true });
          orphansRemoved++;
        }
      }
    }
    return { tmpRemoved, orphansRemoved };
  }

  // ---------------------------------------------------------------- health
  health(): { ok: boolean; schemaVersion: number; walBytes: number } {
    const ok = !!this.get('SELECT 1 AS one');
    let walBytes = 0;
    try {
      walBytes = statSync(this.paths.dbFile + '-wal').size;
    } catch {
      walBytes = 0;
    }
    return { ok, schemaVersion: readSchemaVersion(this.db), walBytes };
  }

  // ---------------------------------------------------------------- profiles & settings
  createProfile(displayName: string): Profile {
    const name = sanitizeDisplayName(displayName);
    const p: Profile = { id: randomUUID(), displayName: name, createdAt: Date.now() };
    this.run('INSERT INTO profiles(id, display_name, created_at) VALUES (?, ?, ?)', p.id, p.displayName, p.createdAt);
    return p;
  }

  getProfile(id: string): Profile | null {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const r = this.get('SELECT id, display_name, created_at FROM profiles WHERE id = ?', id);
    return r ? { id: str(r.id), displayName: str(r.display_name), createdAt: num(r.created_at) } : null;
  }

  /** The profile linked to a cloud account (created when absent); its display name follows the account's. */
  linkCloudProfile(accountId: string, displayName: string): Profile {
    assertId(accountId, 'accountId');
    const name = sanitizeDisplayName(displayName);
    return this.tx(() => {
      const r = this.get('SELECT id, created_at FROM profiles WHERE cloud_account_id = ?', accountId);
      if (r) {
        this.run('UPDATE profiles SET display_name = ? WHERE id = ?', name, str(r.id));
        return { id: str(r.id), displayName: name, createdAt: num(r.created_at) };
      }
      const p: Profile = { id: randomUUID(), displayName: name, createdAt: Date.now() };
      this.run('INSERT INTO profiles(id, display_name, created_at, cloud_account_id) VALUES (?, ?, ?, ?)', p.id, p.displayName, p.createdAt, accountId);
      return p;
    });
  }

  getSettings(profileId: string): unknown | null {
    assertId(profileId, 'profileId');
    const r = this.get('SELECT json FROM settings WHERE profile_id = ?', profileId);
    return r ? (JSON.parse(str(r.json)) as unknown) : null;
  }

  putSettings(profileId: string, json: unknown, schemaVersion: number): void {
    assertId(profileId, 'profileId');
    assertInt(schemaVersion, 'schemaVersion', 0, 1_000_000);
    const text = JSON.stringify(json);
    if (typeof text !== 'string') throw new StoreError('INVALID_INPUT', 'settings must be JSON-serialisable');
    if (text.length > 65536) throw new StoreError('INVALID_INPUT', 'settings JSON exceeds 65536 chars');
    if (!this.get('SELECT 1 AS x FROM profiles WHERE id = ?', profileId)) throw new StoreError('NOT_FOUND', 'profile not found');
    this.run(
      `INSERT INTO settings(profile_id, schema_version, json) VALUES (?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET schema_version = excluded.schema_version, json = excluded.json`,
      profileId,
      schemaVersion,
      text,
    );
  }

  // ---------------------------------------------------------------- accounts & sessions
  /**
   * Create an account. With `claimProfileId` the account adopts an existing unclaimed local profile (its runs,
   * settings and records come along); otherwise a fresh profile is created. Username uniqueness is case-insensitive.
   */
  createAccount(a: { id: string; username: string; passwordHash: string; displayName: string; claimProfileId: string | null }): Account {
    assertId(a?.id, 'account id');
    if (typeof a.username !== 'string' || !USERNAME_RE.test(a.username)) throw new StoreError('INVALID_INPUT', 'username must be 3-20 letters, digits or _');
    assertText(a.passwordHash, 'passwordHash', 512);
    const name = sanitizeDisplayName(a.displayName);
    return this.tx(() => {
      if (this.get('SELECT 1 AS x FROM accounts WHERE username = ?', a.username)) throw new StoreError('CONFLICT', 'that username is taken');
      const now = Date.now();
      let profileId: string;
      if (a.claimProfileId) {
        assertId(a.claimProfileId, 'claimProfileId');
        if (!this.get('SELECT 1 AS x FROM profiles WHERE id = ?', a.claimProfileId)) throw new StoreError('NOT_FOUND', 'profile not found');
        if (this.get('SELECT 1 AS x FROM accounts WHERE profile_id = ?', a.claimProfileId)) throw new StoreError('CONFLICT', 'that profile already belongs to an account');
        profileId = a.claimProfileId;
        this.run('UPDATE profiles SET display_name = ? WHERE id = ?', name, profileId);
      } else {
        profileId = randomUUID();
        this.run('INSERT INTO profiles(id, display_name, created_at) VALUES (?, ?, ?)', profileId, name, now);
      }
      this.run(
        'INSERT INTO accounts(id, username, password_hash, profile_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)',
        a.id,
        a.username,
        a.passwordHash,
        profileId,
        now,
        now,
      );
      return toAccount(this.get(`SELECT ${ACCOUNT_COLS} ${ACCOUNT_FROM} WHERE a.id = ?`, a.id)!);
    });
  }

  getAccountCredentials(username: string): AccountCredentials | null {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
    const r = this.get(`SELECT ${ACCOUNT_COLS}, a.password_hash, a.failed_logins, a.locked_until ${ACCOUNT_FROM} WHERE a.username = ?`, username);
    if (!r) return null;
    return { ...toAccount(r), passwordHash: str(r.password_hash), failedLogins: num(r.failed_logins), lockedUntil: num(r.locked_until) };
  }

  getAccount(id: string): Account | null {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const r = this.get(`SELECT ${ACCOUNT_COLS} ${ACCOUNT_FROM} WHERE a.id = ?`, id);
    return r ? toAccount(r) : null;
  }

  getAccountByUsername(username: string): Account | null {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
    const r = this.get(`SELECT ${ACCOUNT_COLS} ${ACCOUNT_FROM} WHERE a.username = ?`, username);
    return r ? toAccount(r) : null;
  }

  getAccountByProfile(profileId: string): Account | null {
    if (typeof profileId !== 'string' || !ID_RE.test(profileId)) return null;
    const r = this.get(`SELECT ${ACCOUNT_COLS} ${ACCOUNT_FROM} WHERE a.profile_id = ?`, profileId);
    return r ? toAccount(r) : null;
  }

  /** Success clears the failure counter; `lockAfter` consecutive failures lock the account for `lockMs`. */
  recordLogin(accountId: string, ok: boolean, lockAfter: number, lockMs: number): void {
    assertId(accountId, 'accountId');
    assertInt(lockAfter, 'lockAfter', 1, 1000);
    assertInt(lockMs, 'lockMs', 0, 86_400_000);
    const now = Date.now();
    if (ok) {
      this.run('UPDATE accounts SET failed_logins = 0, locked_until = 0, last_login_at = ? WHERE id = ?', now, accountId);
      return;
    }
    this.run(
      `UPDATE accounts SET
         locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END,
         failed_logins = CASE WHEN failed_logins + 1 >= ? THEN 0 ELSE failed_logins + 1 END
       WHERE id = ?`,
      lockAfter,
      now + lockMs,
      lockAfter,
      accountId,
    );
  }

  updateAccount(accountId: string, patch: { displayName?: string; favoriteClass?: string | null; motto?: string }): Account {
    assertId(accountId, 'accountId');
    return this.tx(() => {
      const acc = this.getAccount(accountId);
      if (!acc) throw new StoreError('NOT_FOUND', 'account not found');
      if (patch.displayName !== undefined) this.run('UPDATE profiles SET display_name = ? WHERE id = ?', sanitizeDisplayName(patch.displayName), acc.profileId);
      if (patch.favoriteClass !== undefined) {
        if (patch.favoriteClass !== null) assertText(patch.favoriteClass, 'favoriteClass', 64);
        this.run('UPDATE accounts SET favorite_class = ? WHERE id = ?', patch.favoriteClass, accountId);
      }
      if (patch.motto !== undefined) {
        const motto = sanitizeFreeText(patch.motto, 120);
        this.run('UPDATE accounts SET motto = ? WHERE id = ?', motto, accountId);
      }
      return this.getAccount(accountId)!;
    });
  }

  /** Changing the password revokes every other session (the caller's own session survives when given). */
  setPasswordHash(accountId: string, passwordHash: string, keepSessionHash: string | null): void {
    assertId(accountId, 'accountId');
    assertText(passwordHash, 'passwordHash', 512);
    this.tx(() => {
      const r = this.run('UPDATE accounts SET password_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?', passwordHash, accountId);
      if (r.changes === 0) throw new StoreError('NOT_FOUND', 'account not found');
      this.run('DELETE FROM sessions WHERE account_id = ? AND token_hash IS NOT ?', accountId, keepSessionHash);
    });
  }

  createSession(s: SessionInfo): void {
    if (typeof s?.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(s.tokenHash)) throw new StoreError('INVALID_INPUT', 'invalid token hash');
    assertId(s.accountId, 'accountId');
    assertInt(s.createdAt, 'createdAt');
    assertInt(s.expiresAt, 'expiresAt');
    const label = sanitizeFreeText(s.label ?? '', 120);
    this.tx(() => {
      this.run('DELETE FROM sessions WHERE expires_at <= ?', s.createdAt);
      this.run(
        'INSERT INTO sessions(token_hash, account_id, created_at, last_seen_at, expires_at, label) VALUES (?, ?, ?, ?, ?, ?)',
        s.tokenHash,
        s.accountId,
        s.createdAt,
        s.createdAt,
        s.expiresAt,
        label,
      );
      // bound live sessions per account: drop the stalest beyond 20
      this.run(
        `DELETE FROM sessions WHERE account_id = ?1 AND token_hash NOT IN
           (SELECT token_hash FROM sessions WHERE account_id = ?1 ORDER BY last_seen_at DESC LIMIT 20)`,
        s.accountId,
      );
    });
  }

  /** Valid (unexpired) session or null. With `extendTo`, slides the expiry forward (at most once a minute). */
  getSession(tokenHash: string, now: number, extendTo: number | null): SessionInfo | null {
    if (typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) return null;
    const r = this.get('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
    if (!r) return null;
    const s = toSession(r);
    if (s.expiresAt <= now) {
      this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }
    if (extendTo !== null && now - s.lastSeenAt > 60_000) {
      this.run('UPDATE sessions SET last_seen_at = ?, expires_at = max(expires_at, ?) WHERE token_hash = ?', now, extendTo, tokenHash);
      s.lastSeenAt = now;
      s.expiresAt = Math.max(s.expiresAt, extendTo);
    }
    return s;
  }

  deleteSession(tokenHash: string): void {
    if (typeof tokenHash !== 'string') return;
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  listSessions(accountId: string): SessionInfo[] {
    assertId(accountId, 'accountId');
    return this.all('SELECT * FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', accountId, Date.now()).map(toSession);
  }

  deleteOtherSessions(accountId: string, keepTokenHash: string): number {
    assertId(accountId, 'accountId');
    return this.run('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?', accountId, keepTokenHash).changes;
  }

  // ---------------------------------------------------------------- saved builds
  listBuilds(accountId: string): SavedBuild[] {
    assertId(accountId, 'accountId');
    return this.all('SELECT * FROM saved_builds WHERE account_id = ? ORDER BY updated_at DESC, id', accountId).map(toBuild);
  }

  /** Insert or update (by id, only within the owning account). */
  saveBuild(accountId: string, buildId: string, b: SavedBuildInput, maxBuilds: number): SavedBuild {
    assertId(accountId, 'accountId');
    assertId(buildId, 'buildId');
    const name = sanitizeFreeText(b?.name, 40);
    if (!name) throw new StoreError('INVALID_INPUT', 'build name required');
    assertText(b.classId, 'classId', 64);
    const ranks = assertRanks(b.ranks);
    if (b.mastery !== null) assertText(b.mastery, 'mastery', 64);
    const notes = sanitizeFreeText(b.notes ?? '', 500, true);
    if (b.sourceRunId !== null) assertId(b.sourceRunId, 'sourceRunId');
    return this.tx(() => {
      const now = Date.now();
      const ex = this.get('SELECT account_id FROM saved_builds WHERE id = ?', buildId);
      if (ex) {
        if (ex.account_id !== accountId) throw new StoreError('NOT_FOUND', 'build not found');
        this.run(
          'UPDATE saved_builds SET name = ?, class_id = ?, ranks_json = ?, mastery = ?, notes = ?, updated_at = ? WHERE id = ?',
          name, b.classId, JSON.stringify(ranks), b.mastery, notes, now, buildId,
        );
      } else {
        const count = num((this.get('SELECT count(*) AS c FROM saved_builds WHERE account_id = ?', accountId) as Row).c);
        if (count >= maxBuilds) throw new StoreError('CONFLICT', `you can keep at most ${maxBuilds} saved builds`);
        this.run(
          `INSERT INTO saved_builds(id, account_id, name, class_id, ranks_json, mastery, notes, source_run_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          buildId, accountId, name, b.classId, JSON.stringify(ranks), b.mastery, notes, b.sourceRunId, now, now,
        );
      }
      return toBuild(this.get('SELECT * FROM saved_builds WHERE id = ?', buildId)!);
    });
  }

  deleteBuild(accountId: string, buildId: string): void {
    assertId(accountId, 'accountId');
    assertId(buildId, 'buildId');
    const r = this.run('DELETE FROM saved_builds WHERE id = ? AND account_id = ?', buildId, accountId);
    if (r.changes === 0) throw new StoreError('NOT_FOUND', 'build not found');
  }

  // ---------------------------------------------------------------- friends
  listFriends(accountId: string): FriendEntry[] {
    assertId(accountId, 'accountId');
    return this.all(
      `SELECT ${ACCOUNT_COLS}, f.status, f.requester, f.updated_at AS since
       FROM friendships f
       JOIN accounts a ON a.id = CASE WHEN f.account_a = ?1 THEN f.account_b ELSE f.account_a END
       JOIN profiles p ON p.id = a.profile_id
       WHERE f.account_a = ?1 OR f.account_b = ?1
       ORDER BY f.status = 'accepted' DESC, lower(a.username)`,
      accountId,
    ).map((r) => ({
      accountId: str(r.id),
      username: str(r.username),
      displayName: str(r.display_name),
      profileId: str(r.profile_id),
      favoriteClass: strOrNull(r.favorite_class),
      state: (r.status === 'accepted' ? 'friends' : r.requester === accountId ? 'outgoing' : 'incoming') as FriendState,
      since: num(r.since),
    }));
  }

  /** Send a request; if the other side already asked, this accepts it. Returns the resulting state. */
  requestFriend(accountId: string, targetId: string): FriendState {
    assertId(accountId, 'accountId');
    assertId(targetId, 'targetId');
    if (accountId === targetId) throw new StoreError('INVALID_INPUT', 'you cannot befriend yourself');
    const [a, b] = pair(accountId, targetId);
    return this.tx(() => {
      if (!this.get('SELECT 1 AS x FROM accounts WHERE id = ?', targetId)) throw new StoreError('NOT_FOUND', 'no such player');
      const now = Date.now();
      const ex = this.get('SELECT status, requester FROM friendships WHERE account_a = ? AND account_b = ?', a, b);
      if (ex) {
        if (ex.status === 'accepted') return 'friends';
        if (ex.requester === accountId) return 'outgoing';
        this.run("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE account_a = ? AND account_b = ?", now, a, b);
        return 'friends';
      }
      const pending = num((this.get("SELECT count(*) AS c FROM friendships WHERE requester = ? AND status = 'pending'", accountId) as Row).c);
      if (pending >= 50) throw new StoreError('CONFLICT', 'too many pending friend requests');
      this.run("INSERT INTO friendships(account_a, account_b, requester, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)", a, b, accountId, now, now);
      return 'outgoing';
    });
  }

  respondFriend(accountId: string, otherId: string, accept: boolean): void {
    assertId(accountId, 'accountId');
    assertId(otherId, 'otherId');
    const [a, b] = pair(accountId, otherId);
    this.tx(() => {
      const ex = this.get('SELECT status, requester FROM friendships WHERE account_a = ? AND account_b = ?', a, b);
      if (!ex || ex.status !== 'pending' || ex.requester === accountId) throw new StoreError('NOT_FOUND', 'no pending request from that player');
      if (accept) this.run("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE account_a = ? AND account_b = ?", Date.now(), a, b);
      else this.run('DELETE FROM friendships WHERE account_a = ? AND account_b = ?', a, b);
    });
  }

  removeFriend(accountId: string, otherId: string): void {
    assertId(accountId, 'accountId');
    assertId(otherId, 'otherId');
    const [a, b] = pair(accountId, otherId);
    const r = this.run('DELETE FROM friendships WHERE account_a = ? AND account_b = ?', a, b);
    if (r.changes === 0) throw new StoreError('NOT_FOUND', 'not on your friends list');
  }

  friendProfileIds(accountId: string): string[] {
    assertId(accountId, 'accountId');
    return this.all(
      `SELECT a.profile_id FROM friendships f
       JOIN accounts a ON a.id = CASE WHEN f.account_a = ?1 THEN f.account_b ELSE f.account_a END
       WHERE (f.account_a = ?1 OR f.account_b = ?1) AND f.status = 'accepted'`,
      accountId,
    ).map((r) => str(r.profile_id));
  }

  /**
   * Remove an account with its sessions, saved builds and friendships. The profile and its runs stay behind as an
   * unclaimed guest profile so shared co-op runs and board history are not rewritten.
   */
  deleteAccount(accountId: string): void {
    assertId(accountId, 'accountId');
    this.tx(() => {
      this.run('DELETE FROM sessions WHERE account_id = ?', accountId);
      this.run('DELETE FROM saved_builds WHERE account_id = ?', accountId);
      this.run('DELETE FROM friendships WHERE account_a = ?1 OR account_b = ?1', accountId);
      const r = this.run('DELETE FROM accounts WHERE id = ?', accountId);
      if (r.changes === 0) throw new StoreError('NOT_FOUND', 'account not found');
    });
  }

  // ---------------------------------------------------------------- per-profile statistics
  accountStats(profileId: string): AccountStats {
    assertId(profileId, 'profileId');
    const rows = this.all(
      `SELECT r.id, r.mode, r.n, r.status, r.round, r.ticks, r.score_text, r.challenge_id, r.created_at, r.completed_at, m.class_id
       FROM runs r JOIN run_members m ON m.run_id = r.id
       WHERE m.profile_id = ? AND r.status != 'invalidated'`,
      profileId,
    );
    const stats: AccountStats = {
      runs: rows.length, finished: 0, bestScoreText: '0', bestRunId: null, deepestRound: 0, totalActiveTicks: 0,
      coopRuns: 0, dailyRuns: 0, byClass: [], lastPlayedAt: null,
    };
    const byClass = new Map<string, { classId: string; runs: number; bestScoreText: string }>();
    for (const r of rows) {
      const scoreText = str(r.score_text);
      if (r.status === 'finalized') {
        stats.finished++;
        if (maxScore(scoreText, stats.bestScoreText) === scoreText && scoreText !== stats.bestScoreText) {
          stats.bestScoreText = scoreText;
          stats.bestRunId = str(r.id);
        }
      }
      stats.deepestRound = Math.max(stats.deepestRound, num(r.round));
      stats.totalActiveTicks += num(r.ticks);
      if (num(r.n) > 1) stats.coopRuns++;
      if (r.challenge_id && String(r.challenge_id).startsWith('daily')) stats.dailyRuns++;
      const at = numOrNull(r.completed_at) ?? num(r.created_at);
      stats.lastPlayedAt = Math.max(stats.lastPlayedAt ?? 0, at);
      const cid = str(r.class_id);
      const c = byClass.get(cid) ?? { classId: cid, runs: 0, bestScoreText: '0' };
      c.runs++;
      if (r.status === 'finalized') c.bestScoreText = maxScore(c.bestScoreText, scoreText);
      byClass.set(cid, c);
    }
    stats.byClass = [...byClass.values()].sort((x, y) => y.runs - x.runs || x.classId.localeCompare(y.classId));
    return stats;
  }

  ensureContentVersion(v: { hash: string; rulesVersion: string; manifestPath: string }): void {
    if (typeof v?.hash !== 'string' || !CONTENT_HASH_RE.test(v.hash)) throw new StoreError('INVALID_INPUT', 'invalid content hash');
    assertText(v.rulesVersion, 'rulesVersion', 64);
    assertText(v.manifestPath, 'manifestPath', 512);
    const ex = this.get('SELECT rules_version, manifest_path FROM content_versions WHERE hash = ?', v.hash);
    if (ex) {
      if (ex.rules_version !== v.rulesVersion || ex.manifest_path !== v.manifestPath) {
        throw new StoreError('CONFLICT', `content version ${v.hash} is immutable and differs`);
      }
      return;
    }
    this.run(
      'INSERT INTO content_versions(hash, rules_version, manifest_path, created_at) VALUES (?, ?, ?, ?)',
      v.hash,
      v.rulesVersion,
      v.manifestPath,
      Date.now(),
    );
  }

  // ---------------------------------------------------------------- runs
  createRun(r: CreateRunInput): void {
    assertId(r?.id, 'run id');
    assertText(r.seed, 'seed', 128);
    if (typeof r.contentHash !== 'string' || !CONTENT_HASH_RE.test(r.contentHash)) throw new StoreError('INVALID_INPUT', 'invalid contentHash');
    assertText(r.scoreVersion, 'scoreVersion', 64);
    assertText(r.mode, 'mode', 64);
    assertText(r.trust, 'trust', 64);
    assertInt(r.n, 'n', 1, 5);
    assertText(r.boardKey, 'boardKey', 256);
    if (r.challengeId !== null) assertText(r.challengeId, 'challengeId', 128);
    if (!Array.isArray(r.members) || r.members.length !== r.n) throw new StoreError('INVALID_INPUT', 'members.length must equal n');
    for (const m of r.members) {
      assertInt(m.slot, 'member slot', 0, 4);
      assertId(m.profileId, 'member profileId');
      assertText(m.classId, 'classId', 64);
      assertJsonText(m.buildJson, 'buildJson', 262_144);
    }
    this.tx(() => {
      const ex = this.get('SELECT seed, board_key, n, content_hash FROM runs WHERE id = ?', r.id);
      if (ex) {
        if (ex.seed === r.seed && ex.board_key === r.boardKey && num(ex.n) === r.n && ex.content_hash === r.contentHash) return;
        throw new StoreError('CONFLICT', `run ${r.id} already exists with different data`);
      }
      this.run(
        `INSERT INTO runs(id, seed, content_hash, score_version, mode, trust, n, status, board_key, challenge_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        r.id,
        r.seed,
        r.contentHash,
        r.scoreVersion,
        r.mode,
        r.trust,
        r.n,
        r.boardKey,
        r.challengeId,
        Date.now(),
      );
      for (const m of r.members) {
        this.run(
          'INSERT INTO run_members(run_id, slot, profile_id, class_id, build_json) VALUES (?, ?, ?, ?, ?)',
          r.id,
          m.slot,
          m.profileId,
          m.classId,
          m.buildJson,
        );
      }
    });
  }

  updateRunProgress(p: { id: string; round: number; ticks: number; scoreText: string; status?: string }): void {
    assertId(p?.id, 'run id');
    assertInt(p.round, 'round');
    assertInt(p.ticks, 'ticks');
    assertScore(p.scoreText);
    if (p.status !== undefined && (!RUN_STATUSES.has(p.status) || TERMINAL.has(p.status))) {
      throw new StoreError('INVALID_INPUT', 'status must be active or pending_storage (use finalizeRun for terminal states)');
    }
    this.tx(() => {
      const run = this.requireMutableRun(p.id);
      this.run(
        'UPDATE runs SET round = ?, ticks = ?, score_text = ?, score_digits = ?, status = ? WHERE id = ?',
        p.round,
        p.ticks,
        p.scoreText,
        p.scoreText.length,
        p.status ?? str(run.status),
        p.id,
      );
    });
  }

  recordRoundResult(r: {
    runId: string;
    roundNo: number;
    objectiveTotal: number;
    completedWeight: number;
    activeTicks: number;
    scoreText: string;
    cleared: boolean;
    detailJson: string;
  }): void {
    assertId(r?.runId, 'runId');
    assertInt(r.roundNo, 'roundNo');
    assertInt(r.objectiveTotal, 'objectiveTotal');
    assertInt(r.completedWeight, 'completedWeight');
    assertInt(r.activeTicks, 'activeTicks');
    assertScore(r.scoreText);
    if (typeof r.cleared !== 'boolean') throw new StoreError('INVALID_INPUT', 'cleared must be boolean');
    assertJsonText(r.detailJson, 'detailJson', 262_144);
    this.tx(() => {
      const ex = this.get('SELECT * FROM round_results WHERE run_id = ? AND round_no = ?', r.runId, r.roundNo);
      if (ex) {
        const same =
          num(ex.objective_total) === r.objectiveTotal &&
          num(ex.completed_weight) === r.completedWeight &&
          num(ex.active_ticks) === r.activeTicks &&
          ex.score_text === r.scoreText &&
          bool(ex.cleared) === r.cleared &&
          ex.detail_json === r.detailJson;
        if (same) return;
        throw new StoreError('CONFLICT', `round ${r.roundNo} of run ${r.runId} is already finalized with different data`);
      }
      this.requireMutableRun(r.runId);
      this.run(
        `INSERT INTO round_results(run_id, round_no, objective_total, completed_weight, active_ticks, score_text, cleared, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        r.runId,
        r.roundNo,
        r.objectiveTotal,
        r.completedWeight,
        r.activeTicks,
        r.scoreText,
        r.cleared ? 1 : 0,
        r.detailJson,
      );
    });
  }

  // ---------------------------------------------------------------- fate
  createOffer(o: { id: string; runId: string; afterRound: number; cardsJson: string; snapshotHash: string; deadlineTick: number | null }): void {
    assertId(o?.id, 'offer id');
    assertId(o.runId, 'runId');
    assertInt(o.afterRound, 'afterRound');
    assertJsonText(o.cardsJson, 'cardsJson', 65536);
    assertText(o.snapshotHash, 'snapshotHash', 128);
    if (o.deadlineTick !== null) assertInt(o.deadlineTick, 'deadlineTick');
    this.tx(() => {
      const ex = this.get('SELECT * FROM fate_offers WHERE id = ?', o.id);
      if (ex) {
        const same =
          ex.run_id === o.runId &&
          num(ex.after_round) === o.afterRound &&
          ex.cards_json === o.cardsJson &&
          ex.snapshot_hash === o.snapshotHash &&
          numOrNull(ex.deadline_tick) === o.deadlineTick;
        if (same) return;
        throw new StoreError('CONFLICT', `offer ${o.id} already exists with different data`);
      }
      const clash = this.get('SELECT id FROM fate_offers WHERE run_id = ? AND after_round = ?', o.runId, o.afterRound);
      if (clash) throw new StoreError('CONFLICT', `run ${o.runId} already has offer ${String(clash.id)} after round ${o.afterRound}`);
      this.requireMutableRun(o.runId);
      this.run(
        'INSERT INTO fate_offers(id, run_id, after_round, cards_json, snapshot_hash, deadline_tick) VALUES (?, ?, ?, ?, ?, ?)',
        o.id,
        o.runId,
        o.afterRound,
        o.cardsJson,
        o.snapshotHash,
        o.deadlineTick,
      );
    });
  }

  upsertVote(v: { offerId: string; memberSlot: number; seq: number; cardSlot: 'A' | 'B' | 'C'; locked: boolean }): { applied: boolean } {
    assertId(v?.offerId, 'offerId');
    assertInt(v.memberSlot, 'memberSlot', 0, 4);
    assertInt(v.seq, 'seq');
    if (v.cardSlot !== 'A' && v.cardSlot !== 'B' && v.cardSlot !== 'C') throw new StoreError('INVALID_INPUT', 'cardSlot must be A, B or C');
    if (typeof v.locked !== 'boolean') throw new StoreError('INVALID_INPUT', 'locked must be boolean');
    const r = this.run(
      `INSERT INTO fate_votes(offer_id, member_slot, seq, card_slot, locked) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(offer_id, member_slot) DO UPDATE SET seq = excluded.seq, card_slot = excluded.card_slot, locked = excluded.locked
       WHERE excluded.seq > fate_votes.seq`,
      v.offerId,
      v.memberSlot,
      v.seq,
      v.cardSlot,
      v.locked ? 1 : 0,
    );
    return { applied: r.changes > 0 };
  }

  private validateEvent(ev: EventInput): void {
    assertInt(ev?.seq, 'event seq');
    assertInt(ev.tick, 'event tick');
    assertText(ev.type, 'event type', 64);
    assertJsonText(ev.payloadJson, 'event payloadJson', 1_048_576);
  }

  /** Ordered, contiguous, hash-chained append. Re-sending an identical stored event is a no-op. Call inside tx. */
  private insertEvents(runId: string, events: EventInput[]): string {
    const head = this.get('SELECT seq, hash FROM run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1', runId);
    let headSeq: number | null = head ? num(head.seq) : null;
    let headHash = head ? str(head.hash) : ZERO_HASH;
    const now = Date.now();
    for (const ev of events) {
      if (headSeq !== null && ev.seq <= headSeq) {
        const ex = this.get('SELECT tick, type, payload_json FROM run_events WHERE run_id = ? AND seq = ?', runId, ev.seq);
        if (ex && num(ex.tick) === ev.tick && ex.type === ev.type && ex.payload_json === ev.payloadJson) continue;
        throw new StoreError('CONFLICT', `event seq ${ev.seq} conflicts with stored event log of run ${runId}`);
      }
      if (headSeq !== null && ev.seq !== headSeq + 1) {
        throw new StoreError('CONFLICT', `event seq ${ev.seq} is not contiguous (expected ${headSeq + 1})`);
      }
      const hash = eventHash(headHash, runId, ev.seq, ev.tick, ev.type, ev.payloadJson);
      this.run(
        'INSERT INTO run_events(run_id, seq, tick, type, payload_json, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        runId,
        ev.seq,
        ev.tick,
        ev.type,
        ev.payloadJson,
        headHash,
        hash,
        now,
      );
      headSeq = ev.seq;
      headHash = hash;
    }
    return headHash;
  }

  appendEvents(runId: string, events: EventInput[]): { lastHash: string } {
    assertId(runId, 'runId');
    if (!Array.isArray(events) || events.length > 10_000) throw new StoreError('INVALID_INPUT', 'events must be an array of at most 10000');
    for (const ev of events) this.validateEvent(ev);
    return this.tx(() => {
      this.requireMutableRun(runId);
      return { lastHash: this.insertEvents(runId, events) };
    });
  }

  private validateCheckpoint(c: CheckpointInput): void {
    assertInt(c?.seq, 'checkpoint seq');
    assertInt(c.schemaVersion, 'checkpoint schemaVersion', 0, 1_000_000);
    if (typeof c.stateBlob !== 'string' || c.stateBlob.length > MAX_BLOB) throw new StoreError('INVALID_INPUT', 'stateBlob too large or not a string');
    if (typeof c.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(c.checksum)) throw new StoreError('INVALID_INPUT', 'checksum must be sha256 hex');
    if (sha256hex(c.stateBlob) !== c.checksum) throw new StoreError('CHECKSUM_MISMATCH', 'checkpoint checksum does not match stateBlob');
  }

  /** Immutable insert; identical re-insert is a no-op. Call inside tx. */
  private insertCheckpoint(runId: string, c: CheckpointInput): void {
    const ex = this.get('SELECT schema_version, state_blob, checksum FROM checkpoints WHERE run_id = ? AND seq = ?', runId, c.seq);
    if (ex) {
      if (num(ex.schema_version) === c.schemaVersion && ex.state_blob === c.stateBlob && ex.checksum === c.checksum) return;
      throw new StoreError('CONFLICT', `checkpoint ${c.seq} of run ${runId} is immutable and differs`);
    }
    this.run(
      'INSERT INTO checkpoints(run_id, seq, schema_version, state_blob, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      runId,
      c.seq,
      c.schemaVersion,
      c.stateBlob,
      c.checksum,
      Date.now(),
    );
  }

  commitFate(c: CommitFateInput): { existing: boolean; cardId: string; stateHash: string; eventSeq: number } {
    assertId(c?.offerId, 'offerId');
    assertId(c.runId, 'runId');
    assertText(c.cardId, 'cardId', 128);
    assertJsonText(c.tieJson, 'tieJson', 65536);
    assertText(c.stateHash, 'stateHash', 128);
    this.validateEvent(c.event);
    this.validateCheckpoint(c.checkpoint);
    assertInt(c.round, 'round');
    assertInt(c.ticks, 'ticks');
    assertScore(c.scoreText);
    return this.tx(() => {
      const ex = this.get('SELECT card_id, state_hash, event_seq FROM fate_commits WHERE offer_id = ?', c.offerId);
      if (ex) return { existing: true, cardId: str(ex.card_id), stateHash: str(ex.state_hash), eventSeq: num(ex.event_seq) };
      const offer = this.get('SELECT run_id FROM fate_offers WHERE id = ?', c.offerId);
      if (!offer) throw new StoreError('NOT_FOUND', `offer ${c.offerId} not found`);
      if (offer.run_id !== c.runId) throw new StoreError('CONFLICT', `offer ${c.offerId} belongs to another run`);
      this.requireMutableRun(c.runId);
      this.insertEvents(c.runId, [c.event]);
      this.run(
        'INSERT INTO fate_commits(offer_id, card_id, run_id, event_seq, tie_json, state_hash) VALUES (?, ?, ?, ?, ?, ?)',
        c.offerId,
        c.cardId,
        c.runId,
        c.event.seq,
        c.tieJson,
        c.stateHash,
      );
      this.run(
        'UPDATE runs SET round = ?, ticks = ?, score_text = ?, score_digits = ? WHERE id = ?',
        c.round,
        c.ticks,
        c.scoreText,
        c.scoreText.length,
        c.runId,
      );
      this.insertCheckpoint(c.runId, c.checkpoint);
      return { existing: false, cardId: c.cardId, stateHash: c.stateHash, eventSeq: c.event.seq };
    });
  }

  getCommit(offerId: string): { cardId: string; stateHash: string; eventSeq: number; tieJson: string } | null {
    assertId(offerId, 'offerId');
    const r = this.get('SELECT card_id, state_hash, event_seq, tie_json FROM fate_commits WHERE offer_id = ?', offerId);
    return r ? { cardId: str(r.card_id), stateHash: str(r.state_hash), eventSeq: num(r.event_seq), tieJson: str(r.tie_json) } : null;
  }

  // ---------------------------------------------------------------- checkpoints
  saveCheckpoint(c: { runId: string } & CheckpointInput): void {
    assertId(c?.runId, 'runId');
    this.validateCheckpoint(c);
    this.tx(() => {
      this.requireMutableRun(c.runId);
      this.insertCheckpoint(c.runId, c);
    });
  }

  latestCheckpoint(runId: string): CheckpointInput | null {
    assertId(runId, 'runId');
    const r = this.get('SELECT seq, schema_version, state_blob, checksum FROM checkpoints WHERE run_id = ? ORDER BY seq DESC LIMIT 1', runId);
    if (!r) return null;
    const out = { seq: num(r.seq), schemaVersion: num(r.schema_version), stateBlob: str(r.state_blob), checksum: str(r.checksum) };
    if (sha256hex(out.stateBlob) !== out.checksum) {
      throw new StoreError('CHECKSUM_MISMATCH', `checkpoint ${out.seq} of run ${runId} failed checksum verification`);
    }
    return out;
  }

  // ---------------------------------------------------------------- replays
  writeReplayChunk(c: { runId: string; chunkNo: number; firstTick: number; lastTick: number; json: string }): {
    path: string;
    checksum: string;
    byteCount: number;
  } {
    assertId(c?.runId, 'runId');
    assertInt(c.chunkNo, 'chunkNo', 0, 999_999_999);
    assertInt(c.firstTick, 'firstTick');
    assertInt(c.lastTick, 'lastTick', c.firstTick);
    if (typeof c.json !== 'string' || c.json.length > MAX_REPLAY_JSON) throw new StoreError('INVALID_INPUT', 'replay json too large or not a string');
    const { abs, rel } = this.replayFile(c.runId, c.chunkNo);
    this.requireRun(c.runId);

    const ex = this.get('SELECT first_tick, last_tick, checksum, byte_count FROM replay_chunks WHERE run_id = ? AND chunk_no = ?', c.runId, c.chunkNo);
    if (ex) {
      const stored = this.readVerifiedChunk(c.runId, c.chunkNo, str(ex.checksum), num(ex.byte_count));
      if (stored === c.json && num(ex.first_tick) === c.firstTick && num(ex.last_tick) === c.lastTick) {
        return { path: rel, checksum: str(ex.checksum), byteCount: num(ex.byte_count) };
      }
      throw new StoreError('CONFLICT', `replay chunk ${c.chunkNo} of run ${c.runId} already exists with different content`);
    }

    const gz = gzipSync(Buffer.from(c.json, 'utf8'), { level: 6 });
    const checksum = sha256hex(gz);
    mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      let off = 0;
      while (off < gz.length) off += writeSync(fd, gz, off, gz.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const reread = readFileSync(tmp);
    if (reread.length !== gz.length || sha256hex(reread) !== checksum) {
      rmSync(tmp, { force: true });
      throw new StoreError('CHECKSUM_MISMATCH', 'replay chunk verification after write failed');
    }
    renameSync(tmp, abs);
    try {
      const dfd = openSync(path.dirname(abs), 'r');
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    } catch {
      // directory fsync is unsupported on Windows; the rename itself is atomic on NTFS
    }
    this.run(
      'INSERT INTO replay_chunks(run_id, chunk_no, first_tick, last_tick, path, checksum, byte_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c.runId,
      c.chunkNo,
      c.firstTick,
      c.lastTick,
      rel,
      checksum,
      gz.length,
    );
    return { path: rel, checksum, byteCount: gz.length };
  }

  private readVerifiedChunk(runId: string, chunkNo: number, checksum: string, byteCount: number): string {
    const { abs } = this.replayFile(runId, chunkNo);
    let buf: Buffer;
    try {
      buf = readFileSync(abs);
    } catch {
      throw new StoreError('CHECKSUM_MISMATCH', `replay chunk ${chunkNo} of run ${runId} is missing`);
    }
    if (buf.length !== byteCount || sha256hex(buf) !== checksum) {
      throw new StoreError('CHECKSUM_MISMATCH', `replay chunk ${chunkNo} of run ${runId} failed checksum verification`);
    }
    return gunzipSync(buf, { maxOutputLength: MAX_REPLAY_JSON * 4 }).toString('utf8');
  }

  readReplay(runId: string): { chunkNo: number; firstTick: number; lastTick: number; json: string }[] {
    assertId(runId, 'runId');
    const rows = this.all('SELECT chunk_no, first_tick, last_tick, path, checksum, byte_count FROM replay_chunks WHERE run_id = ? ORDER BY chunk_no', runId);
    return rows.map((r) => {
      const chunkNo = num(r.chunk_no);
      if (r.path !== this.replayFile(runId, chunkNo).rel) {
        throw new StoreError('CHECKSUM_MISMATCH', `replay chunk ${chunkNo} of run ${runId} has an unexpected path`);
      }
      return {
        chunkNo,
        firstTick: num(r.first_tick),
        lastTick: num(r.last_tick),
        json: this.readVerifiedChunk(runId, chunkNo, str(r.checksum), num(r.byte_count)),
      };
    });
  }

  // ---------------------------------------------------------------- finalization & boards
  finalizeRun(f: FinalizeRunInput): { existing: boolean } {
    assertId(f?.runId, 'runId');
    if (!['finalized', 'aborted', 'invalidated', 'pending_storage'].includes(f.status)) throw new StoreError('INVALID_INPUT', 'invalid final status');
    assertText(f.endReason, 'endReason', 64);
    assertScore(f.scoreText);
    assertInt(f.depth, 'depth');
    assertInt(f.activeTicks, 'activeTicks');
    assertText(f.boardKey, 'boardKey', 256);
    assertText(f.trust, 'trust', 64);
    assertJsonText(f.participantsJson, 'participantsJson', 16_384);
    assertJsonText(f.summaryJson, 'summaryJson', 262_144);
    if (typeof f.practice !== 'boolean') throw new StoreError('INVALID_INPUT', 'practice must be boolean');
    return this.tx(() => {
      const run = this.requireRun(f.runId);
      if (TERMINAL.has(str(run.status))) return { existing: true };
      const now = Date.now();
      this.run(
        `UPDATE runs SET status = ?, end_reason = ?, score_text = ?, score_digits = ?, summary_json = ?, completed_at = ? WHERE id = ?`,
        f.status,
        f.endReason,
        f.scoreText,
        f.scoreText.length,
        f.summaryJson,
        f.status === 'pending_storage' ? null : now,
        f.runId,
      );
      if (f.status === 'finalized') {
        this.run(
          `INSERT INTO board_entries(board_key, run_id, score_text, score_digits, depth, active_ticks, completed_at, verified_at, trust, participants_json, practice)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?) ON CONFLICT(board_key, run_id) DO NOTHING`,
          f.boardKey,
          f.runId,
          f.scoreText,
          f.scoreText.length,
          f.depth,
          f.activeTicks,
          now,
          f.trust,
          f.participantsJson,
          f.practice ? 1 : 0,
        );
      }
      if (f.status !== 'pending_storage') {
        const vstatus: VerificationStatus = f.status === 'invalidated' ? 'invalid' : 'local';
        this.run(
          `INSERT INTO verification(run_id, status, reason_code, reviewer, updated_at) VALUES (?, ?, ?, 'system', ?)
           ON CONFLICT(run_id) DO NOTHING`,
          f.runId,
          vstatus,
          f.status === 'invalidated' ? f.endReason : null,
          now,
        );
      }
      return { existing: false };
    });
  }

  queryBoard(q: { boardKey: string; limit: number; cursor?: string | null; includePractice?: boolean; profileIds?: string[] }): { rows: BoardRow[]; nextCursor: string | null } {
    assertText(q?.boardKey, 'boardKey', 256);
    assertInt(q.limit, 'limit', 1, 100);
    const inc = q.includePractice ? 1 : 0;
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    let pids: string | null = null;
    if (q.profileIds !== undefined) {
      if (!Array.isArray(q.profileIds) || q.profileIds.length > 1000) throw new StoreError('INVALID_INPUT', 'profileIds must be an array of at most 1000 ids');
      for (const p of q.profileIds) assertId(p, 'profileId');
      pids = JSON.stringify(q.profileIds);
    }
    const base: Record<string, SqlValue> = { bk: q.boardKey, inc, pids };
    let startRank = 1;
    let rows: Row[];
    const cols = `b.run_id, b.score_text, b.score_digits, b.depth, b.active_ticks, b.completed_at, b.trust, b.participants_json, b.practice, coalesce(v.status, 'local') AS vstatus,
      (SELECT json_group_array(a.username) FROM run_members m JOIN accounts a ON a.profile_id = m.profile_id WHERE m.run_id = b.run_id) AS usernames`;
    if (cur) {
      const params = { ...base, d: cur.d, s: cur.s, dep: cur.dep, at: cur.at, ca: cur.ca, rid: cur.rid };
      const before = this.getNamed(`SELECT count(*) AS c ${BOARD_BASE} AND NOT ${BOARD_AFTER}`, params) as { c: number };
      startRank = num(before.c) + 1;
      rows = this.st(`SELECT ${cols} ${BOARD_BASE} AND ${BOARD_AFTER} ${BOARD_ORDER} LIMIT $lim`).all({ ...params, lim: q.limit + 1 }) as Row[];
    } else {
      rows = this.st(`SELECT ${cols} ${BOARD_BASE} ${BOARD_ORDER} LIMIT $lim`).all({ ...base, lim: q.limit + 1 }) as Row[];
    }
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const out: BoardRow[] = page.map((r, i) => ({
      rank: startRank + i,
      runId: str(r.run_id),
      scoreText: str(r.score_text),
      depth: num(r.depth),
      activeTicks: num(r.active_ticks),
      completedAt: num(r.completed_at),
      trust: str(r.trust),
      participants: parseParticipants(str(r.participants_json)),
      verification: str(r.vstatus),
      practice: bool(r.practice),
      accounts: JSON.parse(strOrNull(r.usernames) ?? '[]') as string[],
    }));
    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]!;
      nextCursor = encodeCursor({
        d: num(last.score_digits),
        s: str(last.score_text),
        dep: num(last.depth),
        at: num(last.active_ticks),
        ca: num(last.completed_at),
        rid: str(last.run_id),
      });
    }
    return { rows: out, nextCursor };
  }

  listBoardKeys(): { boardKey: string; count: number }[] {
    return this.all('SELECT board_key, count(*) AS c FROM board_entries GROUP BY board_key ORDER BY board_key').map((r) => ({
      boardKey: str(r.board_key),
      count: num(r.c),
    }));
  }

  private toListItem(r: Row): RunListItem {
    return {
      id: str(r.id),
      mode: str(r.mode),
      trust: str(r.trust),
      n: num(r.n),
      status: str(r.status) as RunStatus,
      endReason: strOrNull(r.end_reason),
      round: num(r.round),
      ticks: num(r.ticks),
      scoreText: str(r.score_text),
      boardKey: str(r.board_key),
      challengeId: strOrNull(r.challenge_id),
      resumed: bool(r.resumed),
      favorite: bool(r.favorite),
      createdAt: num(r.created_at),
      completedAt: numOrNull(r.completed_at),
    };
  }

  getRun(runId: string): RunSummary | null {
    if (typeof runId !== 'string' || !ID_RE.test(runId)) return null;
    const r = this.get('SELECT * FROM runs WHERE id = ?', runId);
    if (!r) return null;
    const members = this.all(
      `SELECT m.slot, m.profile_id, p.display_name, m.class_id, m.build_json FROM run_members m
       LEFT JOIN profiles p ON p.id = m.profile_id WHERE m.run_id = ? ORDER BY m.slot`,
      runId,
    ).map((m) => ({
      slot: num(m.slot),
      profileId: str(m.profile_id),
      displayName: strOrNull(m.display_name),
      classId: str(m.class_id),
      buildJson: str(m.build_json),
    }));
    const rounds = this.all('SELECT * FROM round_results WHERE run_id = ? ORDER BY round_no', runId).map((x) => ({
      roundNo: num(x.round_no),
      objectiveTotal: num(x.objective_total),
      completedWeight: num(x.completed_weight),
      activeTicks: num(x.active_ticks),
      scoreText: str(x.score_text),
      cleared: bool(x.cleared),
      detailJson: str(x.detail_json),
    }));
    const fateTimeline: FateTimelineEntry[] = this.all(
      `SELECT o.id, o.after_round, o.cards_json, o.snapshot_hash, o.deadline_tick, c.card_id, c.event_seq, c.tie_json, c.state_hash
       FROM fate_offers o LEFT JOIN fate_commits c ON c.offer_id = o.id WHERE o.run_id = ? ORDER BY o.after_round`,
      runId,
    ).map((o) => ({
      offerId: str(o.id),
      afterRound: num(o.after_round),
      cardsJson: str(o.cards_json),
      snapshotHash: str(o.snapshot_hash),
      deadlineTick: numOrNull(o.deadline_tick),
      commit:
        o.card_id === null || o.card_id === undefined
          ? null
          : { cardId: str(o.card_id), eventSeq: num(o.event_seq), tieJson: str(o.tie_json), stateHash: str(o.state_hash) },
    }));
    const v = this.get('SELECT status FROM verification WHERE run_id = ?', runId);
    return {
      ...this.toListItem(r),
      seed: str(r.seed),
      contentHash: str(r.content_hash),
      scoreVersion: str(r.score_version),
      summaryJson: strOrNull(r.summary_json),
      verification: v ? (str(v.status) as VerificationStatus) : null,
      members,
      rounds,
      fateTimeline,
    };
  }

  listRuns(q: { profileId?: string; status?: string; limit: number }): RunListItem[] {
    assertInt(q?.limit, 'limit', 1, 500);
    const profileId = q.profileId ?? null;
    if (profileId !== null) assertId(profileId, 'profileId');
    const status = q.status ?? null;
    if (status !== null && !RUN_STATUSES.has(status)) throw new StoreError('INVALID_INPUT', 'invalid status filter');
    return this.all(
      `SELECT * FROM runs r WHERE (?1 IS NULL OR r.status = ?1)
       AND (?2 IS NULL OR EXISTS (SELECT 1 FROM run_members m WHERE m.run_id = r.id AND m.profile_id = ?2))
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?3`,
      status,
      profileId,
      q.limit,
    ).map((r) => this.toListItem(r));
  }

  hasRankedAttempt(boardKey: string, profileIds: string[]): boolean {
    assertText(boardKey, 'boardKey', 256);
    if (!Array.isArray(profileIds) || profileIds.length === 0 || profileIds.length > 5) {
      throw new StoreError('INVALID_INPUT', 'profileIds must contain 1..5 ids');
    }
    for (const p of profileIds) assertId(p, 'profileId');
    const r = this.get(
      `SELECT 1 AS x FROM runs r
       WHERE r.board_key = ? AND r.status != 'invalidated'
         AND NOT EXISTS (SELECT 1 FROM board_entries b WHERE b.run_id = r.id AND b.practice = 1)
         AND EXISTS (SELECT 1 FROM run_members m WHERE m.run_id = r.id AND m.profile_id IN (SELECT value FROM json_each(?)))
       LIMIT 1`,
      boardKey,
      JSON.stringify(profileIds),
    );
    return !!r;
  }

  setFavorite(runId: string, favorite: boolean): void {
    assertId(runId, 'runId');
    if (typeof favorite !== 'boolean') throw new StoreError('INVALID_INPUT', 'favorite must be boolean');
    const r = this.run('UPDATE runs SET favorite = ? WHERE id = ?', favorite ? 1 : 0, runId);
    if (r.changes === 0) throw new StoreError('NOT_FOUND', `run ${runId} not found`);
  }

  setVerification(runId: string, status: string, actor: string, reason: string): void {
    assertId(runId, 'runId');
    if (!VERIFICATION_STATUSES.has(status)) throw new StoreError('INVALID_INPUT', 'invalid verification status');
    assertText(actor, 'actor', 64);
    assertText(reason, 'reason', 500, 0);
    this.tx(() => {
      this.requireRun(runId);
      const prior = this.get('SELECT status FROM verification WHERE run_id = ?', runId);
      const now = Date.now();
      this.run(
        `INSERT INTO verification(run_id, status, reason_code, reviewer, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, reason_code = excluded.reason_code,
           reviewer = excluded.reviewer, updated_at = excluded.updated_at`,
        runId,
        status,
        reason,
        actor,
        now,
      );
      this.run(
        'INSERT INTO verification_audit(run_id, actor, prior_status, new_status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        runId,
        actor,
        prior ? str(prior.status) : null,
        status,
        reason,
        now,
      );
      this.run('UPDATE board_entries SET verified_at = ? WHERE run_id = ?', status === 'verified' ? now : null, runId);
    });
  }

  // ---------------------------------------------------------------- operations
  async backup(destPath: string): Promise<{ path: string; bytes: number }> {
    if (typeof destPath !== 'string' || destPath.trim() === '' || destPath.length > 1024) {
      throw new StoreError('INVALID_INPUT', 'destPath required');
    }
    const dest = path.isAbsolute(destPath) ? path.resolve(destPath) : path.resolve(this.paths.backupsDir, destPath);
    const live = path.resolve(this.paths.dbFile).toLowerCase();
    const d = dest.toLowerCase();
    if (d === live || d === `${live}-wal` || d === `${live}-shm`) throw new StoreError('INVALID_INPUT', 'refusing to overwrite the live database');
    if (existsSync(dest)) throw new StoreError('CONFLICT', 'backup destination already exists');
    mkdirSync(path.dirname(dest), { recursive: true });
    await backupDatabase(this.sqlite, this.db, dest);
    return { path: dest, bytes: statSync(dest).size };
  }

  enforceRetention(opts?: { replayBytes?: number }): { evictedRuns: string[] } {
    const cap = opts?.replayBytes ?? DEFAULT_REPLAY_BYTES;
    assertInt(cap, 'replayBytes');
    let total = num((this.get('SELECT coalesce(sum(byte_count), 0) AS t FROM replay_chunks') as Row).t);
    const evictedRuns: string[] = [];
    if (total <= cap) return { evictedRuns };
    const candidates = this.all(
      `SELECT r.id, sum(c.byte_count) AS bytes FROM replay_chunks c JOIN runs r ON r.id = c.run_id
       WHERE r.favorite = 0 AND r.status IN ('finalized', 'aborted', 'invalidated')
       GROUP BY r.id ORDER BY coalesce(r.completed_at, r.created_at) ASC, r.id ASC`,
    );
    for (const c of candidates) {
      if (total <= cap) break;
      const runId = str(c.id);
      if (!ID_RE.test(runId)) continue;
      this.tx(() => {
        this.run('DELETE FROM replay_chunks WHERE run_id = ?', runId);
      });
      rmSync(path.join(this.paths.replaysDir, runId), { recursive: true, force: true });
      total -= num(c.bytes);
      evictedRuns.push(runId);
    }
    return { evictedRuns };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // best effort
    }
    this.db.close();
  }
}
