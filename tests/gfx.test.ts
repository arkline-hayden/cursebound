import { describe, expect, it } from 'vitest';
import { GFX_PRESETS, GFX_TIERS, stepDown, tierFromProbe, type GfxKnobs, type GfxProbe } from '../apps/client/src/game/gfxProfile';
import { fxCount } from '../apps/client/src/game/gfx';
import { DEFAULT_SETTINGS, normalizeSettings } from '../apps/client/src/lib/settings';

// Graphics tiers: the presets must get strictly cheaper toward low (low genuinely cheap: no Light2D, 30 fps), and the
// first-run Auto probe must map hardware signals to a sensible tier (one weak part is enough to step down).

const DESKTOP: GfxProbe = {
  webgl: true, webgl2: true, caveat: false, maxTextureSize: 16384, cores: 16, memoryGb: 8,
  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', mobile: false,
};
const probe = (p: Partial<GfxProbe>): GfxProbe => ({ ...DESKTOP, ...p });

describe('graphics presets', () => {
  it('low is genuinely cheap', () => {
    const low = GFX_PRESETS.low;
    expect(low.lighting).toBe(false);
    expect(low.maxLights).toBe(0);
    expect(low.fps).toBe(30);
    expect(low.postFx).toBe(false);
    expect(low.ambientLife).toBe(false);
    expect(low.animatedDecor).toBe(false);
    expect(low.menuBackdrop).toBe(false);
    expect(low.softGlow).toBe(false);
    expect(low.particles).toBeLessThan(0.5);
  });

  it('every tier names itself and high is the reference look', () => {
    for (const t of GFX_TIERS) expect(GFX_PRESETS[t].tier).toBe(t);
    expect(GFX_PRESETS.high.particles).toBe(1);
    expect(GFX_PRESETS.high.decorDensity).toBe(1);
  });

  it('tiers are monotonic in cost: no knob gets cheaper going up', () => {
    const keys = Object.keys(GFX_PRESETS.low).filter((k) => k !== 'tier') as (keyof GfxKnobs)[];
    for (let i = 1; i < GFX_TIERS.length; i++) {
      const lo = GFX_PRESETS[GFX_TIERS[i - 1]], hi = GFX_PRESETS[GFX_TIERS[i]];
      for (const k of keys) expect(Number(hi[k]), `${k}: ${lo.tier} -> ${hi.tier}`).toBeGreaterThanOrEqual(Number(lo[k]));
      // and each step actually costs something
      expect(keys.some((k) => Number(hi[k]) > Number(lo[k]))).toBe(true);
    }
  });

  it('steps down one tier at a time and stops at low', () => {
    expect(stepDown('ultra')).toBe('high');
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('medium')).toBe('low');
    expect(stepDown('low')).toBe('low');
  });

  it('scales cosmetic particle counts with stochastic rounding', () => {
    expect(fxCount(10, 1)).toBe(10);
    expect(fxCount(0, 1)).toBe(0);
    expect(fxCount(10, 0)).toBe(0);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += fxCount(1, 0.25);
    expect(sum / 4000).toBeGreaterThan(0.2);
    expect(sum / 4000).toBeLessThan(0.3);
  });
});

describe('auto tier from the capability probe', () => {
  it('a strong desktop with a discrete GPU gets ultra', () => {
    expect(tierFromProbe(DESKTOP)).toBe('ultra');
    expect(tierFromProbe(probe({ renderer: 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' }))).toBe('ultra');
  });

  it('ultra needs every signal; a mid machine stays on high', () => {
    expect(tierFromProbe(probe({ cores: 6 }))).toBe('high');
    expect(tierFromProbe(probe({ maxTextureSize: 8192 }))).toBe('high');
    expect(tierFromProbe(probe({ renderer: '' }))).toBe('high');   // masked renderer: no ultra, no penalty
    expect(tierFromProbe(probe({ renderer: 'Apple M2' }))).toBe('high');
    expect(tierFromProbe(probe({ renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 8 }))).toBe('high');
  });

  it('weak integrated GPUs get medium', () => {
    expect(tierFromProbe(probe({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 8 }))).toBe('medium');
    expect(tierFromProbe(probe({ renderer: 'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 8 }))).toBe('medium');
    expect(tierFromProbe(probe({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 12 }))).toBe('medium');
  });

  it('four cores or 4 GB cap at medium, two cores or 2 GB at low', () => {
    expect(tierFromProbe(probe({ cores: 4 }))).toBe('medium');
    expect(tierFromProbe(probe({ memoryGb: 4 }))).toBe('medium');
    expect(tierFromProbe(probe({ cores: 2 }))).toBe('low');
    expect(tierFromProbe(probe({ memoryGb: 2 }))).toBe('low');
    expect(tierFromProbe(probe({ memoryGb: null, cores: 0 }))).toBe('high');   // unknown: no penalty, but no ultra either
  });

  it('software rendering, missing WebGL2 or tiny texture limits get low', () => {
    expect(tierFromProbe(probe({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' }))).toBe('low');
    expect(tierFromProbe(probe({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }))).toBe('low');
    expect(tierFromProbe(probe({ renderer: 'Microsoft Basic Render Driver' }))).toBe('low');
    expect(tierFromProbe(probe({ caveat: true }))).toBe('low');
    expect(tierFromProbe(probe({ webgl2: false }))).toBe('low');
    expect(tierFromProbe(probe({ maxTextureSize: 2048 }))).toBe('low');
    expect(tierFromProbe(probe({ webgl: false, webgl2: false }))).toBe('low');
  });

  it('phones and tablets cap at medium, weak ones at low', () => {
    expect(tierFromProbe(probe({ renderer: 'Adreno (TM) 740', mobile: true, cores: 8 }))).toBe('medium');
    expect(tierFromProbe(probe({ renderer: 'Mali-G52', mobile: true, cores: 4 }))).toBe('low');
  });

  it('is monotonic: weakening any single signal never raises the tier', () => {
    const rank = (p: GfxProbe) => GFX_TIERS.indexOf(tierFromProbe(p));
    const base = rank(DESKTOP);
    for (const p of [probe({ cores: 4 }), probe({ memoryGb: 1 }), probe({ maxTextureSize: 4096 }), probe({ webgl2: false }), probe({ caveat: true }), probe({ mobile: true })]) {
      expect(rank(p)).toBeLessThanOrEqual(base);
    }
  });
});

describe('graphics setting', () => {
  it('defaults to Auto and migrates saves from before the setting', () => {
    expect(DEFAULT_SETTINGS.graphicsAuto).toBe(true);
    const { s } = normalizeSettings({ version: 1, controlsRev: 99 } as Parameters<typeof normalizeSettings>[0]);
    expect(s.graphicsAuto).toBe(true);
    expect(GFX_TIERS).toContain(s.graphics);
  });

  it('keeps a pinned tier and repairs unknown values', () => {
    expect(normalizeSettings({ controlsRev: 99, graphics: 'low', graphicsAuto: false }).s).toMatchObject({ graphics: 'low', graphicsAuto: false });
    expect(normalizeSettings({ controlsRev: 99, graphics: 'potato' as never, graphicsAuto: false }).s).toMatchObject({ graphics: 'high', graphicsAuto: true });
  });
});
