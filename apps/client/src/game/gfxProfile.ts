/// <reference lib="dom" />
// Graphics tiers, framework-free: the presets, the first-run capability probe and its tier mapping, and the per-device
// record that remembers what Auto picked (and whether this device has run slow). No imports, so settings.ts and
// unit tests can use it without pulling in Phaser or React. gfx.ts turns the player's setting into these knobs.

export type GfxTier = 'low' | 'medium' | 'high' | 'ultra';
export const GFX_TIERS: readonly GfxTier[] = ['low', 'medium', 'high', 'ultra'];

export interface GfxKnobs {
  tier: GfxTier;
  /** dynamic point lights (Phaser Light2D); off on low, which skips the Light2D pipeline entirely */
  lighting: boolean;
  /** max simultaneous dynamic lights (compiled into the Light2D shader, so changing it rebuilds the renderer) */
  maxLights: number;
  /** 0..1 multiplier on static floor/wall decor and clutter placement (dressing) */
  decorDensity: number;
  /** animated decor (flickering braziers, dripping water, swaying banners, smoke and embers rising from sources) */
  animatedDecor: boolean;
  /** multiplier on cosmetic particle counts (impacts, embers, dust); never applied to telegraphs or projectiles */
  particles: number;
  /** ambient critters (rats, bats, spiders, flies) and drifting gusts (render/Ambient.ts) */
  ambientLife: boolean;
  /** additive soft halos behind projectiles, pickups and loot (the projectile / item sprite itself always draws) */
  softGlow: boolean;
  /** post-processing passes (bloom, colour grade, vignette) */
  postFx: boolean;
  /** render the attract-mode dungeon behind the title menu (low shows a static vignette instead) */
  menuBackdrop: boolean;
  /** frame-rate cap for the renderer */
  fps: 30 | 60;
}

export const GFX_PRESETS: Record<GfxTier, GfxKnobs> = {
  low: { tier: 'low', lighting: false, maxLights: 0, decorDensity: 0.35, animatedDecor: false, particles: 0.25, ambientLife: false, softGlow: false, postFx: false, menuBackdrop: false, fps: 30 },
  medium: { tier: 'medium', lighting: true, maxLights: 12, decorDensity: 0.65, animatedDecor: true, particles: 0.55, ambientLife: false, softGlow: true, postFx: false, menuBackdrop: true, fps: 60 },
  high: { tier: 'high', lighting: true, maxLights: 28, decorDensity: 1, animatedDecor: true, particles: 1, ambientLife: true, softGlow: true, postFx: true, menuBackdrop: true, fps: 60 },
  ultra: { tier: 'ultra', lighting: true, maxLights: 40, decorDensity: 1.3, animatedDecor: true, particles: 1.4, ambientLife: true, softGlow: true, postFx: true, menuBackdrop: true, fps: 60 },
};

/** Settings-panel copy: one line on what each tier changes. */
export const GFX_LABELS: Record<GfxTier, { label: string; blurb: string }> = {
  low: { label: 'Low', blurb: 'No dynamic lights or bloom, sparse decor, few particles, no critters, 30 fps cap. For older laptops.' },
  medium: { label: 'Medium', blurb: 'Torchlight with up to 12 lights, lighter decor and particles, no bloom or critters.' },
  high: { label: 'High', blurb: 'The full look: 28 lights, bloom and grade, full decor, critters and particles.' },
  ultra: { label: 'Ultra', blurb: 'Up to 40 lights, denser decor and extra particles. For strong desktop GPUs.' },
};

export const tierRank = (t: GfxTier): number => GFX_TIERS.indexOf(t);
/** One tier cheaper (low stays low). */
export const stepDown = (t: GfxTier): GfxTier => GFX_TIERS[Math.max(0, tierRank(t) - 1)]!;
export const isTier = (v: unknown): v is GfxTier => typeof v === 'string' && (GFX_TIERS as readonly string[]).includes(v);

// ---------------------------------------------------------------- capability probe

