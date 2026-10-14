import { Big } from '@cursebound/numeric';
import { AFFLICTION_RULES as R, ATTACK_INFLICT, TICK_RATE, type AfflictionId, type EnemyAttackDef } from '@cursebound/content';
import { inCinematic } from './cinematic';
import { hitPlayer } from './combat';
import { registerGlobalHooks } from './hooks';
import { B } from './stats';
import type { Hazard, PlayerAfflictions, PlayerState, SimEvent, SimState } from './types';

// Hero afflictions inflicted by enemies (the player-side counterpart of cc.ts). Statuses live in PlayerState.buffs
// under their own ids ('chained', 'frozen', 'poisoned', 'blinded', 'rooted', 'silenced', 'slowed', plus the stacking
// 'chill'), so the snapshot's `buffs` shows them as-is. Bookkeeping (chill stacks, diminishing returns, the chain
// anchor, poison damage) lives in PlayerState.aff — optional, created lazily, plain numbers plus one Big.
//
//   chained   - cannot leave a radius around a ground anchor (players.ts movement helpers, shared with prediction).
//               Starting a dash breaks the chain.
//   frozen    - no movement, dodge, attacks or skills. Three chill stacks within a few seconds freeze; afterwards the
//               hero is immune to freezing for a moment.
//   rooted    - no movement or dodge; attacks and skills still work.
//   silenced  - no skills (actives and signature); basic attacks still work.
//   poisoned  - damage over time; healing received is halved while it lasts (combat.ts healPlayer).
//   blinded   - presentation: the hero's vision shrinks (client); the minimap hides foes.
//   slowed    - movement speed multiplier (strongest of chill / slowed applies).
// Counterplay: dodge i-frames avoid every affliction (callers also skip i-framed heroes for projectiles and bursts),
// durations are short, and controls in the same family within AFFLICTION_RULES.drWindowSec last half as long, then
// are ignored. Nothing here acts while a boss intro cinematic holds the simulation (state.cinematicUntilTick).

const T = (sec: number) => Math.max(1, Math.round(sec * TICK_RATE));

/** A boss-intro cinematic is holding the simulation (cinematic.ts: state.cinematicUntilTick). */
export function cinematicFrozen(state: SimState): boolean {
  return inCinematic(state);
}

function aff(p: PlayerState): PlayerAfflictions { return (p.aff ??= { n: {} }); }

export function hasStatus(state: SimState, p: PlayerState, id: string): boolean {
  for (const b of p.buffs) if (b.id === id && b.until > state.tick) return true;
  return false;
}

function setBuff(p: PlayerState, id: string, until: number, value = 0, replace = false) {
  const ex = p.buffs.find((b) => b.id === id);
  if (!ex) { p.buffs.push({ id, until, value }); return; }
  if (replace) { ex.until = until; ex.value = value; return; }
  ex.until = Math.max(ex.until, until);
  ex.value = Math.max(ex.value, value);
}

function clearBuff(p: PlayerState, id: string) {
  p.buffs = p.buffs.filter((b) => b.id !== id);
}

/** Diminishing-returns scale for a control in a family: 1, then 0.5 within the window, then 0 (ignored). */
function drScale(state: SimState, p: PlayerState, status: string): number {
  const fam = R.families[status];
  if (!fam) return 1;
  const n = aff(p).n;
  const last = n['dT_' + fam];
  const within = last !== undefined && state.tick - last < T(R.drWindowSec);
  const k = within ? (n['dN_' + fam] ?? 0) + 1 : 0;
  if (k >= 2) return 0;
  n['dN_' + fam] = k;
  n['dT_' + fam] = state.tick;
  return 0.5 ** k;
}

export interface AfflictOpts {
  /** enemy id and names for recaps / poison damage */
  srcId?: number;
  source?: string;
  attack?: string;
  /** chain anchor (default: where the hero stands) */
  anchorX?: number; anchorY?: number;
  /** slow fraction (chill / slowed) or chain radius */
  value?: number;
  /** poison damage per second */
  dps?: Big;
  /** apply even during i-frames (internal: freezes caused by a chill that already landed) */
  ignoreIframes?: boolean;
  /** refresh silently (no event) when the status is already active — lingering ground patches */
  quietRefresh?: boolean;
}

