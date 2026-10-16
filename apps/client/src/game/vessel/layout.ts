/**
 * Vessel Select stage: pure layout and selection logic (framework-free, no DOM).
 *
 * The stage is a software-rendered pixel scene at a low internal resolution, scaled up by a whole number of
 * device pixels so every art pixel stays square and crisp. Heroes stand on plinths in a shallow arc (a squad
 * lineup, centre front, the ends a step back) in an isometric portal chamber; the arc never rotates, the
 * highlight moves between heroes. The co-op party stage uses the same scene with fewer, wider-spaced plinths and
 * your own hero in the centre.
 */

/** Hero frame size (every hero sprite sheet uses 48x48 frames, feet at row 42). */
export const HERO_FRAME = 48;
export const HERO_FEET = 42;

export interface LineupSpec {
  /** horizontal distance between neighbouring heroes (internal px) */
  spacing: number;
  /** how far the outermost heroes stand behind the centre (internal px) */
  arc: number;
}

/** Ten classes: tight enough to fit 427 internal px (1280 / 3), wide enough that weapons never overlap. */
export const LINEUP: LineupSpec = { spacing: 34, arc: 24 };
/** Co-op party: up to five heroes with room for name plates over each. */
export const PARTY: LineupSpec = { spacing: 76, arc: 10 };

/** Internal size a lineup needs (width across all plinths + margins, height from back heads to front plinths). */
export function lineupNeeds(n: number, spec: LineupSpec): { w: number; h: number } {
  return { w: Math.max(1, n - 1) * spec.spacing + 40 + 48, h: HERO_FRAME + spec.arc + 34 };
}

export interface SlotPos {
  /** feet position (internal px, integers) */
  x: number;
  y: number;
  /** 0 = front of the arc .. 1 = the far ends */
  depth: number;
}

/** Positions of `n` plinths in a shallow arc centred on (cx, cy): the middle stands front, the ends a step back. */
export function arcPositions(n: number, cx: number, cy: number, spec: LineupSpec): SlotPos[] {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => {
    const u = mid > 0 ? (i - mid) / mid : 0;
    const depth = u * u;
    return { x: Math.round(cx + (i - mid) * spec.spacing), y: Math.round(cy - spec.arc * depth), depth };
  });
}

/** Step a selection index by `delta` around `n` slots (wraps both ways). */
export function stepIndex(i: number, delta: number, n: number): number {
  if (n <= 0) return 0;
  return (((i + delta) % n) + n) % n;
}

export interface StageFit {
  /** device pixels per art pixel (whole number) */
  zoom: number;
  /** internal (art) resolution */
  w: number;
  h: number;
  /** free band (internal px) the lineup is centred in, between overlaid UI at the top and bottom */
  freeTop: number;
  freeBottom: number;
}

/**
 * Pick the largest whole-number zoom at which the lineup (`need`) still fits the free band of the canvas
 * (device px; `insetTop` / `insetBottom` are covered by UI), then size the internal buffer to cover the canvas.
 */
export function fitStage(o: { devW: number; devH: number; insetTop?: number; insetBottom?: number; need: { w: number; h: number }; maxZoom?: number }): StageFit {
  const top = Math.max(0, o.insetTop ?? 0), bottom = Math.max(0, o.insetBottom ?? 0);
  const freeH = Math.max(1, o.devH - top - bottom);
  const zw = Math.floor(o.devW / Math.max(1, o.need.w));
  const zh = Math.floor(freeH / Math.max(1, o.need.h));
  const zoom = Math.max(1, Math.min(o.maxZoom ?? 12, zw, zh));
  const w = Math.max(1, Math.ceil(o.devW / zoom));
  const h = Math.max(1, Math.ceil(o.devH / zoom));
  return { zoom, w, h, freeTop: Math.floor(top / zoom), freeBottom: Math.max(Math.floor(top / zoom) + 1, h - Math.ceil(bottom / zoom)) };
}

/** Feet line of the arc's front hero, so the whole lineup (back heads to front plinths) sits centred in the free band. */
export function lineupBaseline(fit: StageFit, spec: LineupSpec): number {
  const span = HERO_FRAME + spec.arc + 12;           // back heads .. front plinth rim
  const mid = (fit.freeTop + fit.freeBottom) / 2;
  return Math.round(mid + span / 2 - 10);
}

// ---------------------------------------------------------------- locks

export interface LockInfo {
  locked: boolean;
  /** short chip over the hero ("Lv 6") */
  chip: string;
  /** detail line ("Unlocks at level 6") */
  line: string;
  /** progress toward it ("Level 2 / 6"), when the player's level is known */
  progress: string | null;
}

/** Lock state text for a class that unlocks at `unlockAt`, for a player at `level` (null = not known yet: open). */
export function lockInfo(unlockAt: number, level: number | null): LockInfo {
  const locked = level !== null && level < unlockAt;
  return {
    locked,
    chip: locked ? `Lv ${unlockAt}` : '',
    line: locked ? `Unlocks at level ${unlockAt}` : '',
    progress: locked ? `Level ${level} / ${unlockAt}` : null,
  };
}

/** Screen-reader announcement for the highlighted class. */
export function announceText(name: string, role: string, lock: LockInfo): string {
  return lock.locked ? `${name}, locked. ${lock.line}; you are ${lock.progress?.toLowerCase()}.` : `${name} selected. ${role}.`;
}

// ---------------------------------------------------------------- party

/**
 * Stage slot order for a party: you stand in the centre, the others alternate right / left outward in seat order,
 * and open seats fill whatever is left. Returns `slots` entries (null = open seat), left to right.
 */
export function partyOrder<T extends { you?: boolean }>(seats: readonly T[], slots: number): (T | null)[] {
  const n = Math.max(1, slots);
  const centre = Math.floor((n - 1) / 2);
  const order: number[] = [centre];
  for (let k = 1; order.length < n; k++) {
    if (centre + k < n) order.push(centre + k);
    if (centre - k >= 0 && order.length < n) order.push(centre - k);
  }
  const me = seats.find((s) => s.you);
  const rest = seats.filter((s) => s !== me);
  const queue = me ? [me, ...rest] : [...rest];
  const out: (T | null)[] = Array.from({ length: n }, () => null);
  queue.slice(0, n).forEach((s, k) => { out[order[k]!] = s; });
  return out;
}
