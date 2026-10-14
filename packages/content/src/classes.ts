import type { ClassDef, NodeDef, SkillDef } from './types';
import * as vanguard from './classes/vanguard';
import * as arcanist from './classes/arcanist';
import * as duelist from './classes/duelist';
import * as artificer from './classes/artificer';
import * as hexbinder from './classes/hexbinder';
import * as cryomancer from './classes/cryomancer';
import * as ranger from './classes/ranger';
import * as templar from './classes/templar';
import * as berserker from './classes/berserker';
import * as warden from './classes/warden';

// Playable classes (PRD §7). Each class module owns its skills, skill-tree nodes and class definition;
// this file only aggregates them. Add a class by creating classes/<id>.ts and listing it in CLASS_MODULES.

export { BRANCH_TIER_POINTS, DODGE } from './classes/common';

const CLASS_MODULES: { SKILLS: SkillDef[]; NODES: NodeDef[]; CLASS: ClassDef }[] = [vanguard, arcanist, duelist, artificer, hexbinder, cryomancer, ranger, templar, berserker, warden];

export const SKILLS: SkillDef[] = CLASS_MODULES.flatMap((m) => m.SKILLS);
export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const NODES: NodeDef[] = CLASS_MODULES.flatMap((m) => m.NODES);
export const NODE_BY_ID: Record<string, NodeDef> = Object.fromEntries(NODES.map((x) => [x.id, x]));

export const CLASSES: ClassDef[] = CLASS_MODULES.map((m) => m.CLASS);
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((x) => [x.id, x]));

/** Eventual roster (PRD §7.1): classes not yet playable, shown as "coming later" in UI. */
export const FUTURE_CLASSES: { id: string; name: string; branches: string[] }[] = [];
