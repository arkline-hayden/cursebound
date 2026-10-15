import { performance } from 'node:perf_hooks';
import { BOUNTY_MIN_DEPTH, CARD_BY_ID, RULES, RULES_VERSION, SCORE_VERSION, SIM_VERSION, CONTENT_VERSION, TICK_RATE, contentHash, describeAward, xpForRun, type XpAward } from '@cursebound/content';
import { BUILD_ID, LIMITS, type ServerMessage } from '@cursebound/protocol';
import {
  buildSnapshot, checksum, clearedDepth, computeForecast, computeLedger, hasSpendableNode, serializeState, stateHash, step,
  voteCounts, type Command, type CreateRunParams, type PlayerInput, type SimEvent, type SimState, STATE_SCHEMA,
} from '@cursebound/simulation';
import type { Logger } from './persistence/logger';
import type { Store } from './persistence/store';

// Room authority (PRD §17.2, §19, §20.3): owns one run's simulation, validates intentions, advances phases,
// persists the event chain / offers / votes / exactly-once commits / checkpoints / replay chunks, and
// broadcasts bounded snapshots. The browser never decides damage, cards or score (REQ NET01).

export interface SeatLink {
  slot: number;
  connected: boolean;
  debug: boolean;
  send(msg: ServerMessage): void;
  buffered(): number;
}

export interface AuthorityHost {
  links(): SeatLink[];
  onRunEnded(summary: RunEndSummary): void;
  onStateChange(): void;
}

export interface RunEndSummary { runId: string; endReason: string; scoreText: string; depth: number; practice: boolean; boardKey: string }

interface JournalTick { t: number; i?: [number, number, number, number, number, number, number][]; c?: Command[] }
interface Journal { v: 1; runId: string; header?: CreateRunParams; resumeFrom?: { tick: number }; ticks: JournalTick[] }

const PRESENTATION = new Set(['hit', 'heal', 'shield', 'death', 'spawn', 'cast', 'enemy_attack', 'dodge', 'pickup', 'elite', 'downed', 'revived', 'dead', 'teleport', 'boss_phase', 'stagger', 'wave', 'objective', 'incident', 'loot', 'equip', 'perk', 'door_chosen', 'round_intro', 'boss_intro', 'afflict', 'foe_fx', 'aggro', 'blessing', 'training', /* room events (simulation roomEvents.ts) */ 'room_event']);
const MAX_EVENTS_PER_BATCH = 240;
const SNAPSHOT_EVERY = Math.round(TICK_RATE / 20);
const TICK_MS = 1000 / TICK_RATE;

export interface AuthorityOptions {
  state: SimState;
  store: Store;
  logger: Logger;
  host: AuthorityHost;
  boardKey: string;
  practice: boolean;
  createParams?: CreateRunParams;
  resume?: { persistSeq: number; chunkNo: number };
  /** training grounds (rooms.ts): nothing is persisted — no run record, events, commits, replay chunks, boards or records */
  training?: boolean;
  /** daily bounty id (local or cloud) a bounty run counts toward; its modifier is in the state (SimState.bounty) */
  bountyId?: string | null;
}

export class RunAuthority {
  state: SimState;
  readonly store: Store;
  readonly log: Logger;
  readonly host: AuthorityHost;
  readonly boardKey: string;
  practice: boolean;
  /** training grounds run: never touches the store (see AuthorityOptions.training) */
  readonly training: boolean;
  readonly bountyId: string | null;
  /** progression: XP awarded to each member's profile at finalization (by profile id), shown on RESULTS */
  private awards = new Map<string, XpAward>();
  private queues: PlayerInput[][] = [];
  private last: (PlayerInput | null)[] = [];
  private buckets: { tokens: number; at: number }[] = [];
  private pending: { cmd: Command; slot?: number; requestId?: string; voteSeq?: number }[] = [];
  private journal: Journal;
  private chunkNo: number;
  private persistSeq: number;
  private acc = 0;
  private lastNow = performance.now();
  paused = false;
  pauseReason = '';
  private suspendedSince: number | null = null;
  private eventBuffer: SimEvent[] = [];
  private storageBusy = false;
  private storagePending = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastPhase: string;
  private ended = false;
  private tickMs: number[] = [];
  stalls = 0;
  private lastSnapshotBytes = 0;
  private lastOfferSent: string | null = null;
  private created: Promise<void>;