export interface GfxProbe {
  webgl: boolean;
  webgl2: boolean;
  /** the browser would only give a context with a major performance caveat (software rendering) */
  caveat: boolean;
  maxTextureSize: number;
  /** navigator.hardwareConcurrency (0 when unknown) */
  cores: number;
  /** navigator.deviceMemory in GB (Chromium only, capped at 8; null when unknown) */
  memoryGb: number | null;
  /** unmasked GPU renderer string ('' when hidden) */
  renderer: string;
  /** touch-first phone / tablet */
  mobile: boolean;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen|google.*vulkan.*cpu/i;
/** Low-end integrated GPUs: Intel HD / UHD (not Iris), older AMD APU Radeon graphics, Chromebooks' GMA-era parts. */
const WEAK_IGPU = /intel.*\b(hd|uhd)\b|intel.*gma|\bgma\s?\d|mesa dri intel|radeon\(tm\) r[2-7] |radeon r[2-7] graphics|amd radeon\(tm\) graphics|radeon vega \d\b|vega \d graphics/i;
/** Integrated but capable: Intel Iris / Arc iGPUs, Apple silicon, recent AMD 680M/780M-class. */
const GOOD_IGPU = /iris|intel.*arc|apple (m\d|gpu)|radeon 6[0-9]0m|radeon 7[0-9]0m|radeon 8[0-9]0m/i;
const MOBILE_GPU = /mali|adreno|powervr|videocore|tegra/i;
const DISCRETE_GPU = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|\brx \d{3,4}|arc a\d{3}|arc b\d{3}/i;

/**
 * Pick a tier from a capability probe. Starts from High (Ultra only for a clearly strong desktop) and takes the
 * lowest cap any signal imposes, so one weak part is enough to step down.
 */
export function tierFromProbe(p: GfxProbe): GfxTier {
  if (!p.webgl || p.caveat || SOFTWARE_GPU.test(p.renderer)) return 'low';
  const r = p.renderer;
  const discrete = DISCRETE_GPU.test(r) && !WEAK_IGPU.test(r);
  const ultraOk = discrete && p.webgl2 && p.maxTextureSize >= 16384 && p.cores >= 8 && (p.memoryGb === null || p.memoryGb >= 8) && !p.mobile;
  let rank = ultraOk ? 3 : 2;
  const cap = (t: GfxTier) => { rank = Math.min(rank, tierRank(t)); };
  // API / limits: WebGL1-only or tiny texture limits mean an old GPU or driver
  if (!p.webgl2) cap('low');
  if (p.maxTextureSize > 0 && p.maxTextureSize < 4096) cap('low');
  else if (p.maxTextureSize > 0 && p.maxTextureSize < 8192) cap('medium');
  // CPU: the simulation runs locally beside the renderer
  if (p.cores > 0 && p.cores <= 2) cap('low');
  else if (p.cores > 0 && p.cores <= 4) cap('medium');
  // memory (Chromium reports 0.25..8)
  if (p.memoryGb !== null && p.memoryGb <= 2) cap('low');
  else if (p.memoryGb !== null && p.memoryGb <= 4) cap('medium');
  // GPU family
  if (WEAK_IGPU.test(r) && !GOOD_IGPU.test(r)) cap('medium');
  if (MOBILE_GPU.test(r) || p.mobile) cap('medium');
  if (MOBILE_GPU.test(r) && p.cores > 0 && p.cores <= 4) cap('low');
  return GFX_TIERS[rank]!;
}

/** Quick capability probe (browser only; a throwaway context that is released straight away). */
export function probeGfx(): GfxProbe {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  const out: GfxProbe = {
    webgl: false, webgl2: false, caveat: false, maxTextureSize: 0,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 0,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    renderer: '',
    mobile: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(pointer: fine)').matches,
  };
  if (typeof document === 'undefined') return out;
  const release = (gl: WebGLRenderingContext | WebGL2RenderingContext | null) => { try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } };
  try {
    const c2 = document.createElement('canvas');
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = c2.getContext('webgl2');
    out.webgl2 = !!gl;
    if (!gl) gl = document.createElement('canvas').getContext('webgl');
    out.webgl = !!gl;
    if (gl) {
      out.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String((dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '');
      release(gl);
      // a context that refuses failIfMajorPerformanceCaveat is software rendered (or blocklisted)
      const strict = document.createElement('canvas').getContext(out.webgl2 ? 'webgl2' : 'webgl', { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
      out.caveat = !strict;
      release(strict);
    }
  } catch { /* leave what we learned */ }
  return out;
}

// ---------------------------------------------------------------- per-device record

/** Device-local (never synced to the profile): Auto's pick for this machine and the last slow-frame report. */
export interface GfxDeviceRecord { v: 1; auto: GfxTier; slow?: { tier: GfxTier; at: number } }
const DEVICE_KEY = 'cursebound.gfx.device';

export function readGfxDevice(): GfxDeviceRecord | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as Partial<GfxDeviceRecord> | null;
    if (!raw || raw.v !== 1 || !isTier(raw.auto)) return null;
    return { v: 1, auto: raw.auto, slow: raw.slow && isTier(raw.slow.tier) ? raw.slow : undefined };
  } catch { return null; }
}

export function writeGfxDevice(rec: GfxDeviceRecord) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(rec)); } catch { /* ignore */ }
}

/** Auto's tier for this device: probed once on first run, then remembered (and lowered by the frame-rate watchdog). */
export function deviceAutoTier(): GfxTier {
  const rec = readGfxDevice();
  if (rec) return rec.auto;
  const auto = tierFromProbe(probeGfx());
  writeGfxDevice({ v: 1, auto });
  return auto;
}
