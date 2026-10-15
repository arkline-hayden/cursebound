import { CLASS_BY_ID, SKILL_BY_ID } from './classes';
import { isKnownStat } from './stats';
import type { NodeModifier } from './types';

// Legendary gear (data only). Rare drops from enemies: a ground item with a light beam that a hero equips by
// walking over it (empty slot) or by pressing Interact (swap; the old item drops at their feet). Each item carries
// ×factor stat modifiers (same shape as skill-tree modifiers, applied once) and one unique perk implemented in
// packages/simulation/src/gear.ts. Perk numbers live here (magnitude + params) so balance stays in content.
// Slot sigils reference hotbar slots (branch 1..3 actives, the signature) rather than skill ids, so they work for
// every class even while class kits change.

export type GearSlot = 'weapon' | 'helm' | 'chest' | 'gloves' | 'boots' | 'amulet' | 'ring';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'helm', 'chest', 'gloves', 'boots', 'amulet', 'ring'];
export const GEAR_SLOT_NAMES: Record<GearSlot, string> = {
  weapon: 'Weapon', helm: 'Helm', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', amulet: 'Amulet', ring: 'Ring',
};

export interface LegendaryPerk {
  /** Simulation behaviour id (gear.ts). Several items may share a behaviour with different numbers. */
  id: string;
  /** Primary perk number (decimal string): a factor, fraction or multiplier as the description states. */
  magnitude: string;
  description: string;
  /** Secondary tuning numbers (seconds, world units, counts, hotbar slot index). */
  params?: Record<string, number>;
}

export interface LegendaryDef {
  id: string;
  name: string;
  slot: GearSlot;
  /** Class-only item (drops only when that class is in the party; only that class can equip it). */
  classId?: string;
  modifiers: NodeModifier[];
  perk: LegendaryPerk;
  flavor: string;
  icon: string;
  /** Accent colour for the procedural icon (#rrggbb). */
  accent: string;
}

/** Every perk behaviour the simulation implements (validated: each item's perk id must be listed here). */
export const LEGENDARY_PERK_IDS = [
  'fifth_shockwave', 'crit_lightning', 'dodge_shade', 'cheat_death', 'free_charge', 'kill_heal', 'empowered_skill',
  'kill_streak_speed', 'bell_toll', 'pyre_explosion', 'hits_chill', 'elite_slayer', 'healing_aura', 'mirror_projectiles',
  'thorns_nova', 'potion_plus', 'execute', 'life_leech', 'orbiting_blades', 'last_stand', 'plague_spread', 'dodge_ward',
  'gravity_well', 'path_sigil', 'signature_mastery', 'signature_meteor', 'signature_refresh',
  'aegis_release', 'phantom_sweep', 'last_stand_banner', 'fireline_extend', 'arc_thunderclap', 'phase_burst',
] as const;
export type LegendaryPerkId = typeof LEGENDARY_PERK_IDS[number];

/** Drop tuning. Chances are per enemy death event (a whole cohort dying is one event). */
export const LOOT_RULES = {
  /** ordinary objective death: base chance, ×(1 + perRound × (round − 1)), capped */
  baseChance: 0.005,
  perRound: 0.03,
  maxChance: 0.012,
  /** non-objective deaths (summons, linked adds) roll at this fraction of the ordinary chance */
  summonFactor: 0.25,
  /** champion (elite tier 1) and rare (elite tier 2) deaths */
  championChance: 0.06,
  rareChance: 0.12,
  /** boss kills always drop this many (in addition to the per-round cap) */
  bossDrops: 1,
  /** random (non-boss) drops allowed per round */
  maxDropsPerRound: 2,
  /** pickup radius (world units) and the short "pop" before a fresh drop can be taken */
  pickupRange: 0.9,
  pickupDelaySec: 0.5,
  /** at most this many items on the ground (oldest vanish first) */
  maxGround: 8,
};

const L = (
  id: string, name: string, slot: GearSlot, accent: string, modifiers: [string, string][], perk: LegendaryPerk, flavor: string, classId?: string,
): LegendaryDef => ({
  id, name, slot, modifiers: modifiers.map(([stat, factorPerRank]) => ({ stat, factorPerRank })), perk, flavor, icon: `item:${id}`, accent,
  ...(classId ? { classId } : {}),
});

