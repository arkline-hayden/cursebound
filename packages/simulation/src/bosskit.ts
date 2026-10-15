import { BOSS_BY_ID, RULES, SKY_FALL, TICK_SEC, type BossDef, type EnemyAttackDef, type TelegraphShape } from '@cursebound/content';
import { breakChain } from './afflictions';
import { actMul } from './cc';
import { enemyAttackDamage, hitPlayer } from './combat';
import { dist2, inCone, isWall, moveCircle, norm } from './geometry';
import { registerGlobalHooks } from './hooks';
import { B, toFloatClamped } from './stats';
import type { EnemyState, Hazard, MapState, PlayerState, SimEvent, SimState, Telegraph } from './types';

// Boss kits. A boss whose fight is more than the shared pattern runner (ai.ts stepBoss) registers a kit here. The shared
// code keeps what every boss shares: phase transitions by health (boss_phase), the reinforcement waves at 2/3 and 1/3
// health (director.ts bossReinforcements) and stagger. The kit runs everything after that: its pattern modules,
// movement, telegraphs and releases, and its own enemy hazards (registerKitHazard). Kit counters live in
// EnemyState.bvars / Hazard.vars as plain numbers, so a checkpoint restores a fight mid-module. Deterministic: only
// state, the seeded ai stream and the arguments.
//
// Shared rules for kit attacks: every damaging release is telegraphed first (Telegraph objects the client draws and the
// reference bot reads), dodge i-frames avoid damage and forced movement, and forced movement never drops a hero into a
// chasm unannounced: a push that carries a hero over the brink is the long fall (voidFall, content SKY_FALL).

const DT = TICK_SEC;

export { bossAltitude, bossImmune, bossKit, registerBossKit, type BossKit } from './bossregistry';

// ---------------- small helpers ----------------

export const bv = (e: EnemyState): Record<string, number> => (e.bvars ??= {});
export const alive = (state: SimState): PlayerState[] => state.players.filter((p) => p.lifeState === 'alive');
export const freqOf = (e: EnemyState): number => toFloatClamped(e.attackFreq, 1e12);
/** Ticks for `sec` seconds of boss time (scaled by enemy attack frequency, at least one tick). */
export const ticksFor = (e: EnemyState, sec: number): number => Math.max(1, Math.round(sec / freqOf(e) / DT));
export const bossName = (e: EnemyState): string => BOSS_BY_ID[e.kind]?.name ?? 'Boss';
export const smooth = (t: number): number => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

export function addTelegraph(state: SimState, e: EnemyState, attack: string, shape: TelegraphShape, x: number, y: number, dx: number, dy: number, releaseTick: number): Telegraph {
  const t: Telegraph = { id: state.nextId++, ownerId: e.id, shape, x, y, dx, dy, startTick: state.tick, releaseTick, attack };
  state.telegraphs.push(t);
  return t;
}

export function dropTelegraphs(state: SimState, e: EnemyState, attack: string) {
  state.telegraphs = state.telegraphs.filter((t) => !(t.ownerId === e.id && t.attack === attack));
}

/** Hit a hero with a kit attack (dodge i-frames avoid it inside hitPlayer). */
export function hitHero(state: SimState, ev: SimEvent[], e: EnemyState, p: PlayerState, a: EnemyAttackDef, amount = enemyAttackDamage(state, e, a.damageCoef, true), x = e.x, y = e.y, hazard = false) {
  hitPlayer(state, ev, p, amount, { attack: a.name, source: bossName(e), fromX: x, fromY: y, dtype: a.damageType, hazard, srcId: e.id });
}

/** Open floor near (x, y): the tile itself, or the nearest floor tile within `reach` rings. */
export function floorNear(map: MapState, x: number, y: number, reach = 6): [number, number] {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!isWall(map, tx, ty)) return [x, y];
  for (let r = 1; r <= reach; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || isWall(map, tx + dx, ty + dy)) continue;
      const cx = tx + dx + 0.5, cy = ty + dy + 0.5, d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = [cx, cy]; }
    }
    if (best) return best;
  }
  return [x, y];
}

// ---------------- chasms: void tiles, safe ground, the long fall ----------------

const VOID_SETS = new WeakMap<number[], Set<number>>();

/** Is (x, y) over a chasm tile (MapState.voids)? Ordinary walls are not chasms. */
export function isVoidAt(map: MapState, x: number, y: number): boolean {
  const list = map.voids;
  if (!list?.length) return false;
  let set = VOID_SETS.get(list);
  if (!set) { set = new Set(list); VOID_SETS.set(list, set); }
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return set.has(ty * map.w + tx);
}

