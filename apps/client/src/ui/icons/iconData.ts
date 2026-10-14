/**
 * Pixel icon catalog + generators for DOM UI icons (16x16 grid). Pure and deterministic: the React
 * components in ./index.tsx only map the returned rects to <rect> elements. Also used by the art
 * manifest validator and the developer art viewer.
 */
import { MATERIALS, PALETTES } from '../../game/art/palette';
import { Painter, PixelBuffer, hsv, lighten, mix, type Ramp } from '../../game/art/draw/pixel';

/** [x, y, w, h, cssColor] on a 16x16 grid. */
export type PixelRect = [number, number, number, number, string];

export const CARD_FAMILIES = {
  blood: ['blood_pact', 'red_horizon'],
  glass: ['glass_cathedral', 'shattered_crown'],
  tempo: ['rapid_evolution', 'chasing_thunder'],
  growth: ['immortal_ambition', 'deep_renewal'],
  horde: ['endless_horde', 'thousand_footsteps'],
  gold: ['golden_catastrophe', 'gilded_ruin'],
  titan: ['colossal_bargain', 'titan_offering'],
  time: ['temporal_collapse', 'borrowed_tomorrow'],
  mirror: ['mirrorstorm', 'prism_rain'],
  decay: ['plague_bloom', 'rotting_garden'],
  transit: ['wild_transit', 'comet_walk'],
  thorn: ['thorn_covenant', 'iron_orchard'],
} as const;

export type CardFamily = keyof typeof CARD_FAMILIES;

export const CARD_IDS: readonly string[] = Object.values(CARD_FAMILIES).flat();

/** Cards outside the 24-card deck that still need icons (family motif, distinct gem). */
export const EXTRA_CARD_FAMILIES: Record<string, CardFamily> = { tutorial_twin_blades: 'blood' };

/** Node ids grouped by visual branch (index within a branch picks the accent glyph). */
export const NODE_BRANCHES = {
  guard: ['v_guard_stance', 'v_reinforced', 'v_recovery_pulse', 'v_shield_reach', 'v_shared_shelter', 'v_bastion'],
  strike: ['v_sweeping_strike', 'v_heavy_edge', 'v_deep_cut', 'v_follow_through', 'v_fracture', 'v_sundering_path'],
  rally: ['v_rally_cry', 'v_endurance', 'v_second_wind', 'v_rescue_pace', 'v_unbroken_rhythm', 'v_standard_bearer'],
  earth: ['v_earthbreaker'],
  cleave: ['v_cleave'],
  fire: ['a_spark', 'a_kindling', 'a_heat_sink', 'a_fireline', 'a_ash_recovery', 'a_inferno'],
  storm: ['a_arc_bolt', 'a_conductivity', 'a_charged_reserve', 'a_fork', 'a_static_shell', 'a_tempest'],
  rift: ['a_phase_step', 'a_rift_focus', 'a_quickening', 'a_return_mark', 'a_temporal_reserve', 'a_event_horizon'],
  nova: ['a_astral_nova'],
  dodge: ['dodge'],
  mDamage: ['mastery_damage'],
  mHealth: ['mastery_health'],
  mRegen: ['mastery_regen'],
} as const;

export const NODE_IDS: readonly string[] = Object.values(NODE_BRANCHES).flat();

export const STAT_NAMES = [
  'damage',
  'health',
  'recovery',
  'enemy_health',
  'enemy_offense',
  'mobility',
  'projectiles',
  'score',
  'armor',
  'crit',
  'healing',
  'shield',
  'resource',
  'regen',
] as const;

export const CLASS_IDS = ['vanguard', 'arcanist', 'duelist', 'artificer', 'hexbinder', 'cryomancer', 'ranger', 'templar', 'berserker', 'warden'] as const;

const M = MATERIALS;
const N = 16;

// ---------------------------------------------------------------- buffer -> rects

function css(c: number, a: number): string {
  const hex = `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  if (a >= 255) return hex;
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${(a / 255).toFixed(2)})`;
}

function toRects(buf: PixelBuffer): PixelRect[] {
  const out: PixelRect[] = [];
  for (let y = 0; y < buf.h; y++) {
    let x = 0;
    while (x < buf.w) {
      const c = buf.get(x, y);
      if (c >>> 24 === 0) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < buf.w && buf.get(x + w, y) === c) w++;
      out.push([x, y, w, 1, css(c & 0xffffff, c >>> 24)]);
      x += w;
    }
  }
  return out;
}

function make(draw: (p: Painter) => void, outline = true): PixelRect[] {
  const buf = new PixelBuffer(N, N);
  const p = new Painter(buf);
  draw(p);
  if (outline) p.finish(PALETTES.outline, 0.7);
  return toRects(buf);
}

// ---------------------------------------------------------------- motifs (drawn on a 16 grid)

type Motif = (p: Painter, ramp: Ramp, accent: Ramp) => void;

