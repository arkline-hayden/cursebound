import type { BiomeDef, BossDef, EnemyAttackDef, EnemyDef } from './types';
import { CORE_ADDS, CORRUPT_CORE } from './bosses/corruptCore';
import { IRON_COLOSSUS } from './bosses/ironColossus';

// Ordinary archetypes + a summon (PRD §14.2) and two boss templates (§14.3). First tuning proposals.
// Individually weak, numerous foes (Diablo-style packs, director.ts); four archetypes impede heroes directly with
// afflictions (afflictions.ts): the Gaoler chains, the Rime Wraith freezes, the Gloom Shade blinds and the Web Weaver
// roots. The Bile Toad poisons and the Hex Cultist silences.

export const ENEMIES: EnemyDef[] = [
  {
    id: 'pursuer', name: 'Ghoul Hound', role: 'pursuer',
    description: 'A starved ghoul-beast that pressures close range. Bites after a short cone tell; pounces along a line.',
    baseHealth: 155, baseDamage: 25, armor: 10, cost: 2, radius: 0.4, moveSpeed: 3.3, tags: ['objective'],
    perception: { sight: 14, hearing: 9, reactionTicks: 12 }, preferredRange: [0, 1.0],
    utility: { pursue: 1.0, flank: 0.35, retreat: 0.05, cast: 0.9, reposition: 0.2 },
    attacks: [
      { id: 'bite', name: 'Bite', kind: 'melee', damageType: 'physical', damageCoef: '1', windupSec: 0.45, releaseSec: 0.1, recoverySec: 0.55, cooldownSec: 1.1, range: 1.15, telegraph: { kind: 'cone', range: 1.4, arcDeg: 75 } },
      { id: 'pounce', name: 'Pounce', kind: 'charge', damageType: 'physical', damageCoef: '1.3', windupSec: 0.65, releaseSec: 0.3, recoverySec: 0.8, cooldownSec: 5.5, range: 4.0, telegraph: { kind: 'line', length: 4.0, width: 0.8 } },
    ],
    weaknesses: { physical: '1.15' },
  },
  {
    id: 'skirmisher', name: 'Gloom Bat', role: 'skirmisher',
    description: 'Strafes at mid range, sidesteps your fire lanes and spits bone needles.',
    baseHealth: 115, baseDamage: 16, armor: 5, cost: 2, radius: 0.35, moveSpeed: 3.0, tags: ['objective', 'flying'],
    perception: { sight: 15, hearing: 10, reactionTicks: 10 }, preferredRange: [4, 6.5],
    utility: { pursue: 0.4, flank: 0.9, retreat: 0.6, cast: 1.0, reposition: 0.8 },
    attacks: [
      { id: 'shard', name: 'Bone Needle', kind: 'projectile', damageType: 'physical', damageCoef: '1', windupSec: 0.35, releaseSec: 0.05, recoverySec: 0.4, cooldownSec: 1.6, range: 7.5, projectileSpeed: 9, projectileCount: 1, telegraph: { kind: 'line', length: 7.5, width: 0.25 } },
      { id: 'fan', name: 'Needle Spray', kind: 'projectile', damageType: 'physical', damageCoef: '0.8', windupSec: 0.6, releaseSec: 0.05, recoverySec: 0.6, cooldownSec: 5.0, range: 7, projectileSpeed: 8, projectileCount: 3, telegraph: { kind: 'cone', range: 7, arcDeg: 40 } },
    ],
    weaknesses: { storm: '1.2' },
  },
  {
    id: 'artillery', name: 'Bile Toad', role: 'artillery',
    description: 'Lobs poisonous bile at where you are going, with a visible landing circle. The splash poisons (halved healing) and leaves a venom puddle.',
    baseHealth: 140, baseDamage: 34, armor: 8, cost: 3, radius: 0.45, moveSpeed: 1.6, tags: ['objective'],
    perception: { sight: 16, hearing: 10, reactionTicks: 14 }, preferredRange: [6, 9],
    utility: { pursue: 0.2, flank: 0.2, retreat: 0.8, cast: 1.0, reposition: 0.5 },
    attacks: [
      { id: 'lob', name: 'Bile Glob', kind: 'lob', damageType: 'decay', damageCoef: '1', inflict: { status: 'poisoned', sec: 3 }, windupSec: 0.8, releaseSec: 0.1, recoverySec: 1.0, cooldownSec: 3.2, range: 9.5, projectileSpeed: 7, projectileCount: 1, telegraph: { kind: 'circle', radius: 1.4 } },
    ],
    weaknesses: { physical: '1.2', astral: '1.1' },
  },
  {
    id: 'guardian', name: 'Bonewarden', role: 'guardian',
    description: 'An armoured skeleton that wards allies and blocks with a tower shield. Its flank and back are exposed.',
    baseHealth: 310, baseDamage: 23, armor: 40, cost: 4, radius: 0.55, moveSpeed: 1.8, tags: ['objective', 'regen'],
    perception: { sight: 12, hearing: 8, reactionTicks: 14 }, preferredRange: [1, 3],
    utility: { pursue: 0.5, flank: 0.1, retreat: 0.1, cast: 0.8, guard: 1.0, rescue: 0.9, reposition: 0.4 },
    attacks: [
      { id: 'bash', name: 'Shield Bash', kind: 'melee', damageType: 'physical', damageCoef: '1', windupSec: 0.55, releaseSec: 0.1, recoverySec: 0.7, cooldownSec: 1.8, range: 1.35, telegraph: { kind: 'cone', range: 1.6, arcDeg: 90 } },
      { id: 'ward', name: 'Ward Ally', kind: 'shield', damageType: 'physical', damageCoef: '0', windupSec: 0.6, releaseSec: 0.1, recoverySec: 0.5, cooldownSec: 6.5, range: 4.5, duration: 4, telegraph: { kind: 'circle', radius: 0.8 } },
    ],
    weaknesses: { storm: '1.25' },
  },
  {
    id: 'hexer', name: 'Hex Cultist', role: 'hexer',
    description: 'Places lingering hex pools away from other hazards and fires slow curse orbs that silence (no skills, basic attacks still work).',
    baseHealth: 130, baseDamage: 18, armor: 5, cost: 3, radius: 0.4, moveSpeed: 2.2, tags: ['objective', 'flying'],
    perception: { sight: 14, hearing: 10, reactionTicks: 12 }, preferredRange: [5, 8],
    utility: { pursue: 0.3, flank: 0.4, retreat: 0.7, cast: 1.0, reposition: 0.7 },
    attacks: [
      { id: 'pool', name: 'Hex Pool', kind: 'pool', damageType: 'decay', damageCoef: '0.6', windupSec: 0.7, releaseSec: 0.1, recoverySec: 0.6, cooldownSec: 4.5, range: 8, duration: 5, telegraph: { kind: 'circle', radius: 1.6 } },
      { id: 'orb', name: 'Curse Orb', kind: 'projectile', damageType: 'decay', damageCoef: '0.9', inflict: { status: 'silenced', sec: 2 }, windupSec: 0.45, releaseSec: 0.05, recoverySec: 0.5, cooldownSec: 2.6, range: 8, projectileSpeed: 5, projectileCount: 1, telegraph: { kind: 'line', length: 8, width: 0.35 } },
    ],
    weaknesses: { ember: '1.2' },
  },
  {
    id: 'broodcaller', name: 'Brood Sac', role: 'broodcaller',
    description: 'Spawns finite cohorts of carrion mites linked to it. Mites burst when it dies.',
    baseHealth: 210, baseDamage: 14, armor: 12, cost: 4, radius: 0.5, moveSpeed: 1.4, tags: ['objective', 'regen'],
    perception: { sight: 13, hearing: 9, reactionTicks: 16 }, preferredRange: [5, 8],
    utility: { pursue: 0.2, flank: 0.1, retreat: 0.9, cast: 1.0, reposition: 0.5 },
    attacks: [
      { id: 'summon', name: 'Brood Call', kind: 'summon', damageType: 'physical', damageCoef: '0', windupSec: 1.0, releaseSec: 0.1, recoverySec: 0.8, cooldownSec: 7, range: 10, summonCount: 3, telegraph: { kind: 'circle', radius: 1.0 } },
      { id: 'slap', name: 'Leg Lash', kind: 'melee', damageType: 'physical', damageCoef: '1', windupSec: 0.5, releaseSec: 0.1, recoverySec: 0.6, cooldownSec: 1.6, range: 1.2, telegraph: { kind: 'cone', range: 1.4, arcDeg: 80 } },
    ],
    weaknesses: { ember: '1.25' },
  },
  {
    id: 'mite', name: 'Carrion Mite', role: 'summon',
    description: 'Tiny linked summon. Not an objective; bursts when its Brood Sac dies.',
    baseHealth: 32, baseDamage: 7, armor: 0, cost: 0, radius: 0.25, moveSpeed: 3.7, tags: ['summon'],
    perception: { sight: 10, hearing: 8, reactionTicks: 8 }, preferredRange: [0, 0.6],
    utility: { pursue: 1.0, flank: 0.6, retreat: 0, cast: 1.0, reposition: 0.1 },
    attacks: [
      { id: 'nip', name: 'Nip', kind: 'melee', damageType: 'physical', damageCoef: '1', windupSec: 0.3, releaseSec: 0.08, recoverySec: 0.45, cooldownSec: 0.9, range: 0.75, telegraph: { kind: 'cone', range: 0.9, arcDeg: 70 } },
    ],
    weaknesses: {},
  },
  // ---- hero-impeding archetypes (afflictions.ts) ----
  {
    id: 'gaoler', name: 'Gaoler', role: 'jailer',
    description: 'A hulking iron-masked jailer. Marks a lane, then hurls a hook-and-chain: a hooked hero is chained to the ground (dodge through the hook, or dash to break the chain). Mauls up close.',
    baseHealth: 340, baseDamage: 25, armor: 25, cost: 4, radius: 0.55, moveSpeed: 2.1, tags: ['objective'],
    perception: { sight: 14, hearing: 9, reactionTicks: 14 }, preferredRange: [1, 4],
    utility: { pursue: 0.9, flank: 0.15, retreat: 0.05, cast: 1.0, reposition: 0.2 },
    attacks: [
      { id: 'hook', name: 'Gaol Hook', kind: 'projectile', damageType: 'physical', damageCoef: '0.7', windupSec: 0.8, releaseSec: 0.05, recoverySec: 0.6, cooldownSec: 6.5, range: 7.5, projectileSpeed: 11, projectileCount: 1, projectileKind: 'hook', inflict: { status: 'chained', sec: 2.5, value: 2.5 }, telegraph: { kind: 'line', length: 7.5, width: 0.45 } },
      { id: 'maul', name: 'Shackle Maul', kind: 'melee', damageType: 'physical', damageCoef: '1.2', windupSec: 0.6, releaseSec: 0.1, recoverySec: 0.7, cooldownSec: 1.9, range: 1.45, telegraph: { kind: 'cone', range: 1.7, arcDeg: 90 } },
    ],
    weaknesses: { storm: '1.2', ember: '1.1' },
  },
  {
    id: 'rimewraith', name: 'Rime Wraith', role: 'wraith',
    description: 'A floating ice ghost. Its frost bolts chill; three chills in quick succession freeze a hero solid for a moment.',
    baseHealth: 135, baseDamage: 16, armor: 4, cost: 3, radius: 0.42, moveSpeed: 2.7, tags: ['objective', 'flying'],
    perception: { sight: 15, hearing: 10, reactionTicks: 12 }, preferredRange: [4.5, 7],
    utility: { pursue: 0.35, flank: 0.6, retreat: 0.6, cast: 1.0, reposition: 0.7 },
    attacks: [
      { id: 'frostbolt', name: 'Frost Bolt', kind: 'projectile', damageType: 'frost', damageCoef: '1', windupSec: 0.45, releaseSec: 0.05, recoverySec: 0.45, cooldownSec: 1.7, range: 8, projectileSpeed: 8.5, projectileCount: 1, projectileKind: 'frostbolt', inflict: { status: 'chill', sec: 2.5, value: 0.3 }, telegraph: { kind: 'line', length: 8, width: 0.3 } },
    ],
    weaknesses: { ember: '1.35' },
  },
  {
    id: 'gloomshade', name: 'Gloom Shade', role: 'shade',
    description: 'An inky shadow wisp with one pale eye. Gathers darkness over a spot and bursts: heroes caught inside are blinded.',
    baseHealth: 115, baseDamage: 16, armor: 0, cost: 3, radius: 0.4, moveSpeed: 3.0, tags: ['objective', 'flying'],
    perception: { sight: 15, hearing: 11, reactionTicks: 10 }, preferredRange: [3.5, 6],
    utility: { pursue: 0.4, flank: 0.8, retreat: 0.5, cast: 1.0, reposition: 0.8 },
    attacks: [
      { id: 'shadowburst', name: 'Shadow Burst', kind: 'burst', damageType: 'astral', damageCoef: '0.8', windupSec: 0.95, releaseSec: 0.1, recoverySec: 0.7, cooldownSec: 7, range: 6.5, inflict: { status: 'blinded', sec: 2.5 }, telegraph: { kind: 'circle', radius: 1.7 } },
      { id: 'shadebolt', name: 'Shade Bolt', kind: 'projectile', damageType: 'astral', damageCoef: '0.8', windupSec: 0.4, releaseSec: 0.05, recoverySec: 0.45, cooldownSec: 2.2, range: 6.5, projectileSpeed: 8, projectileCount: 1, projectileKind: 'shadebolt', telegraph: { kind: 'line', length: 6.5, width: 0.3 } },
    ],
    weaknesses: { ember: '1.2', storm: '1.2' },
  },
  {
    id: 'webweaver', name: 'Web Weaver', role: 'weaver',
    description: 'A bloated cave spider. Spits web globs at a marked circle: heroes caught are rooted (they can still attack and cast) and the web lingers, slowing.',
    baseHealth: 180, baseDamage: 19, armor: 10, cost: 3, radius: 0.5, moveSpeed: 2.3, tags: ['objective'],
    perception: { sight: 14, hearing: 10, reactionTicks: 12 }, preferredRange: [4, 7],
    utility: { pursue: 0.3, flank: 0.3, retreat: 0.7, cast: 1.0, reposition: 0.5 },
    attacks: [
      { id: 'webglob', name: 'Web Glob', kind: 'lob', damageType: 'physical', damageCoef: '0.5', windupSec: 0.7, releaseSec: 0.1, recoverySec: 0.8, cooldownSec: 5.5, range: 8, projectileSpeed: 7, projectileCount: 1, projectileKind: 'web', inflict: { status: 'rooted', sec: 1.5 }, telegraph: { kind: 'circle', radius: 1.2 } },
      { id: 'fangs', name: 'Venom Fangs', kind: 'melee', damageType: 'physical', damageCoef: '1', windupSec: 0.45, releaseSec: 0.1, recoverySec: 0.55, cooldownSec: 1.5, range: 1.25, telegraph: { kind: 'cone', range: 1.5, arcDeg: 80 } },
    ],
    weaknesses: { ember: '1.3' },
  },
  ...CORE_ADDS,   // the Corrupted Core's drones and turrets (bosses/corruptCore.ts)
];

