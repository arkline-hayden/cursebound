import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import { CLASS_BY_ID, RULES, RULES_VERSION, SCORE_VERSION, TICK_RATE, classUnlockLevel, contentHash, isClassUnlocked } from '@cursebound/content';
import { BUILD_ID, LIMITS, PROTOCOL_VERSION, boardKey, parseClientMessage, quantizeInput, sanitizeName, type ClientMessage, type SeatView, type ServerMessage } from '@cursebound/protocol';
import { createRun, deserializeState, restoreBreakdown, type CreateRunParams, type SimState } from '@cursebound/simulation';
import { RunAuthority, type AuthorityHost, type SeatLink } from './authority';
import type { ServerConfig } from './config';
import type { Logger } from './persistence/logger';
import type { Store } from './persistence/store';
import { hashToken, newId, newRoomCode, newToken, tokenMatches } from './security';

// Invite rooms (PRD §4.1, §4.3): frozen roster at loadout lock, seat-scoped tokens, 60 s reconnect holds,
// no host privileges over votes or other players, no mid-run joins.

export interface Seat {
  slot: number;
  profileId: string;
  name: string;
  classId: string;
  ready: boolean;
  tokenHash: string;
  socket: WebSocket | null;
  disconnectedAt: number | null;
  debug: boolean;
  /** progression level the class gate checks (content progression.ts); null = not gated here (a cloud guest seated
   *  by the host bridge, whose level only the cloud knows: their own client enforces the gate) */
  level: number | null;
}

/** A locked class for this seat's level: the authority refuses it (progression class unlocks). */
function assertClassUnlocked(classId: string, level: number | null) {
  if (level === null || isClassUnlocked(classId, level)) return;
  throw Object.assign(new Error(`${CLASS_BY_ID[classId]?.name ?? classId} unlocks at level ${classUnlockLevel(classId)}`), { code: 'CLASS_LOCKED' });
}

/** Daily bounty a room was created with: the bounty id (local or cloud) and its content modifier id. */
export interface RoomBounty { id: string; modifierId: string }

export type RoomStage = 'LOBBY' | 'RUN' | 'CLOSED';

export class Room implements AuthorityHost {
  readonly id: string;
  readonly code: string;
  readonly mode: 'solo' | 'coop';
  readonly trust: 'local' | 'lan';
  readonly seed: string;
  readonly challengeId: string | null;
  readonly tutorial: boolean;
  /** training grounds room (simulation training.ts): accepts TRAIN, never scores, persists or records the run */
  readonly training: boolean;
  readonly bounty: RoomBounty | null;
  seats: Seat[] = [];
  stage: RoomStage = 'LOBBY';
  authority: RunAuthority | null = null;
  createdAt = Date.now();
  lastActivity = Date.now();
  private seatLinks = new Map<number, SeatLink>();

  constructor(private mgr: RoomManager, o: { mode: 'solo' | 'coop'; seed: string; challengeId: string | null; tutorial: boolean; trust: 'local' | 'lan'; bounty?: RoomBounty | null; training?: boolean }) {
    this.id = newId('room');
    this.code = newRoomCode();
    this.mode = o.mode;
    this.seed = o.seed;
    this.challengeId = o.challengeId;
    this.tutorial = o.tutorial;
    this.trust = o.trust;
    this.training = !!o.training;
    this.bounty = o.bounty ?? null;
  }

  // ---------------- AuthorityHost ----------------
  links(): SeatLink[] { return [...this.seatLinks.values()]; }
  onRunEnded(): void { this.lastActivity = Date.now(); }
  onStateChange(): void { this.lastActivity = Date.now(); }

  addSeat(profileId: string, name: string, classId: string, level: number | null = null): { seat: Seat; token: string } {
    if (this.stage !== 'LOBBY') throw Object.assign(new Error('roster is locked'), { code: 'ROSTER_LOCKED' });
    const max = this.mode === 'solo' ? 1 : LIMITS.maxSeats;
    if (this.seats.length >= max) throw Object.assign(new Error('room is full'), { code: 'ROOM_FULL' });
    if (this.seats.some((s) => s.profileId === profileId)) throw Object.assign(new Error('this profile already holds a seat in the room'), { code: 'DUPLICATE_PROFILE' });
    const cls = CLASS_BY_ID[classId] ? classId : 'vanguard';
    assertClassUnlocked(cls, level);
    const token = newToken();
    const seat: Seat = { slot: this.seats.length, profileId, name: sanitizeName(name), classId: cls, ready: false, tokenHash: hashToken(token), socket: null, disconnectedAt: null, debug: false, level };
    this.seats.push(seat);
    this.broadcastRoom();
    return { seat, token };
  }

