/**
 * Hand-composed vignettes and per-theme set-dressing tables (framework-free data).
 *
 * A vignette is a small cluster of props laid out in a local frame anchored on a floor tile that touches a back
 * wall: `u` runs along the wall, `v` runs away from it into the room (both in tiles, measured from the anchor
 * tile's back corner). The renderer places the same layout against a north wall, or transposed + mirrored against a
 * west wall, so every composition reads correctly either way. Items stay within ~2 tiles of the wall so the middle of
 * every room is left clear for combat.
 */
import type { EdgeKind } from './ambientArt';
import type { ThemeId } from './dungeonThemes';

export interface VItem {
  id: string;
  u: number;
  v: number;
  /** mirror the sprite (in addition to the wall-side mirroring) */
  flip?: boolean;
  /** probability the item appears (default 1) */
  p?: number;
}

export interface VDecal {
  key: string;
  frame?: number;
  u: number;
  v: number;
  sx?: number;
  sy?: number;
  tint?: number;
  alpha?: number;
  /** probability the decal appears (default 1) */
  p?: number;
}

export interface Vignette {
  id: string;
  /** footprint along the wall / into the room, tiles */
  len: number;
  depth: number;
  /** needs an inside corner (side wall at u = 0) */
  corner?: boolean;
  items: VItem[];
  decals?: VDecal[];
  /** wall props on the back wall faces (tile offset along the wall) */
  walls?: { id: string; u: number }[];
  /** a ground trail leading into the scene */
  trail?: 'boots' | 'drag' | 'blood' | 'paws';
}

const OLD_BLOOD = 0x3a0a0a;

