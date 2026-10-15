// Per-round dungeon theme presentation (lighting, tint, particles, props). The simulation picks the theme id;
// these settings only change how the floor looks — never rules. Tilesets, props, pillars and grime come from the art
// module's THEME_ART; this file layers renderer tuning (ambient brightness, particle and decal tints) on top.

import { THEME_ART, type ThemeId } from '../art/dungeonThemes';

export interface RenderTheme {
  ambient: number;
  torch: number;
  floorTint: number;
  wallTint: number;
  particles: 'dust' | 'drips' | 'spores' | 'embers' | 'snow' | 'petals' | 'data';
  particleTint: number;
  floorProps: { id: string; weight: number }[];
  wallProps: { id: string; weight: number }[];
  torchProp: string;
  pillarProp: string;
  grime: string[];
  decalTint: number;
  /** atmosphere: light shafts, low fog, screen grade (multiply), torch boost */
  shaftColor: number;
  fogColor: number;
  fogAlpha: number;
  grade: number;
  torchBoost: number;
  /** open-air floors: back walls drawn as a low rim (no wall dressing, no cobwebs) */
  lowWalls?: boolean;
  /** what lies beyond the floor's edges (Skybox.ts): open sky with drifting clouds, or a starfield with the Earth */
  backdrop?: 'sky' | 'stars';
}

const ATMO: Record<ThemeId, { shaftColor: number; fogColor: number; fogAlpha: number; grade: number; torchBoost: number }> = {
  catacombs: { shaftColor: 0xc8d4ff, fogColor: 0x8a8094, fogAlpha: 0.1, grade: 0xc0aa98, torchBoost: 1.25 },
  flooded: { shaftColor: 0x9fe0e8, fogColor: 0x6a9ca8, fogAlpha: 0.15, grade: 0x86a8bc, torchBoost: 1.2 },
  ossuary: { shaftColor: 0xffe0b0, fogColor: 0xc8b496, fogAlpha: 0.1, grade: 0xc8b08c, torchBoost: 1.15 },
  sanctum: { shaftColor: 0xffc8a0, fogColor: 0x9a3444, fogAlpha: 0.12, grade: 0xc09080, torchBoost: 1.25 },
  fungal: { shaftColor: 0x9affd8, fogColor: 0x5aa890, fogAlpha: 0.14, grade: 0x88b8a4, torchBoost: 1.35 },
  forge: { shaftColor: 0xffb070, fogColor: 0x4a3a34, fogAlpha: 0.16, grade: 0xd09a78, torchBoost: 1.15 },
  frost: { shaftColor: 0xe4f6ff, fogColor: 0xd0e4fa, fogAlpha: 0.13, grade: 0x9cb8dc, torchBoost: 1.2 },
  // sunbeams and cloud wisps in warm daylight; cold earthlight and settling dust; coolant mist under neon
  sky: { shaftColor: 0xfff0c8, fogColor: 0xf4f8ff, fogAlpha: 0.12, grade: 0xf0dcc0, torchBoost: 1 },
  moon: { shaftColor: 0xd8e8ff, fogColor: 0x9aa4b8, fogAlpha: 0.06, grade: 0x8a9ac0, torchBoost: 1.1 },
  server: { shaftColor: 0x40e8ff, fogColor: 0x2a6a80, fogAlpha: 0.07, grade: 0x7a7aa8, torchBoost: 1.3 },
};

// Ambient is kept a touch brighter than the art defaults so the arena stays readable at range.
const TUNING: Record<ThemeId, { ambient: number; floorTint: number; wallTint: number; particleTint: number; decalTint: number }> = {
  catacombs: { ambient: 0x7a6a78, floorTint: 0xffffff, wallTint: 0xffffff, particleTint: 0xd8c8a8, decalTint: 0xffffff },
  flooded: { ambient: 0x5a7088, floorTint: 0xb8cce0, wallTint: 0xa8bcd0, particleTint: 0x9fd0ff, decalTint: 0xc0d8ff },
  ossuary: { ambient: 0x8a7e6a, floorTint: 0xf0e4c8, wallTint: 0xf4e8cc, particleTint: 0xf0e0c0, decalTint: 0xffffff },
  sanctum: { ambient: 0x8a4a52, floorTint: 0xe8a0a0, wallTint: 0xd89090, particleTint: 0xff6a5e, decalTint: 0xffd0d0 },
  fungal: { ambient: 0x58847a, floorTint: 0xb8c8a0, wallTint: 0xa8b890, particleTint: 0x8ff0d0, decalTint: 0xd0ffe0 },
  forge: { ambient: 0x8a5a3a, floorTint: 0xb09080, wallTint: 0x98786a, particleTint: 0xffa040, decalTint: 0xffc8a0 },
  frost: { ambient: 0x7088a8, floorTint: 0xd8ecff, wallTint: 0xc8e0ff, particleTint: 0xffffff, decalTint: 0xd8f0ff },
  sky: { ambient: 0xe0d4bc, floorTint: 0xffffff, wallTint: 0xffffff, particleTint: 0xfff0f6, decalTint: 0xffffff },
  moon: { ambient: 0x7a8498, floorTint: 0xdce4f0, wallTint: 0xd0d8e8, particleTint: 0xd0d8e8, decalTint: 0xe0e8f8 },
  server: { ambient: 0x3a4458, floorTint: 0xc8d4e8, wallTint: 0xb8c4dc, particleTint: 0x50f0ff, decalTint: 0xd0f0ff },
};

/** Light colour of torches / braziers where the art's flame colour would drown the room in one hue (warm-cool contrast). */
const TORCH_OVERRIDE: Partial<Record<ThemeId, number>> = { sanctum: 0xff7a4a };

/** Open-air themes: the sky shard's low rim and open sky, the moon's starfield. */
const OPEN_AIR: Partial<Record<ThemeId, Pick<RenderTheme, 'lowWalls' | 'backdrop'>>> = {
  sky: { lowWalls: true, backdrop: 'sky' },
  moon: { backdrop: 'stars' },
};

export const RENDER_THEMES: Record<string, RenderTheme> = Object.fromEntries(
  (Object.keys(TUNING) as ThemeId[]).map((id) => {
    const a = THEME_ART[id];
    return [id, { ...TUNING[id], ...ATMO[id], ...OPEN_AIR[id], torch: TORCH_OVERRIDE[id] ?? a.torchColor, particles: a.particles, floorProps: a.props, wallProps: a.wallProps, torchProp: a.torchProp, pillarProp: a.pillarProp, grime: a.grime }];
  }),
);

export function renderTheme(id: string | undefined): RenderTheme {
  return RENDER_THEMES[id ?? 'catacombs'] ?? RENDER_THEMES.catacombs;
}

export function pickWeighted(list: { id: string; weight: number }[], r: number): string | null {
  const total = list.reduce((s, x) => s + x.weight, 0);
  if (!total) return null;
  let t = r * total;
  for (const x of list) { t -= x.weight; if (t <= 0) return x.id; }
  return list[list.length - 1].id;
}