export const ENEMY_BY_ID: Record<string, EnemyDef> = Object.fromEntries(ENEMIES.map((x) => [x.id, x]));

export const BOSSES: BossDef[] = [
  {
    id: 'prismstag', name: 'The Hollow Stag', title: 'Crowned in Cold Ghost-fire',
    description: 'Charges down lanes, sweeps with burning bone antlers and scatters splitting ghost-fire pools whose bursts blind. Charging into a wall leaves it staggered.',
    // 1.2 retune (~20% easier): health 1500 -> 1350, damage 70 -> 60, slower wind-ups and cadence
    refUnitHealth: 1350, bossFactor: 8, baseDamage: 60, armor: 40, radius: 1.1, moveSpeed: 2.6, tags: ['boss'],
    vulnerableMultiplier: '1.5', staggerMeter: 600,
    phases: [
      { healthFrac: 1.0, weight: 1, patterns: [['charge', 'sweep'], ['lightpools', 'sweep']], cadence: '1.15' },
      { healthFrac: 2 / 3, weight: 1, patterns: [['charge', 'charge', 'sweep'], ['lightpools', 'charge']], cadence: '1.05' },
      { healthFrac: 1 / 3, weight: 1, patterns: [['lightpools', 'charge', 'sweep'], ['charge', 'lightpools', 'charge']], cadence: '0.9' },
    ],
    attacks: [
      { id: 'charge', name: 'Lane Charge', kind: 'charge', damageType: 'physical', damageCoef: '1.6', windupSec: 1.05, releaseSec: 0.75, recoverySec: 1.0, cooldownSec: 0, range: 12, telegraph: { kind: 'line', length: 12, width: 1.7 } },
      { id: 'sweep', name: 'Antler Sweep', kind: 'sweep', damageType: 'physical', damageCoef: '1.3', windupSec: 0.8, releaseSec: 0.15, recoverySec: 0.8, cooldownSec: 0, range: 3.3, telegraph: { kind: 'cone', range: 3.3, arcDeg: 160 } },
      { id: 'lightpools', name: 'Splitting Ghost-fire', kind: 'lightpool', damageType: 'astral', damageCoef: '0.95', inflict: { status: 'blinded', sec: 2 }, windupSec: 0.95, releaseSec: 0.1, recoverySec: 0.9, cooldownSec: 0, range: 10, projectileCount: 3, duration: 1.2, telegraph: { kind: 'circle', radius: 1.3 } },
    ],
  },
  {
    id: 'bellroot', name: 'The Bell Golem', title: 'Toller of the Drowned Dead',
    description: 'Toll pulses roll outward, chain lashes rake the arena and chain whoever they catch, and its slam cracks the bell open to expose a molten core.',
    // 1.2 retune (~20% easier): health 2000 -> 1700, damage 60 -> 48, slower wind-ups and cadence
    refUnitHealth: 1700, bossFactor: 8, baseDamage: 48, armor: 60, radius: 1.6, moveSpeed: 0.8, tags: ['boss', 'regen'],
    vulnerableMultiplier: '2', staggerMeter: 800,
    phases: [
      { healthFrac: 1.0, weight: 1, patterns: [['ring', 'rootwall'], ['slam']], cadence: '1.15' },
      { healthFrac: 2 / 3, weight: 1, patterns: [['ring', 'ring', 'rootwall'], ['rootwall', 'slam']], cadence: '1' },
      { healthFrac: 1 / 3, weight: 1, patterns: [['ring', 'rootwall', 'ring'], ['slam', 'ring']], cadence: '0.85' },
    ],
    attacks: [
      { id: 'ring', name: 'Toll Pulse', kind: 'ring', damageType: 'astral', damageCoef: '0.95', windupSec: 1.05, releaseSec: 2.2, recoverySec: 0.6, cooldownSec: 0, range: 12, projectileSpeed: 5, telegraph: { kind: 'ring', inner: 1.6, outer: 2.4 } },
      { id: 'rootwall', name: 'Chain Lash', kind: 'rootwall', damageType: 'physical', damageCoef: '1.0', inflict: { status: 'chained', sec: 2, value: 2.2 }, windupSec: 1.05, releaseSec: 0.1, recoverySec: 0.8, cooldownSec: 0, range: 10, projectileCount: 3, duration: 3, telegraph: { kind: 'line', length: 10, width: 0.9 } },
      { id: 'slam', name: 'Bell Slam', kind: 'slam', damageType: 'physical', damageCoef: '1.8', windupSec: 1.25, releaseSec: 0.15, recoverySec: 2.5, cooldownSec: 0, range: 3.6, telegraph: { kind: 'circle', radius: 3.6 } },
    ],
  },
  CORRUPT_CORE,    // server theme (bosses/corruptCore.ts)
  IRON_COLOSSUS,   // forge theme (bosses/ironColossus.ts)
];