export const VIGNETTES: Record<string, Vignette> = {
  camp: {
    id: 'camp',
    len: 3,
    depth: 2,
    trail: 'boots',
    items: [
      { id: 'bedroll', u: 0.95, v: 0.75 },
      { id: 'campfire', u: 2.05, v: 1.35 },
      { id: 'pack', u: 0.35, v: 0.35 },
      { id: 'skeleton_slump', u: 2.5, v: 0.2 },
      { id: 'lantern', u: 1.55, v: 0.35, p: 0.6 },
      { id: 'sacks', u: 0.35, v: 1.55, p: 0.5 },
      { id: 'parchment', u: 1.35, v: 1.6, p: 0.6 },
    ],
    decals: [{ key: 'decal:scorch', u: 2.05, v: 1.4, sx: 0.8, sy: 0.4, alpha: 0.7 }],
  },
  shrine: {
    id: 'shrine',
    len: 2.6,
    depth: 2,
    corner: true,
    items: [
      { id: 'statue', u: 0.6, v: 0.2 },
      { id: 'candles', u: 1.45, v: 0.55 },
      { id: 'candles', u: 0.45, v: 1.25, flip: true },
      { id: 'offering', u: 1.1, v: 1.05 },
      { id: 'skeleton_lying', u: 1.6, v: 1.75, p: 0.35 },
    ],
    decals: [
      { key: 'decal:wax', u: 1.4, v: 0.75 },
      { key: 'decal:wax', frame: 1, u: 0.6, v: 1.4 },
      { key: 'decal:coins', frame: 0, u: 1.25, v: 1.35 },
    ],
    walls: [{ id: 'tapestry', u: 1.5 }],
  },
  library: {
    id: 'library',
    len: 3,
    depth: 2,
    items: [
      { id: 'bookshelf', u: 0.5, v: 0.2 },
      { id: 'bookshelf', u: 1.5, v: 0.2, p: 0.75 },
      { id: 'books_spilled', u: 1.25, v: 0.95 },
      { id: 'parchment', u: 2.2, v: 1.3 },
      { id: 'table', u: 2.45, v: 0.6 },
      { id: 'stool', u: 2.15, v: 1.15, p: 0.7 },
      { id: 'parchment', u: 0.55, v: 1.25, p: 0.6 },
    ],
    decals: [{ key: 'decal:wax', u: 2.5, v: 0.9 }],
    walls: [{ id: 'shelf_jars', u: 2.5 }],
  },
  torture: {
    id: 'torture',
    len: 3,
    depth: 2,
    trail: 'drag',
    items: [
      { id: 'rack', u: 1.25, v: 1.0 },
      { id: 'cage_skel', u: 2.55, v: 0.3 },
      { id: 'bucket', u: 0.4, v: 1.45 },
      { id: 'skull_spike', u: 0.35, v: 0.35, p: 0.7 },
      { id: 'skeleton_lying', u: 2.4, v: 1.6, p: 0.4 },
    ],
    decals: [
      { key: 'decal:blood', frame: 1, u: 1.25, v: 1.15, sx: 1.4, sy: 0.7, tint: OLD_BLOOD, alpha: 0.75 },
      { key: 'decal:blood', frame: 3, u: 0.6, v: 1.6, sx: 0.6, sy: 0.3, tint: OLD_BLOOD, alpha: 0.7 },
      { key: 'decal:claw', u: 2.2, v: 1.2 },
    ],
    walls: [{ id: 'manacles', u: 0.5 }, { id: 'manacles', u: 1.5 }],
  },
  smithy: {
    id: 'smithy',
    len: 3,
    depth: 2,
    items: [
      { id: 'anvil', u: 1.35, v: 1.05 },
      { id: 'quench', u: 2.3, v: 0.55 },
      { id: 'weaponrack', u: 0.5, v: 0.15 },
      { id: 'orepile', u: 2.55, v: 1.45 },
      { id: 'shield_lean', u: 1.55, v: 0.15, p: 0.7 },
      { id: 'bucket', u: 0.45, v: 1.4, p: 0.5 },
    ],
    decals: [{ key: 'decal:scorch', u: 1.35, v: 1.2, sx: 0.7, sy: 0.35, alpha: 0.6 }],
    walls: [{ id: 'toolrack', u: 1.5 }],
  },
  collapse: {
    id: 'collapse',
    len: 3,
    depth: 2,
    items: [
      { id: 'rubble_big', u: 1.25, v: 1.0 },
      { id: 'beam_broken', u: 2.4, v: 0.25 },
      { id: 'bricks', u: 0.45, v: 1.6 },
      { id: 'rubble', u: 2.55, v: 1.75 },
      { id: 'skeleton_lying', u: 0.55, v: 0.85, p: 0.55 },
    ],
    decals: [
      { key: 'decal:bonedust', u: 1.4, v: 1.3, sx: 1.6, sy: 0.8, alpha: 0.6 },
      { key: 'decal:crack', u: 0.9, v: 1.6, sx: 1.2, sy: 0.6 },
    ],
    walls: [{ id: 'crack_roots', u: 1.5 }],
  },
  ritual: {
    id: 'ritual',
    len: 3,
    depth: 2,
    items: [
      { id: 'candle_circle', u: 1.5, v: 1.55 },
      { id: 'altar_blood', u: 1.5, v: 0.45 },
      { id: 'skull_spike', u: 0.35, v: 0.3 },
      { id: 'skull_spike', u: 2.65, v: 0.3 },
    ],
    decals: [
      { key: 'decal:chalk', u: 0.5, v: 1.9, alpha: 0.8 },
      { key: 'decal:blood', frame: 2, u: 1.5, v: 0.9, sx: 0.8, sy: 0.4, tint: OLD_BLOOD, alpha: 0.7 },
    ],
    walls: [{ id: 'runes', u: 1.5 }],
  },
  storage: {
    id: 'storage',
    len: 3,
    depth: 1.6,
    items: [
      { id: 'crate', u: 0.45, v: 0.4 },
      { id: 'barrel', u: 1.05, v: 0.35 },
      { id: 'sacks', u: 1.85, v: 0.5 },
      { id: 'barrel_broken', u: 2.55, v: 0.45, p: 0.8 },
      { id: 'crate_broken', u: 0.6, v: 1.2, p: 0.7 },
      { id: 'cartwheel', u: 2.6, v: 0.1, p: 0.5 },
    ],
    decals: [{ key: 'decal:coins', frame: 1, u: 1.6, v: 1.2, p: 0.5 }],
    walls: [{ id: 'shelf_jars', u: 0.5 }],
  },
  ambush: {
    id: 'ambush',
    len: 3,
    depth: 2,
    trail: 'blood',
    items: [
      { id: 'skeleton_lying', u: 1.3, v: 1.2 },
      { id: 'shield_lean', u: 0.45, v: 0.12 },
      { id: 'chest_open', u: 2.4, v: 0.5 },
      { id: 'pack', u: 2.2, v: 1.65, p: 0.7 },
      { id: 'skeleton_slump', u: 1.4, v: 0.2, p: 0.5 },
    ],
    decals: [
      { key: 'decal:coins', frame: 2, u: 2.3, v: 1.1 },
      { key: 'decal:blood', frame: 0, u: 1.3, v: 1.3, sx: 1.1, sy: 0.55, tint: OLD_BLOOD, alpha: 0.7 },
    ],
    walls: [{ id: 'tally', u: 0.5 }],
  },
  // ---------------- theme specific
  boatwreck: {
    id: 'boatwreck',
    len: 3,
    depth: 2,
    items: [
      { id: 'rowboat', u: 1.45, v: 1.05 },
      { id: 'nets', u: 0.45, v: 0.6 },
      { id: 'piling', u: 2.65, v: 0.35 },
      { id: 'barrel', u: 2.6, v: 1.55, p: 0.7 },
    ],
    decals: [{ key: 'decal:puddle', frame: 1, u: 1.6, v: 1.6, sx: 1.4, sy: 0.7 }],
    walls: [{ id: 'glowmoss', u: 0.5 }],
  },
  throne: {
    id: 'throne',
    len: 3,
    depth: 2,
    items: [
      { id: 'bonethrone', u: 1.5, v: 0.25 },
      { id: 'skulls_tall', u: 0.4, v: 0.55 },
      { id: 'skulls_tall', u: 2.6, v: 0.55, flip: true },
      { id: 'soulcandles', u: 1.0, v: 1.15 },
      { id: 'soulcandles', u: 2.0, v: 1.15 },
    ],
    decals: [{ key: 'decal:bonedust', u: 1.5, v: 1.3, sx: 1.8, sy: 0.9, alpha: 0.7 }],
  },
  reliquary: {
    id: 'reliquary',
    len: 2.5,
    depth: 1.8,
    items: [
      { id: 'reliquary', u: 1.2, v: 0.5 },
      { id: 'soulcandles', u: 0.45, v: 0.55 },
      { id: 'bonepile2', u: 1.9, v: 1.25 },
      { id: 'soulcandles', u: 2.1, v: 0.5, p: 0.6 },
    ],
    decals: [{ key: 'decal:wax', u: 0.5, v: 0.85 }],
    walls: [{ id: 'bonecandle', u: 1.5 }],
  },
  chapel: {
    id: 'chapel',
    len: 3,
    depth: 2,
    items: [
      { id: 'statue_broken', u: 1.5, v: 0.2 },
      { id: 'pew', u: 1.45, v: 1.55 },
      { id: 'lectern', u: 0.45, v: 0.6 },
      { id: 'candelabra', u: 2.6, v: 0.45 },
    ],
    decals: [
      { key: 'decal:wax', u: 2.5, v: 0.8 },
      { key: 'decal:rune', u: 1.5, v: 0.95, sx: 0.9, sy: 0.45, alpha: 0.6 },
    ],
    walls: [{ id: 'tapestry_red', u: 0.5 }],
  },
  grove: {
    id: 'grove',
    len: 3,
    depth: 2,
    items: [
      { id: 'shroom_giant', u: 1.5, v: 0.45 },
      { id: 'shroom', u: 0.45, v: 1.05 },
      { id: 'shroom2', u: 2.6, v: 1.15 },
      { id: 'sporepod', u: 0.6, v: 0.35 },
      { id: 'roots_floor', u: 1.5, v: 1.5 },
      { id: 'shroom_tiny', u: 2.2, v: 0.4 },
      { id: 'shroom_tiny', u: 1.0, v: 1.65 },
      { id: 'skeleton_lying', u: 2.2, v: 1.75, p: 0.4 },
    ],
  },
  mine: {
    id: 'mine',
    len: 3,
    depth: 2,
    items: [
      { id: 'minecart', u: 1.4, v: 0.95 },
      { id: 'orepile', u: 0.45, v: 0.6 },
      { id: 'orepile', u: 2.5, v: 1.5 },
      { id: 'forge_hearth', u: 2.55, v: 0.45 },
    ],
    decals: [{ key: 'decal:ash', u: 1.4, v: 1.3, sx: 1.4, sy: 0.7, alpha: 0.7 }],
    walls: [{ id: 'chainhooks', u: 0.5 }],
  },
  expedition: {
    id: 'expedition',
    len: 3,
    depth: 2,
    trail: 'boots',
    items: [
      { id: 'frozencorpse', u: 0.5, v: 0.2 },
      { id: 'campfire_cold', u: 1.65, v: 1.25 },
      { id: 'crate_snow', u: 2.55, v: 0.55 },
      { id: 'bedroll', u: 1.4, v: 0.6 },
      { id: 'iciclecluster', u: 2.6, v: 1.65, p: 0.7 },
      { id: 'pack', u: 0.6, v: 1.3, p: 0.6 },
    ],
  },
};

