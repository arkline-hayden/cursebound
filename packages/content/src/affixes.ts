// Monster affixes for champions (tier 1, blue) and rares (tier 2, gold). Data only: behaviours live in
// packages/simulation/src/elites.ts. Every dangerous affix is telegraphed (a marked circle or a visible cue)
// before it can hurt. All numbers are first tuning proposals.

export interface AffixDef {
  id: string;
  name: string;            // prefix shown on the hover plate ("Molten Ghoul Hound")
  description: string;
  /** affixes that cannot roll together with this one */
  excludes?: string[];
  /** accent colour for chips, particles and plates (#rrggbb) */
  color?: string;
}

export const AFFIXES: AffixDef[] = [
  { id: 'fast', name: 'Fast', description: 'Moves 40% faster and attacks 20% more often.' },
  { id: 'strong', name: 'Extra Strong', description: 'Deals 60% more damage.' },
  { id: 'molten', name: 'Molten', description: 'Leaves a burning trail. On death it swells and explodes after a short warning.' },
  { id: 'frozen', name: 'Frozen', description: 'Conjures frost orbs around its target that burst after a warning, chilling (slowing) anyone inside.' },
  { id: 'vampiric', name: 'Vampiric', description: 'Heals whenever its attacks land.' },
  { id: 'shielding', name: 'Shielding', description: 'Periodically shimmers, then becomes invulnerable inside a bubble for a few seconds.' },
  { id: 'thunder', name: 'Thunderous', description: 'Striking it calls lightning onto the attacker after a warning.' },
  { id: 'teleport', name: 'Teleporter', description: 'Marks a spot beside its target, then blinks there.' },
  { id: 'plagued', name: 'Plagued', description: 'Seeds decay pools that arm after a moment and linger.' },
  // Hero-impeding affixes (simulation/src/afflictions.ts statuses). Each is telegraphed and dodgeable.
  { id: 'jailer', name: 'Jailer', color: '#b8b0a0', description: 'Marks a lane, then hurls a chained hook along it. A hooked hero is chained to the ground for a moment. Dodge through the hook or dash to break the chain.' },
  { id: 'blinding', name: 'Blinding', color: '#6a4a9a', excludes: ['shielding'], description: 'Gathers shadow, then bursts: heroes inside are blinded for a moment. Bursts once more when it dies.' },
  { id: 'venomous', name: 'Venomous', color: '#7ad04a', excludes: ['molten'], description: 'Leaves a trail of venom. Standing in it poisons: damage over time and halved healing.' },
  { id: 'glacial', name: 'Glacial', color: '#a8e8ff', excludes: ['frozen'], description: 'A freezing aura: heroes who linger close gather frost and freeze solid.' },
];

export const AFFIX_BY_ID: Record<string, AffixDef> = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));

/** Display name of an elite: the first affix prefixes the base name ("Molten Ghoul Hound"). */
export function eliteName(baseName: string, affixes: readonly string[] | null | undefined): string {
  const first = affixes?.length ? AFFIX_BY_ID[affixes[0]] : undefined;
  return first ? `${first.name} ${baseName}` : baseName;
}

/** Display names of an elite's affixes, in roll order. */
export function affixNames(affixes: readonly string[] | null | undefined): string[] {
  return (affixes ?? []).map((id) => AFFIX_BY_ID[id]?.name ?? id);
}

/** Affix tuning (seconds, world units, damage coefficients on the elite's damage). */
export const AFFIX_RULES = {
  fastMove: 1.4,
  fastAttack: '1.2',
  strongDamage: '1.6',
  moltenTrailEvery: 0.3,      // seconds between trail patches while moving
  moltenTrailRadius: 0.6,
  moltenTrailSec: 3,
  moltenTrailCoef: '0.25',    // per pulse (every 0.5 s)
  moltenBlastRadius: 2.2,
  moltenBlastDelay: 1.1,
  moltenBlastCoef: '1.8',
  frozenEvery: 5.5,
  frozenFirst: 2.5,
  frozenOrbs: [2, 3],          // champion, rare
  frozenRadius: 1.25,
  frozenDelay: 1.35,
  frozenCoef: '0.9',
  chillSec: 2,
  chillSlow: 0.35,
  vampiricHealFrac: '0.07',   // of unit max health per landed attack
  shieldEvery: 7,
  shieldFirst: 3,
  shieldWarn: 0.6,
  shieldSec: 2.5,
  thunderCooldown: 1.4,
  thunderRadius: 1.1,
  thunderDelay: 0.75,
  thunderCoef: '1',
  teleportEvery: [4.5, 6.5],
  teleportMinDist: 3.5,
  teleportMark: 0.6,
  plagueEvery: 4.5,
  plagueFirst: 1.5,
  plagueRadius: 1.4,
  plagueArm: 0.8,
  plagueSec: 5,
  plagueCoef: '0.35',          // per pulse (every 0.5 s)
  // Jailer: telegraphed hook (a marked lane) that chains the hero it hits
  jailerEvery: 6.5,
  jailerFirst: 3,
  jailerRange: 8,
  jailerWarn: 0.8,
  jailerSpeed: 11,
  jailerCoef: '0.6',
  // Blinding: telegraphed shadow burst around the elite (and once on death)
  blindEvery: 8,
  blindFirst: 4,
  blindRadius: 2.2,
  blindWarn: 1.0,
  blindDeathWarn: 0.8,
  blindCoef: '0.5',
  // Venomous: poison trail (dps coefficient on the elite's damage)
  venomTrailEvery: 0.35,
  venomTrailRadius: 0.65,
  venomTrailSec: 3.5,
  venomDpsCoef: '0.25',
  // Glacial: freezing aura (a chill stack every few ticks to heroes inside)
  glacialRadius: 2.4,
  glacialEvery: 1.2,
  glacialSlow: 0.3,
};