/** The nearest floor tile to (x, y) with no chasm within `margin` tiles (solid rock to stand on). */
export function safeSpot(map: MapState, x: number, y: number, margin: number): [number, number] {
  const tx = Math.floor(x), ty = Math.floor(y);
  const ok = (cx: number, cy: number) => {
    if (isWall(map, cx, cy)) return false;
    for (let dy = -margin; dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) if (isVoidAt(map, cx + dx + 0.5, cy + dy + 0.5)) return false;
    return true;
  };
  for (let r = 0; r <= 16; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !ok(tx + dx, ty + dy)) continue;
      const cx = tx + dx + 0.5, cy = ty + dy + 0.5, d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = [cx, cy]; }
    }
    if (best) return best;
  }
  const s = map.bossSpawn ?? map.playerSpawns[0] ?? { x, y };
  return floorNear(map, s.x, s.y);
}

/**
 * The long fall: a hero pushed over the brink drops out of sight and is set back on solid rock nearby, taking
 * SKY_FALL.healthFrac of their maximum health (it can down a wounded hero, never kills outright from full health) with
 * a moment of invulnerability. Chains break. Events: foe_fx 'void_fall' (where they fell, where they land) and a
 * 'teleport' (style 'skyfall') so prediction snaps.
 */
export function voidFall(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState) {
  const map = state.map!;
  const fx = p.x, fy = p.y;
  const [sx, sy] = safeSpot(map, fx, fy, SKY_FALL.safeRadius);
  breakChain(state, ev, p);
  p.x = sx; p.y = sy; p.vx = 0; p.vy = 0; p.dodgeTimer = 0;
  ev.push({ t: 'foe_fx', id: e.id, fx: 'void_fall', x: fx, y: fy, tx: sx, ty: sy });
  ev.push({ t: 'teleport', slot: p.slot, fx, fy, x: sx, y: sy, style: 'skyfall' });
  hitPlayer(state, ev, p, p.maxHp.mul(B(SKY_FALL.healthFrac)), { attack: 'The Long Fall', source: bossName(e), fromX: sx, fromY: sy, dtype: 'physical', hazard: true, srcId: e.id });
  p.iframes = Math.max(p.iframes, SKY_FALL.iframes);
}

/**
 * Forced movement of a hero by (mx, my) world units this tick (gales, gravity wells). Walls stop it (sliding). Pressed
 * against the brink of a chasm, the push that cannot move the hero builds up (PlayerState.vars 'bk.grip', reset the
 * moment they are not pinned); once it passes SKY_FALL.grip world units the hero goes over: the long fall. So a hero
 * pinned at the edge tips over after a beat, while one walking into the wind (or stepping off the edge) never does.
 * Returns true when the hero fell.
 */
export function pushHero(state: SimState, ev: SimEvent[], p: PlayerState, mx: number, my: number, e: EnemyState): boolean {
  const map = state.map;
  if (!map || p.lifeState !== 'alive' || (mx === 0 && my === 0)) return false;
  const [ux, uy] = norm(mx, my);
  const r = moveCircle(map, p.x, p.y, mx, my, RULES.playerRadius);
  const lost = Math.hypot(mx, my) - Math.hypot(r.x - p.x, r.y - p.y);
  p.x = r.x; p.y = r.y;
  const edge = RULES.playerRadius + 0.05;
  const pinned = lost > 1e-6 && isVoidAt(map, p.x + ux * edge, p.y + uy * edge);
  const prev = p.vars['bk.gripT'] === state.tick - 1 ? p.vars['bk.grip'] ?? 0 : 0;
  if (!pinned) { delete p.vars['bk.grip']; delete p.vars['bk.gripT']; return false; }
  const grip = prev + lost;
  if (grip < SKY_FALL.grip) { p.vars['bk.grip'] = grip; p.vars['bk.gripT'] = state.tick; return false; }
  delete p.vars['bk.grip']; delete p.vars['bk.gripT'];
  voidFall(state, ev, p, e);
  return true;
}

// ---------------- kit hazards ----------------

type KitHazardFn = (state: SimState, ev: SimEvent[], h: Hazard, owner: EnemyState | undefined) => void;
const KIT_HAZARDS: Record<string, KitHazardFn> = {};

/** A kit's own enemy hazard kind (ticked by hooks.hazardTick before the core hazard rules). */
export function registerKitHazard(kind: string, fn: KitHazardFn) { KIT_HAZARDS[kind] = fn; }

registerGlobalHooks({
  hazardTick(state, ev, h) {
    if (h.owner !== 'enemy') return undefined;
    const fn = KIT_HAZARDS[h.kind];
    if (!fn) return undefined;
    fn(state, ev, h, state.enemies.find((x) => x.id === h.ownerId));
    return true;
  },
});

// ---------------- pattern modules ----------------

/**
 * A pattern module of a kit: `start` puts the boss in windup (e.attack) and lays the telegraphs; the driver then runs
 * windup -> release -> recovery on the boss's own clock (attack frequency, chill and freeze) and calls the hooks.
 */
export interface KitModule {
  start(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): void;
  /** every tick of the module, after the timer advanced (any stage) */
  tick?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, stage: 'windup' | 'release' | 'recovery', k: number): void;
  release?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef): void;
  recover?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef): void;
  end?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef): void;
}