  seatForToken(token: string): Seat | null {
    return this.seats.find((s) => tokenMatches(token, s.tokenHash)) ?? null;
  }

  roomView(forSlot: number): ServerMessage {
    const seats: SeatView[] = this.seats.map((s) => ({ slot: s.slot, name: s.name, classId: s.classId, ready: s.ready, connected: !!s.socket, you: s.slot === forSlot }));
    return { t: 'ROOM', roomId: this.id, code: this.code, mode: this.mode, trust: this.trust, seats, stage: this.stage, lan: { enabled: this.mgr.cfg.lan, hosts: this.mgr.lanHosts() }, seed: this.stage === 'RUN' ? this.seed : null, challengeId: this.challengeId, bounty: this.bounty?.modifierId ?? null };
  }

  broadcastRoom() {
    for (const s of this.seats) if (s.socket) this.send(s.socket, this.roomView(s.slot));
  }

  send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  attach(seat: Seat, ws: WebSocket) {
    if (seat.socket && seat.socket !== ws) { try { seat.socket.close(4000, 'replaced by a newer connection'); } catch { /* ignore */ } }
    seat.socket = ws;
    const reconnect = seat.disconnectedAt !== null;
    seat.disconnectedAt = null;
    const link: SeatLink = {
      slot: seat.slot, debug: seat.debug,
      get connected() { return ws.readyState === ws.OPEN; },
      send: (m) => this.send(ws, m),
      buffered: () => ws.bufferedAmount,
    };
    this.seatLinks.set(seat.slot, link);
    this.send(ws, {
      t: 'WELCOME', slot: seat.slot, roomId: this.id, code: this.code, protocol: PROTOCOL_VERSION, contentHash: contentHash(), build: BUILD_ID, mode: this.mode,
      trust: this.trust, runId: this.authority?.state.runId ?? null, resumed: !!this.authority?.state.resumed, tutorial: this.tutorial, challengeId: this.challengeId, tickRate: TICK_RATE,
    });
    this.broadcastRoom();
    if (this.authority) {
      const p = this.authority.state.players[seat.slot];
      if (p && !p.connected) this.authority.submitCommand({ type: 'CONNECT', slot: seat.slot });
      if (this.mode === 'solo' && this.authority.paused && this.authority.pauseReason === 'client lost') this.authority.setPaused(false, '');
      this.authority.resync(link);
      if (reconnect) this.mgr.log.info('reconnect_completed', { roomId: this.id, slot: seat.slot });
    }
  }

  detach(seat: Seat, ws: WebSocket) {
    if (seat.socket !== ws) return;
    seat.socket = null;
    seat.disconnectedAt = Date.now();
    this.seatLinks.delete(seat.slot);
    this.broadcastRoom();
    if (this.authority) {
      this.authority.submitCommand({ type: 'DISCONNECT', slot: seat.slot });
      if (this.mode === 'solo') this.authority.setPaused(true, 'client lost');   // local authority pauses for client loss
    }
  }

