import { RULES } from '../rules';
import type { NodeDef } from '../types';

// Shared authoring helpers for class content. Each class lives in its own module (skills, nodes, class def);
// classes.ts aggregates them. All numbers are tuning proposals.

/**
 * Shared melee passives (RULES.meleeDamageTakenMult / meleeLungeDist; simulation stats.ts and players.ts), appended
 * to every melee class's basic attack description so the copy always states the live numbers.
 */
export const MELEE_PASSIVES = `Melee: Close Quarters, you take ${Math.round((1 - Number(RULES.meleeDamageTakenMult)) * 100)}% less damage; a swing with no foe in reach lunges up to ${RULES.meleeLungeDist} units onto the nearest foe in its arc.`;

/**
 * Points that must already be spent in a branch to unlock each tier (tier 0..4). Every branch's base active skill is a
 * free starting grant (tier 0, `starting`), so tier 1 is open from the start and the later gates keep the old pacing
 * (they were 1/3/5/8 when the base skill cost the first point).
 */
export const BRANCH_TIER_POINTS = [0, 0, 2, 4, 7] as const;

export const DODGE = {
  travel: 2.6,          // world units per dash
  durationSec: 0.18,
  cooldownSec: 1.1,     // recharge time per charge (scaled by recovery rate)
  iframeSec: 0.2,
  charges: 2,           // dashes can chain (a fresh press mid-dash starts the next one)
  easeStart: 1.45,      // speed profile: burst at the start of the dash ...
  easeEnd: 0.55,        // ... easing out at the end (mean 1, so travel stays as authored)
  surgeSec: 0.4,        // post-dash speed surge, decaying linearly
  surgeMult: 1.3,
};

export type NodeOpts = Partial<Pick<NodeDef, 'prereqs' | 'modifiers' | 'grantsSkill' | 'upgrades' | 'starting' | 'mechanics' | 'excludes'>> & { description: string };

/**
 * Node authoring helper. `excludes` makes a choice node: owning it locks the listed nodes (and vice versa).
 * `upgrades` tags a node that modifies one skill (display only): its copy reads "Upgrades <Skill>: <what changes>".
 */
export const node = (
  id: string, classId: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: NodeOpts,
): NodeDef => ({
  id, classId, branch, name, rankLimit, costPerRank: opts.starting ? 0 : 1, tier,
  prereqs: opts.prereqs ?? [], modifiers: opts.modifiers ?? [], grantsSkill: opts.grantsSkill, starting: opts.starting,
  mechanics: opts.mechanics ?? [], description: opts.description, icon: `node:${id}`,
  ...(opts.excludes?.length ? { excludes: opts.excludes } : {}),
  ...(opts.upgrades ? { upgrades: opts.upgrades } : {}),
});
