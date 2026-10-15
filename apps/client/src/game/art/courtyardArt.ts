/**
 * Training grounds art (framework-free): a sunlit medieval town square, all procedural pixel art.
 *
 *  - paintCourtyardFloor: the whole floor as one image, painted per screen pixel in world space so the cobbles really
 *    run in rings round the fountain: pale sandstone flags, a granite curb, grey cobbles crossed by eight cream
 *    sunburst spokes, a red brick band, warm setts, the worn rim with moss and grass between the stones, and the
 *    houses' long afternoon shadow on the north-west side;
 *  - courtyardSheets: timber-framed house blocks (plaster, beams, shutters, flower boxes, doors, shopfronts, banners,
 *    hip roofs and chimneys), gateway arches, low garden walls for the near side, the tiered fountain (4 water
 *    frames), market stalls with striped awnings (two orientations), straw training dummies, weapon racks and
 *    swaying banner poles.
 * Light comes from the top-left like the rest of the game's art; everything gets a warm dark outline.
 */
import { COURTYARD, type CourtyardPlan } from '@cursebound/simulation';
import { PixelBuffer, bayer, hash2, mix, outlinePass } from './draw/pixel';

export const CY = {
  house: 'cy:house', stub: 'cy:stub', fountain: 'cy:fountain', stall: 'cy:stall', dummy: 'cy:dummy', rack: 'cy:rack', banner: 'cy:banner',
  smoke: 'cy:smoke', petal: 'cy:petal', floor: 'cy:floor',
} as const;

/** House block frame: 64 wide; the tile's diamond sits at the bottom (its top corner HOUSE_H - 32 px down). */
export const HOUSE_W = 64, HOUSE_H = 184;
/** House frames: 3 heights x 4 palettes x 3 ground floors, then 2 gateway frames. */
export const HOUSE_FRAMES = 38, GATE_FRAME = 36;
export const houseFrame = (level: number, palette: number, ground: number) => (level % 3) * 12 + (palette % 4) * 3 + (ground % 3);
export const STUB_W = 64, STUB_H = 72, STUB_FRAMES = 4;
export const FOUNTAIN_W = 256, FOUNTAIN_H = 224, FOUNTAIN_CX = 128, FOUNTAIN_CY = 156, FOUNTAIN_FRAMES = 4;
export const STALL_W = 128, STALL_H = 120, STALL_CX = 64, STALL_CY = 96, STALL_FRAMES = 8;
export const DUMMY_W = 48, DUMMY_H = 72, DUMMY_FRAMES = 2;
export const RACK_W = 56, RACK_H = 64, RACK_FRAMES = 2;
export const BANNER_W = 40, BANNER_H = 132, BANNER_FRAMES = 12;

const OUT = 0x1a1210;
type Ramp = readonly number[];
const R = (...c: number[]): Ramp => c;

// ---------------------------------------------------------------- palette (daylight)

const P = {
  flag: R(0x7c6c52, 0x9c8a6c, 0xb8a684, 0xd2c29e, 0xe8dab8),
  flagMortar: 0x5e523e,
  cobble: R(0x46443f, 0x625e58, 0x7e7972, 0x9a948a, 0xb6b0a4),
  cream: R(0x7a6e58, 0x988a70, 0xb6a888, 0xd0c4a2, 0xe6dcbc),
  setts: R(0x544a40, 0x6e6254, 0x8a7c6a, 0xa49580, 0xbeae96),
  brick: R(0x4e2218, 0x6c2e1e, 0x8c4028, 0xa85434, 0xc26a44),
  curb: R(0x343236, 0x4a484e, 0x625f66, 0x7c7980),
  worn: R(0x40392f, 0x544b3f, 0x6a5f50, 0x807362, 0x948672),
  mortar: 0x2e2a24,
  grass: R(0x2e4a1c, 0x446a24, 0x5e8a2e, 0x7aa83e),
  dirt: R(0x3e3226, 0x52422e, 0x66543a),
  shadow: 0x1c1822,
  plaster: [R(0xa89a7c, 0xc8baa0, 0xe2d6bc, 0xf2eadc), R(0xa8864e, 0xc8a466, 0xdcbc7e, 0xecd298), R(0xa88070, 0xc89e8c, 0xdcb6a6, 0xeccabc), R(0x8a969c, 0xa8b4b8, 0xc4ced2, 0xdce4e6)],
  timber: R(0x24160e, 0x3a2416, 0x543620, 0x6e4a2c),
  stone: R(0x4e4a46, 0x6a6660, 0x86827a, 0xa29e94, 0xbcb8ae),
  roof: [R(0x4e1e14, 0x6e2a1c, 0x8e3a24, 0xae5030, 0xc66a3e), R(0x242a36, 0x343c4c, 0x485268, 0x5e6a84, 0x76829c), R(0x4a3418, 0x6a4e26, 0x8a6a34, 0xa88644, 0xc2a258), R(0x3a2a22, 0x56402e, 0x725a3e, 0x8c7450, 0xa48c64)],
  glass: R(0x141a2c, 0x26344e, 0x4a6890, 0x9cc0e0),
  shutter: [0x3e6a3e, 0x3a5a8a, 0x8a3a2e, 0x7a5a2a],
  flower: [0xe04a5e, 0xf09ac0, 0xf8e070, 0xffffff],
  door: R(0x2e1c10, 0x4a2e18, 0x684222, 0x86582e),
  water: R(0x16405e, 0x245e84, 0x3c84aa, 0x76bcd8, 0xd8f2ff),
  straw: R(0x6e521c, 0x9a7626, 0xc49c36, 0xe2c058, 0xf6dc86),
  burlap: R(0x6a5440, 0x8c745a, 0xac9474, 0xc8b290),
  steel: R(0x3c444e, 0x667080, 0x9aa4b2, 0xd0d8e2, 0xf4f8fc),
  gold: R(0x7a5214, 0xb07e22, 0xe0b040, 0xfae288),
  cloth: [R(0x5a0e14, 0x8a1a22, 0xb82a30, 0xe04a46), R(0x10204e, 0x1c3478, 0x2c50a8, 0x4a76d0), R(0x163a1c, 0x22582a, 0x34783a, 0x52a052), R(0x3a1450, 0x56207a, 0x7432a2, 0x9a52c8)],
  stripe: [[0xb82a30, 0xf2eadc], [0x2c50a8, 0xf2e6b0], [0x34783a, 0xf0e4c4], [0xd0902a, 0x6a1e2a]] as const,
};

