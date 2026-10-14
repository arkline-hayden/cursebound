import {
  AccountStoreError, ID_RE, USERNAME_RE, assertStoreId, maxScore, sanitizeDisplayName, sanitizeFreeText,
  type Account, type AccountCredentials, type AccountStats, type AccountStore, type FriendEntry, type FriendState, type SavedBuild,
  type SavedBuildInput, type SessionInfo,
} from '@cursebound/accounts';
import type { Row, Sql } from './sql';

// Postgres implementation of the shared AccountStore plus the cloud-only run summaries and boards. Semantics match
// the local SQLite store (apps/server/src/persistence/db.ts) so the shared routes behave identically; here an
// account is its own profile (profileId === id), and stats/runs aggregate the run summaries players submitted.

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string => String(v);
const sOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};
const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

const ACCOUNT_COLS = 'a.id, a.username, a.display_name, a.favorite_class, a.motto, a.created_at, a.last_login_at';

function toAccount(r: Row): Account {
  return {
    id: s(r.id), username: s(r.username), profileId: s(r.id), displayName: s(r.display_name), favoriteClass: sOrNull(r.favorite_class),
    motto: s(r.motto), createdAt: n(r.created_at), lastLoginAt: nOrNull(r.last_login_at),
  };
}

function toSession(r: Row): SessionInfo {
  return { tokenHash: s(r.token_hash), accountId: s(r.account_id), createdAt: n(r.created_at), lastSeenAt: n(r.last_seen_at), expiresAt: n(r.expires_at), label: s(r.label) };
}

function toBuild(r: Row): SavedBuild {
  return {
    id: s(r.id), name: s(r.name), classId: s(r.class_id), ranks: json<Record<string, number>>(r.ranks_json, {}), mastery: sOrNull(r.mastery),
    notes: s(r.notes), sourceRunId: sOrNull(r.source_run_id), createdAt: n(r.created_at), updatedAt: n(r.updated_at),
  };
}

function assertRanks(ranks: unknown): Record<string, number> {
  if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks)) throw new AccountStoreError('INVALID_INPUT', 'ranks must be an object');
  const entries = Object.entries(ranks as Record<string, unknown>);
  if (entries.length > 200) throw new AccountStoreError('INVALID_INPUT', 'too many ranked nodes');
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (!/^[a-z0-9_]{1,64}$/.test(k)) throw new AccountStoreError('INVALID_INPUT', 'invalid node id');
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 99) throw new AccountStoreError('INVALID_INPUT', `rank of ${k} must be 0..99`);
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- run summaries
export interface RunSubmission {
  runId: string;
  boardKey: string;
  scoreText: string;
  depth: number;
  round: number;
  activeTicks: number;
  mode: string;
  n: number;
  challengeId: string | null;
  practice: boolean;
  endReason: string | null;
  /** index = slot; accountId only ever the submitter's own (the route nulls the rest) */
  participants: { accountId: string | null; name: string; classId: string }[];
  /** trimmed summary (players' final builds) kept for /builds/from-run */
  summaryJson: string;
}

export interface CloudBoardRow {
  rank: number;
  runId: string;
  scoreText: string;
  depth: number;
  activeTicks: number;
  completedAt: number;
  trust: string;
  participants: { name: string; classId: string }[];
  verification: string;
  practice: boolean;
  accounts: string[];
}

export const RUN_TRUST = 'client-reported';

interface Cursor { d: number; s: string; dep: number; at: number; ca: number; pk: number }

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.d, c.s, c.dep, c.at, c.ca, c.pk]), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  const bad = () => new AccountStoreError('INVALID_INPUT', 'invalid board cursor');
  if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad();
  let arr: unknown;
  try { arr = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw bad(); }
  if (!Array.isArray(arr) || arr.length !== 6) throw bad();
  const [d, sc, dep, at, ca, pk] = arr as unknown[];
  const isInt = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x);
  if (!isInt(d) || typeof sc !== 'string' || !/^(0|[1-9][0-9]*)$/.test(sc) || !isInt(dep) || !isInt(at) || !isInt(ca) || !isInt(pk)) throw bad();
  return { d: d as number, s: sc, dep: dep as number, at: at as number, ca: ca as number, pk: pk as number };
}