/** Floor clutter scattered along the walls: `standing` props need a back wall, `low` props are baked flat. */
export interface ThemeDressing {
  vignettes: { id: string; weight: number }[];
  standing: { id: string; weight: number }[];
  low: { id: string; weight: number }[];
  /** extra wall dressing on top of THEME_ART.wallProps */
  wall: { id: string; weight: number }[];
  edge: EdgeKind;
  /** chance a floor/wall seam gets edge growth */
  edgeChance: number;
  /** per-theme prop swaps for vignette items (e.g. frost: campfire -> campfire_cold) */
  swap: Record<string, string>;
  /** ambient life */
  critters: { rats: number; bats: boolean; spiders: boolean; drips: boolean; gusts: boolean };
  /** colour of old blood / story trails */
  trailTint: number;
}

const W = (pairs: [string, number][]): { id: string; weight: number }[] => pairs.map(([id, weight]) => ({ id, weight }));

const COMMON_STANDING: [string, number][] = [
  ['barrel_broken', 2], ['crate_broken', 2], ['sacks', 1], ['bucket', 1], ['stool', 1], ['skeleton_slump', 2], ['shield_lean', 1], ['cartwheel', 0.6], ['table_over', 1],
];
const COMMON_LOW: [string, number][] = [['parchment', 2], ['skeleton_lying', 1], ['bricks', 1], ['books_spilled', 0.5]];