export const BOSS_BY_ID: Record<string, BossDef> = Object.fromEntries(BOSSES.map((x) => [x.id, x]));

export const BIOMES: BiomeDef[] = [
  {
    id: 'catacombs', name: 'The Sunken Catacombs',
    description: 'Flooded crypts, guttering torches and the hungry dead beneath the city.',
    archetypes: ['pursuer', 'skirmisher', 'artillery', 'guardian', 'hexer', 'broodcaller', 'gaoler', 'rimewraith', 'gloomshade', 'webweaver'],
    bosses: ['prismstag', 'bellroot'],
    hazards: ['hex_pool', 'ghostfire_pool'],
  },
];

/** Later biomes (PRD §14.1) — not in MVP. */
export const FUTURE_BIOMES = ['Prismwood Canopy', 'Clockwork Reef', 'Candyglass Ruins', 'Astral Orchard'];

/** Per-round dungeon themes (rotated so consecutive rounds differ). Presentation identity only; no rule effects. */
export const DUNGEON_THEMES: { id: string; name: string; description: string }[] = [
  { id: 'catacombs', name: 'The Catacombs', description: 'Brick vaults, guttering torches and the restless dead.' },
  { id: 'flooded', name: 'The Flooded Crypt', description: 'Black water, rotted beams and the drip of the deep.' },
  { id: 'ossuary', name: 'The Bone Ossuary', description: 'Walls of stacked skulls and floors of yellowed bone.' },
  { id: 'sanctum', name: 'The Blood Sanctum', description: 'Red marble, ritual circles and a thousand dripping candles.' },
  { id: 'fungal', name: 'The Fungal Warren', description: 'Root-choked caves lit by glowing mushrooms and drifting spores.' },
  { id: 'forge', name: 'The Ember Forge', description: 'Basalt halls split by rivers of cooling lava.' },
  { id: 'frost', name: 'The Frozen Tomb', description: 'Rime-crusted stone, icicles and the dead locked in ice.' },
  { id: 'sky', name: 'The Shattered Skyreach', description: 'A torn-off shard of earth adrift in an endless sky: wind, roots and the long fall.' },
  { id: 'moon', name: 'The Dead Moon', description: 'Grey regolith, black craters and a ruined outpost under a cold blue Earth.' },
  { id: 'server', name: 'The Cursed Datavault', description: 'Humming racks, cable trays and neon glyphs: a machine tomb that dreams in static.' },
];