/** Rows ranked strictly after the cursor tuple ($o…$o+5): score desc, depth desc, active time asc, age asc, pk asc. */
const AFTER = (o: number) => {
  const [d, sc, dep, at, ca, pk] = [0, 1, 2, 3, 4, 5].map((i) => `$${o + i}`);
  return `(r.score_digits < ${d} OR (r.score_digits = ${d} AND (r.score_text < ${sc} OR (r.score_text = ${sc} AND (r.depth < ${dep} OR (r.depth = ${dep} AND (r.active_ticks > ${at} OR (r.active_ticks = ${at} AND (r.created_at > ${ca} OR (r.created_at = ${ca} AND r.pk > ${pk}))))))))))`;
};
const BOARD_ORDER = 'ORDER BY r.score_digits DESC, r.score_text DESC, r.depth DESC, r.active_ticks ASC, r.created_at ASC, r.pk ASC';
/** $1 board key, $2 include practice, $3 jsonb array of account ids or null */
const BOARD_WHERE = `WHERE r.board_key = $1 AND ($2::boolean OR NOT r.practice)
  AND ($3::jsonb IS NULL OR EXISTS (SELECT 1 FROM run_participants p WHERE p.run_pk = r.pk AND p.account_id IN (SELECT jsonb_array_elements_text($3::jsonb))))`;

export class PgAccountStore implements AccountStore {
  constructor(private readonly sql: Sql) {}

  async health(): Promise<boolean> {
    return (await this.sql.query('SELECT 1 AS one')).rows.length === 1;
  }

