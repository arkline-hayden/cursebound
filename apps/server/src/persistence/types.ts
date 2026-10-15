/** Public types of the persistence Store facade (docs/contracts/PERSISTENCE_CONTRACT.md). */

export interface StoreOptions {
  dataDir: string;
}

export type RunStatus = 'active' | 'finalized' | 'pending_storage' | 'aborted' | 'invalidated';
export type VerificationStatus = 'local' | 'pending' | 'verified' | 'invalid' | 'archived';

export interface Profile {
  id: string;
  displayName: string;
  createdAt: number;
}

export interface BoardRow {
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
  /** Usernames of the participants that hold an account (guests are omitted). */
  accounts: string[];
}

export interface RunMember {
  slot: number;
  profileId: string;
  displayName: string | null;
  classId: string;
  buildJson: string;
}

export interface RoundResult {
  roundNo: number;
  objectiveTotal: number;
  completedWeight: number;
  activeTicks: number;
  scoreText: string;
  cleared: boolean;
  detailJson: string;
}

export interface FateTimelineEntry {
  offerId: string;
  afterRound: number;
  cardsJson: string;
  snapshotHash: string;
  deadlineTick: number | null;
  commit: { cardId: string; eventSeq: number; tieJson: string; stateHash: string } | null;
}

export interface RunListItem {
  id: string;
  mode: string;
  trust: string;
  n: number;
  status: RunStatus;
  endReason: string | null;
  round: number;
  ticks: number;
  scoreText: string;
  boardKey: string;
  challengeId: string | null;
  resumed: boolean;
  favorite: boolean;
  createdAt: number;
  completedAt: number | null;
}

export interface RunSummary extends RunListItem {
  seed: string;
  contentHash: string;
  scoreVersion: string;
  summaryJson: string | null;
  /** post-run breakdown (runs.breakdown_json, schema v5); null for older runs */
  breakdownJson: string | null;
  verification: VerificationStatus | null;
  members: RunMember[];
  rounds: RoundResult[];
  fateTimeline: FateTimelineEntry[];
}

export interface HealthInfo {
  ok: boolean;
  schemaVersion: number;
  walBytes: number;
  queueDepth: number;
  lastQueueAgeMs: number;
}

export interface CreateRunInput {
  id: string;
  seed: string;
  contentHash: string;
  scoreVersion: string;
  mode: string;
  trust: string;
  n: number;
  boardKey: string;
  challengeId: string | null;
  members: { slot: number; profileId: string; classId: string; buildJson: string }[];
}

export interface EventInput {
  seq: number;
  tick: number;
  type: string;
  payloadJson: string;
}

export interface CheckpointInput {
  seq: number;
  schemaVersion: number;
  stateBlob: string;
  checksum: string;
}

export interface CommitFateInput {
  offerId: string;
  runId: string;
  cardId: string;
  tieJson: string;
  stateHash: string;
  event: EventInput;
  checkpoint: CheckpointInput;
  round: number;
  ticks: number;
  scoreText: string;
}

export interface FinalizeRunInput {
  runId: string;
  status: 'finalized' | 'aborted' | 'invalidated' | 'pending_storage';
  endReason: string;
  scoreText: string;
  depth: number;
  activeTicks: number;
  boardKey: string;
  trust: string;
  participantsJson: string;
  summaryJson: string;
  /** post-run breakdown (simulation runStats.ts RunBreakdown as JSON); absent = none recorded */
  breakdownJson?: string | null;
  practice: boolean;
  /**
   * Player progression (content progression.ts): XP credited to each member's profile in the same transaction, only
   * when the run is finalized (not aborted/invalidated). A non-null bountyId with bountyEligible doubles the award
   * of each member who had not yet completed that bounty, and records the completion.
   */
  progress?: { members: { profileId: string; baseXp: number }[]; bountyId: string | null; bountyEligible: boolean };
}

/** One profile's XP award for one run (xp_awards). */
export interface XpAwardRow { profileId: string; xp: number; baseXp: number; bounty: boolean; xpBefore: number }

/** A profile's stored progression: local XP, the cloud XP last synced by its own client (online mode), linkage. */
export interface ProfileProgress { profileId: string; xp: number; cloudXp: number | null; linked: boolean }

/** A daily bounty row (daily_bounties). */
export interface DailyBounty { id: string; modifierId: string; createdAt: number; expiresAt: number }