const shade = (ramp: Ramp, i: number) => ramp[Math.max(0, Math.min(ramp.length - 1, i))]!;
const dith = (x: number, y: number, t: number) => bayer(x, y) + 0.47 < t;

// ---------------------------------------------------------------- floor

/** Polar cobble rows: returns [stoneIndex, row, u (radial 0..1), v (along 0..1), rowRadius, stonesInRow]. */
function polarStone(r: number, th: number, r0: number, depth: number, len: number, seed: number) {
  const fr = (r - r0) / depth;
  const row = Math.floor(fr);
  const u = fr - row;
  const rr = r0 + (row + 0.5) * depth;
  const n = Math.max(6, Math.round((Math.PI * 2 * rr) / len));
  const stagger = hash2(row, seed, 7);
  const s = ((th + Math.PI) / (Math.PI * 2)) * n + stagger;
  const idx = ((Math.floor(s) % n) + n) % n;
  return { idx, row, u, v: s - Math.floor(s), rr, n, stagger };
}

/** Bevelled stone colour: lit edge toward the top-left (world -x), dark edge away, mortar in between. */
function bevel(ramp: Ramp, base: number, u: number, v: number, mu: number, mv: number, nx: number, ny: number, tx: number, ty: number, mortar: number, px: number, py: number): number {
  if (u < mu || u > 1 - mu || v < mv || v > 1 - mv) return mortar;
  const bu = mu * 2.6, bv = mv * 2.6;
  let n0 = 0, n1 = 0;
  if (u < bu) { n0 = -nx; n1 = -ny; } else if (u > 1 - bu) { n0 = nx; n1 = ny; } else if (v < bv) { n0 = -tx; n1 = -ty; } else if (v > 1 - bv) { n0 = tx; n1 = ty; }
  const lit = n0 * -0.86 + n1 * -0.5;
  let k = base + (lit > 0.25 ? 1 : lit < -0.25 ? -1 : 0);
  const sp = hash2(px, py, 91);
  if (sp < 0.05) k--; else if (sp > 0.97) k++;
  return shade(ramp, k);
}

/** Jittered-cell (Voronoi) cobbles in world xy: [cellHash, edge distance F2 - F1]. */
function cells(wx: number, wy: number, size: number, seed: number): [number, number] {
  const gx = Math.floor(wx / size), gy = Math.floor(wy / size);
  let f1 = 9, f2 = 9, h1 = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = (gx + i + 0.15 + hash2(gx + i, gy + j, seed) * 0.7) * size, cy = (gy + j + 0.15 + hash2(gx + i, gy + j, seed + 1) * 0.7) * size;
    const d = Math.hypot(wx - cx, wy - cy);
    if (d < f1) { f2 = f1; f1 = d; h1 = hash2(gx + i, gy + j, seed + 2); } else if (d < f2) f2 = d;
  }
  return [h1, f2 - f1];
}

/** Paint the whole courtyard floor (and the street beyond the houses) into one buffer covering the map's iso bounds. */
export function paintCourtyardFloor(plan: CourtyardPlan, ox: number, oy: number, width: number, height: number, seed: number): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  const { cx, cy } = plan;
  const [, rFlag, rCurb1, rCob, rBrick, rSett, rCurb2] = COURTYARD.rings;
  const RAD = COURTYARD.radius;
  const blockers = plan.features.filter((f) => f.kind !== 'arch' && f.kind !== 'fountain');
  const data = buf.data;
  // contact-shadow lookup: which pieces cast onto each tile (most tiles: none)
  const near: CourtyardPlan['features'][] = [];
  const W = COURTYARD.w;
  for (const f of blockers) for (let ty = f.y - 1; ty <= f.y + f.h + 1; ty++) for (let tx = f.x - 1; tx <= f.x + f.w + 1; tx++) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= COURTYARD.h) continue;
    (near[ty * W + tx] ??= []).push(f);
  }
  for (let py = 0; py < height; py++) {
    const sy = py + oy;
    for (let px = 0; px < width; px++) {
      const sx = px + ox;
      const a = sx / 32, b = sy / 16;
      const wx = (a + b) / 2, wy = (b - a) / 2;
      const dx = wx - cx, dy = wy - cy;
      const r = Math.hypot(dx, dy);
      let col: number;
      if (r > RAD + 3.5) {
        // the street beyond the houses: big worn setts and dirt
        // (cheap running-bond setts: most of it lies under the houses)
        const row = Math.floor(wy / 0.42), u = wy / 0.42 - row;
        const sx2 = wx / 0.6 + (row % 2) * 0.5, col2 = Math.floor(sx2), v = sx2 - col2;
        col = u < 0.1 || v < 0.07 ? P.dirt[0]! : shade(P.worn, Math.floor(hash2(col2, row, seed) * 3));
      } else if (r > RAD - 3.8) {
        // the worn rim: irregular cobbles, moss and grass creeping out from the house fronts
        const [h, e] = cells(wx, wy, 0.34, seed + 5);
        const near = r > RAD - 1.1;
        if (e < 0.045) col = near && hash2(Math.floor(wx * 9), Math.floor(wy * 9), seed) < 0.35 ? shade(P.grass, 1 + (hash2(px, py, 3) < 0.3 ? 1 : 0)) : P.mortar;
        else col = shade(P.worn, 1 + Math.floor(h * 3) + (e > 0.12 && hash2(px, py, 5) < 0.06 ? 1 : 0));
        if (near && hash2(Math.floor(wx * 4), Math.floor(wy * 4), seed + 9) < 0.07 && dith(px, py, 0.5)) col = shade(P.grass, 2);
      } else {
        const th = Math.atan2(dy, dx);
        const nx = dx / (r || 1), ny = dy / (r || 1), tx = -ny, ty = nx;
        if (r < rFlag) {
          const s = polarStone(r, th, COURTYARD.fountain, 1.0, 1.35, seed + 11);
          col = bevel(P.flag, 1 + Math.floor(hash2(s.row, s.idx, seed) * 3), s.u, s.v, 0.035, 0.035 / ((Math.PI * 2 * s.rr) / s.n), nx, ny, tx, ty, P.flagMortar, px, py);
        } else if (r < rCurb1 || (r >= rSett && r < rCurb2)) {
          const s = polarStone(r, th, r < rCurb1 ? rFlag : rSett, 0.3, 0.55, seed + 13);
          col = bevel(P.curb, 1 + Math.floor(hash2(s.row, s.idx, seed + 1) * 2), s.u, s.v, 0.08, 0.06, nx, ny, tx, ty, P.mortar, px, py);
        } else if (r < rCob) {
          const s = polarStone(r, th, rCurb1, 0.3, 0.34, seed + 17);
          // eight cream sunburst spokes (decided per stone so their edges stay crisp)
          const ang = ((s.idx + 0.5 - s.stagger) / s.n) * Math.PI * 2 - Math.PI;
          const spoke = Math.abs(Math.sin((ang - Math.PI / 8) * 4)) * s.rr < 0.55;
          col = bevel(spoke ? P.cream : P.cobble, 1 + Math.floor(hash2(s.row, s.idx, seed + 2) * 3), s.u, s.v, 0.1, 0.1, nx, ny, tx, ty, P.mortar, px, py);
        } else if (r < rBrick) {
          const s = polarStone(r, th, rCob, 0.2, 0.42, seed + 19);
          col = bevel(P.brick, 1 + Math.floor(hash2(s.row, s.idx, seed + 3) * 3), s.u, s.v, 0.14, 0.07, nx, ny, tx, ty, 0x3a2a22, px, py);
        } else {
          const s = polarStone(r, th, rBrick, 0.38, 0.46, seed + 23);
          col = bevel(P.setts, 1 + Math.floor(hash2(s.row, s.idx, seed + 4) * 3), s.u, s.v, 0.08, 0.08, nx, ny, tx, ty, P.mortar, px, py);
        }
      }
      // afternoon shade: the north-west houses throw a long soft band across the rim (dithered edge)
      let dark = 0;
      if (r < RAD + 3.5) {
        const nw = Math.max(0, -(dx + dy) / ((r || 1) * Math.SQRT2));
        const depth = 0.5 + 2.6 * nw * nw;
        const e = RAD - r;
        if (e < depth + bayer(px, py) * 0.5) dark = 0.36;
      }
      // contact shadows: the fountain's skirt and every piece standing in the square (cast toward the south-east)
      if (!dark) {
        if (r > COURTYARD.fountain && r < COURTYARD.fountain + 0.75 + bayer(px, py) * 0.3 && dx + dy > -1.2) dark = 0.32;
        else for (const f of near[Math.floor(wy) * W + Math.floor(wx)] ?? []) {
          const fx = f.x + f.w / 2 + 0.35, fy = f.y + f.h / 2 + 0.35;
          const rx = f.w / 2 + 0.35, ry = f.h / 2 + 0.35;
          if (((wx - fx) / rx) ** 2 + ((wy - fy) / ry) ** 2 < 1 + bayer(px, py) * 0.25) { dark = 0.3; break; }
        }
      }
      if (dark) col = mix(col, P.shadow, dark);
      data[py * width + px] = (0xff000000 | col) >>> 0;
    }
  }
  return buf;
}

