import { contentHash, DODGE, RULES, TICK_RATE } from '@cursebound/content';
import { BUILD_ID, PROTOCOL_VERSION, SNAP_CODEC, SnapDecoder, unpackEvents, type EventOp, type ServerMessage, type TrainOp } from '@cursebound/protocol';
import { predictMoveTick, type CardForecast, type LedgerView, type MapState, type OfferForecast, type RecapEntry, type Snapshot, type SimEvent } from '@cursebound/simulation';
import { wsTransport, type GameTransport } from './p2p/transport';
import { roomWsUrl } from './runtime';
import { createStore } from './store';

// Room connection (PRD §19.1): sends intentions at 60 Hz, predicts own movement with the shared movement step,
// reconciles against acknowledged authoritative snapshots, interpolates remote entities ~100 ms in the past.
// The room protocol rides a GameTransport: a WebSocket to the authority (local / LAN), or for a peer-to-peer guest
// the data channel to the host's bridge (lib/p2p/guest.ts), which re-signals on every reconnect.

export interface PhaseData {
  runId: string; mode: 'solo' | 'coop'; trust: string; n: number; seed: string; challengeId: string | null; tutorial: boolean;
  round: number; phase: string; deadlineTick: number | null; tick: number; scoreText: string; retire: number[];
  lastClear: { round: number; points: string; cleared: boolean } | null;
  rounds: { round: number; cleared: boolean; basePoints: string; pressure: string; activeTicks: number; referenceTicks: number; speedNum: string; speedDen: string; completedWeight: number; objectiveTotal: number; awarded: string }[];
  endReason: string | null; incident: string | null; resumed: boolean; storagePending: boolean; practice: boolean; boardKey: string;
  nextRound: number; nextIsBoss: boolean; bossId: string | null;
  map: (Pick<MapState, 'w' | 'h' | 'tiles' | 'topology' | 'decorSeed' | 'fallback' | 'theme' | 'layout' | 'rooms' | 'voids' | 'arena' | 'bossSpawn' | 'playerSpawns' | 'enemySpawns'>) | null;
  fate: { round: number; cardId: string }[];
  deathRecaps: { slot: number; round: number; attack: string; source: string; amountText: string; hpFracBefore: number; contributingFactors: string[]; disconnected: boolean; final: boolean }[];
  players: { slot: number; name: string; classId: string; ranks: Record<string, number>; skillPoints: number; spentByBranch: Record<string, number>; mastery: { damage: number; health: number; recovery: number }; ready: boolean; hpT: string; mhpT: string; connected: boolean; life: string; canMastery: boolean }[];
  /** training grounds run (simulation training.ts): no score, records or Fate; TRAIN tools available */
  training?: boolean;
  /** guided first-run tutorial (simulation tutorialRoom.ts): prompts from the snapshot's `gd`, never recorded */
  guided?: boolean;
}

export interface RoomInfo { roomId: string; code: string; mode: 'solo' | 'coop'; trust: string; seats: { slot: number; name: string; classId: string; ready: boolean; connected: boolean; you: boolean }[]; stage: 'LOBBY' | 'RUN' | 'CLOSED'; lan: { enabled: boolean; hosts: string[] }; seed: string | null; challengeId: string | null; /** daily bounty modifier of a bounty room */ bounty?: string | null }

export interface Notice { id: number; level: 'info' | 'warn' | 'error'; code: string; text: string; at: number }

export interface NetState {
  status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';
  error: string | null;
  slot: number;
  welcome: Extract<ServerMessage, { t: 'WELCOME' }> | null;
  room: RoomInfo | null;
  phase: PhaseData | null;
  /** themes: the dungeon behind each card's door (doors), one per card */
  offer: { offerId: string; round: number; cardIds: string[]; snapshotHash: string; deadlineTick: number | null; forecast: OfferForecast; themes?: string[] } | null;
  votes: { offerId: string; votes: { slot: number; cardSlot: number | null; locked: boolean }[]; counts: number[]; deadlineTick: number | null; tick: number } | null;
  myVote: { cardSlot: number | null; locked: boolean; pending: boolean; seq: number };
  commit: Extract<ServerMessage, { t: 'COMMIT' }> | null;
  ledger: LedgerView | null;
  results: any | null;
  notices: Notice[];
  paused: { paused: boolean; reason: string };
  rttMs: number;
  serverTick: number;
  hud: Snapshot | null;           // throttled snapshot copy for React HUD (~10 Hz)
  /** your latest death recap this round (the 'recap' event; simulation runStats.ts), for the "You died to…" card */
  recap: RecapEntry | null;
}