  async handle(seat: Seat, msg: ClientMessage) {
    this.lastActivity = Date.now();
    const a = this.authority;
    switch (msg.t) {
      case 'LOBBY': {
        if (this.stage !== 'LOBBY') return;
        if (msg.classId && CLASS_BY_ID[msg.classId]) {
          // progression: a locked class is refused (the seat keeps its class) and the client is told why
          if (seat.level !== null && !isClassUnlocked(msg.classId, seat.level)) {
            if (seat.socket) this.send(seat.socket, { t: 'ERROR', code: 'CLASS_LOCKED', recoverable: true, message: `${CLASS_BY_ID[msg.classId].name} unlocks at level ${classUnlockLevel(msg.classId)}` });
          } else seat.classId = msg.classId;
        }
        if (typeof msg.ready === 'boolean') seat.ready = msg.ready;
        this.broadcastRoom();
        if (this.seats.length >= 1 && this.seats.every((s) => s.ready && s.socket)) await this.startRun();
        return;
      }
      case 'INPUT': {
        if (!a) return;
        const qi = quantizeInput(msg.mx, msg.my, msg.ax, msg.ay);
        a.submitInput(seat.slot, { seq: msg.seq, moveX: qi.mx, moveY: qi.my, aimX: qi.ax, aimY: qi.ay, buttons: msg.b });
        return;
      }
      case 'ALLOCATE': a?.submitCommand({ type: 'ALLOCATE', slot: seat.slot, nodeId: msg.nodeId }, { slot: seat.slot, requestId: msg.requestId }); this.later(() => a?.afterCommand('ALLOCATE')); return;
      case 'REFUND': a?.submitCommand({ type: 'REFUND_ALL', slot: seat.slot }, { slot: seat.slot, requestId: msg.requestId }); this.later(() => a?.afterCommand('REFUND')); return;
      case 'MASTERY': a?.submitCommand({ type: 'MASTERY', slot: seat.slot, choice: msg.choice }, { slot: seat.slot, requestId: msg.requestId }); this.later(() => a?.afterCommand('MASTERY')); return;
      case 'READY': a?.submitCommand({ type: 'READY', slot: seat.slot, ready: msg.ready }); this.later(() => a?.afterCommand('READY')); return;
      case 'VOTE': a?.submitCommand({ type: 'VOTE', slot: seat.slot, offerId: msg.offerId, seq: msg.seq, cardSlot: msg.slot, locked: msg.locked }, { slot: seat.slot, voteSeq: msg.seq }); this.later(() => a?.afterCommand('VOTE')); return;
      case 'RETIRE': a?.submitCommand({ type: 'RETIRE_VOTE', slot: seat.slot, yes: msg.yes }); this.later(() => a?.afterCommand('RETIRE')); return;
      case 'PAUSE': if (a && !a.setPaused(msg.paused, msg.paused ? 'player paused' : '') && seat.socket) this.send(seat.socket, { t: 'ERROR', code: 'STALE_PHASE', recoverable: true, message: 'Only local solo runs can pause; multiplayer combat continues.' }); return;
      case 'LEDGER': { const l = this.seatLinks.get(seat.slot); if (a && l) a.sendLedger(l, msg.page); return; }
      case 'FORECAST': { const l = this.seatLinks.get(seat.slot); if (a && l) a.sendOffer(l); return; }
      case 'DEBUG': {
        seat.debug = msg.overlay;
        const l = this.seatLinks.get(seat.slot); if (l) l.debug = msg.overlay;
        return;
      }
      case 'PING': if (seat.socket) this.send(seat.socket, { t: 'PONG', c: msg.c, serverTick: a?.state.tick ?? 0 }); return;
      // training grounds tools: seat-scoped, accepted only in training rooms (the simulation re-checks state.training)
      case 'TRAIN': {
        if (!this.training || !a) { if (seat.socket) this.send(seat.socket, { t: 'ACK', requestId: msg.requestId, ok: false, code: 'NOT_TRAINING' }); return; }
        a.submitCommand({ type: 'TRAIN', slot: seat.slot, op: msg.op, ...(msg.arg !== undefined ? { arg: msg.arg } : {}), ...(msg.tier !== undefined ? { tier: msg.tier } : {}) }, { slot: seat.slot, requestId: msg.requestId });
        this.later(() => a.afterCommand('TRAIN'));
        return;
      }
      // Fate's Blessing on an offered card (validated by the simulation: phase, offer, a held blessing, one per card)
      case 'BLESS': a?.submitCommand({ type: 'BLESS', slot: seat.slot, offerId: msg.offerId, cardSlot: msg.slot }, { slot: seat.slot, requestId: msg.requestId }); this.later(() => a?.afterCommand('BLESS')); return;
      case 'HELLO': return;
    }
  }

  private later(fn: () => void) { setTimeout(fn, 40); }

  /** Freeze the roster (N is fixed for the run) and create the authoritative run (LOADOUT_LOCK). */
  async startRun() {
    if (this.stage !== 'LOBBY') return;
    this.stage = 'RUN';
    const runId = newId('run');
    const params: CreateRunParams = {
      runId, seed: this.seed, mode: this.mode, trust: this.trust, challengeId: this.challengeId, contentHash: contentHash(), tutorial: this.tutorial,
      roster: this.seats.map((s) => ({ slot: s.slot, profileId: s.profileId, name: s.name, classId: s.classId })),
      ...(this.bounty ? { bounty: this.bounty.modifierId } : {}),   // daily bounty modifier (simulation bounty.ts)
      ...(this.training ? { training: true } : {}),   // training grounds (simulation training.ts)
      ...(this.tutorial ? { guided: true } : {}),     // "First Descent": the guided tutorial crypt (simulation tutorialRoom.ts)
    };
    const state = createRun(params);
    // dev tools only (CURSEBOUND_DEV_TOOLS=1 CURSEBOUND_DEV_THEME=<id>): the first floor uses a chosen theme, like a door
    if (this.mgr.cfg.devTheme && !this.tutorial) state.nextTheme = { round: 1, theme: this.mgr.cfg.devTheme };
    // bounty runs rank in their own division per modifier (protocol boardKey)
    const key = boardKey({ rulesVersion: RULES_VERSION, contentHash: contentHash(), scoreVersion: SCORE_VERSION, n: state.n, mode: this.mode, challengeId: this.challengeId, trust: this.trust, bounty: this.bounty?.modifierId });
    let practice = this.tutorial || this.training;
    if (!practice && this.challengeId) practice = await this.mgr.store.hasRankedAttempt(key, this.seats.map((s) => s.profileId)).catch(() => false);
    // training grounds and the guided tutorial are never persisted (no run record, board, replay or Records entry)
    this.authority = new RunAuthority({ state, store: this.mgr.store, logger: this.mgr.log, host: this, boardKey: key, practice, createParams: params, bountyId: this.bounty?.id ?? null, ...(this.training ? { training: true } : {}), ...(this.tutorial ? { guided: true } : {}) });
    this.mgr.log.info('run_started', { roomId: this.id, runId, n: state.n, mode: this.mode, practice });
    this.broadcastRoom();
    for (const l of this.seatLinks.values()) this.authority.resync(l);
  }