/** Procedural layout families (mapgen.ts, tier 1: the macro shape of a floor). 'arena' is the boss family. */
export const DUNGEON_LAYOUTS: { id: string; name: string }[] = [
  { id: 'halls', name: 'Chambers and corridors' },
  { id: 'caverns', name: 'Caverns' },
  { id: 'cross', name: 'Cruciform hall' },
  { id: 'colonnade', name: 'Pillared colonnade' },
  { id: 'ring', name: 'Ring chamber' },
  { id: 'gallery', name: 'Crypt gallery' },
  { id: 'ruins', name: 'Collapsed ruins' },
  { id: 'hub', name: 'Hub and spokes' },
  { id: 'warren', name: 'Cell warren' },
  { id: 'chasm', name: 'Chasm bridges' },
  { id: 'cloister', name: 'Cloister court' },
  { id: 'vaults', name: 'Cross vaults' },
  { id: 'arena', name: 'Boss arena' },
];

/** Room kinds (mapgen tier 2): what a carved room or hall is for. Presentation-led, but kinds that furnish blocking
 *  pieces (sarcophagi, shelves, pillars, rubble) carve them into the simulation grid. */
export const ROOM_KINDS: { id: string; name: string }[] = [
  { id: 'crypt', name: 'Crypt hall' },
  { id: 'library', name: 'Scriptorium' },
  { id: 'cistern', name: 'Flooded cistern' },
  { id: 'shrine', name: 'Shrine' },
  { id: 'ossuary', name: 'Ossuary' },
  { id: 'collapsed', name: 'Collapsed chamber' },
  { id: 'pillared', name: 'Pillared hall' },
  { id: 'torture', name: 'Torture chamber' },
  { id: 'treasury', name: 'Treasury vault' },
  { id: 'barracks', name: 'Barracks' },
  { id: 'grotto', name: 'Grotto' },
  { id: 'forge', name: 'Smithy' },
  { id: 'bridge', name: 'Chasm bridge' },
  { id: 'hall', name: 'Passage' },
  { id: 'approach', name: 'Processional' },
  { id: 'arena', name: 'Boss arena' },
];

