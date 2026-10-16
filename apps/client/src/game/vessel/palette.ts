/**
 * Per-class portal flavour for the Vessel Select stage: light colours, particle palette and the pose a hero strikes
 * when chosen. Colours mirror each class's in-game effect palette (render/fx/<class>.ts) so a portal reads as the
 * same magic the class throws in a run. Framework-free.
 */

export type VesselClass = 'vanguard' | 'arcanist' | 'duelist' | 'hexbinder' | 'artificer' | 'templar' | 'berserker' | 'cryomancer' | 'ranger' | 'warden';

export const VESSEL_CLASSES: readonly VesselClass[] = ['vanguard', 'arcanist', 'duelist', 'hexbinder', 'artificer', 'templar', 'berserker', 'cryomancer', 'ranger', 'warden'];

export interface Flavor {
  /** the portal's light colour (floor pool, light column, ring) */
  light: number;
  /** white-hot core of the ring and column */
  core: number;
  /** deep shade (outer haze, column edges) */
  deep: number;
  /** secondary colour (sparks, runes) */
  accent: number;
  /** particle palette, hottest first */
  motes: readonly number[];
  /** pose struck when the hero is chosen */
  flourish: 'cast' | 'attack';
}

export const FLAVOR: Record<VesselClass, Flavor> = {
  // steel sparks off a gold-lit war banner, an earth crack under the plinth
  vanguard: { light: 0xffb040, core: 0xfff4c8, deep: 0x6a3a10, accent: 0x9fd8ff, motes: [0xffffff, 0xe8f6ff, 0xffc94a, 0xffa830], flourish: 'attack' },
  // ember, storm and astral: violet light, gold embers, lilac stars, crackling bolts
  arcanist: { light: 0xa070ff, core: 0xf0e0ff, deep: 0x2a1e7a, accent: 0xffc24a, motes: [0xfff0b0, 0xffc24a, 0xff7a2a, 0xd7a8ff], flourish: 'cast' },
  // crimson slashes and shadow
  duelist: { light: 0xff3a52, core: 0xffd0d8, deep: 0x3a1a4a, accent: 0x8a5aff, motes: [0xffd0d8, 0xff3a52, 0xb0142a, 0xd8c8ff], flourish: 'attack' },
  // violet curses: skull wisps rising through sickly motes
  hexbinder: { light: 0x9a5ad0, core: 0xe8d0ff, deep: 0x2a0e3a, accent: 0x8fd14f, motes: [0xe8d0ff, 0xc8a0ff, 0x9a5ad0, 0x8fd14f], flourish: 'cast' },
  // brass gears and tesla arcs
  artificer: { light: 0x5ae8d4, core: 0xe0fff8, deep: 0x1a4a44, accent: 0xd8a850, motes: [0xfff2c0, 0xd8a850, 0x5ae8d4, 0x8fe8ff], flourish: 'cast' },
  // holy light shafts and crosses
  templar: { light: 0xffd76a, core: 0xfff8e8, deep: 0x7a5418, accent: 0xa8dcff, motes: [0xffffff, 0xfff1a8, 0xffd76a, 0xa8dcff], flourish: 'attack' },
  // blood embers and rage
  berserker: { light: 0xff4a2a, core: 0xffe0b0, deep: 0x5a0810, accent: 0xff8a3a, motes: [0xffe0b0, 0xff8a3a, 0xff4a2a, 0xd0202a], flourish: 'attack' },
  // frost crystals and snow
  cryomancer: { light: 0x5ac8ff, core: 0xeafcff, deep: 0x16407a, accent: 0x9fe8ff, motes: [0xffffff, 0xd8f6ff, 0x9fe8ff, 0x5ac8ff], flourish: 'cast' },
  // wind and feathers
  ranger: { light: 0xa8e878, core: 0xf4fff0, deep: 0x24481c, accent: 0xffd27a, motes: [0xeaf6ff, 0xc8f0a8, 0xa8f07a, 0xffd27a], flourish: 'cast' },
  // leaves and a spectral wolf
  warden: { light: 0x7affb8, core: 0xeafff6, deep: 0x1e3a14, accent: 0x9ad86a, motes: [0xeafff6, 0x9affc8, 0x9ad86a, 0xff9ad0], flourish: 'cast' },
};

export function isVesselClass(id: string): id is VesselClass {
  return (VESSEL_CLASSES as readonly string[]).includes(id);
}

/** Flavour for any class id (unknown ids borrow the Vanguard's). */
export function flavorOf(id: string): Flavor {
  return FLAVOR[isVesselClass(id) ? id : 'vanguard'];
}

export const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
