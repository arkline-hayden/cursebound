// Wire protocol (PRD §19.2). Clients send intentions only; the authority validates everything.
// Schemas impose size, count, string length and nesting limits — transport safeguards, never Fate stat limits.

export const PROTOCOL_VERSION = 4;   // 2: snapshot drops res/resMax (no resource), MASTERY recovery replaces regen; 3: TRAIN (training rooms only) and BLESS (Fate's Blessing); 4: EVENT (room events: shrine, altar pact, merchant purchase), TRAIN op 'event'
export const LIMITS = {
  inputBytes: 256,
  controlBytes: 8 * 1024,
  snapshotChunkBytes: 256 * 1024,
  inputsPerSecond: 60,
  /** room for the inputs a network hiccup or a frame stall delivers at once (they arrived late, not early: the authority
   *  takes most as done, see lateTicks). 12 dropped the tail of every 300 ms hiccup, and each dropped input was a
   *  correction. The average stays at inputsPerSecond. */
  inputBurst: 30,
  maxQueuedInputs: 15,       // ~250 ms
  /** ticks the authority holds a seat's last input through an empty queue and then takes that many late inputs as done
   *  (authority.ts submitInput); a stalled client sends at most this many of the stall's ticks late (ClickMove.ts
   *  InputTicks). ~250 ms. */
  lateTicks: 15,
  nameLength: 24,
  maxSeats: 5,
};

export type ErrorCode =
  | 'INCOMPATIBLE_BUILD' | 'STALE_PHASE' | 'INVALID_INPUT' | 'SEAT_EXPIRED' | 'STORAGE_PENDING' | 'RUN_FINALIZED'
  | 'STALE_OFFER' | 'DUPLICATE_SEQ' | 'LOCKED' | 'ROOM_FULL' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'TOO_LARGE'
  | 'ROSTER_LOCKED' | 'INTERNAL' | string;

// ---------------- Client -> server ----------------

export type ClientMessage =
  | { t: 'HELLO'; protocol: number; build: string; contentHash: string; roomId: string; seatToken: string }
  | { t: 'INPUT'; seq: number; tick: number; mx: number; my: number; ax: number; ay: number; b: number }
  | { t: 'LOBBY'; classId?: string; ready?: boolean }
  | { t: 'ALLOCATE'; nodeId: string; requestId: string }
  | { t: 'REFUND'; requestId: string }
  | { t: 'MASTERY'; choice: 'damage' | 'health' | 'recovery'; requestId: string }
  | { t: 'READY'; ready: boolean }
  | { t: 'VOTE'; offerId: string; seq: number; slot: number | null; locked: boolean }
  | { t: 'RETIRE'; yes: boolean }
  | { t: 'PAUSE'; paused: boolean }
  | { t: 'LEDGER'; page: number }
  | { t: 'FORECAST' }
  | { t: 'DEBUG'; overlay: boolean }
  | { t: 'PING'; c: number }
  /** Training rooms only (the authority refuses it elsewhere): a training-grounds tool (simulation training.ts) */
  | { t: 'TRAIN'; op: TrainOp; arg?: string; tier?: number; requestId: string }
  /** Fate's Blessing: lift the price of card `slot` (0..2) of the current offer during the door vote */
  | { t: 'BLESS'; offerId: string; slot: number; requestId: string }
  /** Room events (simulation roomEvents.ts): activate shrine `id`, take pact `choice` (0..2) of altar `id`, or buy shelf
   *  row `choice` of merchant `id`. The authority validates phase, range, stock and funds. */
  | { t: 'EVENT'; op: EventOp; id: number; choice?: number; requestId: string };

/** Room event interactions (simulation roomEvents.ts EVENT_OPS). */
export const EVENT_OPS = ['shrine', 'altar', 'buy'] as const;
export type EventOp = typeof EVENT_OPS[number];

/** Training-grounds tools (simulation training.ts TRAINING_OPS). */
export const TRAIN_OPS = ['spawn', 'boss', 'clear', 'ai', 'cooldowns', 'heal', 'class', 'level', 'event', /* named mini-boss (minibosses.ts) */ 'miniboss'] as const;
export type TrainOp = typeof TRAIN_OPS[number];

