import type { Big } from '@cursebound/numeric';
import type { DamageType } from '@cursebound/content';
import type { EnemyState, Hazard, PlayerState, SimEvent, SimState } from './types';

// Extension points for class kits, Fate mechanics and monster affixes. The core loop calls these dispatchers at
// fixed points; modules register handlers once at import time (classes/index.ts, boons.ts, elites.ts are imported
// by sim.ts). Handlers must be deterministic: only state, the seeded rng streams and their arguments.

export interface EnemyHitInfo {
  dealt: Big;
  crit: boolean;
  kill: boolean;
  dtype: DamageType;
  skillId?: string;
  srcSlot: number;
  fromX: number; fromY: number;
  /** generation of the causing effect (0 = direct). Handlers that create follow-up damage must pass generation + 1 and ignore generation >= 1 to keep chains finite. */
  generation: number;
  /** logical units of the cohort slain by this hit (absent = unknown; treat as 1 when `kill`). */
  kills?: Big;
}

export interface PlayerDamagedInfo { dealt: Big; attack: string; source: string; fromX: number; fromY: number; dtype: DamageType; hazard: boolean; /** id of the enemy that caused the damage, when known */ srcId?: number }

/** Conditional per-target hit adjustments (modifyHit). Factors multiply; forceCrit makes every unit of an allowCrit hit critical. */
export interface HitMod { dmg: Big; critMul: Big; critDmg: Big; forceCrit: boolean }
export interface HitModInfo { skillId: string; dtype: DamageType; generation: number }