/** How likely each assignable room kind is per dungeon theme (repeats on one floor are damped by mapgen). */
export const THEME_ROOM_WEIGHTS: Record<string, Record<string, number>> = {
  catacombs: { crypt: 3, library: 2, shrine: 2, ossuary: 1, collapsed: 2, pillared: 2, torture: 2, treasury: 1.2, barracks: 2, cistern: 1, grotto: 0.3, forge: 0.4 },
  flooded: { cistern: 4, crypt: 2, collapsed: 2, shrine: 1, pillared: 2, library: 0.6, torture: 1, treasury: 1, barracks: 1, grotto: 1.5, ossuary: 1 },
  ossuary: { ossuary: 4, crypt: 3, shrine: 2, torture: 1.5, collapsed: 1, pillared: 1, treasury: 1, library: 0.6, barracks: 0.6, cistern: 0.4 },
  sanctum: { shrine: 4, library: 2, torture: 2.5, treasury: 2, pillared: 2, crypt: 1, cistern: 1, ossuary: 1, barracks: 0.5 },
  fungal: { grotto: 4, collapsed: 2, cistern: 2, crypt: 1, ossuary: 1, shrine: 1, barracks: 0.6, library: 0.5, pillared: 0.6 },
  forge: { forge: 4, barracks: 2, treasury: 2, torture: 2, collapsed: 1.5, pillared: 1.5, shrine: 0.6, crypt: 0.5 },
  frost: { crypt: 3, collapsed: 2, shrine: 2, cistern: 2, pillared: 2, ossuary: 1.5, barracks: 1, treasury: 1, library: 1 },
  // sky: meadow groves, toppled ruins and wind shrines on the open rock; ponds stand in for cisterns
  sky: { grotto: 3, collapsed: 3, shrine: 2.5, cistern: 1.5, pillared: 1.5, barracks: 1, treasury: 0.8, crypt: 0.6, ossuary: 0.4, library: 0.4, forge: 0.3, torture: 0.3 },
  // moon: crater rubble, outpost quarters, supply depots, machine shops, data rooms and monolith shrines
  moon: { collapsed: 3, barracks: 2.5, treasury: 1.5, forge: 1.5, library: 1.5, shrine: 1.5, crypt: 1, pillared: 1, ossuary: 0.6, grotto: 0.5, torture: 0.4, cistern: 0.3 },
  // server: data archives (the scriptorium's shelves become rack rows), rack halls, power plants, vaults, core altars, labs
  server: { library: 4, pillared: 2.5, forge: 2, treasury: 2, shrine: 1.5, torture: 1.5, barracks: 1, collapsed: 1, crypt: 1, cistern: 1, ossuary: 0.3, grotto: 0.2 },
};