// ---------------------------------------------------------------- accounts
// Account records are shared with the cloud service (@cursebound/accounts); this Store is a superset of AccountStore.
import type { Account, AccountCredentials, AccountStats, FriendEntry, FriendState, SavedBuild, SavedBuildInput, SessionInfo } from '@cursebound/accounts';
export type { Account, AccountCredentials, AccountStats, FriendEntry, FriendState, SavedBuild, SavedBuildInput, SessionInfo };

export interface Store {
  health(): Promise<HealthInfo>;
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
  deleteAccount(accountId: string): Promise<void>;
  createProfile(displayName: string): Promise<Profile>;
  getProfile(id: string): Promise<Profile | null>;
  /** The profile linked to a cloud account (online mode), created when absent; updates its display name. */
  linkCloudProfile(accountId: string, displayName: string, cloudXp?: number | null): Promise<Profile>;
  getProgress(profileId: string): Promise<ProfileProgress | null>;
  /** The current daily bounty; rolls a new one (first of `candidates` that differs from the previous modifier) when
   *  there is none or the latest is at least `periodMs` old. One transaction, so two checks never double-roll. */
  ensureBounty(q: { now: number; periodMs: number; candidates: string[] }): Promise<{ bounty: DailyBounty; rolled: boolean }>;
  getBounty(id: string): Promise<DailyBounty | null>;
  bountyCompleted(bountyId: string, profileId: string): Promise<boolean>;
  runAwards(runId: string): Promise<XpAwardRow[]>;
  getSettings(profileId: string): Promise<unknown | null>;
  putSettings(profileId: string, json: unknown, schemaVersion: number): Promise<void>;
  ensureContentVersion(v: { hash: string; rulesVersion: string; manifestPath: string }): Promise<void>;
  createRun(r: CreateRunInput): Promise<void>;
  updateRunProgress(p: { id: string; round: number; ticks: number; scoreText: string; status?: string }): Promise<void>;
  recordRoundResult(r: {
    runId: string;
    roundNo: number;
    objectiveTotal: number;
    completedWeight: number;
    activeTicks: number;
    scoreText: string;
    cleared: boolean;
    detailJson: string;
  }): Promise<void>;
  createOffer(o: {
    id: string;
    runId: string;
    afterRound: number;
    cardsJson: string;
    snapshotHash: string;
    deadlineTick: number | null;
  }): Promise<void>;
  upsertVote(v: { offerId: string; memberSlot: number; seq: number; cardSlot: 'A' | 'B' | 'C'; locked: boolean }): Promise<{ applied: boolean }>;
  appendEvents(runId: string, events: EventInput[]): Promise<{ lastHash: string }>;
  commitFate(c: CommitFateInput): Promise<{ existing: boolean; cardId: string; stateHash: string; eventSeq: number }>;
  getCommit(offerId: string): Promise<{ cardId: string; stateHash: string; eventSeq: number; tieJson: string } | null>;
  saveCheckpoint(c: { runId: string } & CheckpointInput): Promise<void>;
  latestCheckpoint(runId: string): Promise<CheckpointInput | null>;
  writeReplayChunk(c: { runId: string; chunkNo: number; firstTick: number; lastTick: number; json: string }): Promise<{
    path: string;
    checksum: string;
    byteCount: number;
  }>;
  readReplay(runId: string): Promise<{ chunkNo: number; firstTick: number; lastTick: number; json: string }[]>;
  finalizeRun(f: FinalizeRunInput): Promise<{ existing: boolean; awards: XpAwardRow[] }>;
  queryBoard(q: { boardKey: string; limit: number; cursor?: string | null; includePractice?: boolean; profileIds?: string[] }): Promise<{
    rows: BoardRow[];
    nextCursor: string | null;
  }>;
  listBoardKeys(): Promise<{ boardKey: string; count: number }[]>;
  getRun(runId: string): Promise<RunSummary | null>;
  listRuns(q: { profileId?: string; status?: string; limit: number }): Promise<RunListItem[]>;
  hasRankedAttempt(boardKey: string, profileIds: string[]): Promise<boolean>;
  setFavorite(runId: string, favorite: boolean): Promise<void>;
  setVerification(runId: string, status: string, actor: string, reason: string): Promise<void>;
  backup(destPath: string): Promise<{ path: string; bytes: number }>;
  enforceRetention(opts?: { replayBytes?: number }): Promise<{ evictedRuns: string[] }>;
  close(): Promise<void>;
}

/** Operations executed inside the worker (everything except close, which is facade-managed). */
export type StoreOp = Exclude<keyof Store, 'close'>;