export const THEME_DRESSING: Record<ThemeId, ThemeDressing> = {
  catacombs: {
    vignettes: W([['camp', 3], ['shrine', 2], ['library', 2], ['torture', 2], ['collapse', 2], ['storage', 2], ['ambush', 2], ['ritual', 1]]),
    standing: W([...COMMON_STANDING, ['skull_spike', 1], ['cage', 0.7], ['cage_skel', 0.5], ['weaponrack', 0.5]]),
    low: W([...COMMON_LOW, ['offering', 0.4]]),
    wall: W([['shelf_jars', 1], ['tapestry', 1], ['sconce', 1.5], ['crack_roots', 1], ['tally', 1], ['manacles', 1], ['mount_skull', 0.6], ['antlers', 0.4]]),
    edge: 'moss',
    edgeChance: 0.3,
    swap: {},
    critters: { rats: 3, bats: true, spiders: true, drips: true, gusts: false },
    trailTint: 0x3a0a0a,
  },
  flooded: {
    vignettes: W([['boatwreck', 4], ['storage', 3], ['camp', 2], ['collapse', 2], ['ambush', 2]]),
    standing: W([...COMMON_STANDING, ['piling', 1.5]]),
    low: W([['nets', 2], ['parchment', 0.6], ['skeleton_lying', 1], ['bricks', 1]]),
    wall: W([['glowmoss', 2], ['crack_roots', 1.5], ['manacles', 0.8], ['shelf_jars', 0.5], ['tally', 0.6]]),
    edge: 'algae',
    edgeChance: 0.45,
    swap: { bedroll: 'nets', books_spilled: 'nets', table: 'crate' },
    critters: { rats: 4, bats: true, spiders: false, drips: true, gusts: false },
    trailTint: 0x1a2a2a,
  },
  ossuary: {
    vignettes: W([['throne', 2], ['reliquary', 3], ['shrine', 2], ['torture', 1], ['collapse', 2], ['library', 1], ['ambush', 1]]),
    standing: W([['skull_spike', 2], ['skulls_tall', 1], ['skeleton_slump', 2], ['cage_skel', 0.8], ['barrel_broken', 0.6], ['crate_broken', 0.6], ['reliquary', 0.5]]),
    low: W([['skeleton_lying', 2], ['parchment', 0.6], ['bricks', 0.8], ['offering', 0.6]]),
    wall: W([['bonecandle', 2], ['mount_skull', 1], ['crack_roots', 0.8], ['tally', 0.8], ['runes', 0.6]]),
    edge: 'dust',
    edgeChance: 0.4,
    swap: { candles: 'soulcandles', statue: 'skulls_tall', tapestry: 'bonecandle' },
    critters: { rats: 3, bats: true, spiders: true, drips: false, gusts: false },
    trailTint: 0x2a1e14,
  },
  sanctum: {
    vignettes: W([['chapel', 3], ['ritual', 3], ['shrine', 2], ['library', 2], ['torture', 2]]),
    standing: W([['candelabra', 1.5], ['skull_spike', 1], ['statue_broken', 0.8], ['lectern', 0.8], ['skeleton_slump', 1], ['table_over', 0.8], ['stool', 0.6]]),
    low: W([['parchment', 2], ['books_spilled', 1], ['skeleton_lying', 0.8], ['offering', 0.8]]),
    wall: W([['tapestry_red', 2], ['runes', 1.5], ['sconce', 1.5], ['manacles', 0.6]]),
    edge: 'wax',
    edgeChance: 0.3,
    swap: { candles: 'goldcandles', tapestry: 'tapestry_red', lantern: 'candelabra' },
    critters: { rats: 2, bats: true, spiders: true, drips: false, gusts: false },
    trailTint: 0x4a0808,
  },
  fungal: {
    vignettes: W([['grove', 5], ['camp', 2], ['collapse', 2], ['ambush', 2], ['storage', 1]]),
    standing: W([['shroom', 2], ['shroom2', 1.5], ['sporepod', 1.5], ['skeleton_slump', 1], ['barrel_broken', 0.8], ['crate_broken', 0.6]]),
    low: W([['roots_floor', 2], ['shroom_tiny', 3], ['skeleton_lying', 1], ['parchment', 0.4]]),
    wall: W([['wallshrooms', 2.5], ['crack_roots', 1.5], ['tally', 0.4]]),
    edge: 'mycel',
    edgeChance: 0.45,
    swap: { candles: 'shroom_tiny', lantern: 'sporepod', tapestry: 'wallshrooms', shelf_jars: 'wallshrooms' },
    critters: { rats: 2, bats: true, spiders: true, drips: true, gusts: false },
    trailTint: 0x1e1410,
  },
  forge: {
    vignettes: W([['smithy', 4], ['mine', 3], ['storage', 2], ['torture', 2], ['collapse', 1]]),
    standing: W([['quench', 1], ['barrel_broken', 1], ['crate_broken', 1], ['weaponrack', 1], ['shield_lean', 1], ['skeleton_slump', 1], ['bucket', 0.8]]),
    low: W([['orepile', 2], ['bricks', 1.5], ['skeleton_lying', 0.6]]),
    wall: W([['chainhooks', 2], ['toolrack', 1.5], ['manacles', 0.8], ['tally', 0.5]]),
    edge: 'soot',
    edgeChance: 0.4,
    swap: { lantern: 'quench', tapestry: 'toolrack', candles: 'lantern' },
    critters: { rats: 2, bats: false, spiders: false, drips: false, gusts: false },
    trailTint: 0x1a0c08,
  },
  frost: {
    vignettes: W([['expedition', 4], ['camp', 1], ['storage', 2], ['collapse', 2], ['ambush', 2], ['shrine', 1]]),
    standing: W([['crate_snow', 2], ['iciclecluster', 2], ['frozencorpse', 0.8], ['skeleton_slump', 1], ['barrel_broken', 0.6], ['shield_lean', 0.6]]),
    low: W([['skeleton_lying', 1.2], ['bricks', 1], ['parchment', 0.4], ['snowpile', 2]]),
    wall: W([['frostcrystal_wall', 2], ['crack_roots', 0.8], ['tally', 0.8], ['antlers', 0.6]]),
    edge: 'rime',
    edgeChance: 0.5,
    swap: { campfire: 'campfire_cold', crate: 'crate_snow', barrel: 'crate_snow', skeleton_slump: 'frozencorpse', candles: 'icecrystal', lantern: 'icecrystal', sacks: 'snowpile' },
    critters: { rats: 0, bats: true, spiders: false, drips: false, gusts: true },
    trailTint: 0x2a3a4a,
  },
};

/** Every prop id referenced by the dressing tables (for the asset validator). */
export function dressingPropIds(): string[] {
  const ids = new Set<string>();
  for (const v of Object.values(VIGNETTES)) {
    for (const it of v.items) ids.add(it.id);
    for (const w of v.walls ?? []) ids.add(w.id);
  }
  for (const d of Object.values(THEME_DRESSING)) {
    for (const l of [d.standing, d.low, d.wall]) for (const x of l) ids.add(x.id);
    for (const s of Object.values(d.swap)) ids.add(s);
  }
  return [...ids];
}

/** Every decal key referenced by vignettes (for the asset validator). */
export function dressingDecalKeys(): string[] {
  const keys = new Set<string>();
  for (const v of Object.values(VIGNETTES)) for (const d of v.decals ?? []) keys.add(d.key);
  return [...keys];
}
