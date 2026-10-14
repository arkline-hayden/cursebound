/**
 * CURSEBOUND named palettes (0xRRGGBB). Ramps are ordered [dark, shadow, base, light(, specular)].
 * Shadows hue-shift toward indigo, lights toward warm white; the shared outline is deep indigo.
 * Framework-free: safe to import from Node tooling and SSR.
 */

export type Ramp = readonly number[];

export const OUTLINE = 0x1a1030;

const R = (...c: number[]): Ramp => Object.freeze(c);

/** Shared material ramps reused across actors. */
export const MATERIALS = {
  gold: R(0x6e3a1a, 0xb8702a, 0xf0b23c, 0xffe48a, 0xfffbe0),
  teal: R(0x0d3f4f, 0x16807f, 0x2dc9b8, 0x9af4e0),
  crimson: R(0x3e0c2a, 0x861a3c, 0xd2364e, 0xff7c78),
  steel: R(0x323a5e, 0x606f98, 0xa9bad8, 0xe8f0ff, 0xffffff),
  darkSteel: R(0x1e1a3a, 0x34365e, 0x535a86, 0x7c86b0),
  violet: R(0x241448, 0x432688, 0x6f44c8, 0xa98af8),
  deepViolet: R(0x1c0f38, 0x2e1a5c, 0x4a2c8c, 0x6e4cb8),
  cyan: R(0x0b4470, 0x1983c8, 0x46d2ff, 0xbff4ff, 0xffffff),
  ember: R(0x8a2408, 0xe2581a, 0xffa22e, 0xffe58a, 0xfffff0),
  wood: R(0x341e18, 0x5e3a24, 0x8c5a32, 0xbc8a56),
  leather: R(0x26182c, 0x43293e, 0x684256, 0x8e6274),
  skinShadow: R(0x1a1030, 0x2a1a48, 0x3e2a68, 0x5a4488),
  glassCyan: R(0x1a4f86, 0x3398da, 0x8ae2ff, 0xdffaff, 0xffffff),
  magenta: R(0x4a0c48, 0x93208a, 0xdc46bc, 0xff9ae6, 0xfff0fb),
  amberGold: R(0x7a4410, 0xc48020, 0xf7c43a, 0xfff09a),
  moss: R(0x1a361e, 0x2f6030, 0x58993a, 0xa2d65e),
  orangeGlow: R(0x8e3006, 0xee7414, 0xffae3a, 0xfff0a8, 0xffffff),
  shellBlue: R(0x16244e, 0x284494, 0x4572d4, 0x92baff),
  silver: R(0x434866, 0x8188a8, 0xc4cce4, 0xf4f7ff, 0xffffff),
  lime: R(0x22500e, 0x4f9618, 0x98dc2c, 0xe4ff94, 0xffffff),
  purple: R(0x260e3c, 0x481c70, 0x7834b0, 0xbc7cee),
  pink: R(0x62163e, 0xaa3474, 0xee6aac, 0xffb6da, 0xffffff),
  yellow: R(0x7e5010, 0xcc9a1e, 0xffdc3c, 0xfff6a8, 0xffffff),
  root: R(0x24161a, 0x432a24, 0x684632, 0x926c48),
  palePink: R(0x7e3e62, 0xc882a4, 0xffc6da, 0xfff0f6, 0xffffff),
  white: R(0x8a9ac8, 0xc4d2f0, 0xf0f6ff, 0xffffff),
  bronze: R(0x3e200e, 0x7c4a1c, 0xbc8236, 0xeebc66, 0xfff0c0),
  amberCore: R(0xa04008, 0xf08a14, 0xffc838, 0xfff4b0, 0xffffff),
  bone: R(0x5a4a5a, 0x9a8a9a, 0xd8ccd0, 0xfff8f4),
  eyeHot: R(0xa0104a, 0xff2a6a, 0xff7aa0, 0xffe0ea),
  // ---- Sunken Catacombs materials
  darkPlate: R(0x1c1a26, 0x37374a, 0x5c6278, 0x939bb2, 0xdce2ee),
  brass: R(0x3e220c, 0x7e5020, 0xc08a38, 0xecc670, 0xfff2c0),
  bloodRed: R(0x24050a, 0x520c16, 0x8e1a24, 0xc83a38, 0xf07a6a),
  chain: R(0x121018, 0x262430, 0x3e3c4a, 0x5e5c6c),
  darkWood: R(0x1c120e, 0x34221a, 0x523626, 0x725036),
  plum: R(0x1a0c1e, 0x341a3e, 0x542a62, 0x7e4a8a, 0xa872b4),
  arcane: R(0x062a26, 0x0e5a52, 0x1fae92, 0x86f0c6, 0xe0fff0),
  paleSkin: R(0x5a4a4e, 0x9a8a8a, 0xd0c4bc, 0xf2ece4),
  boneDry: R(0x3e322c, 0x7c6e5e, 0xbcae94, 0xe8dec4, 0xfffaf0),
  ghoulFlesh: R(0x161c18, 0x323e34, 0x566650, 0x8a9a7a, 0xc0ccaa),
  sinew: R(0x180e10, 0x3a2224, 0x5e3a38, 0x86584e),
  eyeRed: R(0x5a0606, 0xb81414, 0xff3e2e, 0xffb898, 0xffffff),
  batFur: R(0x0c0812, 0x1e122a, 0x34204a, 0x563a72, 0x7a5a96),
  batWing: R(0x140a18, 0x30183a, 0x4e2a5a, 0x764a82),
  eyeYellow: R(0x7a5a00, 0xd8a800, 0xffe03a, 0xfff8b0, 0xffffff),
  toadSick: R(0x161a0c, 0x323c16, 0x5a6a24, 0x8ea040, 0xc0cc78),
  toadBelly: R(0x3a3418, 0x6e6430, 0xa49a56, 0xd4cc8a),
  bile: R(0x1e4a06, 0x4a9c0c, 0x8ee81c, 0xd8ff84, 0xffffff),
  rust: R(0x241008, 0x4e2410, 0x80401c, 0xb46c32, 0xe09c5a),
  iron: R(0x101014, 0x24242c, 0x424250, 0x6c6c80, 0x9a9aae),
  soulBlue: R(0x0a2466, 0x1852c8, 0x44a2ff, 0xb4e4ff, 0xffffff),
  cultRobe: R(0x0c0408, 0x200a10, 0x38121c, 0x5a2030, 0x7a3044),
  hexViolet: R(0x260856, 0x5418aa, 0x9446f0, 0xd6a6ff, 0xffffff),
  wax: R(0x7a6a50, 0xbcac84, 0xece0c0, 0xfffaf0),
  flame: R(0x8a1e04, 0xe2520e, 0xff9a26, 0xffe07a, 0xfffff0),
  broodFlesh: R(0x24081a, 0x501a30, 0x84364a, 0xb8626e, 0xe0a0a0),
  broodEgg: R(0x5e4806, 0xb89a14, 0xf0dc48, 0xfff8b0, 0xffffff),
  chitin: R(0x0c080c, 0x20161e, 0x3a2a34, 0x5a4652),
  maggot: R(0x423828, 0x82745a, 0xc4b690, 0xece4c8, 0xffffff),
  ghostFire: R(0x183466, 0x3474c4, 0x84c4ff, 0xd4eeff, 0xffffff),
  stone: R(0x161412, 0x302c28, 0x524a42, 0x7c7266, 0xa49a8a),
  mossDark: R(0x0e160c, 0x1c2c14, 0x2e461e, 0x48662c),
} as const;