export const netStore = createStore<NetState>({
  status: 'idle', error: null, slot: 0, welcome: null, room: null, phase: null, offer: null, votes: null,
  myVote: { cardSlot: null, locked: false, pending: false, seq: 0 }, commit: null, ledger: null, results: null, notices: [],
  paused: { paused: false, reason: '' }, rttMs: 0, serverTick: 0, hud: null, recap: null,
});

let nextNoticeId = 1;

interface PendingInput { seq: number; mx: number; my: number; ax: number; ay: number; dodge: boolean }
interface TimedSnap { at: number; snap: Snapshot }

/** Opens a fresh transport to the room's authority; called again on every reconnect. */
export type TransportFactory = () => Promise<GameTransport>;

export class GameConnection {
  private ws: GameTransport | null = null;
  private closedByUser = false;
  private retries = 0;
  snaps: TimedSnap[] = [];
  events: SimEvent[] = [];
  map: MapState | null = null;
  private seq = 0;
  private pending: PendingInput[] = [];
  private voteSeq = 0;
  /** predicted own body (shared movement rules: predictMoveTick); dashAt = performance.now() of the last predicted dash start */
  pred = {
    x: 0, y: 0, vx: 0, vy: 0, valid: false, dodgeTimer: 0, dodgeDirX: 1, dodgeDirY: 0, dodgeCharges: DODGE.charges, dodgeCooldown: 0, dodgeMax: DODGE.charges,
    surgeTimer: 0, guardTimer: 0, speed: 4, rr: 1, prevDodge: false, dashAt: 0,
    /** afflictions (snapshot lk / teth / tk): movement-lock ticks, chain anchor + radius, chain ticks (same limits as the authority) */
    lock: 0, teth: null as [number, number, number] | null, tethT: 0,
    /** the aim the authority holds once it has our inputs (it keeps the last non-zero aim input, stepPlayer): the
     *  local hero faces this, not the snapshot's aim, which trails our predicted body by the input round trip */
    ax: 1, ay: 0,
    /** the latest input tick's stretch of the walk: the scene draws the hero from (px, py) to (qx, qy) as the clock
     *  runs through the tick (game/selfView.ts). (qx, qy) is the body, less held ticks it includes early (onSnap). */
    px: 0, py: 0, qx: 0, qy: 0,
  };
  /** how far reconciliations moved the predicted body since the scene last took it (it blends this out, selfView.ts) */
  drift = { x: 0, y: 0 };
  /** dodge bit of the last input the authority acknowledged (edge detection for replay) */
  private ackDodge = false;
  /** inputs still to send that the authority's held ticks already stood in for (onSnap), and a dodge press among them */
  private owed = 0;
  private owedDodge = false;
  /** the body's move per owed tick (drawn as each owed input goes out) */
  private owedStep = { x: 0, y: 0 };
  correction = 0;
  private lastHud = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  onSnapshot: ((s: Snapshot) => void) | null = null;
  /** delta snapshots (protocol snapcodec.ts): rebuilds full snapshots; `sack` once WELCOME confirmed the codec */
  private snapIn = new SnapDecoder();
  private sack = false;

  constructor(public roomId: string, public token: string, private transport: TransportFactory = async () => wsTransport(await roomWsUrl())) {}

  connect() {
    this.closedByUser = false;
    netStore.set({ status: this.retries ? 'reconnecting' : 'connecting', error: null });
    this.transport().then((ws) => this.attach(ws), (err: { code?: string; message?: string }) => {
      if (this.closedByUser) return;
      if (err?.code === 'NO_SESSION') { netStore.set({ status: 'error', error: err.message ?? 'No seat in this tab.' }); return; }
      this.retry();
    });
  }

  private retry() {
    this.retries++;
    netStore.set({ status: 'reconnecting' });
    setTimeout(() => { if (!this.closedByUser) this.connect(); }, Math.min(4000, 300 * this.retries));
  }