export interface SimHooks {
  /** Execute an active/signature skill. Return true if cast, false if it failed (no cost paid), undefined if not handled. */
  castSkill?(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined;
  /** Basic attack override. Return true if handled (the core basic attack is skipped). `k` = grouped attack count. */
  basicAttack?(state: SimState, ev: SimEvent[], p: PlayerState, k: Big): boolean | undefined;
  /** After any successful skill cast (cost already validated). */
  onCast?(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): void;
  /** After a player-sourced hit on an enemy resolved (before death handling). */
  onEnemyHit?(state: SimState, ev: SimEvent[], p: PlayerState | undefined, e: EnemyState, info: EnemyHitInfo): void;
  /** An enemy died. `p` is the killer when known. */
  onKill?(state: SimState, ev: SimEvent[], e: EnemyState, p: PlayerState | undefined): void;
  /** A player took damage (after mitigation and shields). */
  onPlayerDamaged?(state: SimState, ev: SimEvent[], p: PlayerState, info: PlayerDamagedInfo): void;
  /** A dodge started. */
  onDodge?(state: SimState, ev: SimEvent[], p: PlayerState): void;
  /** After a basic attack fired (core or kit override). `k` = grouped attack count this tick. */
  onBasicAttack?(state: SimState, ev: SimEvent[], p: PlayerState, k: Big): void;
  /** Once per tick for every living player, after movement/attacks/skills. */
  onPlayerTick?(state: SimState, ev: SimEvent[], p: PlayerState): void;
  /** Player-owned hazard tick. Return true if handled (the default damage pulse is skipped). */
  hazardTick?(state: SimState, ev: SimEvent[], h: Hazard): boolean | undefined;
  /** Extra max charges for a skill. */
  extraCharges?(p: PlayerState, skillId: string): number;
  /** Multiplier on a skill's resource cost (1 = unchanged). */
  costFactor?(state: SimState, p: PlayerState, skillId: string): number;
  /** Combat begins for a round (after the map and first wave are set up). */
  onRoundStart?(state: SimState, ev: SimEvent[]): void;
  /** Once per combat tick (global), after enemies and projectiles stepped. */
  onTick?(state: SimState, ev: SimEvent[]): void;
  /** An ordinary encounter wave group spawned (global). Called once per spawned group entity. */
  onEnemySpawn?(state: SimState, ev: SimEvent[], e: EnemyState): void;
  /** Before a player-sourced hit resolves: conditional damage / critical adjustments against this target (vs frozen, vs marked...). Mutate `mod`. */
  modifyHit?(state: SimState, p: PlayerState, e: EnemyState, info: HitModInfo, mod: HitMod): void;
}

const CLASS_HOOKS: Record<string, SimHooks> = {};
const GLOBAL_HOOKS: SimHooks[] = [];

export function registerClassHooks(classId: string, hooks: SimHooks) { CLASS_HOOKS[classId] = hooks; }
export function registerGlobalHooks(hooks: SimHooks) { if (!GLOBAL_HOOKS.includes(hooks)) GLOBAL_HOOKS.push(hooks); }

function each(p: PlayerState | undefined, fn: (h: SimHooks) => void) {
  const c = p ? CLASS_HOOKS[p.classId] : undefined;
  if (c) fn(c);
  for (const g of GLOBAL_HOOKS) fn(g);
}

export const hooks = {
  castSkill(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined {
    return CLASS_HOOKS[p.classId]?.castSkill?.(state, ev, p, skillId);
  },
  basicAttack(state: SimState, ev: SimEvent[], p: PlayerState, k: Big): boolean {
    return !!CLASS_HOOKS[p.classId]?.basicAttack?.(state, ev, p, k);
  },
  onCast(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string) { each(p, (h) => h.onCast?.(state, ev, p, skillId)); },
  onEnemyHit(state: SimState, ev: SimEvent[], p: PlayerState | undefined, e: EnemyState, info: EnemyHitInfo) { each(p, (h) => h.onEnemyHit?.(state, ev, p, e, info)); },
  onKill(state: SimState, ev: SimEvent[], e: EnemyState, p: PlayerState | undefined) { each(p, (h) => h.onKill?.(state, ev, e, p)); },
  onPlayerDamaged(state: SimState, ev: SimEvent[], p: PlayerState, info: PlayerDamagedInfo) { each(p, (h) => h.onPlayerDamaged?.(state, ev, p, info)); },
  onDodge(state: SimState, ev: SimEvent[], p: PlayerState) { each(p, (h) => h.onDodge?.(state, ev, p)); },
  onBasicAttack(state: SimState, ev: SimEvent[], p: PlayerState, k: Big) { each(p, (h) => h.onBasicAttack?.(state, ev, p, k)); },
  onPlayerTick(state: SimState, ev: SimEvent[], p: PlayerState) { each(p, (h) => h.onPlayerTick?.(state, ev, p)); },
  hazardTick(state: SimState, ev: SimEvent[], h: Hazard): boolean {
    const p = h.owner === 'player' ? state.players[h.ownerId] : undefined;
    let handled = false;
    each(p, (x) => { if (!handled && x.hazardTick?.(state, ev, h)) handled = true; });
    return handled;
  },
  extraCharges(p: PlayerState, skillId: string): number {
    let n = 0;
    each(p, (h) => { n += h.extraCharges?.(p, skillId) ?? 0; });
    return n;
  },
  costFactor(state: SimState, p: PlayerState, skillId: string): number {
    let f = 1;
    each(p, (h) => { f *= h.costFactor?.(state, p, skillId) ?? 1; });
    return f;
  },
  onRoundStart(state: SimState, ev: SimEvent[]) {
    for (const c of Object.values(CLASS_HOOKS)) c.onRoundStart?.(state, ev);
    for (const g of GLOBAL_HOOKS) g.onRoundStart?.(state, ev);
  },
  onTick(state: SimState, ev: SimEvent[]) {
    for (const g of GLOBAL_HOOKS) g.onTick?.(state, ev);
  },
  onEnemySpawn(state: SimState, ev: SimEvent[], e: EnemyState) {
    for (const g of GLOBAL_HOOKS) g.onEnemySpawn?.(state, ev, e);
  },
  /** Returns true when any handler adjusted (or may have adjusted) `mod`. */
  modifyHit(state: SimState, p: PlayerState, e: EnemyState, info: HitModInfo, mod: HitMod): boolean {
    let any = false;
    each(p, (h) => { if (h.modifyHit) { any = true; h.modifyHit(state, p, e, info, mod); } });
    return any;
  },
};