const motifs: Record<string, Motif> = {
  drop: (p, r) => {
    p.poly([8, 1.5, 11, 6, 12.5, 10, 11, 13.5, 8, 14.5, 5, 13.5, 3.5, 10, 5, 6]).fill(r, { mode: 'sphere', cx: 7, cy: 10 });
    p.px(6, 9, 0xffffff);
  },
  crystal: (p, r) => {
    p.poly([8, 1.5, 12.5, 6, 8, 14.5, 3.5, 6]).fill(r, { mode: 'facet', facets: 4, rot: Math.PI / 4 });
    p.line(5, 6, 8, 3).fill([0xffffff, 0xffffff, 0xffffff, 0xffffff], { mode: 'flat', inner: false });
  },
  bolt: (p, r) => {
    p.poly([9.5, 1.5, 4, 9, 7.5, 9, 6, 14.5, 12, 6.5, 8.5, 6.5]).fill(r, { mode: 'emboss', light: 0.15 });
  },
  sprout: (p, r, a) => {
    p.capsule(8, 14, 8, 7, 0.8, 0.8).fill(a, { mode: 'cyl' });
    p.ellipse(5, 6.5, 3.4, 2.2).ellipse(11, 5, 3.4, 2.2).fill(r, { mode: 'sphere' });
  },
  heads: (p, r) => {
    p.circle(4.5, 9, 2.6).circle(11.5, 9, 2.6).fill(r, { mode: 'sphere', light: -0.15 });
    p.circle(8, 7, 3.2).fill(r, { mode: 'sphere' });
    p.px(7, 7, PALETTES.outline).px(9, 7, PALETTES.outline);
    p.rect(2, 12, 12, 2).fill(r, { mode: 'emboss' });
  },
  coin: (p, r) => {
    p.circle(8, 8, 6).fill(r, { mode: 'sphere' });
    p.circle(8, 8, 3.6).fill(r, { mode: 'flat', tone: 1, inner: false });
    p.rect(7, 5, 2, 6).fill(r, { mode: 'flat', tone: 3, inner: false });
  },
  weight: (p, r, a) => {
    p.ellipse(8, 4.5, 3, 2.2).minus().ellipse(8, 4.8, 1.4, 1.2).fill(a, { mode: 'emboss' });
    p.poly([3, 14, 13, 14, 12, 6.5, 4, 6.5]).fill(r, { mode: 'emboss' });
    p.rect(6, 9, 4, 1).fill(r, { mode: 'flat', tone: 0, inner: false });
  },
  hourglass: (p, r, a) => {
    p.rect(3, 2, 10, 2).rect(3, 12, 10, 2).fill(a, { mode: 'emboss' });
    p.poly([4.5, 4, 11.5, 4, 8.6, 8, 11.5, 12, 4.5, 12, 7.4, 8]).fill(r, { mode: 'emboss', light: 0.2 });
    p.poly([6, 11.5, 10, 11.5, 8, 9.5]).fill(M.amberGold, { mode: 'flat', tone: 3, inner: false });
    p.px(8, 6, M.amberGold[2]!);
  },
  mirror: (p, r, a) => {
    p.capsule(8, 14.5, 8, 11, 1, 1).fill(a, { mode: 'cyl' });
    p.ellipse(8, 6.5, 4.6, 5.2).fill(a, { mode: 'sphere' });
    p.ellipse(8, 6.5, 3.2, 3.8).fill(r, { mode: 'sphere', light: 0.2, inner: false });
    p.line(6, 5, 7, 3.5).fill([0xffffff, 0xffffff, 0xffffff, 0xffffff], { mode: 'flat', inner: false });
  },
  mushroom: (p, r, a) => {
    p.rect(6.5, 8, 3, 6).fill(a, { mode: 'cyl' });
    p.ellipse(8, 7, 6, 4).minus().rect(0, 8, 16, 8).fill(r, { mode: 'sphere', cy: 8 });
    p.px(6, 5, 0xffffff).px(10, 4, lighten(r[3]!, 0.5)).px(8, 3, lighten(r[3]!, 0.5));
  },
  portal: (p, r, a) => {
    p.ellipse(8, 8, 6.4, 6.4).minus().ellipse(8, 8, 3.4, 3.4).fill(r, { mode: 'sphere' });
    p.ellipse(8, 8, 3.4, 3.4).fill(a, { mode: 'flat', tone: 1, inner: false });
    p.px(8, 8, 0xffffff).px(10, 5, 0xffffff);
  },
  thorn: (p, r, a) => {
    p.capsule(3, 14, 13, 2, 1.5, 1.2).fill(r, { mode: 'cyl', light: 0.15 });
    for (const [x, y, dx, dy] of [[5, 11, -2, -1], [7, 9, 2, 1], [9, 6, -2, -1], [11, 4, 2, 1]] as const) {
      p.poly([x, y, x + dx * 1.4, y + dy * 1.4 - 1, x + 0.6, y - 1.2]);
    }
    p.fill(a, { mode: 'emboss' });
  },
  shield: (p, r, a) => {
    p.poly([3, 2.5, 13, 2.5, 13, 8, 8, 14.5, 3, 8]).fill(a, { mode: 'emboss' });
    p.poly([4.6, 4, 11.4, 4, 11.4, 7.8, 8, 12.4, 4.6, 7.8]).fill(r, { mode: 'emboss', inner: false });
    p.px(8, 7, a[3]!);
  },
  blade: (p, r, a) => {
    p.poly([3.5, 12.5, 11, 2.5, 13.5, 3.5, 13, 6, 5.2, 13.6]).fill(r, { mode: 'emboss', light: 0.1 });
    p.capsule(2.5, 11, 5.5, 14, 1, 1).fill(a, { mode: 'cyl' });
    p.line(5, 12, 12, 3).fill([0xffffff, 0xffffff, 0xffffff, 0xffffff], { mode: 'flat', inner: false });
  },
  banner: (p, r, a) => {
    p.capsule(4, 15, 4, 1.5, 0.8, 0.8).fill(a, { mode: 'cyl' });
    p.poly([4.5, 2.5, 13, 2.5, 11, 6, 13, 9.5, 4.5, 9.5]).fill(r, { mode: 'emboss', dither: true });
    p.px(4, 1, a[3]!);
  },
  slam: (p, r, a) => {
    p.ellipse(8, 11, 7, 3).minus().ellipse(8, 11, 4.4, 1.6).fill(r, { mode: 'emboss' });
    p.capsule(8, 2, 8, 9, 1.6, 2.4).fill(a, { mode: 'cyl' });
    p.px(3, 7, r[3]!).px(13, 7, r[3]!);
  },
  cleave: (p, r) => {
    for (let k = 0; k <= 14; k++) {
      const ang = -2.2 + (k / 14) * 2.6;
      p.circle(8 + Math.cos(ang) * 5.5, 9 + Math.sin(ang) * 5.5, 0.8 + k * 0.08);
    }
    p.fill(r, { mode: 'emboss' });
  },
  flame: (p, r) => {
    p.poly([8, 1.5, 12.5, 8, 12, 12, 8, 14.5, 4, 12, 3.5, 8, 6, 5, 7, 8]).fill(r, { mode: 'emboss', light: 0.1 });
    p.poly([8, 7, 10, 11, 8, 13, 6, 11]).fill(M.ember, { mode: 'flat', tone: 3, inner: false });
  },
  rift: (p, r, a) => {
    p.ellipse(8, 8, 3.6, 6.8).fill(a, { mode: 'sphere' });
    p.ellipse(8, 8, 1.6, 5).fill(r, { mode: 'flat', tone: 3, inner: false });
    p.px(8, 8, 0xffffff).px(3, 4, a[3]!).px(13, 12, a[3]!);
  },
  star: (p, r) => {
    const pts: number[] = [];
    for (let k = 0; k < 10; k++) {
      const ang = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const rad = k % 2 ? 2.8 : 6.8;
      pts.push(8 + Math.cos(ang) * rad, 8.4 + Math.sin(ang) * rad);
    }
    p.poly(pts).fill(r, { mode: 'facet', facets: 5, rot: -Math.PI / 2 });
  },
  wind: (p, r) => {
    for (const [y, x0, x1] of [[5, 2, 11], [8.5, 4, 14], [12, 2, 10]] as const) p.capsule(x0, y, x1, y, 0.9, 0.9);
    p.circle(11.5, 4, 1.6).circle(10.5, 11, 1.6);
    p.fill(r, { mode: 'emboss' });
  },
  heart: (p, r) => {
    p.circle(5.5, 6, 3.2).circle(10.5, 6, 3.2).poly([2.4, 7, 13.6, 7, 8, 14]).fill(r, { mode: 'sphere', cy: 7 });
    p.px(4, 5, 0xffffff);
  },
  leaf: (p, r, a) => {
    p.poly([3, 13, 4, 6, 9, 2.5, 13.5, 3, 12, 8, 7, 12.5]).fill(r, { mode: 'emboss' });
    p.line(3.5, 12.5, 11, 5).fill(a, { mode: 'flat', tone: 1, inner: false });
  },
  rune: (p, r, a) => {
    p.poly([8, 1.5, 13.5, 5, 13.5, 11, 8, 14.5, 2.5, 11, 2.5, 5]).fill(r, { mode: 'emboss' });
    p.line(8, 4, 8, 12).line(5.5, 6.5, 10.5, 9.5).line(5.5, 9.5, 10.5, 6.5).fill(a, { mode: 'flat', tone: 3, glow: a[3]!, inner: false });
  },
  skullHeart: (p, r, a) => {
    p.circle(5.5, 7, 3).circle(10.5, 7, 3).poly([2.6, 8, 13.4, 8, 8, 14]).fill(r, { mode: 'sphere', cy: 8 });
    p.poly([3, 4, 1.5, 0.8, 5, 3]).poly([13, 4, 14.5, 0.8, 11, 3]).fill(a, { mode: 'emboss' });
  },
  fang: (p, r) => {
    p.poly([3, 3, 7, 3, 5, 13]).poly([9, 3, 13, 3, 11, 13]).fill(r, { mode: 'emboss', light: 0.15 });
    p.rect(2, 2, 12, 2).fill(M.crimson, { mode: 'emboss' });
  },
  boot: (p, r, a) => {
    p.poly([4, 2, 9, 2, 9, 9, 13.5, 11, 13.5, 14, 4, 14]).fill(r, { mode: 'emboss' });
    p.poly([9, 4, 14, 2, 12, 6]).fill(a, { mode: 'emboss', inner: false });
  },
  arrows: (p, r) => {
    for (const y of [4, 8, 12]) {
      p.capsule(2, y, 11, y, 0.6, 0.6);
      p.poly([10, y - 2.4, 14.5, y, 10, y + 2.4]);
    }
    p.fill(r, { mode: 'emboss' });
  },
  trophy: (p, r) => {
    p.poly([3.5, 2, 12.5, 2, 11.5, 7.5, 8, 9.5, 4.5, 7.5]).fill(r, { mode: 'sphere', cy: 4 });
    p.rect(7, 9, 2, 3).rect(4.5, 12, 7, 2.5).fill(r, { mode: 'emboss', light: -0.15 });
    p.px(6, 4, 0xffffff);
  },
  crosshair: (p, r, a) => {
    p.circle(8, 8, 5.6).minus().circle(8, 8, 4).fill(r, { mode: 'emboss' });
    p.rect(7.5, 1, 1, 4).rect(7.5, 11, 1, 4).rect(1, 7.5, 4, 1).rect(11, 7.5, 4, 1).fill(a, { mode: 'flat', tone: 3, inner: false });
    p.px(8, 8, 0xffffff);
  },
  cross: (p, r) => {
    p.rect(6, 2, 4, 12).rect(2, 6, 12, 4).fill(r, { mode: 'emboss', light: 0.1 });
  },
  bubble: (p, r) => {
    p.circle(8, 8, 6.4).minus().circle(8, 8, 4.8).fill(r, { mode: 'emboss' });
    p.circle(8, 8, 4.8).fill(r, { mode: 'flat', tone: 1, alpha: 110, inner: false });
    p.px(5, 5, 0xffffff).px(6, 4, 0xffffff);
  },
  mana: (p, r) => {
    p.poly([8, 1.5, 12, 7, 8, 14.5, 4, 7]).fill(r, { mode: 'facet', facets: 4, rot: Math.PI / 4, glow: r[3]! });
  },
  regen: (p, r, a) => {
    motifs['leaf']!(p, r, a);
    p.poly([11, 9, 15, 13, 11, 13]).fill(a, { mode: 'flat', tone: 3, inner: false });
  },
  heartPlus: (p, r, a) => {
    motifs['heart']!(p, r, a);
    p.rect(11, 9, 4, 1).rect(12.5, 7.5, 1, 4).fill([0xffffff, 0xffffff, 0xffffff, 0xffffff], { mode: 'flat', inner: false });
  },
};

// ---------------------------------------------------------------- plates & accents