// ---------------------------------------------------------------- polygon helpers

type Pt = [number, number];

function inside(pts: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Fill a polygon (pixel centres inside), colouring each pixel with fn (return -1 to skip). */
function poly(buf: PixelBuffer, pts: Pt[], fn: (x: number, y: number) => number, ox = 0, oy = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (!inside(pts, x + 0.5, y + 0.5)) continue;
    const c = fn(x, y);
    if (c >= 0) buf.set(x + ox, y + oy, c);
  }
}

// ---------------------------------------------------------------- houses

interface HouseSpec { wallH: number; roofH: number; palette: number; ground: number; roof: number; chimney: boolean; gate?: boolean; seed: number }

/** One face of a house: u 0..1 across, py pixels from the eave, wallH tall; `right` faces are in shade. */
function facade(s: HouseSpec, u: number, py: number, right: boolean, gx: number, gy: number): number {
  const W = 32, x = Math.min(W - 1, Math.floor(u * W));
  const H = s.wallH;
  const split = Math.round(H * 0.47);
  const plas = P.plaster[s.palette]!;
  const tim = P.timber;
  const dim = (c: number) => (right ? mix(c, 0x2a2030, 0.26) : c);
  const plaster = () => dim(shade(plas, 2 + (hash2(gx, gy, s.seed) < 0.08 ? -1 : hash2(gx, gy, s.seed + 1) > 0.97 ? 1 : 0)));
  // gateway: a stone arch through both floors' lower half, portcullis teeth in the dark
  if (s.gate) {
    const ax = (u - 0.5) * 2, top = H * 0.36;
    const archY = top + (1 - Math.sqrt(Math.max(0, 1 - Math.min(1, Math.abs(ax) / 0.72) ** 2))) * H * 0.18;
    const inOpen = Math.abs(ax) < 0.72 && py > archY;
    const ring = Math.abs(ax) < 0.86 && py > archY - 4 && !inOpen;
    if (inOpen) {
      const deep = Math.min(1, (py - archY) / (H * 0.5));
      if (py < archY + 14 && x % 4 === 1) return dim(shade(P.steel, 0));
      if (py < archY + 14 && (py - Math.floor(archY)) % 6 === 2) return dim(shade(P.steel, 1));
      return dith(gx, gy, deep) ? 0x2a2420 : 0x120e10;
    }
    if (ring && py > top - 6) return dim(shade(P.stone, (Math.floor((Math.atan2(py - archY - H * 0.3, ax * 20) + 4) * 3) % 2 ? 3 : 4)));
    if (py < top - 10 && py > 4) {
      // a banner over the gate
      const bx = Math.abs(x - 15.5);
      if (bx < 5 && py > 6 && py < top - 12 + (bx < 2 ? 4 : 0)) return dim(shade(P.cloth[s.palette % 4]!, py === 7 ? 3 : bx < 1.5 && py > 12 && py < 16 ? 3 : 2));
    }
    return py > H - 12 || py < 3 ? dim(shade(P.stone, 2 + ((Math.floor(py / 5) + Math.floor((x + (Math.floor(py / 5) % 2) * 4) / 8)) % 2))) : dim(shade(P.stone, 2));
  }
  // eave beam and corner posts
  if (py < 3) return dim(shade(tim, py === 2 ? 1 : 2));
  if (x < 2 || x > W - 3) return dim(shade(tim, x === 0 || x === W - 1 ? 1 : 2));
  // upper floor: plaster in a timber frame, a shuttered window with a flower box
  if (py < split) {
    if (py >= split - 3) return dim(shade(tim, py === split - 1 ? 1 : 2));
    const wy0 = Math.round(split * 0.22), wy1 = Math.round(split * 0.7);
    if (x >= 11 && x <= 20 && py >= wy0 && py <= wy1) {
      if (x === 11 || x === 20 || py === wy0 || py === wy1) return dim(shade(tim, 1));
      if (x === 15 || x === 16 || py === Math.round((wy0 + wy1) / 2)) return dim(shade(tim, 2));
      return dim(x <= 13 && py <= wy0 + 2 ? shade(P.glass, 3) : shade(P.glass, (x + py) % 5 === 0 ? 2 : 1));
    }
    if ((x >= 8 && x <= 10 || x >= 21 && x <= 23) && py >= wy0 && py <= wy1) return dim((py - wy0) % 3 === 0 ? mix(P.shutter[s.palette]!, 0x000000, 0.35) : P.shutter[s.palette]!);
    if (x >= 10 && x <= 21 && py > wy1 && py <= wy1 + 3) {
      if (py === wy1 + 1 && hash2(x, s.seed, 3) < 0.7) return dim(P.flower[(x + s.seed) % 3]!);
      if (py === wy1 + 1) return dim(shade(P.grass, 2));
      return dim(shade(tim, 2));
    }
    // timber braces: an X or a pair of uprights, by palette
    const k = (py - 3) / Math.max(1, split - 6);
    if (s.palette % 2 === 0) {
      const d1 = Math.abs((x - 2) / (W - 4) - k), d2 = Math.abs((x - 2) / (W - 4) - (1 - k));
      if ((d1 < 0.06 || d2 < 0.06) && (x < 9 || x > 22)) return dim(shade(tim, 2));
    } else if (x === 6 || x === 7 || x === 24 || x === 25) return dim(shade(tim, 2));
    return plaster();
  }
  // the jetty's shadow on the ground floor
  if (py <= split + 1) return dim(mix(plaster(), 0x1a1214, 0.4));
  const plinthTop = H - 10;
  // ground floor by kind: 0 door, 1 shop window with an awning, 2 hanging banner + window
  if (s.ground === 0) {
    const top = split + 6;
    const dxc = Math.abs(x - 15.5);
    const arch = top + (dxc > 3 ? (dxc - 3) * 0.9 : 0);
    if (dxc < 6 && py >= arch) {
      if (dxc > 4.6) return dim(shade(P.stone, 3));
      if (py === Math.floor(arch) || py === Math.floor(arch) + 1) return dim(shade(P.stone, 4));
      if (x === 19 && py === Math.round((top + H) / 2)) return dim(shade(P.gold, 3));
      if ((x - 11) % 3 === 0) return dim(shade(P.door, 0));
      if ((py - top) % 7 === 3 && (x === 12 || x === 18)) return dim(shade(P.steel, 2));
      return dim(shade(P.door, 2 + (x < 14 ? 1 : 0)));
    }
  } else if (s.ground === 1) {
    if (py >= split + 3 && py <= split + 6 && x >= 4 && x <= 27) return dim(Math.floor((x - 4) / 3) % 2 ? P.stripe[s.palette]![1] : P.stripe[s.palette]![0]);
    if (py === split + 7 && x >= 4 && x <= 27 && x % 3 === 1) return dim(P.stripe[s.palette]![0]);
    if (x >= 6 && x <= 25 && py >= split + 9 && py <= plinthTop - 2) {
      if (x === 6 || x === 25 || py === split + 9 || py === plinthTop - 2 || x === 15 || x === 16) return dim(shade(tim, 1));
      // goods behind the glass
      if (py > plinthTop - 7 && hash2(x, py, s.seed + 5) < 0.6) return dim([0xc84a3a, 0xe0b040, 0x6a9a3a, 0xc8a070][(x >> 1) % 4]!);
      return dim(x < 10 && py < split + 12 ? shade(P.glass, 3) : shade(P.glass, 1));
    }
  } else {
    const bx = Math.abs(x - 9.5);
    if (bx < 4 && py > split && py < split + H * 0.34 + (bx < 1.5 ? 3 : 0)) {
      if (py === split + 1) return dim(shade(P.gold, 2));
      if (bx < 1.6 && Math.abs(py - (split + H * 0.16)) < 2.5) return dim(shade(P.gold, 3));
      return dim(shade(P.cloth[(s.palette + 1) % 4]!, bx > 2.6 ? 1 : 2));
    }
    if (x >= 17 && x <= 25 && py >= split + 7 && py <= split + 16) {
      if (x === 17 || x === 25 || py === split + 7 || py === split + 16 || x === 21) return dim(shade(tim, 1));
      return dim(shade(P.glass, py < split + 10 ? 2 : 1));
    }
  }
  // stone plinth and plaster
  if (py >= plinthTop) {
    const row = Math.floor((py - plinthTop) / 5);
    const joint = (py - plinthTop) % 5 === 4 || (x + row * 4) % 9 === 0;
    return dim(joint ? shade(P.stone, 0) : shade(P.stone, 2 + (hash2(Math.floor((x + row * 4) / 9), row, s.seed) < 0.4 ? 1 : 0)));
  }
  return plaster();
}