  /** Resume a local solo run from its latest safe checkpoint (labelled resumed). */
  resumeFrom(state: SimState, meta: { persistSeq: number; chunkNo: number; boardKey: string; practice: boolean; bountyId?: string | null }) {
    state.resumed = true;
    for (const p of state.players) { p.connected = false; p.disconnectedAtTick = state.tick; }
    this.stage = 'RUN';
    this.authority = new RunAuthority({ state, store: this.mgr.store, logger: this.mgr.log, host: this, boardKey: meta.boardKey, practice: meta.practice, bountyId: meta.bountyId ?? null, resume: { persistSeq: meta.persistSeq, chunkNo: meta.chunkNo } });
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly cfg: ServerConfig, readonly store: Store, readonly log: Logger) {}

  lanHosts(): string[] {
    return this.cfg.lan ? this.cfg.allowedHosts.filter((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) && h !== '127.0.0.1').map((h) => `http://${h}:${this.cfg.clientPort}`) : [];
  }

  start() {
    const loop = () => {
      const now = performance.now();
      for (const r of this.rooms.values()) {
        if (r.authority) r.authority.update(now);
      }
      this.timer = setTimeout(loop, 2);
    };
    loop();
    setInterval(() => this.gc(), 30000).unref();
  }

  stop() { if (this.timer) clearTimeout(this.timer); }