/**
 * Inflict an affliction on a hero. Returns the applied duration in seconds (0 = avoided: dead, i-frames, immune,
 * diminishing returns, cinematic hold).
 */
export function afflict(state: SimState, ev: SimEvent[], p: PlayerState, status: AfflictionId, sec: number, o: AfflictOpts = {}): number {
  if (p.lifeState !== 'alive' || !(sec > 0) || cinematicFrozen(state)) return 0;
  if (p.iframes > 0 && !o.ignoreIframes) return 0;
  if (status === 'chill') { addChill(state, ev, p, o.value ?? R.chillSlow, sec, 1); return sec; }
  const n = aff(p).n;
  if (status === 'frozen' && (n.fzImm ?? 0) > state.tick) return 0;
  const active = hasStatus(state, p, status);
  if (active && o.quietRefresh && !R.families[status]) {
    refresh(state, p, status, sec, o);
    return sec;
  }
  const k = drScale(state, p, status);
  if (k <= 0) {
    if (!active) ev.push({ t: 'afflict', slot: p.slot, s: status, sec: 0, x: p.x, y: p.y });
    return 0;
  }
  const dur = sec * k;
  refresh(state, p, status, dur, o);
  const out: Extract<SimEvent, { t: 'afflict' }> = { t: 'afflict', slot: p.slot, s: status, sec: Math.round(dur * 100) / 100, x: p.x, y: p.y };
  if (status === 'chained') { out.ax = n.tx; out.ay = n.ty; }
  if (!(active && o.quietRefresh)) ev.push(out);
  return dur;
}

function refresh(state: SimState, p: PlayerState, status: AfflictionId, dur: number, o: AfflictOpts) {
  const a = aff(p);
  const n = a.n;
  const until = state.tick + T(dur);
  switch (status) {
    case 'chained':
      n.tx = o.anchorX ?? p.x; n.ty = o.anchorY ?? p.y; n.tr = o.value ?? R.chainRadius;
      setBuff(p, 'chained', until, 0, true);
      break;
    case 'frozen':
      setBuff(p, 'frozen', until);
      n.fzImm = until + T(R.freezeImmuneSec);
      n.chS = 0;
      p.vx = 0; p.vy = 0; p.guardTimer = 0;
      break;
    case 'poisoned': {
      setBuff(p, 'poisoned', until);
      const dps = o.dps ?? Big.ZERO;
      if (!a.poison || dps.gt(a.poison.dps)) a.poison = { dps, source: o.source ?? 'Poison', attack: o.attack ?? 'Poison', srcId: o.srcId };
      if (!((n.pzNext ?? 0) > state.tick)) n.pzNext = state.tick + T(R.poisonTickSec);
      break;
    }
    case 'slowed':
      setBuff(p, 'slowed', until, Math.min(R.slowCap, o.value ?? R.webSlow));
      break;
    default:
      setBuff(p, status, until);
  }
}

/** Add chill stacks (slow + freeze build-up): freezeStacks within freezeStackWindowSec freeze the hero. */
export function addChill(state: SimState, ev: SimEvent[], p: PlayerState, slow: number, sec: number, stacks = 1) {
  if (p.lifeState !== 'alive' || cinematicFrozen(state)) return;
  const n = aff(p).n;
  setBuff(p, 'chill', state.tick + T(sec), Math.min(R.slowCap, slow));
  if (hasStatus(state, p, 'frozen') || (n.fzImm ?? 0) > state.tick) return;
  if (!(state.tick - (n.chT ?? -1e9) <= T(R.freezeStackWindowSec))) n.chS = 0;
  n.chS = (n.chS ?? 0) + stacks;
  n.chT = state.tick;
  if (n.chS >= R.freezeStacks) {
    n.chS = 0;
    afflict(state, ev, p, 'frozen', R.freezeSec, { ignoreIframes: true });
  } else {
    ev.push({ t: 'afflict', slot: p.slot, s: 'chill', sec: n.chS, x: p.x, y: p.y });
  }
}

