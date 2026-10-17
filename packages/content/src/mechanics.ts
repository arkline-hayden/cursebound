import type { MechanicDef } from './types';

// Fate mechanics (boons and banes). Data only: the simulation implements each id in simulation/src/boons.ts and
// reads `params` from here so the copy and the rules can never drift apart. Magnitudes come from the cards
// (cards.ts) and combine per copy as declared by `stacking` (see MechanicStacking): always a product, never a sum.
// Copy placeholders: {v} = effective magnitude ('25%' or '×3'), {name} = params[name], {name%} = params[name] as %.

const m = (def: Omit<MechanicDef, 'icon'>): MechanicDef => ({ ...def, icon: `mech:${def.id}` });

export const MECHANICS: MechanicDef[] = [
  // ---------------- Boons ----------------
  m({
    id: 'chain_reaction', name: 'Chain Reaction', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Slain foes explode for {v} of their max HP',
    description: 'Whenever foes die they explode a heartbeat later, dealing {v} of their maximum health to every foe within {radius} units (a cohort blast scales with the units slain). Explosion kills set off one more wave of blasts, then the chain stops.',
    applicability: 'Every enemy death, grouped cohorts included', requires: 'any', color: '#ff7a2a',
    params: { radius: 2.5, delaySec: 0.1, maxGeneration: 2 },
  }),
  m({
    id: 'vampiric_rite', name: 'Vampiric Rite', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Hits heal {v} of damage dealt',
    description: 'Your hits heal you for {v} of the damage they deal, up to {capPerSec%} of your maximum health per second. Healing bonuses apply.',
    applicability: 'All damage you deal', requires: 'any', color: '#e0315a',
    params: { capPerSec: 0.12 },
  }),
  m({
    id: 'thunderous_blows', name: 'Thunderous Blows', kind: 'boon', stacking: 'factor', unit: 'multiplier',
    short: 'Every {everyHits}th hit calls lightning: {v} dmg',
    description: 'Every {everyHits}th hit you land calls lightning onto the target, dealing {v} your damage as storm damage to every foe within {radius} units. The bolt can critically strike.',
    applicability: 'Hits you land (bolts never trigger more bolts)', requires: 'any', color: '#8fd8ff',
    params: { everyHits: 5, radius: 1.5 },
  }),
  m({
    id: 'splitting_shots', name: 'Splitting Shots', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Projectile hits fork {shards} shards at {v} dmg',
    description: 'When one of your projectiles hits, it forks {shards} shards into the nearest other foes within {range} units, each dealing {v} of the projectile\'s damage. Shards never fork again.',
    applicability: 'Projectile skills only', requires: 'projectile', color: '#f2a6ff',
    params: { shards: 2, range: 5 },
  }),
  m({
    id: 'bloodrush', name: 'Bloodrush', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Kills: +{v} attack & move speed',
    description: 'Every kill sends you into a Bloodrush for {durationSec} seconds: +{v} attack speed and movement speed. Further kills refresh it.',
    applicability: 'Your kills', requires: 'any', color: '#ff5a4a',
    params: { durationSec: 3 },
  }),
  m({
    id: 'soul_harvest', name: 'Soul Harvest', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Kills cut cooldowns by {v}',
    description: 'Each kill cuts {v} of a full cooldown from every skill still recharging (a blow that fells a whole cohort counts up to {maxKills} kills).',
    applicability: 'Your kills', requires: 'skills', color: '#7ef0d0',
    params: { maxKills: 5 },
  }),
  m({
    id: 'echo', name: 'Echo', kind: 'boon', stacking: 'chance', unit: 'percent',
    short: '{v} chance a skill refunds its charge',
    description: 'Whenever you cast an active or signature skill there is a {v} chance it refunds its charge at once.',
    applicability: 'Active and signature skills', requires: 'skills', color: '#6aa8ff',
    params: {},
  }),
  m({
    id: 'executioner', name: 'Executioner', kind: 'boon', stacking: 'chance', unit: 'percent',
    short: 'Non-boss foes below {v} health die',
    description: 'Any non-boss foe you wound below {v} of its health is executed instantly. In a cohort the wounded front unit falls; if area damage leaves the whole cohort below the line, the whole cohort falls.',
    applicability: 'All non-boss enemies (elites included)', requires: 'any', color: '#d8cdb4',
    params: {},
  }),
  m({
    id: 'phoenix', name: 'Phoenix', kind: 'boon', stacking: 'chance', unit: 'percent',
    short: 'Once a round, cheat death at {v} health',
    description: 'Once per round, a blow that would down you instead leaves you at {v} of your maximum health with {invulnSec} seconds of invulnerability.',
    applicability: 'Each hero, once per round', requires: 'any', color: '#ffa53a',
    params: { invulnSec: 2 },
  }),
  m({
    id: 'static_trail', name: 'Static Trail', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Dodges leave static: {v} dmg per {pulseSec}s',
    description: 'Dodging leaves a crackling trail for {durationSec} seconds that deals {v} of your damage as storm damage every {pulseSec} s to foes inside it.',
    applicability: 'Your dodges', requires: 'any', color: '#3fe0c5',
    params: { radius: 0.9, durationSec: 2, pulseSec: 0.25 },
  }),
  m({
    id: 'retribution', name: 'Retribution', kind: 'boon', stacking: 'factor', unit: 'multiplier',
    short: 'When hit, blast foes for {v} the damage',
    description: 'Whenever you take damage, a shockwave deals {v} the damage taken to every foe within {radius} units.',
    applicability: 'Damage you take', requires: 'any', color: '#c9a36b',
    params: { radius: 2.5 },
  }),
  m({
    id: 'warding_rune', name: 'Warding Rune', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Every {everySec}s: a {v} max HP shield',
    description: 'Every {everySec} seconds of combat you gain a shield worth {v} of your maximum health (scaled by shield capacity, up to your shield cap).',
    applicability: 'Each hero', requires: 'any', color: '#7fe8ff',
    params: { everySec: 6 },
  }),
  // rule-changers (the second wave): companions, thresholds, movement and chaos
  m({
    id: 'shadow_twin', name: 'Shadow Twin', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'A shadow repeats your hits for {v} damage',
    description: 'A shadow of you walks at your back. Every {strikeSec} s it strikes the foe you last hit for {v} of the direct damage you dealt since its last strike.',
    applicability: 'Your direct hits', requires: 'any', color: '#a59bd6',
    params: { strikeSec: 0.4, range: 6 },
  }),
  m({
    id: 'grave_thralls', name: 'Grave Thralls', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Every {everyKills}th kill raises a thrall: {v} dmg',
    description: 'Every {everyKills}th kill (and every elite kill) raises a spectral thrall for {lifeSec} s that hunts the nearest foe, striking for {v} of your damage every {strikeSec} s. At most {max} per hero.',
    applicability: 'Your kills', requires: 'any', color: '#9fe0a8',
    params: { everyKills: 6, lifeSec: 6, strikeSec: 0.6, speed: 2.8, reach: 0.9, max: 3, riseSec: 0.5 },
  }),
  m({
    id: 'last_stand', name: 'Last Stand', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Below {threshold%} HP: +{v} dmg, half damage taken',
    description: 'While below {threshold%} of your maximum health you deal {v} more damage and take {reduce%} less.',
    applicability: 'Each hero, while wounded', requires: 'any', color: '#ff4a3a',
    params: { threshold: 0.35, reduce: 0.5 },
  }),
  m({
    id: 'gravity_well', name: 'Gravity Well', kind: 'boon', stacking: 'factor', unit: 'multiplier',
    short: 'Crits implode: foes pulled in, {v} dmg',
    description: 'A critical hit tears open a gravity well (once per {cooldownSec} s): foes within {radius} units are dragged toward it and take {v} your damage as astral damage. Bosses hold their ground.',
    applicability: 'Your critical hits', requires: 'any', color: '#7a6bff',
    params: { radius: 3, pull: 1.6, cooldownSec: 1.5 },
  }),
  m({
    id: 'momentum', name: 'Momentum', kind: 'boon', stacking: 'compound', unit: 'percent',
    short: 'Run {chargeDist} units: your next hit deals +{v}',
    description: 'Moving (dodges included) builds charge. After {chargeDist} units your next hit, and every hit landing that same moment, deals {v} more damage; then the charge resets.',
    applicability: 'Your movement and hits', requires: 'any', color: '#3fe0a0',
    params: { chargeDist: 6, stepCap: 0.6 },
  }),
  m({
    id: 'mirror_ward', name: 'Mirror Ward', kind: 'boon', stacking: 'factor', unit: 'multiplier',
    short: 'Dodges reflect shots back at {v} your dmg',
    description: 'For {windowSec} s after you dodge, enemy projectiles within {radius} units turn back on their sender, dealing {v} your damage to the first foe they hit.',
    applicability: 'Enemy projectiles near your dodges', requires: 'any', color: '#e8d4ff',
    params: { radius: 1.6, windowSec: 0.45, range: 9 },
  }),
  m({
    id: 'pandora', name: "Pandora's Gift", kind: 'boon', stacking: 'factor', unit: 'multiplier',
    short: 'Each round: a random boon at {v} strength',
    description: 'At the start of every round a random boon from the Fate deck binds for that round only, at {v} the strength of its weakest card.',
    applicability: 'Every combat round', requires: 'any', color: '#ff5ce1',
    params: { chanceCap: 0.9 },
  }),

  // ---------------- Banes ----------------
  m({
    id: 'volatile_dead', name: 'Volatile Dead', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'Slain foes leave fire: {v} max HP/{pulseSec}s',
    description: 'Every kill leaves a burning pool, telegraphed for {armSec} s, that burns for {burnSec} s and deals {v} of a hero\'s maximum health every {pulseSec} s (ignores armor; shields absorb). Bigger cohorts leave bigger pools.',
    applicability: 'Every enemy death', requires: 'any', color: '#ff6a2a',
    params: { armSec: 0.8, burnSec: 2, pulseSec: 0.5, maxPools: 20 },
  }),
  m({
    id: 'hexed_ground', name: 'Hexed Ground', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'Curse circles erupt for {v} max HP',
    description: 'Every {everySec} seconds a curse circle is telegraphed beneath each hero and erupts {armSec} s later, dealing {v} of maximum health to heroes inside (ignores armor; a dodge through it avoids the blast).',
    applicability: 'Every hero in combat', requires: 'any', color: '#9b5cff',
    params: { everySec: 6, armSec: 1.2, radius: 1.4 },
  }),
  m({
    id: 'relentless', name: 'Relentless', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'Foes below {threshold%} HP enrage: +{v} speed',
    description: 'Foes that fall below {threshold%} health enrage for the rest of their life: +{v} attack speed and movement speed. Cohorts enrage when area damage wears all their units down.',
    applicability: 'All enemies and bosses', requires: 'any', color: '#ff3d3d',
    params: { threshold: 0.3 },
  }),
  m({
    id: 'the_hunt', name: 'The Hunt', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'A deathless Reaper stalks you: {v} max HP',
    description: 'Each round, {delaySec} s into combat, an unkillable Reaper rises and drifts through walls toward the nearest hero at {speed} units per second. Its touch deals {v} of maximum health (ignores armor), at most once per {strikeSec} s per hero.',
    applicability: 'Every combat round', requires: 'any', color: '#b8b0c8',
    params: { delaySec: 6, speed: 1.44, radius: 0.9, strikeSec: 1 },   // speed 1.8 -> 1.44 (rules 1.4: all movement x0.8)
  }),
  m({
    id: 'blood_moon', name: 'Blood Moon', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'Every {everySec}s foes deal +{v} damage',
    description: 'Every {everySec} seconds of combat all foes deal {v} more damage, compounding until the round ends. Clear fast.',
    applicability: 'All enemy damage, each round from zero', requires: 'any', color: '#ff2a55',
    params: { everySec: 10 },
  }),
  m({
    id: 'brittle', name: 'Brittle', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'First hit after a dodge: +{v} damage',
    description: 'For {windowSec} s after you dodge, the next hit you take deals {v} extra damage, bypassing shields.',
    applicability: 'Each hero\'s dodges', requires: 'any', color: '#c6e6ff',
    params: { windowSec: 3 },
  }),
  m({
    id: 'blood_price', name: 'Blood Price', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'Skills cost {v} of max HP (never lethal)',
    description: 'Every active or signature skill you cast costs {v} of your maximum health. It never takes you below {floor%} health.',
    applicability: 'Each hero\'s skill casts', requires: 'any', color: '#c8102e',
    params: { floor: 0.01 },
  }),
  m({
    id: 'restless_dead', name: 'Restless Dead', kind: 'bane', stacking: 'chance', unit: 'percent',
    short: '{v} of the slain rise as hunting wisps',
    description: 'Each death has a {v} chance to raise a wisp that hunts the nearest hero for {lifeSec} s and bursts on contact for {damage%} of maximum health (ignores armor; a dodge slips through).',
    applicability: 'Every enemy death', requires: 'any', color: '#8ff0e0',
    params: { damage: 0.08, riseSec: 0.6, lifeSec: 4.5, speed: 2.4, radius: 0.45, max: 10 },
  }),
  m({
    id: 'grave_hands', name: 'Grave Hands', kind: 'bane', stacking: 'compound', unit: 'percent',
    short: 'Stand still {graceSec}s: hands claw {v} max HP',
    description: 'Stay within {leash} units of one spot for {graceSec} s and grave hands rise, clawing {v} of your maximum health every {clawSec} s (ignores armor) until you move.',
    applicability: 'Each hero in combat', requires: 'any', color: '#7d9a5a',
    params: { graceSec: 1.5, clawSec: 0.5, leash: 0.6 },
  }),
  m({
    id: 'shadow_pact', name: 'Shadow Pact', kind: 'bane', stacking: 'chance', unit: 'percent',
    short: '{v} of elites bring a shadow twin',
    description: 'Each champion or rare has a {v} chance to arrive with a shadow twin: {health%} of its health, {damage%} of its damage. The twin fades when its elite dies.',
    applicability: 'Champions and rares', requires: 'any', color: '#6c5a9c',
    params: { health: 0.6, damage: 0.8 },
  }),
  m({
    id: 'pandora_curse', name: "Pandora's Curse", kind: 'bane', stacking: 'factor', unit: 'multiplier',
    short: 'Each round: a random bane at {v} strength',
    description: 'At the start of every round a random bane from the Fate deck binds for that round only, at {v} the strength of its weakest card.',
    applicability: 'Every combat round', requires: 'any', color: '#b03aff',
    params: { chanceCap: 0.9 },
  }),
];

export const MECHANIC_BY_ID: Record<string, MechanicDef> = Object.fromEntries(MECHANICS.map((x) => [x.id, x]));

/** Fill a mechanic copy template: {v} → `value`, {p} → params.p, {p%} → params.p as a percentage. */
export function mechanicText(def: MechanicDef, template: string, value: string): string {
  return template.replace(/\{([a-zA-Z]+)(%?)\}/g, (all, key: string, pctSign: string) => {
    if (key === 'v') return value;
    const p = def.params[key];
    if (p === undefined) return all;
    return pctSign ? `${+(p * 100).toFixed(2)}%` : String(p);
  });
}