  constructor(o: AuthorityOptions) {
    this.state = o.state;
    this.store = o.store;
    this.log = o.logger.child({ runId: o.state.runId });
    this.host = o.host;
    this.boardKey = o.boardKey;
    this.practice = o.practice;
    this.training = !!o.training;
    this.bountyId = o.bountyId ?? null;
    this.persistSeq = o.resume?.persistSeq ?? 0;
    this.chunkNo = o.resume?.chunkNo ?? 0;
    this.journal = { v: 1, runId: o.state.runId, ticks: [] };
    if (o.createParams) this.journal.header = o.createParams;
    if (o.resume) this.journal.resumeFrom = { tick: o.state.tick };
    this.lastPhase = o.state.phase;
    for (let i = 0; i < o.state.n; i++) { this.queues.push([]); this.last.push(null); this.buckets.push({ tokens: LIMITS.inputBurst, at: Date.now() }); }
    this.created = o.createParams && !this.training ? this.createRunRecord() : Promise.resolve();
    if (o.resume && this.state.awaitingDurable === 'commit') {
      // the restored checkpoint already contains the committed card: acknowledge durability, never reapply
      this.pending.push({ cmd: { type: 'DURABLE', what: 'commit' } });
    }
  }

  private async createRunRecord() {
    const s = this.state;
    await this.store.ensureContentVersion({ hash: s.contentHash, rulesVersion: RULES_VERSION, manifestPath: `packages/content@${CONTENT_VERSION}` });
    await this.store.createRun({
      id: s.runId, seed: s.seed, contentHash: s.contentHash, scoreVersion: SCORE_VERSION, mode: s.mode, trust: s.trust, n: s.n,
      boardKey: this.boardKey, challengeId: s.challengeId,
      members: s.players.map((p) => ({ slot: p.slot, profileId: p.profileId, classId: p.classId, buildJson: JSON.stringify({ ranks: p.ranks }) })),
    });
  }

  // ---------------- Inputs & commands ----------------

  submitInput(slot: number, inp: PlayerInput): boolean {
    const b = this.buckets[slot];
    const now = Date.now();
    b.tokens = Math.min(LIMITS.inputBurst, b.tokens + ((now - b.at) / 1000) * LIMITS.inputsPerSecond);
    b.at = now;
    if (b.tokens < 1) return false;            // rate limited: dropped, never queued unboundedly
    b.tokens -= 1;
    const q = this.queues[slot];
    const lastSeq = q.length ? q[q.length - 1].seq : (this.last[slot]?.seq ?? this.state.players[slot].lastInputSeq);
    if (inp.seq <= lastSeq) return false;       // duplicate/resent inputs never repeat an action
    q.push(inp);
    if (q.length > LIMITS.maxQueuedInputs) q.splice(0, q.length - 2);   // stale backlog: resync to the latest
    return true;
  }

  submitCommand(cmd: Command, meta: { slot?: number; requestId?: string; voteSeq?: number } = {}) {
    if (this.pending.length > 64) return;
    this.pending.push({ cmd, ...meta });
  }

  setPaused(paused: boolean, reason: string) {
    if (this.state.mode !== 'solo') return false;   // ranked/multiplayer authority never pauses for one client
    this.paused = paused;
    this.pauseReason = reason;
    if (!paused) { this.acc = 0; this.lastNow = performance.now(); }
    this.broadcast({ t: 'PAUSED', paused, reason });
    return true;
  }

  // ---------------- Main loop ----------------

  update(now: number) {
    if (this.ended && this.state.phase === 'RESULTS') return;
    const dt = now - this.lastNow;
    this.lastNow = now;
    if (this.paused) return;
    // all disconnected in co-op: suspend, then infrastructure termination after the hold window
    const anyConnected = this.state.players.some((p) => p.connected);
    if (!anyConnected && this.state.mode === 'coop' && this.state.phase !== 'FINALIZE' && this.state.phase !== 'RESULTS') {
      if (this.suspendedSince === null) { this.suspendedSince = now; this.log.warn('room_suspended', {}); }
      if (now - this.suspendedSince > RULES.allDisconnectedSuspendSec * 1000) {
        this.pending.push({ cmd: { type: 'ABORT', reason: 'all players disconnected' } });
        this.suspendedSince = null;
        this.acc = TICK_MS;
        this.tick();
        return;
      } else return;
    } else this.suspendedSince = null;
    this.acc += dt;
    if (this.acc > RULES.maxCatchupMs) {
      // authority stall: record it and resume without a silent speed change (simulation time did not elapse)
      this.stalls++;
      this.log.warn('authority_stall', { backlogMs: Math.round(this.acc) });
      this.broadcast({ t: 'NOTICE', level: 'warn', code: 'AUTHORITY_STALL', text: 'The game authority stalled briefly and resynchronized. No time was skipped.' });
      this.acc = TICK_MS;
    }
    let n = 0;
    while (this.acc >= TICK_MS && n < 4) {
      this.acc -= TICK_MS;
      this.tick();
      n++;
    }
  }