/** End a chain early (a dash breaks it). */
export function breakChain(state: SimState, ev: SimEvent[], p: PlayerState) {
  if (!p.buffs.some((b) => b.id === 'chained')) return;
  clearBuff(p, 'chained');
  if (p.aff) { delete p.aff.n.tx; delete p.aff.n.ty; delete p.aff.n.tr; }
  ev.push({ t: 'afflict', slot: p.slot, s: 'chain_break', sec: 0, x: p.x, y: p.y });
}

/** Current chill stack count (0 when the window lapsed). */
export function chillStacks(state: SimState, p: PlayerState): number {
  const n = p.aff?.n;
  if (!n || !n.chS) return 0;
  return state.tick - (n.chT ?? -1e9) <= T(R.freezeStackWindowSec) ? n.chS : 0;
}

/** Heal multiplier from afflictions (poison halves healing received). */
export function healFactor(state: SimState, p: PlayerState): string | null {
  return hasStatus(state, p, 'poisoned') ? R.poisonHealFactor : null;
}

// ---------------- attack → affliction ----------------

/** Afflictions of attacks that are not authored enemy attacks (elite affixes). */
const AFFIX_INFLICT: Record<string, NonNullable<EnemyAttackDef['inflict']>> = {
  affix_hook: { status: 'chained', sec: R.chainSec, value: R.chainRadius },
};

export function inflictFor(attackId: string): NonNullable<EnemyAttackDef['inflict']> | undefined {
  return ATTACK_INFLICT[attackId] ?? AFFIX_INFLICT[attackId];
}

/**
 * Apply an attack's authored affliction to a hero it hit. `damage` is the attack's per-hit damage (poison deals a
 * share of it per second). Returns the applied duration.
 */
export function inflictHit(state: SimState, ev: SimEvent[], p: PlayerState, attackId: string, o: { srcId?: number; source?: string; attack?: string; damage?: Big; anchorX?: number; anchorY?: number }): number {
  const inf = inflictFor(attackId);
  if (!inf) return 0;
  const dps = inf.status === 'poisoned' && o.damage ? o.damage.mul(B('0.3')) : undefined;
  return afflict(state, ev, p, inf.status, inf.sec, { srcId: o.srcId, source: o.source, attack: o.attack, value: inf.value, dps, anchorX: o.anchorX, anchorY: o.anchorY });
}

// ---------------- snapshot ----------------

/** Snapshot extras for a hero: tether [x, y, r] (contract), movement-lock / tether ticks left (prediction) and chill stacks. */
export function afflictionSnapshot(state: SimState, p: PlayerState): { teth?: [number, number, number]; lk?: number; tk?: number; chs?: number } {
  if (!p.aff && !p.buffs.length) return {};
  const out: { teth?: [number, number, number]; lk?: number; tk?: number; chs?: number } = {};
  let lock = 0;
  for (const b of p.buffs) {
    if (b.until <= state.tick) continue;
    if (b.id === 'frozen' || b.id === 'rooted') lock = Math.max(lock, b.until - state.tick);
    else if (b.id === 'chained' && p.aff?.n.tr) {
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      out.teth = [r3(p.aff.n.tx ?? p.x), r3(p.aff.n.ty ?? p.y), r3(p.aff.n.tr)];
      out.tk = b.until - state.tick;
    }
  }
  if (lock > 0) out.lk = lock;
  const cs = chillStacks(state, p);
  if (cs > 0) out.chs = cs;
  return out;
}

// ---------------- lingering ground patches ----------------

/** Bile venom puddles / venomous trails ('venom': damage = poison dps) and web patches ('web': slow). */
export const AFFLICTION_HAZARDS = ['venom', 'web'] as const;

function insideHazard(p: PlayerState, h: Hazard): boolean {
  return (p.x - h.x) ** 2 + (p.y - h.y) ** 2 <= (h.radius + 0.25) ** 2;
}

