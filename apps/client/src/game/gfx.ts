import { settingsStore, updateSettings } from '../lib/settings';
import { GFX_PRESETS, isTier, readGfxDevice, stepDown, writeGfxDevice, type GfxKnobs, type GfxTier } from './gfxProfile';

// Graphics quality tiers: one place that turns the player's chosen tier into concrete render budgets, so renderers
// never test the tier name directly. Gameplay-relevant visuals (attack shapes, telegraphs, projectiles, enemy
// outlines, damage numbers) never depend on the tier, only cosmetic cost does. The presets, the Auto probe and the
// per-device record live in gfxProfile.ts (framework-free); this module reads the live setting.

export { GFX_TIERS, GFX_PRESETS, GFX_LABELS, tierFromProbe, probeGfx, stepDown, tierRank, type GfxTier, type GfxKnobs, type GfxProbe } from './gfxProfile';

/** Current tier knobs (defaults to high until the setting loads). */
export function gfx(): GfxKnobs {
  const tier = settingsStore.get().s.graphics;
  return GFX_PRESETS[isTier(tier) ? tier : 'high'];
}

/** Cosmetic particle multiplier after the reduced-effects setting (0 when effects are reduced). */
export function particleBudget(): number {
  return settingsStore.get().s.reducedEffects ? 0 : gfx().particles;
}

/**
 * Scale a cosmetic particle count by the tier. Fractions round stochastically, so a stream of single embers thins
 * out evenly on low instead of either all surviving or all vanishing.
 */
export function fxCount(n: number, mult = gfx().particles): number {
  if (n <= 0 || mult <= 0) return 0;
  const v = n * mult;
  const whole = Math.floor(v);
  return whole + (Math.random() < v - whole ? 1 : 0);
}

/**
 * The frame-rate watchdog (CombatScene) found frames consistently slow at a safe moment (no boss, no cutscene, not
 * mid-fight). On Auto this device's tier drops one step and is remembered; a tier the player pinned is never changed,
 * only noted so the settings panel can suggest a cheaper one. Returns the new tier when it stepped down.
 */
export function reportSlowFrames(): GfxTier | null {
  const s = settingsStore.get().s;
  const cur = gfx().tier;
  const rec = readGfxDevice() ?? { v: 1 as const, auto: cur };
  const slow = { tier: cur, at: Date.now() };
  if (s.graphicsAuto && cur !== 'low') {
    const next = stepDown(cur);
    writeGfxDevice({ ...rec, auto: next, slow });
    updateSettings({ graphics: next });
    return next;
  }
  writeGfxDevice({ ...rec, slow });
  return null;
}

/** The last slow-frame report on this device, if it was made at the tier now in use. */
export function slowHint(): { tier: GfxTier; at: number } | null {
  const slow = readGfxDevice()?.slow;
  return slow && slow.tier === gfx().tier ? slow : null;
}