function drawHouse(buf: PixelBuffer, fx: number, s: HouseSpec) {
  const B = HOUSE_H;
  const H = s.wallH;
  for (let x = 0; x < 32; x++) {
    const top = B - 16 - H + Math.floor(x / 2), bot = B - 16 + Math.floor(x / 2);
    for (let y = top; y <= bot; y++) buf.set(fx + x, y, facade(s, (x + 0.5) / 32, y - top, false, x, y));
  }
  for (let x = 0; x < 32; x++) {
    const top = B - H - Math.floor((x + 1) / 2), bot = B - Math.floor((x + 1) / 2);
    for (let y = top; y <= bot; y++) buf.set(fx + 32 + x, y, facade(s, (x + 0.5) / 32, y - top, true, x + 32, y));
  }
  // hip roof: four faces round an apex over the diamond's centre, tiles in courses, eaves overhanging
  const roof = P.roof[s.roof]!;
  const T: Pt = [32, B - 32 - H], L: Pt = [-2, B - 16 - H], Bt: Pt = [32, B - H + 2], Rt: Pt = [66, B - 16 - H], A: Pt = [32, B - 16 - H - s.roofH];
  const course = (x: number, y: number, base: number) => {
    const dy = y - A[1];
    const row = Math.floor(dy / 3);
    const k = (dy % 3 === 2 ? -1 : 0) + ((x + row * 2) % 6 === 0 ? -1 : 0) + (hash2(x, y, s.seed + 9) < 0.04 ? 1 : 0);
    return shade(roof, base + k);
  };
  poly(buf, [T, L, A], (x, y) => course(x, y, 3), fx);
  poly(buf, [T, Rt, A], (x, y) => course(x, y, 2), fx);
  poly(buf, [L, Bt, A], (x, y) => course(x, y, 3), fx);
  poly(buf, [Bt, Rt, A], (x, y) => course(x, y, 1), fx);
  // ridges catch the light
  for (let t = 0; t <= 1; t += 1 / 40) {
    buf.set(fx + Math.round(A[0] + (Bt[0] - A[0]) * t), Math.round(A[1] + (Bt[1] - A[1]) * t), shade(roof, 4));
    buf.set(fx + Math.round(A[0] + (L[0] - A[0]) * t), Math.round(A[1] + (L[1] - A[1]) * t), shade(roof, 4));
  }
  if (s.chimney) {
    const cx = 42, cyTop = A[1] + 2;
    for (let y = cyTop; y < cyTop + 16; y++) for (let x = cx; x < cx + 7; x++) {
      const c = y < cyTop + 2 ? shade(P.stone, 1) : x < cx + 3 ? shade(P.brick, ((y - cyTop) % 3 === 0 ? 1 : 3)) : shade(P.brick, ((y - cyTop) % 3 === 0 ? 0 : 2));
      buf.set(fx + x, y, c);
    }
  }
}