// ---------------- Server -> client ----------------

export interface SeatView { slot: number; name: string; classId: string; ready: boolean; connected: boolean; you: boolean }

export type ServerMessage =
  | { t: 'WELCOME'; slot: number; roomId: string; code: string; protocol: number; contentHash: string; build: string; mode: 'solo' | 'coop'; trust: string; runId: string | null; resumed: boolean; tutorial: boolean; challengeId: string | null; tickRate: number }
  | { t: 'ROOM'; roomId: string; code: string; mode: 'solo' | 'coop'; trust: string; seats: SeatView[]; stage: 'LOBBY' | 'RUN' | 'CLOSED'; lan: { enabled: boolean; hosts: string[] }; seed: string | null; challengeId: string | null; /** daily bounty modifier id of a bounty room */ bounty?: string | null }
  /** held: ticks the authority held your last input through; it takes that many of your next inputs as done (absent = 0) */
  | { t: 'SNAPSHOT'; ack: number; held?: number; snap: unknown }
  | { t: 'EVENTS'; tick: number; events: unknown[] }
  | { t: 'PHASE'; phase: string; round: number; tick: number; data: unknown }
  | { t: 'OFFER'; offerId: string; round: number; cardIds: string[]; snapshotHash: string; deadlineTick: number | null; forecast: unknown; /** door themes, one per card (doors) */ themes?: string[] }
  | { t: 'VOTE_STATE'; offerId: string; votes: { slot: number; cardSlot: number | null; locked: boolean }[]; counts: number[]; deadlineTick: number | null; tick: number }
  | { t: 'VOTE_ACK'; offerId: string; seq: number; accepted: boolean; code?: string }
  | { t: 'COMMIT'; eventId: number; offerId: string; cardId: string; cardSlot: number; tieEvidence: unknown; newStateHash: string; durable: boolean }
  | { t: 'LEDGER'; view: unknown }
  | { t: 'RESULTS'; summary: unknown }
  | { t: 'ACK'; requestId: string; ok: boolean; code?: string }
  | { t: 'ERROR'; code: ErrorCode; recoverable: boolean; requestId?: string; message: string }
  | { t: 'NOTICE'; level: 'info' | 'warn' | 'error'; code: string; text: string }
  | { t: 'PAUSED'; paused: boolean; reason: string }
  | { t: 'PONG'; c: number; serverTick: number };

// ---------------- Validation ----------------

const isInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max: number, re?: RegExp) => typeof v === 'string' && v.length <= max && (!re || re.test(v));
const ID = /^[A-Za-z0-9_\-:.]{1,96}$/;

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; code: ErrorCode; message: string };