export const LEGENDARIES: LegendaryDef[] = [
  // ---------------- Weapons ----------------
  L('lg_grandfathers_thunder', "Grandfather's Thunder", 'weapon', '#ffd23f', [['player.damage', '1.12']],
    { id: 'fifth_shockwave', magnitude: '2.5', params: { every: 5, radius: 2.5 },
      description: 'Every 5th basic attack releases a shockwave: 250% basic damage to enemies within 2.5 units, knocking them back.' },
    'It spoke once a generation, and the valley listened.'),
  L('lg_kingslayers_oath', "Kingslayer's Oath", 'weapon', '#e04a3a', [['player.critPotency', '1.1']],
    { id: 'elite_slayer', magnitude: '1.35',
      description: 'Hits against champions, rares and bosses deal ×1.35 damage.' },
    'Sworn on a crown, sharpened on a throne.'),
  L('lg_executioners_edge', "Executioner's Edge", 'weapon', '#b03050', [['player.damage', '1.08']],
    { id: 'execute', magnitude: '2', params: { threshold: 0.25 },
      description: 'Hits against enemies below 25% health deal ×2 damage.' },
    'The last mercy is a quick one.'),
  L('lg_starfall_scepter', 'Starfall Scepter', 'weapon', '#ff8a3a', [['player.damage', '1.06'], ['player.recoveryRate', '1.06']],
    { id: 'signature_meteor', magnitude: '4', params: { delay: 0.6, radius: 2.4 },
      description: 'Casting your signature skill calls a meteor onto your aim point 0.6s later: 400% basic ember damage within 2.4 units, setting foes ablaze.' },
    'Point it at the sky and ask politely. Once.'),

  // ---------------- Helms ----------------
  L('lg_stormheralds_crown', "Stormherald's Crown", 'helm', '#9fd8ff', [['player.critTendency', '1.25']],
    { id: 'crit_lightning', magnitude: '1.2', params: { icd: 0.4, radius: 1.4 },
      description: 'Critical hits call down lightning: 120% of the hit as storm damage to the target and 60% to enemies within 1.4 units (at most every 0.4s).' },
    'The storm crowned no king. It crowned a lightning rod.'),
  L('lg_helm_of_the_drowned_bell', 'Helm of the Drowned Bell', 'helm', '#c8a060', [['player.armor', '1.15']],
    { id: 'bell_toll', magnitude: '1.5', params: { period: 6, radius: 3.5, stun: 1 },
      description: 'Every 6s a sunken bell tolls around you: enemies within 3.5 units take 150% basic damage and are stunned for 1s (bosses build stagger).' },
    'Twelve fathoms down, the abbey still keeps the hours.'),
  L('lg_circlet_of_the_third_path', 'Circlet of the Third Path', 'helm', '#7ad89a', [['player.recoveryRate', '1.06']],
    { id: 'path_sigil', magnitude: '1.4', params: { slot: 2, charges: 1 },
      description: 'Your third-branch active skill (hotbar slot 3) gains +1 charge and deals ×1.4 damage.' },
    'The third road is the one nobody maps.'),
  L('lg_crown_of_the_final_word', 'Crown of the Final Word', 'helm', '#ffe08a', [['player.skillDamage', '1.06']],
    { id: 'signature_mastery', magnitude: '1.6', params: { recovery: 1.35 },
      description: 'Your signature skill deals ×1.6 damage and its cooldown recovers 35% faster.' },
    'Kings speak last. It is the only word that matters.'),

  // ---------------- Chest ----------------
  L('lg_thornmail_of_the_briar_king', 'Thornmail of the Briar King', 'chest', '#6ab04a', [['player.armor', '1.2'], ['player.maxHealth', '1.08']],
    { id: 'thorns_nova', magnitude: '2', params: { icd: 1, radius: 2.5 },
      description: 'Taking a hit releases a thorn nova: 200% basic physical damage to enemies within 2.5 units (at most once per second).' },
    'He wore his garden. His garden wore his enemies.'),
  L('lg_cuirass_of_seven_blades', 'Cuirass of Seven Blades', 'chest', '#d8d8f0', [['player.maxHealth', '1.1']],
    { id: 'orbiting_blades', magnitude: '0.6', params: { radius: 1.8, interval: 0.5 },
      description: 'Spectral blades orbit you, striking every enemy within 1.8 units for 60% basic damage every 0.5s.' },
    'Seven oaths, seven blades, one very crowded breastplate.'),
  L('lg_wolfheart_hauberk', 'Wolfheart Hauberk', 'chest', '#c05030', [['player.maxHealth', '1.12']],
    { id: 'last_stand', magnitude: '1.3', params: { threshold: 0.35, attack: 1.25 },
      description: 'While below 35% health you deal ×1.3 damage and attack ×1.25 faster.' },
    'A cornered wolf is the only kind worth fearing.'),
  L('lg_mantle_of_the_herald', 'Mantle of the Herald', 'chest', '#f0c060', [['player.recoveryRate', '1.06']],
    { id: 'signature_refresh', magnitude: '3', params: {},
      description: 'Casting your signature skill cuts 3s from the cooldowns of your other skills.' },
    'Where the herald walks, the next charge is already sounding.'),

  // ---------------- Gloves ----------------
  L('lg_gauntlets_of_the_endless_chain', 'Gauntlets of the Endless Chain', 'gloves', '#a0a0c0', [['player.recoveryRate', '1.1']],
    { id: 'free_charge', magnitude: '0.2',
      description: 'Skills have a 20% chance not to spend a charge.' },
    'Every link remembers the one before it.'),
  L('lg_frostbitten_grasp', 'Frostbitten Grasp', 'gloves', '#8fd8ff', [['player.attackFrequency', '1.08']],
    { id: 'hits_chill', magnitude: '0.35', params: { duration: 1.5, bonus: 0.15 },
      description: 'Your hits chill enemies, slowing them by 35% for 1.5s. Hits on chilled enemies add 15% as frost damage.' },
    'The hand that held winter never quite thawed.'),
  L('lg_pyrehand_gauntlets', 'Pyrehand Gauntlets', 'gloves', '#ff6a2a', [['player.emberDamage', '1.15'], ['player.burnRate', '1.1']],
    { id: 'pyre_explosion', magnitude: '2', params: { radius: 2, ignite: 0.3, igniteSec: 3 },
      description: 'Critical hits ignite enemies (30% of the hit per second for 3s). Burning enemies explode on death for 200% basic ember damage within 2 units.' },
    'The martyr asked for a pyre. He got two, one on each hand.'),
  L('lg_plaguebearers_mitts', "Plaguebearer's Mitts", 'gloves', '#9ac040', [['player.burnRate', '1.15']],
    { id: 'plague_spread', magnitude: '0.6', params: { radius: 3, targets: 3 },
      description: 'When an enemy dies, its damage-over-time effects spread to up to 3 enemies within 3 units at 60% strength.' },
    'Sharing is a virtue. So is contagion.'),

  // ---------------- Boots ----------------
  L('lg_shadowstep_treads', 'Shadowstep Treads', 'boots', '#a070ff', [['player.movementSpeed', '1.08']],
    { id: 'dodge_shade', magnitude: '3', params: { delay: 0.8, radius: 2.2 },
      description: 'Dodging leaves a shade behind that explodes after 0.8s for 300% basic astral damage within 2.2 units.' },
    'Leave your shadow behind. It has unfinished business.'),
  L('lg_bloodrush_greaves', 'Bloodrush Greaves', 'boots', '#e03030', [['player.movementSpeed', '1.05']],
    { id: 'kill_streak_speed', magnitude: '1.08', params: { stacks: 5, duration: 4 },
      description: 'Each kill grants a stack of ×1.08 movement speed for 4s, up to 5 stacks (×1.47).' },
    'Run, and keep running. The killing will keep up.'),
  L('lg_veilwalker_boots', 'Veilwalker Boots', 'boots', '#c8eaff', [['player.recoveryRate', '1.06']],
    { id: 'dodge_ward', magnitude: '0.1', params: { iframes: 0.25 },
      description: 'Dodging grants a shield of 10% maximum health and 0.25s of extra invulnerability.' },
    'Step through the veil. Step back out somewhere safer.'),

  // ---------------- Amulets ----------------
  L('lg_deathless_vow', 'Deathless Vow', 'amulet', '#ffe0a0', [['player.maxHealth', '1.1']],
    { id: 'cheat_death', magnitude: '0.3', params: { iframes: 1.5 },
      description: 'Once per round, damage that would down you instead leaves you at 30% health with 1.5s of invulnerability.' },
    'Death keeps a ledger too. Yours has one blank line.'),
  L('lg_hourglass_of_the_patient_king', 'Hourglass of the Patient King', 'amulet', '#d0b070', [['player.recoveryRate', '1.06']],
    { id: 'empowered_skill', magnitude: '3', params: { period: 10 },
      description: 'Every 10s your next active or signature skill deals ×3 damage.' },
    'He waited ten seconds for everything. Everything was worth it.'),
  L('lg_lantern_of_the_hearth_saint', 'Lantern of the Hearth-Saint', 'amulet', '#ffc870', [['player.healing', '1.1']],
    { id: 'healing_aura', magnitude: '0.01', params: { radius: 4 },
      description: 'You and allies within 4 units regenerate 1% maximum health per second.' },
    'Her lamp never went out. Neither did anyone who sat by it.'),
  L('lg_pendant_of_the_second_path', 'Pendant of the Second Path', 'amulet', '#5ac8d8', [['player.recoveryRate', '1.06']],
    { id: 'path_sigil', magnitude: '1.4', params: { slot: 1, charges: 1 },
      description: 'Your second-branch active skill (hotbar slot 2) gains +1 charge and deals ×1.4 damage.' },
    'The middle road: never the safest, always the busiest.'),

  // ---------------- Rings ----------------
  L('lg_ravenous_fang', 'Ravenous Fang', 'ring', '#d04040', [['player.damage', '1.06']],
    { id: 'kill_heal', magnitude: '0.02',
      description: 'Every kill heals you for 2% of your maximum health.' },
    'A tooth from something that was never full.'),
  L('lg_mirrorglass_loop', 'Mirrorglass Loop', 'ring', '#e0f0ff', [['player.damage', '1.05']],
    { id: 'mirror_projectiles', magnitude: '0.7',
      description: 'Your projectiles fire a mirrored copy behind you at 70% damage.' },
    'What you throw forward, the mirror throws back.'),
  L('lg_gourdbearers_ring', "Gourdbearer's Ring", 'ring', '#e07a5a', [['player.healing', '1.15']],
    { id: 'potion_plus', magnitude: '0.6', params: { shield: 0.5 },
      description: 'Potions you collect heal 60% more and grant a shield worth half of their healing.' },
    'Never trust a hero who does not carry a spare.'),
  L('lg_sanguine_signet', 'Sanguine Signet', 'ring', '#a01a2a', [['player.critTendency', '1.1']],
    { id: 'life_leech', magnitude: '0.03', params: { cap: 0.02 },
      description: '3% of the damage you deal heals you (at most 2% of maximum health per hit, up to 10 times per second).' },
    'Sealed in wax. The wax was red. The wax was not wax.'),
  L('lg_ring_of_the_hungering_void', 'Ring of the Hungering Void', 'ring', '#7a5aff', [['player.astralDamage', '1.15']],
    { id: 'gravity_well', magnitude: '1', params: { period: 8, radius: 5, pull: 1.5 },
      description: 'Every 8s the void drags enemies within 5 units 1.5 units toward you and deals 100% basic astral damage.' },
    'It is always hungry. Feed it what is chasing you.'),
  L('lg_ring_of_the_first_path', 'Ring of the First Path', 'ring', '#e0a040', [['player.recoveryRate', '1.05']],
    { id: 'path_sigil', magnitude: '1.4', params: { slot: 0, charges: 1 },
      description: 'Your first-branch active skill (hotbar slot 1) gains +1 charge and deals ×1.4 damage.' },
    'Every journey starts with the same step. Make it twice.'),

  // ---------------- Class: Vanguard ----------------
  L('lg_aegis_of_the_unyielding', 'Aegis of the Unyielding', 'chest', '#e0a040', [['player.armor', '1.15'], ['player.shieldCapacity', '1.15']],
    { id: 'aegis_release', magnitude: '2.5', params: { radius: 3, knockback: 1.2 },
      description: 'Completing Guard Stance releases a shockwave dealing 250% of the damage it absorbed to enemies within 3 units, knocking them back.' },
    'Every blow it ever stopped, it remembers. Every one.', 'vanguard'),
  L('lg_cleaver_of_the_sundered_oath', 'Cleaver of the Sundered Oath', 'weapon', '#ff6a5e', [['skill.v_sweeping_strike.damage', '1.3']],
    { id: 'phantom_sweep', magnitude: '0.6', params: { delay: 0.25 },
      description: 'Sweeping Strike deals ×1.3 damage and a phantom arc follows 0.25s later for 60% of its damage.' },
    'The oath broke. The swing did not.', 'vanguard'),
  L('lg_standard_of_the_last_stand', 'Standard of the Last Stand', 'amulet', '#ffd23f', [['player.maxHealth', '1.08']],
    { id: 'last_stand_banner', magnitude: '1.2', params: { heal: 0.12 },
      description: 'Rally Cry also heals affected allies for 12% of their maximum health and grants them ×1.2 damage while it lasts.' },
    'Plant it here. No one falls back past it.', 'vanguard'),

  // ---------------- Class: Arcanist ----------------
  L('lg_phoenix_ember_diadem', 'Phoenix-Ember Diadem', 'helm', '#ff9a3a', [['skill.a_fireline.damage', '1.25']],
    { id: 'fireline_extend', magnitude: '2',
      description: 'Fireline deals ×1.25 damage and burns 2s longer.' },
    'It burns, it falls to ash, it burns again.', 'arcanist'),
  L('lg_stormcallers_coil', "Stormcaller's Coil", 'ring', '#9fd8ff', [['skill.a_arc_bolt.damage', '1.15']],
    { id: 'arc_thunderclap', magnitude: '1.5', params: { radius: 2 },
      description: 'Arc Bolt deals ×1.15 damage and its final target is struck by a thunderclap: 150% Arc Bolt damage within 2 units.' },
    'Wound so tight it hums in the dark.', 'arcanist'),
  L('lg_riftwalkers_sandals', "Riftwalker's Sandals", 'boots', '#d7a8ff', [['player.movementSpeed', '1.05']],
    { id: 'phase_burst', magnitude: '1.8', params: { radius: 2.2, iframes: 0.5 },
      description: 'Phase Step arrival releases an astral burst (180% basic damage within 2.2 units) and grants 0.5s of invulnerability.' },
    'They never touch the ground on the way. Only at the end.', 'arcanist'),

  // ---------------- Boss signatures (BossDef.loot: the boss drops its own while nobody wears it) ----------------
  L('lg_overclocked_kernel', 'Overclocked Kernel', 'amulet', '#3ae8d8', [['player.recoveryRate', '1.08']],
    { id: 'dodge_shade', magnitude: '3.2', params: { delay: 0.7, radius: 2.4 },
      description: 'Dodging leaves a corrupted echo behind that bursts after 0.7s for 320% basic astral damage within 2.4 units.' },
    'Torn from the Corrupted Core. It still dreams in static.'),
  L('lg_heart_of_the_colossus', 'Heart of the Iron Colossus', 'chest', '#ff7a2a', [['player.armor', '1.2'], ['player.maxHealth', '1.1']],
    { id: 'thorns_nova', magnitude: '2.4', params: { icd: 1, radius: 2.8 },
      description: 'Taking a hit vents molten slag: 240% basic physical damage to enemies within 2.8 units (at most once per second).' },
    'The forge-engine fell. The furnace inside never noticed.'),
];