/** Boss arena designs (mapgen arenas, one hand-designed lair per boss; each is procedurally varied per run). */
export const ARENA_DESIGNS: { id: string; name: string }[] = [
  { id: 'nave', name: 'Drowned cathedral nave' },
  { id: 'ritual', name: 'Ghost-fire ritual circle' },
  { id: 'belltower', name: 'Bell tower over the void' },
  { id: 'colosseum', name: 'Sunken colosseum' },
  { id: 'datavault', name: 'Cursed data vault' },
  { id: 'foundry', name: 'Molten foundry' },
];

/** Which arena designs a boss may fight in (unknown bosses draw from every design). */
export const BOSS_ARENAS: Record<string, string[]> = {
  prismstag: ['nave', 'ritual'],
  bellroot: ['belltower', 'colosseum'],
  corruptcore: ['datavault'],
  ironcolossus: ['foundry'],
};

/** Themed lairs: the boss a boss floor of this dungeon theme spawns (themes not listed draw from BIOMES[0].bosses). */
export const THEME_BOSSES: Record<string, string[]> = {
  server: ['corruptcore'],
  forge: ['ironcolossus'],
};

/** The boss pool of a floor theme: its own lairs, else the biome's classic bosses. */
export function bossesForTheme(theme: string | null | undefined): string[] {
  const own = (theme && THEME_BOSSES[theme]?.filter((id) => BOSS_BY_ID[id])) || [];
  return own.length ? own : BIOMES[0].bosses;
}