/** Enter the windup of `a` aimed along (dx, dy) toward (tx, ty). */
export function beginModule(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, dx: number, dy: number, tx: number, ty: number, telegraphId = -1) {
  const windup = a.windupSec / freqOf(e);
  e.fx = dx || e.fx; e.fy = dy || e.fy;
  e.attack = { attackId: a.id, stage: 'windup', timer: windup, ox: e.x, oy: e.y, dx, dy, tx, ty, hitSlots: [], telegraphId };
  e.state = 'windup';
  e.vx = 0; e.vy = 0;
  ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'windup' });
}

/** Release tick of the module that is about to begin (telegraphs end exactly when the windup does). */
export function releaseTickFor(state: SimState, e: EnemyState, a: EnemyAttackDef): number {
  return state.tick + Math.max(0, Math.round(a.windupSec / freqOf(e) / DT));
}

/** Drive the boss's current module one tick (the kit's counterpart of ai.ts stepAttack). */
export function stepModule(state: SimState, ev: SimEvent[], e: EnemyState, def: BossDef, modules: Record<string, KitModule>) {
  const at = e.attack!;
  const a = def.attacks.find((x) => x.id === at.attackId);
  const m = a ? modules[a.kind] : undefined;
  if (!a || !m) { e.attack = null; e.state = 'idle'; e.patternStep++; return; }
  const f = freqOf(e);
  at.timer -= DT * actMul(state, e);
  const dur = (st: string) => (st === 'windup' ? a.windupSec : st === 'release' ? a.releaseSec : a.recoverySec) / f;
  const progress = () => Math.max(0, Math.min(1, 1 - at.timer / Math.max(1e-6, dur(at.stage))));
  m.tick?.(state, ev, e, a, at.stage, progress());
  if (!e.attack) return;   // the hook ended the module (e.g. staggered)
  if (at.stage === 'windup') {
    if (at.timer > 0) return;
    at.stage = 'release';
    at.timer += a.releaseSec / f;
    e.state = 'attack';
    ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'release' });
    m.release?.(state, ev, e, a);
    if (!e.attack) return;
  }
  if (at.stage === 'release') {
    if (at.timer > 0) return;
    at.stage = 'recovery';
    at.timer += a.recoverySec / f;
    e.state = 'recovery';
    m.recover?.(state, ev, e, a);
    if (!e.attack) return;
  }
  if (at.stage === 'recovery') {
    if (at.timer > 0) return;
    e.attack = null;
    e.state = 'idle';
    e.patternStep++;
    m.end?.(state, ev, e, a);
  }
}

/** Shared pattern bookkeeping (the rules of ai.ts stepBoss): the next module to start, or null while the pause between
 *  patterns runs (a finished pattern starts that pause). */
export function nextModule(e: EnemyState, def: BossDef): EnemyAttackDef | null {
  if ((e.cooldowns['_pause'] ?? 0) > 0) return null;
  const ph = def.phases[e.phaseIndex] ?? def.phases[0];
  const pattern = ph.patterns[e.patternIndex % ph.patterns.length];
  if (e.patternStep >= pattern.length) {
    e.patternIndex++;
    e.patternStep = 0;
    e.cooldowns['_pause'] = 1.2 * Number(ph.cadence) / freqOf(e);
    return null;
  }
  return def.attacks.find((x) => x.id === pattern[e.patternStep]) ?? null;
}

/**
 * A new phase opens on its first pattern: the shared phase change (ai.ts) resets the pattern while a module may still be
 * running, and that module's end would skip the opener. Call between modules (no e.attack).
 */
export function openPhase(e: EnemyState) {
  const v = bv(e);
  if (v.ph === undefined) v.ph = e.phaseIndex;
  if (v.ph === e.phaseIndex || e.attack) return;
  v.ph = e.phaseIndex;
  e.patternIndex = 0; e.patternStep = 0; e.cooldowns['_pause'] = 0;
}

/** The close-range cone every kit boss carries ('sweep'): telegraphed cone, one hit per hero inside it. */
export const SWEEP: KitModule = {
  start(state, ev, e, a, target) {
    let [dx, dy] = norm(target.x - e.x, target.y - e.y);
    if (!dx && !dy) { dx = e.fx; dy = e.fy; }
    const t = addTelegraph(state, e, a.id, a.telegraph, e.x, e.y, dx, dy, releaseTickFor(state, e, a));
    beginModule(state, ev, e, a, dx, dy, target.x, target.y, t.id);
  },
  release(state, ev, e, a) {
    const at = e.attack!;
    const tg = a.telegraph.kind === 'cone' ? a.telegraph : { range: a.range, arcDeg: 90 };
    const ch = Math.cos((tg.arcDeg / 2) * Math.PI / 180);
    for (const p of alive(state)) if (inCone(e.x, e.y, at.dx, at.dy, tg.range, ch, p.x, p.y, 0.3)) hitHero(state, ev, e, p, a);
    dropTelegraphs(state, e, a.id);
  },
};

/** Distance from the boss to a hero. */
export const distTo = (e: EnemyState, p: { x: number; y: number }): number => Math.sqrt(dist2(e.x, e.y, p.x, p.y));
