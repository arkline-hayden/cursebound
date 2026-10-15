/**
 * Ordered, monotonic schema migrations (PRD §20.1/§20.2). Append new entries only; never edit a
 * shipped migration. The runner lives in migrate.ts and takes a pre-migration backup of any
 * existing non-empty database before applying anything.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const SCORE_CHECK = (col: string) =>
  `CHECK(${col} GLOB '0' OR (${col} GLOB '[1-9]*' AND ${col} NOT GLOB '*[^0-9]*'))`;

const V1 = `
CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);

CREATE TABLE profiles(
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 24),
  created_at INTEGER NOT NULL
);

CREATE TABLE settings(
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id),
  schema_version INTEGER NOT NULL,
  json TEXT NOT NULL CHECK(length(json) <= 65536)
);

CREATE TABLE content_versions(
  hash TEXT PRIMARY KEY,
  rules_version TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE runs(
  id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  content_hash TEXT NOT NULL REFERENCES content_versions(hash),
  score_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  trust TEXT NOT NULL,
  n INTEGER NOT NULL CHECK(n BETWEEN 1 AND 5),
  status TEXT NOT NULL CHECK(status IN ('active','finalized','pending_storage','aborted','invalidated')),
  end_reason TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  ticks INTEGER NOT NULL DEFAULT 0,
  score_text TEXT NOT NULL DEFAULT '0',
  score_digits INTEGER NOT NULL DEFAULT 1,
  board_key TEXT NOT NULL,
  challenge_id TEXT,
  resumed INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  ${SCORE_CHECK('score_text')},
  CHECK(score_digits = length(score_text))
);
CREATE INDEX runs_board_idx ON runs(board_key, score_digits DESC, score_text DESC);
CREATE INDEX runs_created_idx ON runs(created_at DESC);

CREATE TABLE run_members(
  run_id TEXT NOT NULL REFERENCES runs(id),
  slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 4),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  class_id TEXT NOT NULL,
  build_json TEXT NOT NULL,
  PRIMARY KEY(run_id, slot),
  UNIQUE(run_id, profile_id)
);
CREATE INDEX run_members_profile_idx ON run_members(profile_id);

CREATE TABLE round_results(
  run_id TEXT NOT NULL REFERENCES runs(id),
  round_no INTEGER NOT NULL,
  objective_total INTEGER NOT NULL,
  completed_weight INTEGER NOT NULL,
  active_ticks INTEGER NOT NULL,
  score_text TEXT NOT NULL ${SCORE_CHECK('score_text')},
  cleared INTEGER NOT NULL CHECK(cleared IN (0,1)),
  detail_json TEXT NOT NULL,
  PRIMARY KEY(run_id, round_no)
);

CREATE TABLE fate_offers(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  after_round INTEGER NOT NULL,
  cards_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  deadline_tick INTEGER NULL,
  UNIQUE(run_id, after_round)
);

CREATE TABLE fate_votes(
  offer_id TEXT NOT NULL REFERENCES fate_offers(id),
  member_slot INTEGER NOT NULL CHECK(member_slot BETWEEN 0 AND 4),
  seq INTEGER NOT NULL,
  card_slot TEXT NOT NULL CHECK(card_slot IN ('A','B','C')),
  locked INTEGER NOT NULL CHECK(locked IN (0,1)),
  PRIMARY KEY(offer_id, member_slot)
);

CREATE TABLE run_events(
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, seq)
);

CREATE TABLE fate_commits(
  offer_id TEXT PRIMARY KEY REFERENCES fate_offers(id),
  card_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  tie_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  UNIQUE(run_id, event_seq),
  FOREIGN KEY(run_id, event_seq) REFERENCES run_events(run_id, seq)
);

CREATE TABLE checkpoints(
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  state_blob TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, seq)
);

CREATE TABLE replay_chunks(
  run_id TEXT NOT NULL REFERENCES runs(id),
  chunk_no INTEGER NOT NULL,
  first_tick INTEGER NOT NULL,
  last_tick INTEGER NOT NULL,
  path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  PRIMARY KEY(run_id, chunk_no)
);

CREATE TABLE board_entries(
  board_key TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  score_text TEXT NOT NULL ${SCORE_CHECK('score_text')},
  score_digits INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  active_ticks INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  verified_at INTEGER NULL,
  trust TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  practice INTEGER NOT NULL DEFAULT 0 CHECK(practice IN (0,1)),
  UNIQUE(board_key, run_id),
  CHECK(score_digits = length(score_text))
);
CREATE INDEX board_entries_rank_idx ON board_entries(
  board_key, practice, score_digits DESC, score_text DESC, depth DESC, active_ticks ASC, completed_at ASC, run_id ASC
);
CREATE INDEX board_entries_run_idx ON board_entries(run_id);

CREATE TABLE verification(
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  status TEXT NOT NULL CHECK(status IN ('local','pending','verified','invalid','archived')),
  reason_code TEXT,
  reviewer TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE verification_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  prior_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX verification_audit_run_idx ON verification_audit(run_id, id);
`;

// Accounts (username + password) own exactly one profile, so run history, settings and boards keep keying on
// profile ids. Unclaimed profiles remain local guests. Usernames are unique case-insensitively. Only salted scrypt
// hashes and SHA-256 hashes of session tokens are stored. Friendships hold one row per unordered pair (a < b).
const V2 = `
CREATE TABLE accounts(
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(username) BETWEEN 3 AND 20),
  password_hash TEXT NOT NULL,
  profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
  favorite_class TEXT,
  motto TEXT NOT NULL DEFAULT '' CHECK(length(motto) <= 120),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK(length(label) <= 120)
);
CREATE INDEX sessions_account_idx ON sessions(account_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE saved_builds(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
  class_id TEXT NOT NULL,
  ranks_json TEXT NOT NULL CHECK(length(ranks_json) <= 16384),
  mastery TEXT,
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
  source_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX saved_builds_account_idx ON saved_builds(account_id, updated_at DESC);

CREATE TABLE friendships(
  account_a TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_b TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requester TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_a, account_b),
  CHECK(account_a < account_b),
  CHECK(requester IN (account_a, account_b))
);
CREATE INDEX friendships_b_idx ON friendships(account_b);
`;

// Online mode (docs/contracts/ONLINE_CONTRACT.md): a cloud account plays as one local profile, linked by its cloud
// account id. SQLite cannot add a UNIQUE column in place, so uniqueness is a unique index (NULLs stay distinct).
const V3 = `
ALTER TABLE profiles ADD COLUMN cloud_account_id TEXT NULL;
CREATE UNIQUE INDEX profiles_cloud_account_idx ON profiles(cloud_account_id);
`;

// Player progression and the daily bounty (content progression.ts / bounties.ts). profiles.xp is the local tally;
// profiles.cloud_xp is the cloud XP the profile's own client last reported for its linked account (online mode), so a
// class unlocked through cloud XP is not refused here. xp_awards keeps one award per (run, profile) for idempotent
// finalization and the results screen. daily_bounties is the local bounty roll (offline mode, polled job in
// apps/server/src/bounty.ts); bounty_completions records the first bounty run per profile (double XP once).
const V4 = `
ALTER TABLE profiles ADD COLUMN xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0);
ALTER TABLE profiles ADD COLUMN cloud_xp INTEGER NULL;

CREATE TABLE xp_awards(
  run_id TEXT NOT NULL REFERENCES runs(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  xp INTEGER NOT NULL CHECK(xp >= 0),
  base_xp INTEGER NOT NULL CHECK(base_xp >= 0),
  bounty INTEGER NOT NULL DEFAULT 0 CHECK(bounty IN (0,1)),
  xp_before INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, profile_id)
);
CREATE INDEX xp_awards_profile_idx ON xp_awards(profile_id, created_at DESC);

CREATE TABLE daily_bounties(
  id TEXT PRIMARY KEY,
  modifier_id TEXT NOT NULL CHECK(length(modifier_id) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX daily_bounties_created_idx ON daily_bounties(created_at DESC);

CREATE TABLE bounty_completions(
  bounty_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  run_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY(bounty_id, profile_id)
);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial_schema', sql: V1 },
  { version: 2, name: 'accounts_builds_friends', sql: V2 },
  { version: 3, name: 'profiles_cloud_account', sql: V3 },
  { version: 4, name: 'progression_daily_bounty', sql: V4 },
];

export const LATEST_SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]!.version;
