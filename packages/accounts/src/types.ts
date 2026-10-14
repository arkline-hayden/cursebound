/** Account records and the storage interface the shared account routes run against (SQLite locally, Postgres in the cloud). */

export interface Account {
  id: string;
  username: string;
  /** Local: the profile the account owns (runs, settings, boards key on it). Cloud: equal to `id`. */
  profileId: string;
  displayName: string;
  favoriteClass: string | null;
  motto: string;
  createdAt: number;
  lastLoginAt: number | null;
}

/** Account row plus the credential fields; never leaves the server. */
export interface AccountCredentials extends Account {
  passwordHash: string;
  failedLogins: number;
  lockedUntil: number;
}

export interface SessionInfo {
  tokenHash: string;
  accountId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  label: string;
}

export interface SavedBuild {
  id: string;
  name: string;
  classId: string;
  ranks: Record<string, number>;
  mastery: string | null;
  notes: string;
  sourceRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SavedBuildInput {
  name: string;
  classId: string;
  ranks: Record<string, number>;
  mastery: string | null;
  notes: string;
  sourceRunId: string | null;
}

export type FriendState = 'friends' | 'incoming' | 'outgoing';

export interface FriendEntry {
  accountId: string;
  username: string;
  displayName: string;
  profileId: string;
  favoriteClass: string | null;
  state: FriendState;
  since: number;
}

export interface AccountStats {
  runs: number;
  finished: number;
  bestScoreText: string;
  bestRunId: string | null;
  deepestRound: number;
  totalActiveTicks: number;
  coopRuns: number;
  dailyRuns: number;
  byClass: { classId: string; runs: number; bestScoreText: string }[];
  lastPlayedAt: number | null;
}

/**
 * Storage operations behind the account routes. Errors carry a `code` ('CONFLICT', 'NOT_FOUND', 'INVALID_INPUT')
 * that the HTTP layer maps to a status. Implementations must scope every build/friend/session id to its account.
 */
export interface AccountStore {
  createAccount(a: { id: string; username: string; passwordHash: string; displayName: string; claimProfileId: string | null }): Promise<Account>;
  getAccountCredentials(username: string): Promise<AccountCredentials | null>;
  getAccount(id: string): Promise<Account | null>;
  getAccountByUsername(username: string): Promise<Account | null>;
  getAccountByProfile(profileId: string): Promise<Account | null>;
  recordLogin(accountId: string, ok: boolean, lockAfter: number, lockMs: number): Promise<void>;
  updateAccount(accountId: string, patch: { displayName?: string; favoriteClass?: string | null; motto?: string }): Promise<Account>;
  setPasswordHash(accountId: string, passwordHash: string, keepSessionHash: string | null): Promise<void>;
  createSession(s: SessionInfo): Promise<void>;
  getSession(tokenHash: string, now: number, extendTo: number | null): Promise<SessionInfo | null>;
  deleteSession(tokenHash: string): Promise<void>;
  listSessions(accountId: string): Promise<SessionInfo[]>;
  deleteOtherSessions(accountId: string, keepTokenHash: string): Promise<number>;
  listBuilds(accountId: string): Promise<SavedBuild[]>;
  saveBuild(accountId: string, buildId: string, b: SavedBuildInput, maxBuilds: number): Promise<SavedBuild>;
  deleteBuild(accountId: string, buildId: string): Promise<void>;
  listFriends(accountId: string): Promise<FriendEntry[]>;
  requestFriend(accountId: string, targetId: string): Promise<FriendState>;
  respondFriend(accountId: string, otherId: string, accept: boolean): Promise<void>;
  removeFriend(accountId: string, otherId: string): Promise<void>;
  friendProfileIds(accountId: string): Promise<string[]>;
  accountStats(profileId: string): Promise<AccountStats>;
  /** Run list items for a profile (shape is store-specific; returned to clients as-is). */
  listRuns(q: { profileId?: string; status?: string; limit: number }): Promise<unknown[]>;
  deleteAccount(accountId: string): Promise<void>;
}

/** Minimal structured logger the routes write to. */
export interface AccountLog {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}