export function parseClientMessage(raw: string): ParseResult {
  if (typeof raw !== 'string') return { ok: false, code: 'INVALID_INPUT', message: 'text frames only' };
  if (raw.length > LIMITS.controlBytes) return { ok: false, code: 'TOO_LARGE', message: 'message too large' };
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw); } catch { return { ok: false, code: 'INVALID_INPUT', message: 'invalid JSON' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, code: 'INVALID_INPUT', message: 'object expected' };
  const bad = (message: string): ParseResult => ({ ok: false, code: 'INVALID_INPUT', message });
  // reject nested objects anywhere (flat messages only)
  for (const v of Object.values(m)) if (v !== null && typeof v === 'object') return bad('nested values are not allowed');
  switch (m.t) {
    case 'HELLO':
      if (!isInt(m.protocol, 0, 1e6) || !isStr(m.build, 64) || !isStr(m.contentHash, 64) || !isStr(m.roomId, 64, ID) || !isStr(m.seatToken, 128, /^[A-Za-z0-9_-]+$/)) return bad('bad HELLO');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'INPUT':
      if (raw.length > LIMITS.inputBytes) return { ok: false, code: 'TOO_LARGE', message: 'input too large' };
      if (!isInt(m.seq, 0, 2 ** 31) || !isInt(m.tick, 0, 2 ** 40) || !isNum(m.mx, -1, 1) || !isNum(m.my, -1, 1) || !isNum(m.ax, -64, 64) || !isNum(m.ay, -64, 64) || !isInt(m.b, 0, 255)) return bad('bad INPUT');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'LOBBY':
      if (m.classId !== undefined && !isStr(m.classId, 32, /^[a-z]+$/)) return bad('bad class');
      if (m.ready !== undefined && typeof m.ready !== 'boolean') return bad('bad ready');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'ALLOCATE':
      if (!isStr(m.nodeId, 48, /^[a-z0-9_]+$/) || !isStr(m.requestId, 64, ID)) return bad('bad ALLOCATE');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'REFUND':
      if (!isStr(m.requestId, 64, ID)) return bad('bad REFUND');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'MASTERY':
      if (!['damage', 'health', 'recovery'].includes(m.choice as string) || !isStr(m.requestId, 64, ID)) return bad('bad MASTERY');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'READY':
      if (typeof m.ready !== 'boolean') return bad('bad READY');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'VOTE':
      if (!isStr(m.offerId, 96, ID) || !isInt(m.seq, 1, 2 ** 31) || !(m.slot === null || isInt(m.slot, 0, 2)) || typeof m.locked !== 'boolean') return bad('bad VOTE');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'RETIRE':
      if (typeof m.yes !== 'boolean') return bad('bad RETIRE');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'PAUSE':
      if (typeof m.paused !== 'boolean') return bad('bad PAUSE');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'LEDGER':
      if (!isInt(m.page, 0, 1e6)) return bad('bad LEDGER');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'FORECAST':
      return { ok: true, msg: { t: 'FORECAST' } };
    case 'DEBUG':
      if (typeof m.overlay !== 'boolean') return bad('bad DEBUG');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'PING':
      if (!isNum(m.c, 0, 1e15)) return bad('bad PING');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'TRAIN':
      if (!(TRAIN_OPS as readonly string[]).includes(m.op as string) || !isStr(m.requestId, 64, ID)) return bad('bad TRAIN');
      if (m.arg !== undefined && !isStr(m.arg, 32, /^[a-z0-9_]{1,32}$/)) return bad('bad TRAIN arg');
      if (m.tier !== undefined && !isInt(m.tier, 0, 2)) return bad('bad TRAIN tier');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'BLESS':
      if (!isStr(m.offerId, 96, ID) || !isInt(m.slot, 0, 2) || !isStr(m.requestId, 64, ID)) return bad('bad BLESS');
      return { ok: true, msg: m as unknown as ClientMessage };
    case 'EVENT':
      if (!(EVENT_OPS as readonly string[]).includes(m.op as string) || !isInt(m.id, 0, 2 ** 31) || !isStr(m.requestId, 64, ID)) return bad('bad EVENT');
      if (m.choice !== undefined && !isInt(m.choice, 0, 15)) return bad('bad EVENT choice');
      return { ok: true, msg: m as unknown as ClientMessage };
    default:
      return bad('unknown message type');
  }
}

/** Quantize an input so client prediction and authority use identical values. */
export function quantizeInput(mx: number, my: number, ax: number, ay: number) {
  const qm = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 127) / 127));
  const qa = (v: number) => Math.max(-64, Math.min(64, Math.round(v * 64) / 64));
  return { mx: qm(mx), my: qm(my), ax: qa(ax), ay: qa(ay) };
}

/** Sanitize a display name: trim, collapse whitespace, strip control/format chars, clamp length. Rendered as text only. */
export function sanitizeName(s: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, LIMITS.nameLength) || 'Wanderer';
}

/** Leaderboard division. Daily bounty runs get their own division per modifier (a trailing `bounty:<id>` segment), so a
 *  handicapped run never competes with open runs and every modifier is ranked among its own; keys without it are unchanged. */
export function boardKey(p: { rulesVersion: string; contentHash: string; scoreVersion: string; n: number; mode: string; challengeId: string | null; trust: string; bounty?: string | null }): string {
  const parts = [p.rulesVersion, p.contentHash, p.scoreVersion, `n${p.n}`, p.mode, p.challengeId ?? 'open', p.trust];
  if (p.bounty) parts.push(`bounty:${p.bounty}`);
  return parts.join('|');
}

export const BUILD_ID = 'cursebound-0.1.0';
