import { Big } from '@cursebound/numeric';
import { SKILL_BY_ID, DODGE, RULES } from '@cursebound/content';
import { bountyRules, dodgeMaxOf } from './bountyRules';
import { cohortHpFrac, cohortTotalHp } from './combat';
import { ccSnapFlags } from './cc';
import { afflictionSnapshot } from './afflictions';
import { moveSpeedOf } from './players';
import { gearSnapshot, lootSnapshot } from './gear';
import { doorSnapshot, type SnapDoor } from './doors';
import { playerEventSnap, roomEventSnapshot, type SnapRoomEvent } from './roomEvents';
import { playerDerived, toFloatClamped } from './stats';
import { guideSnapshot, type SnapGuide } from './tutorialRoom';
import type { SimState } from './types';

// Bounded, stable-schema snapshot for clients (REQ NET01, PRD §19.2). Presentation only: clients never
// receive authority over health, damage, cards or score. Floats are rounded for bandwidth.

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface SnapPlayer {
  s: number; n: string; c: string; x: number; y: number; vx: number; vy: number; ax: number; ay: number; f: number;
  life: 'alive' | 'downed' | 'dead'; anim: string; hp: number; hpT: string; mhpT: string; sh: number; shT: string;
  cd: [string, number, number, number][]; dodge: number; down: number; rev: number; self: number;
  con: boolean; guard: boolean; buffs: string[]; seq: number; downs: number; spd: number; dt: number; ddx: number; ddy: number; dcd: number;
  /** Optional kit counters for the HUD: every p.vars entry named ui_<key> appears as kv[<key>] (e.g. Duelist combo). */
  kv?: Record<string, number>;
  /** dodge charges available / max, post-dash surge seconds, recovery-rate multiplier (prediction) */
  dc: number; dcm: number; sg: number; rr: number;
  /** legendary gear (gear.ts): item ids in GEAR_SLOTS order ('' = empty) and 0..1 perk readiness; absent with no gear */
  gr?: string[]; gp?: number[];
  /** afflictions (afflictions.ts; status ids are in `buffs`): chain anchor + radius while 'chained' */
  teth?: [number, number, number];
  /** prediction: ticks of movement lock (frozen / rooted) and of the chain left; chill stacks toward a freeze */
  lk?: number; tk?: number; chs?: number;
  /** Fate's Blessings carried (blessing.ts); absent = none */
  bl?: number;
  /** room events (roomEvents.ts): cursed coins in the purse, seconds left on timed shrine blessings */
  co?: number; rb?: Record<string, number>;
}
export interface SnapEnemy {
  i: number; g: number; k: string; x: number; y: number; fx: number; fy: number; st: string; hp: number; cnt: string | null;
  boss: boolean; sh: boolean; burn: boolean; vuln: boolean; stag: boolean; ph: number; r: number; obj: boolean; flash: boolean;
  atk: string | null;
  /** front unit health / unit max health (compact Big text) for the hover plate */
  ht: string; mt: string;
  /** elite tier (1 champion, 2 rare) and affix ids; absent on ordinary foes */
  el?: number; af?: string[];
  /** crowd-control flags (cc.ts), present only while active: chilled, frozen, snared, marked by a Ranger */
  ch?: 1; fz?: 1; sn?: 1; mk?: 1;
  /** idle population pack member (director.ts), not yet aware of the heroes */
  dor?: 1;
  /** named mini-boss (minibosses.ts): its name, signature mechanic ids, and whether it is enraged */
  mb?: string; mm?: string[]; enr?: 1;
  dbg?: { action: string; utility: Record<string, number>; target: number | null; path: number[]; attack: string | null };
}
export interface SnapProjectile { i: number; k: string; x: number; y: number; vx: number; vy: number; o: 0 | 1; w: string | null; lt: [number, number, number] | null }
export interface SnapHazard { i: number; k: string; x: number; y: number; dx: number; dy: number; len: number; w: number; r: number; in: number; out: number; sp: number; b: number; u: number; o: 0 | 1 }
/** Ground pickup: k = kind ('potion' | 'orb' | module kinds), b/u = born/expiry tick, t = tier (0 normal, 1 champion, 2 rare). */
export interface SnapPickup { i: number; k: string; x: number; y: number; b: number; u: number; t: number }
export interface SnapTelegraph { i: number; o: number; shape: unknown; x: number; y: number; dx: number; dy: number; s: number; r: number; a: string }