  private attach(ws: GameTransport) {
    if (this.closedByUser) { ws.close(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.snapIn.reset();
      this.sack = false;
      // the seat token travels in the HELLO message, never in the URL; `snap` offers delta snapshots (an older
      // authority ignores it and keeps sending full ones)
      ws.send(JSON.stringify({ t: 'HELLO', protocol: PROTOCOL_VERSION, build: BUILD_ID, contentHash: contentHash(), roomId: this.roomId, seatToken: this.token, snap: SNAP_CODEC }));
      netStore.set({ status: 'open' });
      this.pingTimer = setInterval(() => this.send({ t: 'PING', c: performance.now() }), 2000);
    };
    ws.onmessage = (data) => this.onMessage(JSON.parse(data) as ServerMessage);
    ws.onclose = (code, reason) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser) { netStore.set({ status: 'closed' }); return; }
      if (code >= 4001 && code <= 4004) { netStore.set({ status: 'error', error: reason || 'Connection refused by the authority.' }); return; }
      this.retry();
    };
    // a peer-to-peer guest's channel arrives already open (its join handshake ran on it)
    if (ws.readyState === 'open') ws.onopen?.();
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }

  send(m: unknown) {
    if (this.ws && this.ws.readyState === 'open') this.ws.send(JSON.stringify(m));
  }

  notice(level: Notice['level'], code: string, text: string) {
    const n: Notice = { id: nextNoticeId++, level, code, text, at: Date.now() };
    netStore.set((s) => ({ notices: [...s.notices.slice(-4), n] }));
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'WELCOME':
        this.sack = this.snapIn.ordered = m.snap === SNAP_CODEC;
        netStore.set({ welcome: m, slot: m.slot });
        break;
      case 'ROOM': netStore.set({ room: m }); break;
      case 'SNAPSHOT': {
        // full or delta; null = a late (reordered) snapshot or a delta whose base is gone: dropped, the next one is
        // encoded against the newest snapshot we acknowledge here
        const snap = this.snapIn.decode(m) as unknown as Snapshot | null;
        if (!snap) break;
        if (this.sack) this.send({ t: 'SACK', tick: snap.tick });
        this.onSnap(snap, m.ack, m.held ?? 0);
        break;
      }
      case 'EVENTS': {
        const me = netStore.get().slot;
        // a delta seat gets the batch packed (protocol snapcodec.ts packEvents)
        for (const e of (m.pk ? unpackEvents(m.pk) : m.events ?? []) as SimEvent[]) {
          this.events.push(e);
          if (e.t === 'recap' && e.slot === me) netStore.set({ recap: e.recap });   // the live "You died to…" card
        }
        if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
        break;
      }
      case 'PHASE': {
        const d = m.data as PhaseData;
        if (d.map && (!this.map || this.map.tiles !== d.map.tiles)) {
          this.map = { ...d.map, playerSpawns: [], enemySpawns: [] } as MapState;
        }
        const patch: Partial<NetState> = { phase: d };
        if (d.phase !== 'VOTING' && d.phase !== 'FATE_COMMIT') { patch.offer = null; patch.votes = null; }
        if (d.phase === 'ROUND_SETUP') { patch.commit = null; patch.recap = null; this.pred.valid = false; }
        netStore.set(patch);
        break;
      }
      case 'OFFER': {
        const cur = netStore.get();
        const fresh = cur.offer?.offerId !== m.offerId;
        netStore.set({ offer: { offerId: m.offerId, round: m.round, cardIds: m.cardIds, snapshotHash: m.snapshotHash, deadlineTick: m.deadlineTick, forecast: m.forecast as OfferForecast, themes: m.themes }, ...(fresh ? { myVote: { cardSlot: null, locked: false, pending: false, seq: this.voteSeq } } : {}) });
        break;
      }
      case 'VOTE_STATE': {
        const mine = m.votes.find((v) => v.slot === netStore.get().slot);
        netStore.set((s) => ({ votes: m, myVote: mine ? { ...s.myVote, cardSlot: mine.cardSlot, locked: mine.locked } : s.myVote, serverTick: m.tick }));
        break;
      }
      case 'VOTE_ACK': {
        netStore.set((s) => ({ myVote: { ...s.myVote, pending: false } }));
        if (!m.accepted && m.code !== 'DUPLICATE_SEQ') this.notice('warn', m.code ?? 'VOTE_REJECTED', voteRejectText(m.code));
        break;
      }
      case 'COMMIT': netStore.set({ commit: m }); break;
      case 'LEDGER': netStore.set({ ledger: m.view as LedgerView }); break;
      case 'RESULTS': netStore.set({ results: m.summary }); break;
      case 'ACK': if (!m.ok && m.code) this.notice('warn', m.code, ackText(m.code)); break;
      case 'ERROR': this.notice(m.recoverable ? 'warn' : 'error', m.code, m.message); if (!m.recoverable) netStore.set({ error: m.message }); break;
      case 'NOTICE': this.notice(m.level, m.code, m.text); break;
      case 'PAUSED': netStore.set({ paused: { paused: m.paused, reason: m.reason } }); break;
      case 'PONG': netStore.set({ rttMs: Math.round(performance.now() - m.c), serverTick: m.serverTick }); break;
    }
  }

  private onSnap(snap: Snapshot, ack: number, held = 0) {
    const now = performance.now();
    this.snaps.push({ at: now, snap });
    if (this.snaps.length > 30) this.snaps.shift();
    const me = snap.players[netStore.get().slot];
    if (me) {
      // reconcile: authoritative body at the acknowledged input, then replay unacknowledged inputs through the
      // same movement rules the authority runs (dash charges, chained dashes, surge and momentum included)
      for (const p of this.pending) if (p.seq <= ack) this.ackDodge = p.dodge;
      this.pending = this.pending.filter((p) => p.seq > ack);
      if (!movesIn(snap.phase) || cinematicHeld(snap)) this.pending = [];   // inputs the authority dropped at a phase change / cinematic hold never replay
      const prevQx = this.pred.qx, prevQy = this.pred.qy, prevPx = this.pred.px, prevPy = this.pred.py;
      const b = this.pred;
      b.x = me.x; b.y = me.y; b.vx = me.vx; b.vy = me.vy;
      b.dodgeTimer = me.dt; b.dodgeDirX = me.ddx; b.dodgeDirY = me.ddy;
      b.dodgeCharges = me.dc ?? DODGE.charges; b.dodgeMax = me.dcm ?? DODGE.charges; b.dodgeCooldown = me.dcd;   // dcm: a bounty may lower the max
      // the post-dash surge and the guard slow scale ground speed: replay from the authority's, never from our own
      // (a surge kept on our clock was spent again by every replay and ended early, so the hero lagged the authority)
      b.surgeTimer = me.sg ?? 0; b.guardTimer = me.guard ? 1 : 0;
      b.speed = me.spd; b.rr = me.rr ?? 1;
      if (!b.valid) { b.ax = me.ax; b.ay = me.ay; }   // a fresh prediction (new round) starts from the authority's aim
      b.lock = me.lk ?? 0; b.teth = me.teth ?? null; b.tethT = me.tk ?? 0;   // frozen / rooted / chained (afflictions.ts)
      let prev = this.ackDodge;
      if (me.life === 'alive' && movesIn(snap.phase) && !cinematicHeld(snap)) {
        // `held` ticks already moved the authority's body on our last input in place of inputs that had not reached
        // it; it takes the next that many to arrive as done (authority.ts submitInput), so the replay skips them too
        // (carrying a dodge press on). Replaying them anyway put the prediction a tick ahead for every held tick, and
        // each network hiccup came back as a correction. More held ticks than inputs in flight (the snapshot
        // overtook our next input, or we stalled): the next inputs we send are the ones they stood in for.
        let skip = held, carry = false;
        for (const p of this.pending) {
          const dodge: boolean = p.dodge || carry;
          if (skip > 0) { skip--; carry = dodge; continue; }
          predictMoveTick(this.map, b, p.mx, p.my, p.ax, p.ay, dodge && !prev, b.speed, me.c, b.rr);
          prev = dodge; carry = false;
        }
        this.owed = skip; this.owedDodge = carry;
      } else { this.owed = 0; this.owedDodge = false; }
      b.prevDodge = prev;
      // Owed ticks happened early (this snapshot overtook the inputs they stand in for, or we stalled): the body is
      // that far ahead of our own clock, and is drawn there as each owed tick comes round, not as a jump now.
      this.owedStep = { x: b.vx / TICK_RATE, y: b.vy / TICK_RATE };
      const qx = b.x - this.owedStep.x * this.owed, qy = b.y - this.owedStep.y * this.owed;
      if (b.valid) {
        // the tick the hero is drawn along moves with the body; the scene blends the jump out instead of showing it
        const dx = qx - prevQx, dy = qy - prevQy;
        this.correction = Math.hypot(dx, dy);
        b.px = prevPx + dx; b.py = prevPy + dy;
        this.drift.x += dx; this.drift.y += dy;
      } else { b.px = qx; b.py = qy; }
      b.qx = qx; b.qy = qy;
      b.valid = true;
    }
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      netStore.set({ hud: snap, serverTick: snap.tick });
    }
    this.onSnapshot?.(snap);
  }

  /** Called by the scene at 60 Hz with the sampled intention. Applies local prediction immediately. */
  sendInput(mx: number, my: number, ax: number, ay: number, buttons: number) {
    const b = this.pred;
    b.px = b.qx; b.py = b.qy;   // this tick's stretch starts where the last one ended
    const st = netStore.get();
    const snap = this.snaps[this.snaps.length - 1]?.snap;
    if (!snap || !movesIn(snap.phase) || cinematicHeld(snap) || st.paused.paused) { b.px = b.qx = b.x; b.py = b.qy = b.y; return; }
    const q = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 127) / 127));
    const qa = (v: number) => Math.max(-64, Math.min(64, Math.round(v * 64) / 64));
    const seq = ++this.seq;
    const input = { t: 'INPUT', seq, tick: snap.tick, mx: q(mx), my: q(my), ax: qa(ax), ay: qa(ay), b: buttons & 255 };
    this.send(input);
    const me = snap.players[st.slot];
    const dodge = (buttons & 32) !== 0;
    // the authority keeps the previous aim when the aim input is ~zero; mirror that for standing dashes (our last
    // non-zero aim, which the authority will hold by then, not the snapshot's, which may not have seen it yet)
    const hasAim = Math.hypot(input.ax, input.ay) > 1e-4;
    if (hasAim) { this.pred.ax = input.ax; this.pred.ay = input.ay; }
    const pax = this.pred.ax, pay = this.pred.ay;
    this.pending.push({ seq, mx: input.mx, my: input.my, ax: pax, ay: pay, dodge });
    if (this.pending.length > 120) this.pending.shift();
    // a tick the authority already held our last input through stands in for this one (onSnap): it moved the body
    // the reconciliation started from, and the authority takes this input as done (its press carried on)
    if (this.owed > 0) {
      this.owed--; this.owedDodge ||= dodge;
      b.qx = b.x - this.owedStep.x * this.owed; b.qy = b.y - this.owedStep.y * this.owed;
      return;
    }
    const pressed = dodge || this.owedDodge;
    this.owedDodge = false;
    const edge = pressed && !b.prevDodge;
    b.prevDodge = pressed;
    if (me && me.life === 'alive' && b.valid) {
      b.guardTimer = me.guard ? 1 : 0;
      if (predictMoveTick(this.map, b, input.mx, input.my, pax, pay, edge, b.speed, me.c, b.rr)) b.dashAt = performance.now();
    }
    b.qx = b.x; b.qy = b.y;
  }

  vote(cardSlot: number | null, locked: boolean) {
    const offer = netStore.get().offer;
    if (!offer) return;
    const seq = ++this.voteSeq + Math.floor(Date.now() / 1000) % 100000 * 1000;
    netStore.set((s) => ({ myVote: { cardSlot, locked, pending: true, seq } }));
    this.send({ t: 'VOTE', offerId: offer.offerId, seq, slot: cardSlot, locked });
  }

  allocate(nodeId: string) { this.send({ t: 'ALLOCATE', nodeId, requestId: crypto.randomUUID().slice(0, 32) }); }
  refund() { this.send({ t: 'REFUND', requestId: crypto.randomUUID().slice(0, 32) }); }
  mastery(choice: 'damage' | 'health' | 'recovery') { this.send({ t: 'MASTERY', choice, requestId: crypto.randomUUID().slice(0, 32) }); }
  ready(ready: boolean) { this.send({ t: 'READY', ready }); }
  lobby(p: { classId?: string; ready?: boolean }) { this.send({ t: 'LOBBY', ...p }); }
  retire(yes: boolean) { this.send({ t: 'RETIRE', yes }); }
  pause(paused: boolean) { this.send({ t: 'PAUSE', paused }); }
  requestLedger(page = 0) { this.send({ t: 'LEDGER', page }); }
  debug(overlay: boolean) { this.send({ t: 'DEBUG', overlay }); }
  /** Training grounds tool (accepted only in training rooms; simulation training.ts). */
  train(op: TrainOp, arg?: string, tier?: number) { this.send({ t: 'TRAIN', op, ...(arg !== undefined ? { arg } : {}), ...(tier !== undefined ? { tier } : {}), requestId: crypto.randomUUID().slice(0, 32) }); }
  /** Spend a Fate's Blessing on card `cardSlot` of the current offer (simulation blessing.ts). */
  bless(cardSlot: number) {
    const offer = netStore.get().offer;
    if (offer) this.send({ t: 'BLESS', offerId: offer.offerId, slot: cardSlot, requestId: crypto.randomUUID().slice(0, 32) });
  }

  /** Room events (simulation roomEvents.ts): activate shrine `id`, take altar pact `choice`, buy merchant row `choice`. */
  roomEvent(op: EventOp, id: number, choice?: number) { this.send({ t: 'EVENT', op, id, ...(choice !== undefined ? { choice } : {}), requestId: crypto.randomUUID().slice(0, 32) }); }

  /** Interpolated view of remote entities ~100 ms in the past. */
  interpolation(now: number, delayMs = 100): { a: Snapshot; b: Snapshot; t: number } | null {
    const target = now - delayMs;
    const s = this.snaps;
    if (!s.length) return null;
    if (s.length === 1 || target <= s[0].at) return { a: s[0].snap, b: s[0].snap, t: 0 };
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].at <= target) {
        const span = s[i].at - s[i - 1].at || 1;
        return { a: s[i - 1].snap, b: s[i].snap, t: Math.min(1, (target - s[i - 1].at) / span) };
      }
    }
    const last = s[s.length - 1].snap;
    return { a: last, b: last, t: 1 };
  }
}