// ---------------- Packs (director.ts population) ----------------

/** A pack: a lead archetype plus fodder drawn from `fodder`. Unlocks from `minRound`. */
export interface PackTemplate { id: string; lead: string; fodder: string[]; minRound: number }

export const PACK_TEMPLATES: PackTemplate[] = [
  { id: 'hounds', lead: 'pursuer', fodder: ['pursuer'], minRound: 1 },
  { id: 'bats', lead: 'skirmisher', fodder: ['skirmisher', 'pursuer'], minRound: 1 },
  { id: 'toads', lead: 'artillery', fodder: ['pursuer', 'pursuer', 'artillery'], minRound: 1 },
  { id: 'cult', lead: 'hexer', fodder: ['pursuer', 'hexer'], minRound: 1 },
  { id: 'webs', lead: 'webweaver', fodder: ['pursuer', 'pursuer', 'skirmisher'], minRound: 1 },
  { id: 'bonewall', lead: 'guardian', fodder: ['pursuer', 'skirmisher', 'hexer'], minRound: 2 },
  { id: 'gaol', lead: 'gaoler', fodder: ['pursuer', 'pursuer', 'skirmisher'], minRound: 2 },
  { id: 'rime', lead: 'rimewraith', fodder: ['skirmisher', 'rimewraith', 'pursuer'], minRound: 2 },
  { id: 'gloom', lead: 'gloomshade', fodder: ['pursuer', 'hexer', 'gloomshade'], minRound: 3 },
  { id: 'brood', lead: 'broodcaller', fodder: ['pursuer'], minRound: 3 },
];