export const LEGENDARY_BY_ID: Record<string, LegendaryDef> = Object.fromEntries(LEGENDARIES.map((x) => [x.id, x]));

/** Number of a perk param (content default when absent). */
export function perkParam(def: LegendaryDef, key: string, fallback: number): number {
  const v = def.perk.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const POS_DECIMAL = /^(0|[1-9]\d{0,8})(\.\d{1,12})?$/;

/** Authoring-time validation of the legendary catalogue (called by validateContent). */
export function validateLegendaries(): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const perkIds = new Set<string>(LEGENDARY_PERK_IDS);
  if (LEGENDARIES.length < 30) errs.push(`legendaries: need at least 30 items (have ${LEGENDARIES.length})`);
  for (const it of LEGENDARIES) {
    if (!/^lg_[a-z0-9_]+$/.test(it.id)) errs.push(`${it.id}: legendary ids are lg_<snake_case>`);
    if (ids.has(it.id)) errs.push(`duplicate legendary id ${it.id}`);
    ids.add(it.id);
    if (names.has(it.name)) errs.push(`${it.id}: duplicate legendary name ${it.name}`);
    names.add(it.name);
    if (!GEAR_SLOTS.includes(it.slot)) errs.push(`${it.id}: invalid slot ${it.slot}`);
    if (it.classId && !CLASS_BY_ID[it.classId]) errs.push(`${it.id}: unknown class ${it.classId}`);
    if (!/^#[0-9a-f]{6}$/i.test(it.accent)) errs.push(`${it.id}: accent must be a #rrggbb colour`);
    if (!it.flavor || !it.perk.description) errs.push(`${it.id}: needs flavor and a perk description`);
    if (it.modifiers.length < 1) errs.push(`${it.id}: needs at least one stat modifier`);
    for (const m of it.modifiers) {
      if (!isKnownStat(m.stat)) errs.push(`${it.id}: unknown modifier stat ${m.stat}`);
      if (!POS_DECIMAL.test(m.factorPerRank) || !(Number(m.factorPerRank) > 0)) errs.push(`${it.id}: invalid factor ${m.factorPerRank}`);
      const sk = /^skill\.([a-z0-9_]+)\.[a-z]+$/.exec(m.stat);
      if (sk) {
        const skill = SKILL_BY_ID[sk[1]];
        if (!skill) errs.push(`${it.id}: modifier references unknown skill ${sk[1]}`);
        else if (!it.classId || skill.classId !== it.classId) errs.push(`${it.id}: skill-scoped modifiers belong on class-only items of that class`);
        if (!/\.damage$/.test(m.stat)) errs.push(`${it.id}: only skill damage modifiers are supported on gear`);
      }
    }
    if (!perkIds.has(it.perk.id)) errs.push(`${it.id}: unknown perk ${it.perk.id}`);
    if (!POS_DECIMAL.test(it.perk.magnitude) || !(Number(it.perk.magnitude) > 0)) errs.push(`${it.id}: invalid perk magnitude ${it.perk.magnitude}`);
    for (const [k, v] of Object.entries(it.perk.params ?? {})) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errs.push(`${it.id}: perk param ${k} must be a finite number >= 0`);
    }
    if (it.perk.id === 'path_sigil') {
      const s = it.perk.params?.slot;
      if (s !== 0 && s !== 1 && s !== 2) errs.push(`${it.id}: path sigils name hotbar slot 0, 1 or 2`);
    }
  }
  for (const slot of GEAR_SLOTS) if (!LEGENDARIES.some((x) => x.slot === slot && !x.classId)) errs.push(`legendaries: slot ${slot} needs a class-agnostic item`);
  const r = LOOT_RULES;
  for (const [k, v] of Object.entries(r)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errs.push(`LOOT_RULES.${k} must be a finite number >= 0`);
  if (r.baseChance > r.maxChance || r.maxChance > 0.05) errs.push('LOOT_RULES: ordinary drop chances must stay low (<= 5%)');
  if (r.championChance > r.rareChance || r.rareChance > 0.25) errs.push('LOOT_RULES: elite chances must be ordered and modest');
  return errs;
}