function plate(p: Painter, ramp: Ramp, shape: 'round' | 'hex' | 'crest', border?: Ramp): void {
  if (shape === 'hex') p.poly([8, 0.5, 15, 4.2, 15, 11.8, 8, 15.5, 1, 11.8, 1, 4.2]);
  else if (shape === 'crest') p.poly([1.5, 1, 14.5, 1, 14.5, 9, 8, 15.5, 1.5, 9]);
  else p.rect(1, 2, 14, 12).rect(2, 1, 12, 14);
  p.fill(border ?? [ramp[0]!, ramp[0]!, ramp[1]!, ramp[1]!], { mode: 'emboss' });
  if (shape === 'hex') p.poly([8, 2, 13.6, 5, 13.6, 11, 8, 14, 2.4, 11, 2.4, 5]);
  else if (shape === 'crest') p.poly([3, 2.5, 13, 2.5, 13, 8.6, 8, 13.6, 3, 8.6]);
  else p.rect(2, 3, 12, 10).rect(3, 2, 10, 12);
  p.fill([mix(ramp[0]!, 0x0c0820, 0.4), mix(ramp[0]!, 0x0c0820, 0.2), ramp[0]!, ramp[1]!], { mode: 'emboss', inner: false, light: -0.25 });
}

function accentGlyph(p: Painter, k: number, col: number): void {
  const a = (x: number, y: number): void => {
    p.px(x, y, col);
  };
  switch (k) {
    case 1: // plus
      a(13, 1); a(12, 2); a(13, 2); a(14, 2); a(13, 3);
      break;
    case 2: // chevron up
      a(13, 1); a(12, 2); a(14, 2); a(11, 3); a(15, 3);
      break;
    case 3: // ring
      a(13, 1); a(12, 2); a(14, 2); a(13, 3);
      break;
    case 4: // double pip
      a(12, 2); a(14, 2); a(12, 3); a(14, 3);
      break;
    case 5: // star
      a(13, 0); a(12, 1); a(13, 1); a(14, 1); a(11, 2); a(13, 2); a(15, 2); a(13, 3);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- extra motifs (data-driven branches, families, emblems)

const WHITE: Ramp = [0xffffff, 0xffffff, 0xffffff, 0xffffff];
const DARK: Ramp = [0x0c0820, 0x16102c, 0x201838, 0x2a2044];

Object.assign(motifs, {
  shadow: (p, r, a) => {
    p.circle(7, 7.5, 5.8).minus().circle(9.8, 5.8, 4.8).fill(r, { mode: 'sphere', cx: 4, cy: 7 });
    p.poly([8.6, 13.2, 13.4, 3.6, 14.6, 4.4, 9.8, 13.8]).fill(a, { mode: 'emboss', light: 0.15 });
    p.capsule(7.6, 12.6, 10.6, 14.2, 0.8, 0.8).fill(M.leather, { mode: 'cyl', inner: false });
  },
  chevrons: (p, r, a) => {
    for (const x of [2, 8]) p.poly([x, 2.5, x + 3, 2.5, x + 6.5, 8, x + 3, 13.5, x, 13.5, x + 3.5, 8]);
    p.fill(r, { mode: 'emboss', light: 0.15 });
    p.px(1, 8, a[3]!);
  },
  turret: (p, r, a) => {
    p.line(8, 10, 3.5, 14.5).line(8, 10, 12.5, 14.5).line(8, 10, 8, 14.5).fill(a, { mode: 'flat', tone: 2 });
    p.rect(3.5, 4.5, 8, 6).fill(r, { mode: 'emboss' });
    p.rect(11, 6.2, 4.4, 2.2).fill(M.iron, { mode: 'cyl' });
    p.circle(7, 7.5, 1.3).fill(M.cyan, { mode: 'flat', tone: 3, glow: M.cyan[3]!, inner: false });
  },
  bomb: (p, r, a) => {
    p.circle(7.5, 9.5, 5.1).fill(r, { mode: 'sphere', light: 0.1 });
    p.rect(6, 3.2, 3, 2.2).fill(a, { mode: 'emboss' });
    p.capsule(8.8, 3.4, 11.2, 1.8, 0.5, 0.5).fill(M.wood, { mode: 'flat', tone: 3, inner: false });
    p.px(12, 1, 0xffffff).px(13, 1, M.ember[3]!).px(12, 0, M.ember[2]!).px(11, 1, M.ember[3]!).px(12, 2, M.ember[2]!);
    p.px(5, 7, 0xffffff);
  },
  gear: (p, r, a) => {
    const pts: number[] = [];
    for (let k = 0; k < 32; k++) {
      const ang = (k / 32) * Math.PI * 2;
      const rad = k % 4 < 2 ? 6.4 : 4.4;
      pts.push(8 + Math.cos(ang) * rad, 8 + Math.sin(ang) * rad);
    }
    p.poly(pts).minus().circle(8, 8, 2).fill(r, { mode: 'emboss', light: 0.05 });
    p.circle(8, 8, 3).minus().circle(8, 8, 1.8).fill(a, { mode: 'flat', tone: 2, inner: false });
  },
  plague: (p, r, a) => {
    p.circle(5, 9, 3.4).circle(10.6, 8.6, 3.8).circle(8, 5.4, 3.2).circle(8, 11.2, 3).fill(r, { mode: 'sphere', dither: true });
    for (const [x, y] of [[5, 9], [10, 7], [8, 11], [7, 5]] as const) p.px(x, y, a[0]!);
    p.px(6, 4, 0xffffff).px(12, 6, r[4] ?? 0xffffff);
  },
  wisp: (p, r) => {
    p.circle(8, 6.5, 4.3).poly([3.8, 7, 12.2, 7, 10.4, 11, 6.2, 15, 7, 11]).fill(r, { mode: 'sphere', cy: 5, glow: r[3]! });
    p.px(6, 6, PALETTES.outline).px(10, 6, PALETTES.outline).px(6, 7, PALETTES.outline).px(10, 7, PALETTES.outline);
  },
  snowflake: (p, r) => {
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI + Math.PI / 2;
      p.capsule(8 - Math.cos(ang) * 5.6, 8 - Math.sin(ang) * 5.6, 8 + Math.cos(ang) * 5.6, 8 + Math.sin(ang) * 5.6, 0.75, 0.75);
    }
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + Math.PI / 2;
      p.circle(8 + Math.cos(ang) * 6, 8 + Math.sin(ang) * 6, 1.1);
    }
    p.fill(r, { mode: 'flat', tone: 3, glow: r[3]! });
    p.circle(8, 8, 2).fill(r, { mode: 'sphere', light: 0.2, inner: false });
  },
  shards: (p, r) => {
    p.poly([6, 1.5, 9.5, 5, 7, 9, 3.8, 6]).poly([10, 6, 14.5, 8, 11.5, 12.5, 8.8, 9.4]).poly([3, 10, 7, 11, 5.4, 15, 1.8, 13]).fill(r, { mode: 'facet', facets: 3, light: 0.1 });
    p.px(8, 9, 0xffffff).px(11, 4, 0xffffff).px(2, 8, r[3]!);
  },
  feather: (p, r, a) => {
    p.poly([3, 14, 4.6, 9, 9, 4, 13.8, 1.4, 12.4, 6.4, 8, 11]).fill(r, { mode: 'emboss', dither: true });
    p.line(2.5, 14.5, 12.5, 3).fill(a, { mode: 'flat', tone: 3, inner: false });
  },
  sun: (p, r) => {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
      p.poly([8 + Math.cos(ang - 0.28) * 4, 8 + Math.sin(ang - 0.28) * 4, 8 + Math.cos(ang) * 7.2, 8 + Math.sin(ang) * 7.2, 8 + Math.cos(ang + 0.28) * 4, 8 + Math.sin(ang + 0.28) * 4]);
    }
    p.fill(r, { mode: 'flat', tone: 2 });
    p.circle(8, 8, 3.9).fill(r, { mode: 'sphere', glow: r[3]!, light: 0.2 });
  },
  hammer: (p, r, a) => {
    p.capsule(3.6, 14, 10, 6.2, 0.9, 0.9).fill(a, { mode: 'cyl' });
    p.poly([8.2, 0.4, 15.2, 5.8, 12.6, 9.2, 5.6, 3.8]).fill(r, { mode: 'sphere', light: 0.3 });
    p.line(9.5, 2.2, 13.6, 5.6).fill(r, { mode: 'flat', tone: 3, inner: false });
  },
  skull: (p, r, a) => {
    p.circle(8, 7, 5.3).rect(5, 10, 6, 4).fill(r, { mode: 'sphere', cy: 6 });
    p.ellipse(5.9, 7.6, 1.5, 1.8).ellipse(10.1, 7.6, 1.5, 1.8).fill(a, { mode: 'flat', tone: 2, glow: a[3]!, inner: false });
    p.px(8, 10, PALETTES.outline).px(6, 13, PALETTES.outline).px(8, 13, PALETTES.outline).px(10, 13, PALETTES.outline);
  },
  axe: (p, r, a) => {
    p.capsule(8, 15, 8, 1.6, 0.9, 0.9).fill(a, { mode: 'cyl' });
    p.poly([8, 3, 13.4, 1.4, 14.6, 6, 13.4, 10.6, 8, 9]).poly([8, 3, 2.6, 1.4, 1.4, 6, 2.6, 10.6, 8, 9]).fill(r, { mode: 'emboss', light: 0.1 });
    p.line(13.8, 2.6, 13.8, 9.4).line(2.2, 2.6, 2.2, 9.4).fill(WHITE, { mode: 'flat', inner: false, alpha: 200 });
  },
  paw: (p, r) => {
    p.ellipse(8, 10.6, 3.9, 3.3).fill(r, { mode: 'sphere' });
    p.ellipse(3.5, 6.6, 1.7, 2.1).ellipse(6.4, 3.6, 1.7, 2.1).ellipse(9.6, 3.6, 1.7, 2.1).ellipse(12.5, 6.6, 1.7, 2.1).fill(r, { mode: 'sphere' });
  },
  meteor: (p, r, a) => {
    p.poly([1, 1.5, 10, 8, 7.5, 10.5]).poly([0.5, 6, 8.5, 10, 6, 11]).poly([5, 0.5, 11, 6.5, 9, 8]).fill(r, { mode: 'flat', tone: 3, inner: false, alpha: 230 });
    p.circle(10.6, 10.6, 4).fill(a, { mode: 'sphere' });
    p.px(9, 9, r[4] ?? 0xffffff).px(12, 12, a[0]!);
  },
  moon: (p, r) => {
    p.circle(7.4, 8, 6.2).minus().circle(10.6, 6.4, 5.2).fill(r, { mode: 'sphere', cx: 4, cy: 7, glow: r[3]! });
    p.px(12, 11, 0xffffff).px(13, 3, r[3]!).px(11, 13, r[3]!);
  },
  eye: (p, r, a) => {
    p.poly([1.2, 8, 5, 3.8, 11, 3.8, 14.8, 8, 11, 12.2, 5, 12.2]).fill(a, { mode: 'emboss' });
    p.circle(8, 8, 3.2).fill(r, { mode: 'sphere', glow: r[3]!, inner: false });
    p.px(8, 6, PALETTES.outline).px(8, 7, PALETTES.outline).px(8, 8, PALETTES.outline).px(8, 9, PALETTES.outline);
  },
  phoenix: (p, r, a) => {
    p.poly([8, 5, 15, 1.5, 12.6, 7, 9, 9.5]).poly([8, 5, 1, 1.5, 3.4, 7, 7, 9.5]).fill(r, { mode: 'emboss', dither: true });
    p.poly([6.4, 6, 9.6, 6, 9.2, 11, 8, 15, 6.8, 11]).fill(a, { mode: 'emboss', light: 0.2 });
    p.circle(8, 4.4, 1.7).fill(a, { mode: 'sphere' });
  },
  antlers: (p, r, a) => {
    p.capsule(6, 14, 6, 9, 0.8, 0.8).capsule(10, 14, 10, 9, 0.8, 0.8).capsule(6, 9, 3, 4, 0.8, 0.6).capsule(10, 9, 13, 4, 0.8, 0.6);
    p.capsule(4.4, 6.4, 1.6, 6, 0.6, 0.5).capsule(11.6, 6.4, 14.4, 6, 0.6, 0.5).capsule(3, 4, 3.6, 1.2, 0.6, 0.4).capsule(13, 4, 12.4, 1.2, 0.6, 0.4);
    p.fill(a, { mode: 'emboss' });
    p.poly([8, 7, 11, 11, 8, 15, 5, 11]).fill(r, { mode: 'emboss', light: 0.1 });
  },
  bow: (p, r, a) => {
    for (let k = 0; k < 12; k++) {
      const t0 = -1 + (k / 12) * 2;
      const t1 = -1 + ((k + 1) / 12) * 2;
      p.capsule(4 + 4 * (1 - t0 * t0), 8 + t0 * 6.6, 4 + 4 * (1 - t1 * t1), 8 + t1 * 6.6, 0.9, 0.9);
    }
    p.fill(r, { mode: 'cyl' });
    p.line(4, 1.4, 4, 14.6).fill(WHITE, { mode: 'flat', inner: false, alpha: 220 });
    p.line(3, 8, 14, 8).fill(a, { mode: 'flat', tone: 3, inner: false });
    p.poly([12, 6, 15, 8, 12, 10]).fill(M.silver, { mode: 'emboss', inner: false });
  },
  crossedBlades: (p, r, a) => {
    p.poly([2.6, 12.4, 11.4, 1.6, 13.4, 2.6, 4.4, 13.8]).poly([13.4, 12.4, 4.6, 1.6, 2.6, 2.6, 11.6, 13.8]).fill(r, { mode: 'emboss', light: 0.15 });
    p.capsule(2, 11, 5, 14.4, 0.9, 0.9).capsule(14, 11, 11, 14.4, 0.9, 0.9).fill(a, { mode: 'cyl' });
  },
  crossedAxes: (p, r, a) => {
    p.capsule(3, 14, 12.6, 2.6, 0.8, 0.8).capsule(13, 14, 3.4, 2.6, 0.8, 0.8).fill(a, { mode: 'cyl' });
    p.poly([11, 2, 15, 0.8, 15, 6.4, 12.6, 5]).poly([5, 2, 1, 0.8, 1, 6.4, 3.4, 5]).fill(r, { mode: 'emboss', light: 0.1 });
  },
} satisfies Record<string, Motif>);