  private gc() {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      const idle = now - r.lastActivity;
      const ended = r.authority?.state.phase === 'RESULTS';
      const empty = r.seats.every((s) => !s.socket);
      if (((r.training || r.authority?.ephemeral) && empty && idle > 120000) || (ended && empty && idle > 60000) || (r.stage === 'LOBBY' && empty && idle > 10 * 60000) || (empty && idle > 6 * 3600 * 1000)) {
        r.authority?.dispose();
        this.rooms.delete(id);
      }
    }
  }

  createRoom(o: { mode: 'solo' | 'coop'; challenge: 'daily' | 'random' | 'tutorial'; tutorial: boolean; bounty?: RoomBounty | null; training?: boolean }): Room {
    let seed: string;
    let challengeId: string | null = null;
    if (o.challenge === 'daily') {
      const d = new Date();
      const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      seed = `daily-${day}`;
      challengeId = `daily-${day}`;
    } else if (o.tutorial) {
      seed = 'tutorial-1';
      challengeId = 'tutorial';
    } else if (o.training) {
      seed = `training-${crypto.randomBytes(4).toString('hex')}`;   // training grounds: never a board or challenge
    } else {
      seed = crypto.randomBytes(8).toString('hex');
    }
    const trust: 'local' | 'lan' = o.mode === 'coop' && this.cfg.lan ? 'lan' : 'local';
    const room = new Room(this, { mode: o.mode, seed, challengeId, tutorial: o.tutorial, trust, bounty: o.tutorial || o.training ? null : o.bounty ?? null, ...(o.training ? { training: true } : {}) });
    this.rooms.set(room.id, room);
    return room;
  }

  byCode(code: string): Room | null {
    for (const r of this.rooms.values()) if (r.code === code.toUpperCase()) return r;
    return null;
  }

  async resumeRun(runId: string, profileId: string): Promise<{ room: Room; token: string; slot: number }> {
    for (const r of this.rooms.values()) if (r.authority?.state.runId === runId) throw Object.assign(new Error('run is already active in a room'), { code: 'CONFLICT' });
    const run = await this.store.getRun(runId);
    if (!run) throw Object.assign(new Error('run not found'), { code: 'NOT_FOUND' });
    if (run.status !== 'active') throw Object.assign(new Error('run is not resumable'), { code: 'RUN_FINALIZED' });
    if (run.mode !== 'solo') throw Object.assign(new Error('only local solo runs resume from checkpoints'), { code: 'STALE_PHASE' });
    if (!run.members.some((m) => m.profileId === profileId)) throw Object.assign(new Error('not a member of this run'), { code: 'UNAUTHORIZED' });
    const ck = await this.store.latestCheckpoint(runId);
    if (!ck) throw Object.assign(new Error('no safe checkpoint yet (runs resume from the last Fate commit)'), { code: 'NOT_FOUND' });
    const wrap = JSON.parse(ck.stateBlob) as { v: number; persistSeq: number; chunkNo: number; state: string; boardKey: string; practice: boolean; bountyId?: string | null; breakdown?: unknown };
    const state = deserializeState(wrap.state);
    if (wrap.breakdown) restoreBreakdown(state, wrap.breakdown);   // post-run breakdown carried outside the hashed state
    const room = new Room(this, { mode: 'solo', seed: state.seed, challengeId: state.challengeId, tutorial: state.tutorial, trust: 'local', bounty: state.bounty && wrap.bountyId ? { id: wrap.bountyId, modifierId: state.bounty } : null });
    const p = state.players[0];
    const { token } = room.addSeat(p.profileId, p.name, p.classId);
    room.resumeFrom(state, { persistSeq: wrap.persistSeq, chunkNo: wrap.chunkNo, boardKey: wrap.boardKey, practice: wrap.practice, bountyId: wrap.bountyId ?? null });
    this.rooms.set(room.id, room);
    this.log.info('run_resumed', { runId, roomId: room.id, tick: state.tick });
    return { room, token, slot: 0 };
  }

  /** WebSocket session: HELLO with protocol/build/content check and seat token (never in the URL). */
  accept(ws: WebSocket) {
    let room: Room | null = null;
    let seat: Seat | null = null;
    const helloTimer = setTimeout(() => { if (!seat) ws.close(4001, 'HELLO timeout'); }, 5000);
    let strikes = 0;
    ws.on('message', (data, isBinary) => {
      if (isBinary) { ws.close(1003, 'text frames only'); return; }
      const raw = data.toString();
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        if (++strikes > 50) ws.close(1008, 'too many invalid messages');
        ws.send(JSON.stringify({ t: 'ERROR', code: parsed.code, recoverable: true, message: parsed.message } satisfies ServerMessage));
        return;
      }
      const msg = parsed.msg;
      if (!seat) {
        if (msg.t !== 'HELLO') { ws.close(4002, 'HELLO required'); return; }
        if (msg.protocol !== PROTOCOL_VERSION || msg.contentHash !== contentHash()) {
          ws.send(JSON.stringify({ t: 'ERROR', code: 'INCOMPATIBLE_BUILD', recoverable: false, message: `Client build is incompatible (protocol ${msg.protocol}, content ${msg.contentHash}). Reload the page.` } satisfies ServerMessage));
          ws.close(4003, 'incompatible build');
          return;
        }
        room = this.rooms.get(msg.roomId) ?? null;
        seat = room?.seatForToken(msg.seatToken) ?? null;
        if (!room || !seat) {
          ws.send(JSON.stringify({ t: 'ERROR', code: 'SEAT_EXPIRED', recoverable: false, message: 'Seat not found or expired.' } satisfies ServerMessage));
          ws.close(4004, 'seat not found');
          return;
        }
        if (seat.disconnectedAt !== null && room.stage === 'RUN' && Date.now() - seat.disconnectedAt > RULES.reconnectHoldSec * 1000 && room.mode === 'coop') {
          // the seat hold expired: the seat remains in the frozen roster but the player may still return to watch and vote
          this.log.info('reconnect_after_hold', { roomId: room.id, slot: seat.slot });
        }
        clearTimeout(helloTimer);
        room.attach(seat, ws);
        return;
      }
      room!.handle(seat, msg).catch((err) => this.log.error('room_handle_failed', { err: err as Error }));
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (room && seat) room.detach(seat, ws);
    });
    ws.on('error', () => undefined);
  }

  metrics() {
    return [...this.rooms.values()].map((r) => ({ roomId: r.id, code: r.code, stage: r.stage, seats: r.seats.length, mode: r.mode, authority: r.authority?.metrics() ?? null }));
  }

  async shutdown() {
    this.stop();
    for (const r of this.rooms.values()) {
      for (const s of r.seats) if (s.socket) { try { s.socket.close(1001, 'server shutting down'); } catch { /* ignore */ } }
      if (r.authority) { r.authority.dispose(); await r.authority.flush(); }
    }
  }
}