  tick() {
    const t0 = performance.now();
    const s = this.state;
    const tickNo = s.tick;
    // heroes move in COMBAT and, without attacking, during the in-world door vote (doors.ts)
    const combat = s.phase === 'COMBAT' || s.phase === 'VOTING';
    const inputs: (PlayerInput | null)[] = [];
    const jIn: JournalTick['i'] = [];
    for (let slot = 0; slot < s.n; slot++) {
      const q = this.queues[slot];
      let inp: PlayerInput | null = null;
      if (combat && s.players[slot].connected) {
        if (q.length) { inp = q.shift()!; this.last[slot] = inp; }
        else inp = this.last[slot];        // continuous held input until the next intention arrives
      } else if (!combat) { q.length = 0; this.last[slot] = null; }   // no stale held input across phases
      inputs.push(inp);
      if (inp) jIn.push([slot, inp.seq, inp.moveX, inp.moveY, inp.aimX, inp.aimY, inp.buttons]);
    }
    const batch = this.pending.splice(0, this.pending.length);
    const cmds = batch.map((b) => b.cmd);
    let res: ReturnType<typeof step>;
    try {
      res = step(s, inputs, cmds);
    } catch (err) {
      // a valid run could not continue evaluating: explicit technical incident (never a substitute card or defeat)
      this.log.error('sim_exception', { err: err as Error, tick: tickNo, phase: s.phase });
      this.incident(`Simulation error: ${(err as Error).message}`);
      return;
    }
    if ((jIn.length || cmds.length) && !this.training) {   // training runs keep no replay journal
      const jt: JournalTick = { t: tickNo };
      if (jIn.length) jt.i = jIn;
      if (cmds.length) jt.c = cmds;
      this.journal.ticks.push(jt);
    }
    // command acknowledgements
    res.outcomes.forEach((o, i) => {
      const meta = batch[i];
      if (meta.slot === undefined) return;
      const link = this.host.links().find((x) => x.slot === meta.slot);
      if (!link) return;
      if (meta.requestId) link.send({ t: 'ACK', requestId: meta.requestId, ok: o.ok, code: o.code });
      if (o.cmd.type === 'VOTE') link.send({ t: 'VOTE_ACK', offerId: o.cmd.offerId, seq: o.cmd.seq, accepted: o.ok, code: o.code });
    });
    this.handleEvents(res.events);
    for (const e of res.events) if (PRESENTATION.has(e.t)) this.eventBuffer.push(e);
    if (s.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      this.onPhaseChange();
    }
    const ms = performance.now() - t0;
    this.tickMs.push(ms);
    if (this.tickMs.length > 600) this.tickMs.shift();
  }

  private incident(reason: string) {
    try { step(this.state, [], [{ type: 'INCIDENT', reason }]); } catch { this.state.phase = 'RECOVERY'; this.state.incident = reason; }
    this.lastPhase = this.state.phase;
    this.broadcast({ t: 'NOTICE', level: 'error', code: 'TECHNICAL_RECOVERY', text: `Technical recovery: ${reason}. Your run is checkpointed at the last safe intermission; this is not a defeat.` });
    this.sendPhase();
    if (this.training) return;
    void this.store.updateRunProgress({ id: this.state.runId, round: this.state.round, ticks: this.state.totalActiveTicks, scoreText: this.state.scoreText, status: 'pending_storage' }).catch(() => undefined);
  }

  // ---------------- Persistence pipeline ----------------