function houseSpec(level: number, palette: number, ground: number, i: number): HouseSpec {
  return { wallH: [68, 80, 94][level]!, roofH: [30, 34, 40][level]!, palette, ground, roof: (palette + level) % 4, chimney: (i * 7) % 3 === 0, seed: 100 + i };
}

// ---------------------------------------------------------------- low garden walls (the near side)

function drawStub(buf: PixelBuffer, fx: number, v: number) {
  const B = STUB_H, H = 16;
  const wall = (u: number, py: number, right: boolean) => {
    const x = Math.floor(u * 32);
    const row = Math.floor(py / 5);
    const joint = py % 5 === 4 || (x + row * 5) % 10 === 0;
    const c = py < 3 ? shade(P.stone, 4) : joint ? shade(P.stone, 0) : shade(P.stone, 2 + (hash2(Math.floor((x + row * 5) / 10), row, v) < 0.35 ? 1 : 0));
    return right ? mix(c, 0x2a2030, 0.24) : c;
  };
  for (let x = 0; x < 32; x++) { const top = B - 16 - H + Math.floor(x / 2); for (let y = top; y <= B - 16 + Math.floor(x / 2); y++) buf.set(fx + x, y, wall((x + 0.5) / 32, y - top, false)); }
  for (let x = 0; x < 32; x++) { const top = B - H - Math.floor((x + 1) / 2); for (let y = top; y <= B - Math.floor((x + 1) / 2); y++) buf.set(fx + 32 + x, y, wall((x + 0.5) / 32, y - top, true)); }
  // coping (top diamond)
  poly(buf, [[32, B - 32 - H], [0, B - 16 - H], [32, B - H], [64, B - 16 - H]], (x, y) => ((x + y) % 7 === 0 ? shade(P.stone, 3) : shade(P.stone, 4)), fx);
  if (v === 0 || v === 2) {
    // a planted bed on the coping: a bush with flowers
    for (let i = 0; i < 240; i++) {
      const a = hash2(i, v, 1) * Math.PI * 2, rr = Math.sqrt(hash2(i, v, 2));
      const x = Math.round(32 + Math.cos(a) * rr * 22), y = Math.round(B - 16 - H - 6 + Math.sin(a) * rr * 9 - (1 - rr) * 6);
      buf.set(fx + x, y, hash2(i, v, 3) < 0.18 ? P.flower[(i + v) % 3]! : shade(P.grass, 1 + Math.floor((1 - rr) * 2.5 + (Math.cos(a) < 0 ? 0.6 : 0))));
    }
  } else if (v === 1) {
    // iron railing posts
    for (let k = 0; k < 7; k++) {
      const x = 4 + k * 9;
      const base = x < 32 ? B - 16 - H + Math.floor(x / 2) : B - H - Math.floor((x - 31) / 2);   // the coping's near edge
      for (let y = base - 12; y < base; y++) buf.set(fx + x, y, shade(P.steel, 0));
      buf.set(fx + x, base - 13, shade(P.gold, 2));
    }
    for (let x = 4; x <= 58; x++) { const base = x < 32 ? B - 16 - H + Math.floor(x / 2) : B - H - Math.floor((x - 31) / 2); buf.set(fx + x, base - 10, shade(P.steel, 0)); }
  } else {
    // a barrel and a crate
    for (let y = 0; y < 14; y++) for (let x = 0; x < 10; x++) buf.set(fx + 18 + x, B - 16 - H - 14 + y + 4, y % 5 === 0 ? shade(P.steel, 1) : shade(P.door, x < 4 ? 3 : 2));
    for (let y = 0; y < 9; y++) for (let x = 0; x < 11; x++) buf.set(fx + 36 + x, B - 16 - H - 8 + y + 2, x === 0 || x === 10 || y === 0 || y === 8 || x === y ? shade(P.door, 1) : shade(P.door, 3));
  }
}

// ---------------------------------------------------------------- fountain

/** Ellipse helper in frame space (centre + world radius scaled 2:1). */
function ell(buf: PixelBuffer, fx: number, cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number, d: number) => number) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (d <= 1) { const c = fn(x, y, d); if (c >= 0) buf.set(fx + x, y, c); }
  }
}