  // ---------------------------------------------------------------- accounts & sessions
  async createAccount(a: { id: string; username: string; passwordHash: string; displayName: string; claimProfileId: string | null }): Promise<Account> {
    assertStoreId(a?.id, 'account id');
    if (typeof a.username !== 'string' || !USERNAME_RE.test(a.username)) throw new AccountStoreError('INVALID_INPUT', 'username must be 3-20 letters, digits or _');
    if (typeof a.passwordHash !== 'string' || !a.passwordHash || a.passwordHash.length > 512) throw new AccountStoreError('INVALID_INPUT', 'invalid password hash');
    const name = sanitizeDisplayName(a.displayName);
    const now = Date.now();
    try {
      const r = await this.sql.query(
        `INSERT INTO accounts(id, username, display_name, password_hash, created_at, last_login_at) VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, username, display_name, favorite_class, motto, created_at, last_login_at`,
        [a.id, a.username, name, a.passwordHash, now],
      );
      return toAccount(r.rows[0]!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AccountStoreError('CONFLICT', 'that username is taken');
      throw err;
    }
  }

  async getAccountCredentials(username: string): Promise<AccountCredentials | null> {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
    const r = (await this.sql.query(`SELECT ${ACCOUNT_COLS}, a.password_hash, a.failed_logins, a.locked_until FROM accounts a WHERE lower(a.username) = lower($1)`, [username])).rows[0];
    return r ? { ...toAccount(r), passwordHash: s(r.password_hash), failedLogins: n(r.failed_logins), lockedUntil: n(r.locked_until) } : null;
  }

  async getAccount(id: string): Promise<Account | null> {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const r = (await this.sql.query(`SELECT ${ACCOUNT_COLS} FROM accounts a WHERE a.id = $1`, [id])).rows[0];
    return r ? toAccount(r) : null;
  }

  async getAccountByUsername(username: string): Promise<Account | null> {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
    const r = (await this.sql.query(`SELECT ${ACCOUNT_COLS} FROM accounts a WHERE lower(a.username) = lower($1)`, [username])).rows[0];
    return r ? toAccount(r) : null;
  }

  /** In the cloud an account is its own profile. */
  getAccountByProfile(profileId: string): Promise<Account | null> {
    return this.getAccount(profileId);
  }

  /** Success clears the failure counter; `lockAfter` consecutive failures lock the account for `lockMs`. */
  async recordLogin(accountId: string, ok: boolean, lockAfter: number, lockMs: number): Promise<void> {
    assertStoreId(accountId, 'accountId');
    const now = Date.now();
    if (ok) {
      await this.sql.query('UPDATE accounts SET failed_logins = 0, locked_until = 0, last_login_at = $1 WHERE id = $2', [now, accountId]);
      return;
    }
    await this.sql.query(
      `UPDATE accounts SET
         locked_until = CASE WHEN failed_logins + 1 >= $1 THEN $2 ELSE locked_until END,
         failed_logins = CASE WHEN failed_logins + 1 >= $1 THEN 0 ELSE failed_logins + 1 END
       WHERE id = $3`,
      [lockAfter, now + lockMs, accountId],
    );
  }

  async updateAccount(accountId: string, patch: { displayName?: string; favoriteClass?: string | null; motto?: string }): Promise<Account> {
    assertStoreId(accountId, 'accountId');
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (patch.displayName !== undefined) set('display_name', sanitizeDisplayName(patch.displayName));
    if (patch.favoriteClass !== undefined) {
      if (patch.favoriteClass !== null && (typeof patch.favoriteClass !== 'string' || patch.favoriteClass.length > 64)) throw new AccountStoreError('INVALID_INPUT', 'invalid favoriteClass');
      set('favorite_class', patch.favoriteClass);
    }
    if (patch.motto !== undefined) set('motto', sanitizeFreeText(patch.motto, 120));
    if (sets.length) {
      params.push(accountId);
      await this.sql.query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    const acc = await this.getAccount(accountId);
    if (!acc) throw new AccountStoreError('NOT_FOUND', 'account not found');
    return acc;
  }

  /** Changing the password revokes every other session (the caller's own session survives when given). */
  async setPasswordHash(accountId: string, passwordHash: string, keepSessionHash: string | null): Promise<void> {
    assertStoreId(accountId, 'accountId');
    await this.sql.tx(async (q) => {
      const r = await q.query('UPDATE accounts SET password_hash = $1, failed_logins = 0, locked_until = 0 WHERE id = $2', [passwordHash, accountId]);
      if (r.rowCount === 0) throw new AccountStoreError('NOT_FOUND', 'account not found');
      await q.query('DELETE FROM sessions WHERE account_id = $1 AND token_hash IS DISTINCT FROM $2', [accountId, keepSessionHash]);
    });
  }

  async createSession(x: SessionInfo): Promise<void> {
    if (typeof x?.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(x.tokenHash)) throw new AccountStoreError('INVALID_INPUT', 'invalid token hash');
    assertStoreId(x.accountId, 'accountId');
    const label = sanitizeFreeText(x.label ?? '', 120);
    await this.sql.tx(async (q) => {
      await q.query('DELETE FROM sessions WHERE expires_at <= $1', [x.createdAt]);
      await q.query(
        'INSERT INTO sessions(token_hash, account_id, created_at, last_seen_at, expires_at, label) VALUES ($1, $2, $3, $3, $4, $5)',
        [x.tokenHash, x.accountId, x.createdAt, x.expiresAt, label],
      );
      // bound live sessions per account: drop the stalest beyond 20
      await q.query(
        `DELETE FROM sessions WHERE account_id = $1 AND token_hash NOT IN
           (SELECT token_hash FROM sessions WHERE account_id = $1 ORDER BY last_seen_at DESC LIMIT 20)`,
        [x.accountId],
      );
    });
  }

  /** Valid (unexpired) session or null. With `extendTo`, slides the expiry forward (at most once a minute). */
  async getSession(tokenHash: string, now: number, extendTo: number | null): Promise<SessionInfo | null> {
    if (typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) return null;
    const r = (await this.sql.query('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash])).rows[0];
    if (!r) return null;
    const x = toSession(r);
    if (x.expiresAt <= now) {
      await this.sql.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      return null;
    }
    if (extendTo !== null && now - x.lastSeenAt > 60_000) {
      await this.sql.query('UPDATE sessions SET last_seen_at = $1, expires_at = GREATEST(expires_at, $2) WHERE token_hash = $3', [now, extendTo, tokenHash]);
      x.lastSeenAt = now;
      x.expiresAt = Math.max(x.expiresAt, extendTo);
    }
    return x;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    if (typeof tokenHash !== 'string') return;
    await this.sql.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async listSessions(accountId: string): Promise<SessionInfo[]> {
    assertStoreId(accountId, 'accountId');
    return (await this.sql.query('SELECT * FROM sessions WHERE account_id = $1 AND expires_at > $2 ORDER BY last_seen_at DESC', [accountId, Date.now()])).rows.map(toSession);
  }

  async deleteOtherSessions(accountId: string, keepTokenHash: string): Promise<number> {
    assertStoreId(accountId, 'accountId');
    return (await this.sql.query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, keepTokenHash])).rowCount;
  }

  // ---------------------------------------------------------------- saved builds
  async listBuilds(accountId: string): Promise<SavedBuild[]> {
    assertStoreId(accountId, 'accountId');
    return (await this.sql.query('SELECT * FROM saved_builds WHERE account_id = $1 ORDER BY updated_at DESC, id', [accountId])).rows.map(toBuild);
  }

  /** Insert or update (by id, only within the owning account). */
  async saveBuild(accountId: string, buildId: string, b: SavedBuildInput, maxBuilds: number): Promise<SavedBuild> {
    assertStoreId(accountId, 'accountId');
    assertStoreId(buildId, 'buildId');
    const name = sanitizeFreeText(b?.name, 40);
    if (!name) throw new AccountStoreError('INVALID_INPUT', 'build name required');
    if (typeof b.classId !== 'string' || !b.classId || b.classId.length > 64) throw new AccountStoreError('INVALID_INPUT', 'invalid classId');
    const ranks = JSON.stringify(assertRanks(b.ranks));
    if (b.mastery !== null && (typeof b.mastery !== 'string' || b.mastery.length > 64)) throw new AccountStoreError('INVALID_INPUT', 'invalid mastery');
    const notes = sanitizeFreeText(b.notes ?? '', 500, true);
    const source = b.sourceRunId !== null && ID_RE.test(b.sourceRunId) ? b.sourceRunId : null;
    return this.sql.tx(async (q) => {
      const now = Date.now();
      const ex = (await q.query('SELECT account_id FROM saved_builds WHERE id = $1', [buildId])).rows[0];
      if (ex) {
        if (ex.account_id !== accountId) throw new AccountStoreError('NOT_FOUND', 'build not found');
        await q.query(
          'UPDATE saved_builds SET name = $1, class_id = $2, ranks_json = $3, mastery = $4, notes = $5, updated_at = $6 WHERE id = $7',
          [name, b.classId, ranks, b.mastery, notes, now, buildId],
        );
      } else {
        // serialise concurrent inserts per account so the cap holds
        await q.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
        const count = n((await q.query('SELECT count(*) AS c FROM saved_builds WHERE account_id = $1', [accountId])).rows[0]!.c);
        if (count >= maxBuilds) throw new AccountStoreError('CONFLICT', `you can keep at most ${maxBuilds} saved builds`);
        await q.query(
          `INSERT INTO saved_builds(id, account_id, name, class_id, ranks_json, mastery, notes, source_run_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [buildId, accountId, name, b.classId, ranks, b.mastery, notes, source, now],
        );
      }
      return toBuild((await q.query('SELECT * FROM saved_builds WHERE id = $1', [buildId])).rows[0]!);
    });
  }

  async deleteBuild(accountId: string, buildId: string): Promise<void> {
    assertStoreId(accountId, 'accountId');
    assertStoreId(buildId, 'buildId');
    const r = await this.sql.query('DELETE FROM saved_builds WHERE id = $1 AND account_id = $2', [buildId, accountId]);
    if (r.rowCount === 0) throw new AccountStoreError('NOT_FOUND', 'build not found');
  }

  // ---------------------------------------------------------------- friends
  async listFriends(accountId: string): Promise<FriendEntry[]> {
    assertStoreId(accountId, 'accountId');
    const rows = (await this.sql.query(
      `SELECT ${ACCOUNT_COLS}, f.status, f.requester, f.updated_at AS since
       FROM friendships f
       JOIN accounts a ON a.id = CASE WHEN f.account_a = $1 THEN f.account_b ELSE f.account_a END
       WHERE f.account_a = $1 OR f.account_b = $1
       ORDER BY (f.status = 'accepted') DESC, lower(a.username)`,
      [accountId],
    )).rows;
    return rows.map((r) => ({
      accountId: s(r.id), username: s(r.username), displayName: s(r.display_name), profileId: s(r.id), favoriteClass: sOrNull(r.favorite_class),
      state: (r.status === 'accepted' ? 'friends' : r.requester === accountId ? 'outgoing' : 'incoming') as FriendState,
      since: n(r.since),
    }));
  }

  /** Send a request; if the other side already asked, this accepts it. Returns the resulting state. */
  async requestFriend(accountId: string, targetId: string): Promise<FriendState> {
    assertStoreId(accountId, 'accountId');
    assertStoreId(targetId, 'targetId');
    if (accountId === targetId) throw new AccountStoreError('INVALID_INPUT', 'you cannot befriend yourself');
    const [a, b] = pair(accountId, targetId);
    return this.sql.tx(async (q) => {
      if (!(await q.query('SELECT 1 FROM accounts WHERE id = $1', [targetId])).rows.length) throw new AccountStoreError('NOT_FOUND', 'no such player');
      const now = Date.now();
      const ex = (await q.query('SELECT status, requester FROM friendships WHERE account_a = $1 AND account_b = $2 FOR UPDATE', [a, b])).rows[0];
      if (ex) {
        if (ex.status === 'accepted') return 'friends';
        if (ex.requester === accountId) return 'outgoing';
        await q.query("UPDATE friendships SET status = 'accepted', updated_at = $1 WHERE account_a = $2 AND account_b = $3", [now, a, b]);
        return 'friends';
      }
      const pending = n((await q.query("SELECT count(*) AS c FROM friendships WHERE requester = $1 AND status = 'pending'", [accountId])).rows[0]!.c);
      if (pending >= 50) throw new AccountStoreError('CONFLICT', 'too many pending friend requests');
      await q.query(
        `INSERT INTO friendships(account_a, account_b, requester, status, created_at, updated_at) VALUES ($1, $2, $3, 'pending', $4, $4)
         ON CONFLICT (account_a, account_b) DO NOTHING`,
        [a, b, accountId, now],
      );
      return 'outgoing';
    });
  }

  async respondFriend(accountId: string, otherId: string, accept: boolean): Promise<void> {
    assertStoreId(accountId, 'accountId');
    assertStoreId(otherId, 'otherId');
    const [a, b] = pair(accountId, otherId);
    await this.sql.tx(async (q) => {
      const ex = (await q.query('SELECT status, requester FROM friendships WHERE account_a = $1 AND account_b = $2 FOR UPDATE', [a, b])).rows[0];
      if (!ex || ex.status !== 'pending' || ex.requester === accountId) throw new AccountStoreError('NOT_FOUND', 'no pending request from that player');
      if (accept) await q.query("UPDATE friendships SET status = 'accepted', updated_at = $1 WHERE account_a = $2 AND account_b = $3", [Date.now(), a, b]);
      else await q.query('DELETE FROM friendships WHERE account_a = $1 AND account_b = $2', [a, b]);
    });
  }

  async removeFriend(accountId: string, otherId: string): Promise<void> {
    assertStoreId(accountId, 'accountId');
    assertStoreId(otherId, 'otherId');
    const [a, b] = pair(accountId, otherId);
    const r = await this.sql.query('DELETE FROM friendships WHERE account_a = $1 AND account_b = $2', [a, b]);
    if (r.rowCount === 0) throw new AccountStoreError('NOT_FOUND', 'not on your friends list');
  }

  /** Accepted friends' account ids (an account is its own profile in the cloud). */
  async friendProfileIds(accountId: string): Promise<string[]> {
    assertStoreId(accountId, 'accountId');
    return (await this.sql.query(
      `SELECT CASE WHEN account_a = $1 THEN account_b ELSE account_a END AS id FROM friendships
       WHERE (account_a = $1 OR account_b = $1) AND status = 'accepted'`,
      [accountId],
    )).rows.map((r) => s(r.id));
  }

  /**
   * Remove an account with its sessions, saved builds and friendships (cascades). Submitted runs stay on the boards
   * with the account's slot turned into a guest, so shared co-op records are not rewritten.
   */
  async deleteAccount(accountId: string): Promise<void> {
    assertStoreId(accountId, 'accountId');
    const r = await this.sql.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    if (r.rowCount === 0) throw new AccountStoreError('NOT_FOUND', 'account not found');
  }

  // ---------------------------------------------------------------- stats and run history (from submitted summaries)
  async accountStats(profileId: string): Promise<AccountStats> {
    assertStoreId(profileId, 'profileId');
    const rows = (await this.sql.query(
      `SELECT r.run_id, r.n, r.round, r.active_ticks, r.score_text, r.challenge_id, r.end_reason, r.practice, r.created_at, p.class_id
       FROM run_participants p JOIN runs r ON r.pk = p.run_pk WHERE p.account_id = $1`,
      [profileId],
    )).rows;
    const stats: AccountStats = {
      runs: rows.length, finished: 0, bestScoreText: '0', bestRunId: null, deepestRound: 0, totalActiveTicks: 0,
      coopRuns: 0, dailyRuns: 0, byClass: [], lastPlayedAt: null,
    };
    const byClass = new Map<string, { classId: string; runs: number; bestScoreText: string }>();
    for (const r of rows) {
      const scoreText = s(r.score_text);
      const finished = r.end_reason !== 'aborted_infrastructure' && r.end_reason !== 'invalidated';
      if (finished) {
        stats.finished++;
        if (maxScore(scoreText, stats.bestScoreText) === scoreText && scoreText !== stats.bestScoreText) {
          stats.bestScoreText = scoreText;
          stats.bestRunId = s(r.run_id);
        }
      }
      stats.deepestRound = Math.max(stats.deepestRound, n(r.round));
      stats.totalActiveTicks += n(r.active_ticks);
      if (n(r.n) > 1) stats.coopRuns++;
      if (r.challenge_id && String(r.challenge_id).startsWith('daily')) stats.dailyRuns++;
      stats.lastPlayedAt = Math.max(stats.lastPlayedAt ?? 0, n(r.created_at));
      const cid = s(r.class_id);
      const c = byClass.get(cid) ?? { classId: cid, runs: 0, bestScoreText: '0' };
      c.runs++;
      if (finished) c.bestScoreText = maxScore(c.bestScoreText, scoreText);
      byClass.set(cid, c);
    }
    stats.byClass = [...byClass.values()].sort((x, y) => y.runs - x.runs || x.classId.localeCompare(y.classId));
    return stats;
  }

  /** Submitted runs of an account, newest first, in the local RunListItem shape (every submitted run is finished). */
  async listRuns(q: { profileId?: string; status?: string; limit: number }): Promise<unknown[]> {
    if (q.status !== undefined && q.status !== 'finalized') return [];
    if (!q.profileId) return [];
    assertStoreId(q.profileId, 'profileId');
    const limit = Math.max(1, Math.min(500, Math.floor(q.limit)));
    const rows = (await this.sql.query(
      `SELECT r.* FROM run_participants p JOIN runs r ON r.pk = p.run_pk WHERE p.account_id = $1 ORDER BY r.created_at DESC, r.pk DESC LIMIT $2`,
      [q.profileId, limit],
    )).rows;
    return rows.map((r) => ({
      id: s(r.run_id), mode: s(r.mode), trust: s(r.trust), n: n(r.n), status: 'finalized', endReason: sOrNull(r.end_reason), round: n(r.round),
      ticks: n(r.active_ticks), scoreText: s(r.score_text), boardKey: s(r.board_key), challengeId: sOrNull(r.challenge_id), resumed: false,
      favorite: false, practice: !!r.practice, createdAt: n(r.created_at), completedAt: n(r.created_at),
    }));
  }

  // ---------------------------------------------------------------- run summaries and boards
  /**
   * Record a client-reported run. Idempotent on (host account, run id); a later report of the same run (same id,
   * board and score) from another participant only claims that participant's own slot.
   */
  async submitRun(submitterId: string, x: RunSubmission): Promise<{ existing: boolean; rank: number | null }> {
    assertStoreId(submitterId, 'accountId');
    return this.sql.tx(async (q) => {
      const mySlot = x.participants.findIndex((p) => p.accountId === submitterId);
      let row = (await q.query(
        'SELECT pk, practice, score_digits, score_text, depth, active_ticks, created_at FROM runs WHERE run_id = $1 AND board_key = $2 AND score_text = $3 ORDER BY pk LIMIT 1 FOR UPDATE',
        [x.runId, x.boardKey, x.scoreText],
      )).rows[0];
      let existing = !!row;
      if (row) {
        const mine = (await q.query('SELECT 1 FROM run_participants WHERE run_pk = $1 AND account_id = $2', [row.pk, submitterId])).rows.length > 0;
        if (!mine && mySlot >= 0) await q.query('UPDATE run_participants SET account_id = $1 WHERE run_pk = $2 AND slot = $3 AND account_id IS NULL', [submitterId, row.pk, mySlot]);
      } else {
        const ins = await q.query(
          `INSERT INTO runs(host_account_id, run_id, board_key, score_text, score_digits, depth, round, active_ticks, mode, n, challenge_id, practice, end_reason, trust, summary_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (host_account_id, run_id) DO NOTHING
           RETURNING pk, practice, score_digits, score_text, depth, active_ticks, created_at`,
          [submitterId, x.runId, x.boardKey, x.scoreText, x.scoreText.length, x.depth, x.round, x.activeTicks, x.mode, x.n, x.challengeId, x.practice, x.endReason, RUN_TRUST, x.summaryJson, Date.now()],
        );
        row = ins.rows[0];
        if (!row) {
          // this submitter already reported a run with this id (with a different score): keep the first report
          existing = true;
          row = (await q.query('SELECT pk, practice, score_digits, score_text, depth, active_ticks, created_at FROM runs WHERE host_account_id = $1 AND run_id = $2', [submitterId, x.runId])).rows[0]!;
        } else {
          for (const [slot, p] of x.participants.entries()) {
            await q.query('INSERT INTO run_participants(run_pk, slot, account_id, name, class_id) VALUES ($1, $2, $3, $4, $5)', [row.pk, slot, p.accountId, p.name, p.classId]);
          }
        }
      }
      if (row.practice) return { existing, rank: null };
      const before = await q.query(
        `SELECT count(*) AS c FROM runs r WHERE r.board_key = $1 AND NOT r.practice AND NOT ${AFTER(2)} AND r.pk <> $7`,
        [x.boardKey, n(row.score_digits), s(row.score_text), n(row.depth), n(row.active_ticks), n(row.created_at), n(row.pk)],
      );
      return { existing, rank: n(before.rows[0]!.c) + 1 };
    });
  }

  /** The stored summary and slot of a run the account took part in (for /builds/from-run by run id). */
  async runForAccount(accountId: string, runId: string): Promise<{ summary: unknown; slot: number } | null> {
    const r = (await this.sql.query(
      `SELECT r.summary_json, p.slot FROM run_participants p JOIN runs r ON r.pk = p.run_pk
       WHERE p.account_id = $1 AND r.run_id = $2 ORDER BY r.pk LIMIT 1`,
      [accountId, runId],
    )).rows[0];
    return r ? { summary: json<unknown>(r.summary_json, {}), slot: n(r.slot) } : null;
  }

  async queryBoard(qb: { boardKey: string; limit: number; cursor?: string | null; includePractice?: boolean; accountIds?: string[] }): Promise<{ rows: CloudBoardRow[]; nextCursor: string | null }> {
    const cur = qb.cursor ? decodeCursor(qb.cursor) : null;
    const ids = qb.accountIds ? JSON.stringify(qb.accountIds) : null;
    const base = [qb.boardKey, !!qb.includePractice, ids];
    const cols = `r.pk, r.run_id, r.score_text, r.score_digits, r.depth, r.active_ticks, r.created_at, r.trust, r.practice,
      (SELECT json_agg(json_build_object('name', p.name, 'classId', p.class_id) ORDER BY p.slot) FROM run_participants p WHERE p.run_pk = r.pk) AS participants,
      (SELECT json_agg(a.username ORDER BY p.slot) FROM run_participants p JOIN accounts a ON a.id = p.account_id WHERE p.run_pk = r.pk) AS usernames`;
    let startRank = 1;
    let rows: Row[];
    if (cur) {
      const curParams = [cur.d, cur.s, cur.dep, cur.at, cur.ca, cur.pk];
      const before = await this.sql.query(`SELECT count(*) AS c FROM runs r ${BOARD_WHERE} AND NOT ${AFTER(4)}`, [...base, ...curParams]);
      startRank = n(before.rows[0]!.c) + 1;
      rows = (await this.sql.query(`SELECT ${cols} FROM runs r ${BOARD_WHERE} AND ${AFTER(4)} ${BOARD_ORDER} LIMIT $10`, [...base, ...curParams, qb.limit + 1])).rows;
    } else {
      rows = (await this.sql.query(`SELECT ${cols} FROM runs r ${BOARD_WHERE} ${BOARD_ORDER} LIMIT $4`, [...base, qb.limit + 1])).rows;
    }
    const page = rows.slice(0, qb.limit);
    const out: CloudBoardRow[] = page.map((r, i) => ({
      rank: startRank + i,
      runId: s(r.run_id),
      scoreText: s(r.score_text),
      depth: n(r.depth),
      activeTicks: n(r.active_ticks),
      completedAt: n(r.created_at),
      trust: s(r.trust),
      participants: json<{ name: string; classId: string }[]>(r.participants, []),
      verification: s(r.trust),
      practice: !!r.practice,
      accounts: json<string[]>(r.usernames, []) ?? [],
    }));
    const last = page[page.length - 1];
    const nextCursor = rows.length > qb.limit && last
      ? encodeCursor({ d: n(last.score_digits), s: s(last.score_text), dep: n(last.depth), at: n(last.active_ticks), ca: n(last.created_at), pk: n(last.pk) })
      : null;
    return { rows: out, nextCursor };
  }

  async listBoardKeys(): Promise<{ boardKey: string; count: number }[]> {
    return (await this.sql.query('SELECT board_key, count(*) AS c FROM runs GROUP BY board_key ORDER BY board_key')).rows.map((r) => ({ boardKey: s(r.board_key), count: n(r.c) }));
  }
}