// ---------------------------------------------------------------- glyphs + colour helpers

/** Pixel glyph with a 1px dark backing so it reads over any plate. */
function glyph(buf: PixelBuffer, pts: readonly (readonly [number, number, number])[]): void {
  const own = new Set(pts.map(([x, y]) => y * N + x));
  for (const [x, y] of pts)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (buf.inside(nx, ny) && !own.has(ny * N + nx)) buf.set(nx, ny, PALETTES.outline);
    }
  for (const [x, y, c] of pts) buf.set(x, y, c);
}

function hexColor(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? parseInt(m[1]!, 16) : fallback;
}

/** 5-tone ramp around a base colour (shadows toward indigo, lights toward white). */
function rampFrom(c: number): Ramp {
  return [mix(c, 0x0c0820, 0.72), mix(c, 0x0c0820, 0.42), c, lighten(c, 0.45), lighten(c, 0.82)];
}

/** Dark plate ramp tinted by a colour. */
function plateFrom(c: number): Ramp {
  return [mix(c, 0x0c0820, 0.84), mix(c, 0x0c0820, 0.76), mix(c, 0x0c0820, 0.68), mix(c, 0x0c0820, 0.56)];
}

/** Keyword -> motif table used for unknown branches / families and for per-node motif variety. */
const KEYWORD_MOTIFS: readonly [RegExp, string][] = [
  [/turret|tesla|sentry/, 'turret'],
  [/bomb|grenade|mine|ordnance|explo|mortar|barrage/, 'bomb'],
  [/clock|gear|drone|overclock|steam|cog/, 'gear'],
  [/shadow|stealth|backstab|clone|vanish|umbral/, 'shadow'],
  [/wraith|spirit|soul|ghost|wisp|banshee|haunt/, 'wisp'],
  [/plague|rot|pestil|miasma|blight|contagi/, 'plague'],
  [/venom|poison|toxin/, 'plague'],
  [/blood|drain|sanguine|lifesteal|leech|hemo/, 'drop'],
  [/skull|death|execut|doom|grave|reaper|undying/, 'skull'],
  [/meteor|comet|cataclysm/, 'meteor'],
  [/fire|flame|ember|burn|inferno|blaze|pyre|ash/, 'flame'],
  [/frost|ice|freez|glacier|blizzard|snow|hail|cryo|chill|zero/, 'snowflake'],
  [/shatter|shard|splinter/, 'shards'],
  [/storm|lightning|bolt|shock|static|thunder|tesla|spark/, 'bolt'],
  [/rift|portal|gate|astral|void|gravity|phase|blink|warp/, 'rift'],
  [/arrow|volley|shot|quiver|multishot|ricochet/, 'arrows'],
  [/mark|aim|sniper|longshot|crosshair|focus/, 'crosshair'],
  [/hawk|feather|talon|wing/, 'feather'],
  [/hammer|smite|judg|condemn|gavel/, 'hammer'],
  [/radian|holy|sun|consecrat|blind|dawn|sanct/, 'sun'],
  [/axe|carnage|whirl|chop|cleav/, 'axe'],
  [/wolf|beast|bear|ursa|pounce|pack|fang|howl|hunt/, 'paw'],
  [/thorn|bramble|briar|spine|barb/, 'thorn'],
  [/root|grove|bloom|bark|vine|leaf|seed|sprout/, 'sprout'],
  [/heal|mend|renew|restor/, 'heartPlus'],
  [/banner|rally|warcry|cry|shout|roar|standard/, 'banner'],
  [/quake|leap|slam|earth|tremor/, 'slam'],
  [/shield|guard|ward|aegis|bulwark|barrier|dome|vow|armor|barkskin/, 'shield'],
  [/blade|edge|crit|slash|cut|bleed|strike|riposte|parry|duel/, 'blade'],
  [/combo|tempo|momentum|haste|rush|frenzy|rage|fury/, 'chevrons'],
  [/time|temporal|moment|tomorrow|hour/, 'hourglass'],
  [/mirror|prism|reflect/, 'mirror'],
  [/moon|lunar|night/, 'moon'],
  [/hex|curse|eye|omen/, 'eye'],
  [/phoenix|rebirth|rise/, 'phoenix'],
  [/gold|coin|gild|wealth/, 'coin'],
  [/horde|swarm|legion|army/, 'heads'],
];

