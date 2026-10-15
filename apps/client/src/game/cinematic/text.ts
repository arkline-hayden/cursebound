import { BOSS_BY_ID, DUNGEON_THEMES, TRAINING_THEME, MECHANIC_BY_ID, STAT_BY_ID, cardById, mechanicText, type CardEffect, type MechanicEffect } from '@cursebound/content';
import { B, formatMechanicValue } from '@cursebound/simulation';
import { renderTheme } from '../render/themes';

// Words and colours for the cutscenes. Card names and effect text come from content, never hand-written here.

/** Grand-entrance identity per boss: epithet for the name card, reveal colours. */
export const BOSS_CINE: Record<string, { epithet: string; glow: number; css: string; dust: number }> = {
  prismstag: { epithet: 'Crowned in Cold Ghost-fire', glow: 0x8fd8ff, css: '#9fe0ff', dust: 0x6a8aa8 },
  bellroot: { epithet: 'Toller of the Drowned Dead', glow: 0xffb050, css: '#ffc46a', dust: 0x6a5a48 },
  skydrake: { epithet: 'Sovereign of the Shattered Sky', glow: 0xbfe6ff, css: '#c8ecff', dust: 0x8a8a94 },
  moonhorror: { epithet: 'Eye of the Dead Moon', glow: 0x9a6aff, css: '#c0a8ff', dust: 0x5a5862 },
};

export function bossName(kind: string): string {
  return BOSS_BY_ID[kind]?.name ?? 'The Nameless';
}

export function bossEpithet(kind: string): string {
  return BOSS_CINE[kind]?.epithet ?? BOSS_BY_ID[kind]?.title ?? '';
}

/** Light / flare colour for a dungeon theme (doors, entry portals). */
const THEME_GLOW: Record<string, number> = {
  catacombs: 0xffb060, flooded: 0x6ac8ff, ossuary: 0xf4e4b0, sanctum: 0xff3a4a, fungal: 0x6af0c0, forge: 0xff7a2a, frost: 0xa8e8ff,
  sky: 0xffe0a0, moon: 0xcfe4ff, server: 0x50f0ff,
};

export function themeGlow(th: string | undefined): number {
  if (th && THEME_GLOW[th] !== undefined) return THEME_GLOW[th];
  return renderTheme(th).particleTint ?? 0xffd890;
}

export function hexCss(c: number): string { return `#${c.toString(16).padStart(6, '0')}`; }

export function themeName(th: string | undefined): string {
  if (th === TRAINING_THEME.id) return TRAINING_THEME.name;   // training grounds (courtyard)
  return DUNGEON_THEMES.find((t) => t.id === th)?.name ?? 'The Deep Dark';
}

const signed = (p: string) => (p.startsWith('-') ? `−${p.slice(1)}%` : `+${p}%`);
const statLine = (e: CardEffect) => `${signed(e.percent)} ${STAT_BY_ID[e.stat]?.name ?? e.stat}`;
function mechLine(e: MechanicEffect): string {
  const def = MECHANIC_BY_ID[e.id];
  if (!def) return e.id;
  return `${def.name}: ${mechanicText(def, def.short, formatMechanicValue(def, B(e.magnitude)))}`;
}

/** The card's name and its gift and price on one line ("Gift: +75% Damage · Price: −30% Maximum health"). */
export function cardLine(cardId: string | undefined): { name: string; line: string } | null {
  const c = cardId ? cardById(cardId) : undefined;
  if (!c) return null;
  const gift = [c.positive && statLine(c.positive), c.boon && mechLine(c.boon)].filter(Boolean).join(', ');
  const price = [c.negative && statLine(c.negative), c.bane && mechLine(c.bane)].filter(Boolean).join(', ');
  const parts = [gift && `Gift: ${gift}`, price && `Price: ${price}`].filter(Boolean);
  return { name: c.name, line: parts.join(' · ') };
}

export function fatesLine(n: number): string {
  if (n <= 0) return 'No fates bound yet';
  return `${n} ${n === 1 ? 'fate' : 'fates'} bound`;
}