export interface Snapshot {
  tick: number;
  phase: string;
  round: number;
  stateVersion: number;
  players: SnapPlayer[];
  enemies: SnapEnemy[];
  projectiles: SnapProjectile[];
  hazards: SnapHazard[];
  telegraphs: SnapTelegraph[];
  pickups: SnapPickup[];
  enc: null | {
    round: number; boss: boolean; bossId: string | null; total: number; done: number; wave: number; waves: number;
    logicalEnemies: string; bossHp: number; bossHpT: string; bossPhase: number; activeTicks: number; referenceTicks: number; budget: string;
    /** population (director.ts): packs this round, packs with foes left (alive or still to arrive), logical foes left (compact) */
    packs?: number; packsLeft?: number; foesLeft?: string;
  };
  scoreText: string;
  retire: number[];
  /** legendary items on the ground (gear.ts): id, item id, position. Empty outside combat. */
  lt: SnapLoot[];
  /** the door threshold (doors.ts), present during VOTING and FATE_COMMIT only */
  doors?: SnapDoor[];
  /** cinematic hold (boss grand entrance): the tick the frozen fight resumes; present only while held (cinematic.ts) */
  cu?: number;
  /** training grounds switches (training.ts); present only in training runs. ai: 1 = foes act, 0 = they stand still */
  tr?: { ai: 0 | 1 };
  /** room events (roomEvents.ts): shrines, altars, the merchant and living treasure imps; absent when none */
  rev?: SnapRoomEvent[];
  /** guided tutorial (tutorialRoom.ts); present only in tutorial runs: step, sub-goal bits (-1 = step done), walk mark */
  gd?: SnapGuide;
}

export interface SnapLoot { i: number; it: string; x: number; y: number }

/** HUD-facing kit counters: vars prefixed ui_ (absent when a kit exposes none). */
function kitVars(vars: Record<string, number> | undefined): { kv?: Record<string, number> } {
  let kv: Record<string, number> | undefined;
  if (vars) for (const k of Object.keys(vars)) if (k.startsWith('ui_')) (kv ??= {})[k.slice(3)] = r3(vars[k]);
  return kv ? { kv } : {};
}