function patchTick(state: SimState, ev: SimEvent[], h: Hazard) {
  if (cinematicFrozen(state)) return;
  if (state.tick < (h.armTick ?? h.bornTick) || (state.tick - h.bornTick) % 10 !== 0) return;
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || !insideHazard(p, h)) continue;
    if (h.kind === 'venom') {
      const owner = state.enemies.find((e) => e.id === h.ownerId);
      afflict(state, ev, p, 'poisoned', R.poisonSec * 0.5, { srcId: h.ownerId, source: owner ? 'Venom' : 'Venom', attack: 'Venom Puddle', dps: h.damage, quietRefresh: true });
    } else if (h.kind === 'web') {
      afflict(state, ev, p, 'slowed', 0.35, { value: R.webSlow, quietRefresh: true, srcId: h.ownerId });
    }
  }
}

/** Drop a lingering patch (enemy-owned hazard). */
export function dropPatch(state: SimState, ownerId: number, kind: 'venom' | 'web', x: number, y: number, radius: number, sec: number, dps: Big, armSec = 0.15): Hazard {
  const h: Hazard = {
    id: state.nextId++, kind, owner: 'enemy', ownerId, x, y, dx: 1, dy: 0, length: 0, width: 0, radius, inner: 0, outer: 0, speed: 0,
    bornTick: state.tick, untilTick: state.tick + T(sec), nextTick: state.tick, interval: 10, damage: dps, dtype: kind === 'venom' ? 'decay' : 'physical',
    generation: 0, hitSlots: [], armTick: state.tick + T(armSec),
  };
  state.hazards.push(h);
  return h;
}

// ---------------- per-tick upkeep ----------------

function upkeep(state: SimState, ev: SimEvent[], p: PlayerState) {
  const a = p.aff;
  if (!a) return;
  const n = a.n;
  const t = state.tick;
  // poison damage over time
  if (a.poison) {
    if (!hasStatus(state, p, 'poisoned') || p.lifeState !== 'alive') { delete a.poison; delete n.pzNext; }
    else if (t >= (n.pzNext ?? t)) {
      n.pzNext = t + T(R.poisonTickSec);
      if (!a.poison.dps.isZero()) {
        hitPlayer(state, ev, p, a.poison.dps.mul(B(R.poisonTickSec)), { attack: a.poison.attack, source: a.poison.source, fromX: p.x, fromY: p.y, dtype: 'decay', hazard: true, srcId: a.poison.srcId });
      }
    }
  }
  // a chain that ran out: forget the anchor and tell the client the links fell away
  if (n.tr !== undefined && !hasStatus(state, p, 'chained')) {
    delete n.tx; delete n.ty; delete n.tr;
    clearBuff(p, 'chained');
    ev.push({ t: 'afflict', slot: p.slot, s: 'chain_break', sec: 0, x: p.x, y: p.y });
  }
  // thaw cue when a freeze ends
  if (n.fz !== undefined && !hasStatus(state, p, 'frozen')) {
    delete n.fz;
    ev.push({ t: 'afflict', slot: p.slot, s: 'thaw', sec: 0, x: p.x, y: p.y });
  } else if (n.fz === undefined && hasStatus(state, p, 'frozen')) n.fz = 1;
  if (p.lifeState !== 'alive') {
    // downed / dead heroes shed movement afflictions
    p.buffs = p.buffs.filter((b) => b.id !== 'frozen' && b.id !== 'rooted' && b.id !== 'chained');
  }
}

registerGlobalHooks({
  onRoundStart(state) {
    for (const p of state.players) {
      delete p.aff;
      p.buffs = p.buffs.filter((b) => !['chained', 'frozen', 'poisoned', 'blinded', 'rooted', 'silenced', 'slowed', 'chill'].includes(b.id));
    }
  },
  onTick(state, ev) {
    if (cinematicFrozen(state)) return;
    for (const p of state.players) upkeep(state, ev, p);
  },
  hazardTick(state, ev, h) {
    if (h.owner !== 'enemy') return undefined;
    if (h.kind === 'venom' || h.kind === 'web') { patchTick(state, ev, h); return true; }
    return undefined;
  },
});