function drawFountain(buf: PixelBuffer, fx: number, f: number) {
  const cx = FOUNTAIN_CX, cy = FOUNTAIN_CY;
  const rx = 98, ry = 49, wallH = 16;
  // basin wall (the near half shows), stone blocks
  for (let x = -rx; x <= rx; x++) {
    const yb = cy + ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
    for (let k = 0; k < wallH; k++) {
      const y = Math.round(yb) - k;
      const row = Math.floor(k / 5), seam = k % 5 === 4 || (x + 200 + row * 7) % 14 === 0;
      const lit = x < -rx * 0.25 ? 1 : x > rx * 0.45 ? -1 : 0;
      buf.set(fx + cx + x, y, seam ? shade(P.stone, 0) : shade(P.stone, 2 + lit + (hash2(Math.floor((x + 200 + row * 7) / 14), row, 5) < 0.3 ? 1 : 0)));
    }
  }
  // the rim (a ring at the wall top) and the water inside
  const top = cy - wallH;
  ell(buf, fx, cx, top, rx, ry, (x, y, d) => {
    if (d > 0.84) {
      const a = Math.atan2((y - top) * 2, x - cx);
      return (Math.floor((a + Math.PI) * 9) % 2 === 0 ? shade(P.stone, 4) : shade(P.stone, 3)) - 0;
    }
    if (d > 0.8) return shade(P.stone, 1);
    // water: ripples running out from the centre, glints that move with the frame
    const rr = Math.sqrt(d);
    const ring = Math.floor((rr * 14 - f * 0.9) % 3);
    const glint = hash2(Math.floor((x - cx) / 3) + f * 17, Math.floor((y - top) / 2), 7) > 0.965;
    if (glint) return shade(P.water, 4);
    return shade(P.water, rr < 0.25 ? 3 : ring === 0 ? 3 : ring === 1 || y < top - ry * 0.3 ? 2 : 1);
  });
  // pedestal, lower bowl, column, upper bowl, finial
  const colX = cx;
  const bowl = (by: number, brx: number, bry: number) => {
    for (let x = -brx; x <= brx; x++) {
      const yb = by + bry * Math.sqrt(Math.max(0, 1 - (x / brx) ** 2));
      for (let k = 0; k < 6; k++) buf.set(fx + colX + x, Math.round(yb) - k + Math.round((1 - Math.abs(x / brx)) * 3), shade(P.stone, x < -brx * 0.3 ? 4 : x > brx * 0.4 ? 1 : 3));
    }
    ell(buf, fx, colX, by - 4, brx, bry, (x, y, d) => (d > 0.72 ? shade(P.stone, 4) : shade(P.water, d < 0.3 ? 3 : (Math.floor(d * 8 + f) % 3 === 0 ? 3 : 2))));
  };
  const column = (y0: number, y1: number, w: number) => {
    for (let y = y1; y <= y0; y++) for (let x = -w; x <= w; x++) buf.set(fx + colX + x, y, shade(P.stone, x < -w * 0.4 ? 4 : x > w * 0.4 ? 1 : 3));
  };
  column(top + 2, top - 44, 7);
  bowl(top - 44, 38, 14);
  column(top - 50, top - 80, 4);
  bowl(top - 80, 20, 8);
  column(top - 86, top - 96, 2);
  ell(buf, fx, colX, top - 100, 4, 4, (_x, _y, d) => shade(P.gold, d < 0.3 ? 3 : 2));
  // water: a spout arcing from the finial, curtains falling from both bowls (droplets slide with the frame)
  for (let k = 0; k < 18; k++) {
    const t = ((k / 18 + f / FOUNTAIN_FRAMES / 3) % 1);
    for (const side of [-1, 1]) {
      const x = colX + side * (2 + t * 16), y = top - 104 - Math.sin(t * Math.PI) * 10 + t * 26;
      buf.set(fx + Math.round(x), Math.round(y), shade(P.water, 4));
    }
  }
  for (const [by, brx, drop] of [[top - 80, 20, 30], [top - 44, 38, 36]] as const) {
    for (let x = -brx + 2; x <= brx - 2; x += 3) {
      const edge = by + 8 * Math.sqrt(Math.max(0, 1 - (x / brx) ** 2));
      if (Math.abs(x) < brx * 0.55 && by === top - 44) continue;
      for (let k = 0; k < drop; k++) {
        const ph = (k + f * 3 + (x & 7)) % 6;
        if (ph < 3) buf.set(fx + colX + x + Math.sign(x) * Math.floor(k / 9), Math.round(edge) + k - 2, ph === 0 ? shade(P.water, 4) : shade(P.water, 3));
      }
    }
  }
  // splash rings where the curtains land
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + f * 0.6;
    const x = colX + Math.cos(a) * 46, y = top + Math.sin(a) * 18 - 2;
    if (hash2(k, f, 3) < 0.7) buf.set(fx + Math.round(x), Math.round(y), shade(P.water, 4));
  }
}

// ---------------------------------------------------------------- market stalls