export function buildSnapshot(state: SimState, debug = false): Snapshot {
  const enc = state.encounter;
  let logical = Big.ZERO;
  for (const e of state.enemies) if (e.state !== 'dying' && e.objective) logical = logical.add(e.cohort.count);
  const bossE = enc?.bossEntityId != null ? state.enemies.find((e) => e.id === enc.bossEntityId) : undefined;
  return {
    tick: state.tick, phase: state.phase, round: state.round, stateVersion: state.stateVersion,
    players: state.players.map((p) => {
      const pd = playerDerived(state, p);
      const anim = p.lifeState === 'dead' ? 'death' : p.lifeState === 'downed' ? 'downed' : p.dodgeTimer > 0 ? 'dodge' : p.castAnim > 0 ? 'cast' : p.attackAnim > 0 ? 'attack' : (Math.abs(p.vx) + Math.abs(p.vy) > 0.05 ? 'run' : 'idle');
      return {
        s: p.slot, n: p.name, c: p.classId, x: r3(p.x), y: r3(p.y), vx: r3(p.vx), vy: r3(p.vy), ax: r3(p.aimX), ay: r3(p.aimY), f: p.facing,
        life: p.lifeState, anim, hp: r3(p.maxHp.isZero() ? 0 : p.hp.ratio(p.maxHp)), hpT: p.hp.toCompact(), mhpT: p.maxHp.toCompact(),
        sh: r3(p.maxHp.isZero() ? 0 : Math.min(1, p.shield.ratio(p.maxHp))), shT: p.shield.toCompact(),
        cd: p.skills.map((s) => {
          if (!s.skillId) return ['', 0, 0, 0] as [string, number, number, number];
          const base = s.full ?? SKILL_BY_ID[s.skillId].cooldownSec;
          return [s.skillId, base > 0 && s.charges < s.maxCharges ? r3(Math.min(1, Math.max(0, s.cooldown) / base)) : 0, s.charges, s.maxCharges] as [string, number, number, number];
        }),
        dodge: r3(p.dodgeCooldown / DODGE.cooldownSec), down: r3(p.downTimer), rev: r3(p.reviveProgress / (RULES.reviveChannelSec * (bountyRules(state).reviveChannelFactor ?? 1))), self: r3(p.selfReviveChannel),
        con: p.connected, guard: p.guardTimer > 0, buffs: p.buffs.map((b) => b.id), seq: p.lastInputSeq, downs: p.downsThisRound,
        spd: moveSpeedOf(state, p), dt: r3(p.dodgeTimer), ddx: r3(p.dodgeDirX), ddy: r3(p.dodgeDirY), dcd: r3(p.dodgeCooldown),
        dc: p.dodgeCharges ?? DODGE.charges, dcm: dodgeMaxOf(p), sg: r3(p.surgeTimer ?? 0), rr: r3(toFloatClamped(pd.recovery, 1e12)),
        ...kitVars(p.vars),
        ...gearSnapshot(state, p),
        ...afflictionSnapshot(state, p),
        ...(p.bless ? { bl: p.bless } : {}),
        ...playerEventSnap(state, p),
      };
    }),
    enemies: state.enemies.map((e) => {
      const se: SnapEnemy = {
        i: e.id, g: e.gen, k: e.kind, x: r3(e.x), y: r3(e.y), fx: r3(e.fx), fy: r3(e.fy), st: e.state, hp: r3(cohortHpFrac(e.cohort)),
        cnt: e.cohort.count.gt(Big.ONE) ? e.cohort.count.toCompact() : null, boss: e.boss, sh: e.shieldUntil > state.tick && !e.shield.isZero(),
        burn: e.burning, vuln: e.vulnUntil > state.tick, stag: e.staggerUntil > state.tick, ph: e.phaseIndex, r: r3(e.radius), obj: e.objective,
        flash: e.hitFlash > 0, atk: e.attack ? e.attack.attackId : null,
        ht: e.cohort.count.isZero() ? '0' : e.cohort.unitHp.sub(e.cohort.spread).sub(e.cohort.front).toCompact(), mt: e.cohort.unitHp.toCompact(),
      };
      if (e.elite) { se.el = e.elite; se.af = e.affixes ?? []; }
      if (e.ccVars) Object.assign(se, ccSnapFlags(state, e));
      if (e.dormant) se.dor = 1;
      if (e.mini) { se.mb = e.mini.name; se.mm = e.mini.mechs; if (e.mini.v.enr) se.enr = 1; }   // named mini-boss (minibosses.ts)
      if (debug) se.dbg = { action: e.action, utility: Object.fromEntries(Object.entries(e.utility).map(([k, v]) => [k, r3(v)])), target: e.targetSlot, path: e.path.slice(0, 24), attack: e.attack ? `${e.attack.attackId}:${e.attack.stage}` : null };
      return se;
    }),
    projectiles: state.projectiles.map((p) => ({
      i: p.id, k: p.kind, x: r3(p.x), y: r3(p.y), vx: r3(p.vx), vy: r3(p.vy), o: p.owner === 'player' ? 0 : 1,
      w: p.weight.gt(Big.ONE) ? p.weight.toCompact() : null, lt: p.lobTarget ? [r3(p.lobTarget.x), r3(p.lobTarget.y), p.lobTarget.landTick] : null,
    })),
    hazards: state.hazards.map((h) => ({ i: h.id, k: h.kind, x: r3(h.x), y: r3(h.y), dx: r3(h.dx), dy: r3(h.dy), len: r3(h.length), w: r3(h.width), r: r3(h.radius), in: r3(h.inner), out: r3(h.outer), sp: r3(h.speed), b: h.bornTick, u: h.untilTick, o: h.owner === 'player' ? 0 : 1 })),
    telegraphs: state.telegraphs.map((t) => ({ i: t.id, o: t.ownerId, shape: t.shape, x: r3(t.x), y: r3(t.y), dx: r3(t.dx), dy: r3(t.dy), s: t.startTick, r: t.releaseTick, a: t.attack })),
    pickups: (state.pickups ?? []).map((k) => ({ i: k.id, k: k.kind, x: r3(k.x), y: r3(k.y), b: k.bornTick, u: k.untilTick, t: k.tier })),
    enc: enc ? {
      round: enc.round, boss: enc.isBoss, bossId: enc.bossId, total: enc.objectiveTotal, done: enc.completedWeight, wave: enc.wave, waves: enc.waveCount,
      logicalEnemies: logical.toCompact(), bossHp: bossE ? r3(cohortHpFrac(bossE.cohort)) : 0, bossHpT: bossE ? cohortTotalHp(bossE.cohort).toCompact() : '0',
      bossPhase: bossE ? bossE.phaseIndex : 0, activeTicks: enc.activeTicks, referenceTicks: enc.referenceTicks, budget: enc.budget,
      ...populationSnap(state),
    } : null,
    scoreText: state.scoreText,
    retire: state.retireVotes,
    lt: lootSnapshot(state),
    ...doorsField(state),
    ...(state.tick < (state.cinematicUntilTick ?? 0) ? { cu: state.cinematicUntilTick } : {}),
    ...(state.training ? { tr: { ai: state.training.ai ? 1 : 0 } as const } : {}),
    ...roomEventSnapshot(state),
    ...(state.guide ? { gd: guideSnapshot(state) } : {}),
  };
}

function doorsField(state: SimState): { doors?: SnapDoor[] } {
  const doors = doorSnapshot(state);
  return doors ? { doors } : {};
}

/** HUD population counters: packs this round, packs with foes left (alive or still to arrive), logical foes left. */
function populationSnap(state: SimState): { packs?: number; packsLeft?: number; foesLeft?: string } {
  const enc = state.encounter;
  if (!enc || !enc.packCount) return {};
  const left = new Set<number>();
  let foes = Big.ZERO;
  for (const g of enc.groups) {
    if (g.defeated || g.pack === undefined) continue;
    if (!g.spawned) { left.add(g.pack); foes = foes.add(Big.from(Math.max(1, Math.floor(Number(g.countText) || 1)))); }
  }
  for (const e of state.enemies) {
    if (e.state === 'dying' || !e.objective) continue;
    if (e.pack !== undefined) left.add(e.pack);
    foes = foes.add(e.cohort.count);
  }
  return { packs: enc.packCount, packsLeft: left.size, foesLeft: foes.toCompact() };
}