function keywordMotif(text: string): string | null {
  const t = text.toLowerCase();
  for (const [re, m] of KEYWORD_MOTIFS) if (re.test(t)) return m;
  return null;
}

const DAMAGE_STYLE: Record<string, [string, Ramp]> = {
  physical: ['blade', M.steel],
  ember: ['flame', M.ember],
  frost: ['snowflake', M.glassCyan],
  storm: ['bolt', M.yellow],
  decay: ['plague', M.lime],
  astral: ['rift', M.violet],
};

// ---------------------------------------------------------------- content registry (injected; keeps this module pure)

export interface IconNodeDef {
  id: string;
  classId: string;
  branch: string;
  name: string;
  tier: number;
  excludes?: readonly string[];
  modifiers: readonly unknown[];
  grantsSkill?: string;
  mechanics: readonly string[];
}
export interface IconSkillDef {
  id: string;
  classId: string;
  name: string;
  damageType: string;
  shape: { kind: string };
}
export interface IconClassDef {
  id: string;
  accent: string;
  branches: readonly { id: string; name: string; theme: string }[];
}
export interface IconCardDef {
  id: string;
  name: string;
  family: string;
  rarity?: string;
}
export interface IconContent {
  nodes?: readonly IconNodeDef[];
  skills?: readonly IconSkillDef[];
  classes?: readonly IconClassDef[];
  cards?: readonly IconCardDef[];
  families?: Readonly<Record<string, { name: string; color: string }>>;
}

const reg = {
  nodes: new Map<string, IconNodeDef>(),
  skills: new Map<string, IconSkillDef>(),
  classes: new Map<string, IconClassDef>(),
  cards: new Map<string, IconCardDef>(),
  families: {} as Readonly<Record<string, { name: string; color: string }>>,
  /** skill id -> node that grants it */
  skillNode: new Map<string, IconNodeDef>(),
  /** `${classId}/${branch}` -> first skill granted in that branch */
  branchSkill: new Map<string, IconSkillDef>(),
  /** card id -> index within its family (content order) */
  familyIndex: new Map<string, number>(),
};

/**
 * Register game content so node / card / class icons can be derived from data (the React wrapper and the
 * asset validator call this; the art preview may register a JSON snapshot). Safe to call repeatedly.
 */
export function registerIconContent(c: IconContent): void {
  for (const n of c.nodes ?? []) reg.nodes.set(n.id, n);
  for (const s of c.skills ?? []) reg.skills.set(s.id, s);
  for (const k of c.classes ?? []) reg.classes.set(k.id, k);
  if (c.families) reg.families = { ...reg.families, ...c.families };
  const famCount = new Map<string, number>();
  for (const cd of reg.cards.values()) famCount.set(cd.family, Math.max(famCount.get(cd.family) ?? 0, (reg.familyIndex.get(cd.id) ?? -1) + 1));
  for (const cd of c.cards ?? []) {
    if (!reg.cards.has(cd.id)) {
      const k = famCount.get(cd.family) ?? 0;
      reg.familyIndex.set(cd.id, k);
      famCount.set(cd.family, k + 1);
    }
    reg.cards.set(cd.id, cd);
  }
  reg.skillNode.clear();
  reg.branchSkill.clear();
  for (const n of reg.nodes.values()) {
    if (!n.grantsSkill) continue;
    if (!reg.skillNode.has(n.grantsSkill)) reg.skillNode.set(n.grantsSkill, n);
    const sk = reg.skills.get(n.grantsSkill);
    const key = `${n.classId}/${n.branch}`;
    if (sk && !reg.branchSkill.has(key)) reg.branchSkill.set(key, sk);
  }
  cache.clear();
}

// ---------------------------------------------------------------- cards

const FAMILY_STYLE: Record<CardFamily, { motif: string; ramp: Ramp; accent: Ramp; plate: Ramp; alt: Ramp }> = {
  blood: { motif: 'drop', ramp: M.crimson, accent: M.gold, plate: [0x2a0818, 0x4a1028, 0x5a1430, 0x7a1c40], alt: M.magenta },
  glass: { motif: 'crystal', ramp: M.glassCyan, accent: M.silver, plate: [0x0a2240, 0x123a60, 0x184a78, 0x2060a0], alt: M.violet },
  tempo: { motif: 'bolt', ramp: M.yellow, accent: M.cyan, plate: [0x302008, 0x4a3410, 0x5a4214, 0x7a5a1c], alt: M.cyan },
  growth: { motif: 'sprout', ramp: M.moss, accent: M.wood, plate: [0x0c2414, 0x143820, 0x1a4828, 0x245c34], alt: M.lime },
  horde: { motif: 'heads', ramp: M.purple, accent: M.bone, plate: [0x1a0c2c, 0x2a1444, 0x341a54, 0x48246e], alt: M.bone },
  gold: { motif: 'coin', ramp: M.gold, accent: M.amberGold, plate: [0x2c1a08, 0x48300c, 0x5a3c10, 0x7a5418], alt: M.amberGold },
  titan: { motif: 'weight', ramp: M.darkSteel, accent: M.bronze, plate: [0x16142a, 0x24223e, 0x2e2c4e, 0x3c3a66], alt: M.steel },
  time: { motif: 'hourglass', ramp: M.cyan, accent: M.bronze, plate: [0x081c34, 0x0e2e50, 0x143c64, 0x1c5080], alt: M.violet },
  mirror: { motif: 'mirror', ramp: M.magenta, accent: M.silver, plate: [0x2a0a2a, 0x441444, 0x541a54, 0x6e246e], alt: M.glassCyan },
  decay: { motif: 'mushroom', ramp: M.lime, accent: M.bone, plate: [0x142008, 0x22340e, 0x2c4412, 0x3a5a18], alt: M.purple },
  transit: { motif: 'portal', ramp: M.violet, accent: M.cyan, plate: [0x140c34, 0x201450, 0x2a1a64, 0x382480], alt: M.cyan },
  thorn: { motif: 'thorn', ramp: M.moss, accent: M.crimson, plate: [0x1a1010, 0x2c1a18, 0x382220, 0x4a2c28], alt: M.steel },
};

/** Motifs for families added after the hand-made set (colours come from FAMILIES[family].color). */
const FAMILY_MOTIF: Record<string, [string, Ramp]> = {
  cataclysm: ['meteor', M.stone],
  storm: ['bolt', M.cyan],
  soul: ['wisp', M.arcane],
  doom: ['skull', M.crimson],
  moon: ['moon', M.silver],
  hex: ['eye', M.violet],
  phoenix: ['phoenix', M.gold],
};

const cardFamilyOf = new Map<string, [CardFamily, number]>();
for (const [fam, ids] of Object.entries(CARD_FAMILIES) as [CardFamily, readonly string[]][]) ids.forEach((id, k) => cardFamilyOf.set(id, [fam, k]));
for (const [id, fam] of Object.entries(EXTRA_CARD_FAMILIES)) cardFamilyOf.set(id, [fam, 2]);

const cache = new Map<string, PixelRect[]>();

function cached(key: string, gen: () => PixelRect[]): PixelRect[] {
  let v = cache.get(key);
  if (!v) {
    v = gen();
    cache.set(key, v);
  }
  return v;
}

function unknownRune(): PixelRect[] {
  return cached('rune:unknown', () => make((p) => motifs['rune']!(p, M.deepViolet, M.cyan)));
}

export function hasCardIcon(id: string): boolean {
  return cardFamilyOf.has(id) || reg.cards.has(id);
}

export function hasNodeIcon(id: string): boolean {
  return nodeBranchOf.has(id) || reg.nodes.has(id) || reg.skills.has(id);
}

export function cardFamily(id: string): CardFamily | null {
  const hm = cardFamilyOf.get(id)?.[0];
  if (hm) return hm;
  const f = reg.cards.get(id)?.family;
  return f && f in CARD_FAMILIES ? (f as CardFamily) : null;
}

/** Rarity mark in the top-left corner: rare = gold corner bracket, mythic = crimson gem with prismatic glints. */
function rarityMark(buf: PixelBuffer, rarity: string | undefined): void {
  if (rarity === 'rare') {
    glyph(buf, [
      [1, 1, 0xfff0b8],
      [2, 1, 0xe8c66a],
      [3, 1, 0xb08a3a],
      [1, 2, 0xe8c66a],
      [1, 3, 0xb08a3a],
    ]);
  } else if (rarity === 'mythic') {
    glyph(buf, [
      [2, 1, 0xff9ae6],
      [1, 2, 0x46d2ff],
      [2, 2, 0xff3d5a],
      [3, 2, 0xffdc3c],
      [2, 3, 0xb01a3a],
    ]);
    buf.set(3, 0, 0xffffff);
  }
}

/**
 * Card icon. Hand-made families keep their motif/plate (second card: alternate tint + gem). Other families
 * take a motif from FAMILY_MOTIF or the card name and colours from FAMILIES[family].color. Rarity adds a
 * gold corner (rare) or a crimson prismatic gem (mythic) top-left.
 */
