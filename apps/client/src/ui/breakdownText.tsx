import { LEGENDARIES, MECHANIC_BY_ID, NODE_BY_ID, SKILL_BY_ID, type DamageType } from '@cursebound/content';
import { MechIcon, NodeIcon } from './icons';
import { ItemIcon } from './itemIcons';

// Names, colours and icons for the post-run breakdown (simulation runStats.ts row ids): equipped skills, Fate boon
// procs (boon_<mechanic>), legendary perks (lg_<perk>), unclaimed damage over time (dot:<type>) and the folded
// "other" row (''). Unknown ids (new kits, enemies, attacks) fall back to a readable humanised name.

export const DTYPE_WORD: Record<DamageType, string> = { physical: 'physical', ember: 'ember', frost: 'frost', storm: 'storm', decay: 'decay', astral: 'astral' };
export const DTYPE_COLOR: Record<DamageType, string> = { physical: '#d8caad', ember: '#ffa53a', frost: '#9fd8ff', storm: '#f4e46a', decay: '#8fe07a', astral: '#c3a2ff' };
const DOT_NAME: Record<string, string> = { physical: 'Bleeding', ember: 'Burning', frost: 'Frostbite', storm: 'Static', decay: 'Rot', astral: 'Astral rot' };

export const humanize = (k: string) => k.replace(/^[a-z]{1,2}_/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function legendaryOf(id: string) {
  const perk = id.slice(3);
  return LEGENDARIES.find((d) => d.perk.id === perk) ?? LEGENDARIES.find((d) => perk.startsWith(d.perk.id) || d.perk.id.startsWith(perk));
}

/** Display name of a breakdown skill row. */
export function skillName(id: string): string {
  if (!id) return 'Other';
  if (id.startsWith('dot:')) return DOT_NAME[id.slice(4)] ?? 'Damage over time';
  if (id.startsWith('boon_')) return MECHANIC_BY_ID[id.slice(5)]?.name ?? humanize(id.slice(5));
  if (id.startsWith('lg_')) return legendaryOf(id)?.name ?? humanize(id.slice(3));
  return SKILL_BY_ID[id]?.name ?? NODE_BY_ID[id]?.name ?? humanize(id);
}

/** Pixel icon of a breakdown skill row. */
export function SkillRowIcon({ id, size = 24 }: { id: string; size?: number }) {
  if (id.startsWith('boon_')) return <MechIcon mechId={id.slice(5)} size={size} />;
  if (id.startsWith('lg_')) { const d = legendaryOf(id); if (d) return <ItemIcon itemId={d.id} size={size} />; }
  return <NodeIcon nodeId={id} size={size} />;
}

/** Attack names come straight from content; raw ids (a few affix projectiles) get humanised. */
export const attackName = (n: string) => (/^[a-z0-9_]+$/.test(n) ? humanize(n) : n);

/** "Slain by Gloom Shade's Void Bolt" (or the attack alone when it names itself, e.g. a Fate bane). */
export function blowText(src: string, atk: string): string {
  const a = attackName(atk);
  return !atk || atk === src ? src : `${src}’s ${a}`;
}

export const share = (part: number) => `${part >= 0.995 ? 100 : part < 0.01 && part > 0 ? '<1' : Math.round(part * 100)}%`;
