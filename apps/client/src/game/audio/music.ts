/**
 * Music data + pure helpers (DOM-free: vitest and the art-preview build import this without WebAudio).
 *
 * Every dungeon theme owns a musical identity: key/mode, tempo, metre, drone timbre, pad, motif instrument,
 * percussion palette and patterns. Songs are built from layered stems that the director cross-fades by intensity:
 *   bed   (drone + pad + sparse calm percussion)     always
 *   motif (the theme's melodic figure)               always, denser as intensity rises
 *   bass  (ostinato)                                  from ~0.22
 *   perc  (combat percussion)                         from ~0.28
 *   heavy (lead + extra percussion)                   from ~0.64
 * Variation is seeded per bar (rngAt) so a loop never repeats exactly but co-op clients hear the same song.
 */

import type { AudioTheme } from './sfx';

// ------------------------------------------------------------------ scales

export const SCALES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  hungarianMinor: [0, 2, 3, 6, 7, 8, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;

/** MIDI note for a (possibly negative / >6) scale degree above `root`. */
export function degreeMidi(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const d = ((degree % n) + n) % n;
  return root + oct * 12 + (scale[d] as number);
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------ seeded variation

/** FNV-1a 32-bit string hash. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stateless deterministic random in [0, 1) for (seed, a, b). */
export function rngAt(seed: number, a: number, b = 0): number {
  let x = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

// ------------------------------------------------------------------ song specs

export type DroneKind = 'cello' | 'water' | 'hollow' | 'organ' | 'reed' | 'growl' | 'air' | 'ghost' | 'wind' | 'void' | 'hum';
export type PadKind = 'choir' | 'softTri' | 'whisperChoir' | 'organ' | 'woodwind' | 'lowBrass' | 'glass';
export type MotifKind = 'cello' | 'pluckEcho' | 'boneMarimba' | 'bells' | 'flute' | 'brassStab' | 'celesta' | 'harp' | 'theremin' | 'tollBell' | 'sonar' | 'arp';
export type BassKind = 'tri' | 'sub' | 'marimba' | 'pedal' | 'reed' | 'dist';
export type LeadKind = 'brass' | 'bowed' | 'choirFull' | 'reedDist' | 'tremolo';
/** Percussion voices: low drum, mid drum, theme accent, high ticker. */
export type PercVoice = 'low' | 'mid' | 'accent' | 'tick';
export type DrumKind = 'taiko' | 'muffled' | 'frame' | 'timpani' | 'log' | 'tom' | 'iceDrum' | 'hoof' | 'pulse';
export type ClickKind = 'chain' | 'drip' | 'bone' | 'bell' | 'bloop' | 'anvil' | 'glass' | 'shaker' | 'rattle' | 'insect' | 'hat' | 'ice' | 'whisper' | 'glitch' | 'blip';
/** Every DrumKind (the director routes percussion lines by it; the rest are clicks). */
export const DRUM_KINDS: readonly DrumKind[] = ['taiko', 'muffled', 'frame', 'timpani', 'log', 'tom', 'iceDrum', 'hoof', 'pulse'];

/** Motif note: [step in bar, degree relative to the bar's chord root, length in steps]. */
export type MotifNote = readonly [number, number, number];

/**
 * Pattern strings have one char per step: 'x' full hit, 'o' medium, 'g' ghost (played ~60% of bars), '.' rest.
 * calm = bed (exploration), combat = perc stem, heavy = heavy stem (adds on top of combat).
 */
export interface PercLine { kind: DrumKind | ClickKind; calm?: string; combat?: string; heavy?: string }

export interface SongSpec {
  id: string;
  root: number;
  scale: readonly number[];
  bpm: number;
  /** steps per bar: 16 (4/4 in sixteenths) or 12 (6/8 or 3/4) */
  steps: 12 | 16;
  /** chord roots (scale degrees) per bar; one progression is chosen per 8-bar section */
  progressions: readonly (readonly number[])[];
  /** add the 7th to pad chords */
  sevenths?: boolean;
  drone: DroneKind;
  pad: PadKind;
  motif: MotifKind;
  /** two-bar call/response figure (octave above the root) */
  motifA: readonly MotifNote[];
  motifB: readonly MotifNote[];
  /** motif octave offset in semitones from root (default +12) */
  motifOct?: number;
  bass: BassKind;
  /** bass rhythm: 'x' root, 'o' fifth, 'h' octave, '.' rest */
  bassPattern: string;
  lead: LeadKind;
  /** steps where the heavy lead may start a long note */
  leadSteps: readonly number[];
  perc: Partial<Record<PercVoice, PercLine>>;
  /** fill for the last quarter of a phrase-ending bar (mid drum), pattern over the whole bar */
  fill?: string;
  /** reverb send 0..1, echo send for the motif 0..1, master level for the song */
  reverb: number;
  echo: number;
  level: number;
  /** intensity floor (boss songs) and the number of intro bars before it applies */
  minIntensity?: number;
  introBars?: number;
  /** exploration motif density (chance per bar) */
  calmDensity?: number;
}

const S = SCALES;

export const THEME_SONGS: Record<AudioTheme, SongSpec> = {
  // low cello drones, distant choir pads, ritual frame drums and chains
  catacombs: {
    id: 'catacombs', root: 50, scale: S.aeolian, bpm: 70, steps: 16,
    progressions: [[0, 5, 3, 4], [0, 6, 5, 4], [0, 3, 0, 4], [5, 3, 6, 4], [0, 5, 6, 4]],
    drone: 'cello', pad: 'choir', motif: 'cello',
    motifA: [[0, 4, 6], [6, 3, 2], [8, 2, 6], [14, 1, 2]],
    motifB: [[0, 0, 4], [4, 2, 2], [6, 1, 2], [8, -1, 8]],
    bass: 'tri', bassPattern: 'x..x..x.x..o..x.',
    lead: 'brass', leadSteps: [0, 6, 10],
    perc: {
      low: { kind: 'taiko', calm: 'x...............', combat: 'x.......x.......', heavy: '....x.......x.xx' },
      mid: { kind: 'frame', combat: '......o......o..', heavy: '..g...o...g..o.g' },
      accent: { kind: 'chain', combat: '......x......x..', heavy: '...x.......x....' },
      tick: { kind: 'hat', combat: '..g...g...g...g.', heavy: '.g.g.g.g.g.g.g.g' },
    },
    fill: '............o.oo',
    reverb: 0.55, echo: 0.1, level: 1, calmDensity: 0.55,
  },
  // watery filtered plucks with dripping delays, muffled underwater drums
  flooded: {
    id: 'flooded', root: 52, scale: S.dorian, bpm: 76, steps: 16,
    progressions: [[0, 3, 0, 6], [0, 2, 3, 4], [5, 3, 0, 0], [0, 6, 3, 4]],
    drone: 'water', pad: 'softTri', motif: 'pluckEcho',
    motifA: [[0, 0, 2], [3, 2, 2], [6, 4, 2], [10, 7, 4]],
    motifB: [[0, 6, 2], [2, 4, 2], [6, 2, 3], [11, 1, 4]],
    bass: 'sub', bassPattern: 'x.....x...o.....',
    lead: 'bowed', leadSteps: [0, 8],
    perc: {
      low: { kind: 'muffled', combat: 'x.....x...x.....', heavy: '...x......x..x..' },
      accent: { kind: 'drip', calm: '......g.........', combat: '....x.......x...', heavy: '..g...g...g...g.' },
      tick: { kind: 'shaker', combat: '..o...o...o...o.', heavy: 'g.o.g.o.g.o.g.og' },
      mid: { kind: 'tom', heavy: '.......o.....o..' },
    },
    fill: '............g.oo',
    reverb: 0.6, echo: 0.55, level: 0.95, calmDensity: 0.6,
  },
  // bone percussion, whispers, hollow drone, phrygian
  ossuary: {
    id: 'ossuary', root: 45, scale: S.phrygian, bpm: 88, steps: 16,
    progressions: [[0, 1, 0, 6], [0, 1, 3, 1], [0, 5, 1, 0], [3, 1, 0, 0]],
    drone: 'hollow', pad: 'whisperChoir', motif: 'boneMarimba', motifOct: 24,
    motifA: [[0, 0, 1], [3, 1, 1], [6, 0, 1], [8, 2, 1], [10, 1, 1], [14, 0, 2]],
    motifB: [[0, 4, 2], [3, 3, 1], [4, 1, 1], [8, 0, 1], [11, 1, 1], [12, 0, 4]],
    bass: 'marimba', bassPattern: 'x..x...x..x.o...',
    lead: 'brass', leadSteps: [0, 8],
    perc: {
      low: { kind: 'frame', calm: 'x.......g.......', combat: 'x...g...x...g...', heavy: 'x..x..x.x..x..x.' },
      accent: { kind: 'bone', calm: '..........g.....', combat: '...x..x....x..x.', heavy: '.x...x.x...x.x..' },
      tick: { kind: 'rattle', combat: '....o.......o...', heavy: '..o...o...o...o.' },
      mid: { kind: 'log', combat: '.......o.......o', heavy: '...o.......o..oo' },
    },
    fill: '............oxox',
    reverb: 0.45, echo: 0.15, level: 0.95, calmDensity: 0.5,
  },
  // organ and bells, harmonic minor, timpani
  sanctum: {
    id: 'sanctum', root: 48, scale: S.harmonicMinor, bpm: 60, steps: 16, sevenths: true,
    progressions: [[0, 5, 3, 4], [0, 3, 4, 0], [5, 1, 4, 0], [0, 6, 5, 4]],
    drone: 'organ', pad: 'organ', motif: 'bells',
    motifA: [[0, 4, 8], [8, 2, 8]],
    motifB: [[0, 3, 4], [4, 2, 4], [8, 1, 8]],
    bass: 'pedal', bassPattern: 'x.......o.......',
    lead: 'choirFull', leadSteps: [0, 8],
    perc: {
      low: { kind: 'timpani', calm: 'x...............', combat: 'x.......x.......', heavy: 'x...x...x...x.xx' },
      accent: { kind: 'bell', combat: '........x.......', heavy: '....x.......x...' },
      tick: { kind: 'hat', heavy: '..g...g...g...g.' },
    },
    fill: '............oooo',
    reverb: 0.75, echo: 0.1, level: 0.9, calmDensity: 0.7,
  },
  // eerie detuned woodwinds, wet bloops, insect ticks; hungarian minor
  fungal: {
    id: 'fungal', root: 54, scale: S.hungarianMinor, bpm: 74, steps: 16,
    progressions: [[0, 1, 0, 4], [0, 5, 6, 4], [0, 3, 1, 0], [5, 1, 4, 0]],
    drone: 'reed', pad: 'woodwind', motif: 'flute',
    motifA: [[0, 4, 3], [4, 3, 2], [6, 2, 6], [12, 3, 4]],
    motifB: [[0, 2, 2], [2, 3, 2], [4, 4, 4], [10, 1, 6]],
    bass: 'reed', bassPattern: 'x...x..o..x.....',
    lead: 'reedDist', leadSteps: [0, 10],
    perc: {
      low: { kind: 'log', calm: 'x.........g.....', combat: 'x.....x...x.....', heavy: 'x..x..x...x..x..' },
      accent: { kind: 'bloop', calm: '.......g........', combat: '...o.......o..g.', heavy: '.g.o...g.g.o..g.' },
      tick: { kind: 'insect', combat: 'g.g...g.g...g.g.', heavy: 'gggg..gggg..gggg' },
      mid: { kind: 'tom', heavy: '......o.......o.' },
    },
    fill: '............o.o.',
    reverb: 0.55, echo: 0.3, level: 0.9, calmDensity: 0.5,
  },
  // anvil hits, heavy toms, growling distorted drone; phrygian dominant
  forge: {
    id: 'forge', root: 40, scale: S.phrygianDominant, bpm: 100, steps: 16,
    progressions: [[0, 1, 0, 1], [0, 6, 5, 1], [0, 3, 1, 0], [0, 0, 6, 1]],
    drone: 'growl', pad: 'lowBrass', motif: 'brassStab', motifOct: 24,
    motifA: [[0, 0, 1], [3, 0, 1], [6, 1, 2], [10, 0, 1], [12, 4, 3]],
    motifB: [[0, 2, 2], [3, 1, 1], [6, 0, 2], [10, 1, 1], [12, -1, 4]],
    bass: 'dist', bassPattern: 'x.xx..x.x.xx..o.',
    lead: 'brass', leadSteps: [0, 4, 8, 12],
    perc: {
      low: { kind: 'taiko', calm: 'x.......x.......', combat: 'x..x..x.x..x....', heavy: 'x.xx..x.x.xx..x.' },
      accent: { kind: 'anvil', calm: '........g.......', combat: '....x.......x...', heavy: '..x...x...x..xx.' },
      mid: { kind: 'tom', combat: '..........o...o.', heavy: '...o...o..o.o.oo' },
      tick: { kind: 'hat', combat: 'g.g.g.g.g.g.g.g.', heavy: 'gggggggggggggggg' },
    },
    fill: '............xoxo',
    reverb: 0.35, echo: 0.05, level: 0.95, calmDensity: 0.45,
  },
  // glassy shimmer and wind, celesta, 3/4
  frost: {
    id: 'frost', root: 47, scale: S.aeolian, bpm: 66, steps: 12,
    progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0], [0, 2, 3, 4]],
    drone: 'air', pad: 'glass', motif: 'celesta', motifOct: 24,
    motifA: [[0, 7, 3], [3, 4, 3], [6, 2, 3], [9, 4, 3]],
    motifB: [[0, 6, 3], [3, 4, 2], [5, 3, 1], [6, 2, 6]],
    bass: 'sub', bassPattern: 'x.....o.....',
    lead: 'tremolo', leadSteps: [0, 6],
    perc: {
      low: { kind: 'iceDrum', combat: 'x.....x.....', heavy: 'x..x..x..xx.' },
      accent: { kind: 'glass', calm: '......g.....', combat: '...o.....o..', heavy: '.o.o..o..o.o' },
      tick: { kind: 'ice', combat: 'g.g.g.g.g.g.', heavy: 'gggggggggggg' },
      mid: { kind: 'frame', heavy: '....o.....o.' },
    },
    fill: '.........ooo',
    reverb: 0.8, echo: 0.4, level: 0.9, calmDensity: 0.6,
  },
  // open-air wind drone, harp in a wistful lydian 6/8, wind-chime glass and frame drum
  sky: {
    id: 'sky', root: 55, scale: S.lydian, bpm: 84, steps: 12,
    progressions: [[0, 1, 0, 4], [0, 5, 1, 4], [3, 1, 0, 0], [0, 4, 5, 1]],
    drone: 'wind', pad: 'softTri', motif: 'harp', motifOct: 24,
    motifA: [[0, 4, 3], [3, 3, 1], [4, 2, 2], [6, 4, 6]],
    motifB: [[0, 6, 2], [2, 5, 1], [3, 4, 3], [6, 1, 6]],
    bass: 'tri', bassPattern: 'x.....o.....',
    lead: 'bowed', leadSteps: [0, 6],
    perc: {
      low: { kind: 'frame', calm: 'x...........', combat: 'x.....x.....', heavy: 'x..x..x..x.x' },
      accent: { kind: 'glass', calm: '......g.....', combat: '...o.....o..', heavy: '.o.o..o..o.o' },
      tick: { kind: 'shaker', combat: 'g.g.g.g.g.g.', heavy: 'gggggggggggg' },
      mid: { kind: 'tom', heavy: '.....o.....o' },
    },
    fill: '.........ooo',
    reverb: 0.7, echo: 0.45, level: 0.9, calmDensity: 0.65,
  },
  // the void's sub drone and beating sines, sonar pings in a cold locrian, sparse muffled thuds and radio blips
  moon: {
    id: 'moon', root: 44, scale: S.locrian, bpm: 56, steps: 16,
    progressions: [[0, 1, 0, 4], [0, 5, 4, 1], [0, 0, 1, 0], [3, 4, 1, 0]],
    drone: 'void', pad: 'whisperChoir', motif: 'sonar', motifOct: 24,
    motifA: [[0, 0, 8], [8, 4, 8]],
    motifB: [[0, 2, 6], [6, 1, 2], [8, -1, 8]],
    bass: 'sub', bassPattern: 'x...............',
    lead: 'tremolo', leadSteps: [0, 8],
    perc: {
      low: { kind: 'muffled', calm: 'x...............', combat: 'x.......x.......', heavy: 'x.....x.x.....x.' },
      accent: { kind: 'blip', calm: '..........g.....', combat: '....o.......o...', heavy: '..o...o...o...o.' },
      tick: { kind: 'ice', combat: '..g.......g.....', heavy: 'g.g.g.g.g.g.g.g.' },
      mid: { kind: 'tom', heavy: '.......o.......o' },
    },
    fill: '............o..o',
    reverb: 0.85, echo: 0.5, level: 0.95, calmDensity: 0.45,
  },
  // electrical hum, a cursed square-wave arpeggio, a pulse kick, glitch stutters and hats
  server: {
    id: 'server', root: 45, scale: S.aeolian, bpm: 112, steps: 16, sevenths: true,
    progressions: [[0, 5, 3, 4], [0, 6, 5, 4], [0, 3, 6, 4], [5, 6, 0, 0]],
    drone: 'hum', pad: 'lowBrass', motif: 'arp', motifOct: 24,
    motifA: [[0, 0, 1], [2, 2, 1], [4, 4, 1], [6, 7, 1], [8, 4, 1], [10, 2, 1], [12, 0, 1], [14, 2, 1]],
    motifB: [[0, 0, 1], [2, 3, 1], [4, 5, 1], [6, 7, 1], [8, 9, 1], [10, 7, 1], [12, 5, 2], [15, 3, 1]],
    bass: 'dist', bassPattern: 'x..x..x.x..x..o.',
    lead: 'reedDist', leadSteps: [0, 8],
    perc: {
      low: { kind: 'pulse', calm: 'x.......x.......', combat: 'x...x...x...x...', heavy: 'x...x...x...x.x.' },
      accent: { kind: 'glitch', calm: '..............g.', combat: '......o.......x.', heavy: '..x...o...x...xo' },
      tick: { kind: 'hat', combat: '..o...o...o...o.', heavy: 'gogogogogogogogo' },
      mid: { kind: 'tom', heavy: '....o.......o...' },
    },
    fill: '............xxox',
    reverb: 0.4, echo: 0.35, level: 0.85, calmDensity: 0.55,
  },
};

/** Lobby / intermission menu theme: slow, cold, the CURSEBOUND leitmotif (D A F E D) over cello and choir. */
export const MENU_SONG: SongSpec = {
  id: 'menu', root: 50, scale: S.aeolian, bpm: 58, steps: 16,
  progressions: [[0, 5, 3, 4], [0, 3, 6, 4], [5, 6, 0, 0], [0, 6, 5, 4]],
  drone: 'cello', pad: 'choir', motif: 'harp',
  motifA: [[0, 4, 4], [4, 2, 4], [8, 1, 4], [12, 0, 4]],
  motifB: [[0, 3, 6], [6, 2, 2], [8, 1, 8]],
  bass: 'tri', bassPattern: '................',
  lead: 'brass', leadSteps: [],
  perc: { accent: { kind: 'bell', calm: '................' } },
  reverb: 0.7, echo: 0.25, level: 0.9, calmDensity: 0.75,
};

/** Boss songs, keyed by boss id (prismstag = The Hollow Stag, bellroot = The Bell Golem, skydrake = The Gale Wyrm,
 *  moonhorror = The Crater Horror). */
export const BOSS_SONGS: Record<string, SongSpec> = {
  // The Hollow Stag: ghost-fire hunt in 6/8, galloping hoof toms, theremin wail, choir
  prismstag: {
    id: 'boss:prismstag', root: 52, scale: S.phrygian, bpm: 116, steps: 12,
    progressions: [[0, 1, 0, 6], [0, 5, 1, 0], [0, 1, 3, 1], [5, 6, 1, 0]],
    drone: 'ghost', pad: 'choir', motif: 'theremin',
    motifA: [[0, 4, 6], [6, 3, 3], [9, 1, 3]],
    motifB: [[0, 7, 4], [4, 6, 2], [6, 4, 6]],
    bass: 'tri', bassPattern: 'x..x..x..o..',
    lead: 'brass', leadSteps: [0, 6],
    perc: {
      low: { kind: 'taiko', calm: 'x...........', combat: 'x.....x.....', heavy: 'x..x..x..x.x' },
      mid: { kind: 'hoof', combat: '..ox.o..ox.o', heavy: 'x.ox.ox.ox.o' },
      accent: { kind: 'glass', combat: '......x.....', heavy: '...x.....x..' },
      tick: { kind: 'hat', combat: 'g.g.g.g.g.g.', heavy: 'gggggggggggg' },
    },
    fill: '.........xox',
    reverb: 0.6, echo: 0.3, level: 1, minIntensity: 0.62, introBars: 2, calmDensity: 1,
  },
  // The Bell Golem: massive tolls, organ, locrian march, anvils, tritone bass
  bellroot: {
    id: 'boss:bellroot', root: 36, scale: S.locrian, bpm: 72, steps: 16, sevenths: true,
    progressions: [[0, 4, 0, 1], [0, 1, 0, 4], [0, 5, 4, 1], [3, 4, 1, 0]],
    drone: 'organ', pad: 'organ', motif: 'tollBell', motifOct: 24,
    motifA: [[0, 0, 8], [8, 4, 8]],
    motifB: [[0, 2, 4], [4, 1, 4], [8, 0, 8]],
    bass: 'dist', bassPattern: 'x...x.x.x...x.o.',
    lead: 'brass', leadSteps: [0, 8],
    perc: {
      low: { kind: 'taiko', calm: 'x.......x.......', combat: 'x...x...x..xx...', heavy: 'x.x.x...x.xxx.x.' },
      accent: { kind: 'anvil', combat: '......x.......x.', heavy: '..x...x...x...x.' },
      mid: { kind: 'tom', combat: '..........o.o...', heavy: '..o...o...o.o.oo' },
      tick: { kind: 'chain', combat: '...g.......g....', heavy: '.g.g.g.g.g.g.g.g' },
    },
    fill: '............xxxx',
    reverb: 0.7, echo: 0.1, level: 1, minIntensity: 0.62, introBars: 2, calmDensity: 1,
  },
  // The Corrupted Core: a driving machine pulse, a stuttering arpeggio, glitch hits and a distorted bass in phrygian
  corruptcore: {
    id: 'boss:corruptcore', root: 40, scale: S.phrygian, bpm: 128, steps: 16, sevenths: true,
    progressions: [[0, 1, 0, 6], [0, 5, 1, 0], [0, 1, 3, 1], [5, 6, 1, 0]],
    drone: 'hum', pad: 'glass', motif: 'arp', motifOct: 24,
    motifA: [[0, 0, 1], [2, 4, 1], [4, 7, 1], [6, 4, 1], [8, 0, 1], [10, 1, 1], [12, 4, 1], [14, 7, 1]],
    motifB: [[0, 7, 1], [2, 4, 1], [4, 1, 1], [6, 0, 1], [8, 1, 1], [10, 4, 1], [12, 8, 2], [15, 7, 1]],
    bass: 'dist', bassPattern: 'x.xx.xx.x.xx.xo.',
    lead: 'reedDist', leadSteps: [0, 8],
    perc: {
      low: { kind: 'pulse', calm: 'x.......x.......', combat: 'x...x...x...x...', heavy: 'x...x...x..xx.x.' },
      mid: { kind: 'tom', combat: '..........o.....', heavy: '....o.....o.o.oo' },
      accent: { kind: 'glitch', calm: '..............g.', combat: '...x......x...o.', heavy: '..x.o.x...x.o.xo' },
      tick: { kind: 'blip', combat: 'g.g.g.g.g.g.g.g.', heavy: 'gggggggggggggggg' },
    },
    fill: '............xoxx',
    reverb: 0.45, echo: 0.35, level: 0.95, minIntensity: 0.62, introBars: 2, calmDensity: 1,
  },
  // The Iron Colossus: slow iron march, anvil strikes on the off-beats, low brass and a growling furnace drone
  ironcolossus: {
    id: 'boss:ironcolossus', root: 33, scale: S.phrygianDominant, bpm: 84, steps: 16,
    progressions: [[0, 1, 0, 1], [0, 6, 5, 1], [0, 3, 1, 0], [5, 1, 0, 0]],
    drone: 'growl', pad: 'lowBrass', motif: 'brassStab', motifOct: 24,
    motifA: [[0, 0, 2], [4, 0, 1], [6, 1, 2], [10, 0, 1], [12, 4, 4]],
    motifB: [[0, 4, 2], [4, 3, 1], [6, 1, 2], [10, 0, 1], [12, -1, 4]],
    bass: 'dist', bassPattern: 'x...x.x.x...x.o.',
    lead: 'brass', leadSteps: [0, 8],
    perc: {
      low: { kind: 'taiko', calm: 'x.......x.......', combat: 'x...x...x..x....', heavy: 'x.x.x...x.xxx.x.' },
      accent: { kind: 'anvil', calm: '........g.......', combat: '......x.......x.', heavy: '..x...x...x...x.' },
      mid: { kind: 'timpani', combat: '..........o.....', heavy: '...o......o.o.oo' },
      tick: { kind: 'chain', combat: '...g.......g....', heavy: '.g.g.g.g.g.g.g.g' },
    },
    fill: '............xxox',
    reverb: 0.55, echo: 0.08, level: 1, minIntensity: 0.62, introBars: 2, calmDensity: 1,
  },
  // The Gale Wyrm: a storm-front in a soaring lydian 6/8, howling wind drone, harp arpeggios lashed by brass,
  // galloping frame drums and thunder toms, shaker rain
  skydrake: {
    id: 'boss:skydrake', root: 50, scale: S.lydian, bpm: 132, steps: 12,
    progressions: [[0, 1, 4, 0], [0, 5, 1, 4], [3, 1, 4, 0], [5, 4, 1, 0]],
    drone: 'wind', pad: 'choir', motif: 'harp', motifOct: 24,
    motifA: [[0, 4, 2], [2, 5, 1], [3, 6, 2], [6, 4, 3], [9, 2, 3]],
    motifB: [[0, 7, 3], [3, 6, 1], [4, 4, 2], [6, 1, 6]],
    bass: 'tri', bassPattern: 'x..x..x..o.o',
    lead: 'brass', leadSteps: [0, 6],
    perc: {
      low: { kind: 'timpani', calm: 'x...........', combat: 'x.....x.....', heavy: 'x..x..x..x.x' },
      mid: { kind: 'frame', combat: '..ox.o..ox.o', heavy: 'x.ox.ox.ox.o' },
      accent: { kind: 'glass', combat: '......x.....', heavy: '...x.....x..' },
      tick: { kind: 'shaker', combat: 'g.g.g.g.g.g.', heavy: 'gggggggggggg' },
    },
    fill: '.........xox',
    reverb: 0.65, echo: 0.35, level: 1, minIntensity: 0.62, introBars: 2, calmDensity: 1,
  },
  // The Crater Horror: the void's drone under a choir gone wrong, theremin wails in locrian, a slow heartbeat of
  // muffled drums and taiko, radio blips and glitches as the light dies
  moonhorror: {
    id: 'boss:moonhorror', root: 38, scale: S.locrian, bpm: 76, steps: 16, sevenths: true,
    progressions: [[0, 1, 0, 4], [0, 4, 1, 0], [0, 5, 4, 1], [1, 0, 4, 0]],
    drone: 'void', pad: 'whisperChoir', motif: 'theremin', motifOct: 12,
    motifA: [[0, 0, 6], [6, 1, 2], [8, 4, 8]],
    motifB: [[0, 4, 4], [4, 3, 4], [8, 1, 4], [12, 0, 4]],
    bass: 'sub', bassPattern: 'x.......x...o...',
    lead: 'tremolo', leadSteps: [0, 8],
    perc: {
      low: { kind: 'taiko', calm: 'x.......x.......', combat: 'x..x....x..x....', heavy: 'x..x..x.x..x.xx.' },
      mid: { kind: 'muffled', combat: '....o.......o...', heavy: '..o.o...o.o.o.o.' },
      accent: { kind: 'blip', combat: '......x.......x.', heavy: '..x...x...x...x.' },
      tick: { kind: 'glitch', combat: '...g.......g....', heavy: '.g.g.g.g.g.g.g.g' },
    },
    fill: '............xxxx',
    reverb: 0.85, echo: 0.45, level: 1, minIntensity: 0.62, introBars: 2, calmDensity: 1,
  },
};

/** Fallback boss song for unknown bosses: the catacombs palette, darker and denser. */
export const GENERIC_BOSS_SONG: SongSpec = {
  ...THEME_SONGS.catacombs,
  id: 'boss:generic', bpm: 104, root: 45,
  progressions: [[0, 1, 0, 5], [0, 5, 1, 0]],
  scale: S.phrygian,
  minIntensity: 0.62, introBars: 2, calmDensity: 1,
};

// ------------------------------------------------------------------ stems

export type Stem = 'bed' | 'motif' | 'bass' | 'perc' | 'heavy';
export const STEMS: readonly Stem[] = ['bed', 'motif', 'bass', 'perc', 'heavy'];

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Stem gain (0..1) for an intensity. */
export function stemLevel(stem: Stem, I: number): number {
  switch (stem) {
    case 'bed': return 1 - 0.2 * smooth(0.6, 0.9, I);
    case 'motif': return 0.85 + 0.15 * smooth(0.2, 0.5, I);
    case 'bass': return smooth(0.2, 0.38, I);
    case 'perc': return smooth(0.26, 0.42, I);
    case 'heavy': return smooth(0.62, 0.78, I);
  }
}

// ------------------------------------------------------------------ intensity from the game

/** Structural subset of the simulation Snapshot this needs (kept local so this file stays dependency-free). */
export interface IntensitySnapshot {
  phase: string;
  players: readonly { s: number; x: number; y: number; hp: number; life: string }[];
  enemies: readonly { x: number; y: number; st: string; boss: boolean; el?: number; cnt?: string | null; atk?: string | null }[];
  enc?: { boss: boolean } | null;
}

/** Enemy states that mean "not engaged" (dormant / sleeping foes spread across the map). */
const DORMANT = new Set(['idle', 'dying', 'dead', 'sleep', 'asleep', 'dormant', 'patrol', 'wander']);

/**
 * Raw musical intensity 0..1 for the local hero: engaged foes nearby (elites weigh more, cohorts a bit more),
 * the boss, and low health. Out of combat it is near zero. Feed ~4 Hz into AudioEngine.setIntensity, which
 * smooths it with hysteresis.
 */
export function computeIntensity(snap: IntensitySnapshot | null | undefined, slot: number): number {
  if (!snap || snap.phase !== 'COMBAT') return 0;
  const me = snap.players.find((p) => p.s === slot) ?? snap.players[slot];
  if (!me) return 0.2;
  let threat = 0;
  let boss = false;
  for (const e of snap.enemies) {
    if (e.st === 'dying') continue;
    const d = Math.hypot(e.x - me.x, e.y - me.y);
    if (e.boss) { boss = true; continue; }
    const engaged = !DORMANT.has(e.st) || !!e.atk;
    let w = 0;
    if (engaged) w = d < 7 ? 1 : d < 14 ? 0.6 : d < 20 ? 0.2 : 0;
    else w = d < 5 ? 0.3 : 0;
    if (w === 0) continue;
    if (e.cnt) w *= 1.5;
    if (e.el) w *= e.el >= 2 ? 4 : 2.5;
    threat += w;
  }
  let I = 1 - Math.exp(-threat / 6);
  if (boss || snap.enc?.boss) I = Math.max(I, 0.72) + 0.12 * I;
  if (me.life === 'downed') I += 0.2;
  else if (me.life === 'alive' && me.hp < 0.4 && threat > 0.2) I += (0.4 - me.hp) * 1.1;
  return Math.min(1, Math.max(0, I));
}

/**
 * Hysteresis + smoothing so the music never flaps: three levels (explore / combat / heavy) with separate
 * rise and fall thresholds, instant-ish rise, delayed fall (the raw value must stay low for `holdDown` s),
 * and an asymmetric low-pass on the continuous value, clamped into the current level's band.
 */
export class IntensityFollower {
  level: 0 | 1 | 2 = 0;
  value = 0;
  private below = 0;
  private sinceUp = 0;
  constructor(private readonly holdDown = 4, private readonly minDwell = 6) {}

  update(raw: number, dt: number): number {
    const r = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0));
    this.sinceUp += dt;
    const up = [0.3, 0.68];
    const down = [0.16, 0.48];
    if (this.level < 2 && r >= (up[this.level] as number)) {
      this.level = (r >= up[1]! ? 2 : 1) as 1 | 2;
      this.below = 0;
      this.sinceUp = 0;
    } else if (this.level > 0 && r < (down[this.level - 1] as number)) {
      this.below += dt;
      if (this.below >= this.holdDown && this.sinceUp >= this.minDwell) {
        this.level = (this.level - 1) as 0 | 1;
        this.below = 0;
      }
    } else this.below = 0;
    const tau = r > this.value ? 0.6 : 3.5;
    this.value += (r - this.value) * Math.min(1, dt / tau);
    const band: [number, number] = this.level === 0 ? [0, 0.24] : this.level === 1 ? [0.36, 0.64] : [0.76, 1];
    this.value = Math.min(band[1], Math.max(band[0], this.value));
    return this.value;
  }

  /** Jump straight to a value (cutscenes, song changes). */
  reset(v: number): void {
    this.value = Math.min(1, Math.max(0, v));
    this.level = v >= 0.7 ? 2 : v >= 0.32 ? 1 : 0;
    this.below = 0;
    this.sinceUp = 0;
  }
}

/** Pattern char → velocity (0 = rest). Ghost notes are gated by `gate` (a per-bar seeded random). */
export function patternHit(p: string | undefined, step: number, gate: number): number {
  if (!p) return 0;
  const c = p[step % p.length];
  if (c === 'x') return 1;
  if (c === 'o') return 0.65;
  if (c === 'g') return gate < 0.6 ? 0.35 : 0;
  return 0;
}