export function voteRejectText(code?: string): string {
  switch (code) {
    case 'STALE_OFFER': return 'That vote was for an earlier offer and was not counted. Current votes are unchanged.';
    case 'LOCKED': return 'Your vote is already locked for this offer.';
    case 'STALE_PHASE': return 'Voting has closed for this offer.';
    default: return 'The authority did not accept that vote. Your previous vote still stands.';
  }
}

function ackText(code: string): string {
  const m: Record<string, string> = {
    NO_POINTS: 'No skill points left.', TIER_LOCKED: 'Spend more points in this branch first.', PREREQ: 'A prerequisite node is required first.',
    MAX_RANK: 'That node is already at maximum rank.', RESPEC_LOCKED: 'Respec is only allowed before round 1.', MASTERY_LOCKED: 'Mastery unlocks once your tree is complete.',
    STALE_PHASE: 'That action is not available right now.',
    NO_BLESSING: 'You carry no Fate’s Blessing.', ALREADY_BLESSED: 'That card is already blessed.', NO_CURSE: 'That card carries no price to lift.',
    STALE_OFFER: 'That offer has passed.', NOT_TRAINING: 'Only the training grounds allow that.', YARD_FULL: 'The yard is full — clear some foes first.',
    BOSS_ACTIVE: 'A boss already stands in the yard.',
    // room events (simulation roomEvents.ts)
    TOO_FAR: 'Step closer first.', SPENT: 'Its power is spent.', SOLD_OUT: 'Sold out.', NO_FUNDS: 'Not enough cursed coins.',
    PACK_FULL: 'Your pack holds no more blessings.', CANNOT_EQUIP: 'You cannot wear that.', DEAD: 'The fallen cannot trade.', NOT_FOUND: 'It is gone.',
  };
  return m[code] ?? `Action rejected (${code}).`;
}

/** Phases in which heroes move and the client predicts: combat, and the in-world door vote (no attacks there). */
/** The authority holds the fight for a cutscene (boss grand entrance): no inputs are sent or predicted. */
export function cinematicHeld(snap: Snapshot): boolean {
  return snap.cu !== undefined && snap.tick < snap.cu;
}

export function movesIn(phase: string | null | undefined): boolean {
  return phase === 'COMBAT' || phase === 'VOTING';
}

export function deadlineSeconds(deadlineTick: number | null, serverTick: number): number | null {
  if (deadlineTick === null) return null;
  return Math.max(0, (deadlineTick - serverTick) / 60);
}

export { RULES };
export type { CardForecast };