export function cardIconPixels(cardId: string): PixelRect[] {
  const def = reg.cards.get(cardId);
  const hm = cardFamilyOf.get(cardId);
  if (!hm && !def) return unknownRune();
  const rarity = def?.rarity ?? 'common';
  return cached(`card:${cardId}:${rarity}`, () => {
    const buf = new PixelBuffer(N, N);
    const p = new Painter(buf);
    let gemK: number;
    let gemCol: number;
    if (hm || (def && def.family in FAMILY_STYLE)) {
      const fam = hm ? hm[0] : (def!.family as CardFamily);
      const k = hm ? hm[1] : reg.familyIndex.get(cardId) ?? 0;
      const st = FAMILY_STYLE[fam];
      plate(p, st.plate, 'round', rarity === 'mythic' ? M.crimson : rarity === 'rare' ? M.gold : undefined);
      motifs[st.motif]!(p, k % 2 === 1 ? st.alt : st.ramp, st.accent);
      gemK = k;
      gemCol = k % 2 === 0 ? st.accent[3]! : st.alt[3]!;
    } else {
      const fam = def!.family;
      const base = hexColor(reg.families[fam]?.color, 0x9a8aff);
      const fm = FAMILY_MOTIF[fam];
      const motif = fm?.[0] ?? keywordMotif(`${def!.name} ${reg.families[fam]?.name ?? fam}`) ?? 'rune';
      const k = reg.familyIndex.get(cardId) ?? 0;
      const ramp = rampFrom(k % 2 === 1 ? lighten(base, 0.18) : base);
      plate(p, plateFrom(base), 'round', rarity === 'mythic' ? M.crimson : rarity === 'rare' ? M.gold : undefined);
      motifs[motif]!(p, ramp, fm?.[1] ?? M.silver);
      gemK = k;
      gemCol = lighten(base, 0.5);
    }
    p.finish(PALETTES.outline, 0.7);
    // per-card corner gem (top-right) keeps siblings in a family distinct
    if (gemK === 2) {
      for (const [x, y] of [[13, 0], [12, 1], [13, 1], [14, 1], [13, 2]] as const) buf.set(x, y, 0xffffff);
    } else if (gemK % 2 === 1) {
      buf.set(13, 1, gemCol);
      buf.set(12, 2, gemCol);
      buf.set(14, 2, gemCol);
      buf.set(13, 3, gemCol);
      buf.set(13, 2, 0xffffff);
    } else if (gemK === 0) {
      buf.set(13, 2, gemCol);
      buf.set(13, 1, lighten(gemCol, 0.5));
    } else accentGlyph(p, (gemK % 4) + 2, gemCol);
    rarityMark(buf, rarity);
    return toRects(buf);
  });
}

// ---------------------------------------------------------------- nodes

type Branch = keyof typeof NODE_BRANCHES;

const BRANCH_STYLE: Record<Branch, { motif: string; ramp: Ramp; accent: Ramp; plate: Ramp }> = {
  guard: { motif: 'shield', ramp: M.teal, accent: M.gold, plate: [0x08262c, 0x0e3a42, 0x124650, 0x1a5c68] },
  strike: { motif: 'blade', ramp: M.steel, accent: M.gold, plate: [0x2a1a0c, 0x442a12, 0x523416, 0x6c461e] },
  rally: { motif: 'banner', ramp: M.crimson, accent: M.gold, plate: [0x2a0818, 0x420e26, 0x52122e, 0x6c1a3e] },
  earth: { motif: 'slam', ramp: M.amberGold, accent: M.gold, plate: [0x2c1a08, 0x48300c, 0x5a3c10, 0x7a5418] },
  cleave: { motif: 'cleave', ramp: M.gold, accent: M.steel, plate: [0x2a1a0c, 0x442a12, 0x523416, 0x6c461e] },
  fire: { motif: 'flame', ramp: M.ember, accent: M.gold, plate: [0x2c0c08, 0x481410, 0x581a14, 0x74241a] },
  storm: { motif: 'bolt', ramp: M.yellow, accent: M.violet, plate: [0x1a1034, 0x281a50, 0x322064, 0x422c80] },
  rift: { motif: 'rift', ramp: M.cyan, accent: M.violet, plate: [0x0a1a34, 0x102a50, 0x143464, 0x1c4480] },
  nova: { motif: 'star', ramp: M.magenta, accent: M.violet, plate: [0x1c0a30, 0x2c124a, 0x36165a, 0x481e76] },
  dodge: { motif: 'wind', ramp: M.cyan, accent: M.silver, plate: [0x0c2030, 0x14324a, 0x183e5a, 0x205076] },
  mDamage: { motif: 'blade', ramp: M.crimson, accent: M.gold, plate: [0x22101c, 0x381a2c, 0x442036, 0x5a2a48] },
  mHealth: { motif: 'heart', ramp: M.crimson, accent: M.pink, plate: [0x22101c, 0x381a2c, 0x442036, 0x5a2a48] },
  mRegen: { motif: 'leaf', ramp: M.moss, accent: M.lime, plate: [0x0c2414, 0x143820, 0x1a4828, 0x245c34] },
};

/** Content branch -> [motif, motif ramp, accent ramp] for all ten classes' trees. Plates take the class accent. */
const BRANCH_ART: Record<string, [string, Ramp, Ramp]> = {
  // vanguard
  bulwark: ['shield', M.teal, M.gold],
  cleaver: ['cleave', M.gold, M.steel],
  rally: ['banner', M.crimson, M.gold],
  // arcanist
  ember: ['flame', M.ember, M.gold],
  storm: ['bolt', M.yellow, M.violet],
  rift: ['rift', M.cyan, M.violet],
  // duelist
  edge: ['blade', M.steel, M.crimson],
  shadow: ['shadow', M.violet, M.silver],
  tempo: ['chevrons', M.crimson, M.yellow],
  // artificer
  turrets: ['turret', M.brass, M.iron],
  ordnance: ['bomb', M.iron, M.brass],
  clockwork: ['gear', M.bronze, M.teal],
  // hexbinder
  pestilence: ['plague', M.lime, M.plum],
  sanguine: ['drop', M.bloodRed, M.gold],
  wraithcall: ['wisp', M.arcane, M.violet],
  // cryomancer
  glacier: ['crystal', M.glassCyan, M.silver],
  blizzard: ['snowflake', M.cyan, M.white],
  shatter: ['shards', M.glassCyan, M.white],
  // ranger
  volley: ['arrows', M.wood, M.silver],
  marksman: ['crosshair', M.crimson, M.gold],
  wilds: ['feather', M.moss, M.bone],
  // templar
  radiance: ['sun', M.gold, M.white],
  judgment: ['hammer', M.silver, M.wood],
  aegis: ['shield', M.gold, M.silver],
  // berserker
  fury: ['skull', M.bone, M.crimson],
  carnage: ['axe', M.steel, M.wood],
  warcry: ['slam', M.bloodRed, M.amberGold],
  // warden
  grove: ['sprout', M.moss, M.wood],
  beast: ['paw', M.arcane, M.moss],
  thorns: ['thorn', M.moss, M.crimson],
};

/** UI accents for the ten classes (used when content is not registered, e.g. in the art preview). */
const CLASS_ACCENT: Record<string, number> = {
  vanguard: 0xe0a040,
  arcanist: 0x8a7aff,
  duelist: 0xd23a4e,
  artificer: 0x3cb4a0,
  hexbinder: 0x8fd14f,
  cryomancer: 0x7fe3ff,
  ranger: 0x6fa83c,
  templar: 0xf2d16b,
  berserker: 0xb3261e,
  warden: 0x6b8f3a,
};

function classAccent(classId: string): number {
  return hexColor(reg.classes.get(classId)?.accent, CLASS_ACCENT[classId] ?? 0x8a7aff);
}

const nodeBranchOf = new Map<string, [Branch, number]>();
for (const [br, ids] of Object.entries(NODE_BRANCHES) as [Branch, readonly string[]][]) ids.forEach((id, k) => nodeBranchOf.set(id, [br, k]));

type NodeKind = 'active' | 'augment' | 'stat';

/** Resolve the art for a content branch: explicit table, else the branch's skill (name keywords, damage type), else the theme. */
function branchArt(classId: string, branch: string): [string, Ramp, Ramp] {
  const known = BRANCH_ART[branch];
  if (known) return known;
  const sk = reg.branchSkill.get(`${classId}/${branch}`);
  const cls = reg.classes.get(classId);
  const br = cls?.branches.find((b) => b.id === branch);
  const dmg = sk ? DAMAGE_STYLE[sk.damageType] : undefined;
  const motif = (sk && keywordMotif(sk.name)) ?? keywordMotif(`${branch} ${br?.name ?? ''} ${br?.theme ?? ''}`) ?? dmg?.[0] ?? 'rune';
  const ramp = dmg?.[1] ?? rampFrom(classAccent(classId));
  return [motif, ramp, M.gold];
}