function drawStall(buf: PixelBuffer, fx: number, alongX: boolean, v: number) {
  const ox = STALL_CX, oy = STALL_CY;
  const S = (lx: number, ly: number, z: number): Pt => { const [a, b] = alongX ? [lx, ly] : [ly, lx]; return [ox + (a - b) * 32, oy + (a + b) * 16 - z]; };
  const quad = (p: Pt[], fn: (x: number, y: number) => number) => poly(buf, p, fn, fx);
  const L = 0.95, Wd = 0.36, H = 18;
  // counter: the two near faces and the top
  quad([S(-L, Wd, 0), S(L, Wd, 0), S(L, Wd, H), S(-L, Wd, H)], (x, y) => ((x * 3 + 7) % 9 === 0 ? shade(P.door, 1) : shade(P.door, 3 - (y % 6 === 0 ? 1 : 0))));
  quad([S(L, -Wd, 0), S(L, Wd, 0), S(L, Wd, H), S(L, -Wd, H)], () => shade(P.door, 1));
  quad([S(-L, -Wd, H), S(L, -Wd, H), S(L, Wd, H), S(-L, Wd, H)], (x, y) => ((x + y * 2) % 11 === 0 ? shade(P.door, 2) : shade(P.door, 4 - 1)));
  // goods: apples, cabbages, loaves, cloth bolts, pots in little heaps along the counter
  const goods = [[0xc8302a, 0xe85a40], [0x5a8a2e, 0x86b44a], [0xb07a3a, 0xd8a45a], [P.cloth[v % 4]![2]!, P.cloth[v % 4]![3]!], [0xa8542e, 0xc87440]];
  for (let k = 0; k < 7; k++) {
    const lx = -L + 0.2 + k * ((2 * L - 0.4) / 6), [c0, c1] = goods[(k + v) % goods.length]!;
    const [px, py] = S(lx, 0, H);
    for (let i = 0; i < 12; i++) {
      const gx = Math.round(px + (hash2(k, i, v) - 0.5) * 9), gy = Math.round(py - 2 - hash2(k, i, v + 1) * 5);
      buf.set(fx + gx, gy, i % 3 === 0 ? c1 : c0);
    }
  }
  // poles and the striped awning (sloping toward the front, scalloped edge)
  for (const [lx, ly] of [[-L - 0.05, -Wd - 0.15], [L + 0.05, -Wd - 0.15], [-L - 0.05, Wd + 0.12], [L + 0.05, Wd + 0.12]] as const) {
    const [a, b] = [S(lx, ly, 0), S(lx, ly, ly < 0 ? 58 : 48)];
    for (let y = Math.round(b[1]); y <= Math.round(a[1]); y++) { buf.set(fx + Math.round(a[0]), y, shade(P.timber, 2)); buf.set(fx + Math.round(a[0]) + 1, y, shade(P.timber, 1)); }
  }
  const [c0, c1] = P.stripe[v % 4]!;
  const steps = 160;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= 50; j++) {
    const lx = -L - 0.12 + (i / steps) * (2 * L + 0.24), t = j / 50;
    const ly = -Wd - 0.2 + t * (2 * Wd + 0.5), z = 60 - t * 14;
    const [x, y] = S(lx, ly, z);
    const stripe = Math.floor(((lx + L + 0.12) / (2 * L + 0.24)) * 9) % 2;
    let c: number = stripe ? c1 : c0;
    if (t < 0.12) c = mix(c, 0xffffff, 0.12); else if (t > 0.85) c = mix(c, 0x000000, 0.18);
    buf.set(fx + Math.round(x), Math.round(y), c);
  }
  // scallops hanging off the front edge
  for (let i = 0; i <= 18; i++) {
    const lx = -L - 0.12 + (i / 18) * (2 * L + 0.24);
    const [x, y] = S(lx, Wd + 0.3, 46);
    const stripe = Math.floor(((lx + L + 0.12) / (2 * L + 0.24)) * 9) % 2;
    for (let k = 0; k < 4 - (i % 2) * 2; k++) buf.set(fx + Math.round(x), Math.round(y) + k, mix(stripe ? c1 : c0, 0x000000, 0.2));
  }
}

// ---------------------------------------------------------------- dummies, racks, banners

function drawDummy(buf: PixelBuffer, fx: number, v: number) {
  const cx = 24, gy = 68;
  const put = (x: number, y: number, c: number) => buf.set(fx + x, y, c);
  // cross-foot and post
  for (let x = -9; x <= 9; x++) { put(cx + x, gy, shade(P.timber, 2)); put(cx + x, gy - 1, shade(P.timber, 3)); }
  for (let y = gy - 20; y < gy; y++) { put(cx - 1, y, shade(P.timber, 3)); put(cx, y, shade(P.timber, 2)); put(cx + 1, y, shade(P.timber, 1)); }
  // straw body, bound with rope
  for (let y = gy - 46; y <= gy - 18; y++) {
    const k = (y - (gy - 32)) / 14;
    const w = Math.round(9 * Math.sqrt(Math.max(0, 1 - k * k * 0.7)));
    for (let x = -w; x <= w; x++) {
      const rope = (y - gy) % 7 === 0;
      const tuft = hash2(x, y, v) < 0.15;
      put(cx + x, y, rope ? shade(P.burlap, 1) : shade(P.straw, (x < -w / 3 ? 3 : x > w / 3 ? 1 : 2) + (tuft ? 1 : 0)));
    }
  }
  // arms: the crossbar with straw bundles
  for (let x = -15; x <= 15; x++) { put(cx + x, gy - 40, shade(P.timber, 2)); if (Math.abs(x) > 9) { put(cx + x, gy - 41, shade(P.straw, 3)); put(cx + x, gy - 39, shade(P.straw, 1)); } }
  // target on the chest
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
    const d = Math.hypot(x, y);
    if (d <= 4.2) put(cx + x, gy - 31 + y, d < 1.4 ? 0xd8282a : d < 2.6 ? 0xf2eadc : d < 3.6 ? 0xd8282a : 0xf2eadc);
  }
  // head: a burlap sack with stitched eyes (or an old pot helm)
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    if (x * x + y * y > 38) continue;
    let c = shade(P.burlap, x < -2 ? 3 : x > 2 ? 1 : 2);
    if (v === 1 && y < -1) c = shade(P.steel, x < -2 ? 3 : x > 2 ? 1 : 2);
    if ((Math.abs(x + 2) === Math.abs(y) || Math.abs(x - 2) === Math.abs(y)) && y >= -1 && y <= 1 && (x === -3 || x === -1 || x === 1 || x === 3 || (y === 0 && Math.abs(x) === 2))) c = OUT;
    if (y === 3 && Math.abs(x) <= 2) c = OUT;
    put(cx + x, gy - 54 + y, c);
  }
}

function drawRack(buf: PixelBuffer, fx: number, v: number) {
  const cx = 28, gy = 60;
  const put = (x: number, y: number, c: number) => buf.set(fx + x, y, c);
  // frame: two uprights, two rails
  for (const ux of [-18, 18]) for (let y = gy - 34; y <= gy; y++) { put(cx + ux, y, shade(P.timber, 3)); put(cx + ux + 1, y, shade(P.timber, 1)); }
  for (const ry of [gy - 30, gy - 8]) for (let x = -18; x <= 19; x++) { put(cx + x, ry, shade(P.timber, 3)); put(cx + x, ry + 1, shade(P.timber, 1)); }
  // weapons standing in it: swords, a spear, an axe
  const blades = v === 0 ? [-12, -6, 0, 6] : [-13, -4, 5];
  for (const bx of blades) {
    for (let y = gy - 44; y <= gy - 9; y++) { put(cx + bx, y, shade(P.steel, 3)); put(cx + bx + 1, y, shade(P.steel, 1)); }
    put(cx + bx, gy - 45, shade(P.steel, 4));
    for (let x = -2; x <= 3; x++) put(cx + bx + x, gy - 14, shade(P.gold, 2));
    for (let y = gy - 13; y <= gy - 9; y++) put(cx + bx, y, shade(P.door, 2));
  }
  for (let y = gy - 50; y <= gy - 2; y++) put(cx + 12, y, shade(P.door, 3));
  for (let k = 0; k < 5; k++) for (let x = -k; x <= k; x++) put(cx + 12 + x, gy - 56 + k, shade(P.steel, 3 - (x > 0 ? 1 : 0)));
  // a painted round shield leaning in front
  const sc = P.cloth[v % 4]!;
  for (let y = -8; y <= 8; y++) for (let x = -7; x <= 7; x++) {
    const d = (x / 7.5) ** 2 + (y / 8.5) ** 2;
    if (d > 1) continue;
    put(cx - 6 + x, gy - 9 + y, d > 0.78 ? shade(P.steel, 1) : d < 0.08 ? shade(P.gold, 3) : (x > 0) !== (y > 0) ? shade(sc, 2) : 0xf2eadc);
  }
}