  private handleEvents(events: SimEvent[]) {
    if (this.training) {
      // training grounds: nothing is stored; leaving the yard (retire / abort) finalizes without a record
      if (events.some((e) => e.t === 'domain' && e.type === 'run_finalized')) this.pending.push({ cmd: { type: 'DURABLE', what: 'finalize' } });
      return;
    }
    const s = this.state;
    let batch: { seq: number; tick: number; type: string; payloadJson: string }[] = [];
    const flush = () => {
      if (!batch.length) return;
      const b = batch; batch = [];
      this.persist(() => this.store.appendEvents(s.runId, b));
    };
    for (const e of events) {
      if (e.t !== 'domain') continue;
      if (e.type === 'fate_committed') {
        flush();
        this.persistCommit(e.payload);
        continue;
      }
      if (e.type === 'fate_offered') {
        const p = e.payload;
        this.persist(() => this.store.createOffer({ id: p.offerId as string, runId: s.runId, afterRound: p.round as number, cardsJson: JSON.stringify(p.cards), snapshotHash: p.snapshotHash as string, deadlineTick: (p.deadlineTick as number | null) ?? null }));
      }
      if (e.type === 'vote_changed') {
        const p = e.payload;
        if (p.cardSlot !== null) this.persist(() => this.store.upsertVote({ offerId: p.offerId as string, memberSlot: p.slot as number, seq: p.seq as number, cardSlot: (['A', 'B', 'C'] as const)[p.cardSlot as number], locked: !!p.locked }));
      }
      if (e.type === 'round_cleared') {
        const p = e.payload;
        const r = s.rounds[s.rounds.length - 1];
        this.persist(() => this.store.recordRoundResult({ runId: s.runId, roundNo: p.round as number, objectiveTotal: r.objectiveTotal, completedWeight: r.completedWeight, activeTicks: r.activeTicks, scoreText: r.awarded, cleared: true, detailJson: JSON.stringify(r) }));
        this.persist(() => this.store.updateRunProgress({ id: s.runId, round: s.round, ticks: s.totalActiveTicks, scoreText: s.scoreText }));
      }
      if (e.type === 'run_finalized') {
        flush();
        batch.push({ seq: ++this.persistSeq, tick: s.tick, type: e.type, payloadJson: JSON.stringify(e.payload) });
        flush();
        this.persistFinalize();
        continue;
      }
      batch.push({ seq: ++this.persistSeq, tick: s.tick, type: e.type, payloadJson: JSON.stringify(e.payload) });
    }
    flush();
  }

  private chain: Promise<unknown> = Promise.resolve();
  private persist(fn: () => Promise<unknown>) {
    if (this.training) return;
    this.chain = this.chain.then(() => this.created).then(fn).catch((err) => {
      this.log.error('persist_failed', { err: err as Error });
      this.storageNotice(err as Error);
    });
  }

  private storageNotice(err: Error) {
    this.storagePending = true;
    this.broadcast({ t: 'NOTICE', level: 'error', code: 'STORAGE_PENDING', text: `Saving is pending (${err.message}). The run will not continue past this point until storage recovers; nothing has been applied twice.` });
  }

  private checkpointBlob(): { blob: string; sum: string } {
    const blob = JSON.stringify({ v: 1, persistSeq: this.persistSeq, chunkNo: this.chunkNo + 1, state: serializeState(this.state), boardKey: this.boardKey, practice: this.practice, bountyId: this.bountyId });
    return { blob, sum: checksum(blob) };
  }

  private persistCommit(payload: Record<string, unknown>) {
    const s = this.state;
    const seq = ++this.persistSeq;
    const ck = this.checkpointBlob();
    const commitInput = {
      offerId: payload.offerId as string, runId: s.runId, cardId: payload.cardId as string, tieJson: JSON.stringify(payload.tieEvidence),
      stateHash: payload.resultingStateHash as string,
      event: { seq, tick: s.tick, type: 'fate_committed', payloadJson: JSON.stringify(payload) },
      checkpoint: { seq, schemaVersion: STATE_SCHEMA, stateBlob: ck.blob, checksum: ck.sum },
      round: s.round, ticks: s.totalActiveTicks, scoreText: s.scoreText,
    };
    const journal = this.takeJournal();
    const attempt = async () => {
      await this.created;
      // exactly-once: commit transaction (event + commit row + run progress + checkpoint) BEFORE broadcasting COMMIT
      const r = await this.store.commitFate(commitInput);
      if (journal) await this.store.writeReplayChunk(journal).catch((err) => this.log.warn('replay_chunk_failed', { err: err as Error }));
      void this.store.enforceRetention().catch(() => undefined);
      return r;
    };
    const run = () => {
      this.storageBusy = true;
      this.chain = this.chain.then(attempt).then((r) => {
        this.storageBusy = false;
        this.storagePending = false;
        const rec = s.commits[s.commits.length - 1];
        this.broadcast({ t: 'COMMIT', eventId: r.eventSeq, offerId: commitInput.offerId, cardId: r.cardId, cardSlot: rec?.cardSlot ?? 0, tieEvidence: payload.tieEvidence, newStateHash: r.stateHash, durable: true });
        this.pending.push({ cmd: { type: 'DURABLE', what: 'commit' } });
      }).catch((err) => {
        this.storageBusy = false;
        this.log.error('commit_failed', { err: err as Error });
        this.storageNotice(err as Error);
        this.retryTimer = setTimeout(run, 2000);   // idempotent retry: a second attempt returns the existing commit
      });
    };
    run();
  }