/** Kind glyph (top-right): active skill = white-cored gem, augment = hollow rune ring, stat = double chevron. */
function kindGlyph(buf: PixelBuffer, kind: NodeKind): void {
  if (kind === 'active') {
    glyph(buf, [
      [13, 1, M.amberGold[3]!],
      [12, 2, M.amberGold[2]!],
      [13, 2, 0xffffff],
      [14, 2, M.amberGold[3]!],
      [13, 3, M.amberGold[1]!],
    ]);
  } else if (kind === 'augment') {
    const c = M.cyan[3]!;
    glyph(buf, [
      [12, 1, c],
      [13, 1, c],
      [14, 1, c],
      [12, 2, c],
      [14, 2, c],
      [12, 3, M.cyan[2]!],
      [13, 3, M.cyan[2]!],
      [14, 3, M.cyan[2]!],
    ]);
  } else {
    const c = M.lime[3]!;
    glyph(buf, [
      [12, 2, c],
      [13, 1, c],
      [14, 2, c],
      [12, 4, M.lime[2]!],
      [13, 3, M.lime[2]!],
      [14, 4, M.lime[2]!],
    ]);
  }
}

/** Choice nodes (mutually exclusive): a forking split mark bottom-left. */
function forkGlyph(buf: PixelBuffer): void {
  const c = M.magenta[3]!;
  glyph(buf, [
    [2, 14, c],
    [2, 13, c],
    [1, 12, c],
    [3, 12, c],
    [1, 11, 0xffffff],
    [3, 11, 0xffffff],
  ]);
}

/** Tier 4 capstones: gold studs on the hex vertices. */
function ornate(buf: PixelBuffer): void {
  for (const [x, y] of [[8, 0], [14, 4], [14, 11], [8, 15], [1, 4], [1, 11]] as const) buf.set(x, y, M.gold[4]!);
  buf.set(7, 0, M.gold[3]!);
  buf.set(9, 0, M.gold[3]!);
}

function nodeKind(n: IconNodeDef): NodeKind {
  if (n.grantsSkill) return 'active';
  if (n.mechanics.length > 0) return 'augment';
  return 'stat';
}

/**
 * Node icon on a hex plate. Content nodes: branch motif (BRANCH_ART, or derived from the branch's skill /
 * theme for unknown branches; a strong keyword in the node name may pick a more specific motif) on a plate
 * tinted by the class accent, a kind glyph (active / augment / stat), a fork mark for choice nodes, a gold
 * rim from tier 3 and studs at tier 4. Skill ids resolve through the node that grants them. Hand-made
 * catalog ids keep their hand-drawn branch art.
 */
export function nodeIconPixels(nodeId: string): PixelRect[] {
  const hm = nodeBranchOf.get(nodeId);
  const skill = reg.skills.get(nodeId);
  const def = reg.nodes.get(nodeId) ?? (skill ? reg.skillNode.get(nodeId) : undefined);
  if (!hm && !def && !skill) return unknownRune();
  return cached(`node:${nodeId}`, () => {
    const buf = new PixelBuffer(N, N);
    const p = new Painter(buf);
    const kind: NodeKind = skill ? 'active' : def ? nodeKind(def) : 'stat';
    const tier = def?.tier ?? (hm && (hm[1] === 5 || NODE_BRANCHES[hm[0]].length === 1) ? 3 : 0);
    const rim = tier >= 4 ? M.amberGold : tier >= 3 ? M.gold : undefined;
    if (hm) {
      const st = BRANCH_STYLE[hm[0]];
      plate(p, st.plate, 'hex', rim);
      motifs[st.motif]!(p, st.ramp, st.accent);
    } else {
      const classId = def?.classId ?? skill!.classId;
      const [bMotif, ramp, accent] = def ? branchArt(def.classId, def.branch) : [DAMAGE_STYLE[skill!.damageType]?.[0] ?? 'rune', DAMAGE_STYLE[skill!.damageType]?.[1] ?? M.violet, M.gold];
      const named = keywordMotif(skill?.name ?? def?.name ?? '');
      const motif = named && named !== 'banner' && named !== 'chevrons' ? named : bMotif;
      plate(p, plateFrom(classAccent(classId)), 'hex', rim);
      motifs[motif]!(p, tier >= 3 ? (ramp.map((c) => lighten(c, 0.12)) as Ramp) : ramp, accent);
    }
    p.finish(PALETTES.outline, 0.7);
    if (def || skill) {
      kindGlyph(buf, kind);
      if (def?.excludes && def.excludes.length > 0) forkGlyph(buf);
      if (tier >= 4) ornate(buf);
    } else if (hm) {
      const capstone = tier >= 3;
      accentGlyph(p, hm[1], capstone ? M.gold[4]! : BRANCH_STYLE[hm[0]].accent[3]!);
    }
    return toRects(buf);
  });
}

// ---------------------------------------------------------------- fate mechanics (boon / bane keyword chips)

Object.assign(motifs, {
  burst: (p, r, a) => {
    const pts: number[] = [];
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2 - Math.PI / 2;
      const rad = k % 2 ? 3 : k % 4 === 0 ? 7 : 5.6;
      pts.push(8 + Math.cos(ang) * rad, 8 + Math.sin(ang) * rad);
    }
    p.poly(pts).fill(r, { mode: 'sphere', light: 0.15, glow: r[3]! });
    p.circle(8, 8, 2.2).fill(a, { mode: 'flat', tone: 3, inner: false });
  },
  echo: (p, r) => {
    for (const [rad, w] of [[6.4, 1], [4.4, 1], [2.2, 1.2]] as const) {
      for (let k = 0; k <= 10; k++) {
        const ang = -0.95 + (k / 10) * 1.9;
        p.circle(5 + Math.cos(ang) * rad, 8 + Math.sin(ang) * rad, w * 0.75);
      }
    }
    p.fill(r, { mode: 'flat', tone: 3, glow: r[3]! });
    p.circle(4, 8, 1.6).fill(r, { mode: 'sphere', inner: false });
  },
  scythe: (p, r, a) => {
    p.capsule(4, 15, 10.5, 2, 0.8, 0.8).fill(a, { mode: 'cyl' });
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const ang = -2.6 + t * 1.9;
      p.circle(4.6 + Math.cos(ang) * 6.4 + 6, 8.2 + Math.sin(ang) * 6.4, 1.6 - t * 1.2);
    }
    p.fill(r, { mode: 'emboss', light: 0.15 });
  },
} satisfies Record<string, Motif>);

/** Mechanic id -> [motif, accent ramp, fallback colour, kind]. Colours follow MECHANICS[*].color. */
const MECH_STYLE: Record<string, [string, Ramp, number, 'boon' | 'bane']> = {
  chain_reaction: ['burst', M.yellow, 0xff7a2a, 'boon'],
  vampiric_rite: ['fang', M.crimson, 0xe0315a, 'boon'],
  thunderous_blows: ['bolt', M.white, 0x8fd8ff, 'boon'],
  splitting_shots: ['arrows', M.white, 0xf2a6ff, 'boon'],
  bloodrush: ['drop', M.gold, 0xff5a4a, 'boon'],
  soul_harvest: ['wisp', M.white, 0x7ef0d0, 'boon'],
  echo: ['echo', M.white, 0x6aa8ff, 'boon'],
  executioner: ['axe', M.bone, 0xd8cdb4, 'boon'],
  phoenix: ['phoenix', M.yellow, 0xffa53a, 'boon'],
  static_trail: ['wind', M.white, 0x3fe0c5, 'boon'],
  retribution: ['thorn', M.crimson, 0xc9a36b, 'boon'],
  warding_rune: ['rune', M.white, 0x7fe8ff, 'boon'],
  volatile_dead: ['bomb', M.ember, 0xff6a2a, 'bane'],
  hexed_ground: ['eye', M.bone, 0x9b5cff, 'bane'],
  relentless: ['chevrons', M.white, 0xff3d3d, 'bane'],
  the_hunt: ['scythe', M.bone, 0xb8b0c8, 'bane'],
  blood_moon: ['moon', M.crimson, 0xff2a55, 'bane'],
  brittle: ['shards', M.white, 0xc6e6ff, 'bane'],
};

export const MECH_IDS: readonly string[] = Object.keys(MECH_STYLE);

const mechReg = new Map<string, { kind: string; color: string; name: string }>();

/** Register fate mechanics (colour + boon/bane) for data-driven keyword icons. */
export function registerMechanics(list: readonly { id: string; kind: string; color: string; name: string }[]): void {
  for (const m of list) mechReg.set(m.id, m);
  for (const k of [...cache.keys()]) if (k.startsWith('mech:')) cache.delete(k);
}

function mechId(id: string): string {
  return id.startsWith('mech:') ? id.slice(5) : id;
}

export function hasMechIcon(id: string): boolean {
  const k = mechId(id);
  return k in MECH_STYLE || mechReg.has(k);
}

/**
 * Keyword icon for a Fate mechanic: boons sit on a round badge with a bright rim, banes on a spiked
 * crimson-rimmed seal. Motif per mechanic (unknown ids: keyword match on the name), colour from the
 * mechanic's chip colour.
 */