function drawBanner(buf: PixelBuffer, fx: number, color: number, frame: number) {
  const cx = 20, gy = BANNER_H - 4;
  const put = (x: number, y: number, c: number) => buf.set(fx + x, y, c);
  for (let y = 10; y <= gy; y++) { put(cx, y, shade(P.timber, 3)); put(cx + 1, y, shade(P.timber, 1)); }
  for (let y = 5; y <= 9; y++) for (let x = -1; x <= 2; x++) put(cx + x, y, shade(P.gold, y < 7 ? 3 : 2));
  for (let x = -9; x <= 10; x++) { put(cx + x, 15, shade(P.timber, 2)); }
  put(cx - 9, 16, shade(P.gold, 2)); put(cx + 10, 16, shade(P.gold, 2));
  const cl = P.cloth[color]!;
  const len = 56;
  for (let y = 0; y < len; y++) {
    const sway = Math.round(Math.sin(y / 9 + frame * 2.1) * (y / len) * 3);
    const tail = y > len - 9 ? Math.abs(y - (len - 9)) : 0;
    for (let x = -8; x <= 9; x++) {
      if (tail && Math.abs(x - 0.5) < tail * 0.9) continue;   // swallowtail
      let c = shade(cl, x < -4 ? 3 : x > 5 ? 1 : 2);
      if (y < 2) c = shade(P.gold, 2);
      // emblem: a gold star / cross / crown / tower by colour
      const ex = x - 0.5, ey = y - 18;
      const emb = color === 0 ? Math.abs(ex) + Math.abs(ey) * 0.6 < 4 && (Math.abs(ex) < 1 || Math.abs(ey) < 1.5 || Math.abs(Math.abs(ex) - Math.abs(ey) * 0.6) < 1)
        : color === 1 ? (Math.abs(ex) < 1.2 && Math.abs(ey) < 6) || (Math.abs(ey + 1) < 1.2 && Math.abs(ex) < 4.5)
        : color === 2 ? ey > -3 && ey < 3 && Math.abs(ex) < 5 && (ey > 0 || Math.round(ex + 5) % 3 === 0)
        : Math.abs(ex) < 3.5 && ey > -5 && ey < 5 && !(ey < -2 && Math.round(ex + 4) % 2 === 1);
      if (emb) c = shade(P.gold, 3);
      put(cx + x + sway, 17 + y, c);
    }
  }
}

// ---------------------------------------------------------------- sheets

export interface Sheet { key: string; w: number; h: number; rgba: Uint8ClampedArray; fw: number; fh: number; count: number }

function sheet(key: string, fw: number, fh: number, count: number, draw: (buf: PixelBuffer, fx: number, i: number) => void, outline = true): Sheet {
  const buf = new PixelBuffer(fw * count, fh);
  for (let i = 0; i < count; i++) {
    const one = new PixelBuffer(fw, fh);
    draw(one, 0, i);
    if (outline) outlinePass(one, OUT);
    one.copyTo(buf, i * fw, 0);
  }
  return { key, w: buf.w, h: buf.h, rgba: buf.toRGBA(), fw, fh, count };
}

let cache: Sheet[] | null = null;

/** Every courtyard texture sheet (generated once per page). */
export function courtyardSheets(): Sheet[] {
  if (cache) return cache;
  cache = [
    sheet(CY.house, HOUSE_W, HOUSE_H, HOUSE_FRAMES, (b, fx, i) => {
      if (i >= GATE_FRAME) drawHouse(b, fx, { wallH: 100, roofH: 36, palette: i - GATE_FRAME, ground: 0, roof: 1, chimney: false, gate: true, seed: 900 + i });
      else drawHouse(b, fx, houseSpec(Math.floor(i / 12), Math.floor((i % 12) / 3), i % 3, i));
    }),
    sheet(CY.stub, STUB_W, STUB_H, STUB_FRAMES, (b, fx, i) => drawStub(b, fx, i)),
    sheet(CY.fountain, FOUNTAIN_W, FOUNTAIN_H, FOUNTAIN_FRAMES, (b, fx, i) => drawFountain(b, fx, i)),
    sheet(CY.stall, STALL_W, STALL_H, STALL_FRAMES, (b, fx, i) => drawStall(b, fx, i < 4, i % 4)),
    sheet(CY.dummy, DUMMY_W, DUMMY_H, DUMMY_FRAMES, (b, fx, i) => drawDummy(b, fx, i)),
    sheet(CY.rack, RACK_W, RACK_H, RACK_FRAMES, (b, fx, i) => drawRack(b, fx, i)),
    sheet(CY.banner, BANNER_W, BANNER_H, BANNER_FRAMES, (b, fx, i) => drawBanner(b, fx, Math.floor(i / 3), i % 3)),
    sheet(CY.smoke, 8, 8, 1, (b) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const d = Math.hypot(x - 3.5, y - 3.5); if (d < 3.6) b.set(x, y, d < 2 ? 0xe8e4e0 : 0xb8b4b0, d < 2 ? 220 : 150); } }, false),
    sheet(CY.petal, 3, 3, 1, (b) => { b.set(1, 0, 0xf6b8c8); b.set(0, 1, 0xf09ab4); b.set(1, 1, 0xfcd4de); b.set(2, 1, 0xf09ab4); b.set(1, 2, 0xe07a98); }, false),
  ];
  return cache;
}