  private takeJournal(): { runId: string; chunkNo: number; firstTick: number; lastTick: number; json: string } | null {
    const j = this.journal;
    const ticks = j.ticks;
    const chunkNo = this.chunkNo++;
    const firstTick = ticks.length ? ticks[0].t : this.state.tick;
    const lastTick = this.state.tick - 1;
    const json = JSON.stringify(j);
    this.journal = { v: 1, runId: j.runId, ticks: [] };
    return { runId: j.runId, chunkNo, firstTick, lastTick: Math.max(firstTick, lastTick), json };
  }

  summary() {
    const s = this.state;
    return {
      runId: s.runId, endReason: s.endReason, scoreText: s.scoreText, partialText: s.partialText, depth: clearedDepth(s), round: s.round,
      activeTicks: s.totalActiveTicks, mode: s.mode, trust: s.trust, n: s.n, seed: s.seed, challengeId: s.challengeId, resumed: s.resumed,
      practice: this.practice, boardKey: this.boardKey, contentHash: s.contentHash,
      versions: { rules: RULES_VERSION, score: SCORE_VERSION, sim: SIM_VERSION, content: CONTENT_VERSION, build: BUILD_ID },
      rounds: s.rounds,
      fate: s.commits.map((c) => ({ round: c.round, cardId: c.cardId, cardName: CARD_BY_ID[c.cardId]?.name ?? c.cardId, tie: c.tie })),
      players: s.players.map((p) => ({
        slot: p.slot, name: p.name, classId: p.classId, ranks: p.ranks, mastery: p.mastery, gear: p.gear ?? {},
        stats: { damageDealt: p.stats.damageDealt.toCompact(), damageTaken: p.stats.damageTaken.toCompact(), healing: p.stats.healing.toCompact(), prevented: p.stats.prevented.toCompact(), revives: p.stats.revives, downs: p.stats.downs },
      })),
      deathRecaps: s.deathRecaps.slice(-10),
      legendaries: s.lootFound ?? [],
      ...(this.training ? { training: true } : {}),
      // daily bounty and progression (content bounties.ts / progression.ts): the XP award per slot (null until the
      // finalize transaction credited it, or for a profile this machine does not hold)
      bounty: s.bounty ? { id: this.bountyId, modifierId: s.bounty } : null,
      progress: s.players.map((p) => this.awards.get(p.profileId) ?? null),
      finalStateHash: stateHash(s),
      trustLabel: 'Local (unverified)',
    };
  }