export function mechIconPixels(id: string): PixelRect[] {
  const k = mechId(id);
  const st = MECH_STYLE[k];
  const def = mechReg.get(k);
  if (!st && !def) return unknownRune();
  return cached(`mech:${k}`, () => {
    const buf = new PixelBuffer(N, N);
    const p = new Painter(buf);
    const col = hexColor(def?.color, st?.[2] ?? 0x9a8aff);
    const bane = (def?.kind ?? st?.[3]) === 'bane';
    const motif = st?.[0] ?? keywordMotif(def?.name ?? k) ?? 'rune';
    if (bane) {
      const pts: number[] = [];
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2 + Math.PI / 16;
        const rad = i % 2 ? 6.4 : 7.8;
        pts.push(8 + Math.cos(ang) * rad, 8 + Math.sin(ang) * rad);
      }
      p.poly(pts).fill(M.bloodRed, { mode: 'emboss' });
      p.circle(8, 8, 5.9).fill([0x14060c, 0x1e0a14, 0x2a0e1c, 0x381424], { mode: 'emboss', inner: false, light: -0.2 });
    } else {
      p.circle(8, 8, 7.6).minus().circle(8, 8, 6).fill(rampFrom(lighten(col, 0.1)), { mode: 'emboss' });
      p.circle(8, 8, 6.2).fill([mix(col, 0x0c0820, 0.9), mix(col, 0x0c0820, 0.86), mix(col, 0x0c0820, 0.8), mix(col, 0x0c0820, 0.72)], { mode: 'emboss', inner: false, light: -0.2 });
    }
    p.finish(PALETTES.outline, 0.7);
    // motif painted on its own layer (no separation lines against the plate), outlined, then composited
    const layer = new PixelBuffer(N, N);
    const lp = new Painter(layer);
    motifs[motif]!(lp, rampFrom(lighten(col, 0.18)), st?.[1] ?? M.white);
    lp.finish(PALETTES.outline, 0.7);
    layer.drawTo(buf, 0, 0);
    if (bane) glyph(buf, [[13, 13, 0xff3d5a], [14, 14, 0xff3d5a], [12, 14, 0xb01a3a], [14, 12, 0xb01a3a]]);
    return toRects(buf);
  });
}

// ---------------------------------------------------------------- stats + class emblems

const STAT_STYLE: Record<string, [string, Ramp, Ramp]> = {
  damage: ['blade', M.steel, M.gold],
  health: ['heart', M.crimson, M.pink],
  recovery: ['heartPlus', M.crimson, M.pink],
  enemy_health: ['skullHeart', [0x2a0c1c, 0x5a1430, 0x8a1c44, 0xc0305a], M.bone],
  enemy_offense: ['fang', M.bone, M.crimson],
  mobility: ['boot', M.leather, M.cyan],
  projectiles: ['arrows', M.ember, M.gold],
  score: ['trophy', M.gold, M.amberGold],
  armor: ['shield', M.steel, M.darkSteel],
  crit: ['crosshair', M.crimson, M.gold],
  healing: ['cross', [0x0e4a28, 0x1c8a44, 0x3ad46a, 0xa8ffc0], M.moss],
  shield: ['bubble', M.cyan, M.cyan],
  resource: ['mana', M.violet, M.cyan],
  regen: ['regen', M.moss, M.lime],
};

export function statIconPixels(stat: string): PixelRect[] {
  const s = STAT_STYLE[stat];
  if (!s) return unknownRune();
  return cached(`stat:${stat}`, () => make((p) => motifs[s[0]]!(p, s[1], s[2])));
}

/** Class emblem (crest plate). All ten classes are hand-composed; unknown classes get a rune on their accent. */
export function classEmblemPixels(classId: string): PixelRect[] {
  const known = (CLASS_IDS as readonly string[]).includes(classId);
  if (!known && !reg.classes.has(classId)) return unknownRune();
  return cached(`class:${classId}`, () => {
    const buf = new PixelBuffer(N, N);
    const p = new Painter(buf);
    const acc = classAccent(classId);
    switch (classId) {
      case 'vanguard':
        plate(p, [0x08262c, 0x0e3a42, 0x124650, 0x1a5c68], 'crest', M.gold);
        // crossed cleaver over a tower shield
        p.poly([5, 4, 11, 4, 11, 9, 8, 12.5, 5, 9]).fill(M.teal, { mode: 'emboss' });
        p.poly([3.5, 12, 10.5, 3, 12.5, 4, 12, 6, 5, 13]).fill(M.steel, { mode: 'emboss', light: 0.1 });
        p.capsule(3, 11, 5.5, 13.5, 0.9, 0.9).fill(M.gold, { mode: 'cyl' });
        p.finish(PALETTES.outline, 0.7);
        buf.set(8, 7, M.gold[4]!);
        break;
      case 'arcanist':
        plate(p, [0x140c34, 0x201450, 0x2a1a64, 0x382480], 'crest', M.cyan);
        // pointed hat + floating prism
        p.poly([3, 11, 13, 11, 9.5, 9.5, 7, 3, 4.5, 4, 6.5, 9.5]).fill(M.violet, { mode: 'emboss', dither: true, light: 0.25 });
        p.rect(4, 10, 8, 1.6).fill(M.cyan, { mode: 'emboss', inner: false });
        p.poly([12, 2, 13.6, 4.4, 12, 6.8, 10.4, 4.4]).fill(M.glassCyan, { mode: 'facet', facets: 4, rot: Math.PI / 4, glow: M.magenta[3]! });
        p.finish(PALETTES.outline, 0.7);
        buf.set(6, 12, M.ember[3]!);
        buf.set(9, 12, M.ember[3]!);
        break;
      case 'duelist':
        plate(p, plateFrom(acc), 'crest', M.silver);
        motifs['crossedBlades']!(p, M.silver, M.crimson);
        p.finish(PALETTES.outline, 0.7);
        buf.set(8, 7, M.crimson[3]!);
        break;
      case 'hexbinder':
        plate(p, [0x160c1e, 0x22122e, 0x2c183c, 0x3a2050], 'crest', M.lime);
        // horned skull fetish with rot-green eyes
        p.poly([4, 5, 1.6, 1.4, 5.4, 3.6]).poly([12, 5, 14.4, 1.4, 10.6, 3.6]).fill(M.boneDry, { mode: 'emboss' });
        motifs['skull']!(p, M.boneDry, M.lime);
        p.finish(PALETTES.outline, 0.7);
        break;
      case 'artificer':
        plate(p, plateFrom(acc), 'crest', M.brass);
        motifs['gear']!(p, M.brass, M.bronze);
        p.circle(8, 8, 1.4).fill(M.teal, { mode: 'flat', tone: 3, glow: M.teal[3]!, inner: false });
        p.finish(PALETTES.outline, 0.7);
        break;
      case 'templar':
        plate(p, [0x2a2418, 0x3e3420, 0x4c402a, 0x5e5034], 'crest', M.gold);
        // halo behind an upright war hammer
        p.circle(8, 5.4, 4.4).minus().circle(8, 5.4, 3.2).fill(M.gold, { mode: 'flat', tone: 3, glow: M.gold[4]!, inner: false });
        p.capsule(8, 14, 8, 6, 0.9, 0.9).fill(M.wood, { mode: 'cyl' });
        p.rect(4, 3.6, 8, 3.4).fill(M.silver, { mode: 'emboss', light: 0.1 });
        p.rect(7, 3.6, 2, 3.4).fill(M.gold, { mode: 'emboss', inner: false });
        p.finish(PALETTES.outline, 0.7);
        break;
      case 'berserker':
        plate(p, plateFrom(acc), 'crest', M.iron);
        motifs['crossedAxes']!(p, M.steel, M.wood);
        p.finish(PALETTES.outline, 0.7);
        // war paint slashes
        buf.set(7, 10, M.bloodRed[3]!);
        buf.set(8, 11, M.bloodRed[3]!);
        buf.set(9, 10, M.bloodRed[3]!);
        break;
      case 'cryomancer':
        plate(p, plateFrom(acc), 'crest', M.white);
        motifs['snowflake']!(p, M.glassCyan, M.white);
        p.finish(PALETTES.outline, 0.7);
        break;
      case 'ranger':
        plate(p, plateFrom(acc), 'crest', M.wood);
        motifs['bow']!(p, M.wood, M.bone);
        p.finish(PALETTES.outline, 0.7);
        buf.set(2, 7, M.crimson[3]!);
        buf.set(2, 9, M.crimson[3]!);
        break;
      case 'warden':
        plate(p, plateFrom(acc), 'crest', M.moss);
        motifs['antlers']!(p, M.moss, M.boneDry);
        p.finish(PALETTES.outline, 0.7);
        buf.set(8, 11, M.lime[3]!);
        break;
      default: {
        plate(p, plateFrom(acc), 'crest', rampFrom(acc));
        motifs['rune']!(p, rampFrom(acc), M.white);
        p.finish(PALETTES.outline, 0.7);
      }
    }
    return toRects(buf);
  });
}

/** Debug helper: a hue-coded swatch (not used in UI). */
export function swatch(h: number): number {
  return hsv(h, 0.6, 1);
}
