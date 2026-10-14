import type { CloudLog } from './log';
import type { Sql } from './sql';

// Postgres schema for the cloud service, applied on boot. Append new versions only; never edit a shipped one.
// Each version runs in its own transaction under an advisory lock (two instances booting at once wait for each
// other) and every statement is idempotent, so a half-applied database or a re-run is harmless.
//
// Accounts mirror the local schema (usernames unique case-insensitively, scrypt hashes, SHA-256 session hashes,
// one friendship row per unordered pair a < b). In the cloud an account is its own profile. Run summaries are
// client-reported: one row per (reporting host account, run id), participants keyed by slot.

export interface CloudMigration { version: number; name: string; sql: string }

const V1 = `
CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 24),
  password_hash TEXT NOT NULL CHECK (char_length(password_hash) <= 512),
  favorite_class TEXT,
  motto TEXT NOT NULL DEFAULT '' CHECK (char_length(motto) <= 120),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  last_login_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_ci ON accounts (lower(username));

CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 120)
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS saved_builds(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  class_id TEXT NOT NULL,
  ranks_json TEXT NOT NULL CHECK (length(ranks_json) <= 16384),
  mastery TEXT,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  source_run_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_builds_account_idx ON saved_builds(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS friendships(
  account_a TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_b TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requester TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (account_a, account_b),
  CHECK (account_a < account_b),
  CHECK (requester IN (account_a, account_b))
);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships(account_b);

CREATE TABLE IF NOT EXISTS runs(
  pk BIGSERIAL PRIMARY KEY,
  host_account_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  board_key TEXT NOT NULL CHECK (char_length(board_key) <= 256),
  score_text TEXT COLLATE "C" NOT NULL CHECK (score_text ~ '^(0|[1-9][0-9]*)$'),
  score_digits INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  round INTEGER NOT NULL,
  active_ticks BIGINT NOT NULL,
  mode TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 5),
  challenge_id TEXT,
  practice BOOLEAN NOT NULL,
  end_reason TEXT,
  trust TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (length(summary_json) <= 65536),
  created_at BIGINT NOT NULL,
  UNIQUE (host_account_id, run_id),
  CHECK (score_digits = length(score_text))
);
CREATE INDEX IF NOT EXISTS runs_board_rank_idx ON runs(board_key, practice, score_digits DESC, score_text DESC, depth DESC, active_ticks ASC, created_at ASC, pk ASC);
CREATE INDEX IF NOT EXISTS runs_run_id_idx ON runs(run_id);

CREATE TABLE IF NOT EXISTS run_participants(
  run_pk BIGINT NOT NULL REFERENCES runs(pk) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 4),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
  class_id TEXT NOT NULL CHECK (char_length(class_id) <= 64),
  PRIMARY KEY (run_pk, slot)
);
CREATE INDEX IF NOT EXISTS run_participants_account_idx ON run_participants(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS run_participants_one_slot ON run_participants(run_pk, account_id) WHERE account_id IS NOT NULL;
`;

// v1's CHECK (account_a < account_b) compared with the database's default collation. On Cloud SQL that is a linguistic
// collation (case-insensitive-ish), while the store orders each pair with JavaScript's code-unit comparison, so
// mixed-case account ids (acc_Xq… vs acc_ab…) were ordered differently and every such friend request failed the CHECK.
// Compare byte-wise (COLLATE "C"), exactly like JavaScript does. Equality lookups are unaffected.
const V2 = `
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'friendships'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%account_a < account_b%'
  LOOP
    EXECUTE format('ALTER TABLE friendships DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE friendships ADD CONSTRAINT friendships_pair_order CHECK ((account_a COLLATE "C") < (account_b COLLATE "C"));
`;

export const CLOUD_MIGRATIONS: readonly CloudMigration[] = [
  { version: 1, name: 'accounts_friends_builds_runs', sql: V1 },
  { version: 2, name: 'friendships_bytewise_pair_order', sql: V2 },
];

export const CLOUD_SCHEMA_VERSION = CLOUD_MIGRATIONS[CLOUD_MIGRATIONS.length - 1]!.version;

const LOCK_KEY = 727_274_001;

/** Apply pending migrations; refuses to run against a database newer than this build. */
export async function migrate(sql: Sql, log?: CloudLog, migrations: readonly CloudMigration[] = CLOUD_MIGRATIONS): Promise<{ from: number; to: number; applied: number[] }> {
  await sql.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL)');
  const current = async (q: Sql) => Number((await q.query<{ v: number | null }>('SELECT max(version) AS v FROM schema_version')).rows[0]?.v ?? 0);
  const from = await current(sql);
  const latest = migrations.length ? migrations[migrations.length - 1]!.version : 0;
  if (from > latest) throw new Error(`database schema v${from} is newer than this build (v${latest}); refusing to start`);
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= from) continue;
    await sql.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      if ((await q.query('SELECT 1 FROM schema_version WHERE version = $1', [m.version])).rows.length) return;
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_version(version, name, applied_at) VALUES ($1, $2, $3)', [m.version, m.name, Date.now()]);
      applied.push(m.version);
    });
  }
  if (applied.length) log?.info('schema_migrated', { from, to: latest, applied });
  return { from, to: Math.max(from, latest), applied };
}