/** Per-actor palette sets (Sunken Catacombs theme). */
export const PALETTES = {
  outline: OUTLINE,
  /** Warm near-black outline for player characters. */
  playerOutline: 0x1c0c08,
  vanguard: {
    plate: MATERIALS.darkPlate,
    trim: MATERIALS.brass,
    cape: MATERIALS.bloodRed,
    blade: MATERIALS.steel,
    under: MATERIALS.chain,
    shield: MATERIALS.darkPlate,
    shieldBack: MATERIALS.darkWood,
    eye: MATERIALS.flame,
  },
  arcanist: {
    robe: MATERIALS.plum,
    robeDark: R(0x08040a, 0x140818, 0x241030, 0x3a1c48),
    trim: MATERIALS.arcane,
    hat: MATERIALS.plum,
    staff: MATERIALS.darkWood,
    ember: MATERIALS.flame,
    prism: MATERIALS.boneDry,
    face: R(0x08040a, 0x120814, 0x1e1024, 0x2e1a38),
    eye: MATERIALS.arcane,
    sash: MATERIALS.brass,
    skin: MATERIALS.paleSkin,
    skull: MATERIALS.boneDry,
  },
  duelist: {
    leather: R(0x1c1210, 0x34221c, 0x50362a, 0x6e4e3c, 0x8c6a52),
    cloth: R(0x1a1824, 0x2e2a3c, 0x48425a, 0x6a6280, 0x8e86a4),
    accent: MATERIALS.crimson,
    blade: MATERIALS.silver,
    grip: R(0x140808, 0x2a1010, 0x441a1a, 0x5e2a26),
    eye: R(0x6a7898, 0x9aa8c8, 0xd8e0f4, 0xf4f6ff, 0xffffff),
  },
  hexbinder: {
    robe: R(0x1a1222, 0x2e2238, 0x463452, 0x644c74, 0x846898),
    robeDark: R(0x0c0710, 0x18101e, 0x281a32, 0x3a2848),
    trim: R(0x1c380b, 0x3c6813, 0x68a625, 0xa6de58, 0xdeff98),
    sash: MATERIALS.hexViolet,
    skin: R(0x283026, 0x485442, 0x6c7a60, 0x94a282),
    staff: MATERIALS.darkWood,
    skull: MATERIALS.boneDry,
    glow: R(0x1c380b, 0x3c6813, 0x68a625, 0xa6de58, 0xdeff98),
    face: R(0x050307, 0x0a060c, 0x120a16, 0x1c1022),
  },
  artificer: {
    coat: R(0x0a2228, 0x123a42, 0x1e5a62, 0x2e8088, 0x58b0b0),
    trousers: R(0x13111a, 0x23202c, 0x352f40, 0x4b4357),
    leather: R(0x23130b, 0x3f2519, 0x5d3b27, 0x7d5537, 0x9c7450),
    brass: MATERIALS.brass,
    copper: R(0x38150b, 0x6c2b15, 0xa44925, 0xd0773d, 0xeea667),
    lens: R(0x0a4a4a, 0x149a90, 0x3ae8d0, 0xaafff0, 0xffffff),
    skin: R(0x48302a, 0x885c48, 0xc68e70, 0xeabfa0),
    wood: MATERIALS.darkWood,
    iron: MATERIALS.iron,
  },
  templar: {
    plate: R(0x383c50, 0x686e86, 0xa6aec6, 0xdae0ee, 0xffffff),
    gold: MATERIALS.gold,
    tabard: R(0x585868, 0x9898a8, 0xd6d6e2, 0xf2f2f8, 0xffffff),
    haft: MATERIALS.darkWood,
    iron: MATERIALS.iron,
    eye: R(0x8a6a20, 0xe0b040, 0xfff0a0, 0xffffe0, 0xffffff),
  },
  berserker: {
    skin: R(0x3e2018, 0x74402c, 0xa86a48, 0xd09670, 0xeec0a0),
    paint: MATERIALS.bloodRed,
    fur: R(0x1e1612, 0x3a2c22, 0x5a4636, 0x7e664e, 0xa08a70),
    leather: R(0x1a100c, 0x301e16, 0x4a3022, 0x664632),
    iron: MATERIALS.iron,
    hair: R(0x2a0c06, 0x54180a, 0x8a2c12, 0xc04a20),
    haft: MATERIALS.darkWood,
    blade: MATERIALS.steel,
  },
  cryomancer: {
    robe: R(0x1c3a62, 0x34669e, 0x5e9ad0, 0xa2d4f4, 0xe4f6ff),
    robeDark: R(0x0c1c34, 0x16305a, 0x24487e, 0x3a66a8),
    trim: R(0x0a4a7a, 0x1a8ad0, 0x5ad4ff, 0xc8f4ff, 0xffffff),
    sash: MATERIALS.silver,
    skin: R(0x4a5468, 0x8a96ac, 0xc8d4e4, 0xeef4fa),
    hair: R(0x8a9ab4, 0xbccadc, 0xe4eef8, 0xffffff),
    ice: MATERIALS.glassCyan,
    eye: R(0x0a4a7a, 0x1a8ad0, 0x5ad4ff, 0xc8f4ff, 0xffffff),
  },
  ranger: {
    cloak: R(0x0e1c10, 0x1c3a1e, 0x2e5a2e, 0x467e40, 0x68a05a),
    leather: R(0x24160c, 0x40281a, 0x604028, 0x80583a, 0xa07850),
    bow: R(0x4a2a10, 0x8a5426, 0xc48a48, 0xe8b878, 0xfff0c8),
    string: R(0x8a8a80, 0xb8b8aa, 0xdcdccc, 0xf4f4e8),
    fletch: MATERIALS.crimson,
    eye: R(0x1e140c, 0xa0c878, 0xe0f8c0, 0xffffff),
    skin: R(0x4a2a1a, 0x8a5a3e, 0xc08a64, 0xe4b48c),
  },
  warden: {
    bark: R(0x1a120c, 0x302218, 0x4a3624, 0x664c34, 0x84684a),
    leaf: R(0x0e2a12, 0x1c4a1e, 0x2e7030, 0x4a9a44, 0x80c866),
    vine: MATERIALS.mossDark,
    spear: R(0x5a4410, 0x8e6c1e, 0xc0a038, 0xe8cc6a, 0xfff0b0),
    shaft: R(0x2a160a, 0x4c2a14, 0x744424, 0x9c6438, 0xc48a58),
    eye: R(0x2a6a10, 0x5ab020, 0xa8f048, 0xe8ffb0, 0xffffff),
    antler: MATERIALS.boneDry,
  },
  spiritwolf: {
    body: R(0x0c3a2e, 0x1a6a54, 0x34a888, 0x8ae8c8, 0xe0fff4),
    dark: R(0x062018, 0x0e3a2c, 0x1a5a46, 0x2a7a60),
    eye: R(0x9affe0, 0xd0fff2, 0xffffff, 0xffffff),
  },
  pursuer: { body: MATERIALS.ghoulFlesh, dark: MATERIALS.sinew, bone: MATERIALS.boneDry, eye: MATERIALS.eyeRed },
  skirmisher: { body: MATERIALS.batFur, wing: MATERIALS.batWing, bone: MATERIALS.boneDry, eye: MATERIALS.eyeYellow },
  artillery: { body: MATERIALS.toadSick, lantern: MATERIALS.bile, belly: MATERIALS.toadBelly, eye: MATERIALS.eyeYellow },
  guardian: { bone: MATERIALS.boneDry, shield: MATERIALS.rust, iron: MATERIALS.iron, eye: MATERIALS.soulBlue },
  hexer: { robe: MATERIALS.cultRobe, glow: MATERIALS.hexViolet, wax: MATERIALS.wax, flame: MATERIALS.flame, skin: MATERIALS.paleSkin, eye: MATERIALS.hexViolet },
  broodcaller: { flesh: MATERIALS.broodFlesh, egg: MATERIALS.broodEgg, leg: MATERIALS.chitin },
  mite: { body: MATERIALS.maggot, head: MATERIALS.chitin, eye: MATERIALS.eyeRed },
  prismstag: { bone: MATERIALS.boneDry, fire: MATERIALS.ghostFire, hoof: MATERIALS.chitin, eye: MATERIALS.ghostFire },
  bellroot: { bell: MATERIALS.bronze, stone: MATERIALS.stone, iron: MATERIALS.iron, moss: MATERIALS.mossDark, core: MATERIALS.amberCore, eye: MATERIALS.amberCore },
  /** The Sunken Catacombs terrain. */
  dungeon: {
    floor: R(0x0d0d10, 0x17171b, 0x222126, 0x2e2c32, 0x3e3b41),
    mortar: 0x060607,
    moss: MATERIALS.mossDark,
    water: R(0x0a1014, 0x16222a, 0x2a3c46, 0x5e7e8a, 0xa8c4cc),
    brick: R(0x171210, 0x2a211c, 0x40332b, 0x58463a, 0x74604e),
    cap: R(0x0c0a0a, 0x161312, 0x201c1a, 0x2e2925, 0x6e6052),
    banner: MATERIALS.bloodRed,
    iron: MATERIALS.iron,
    rust: MATERIALS.rust,
    bone: MATERIALS.boneDry,
    wood: MATERIALS.darkWood,
    wax: MATERIALS.wax,
    flame: MATERIALS.flame,
    torchLight: 0xffa04a,
    candleLight: 0xffc070,
    void: 0x050405,
    fog: 0x2a2630,
  },
  biome: {
    /** Prismwood Canopy: calm dark floor, luminous crystal-tree walls. */
    floor: R(0x0c0f26, 0x12173a, 0x182048, 0x202b58),
    floorMoss: R(0x0c1c2a, 0x10283a, 0x16384a, 0x1f4a58),
    floorPetal: R(0x3a1240, 0x6a1e66, 0xb43a9a, 0xf07ad0),
    crystalFleck: R(0x1e4a8a, 0x3a86d8, 0x7ad8ff, 0xd8f6ff),
    rootGlow: R(0x0e3a3e, 0x147068, 0x2ec8a8, 0x9af8dc),
    canopy: R(0x1e0f48, 0x3a1c7a, 0x6634b0, 0xa66ae8, 0xe0b8ff),
    canopyTeal: R(0x0b3442, 0x136a72, 0x22b0a8, 0x7ef0d8),
    canopyMagenta: R(0x420c4a, 0x7c1c7c, 0xc23aa8, 0xf48ad8),
    trunk: R(0x1a1440, 0x2c2668, 0x48449a, 0x7a7ad0, 0xc8d4ff),
    gold: MATERIALS.amberGold,
    skyTop: 0x090620,
    skyMid: 0x1a0c44,
    skyLow: 0x2c1460,
    mote: R(0x3ac8ff, 0xc070ff, 0xff70d0, 0xffd860),
  },
} as const;

