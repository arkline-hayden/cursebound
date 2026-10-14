// Per-round dungeon theme presentation (lighting, tint, particles, props). The simulation picks the theme id;
// these settings only change how the floor looks — never rules. Tilesets, props, pillars and grime come from the art
// module's THEME_ART; this file layers renderer tuning (ambient brightness, particle and decal tints) on top.

import { THEME_ART, type ThemeId } from '../art/dungeonThemes';

export interface RenderTheme {
  ambient: number;
  torch: number;
  floorTint: number;
  wallTint: number;
  particles: 'dust' | 'drips' | 'spores' | 'embers' | 'snow';
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
}

const ATMO: Record<ThemeId, { shaftColor: number; fogColor: number; fogAlpha: number; grade: number; torchBoost: number }> = {
  catacombs: { shaftColor: 0xc8d4ff, fogColor: 0x8a8094, fogAlpha: 0.1, grade: 0xc0aa98, torchBoost: 1.25 },
  flooded: { shaftColor: 0x9fe0e8, fogColor: 0x6a9ca8, fogAlpha: 0.15, grade: 0x86a8bc, torchBoost: 1.2 },
  ossuary: { shaftColor: 0xffe0b0, fogColor: 0xc8b496, fogAlpha: 0.1, grade: 0xc8b08c, torchBoost: 1.15 },
  sanctum: { shaftColor: 0xffc8a0, fogColor: 0x9a3444, fogAlpha: 0.12, grade: 0xc09080, torchBoost: 1.25 },
  fungal: { shaftColor: 0x9affd8, fogColor: 0x5aa890, fogAlpha: 0.14, grade: 0x88b8a4, torchBoost: 1.35 },
  forge: { shaftColor: 0xffb070, fogColor: 0x4a3a34, fogAlpha: 0.16, grade: 0xd09a78, torchBoost: 1.15 },
  frost: { shaftColor: 0xe4f6ff, fogColor: 0xd0e4fa, fogAlpha: 0.13, grade: 0x9cb8dc, torchBoost: 1.2 },
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
};

/** Light colour of torches / braziers where the art's flame colour would drown the room in one hue (warm-cool contrast). */
const TORCH_OVERRIDE: Partial<Record<ThemeId, number>> = { sanctum: 0xff7a4a };

export const RENDER_THEMES: Record<string, RenderTheme> = Object.fromEntries(
  (Object.keys(TUNING) as ThemeId[]).map((id) => {
    const a = THEME_ART[id];
    return [id, { ...TUNING[id], ...ATMO[id], torch: TORCH_OVERRIDE[id] ?? a.torchColor, particles: a.particles, floorProps: a.props, wallProps: a.wallProps, torchProp: a.torchProp, pillarProp: a.pillarProp, grime: a.grime }];
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