  private persistFinalize() {
    const s = this.state;
    const sum = this.summary();
    const journal = this.takeJournal();
    const status = s.endReason === 'aborted_infrastructure' ? 'aborted' : s.endReason === 'invalidated' ? 'invalidated' : 'finalized';
    const input = {
      runId: s.runId, status: status as 'finalized' | 'aborted' | 'invalidated', endReason: s.endReason ?? 'retired', scoreText: s.scoreText,
      depth: clearedDepth(s), activeTicks: s.totalActiveTicks, boardKey: this.boardKey, trust: s.trust,
      participantsJson: JSON.stringify(s.players.map((p) => ({ name: p.name, classId: p.classId }))), summaryJson: JSON.stringify(sum), practice: this.practice,
      // progression: every member's profile earns the run's XP; a bounty run that cleared a round doubles each member's
      // first completion of that bounty
      progress: {
        members: s.players.map((p) => ({ profileId: p.profileId, baseXp: xpForRun({ scoreText: s.scoreText, depth: clearedDepth(s) }) })),
        bountyId: s.bounty ? this.bountyId : null,
        bountyEligible: clearedDepth(s) >= BOUNTY_MIN_DEPTH,
      },
    };
    const run = () => {
      this.chain = this.chain.then(async () => {
        await this.created;
        if (journal) await this.store.writeReplayChunk(journal).catch((err) => this.log.warn('replay_chunk_failed', { err: err as Error }));
        const r = await this.store.finalizeRun(input);
        for (const a of r.awards ?? []) this.awards.set(a.profileId, describeAward(a.baseXp, a.bounty, a.xpBefore));
      }).then(() => {
        // RESULTS is entered only after the final summary is durably recorded
        this.pending.push({ cmd: { type: 'DURABLE', what: 'finalize' } });
        this.storagePending = false;
      }).catch((err) => {
        this.log.error('finalize_failed', { err: err as Error });
        this.storageNotice(err as Error);
        void this.store.updateRunProgress({ id: s.runId, round: s.round, ticks: s.totalActiveTicks, scoreText: s.scoreText, status: 'pending_storage' }).catch(() => undefined);
        this.retryTimer = setTimeout(run, 2000);
      });
    };
    run();
  }

  // ---------------- Broadcast ----------------

  broadcast(msg: ServerMessage) {
    for (const l of this.host.links()) if (l.connected) l.send(msg);
  }

  sendSnapshot() {
    const links = this.host.links();
    const anyDebug = links.some((l) => l.debug);
    const snap = buildSnapshot(this.state, false);
    const dbgSnap = anyDebug ? buildSnapshot(this.state, true) : null;
    let events = this.eventBuffer;
    this.eventBuffer = [];
    if (events.length > MAX_EVENTS_PER_BATCH) {
      // cosmetic events can be dropped under pressure; authoritative damage is already applied
      const important = events.filter((e) => e.t !== 'hit' || (e as { targetKind: string }).targetKind === 'player');
      const hits = events.filter((e) => e.t === 'hit' && (e as { targetKind: string }).targetKind !== 'player');
      events = [...important, ...hits.slice(0, Math.max(0, MAX_EVENTS_PER_BATCH - important.length))];
    }
    for (const l of links) {
      if (!l.connected) continue;
      // slow peers: replace obsolete snapshots instead of queueing them unboundedly
      if (l.buffered() > LIMITS.snapshotChunkBytes * 4) continue;
      const msg = { t: 'SNAPSHOT' as const, ack: this.state.players[l.slot]?.lastInputSeq ?? 0, snap: l.debug && dbgSnap ? dbgSnap : snap };
      l.send(msg);
      if (events.length) l.send({ t: 'EVENTS', tick: this.state.tick, events });
    }
    this.lastSnapshotBytes = JSON.stringify(snap).length;
  }

  phaseData() {
    const s = this.state;
    return {
      runId: s.runId, mode: s.mode, trust: s.trust, n: s.n, seed: s.seed, challengeId: s.challengeId, tutorial: s.tutorial,
      map: s.map ? { w: s.map.w, h: s.map.h, tiles: s.map.tiles, topology: s.map.topology, decorSeed: s.map.decorSeed, fallback: s.map.fallback, theme: s.map.theme, layout: s.map.layout, rooms: s.map.rooms, voids: s.map.voids, arena: s.map.arena, bossSpawn: s.map.bossSpawn, playerSpawns: s.map.playerSpawns, enemySpawns: s.map.enemySpawns } : null,
      bossId: s.encounter?.bossId ?? null,
      round: s.round, phase: s.phase, deadlineTick: s.phaseDeadlineTick, tick: s.tick, scoreText: s.scoreText, retire: s.retireVotes,
      lastClear: s.lastClear, rounds: s.rounds.slice(-30), endReason: s.endReason, incident: s.incident, resumed: s.resumed,
      storagePending: this.storagePending, practice: this.practice, boardKey: this.boardKey, training: this.training,
      nextRound: s.round + 1, nextIsBoss: (s.round + 1) % RULES.bossEvery === 0,
      fate: s.commits.slice(-60).map((c) => ({ round: c.round, cardId: c.cardId })),
      deathRecaps: s.deathRecaps.filter((d) => d.round === s.round),
      players: s.players.map((p) => ({
        slot: p.slot, name: p.name, classId: p.classId, ranks: p.ranks, skillPoints: p.skillPoints, spentByBranch: p.spentByBranch,
        mastery: p.mastery, ready: p.ready, hpT: p.hp.toCompact(), mhpT: p.maxHp.toCompact(), connected: p.connected, life: p.lifeState,
        canMastery: p.skillPoints > 0 && !hasSpendableNode(s, p),
      })),
    };
  }