export type TelegraphPaletteName = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'highContrast';

export interface TelegraphPalette {
  danger: number;
  dangerFill: number;
  ally: number;
  enemyOutline: number;
  allyOutline: number;
  heal: number;
  shield: number;
  burn: number;
  storm: number;
  astral: number;
  decay: number;
  physical: number;
  frost: number;
}

/**
 * Telegraph / team-identity colors. Every palette keeps `danger` well separated from `ally` and
 * `heal` in its target color-vision space (renderers also shape-code telegraphs, so color is never
 * the only cue).
 */
export const TELEGRAPH_PALETTES: Record<TelegraphPaletteName, TelegraphPalette> = {
  default: {
    danger: 0xff3a5c,
    dangerFill: 0xd81e48,
    ally: 0x46d2ff,
    enemyOutline: 0xff4a6e,
    allyOutline: 0x5cffd0,
    heal: 0x6cff8e,
    shield: 0x8ed4ff,
    burn: 0xff8a2a,
    storm: 0xffe04a,
    astral: 0xd88aff,
    decay: 0xa6e030,
    physical: 0xf4e6c8,
    frost: 0xa0eaff,
  },
  // red/green weak (green cones): danger shifted to orange-yellow, friendly cues to blue.
  deuteranopia: {
    danger: 0xff9a00,
    dangerFill: 0xe07400,
    ally: 0x3a8cff,
    enemyOutline: 0xffb020,
    allyOutline: 0x56aaff,
    heal: 0x3ad2ff,
    shield: 0xc4dcff,
    burn: 0xffd23a,
    storm: 0xf4f070,
    astral: 0xb08cff,
    decay: 0x8c7a3a,
    physical: 0xf4f4f4,
    frost: 0x86e2ff,
  },
  // red weak (red cones): reds read dark, so danger uses bright yellow-orange.
  protanopia: {
    danger: 0xffb400,
    dangerFill: 0xe09000,
    ally: 0x2a78ff,
    enemyOutline: 0xffc830,
    allyOutline: 0x4c9cff,
    heal: 0x40d4ff,
    shield: 0xc8dcff,
    burn: 0xffe060,
    storm: 0xfff080,
    astral: 0xa494ff,
    decay: 0x8a8040,
    physical: 0xf4f4f4,
    frost: 0x8ae4ff,
  },
  // blue/yellow weak: danger stays red/magenta, friendly cues go teal.
  tritanopia: {
    danger: 0xff2a4a,
    dangerFill: 0xd0103a,
    ally: 0x20d4c4,
    enemyOutline: 0xff4060,
    allyOutline: 0x54f0e0,
    heal: 0x7ef0e8,
    shield: 0xd8f4f4,
    burn: 0xff7a8a,
    storm: 0xff9ad0,
    astral: 0xe0a0c8,
    decay: 0x6a8a8a,
    physical: 0xf4f4f4,
    frost: 0xb0fff4,
  },
  highContrast: {
    danger: 0xff0040,
    dangerFill: 0xff0040,
    ally: 0x00ffff,
    enemyOutline: 0xff2020,
    allyOutline: 0xffffff,
    heal: 0x00ff66,
    shield: 0xffffff,
    burn: 0xffa000,
    storm: 0xffff00,
    astral: 0xff66ff,
    decay: 0x99ff00,
    physical: 0xffffff,
    frost: 0x66ffff,
  },
};