export const PACK_BY_ID: Record<string, PackTemplate> = Object.fromEntries(PACK_TEMPLATES.map((x) => [x.id, x]));

/** Pack weights per dungeon theme (composition varies with the floor's identity). */
export const THEME_PACKS: Record<string, Record<string, number>> = {
  catacombs: { hounds: 3, bonewall: 2, cult: 2, gaol: 2, brood: 1, gloom: 1, bats: 1 },
  flooded: { toads: 3, bats: 2, gloom: 2, hounds: 2, webs: 1, rime: 1 },
  ossuary: { bonewall: 3, hounds: 3, gaol: 2, bats: 1, cult: 1 },
  sanctum: { cult: 3, gaol: 2, gloom: 2, hounds: 2, bonewall: 1 },
  fungal: { webs: 3, toads: 3, brood: 2, hounds: 1, bats: 1 },
  forge: { gaol: 3, bonewall: 2, hounds: 2, toads: 1, cult: 1 },
  frost: { rime: 3, bats: 2, hounds: 2, gloom: 1, bonewall: 1 },
  sky: { bats: 3, hounds: 2, gloom: 2, webs: 1, rime: 1, cult: 1 },
  moon: { gloom: 3, rime: 2, bonewall: 2, hounds: 2, gaol: 1 },
  server: { cult: 3, gaol: 2, gloom: 2, bonewall: 2, brood: 1, webs: 1 },
};

/** Affliction an attack inflicts, by attack id (enemy, boss and affix attacks; projectiles outlive their owner). */
export const ATTACK_INFLICT: Record<string, NonNullable<EnemyAttackDef['inflict']>> = Object.fromEntries(
  [...ENEMIES, ...BOSSES].flatMap((d) => d.attacks.filter((a) => a.inflict).map((a) => [a.id, a.inflict!] as const)),
);