  sendPhase(to?: SeatLink) {
    const msg: ServerMessage = { t: 'PHASE', phase: this.state.phase, round: this.state.round, tick: this.state.tick, data: this.phaseData() };
    if (to) to.send(msg); else this.broadcast(msg);
  }

  sendOffer(to?: SeatLink) {
    const s = this.state;
    if (!s.offer || s.phase !== 'VOTING') return;
    const msg: ServerMessage = { t: 'OFFER', offerId: s.offer.id, round: s.offer.round, cardIds: s.offer.cards, snapshotHash: s.offer.snapshotHash, deadlineTick: s.offer.deadlineTick, forecast: computeForecast(s), themes: s.offer.themes };
    if (to) to.send(msg); else this.broadcast(msg);
    this.lastOfferSent = s.offer.id;
    this.sendVoteState(to);
  }

  sendVoteState(to?: SeatLink) {
    const s = this.state;
    if (!s.offer) return;
    const msg: ServerMessage = { t: 'VOTE_STATE', offerId: s.offer.id, votes: s.offer.votes.map((v) => ({ slot: v.slot, cardSlot: v.cardSlot, locked: v.locked })), counts: voteCounts(s.offer), deadlineTick: s.offer.deadlineTick, tick: s.tick };
    if (to) to.send(msg); else this.broadcast(msg);
  }

  sendLedger(to: SeatLink, page: number) {
    to.send({ t: 'LEDGER', view: computeLedger(this.state, page) });
  }

  /** Full resync for a (re)connecting seat: phase, offer, votes, combat snapshot, input acknowledgement. */
  resync(link: SeatLink) {
    this.sendPhase(link);
    if (this.state.phase === 'VOTING') this.sendOffer(link);
    link.send({ t: 'SNAPSHOT', ack: this.state.players[link.slot]?.lastInputSeq ?? 0, snap: buildSnapshot(this.state, link.debug) });
    if (this.state.phase === 'RESULTS') link.send({ t: 'RESULTS', summary: this.summary() });
    if (this.paused) link.send({ t: 'PAUSED', paused: true, reason: this.pauseReason });
  }

  private onPhaseChange() {
    const s = this.state;
    this.sendPhase();
    if (s.phase === 'VOTING') this.sendOffer();
    if (s.phase === 'RESULTS' && !this.ended) {
      this.ended = true;
      this.broadcast({ t: 'RESULTS', summary: this.summary() });
      this.host.onRunEnded({ runId: s.runId, endReason: s.endReason ?? 'retired', scoreText: s.scoreText, depth: clearedDepth(s), practice: this.practice, boardKey: this.boardKey });
      this.log.info('run_finalized', { score: s.scoreText, depth: clearedDepth(s), endReason: s.endReason });
    }
    this.host.onStateChange();
  }

  /** Called after intermission commands so all seats see allocation/ready/vote changes promptly. */
  afterCommand(kind: string) {
    if (kind === 'VOTE') this.sendVoteState();
    else if (kind === 'BLESS') { this.sendPhase(); this.sendOffer(); }   // the blessed card's forecast drops its price
    else this.sendPhase();
  }

  metrics() {
    const sorted = this.tickMs.slice().sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
    return {
      runId: this.state.runId, phase: this.state.phase, round: this.state.round, tick: this.state.tick,
      tickMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1] ?? 0 },
      enemies: this.state.enemies.length, projectiles: this.state.projectiles.length, hazards: this.state.hazards.length,
      snapshotBytes: this.lastSnapshotBytes, stalls: this.stalls, journalTicks: this.journal.ticks.length, storagePending: this.storagePending, storageBusy: this.storageBusy,
    };
  }

  dispose() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  async flush() {
    await this.chain.catch(() => undefined);
  }

  get contentHash() { return contentHash(); }
}
