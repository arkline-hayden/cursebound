/**
 * Room FLOOR overlays for every dungeon theme (framework-free).
 *
 * A second deco sheet next to buildDecoFrames(): bigger, composable floor pieces the room planner lays
 * down on top of the macro floor. Every frame uses the identical 64x40 deco format (8 px headroom + the
 * 64x32 diamond, colour + Light2D normal + unlit emissive), painted in tile texel space (32x32 texels per
 * tile, texel x = world x, texel y = world y) on TexCanvases and resampled with canvasTile().
 *
 * Seams: multi-tile pieces are painted as ONE virtual object and cut into tiles, so neighbours always
 * agree; repeatable pieces (rug / pool edges + centres, planks, bridge decks, gutters, sand, bones,
 * checker) only use texel-periodic functions (period 32) along their repeat axes, are painted into the
 * centre tile of a 3x3 canvas plus a 1-texel ring (so normals wrap too), and keep per-variant detail
 * strictly inside the tile so variants can be mixed freely.
 *
 *  - rug*      nine-slice rug: woven border, fringe on the W/E ends, lozenge field, wear and stains
 *  - mos0..15  4x4 round inlaid tessera medallion (transparent outside the circle)
 *  - pool*     nine-slice shallow basin: stone curb, visible far inner walls, sunken themed liquid
 *  - plank*    floorboards along world x with staggered joints and nails
 *  - bridge*   deck over a chasm, planks across the walking direction, heavy side beam + rail posts/rope
 *  - checker*  polished marble checkerboard (2x2 squares per tile)
 *  - bones*    paving of packed bones and skulls;  rubble* / straw* / coins* / growth* / ash*: partial
 *  - chanX/Y   narrow blood gutter;  drain: round iron grate
 *  - sand*     raked arena sand (2/3 with dried blood)
 *  - sigil*    6x6 glowing ritual circle;  rose*: 6x6 inlaid stone compass rose
 */
import { MATERIALS } from './palette';
import { bayer, rng, type Ramp } from './draw/pixel';
import { TILE, encodeNormal, hashi, mixc, pnoiseP, scalec, tone } from './isoKit';
import { DECO_H, DECO_TOP, DECO_W, FLOOR_MATS, GOLD, LAVA, MYCELIUM, TexCanvas, canvasTile, type DecoFrame, type FloorMat } from './isoFloor';
import type { ThemeId } from './dungeonThemes';

const T = TILE;
const TAU = Math.PI * 2;
const R = (...c: number[]): Ramp => Object.freeze(c);
/** Wrap a texel coordinate into one tile. */
const W32 = (v: number): number => ((v % T) + T) % T;
const nzCache = new Map<number, Float32Array>();
/** Tile-periodic value noise at integer texels (memoised 32x32 field per cell + seed; cleared per build). */
function nz(x: number, y: number, cell: number, seed: number): number {
  const key = seed * 64 + cell;
  let f = nzCache.get(key);
  if (!f) {
    f = new Float32Array(T * T);
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) f[j * T + i] = pnoiseP(i, j, cell, T, seed);
    nzCache.set(key, f);
  }
  return f[W32(Math.floor(y)) * T + W32(Math.floor(x))]!;
}

/** Room-floor frame names (index = frame). Same list for every theme; content is themed. */
export const ROOM_FLOOR_NAMES = [
  'rugNW', 'rugN', 'rugNE', 'rugW', 'rugC', 'rugE', 'rugSW', 'rugS', 'rugSE',
  'mos0', 'mos1', 'mos2', 'mos3', 'mos4', 'mos5', 'mos6', 'mos7',
  'mos8', 'mos9', 'mos10', 'mos11', 'mos12', 'mos13', 'mos14', 'mos15',
  'poolNW', 'poolN', 'poolNE', 'poolW', 'poolC', 'poolE', 'poolSW', 'poolS', 'poolSE', 'poolC1', 'poolC2',
  'plank0', 'plank1', 'plank2', 'plank3',
  'bridgeX', 'bridgeXN', 'bridgeXS', 'bridgeY', 'bridgeYW', 'bridgeYE',
  'checker0', 'checker1',
  'bones0', 'bones1', 'bones2',
  'rubble0', 'rubble1', 'rubble2',
  'chanX', 'chanY', 'drain',
  'straw0', 'straw1',
  'coins0', 'coins1',
  'sand0', 'sand1', 'sand2', 'sand3',
  'growth0', 'growth1', 'growth2',
  'ash0', 'ash1',
  'sigil0', 'sigil1', 'sigil2', 'sigil3', 'sigil4', 'sigil5',
  'sigil6', 'sigil7', 'sigil8', 'sigil9', 'sigil10', 'sigil11',
  'sigil12', 'sigil13', 'sigil14', 'sigil15', 'sigil16', 'sigil17',
  'sigil18', 'sigil19', 'sigil20', 'sigil21', 'sigil22', 'sigil23',
  'sigil24', 'sigil25', 'sigil26', 'sigil27', 'sigil28', 'sigil29',
  'sigil30', 'sigil31', 'sigil32', 'sigil33', 'sigil34', 'sigil35',
  'rose0', 'rose1', 'rose2', 'rose3', 'rose4', 'rose5',
  'rose6', 'rose7', 'rose8', 'rose9', 'rose10', 'rose11',
  'rose12', 'rose13', 'rose14', 'rose15', 'rose16', 'rose17',
  'rose18', 'rose19', 'rose20', 'rose21', 'rose22', 'rose23',
  'rose24', 'rose25', 'rose26', 'rose27', 'rose28', 'rose29',
  'rose30', 'rose31', 'rose32', 'rose33', 'rose34', 'rose35',
] as const;
export type RoomFloorName = (typeof ROOM_FLOOR_NAMES)[number];
export const ROOM_FLOOR: Record<RoomFloorName, number> = Object.fromEntries(ROOM_FLOOR_NAMES.map((n, i) => [n, i])) as Record<RoomFloorName, number>;

// ---------------------------------------------------------------- theme materials

type Liquid = 'water' | 'murk' | 'blood' | 'lava' | 'ice' | 'glow';

interface RoomKit {
  theme: ThemeId;
  M: FloorMat;
  seed: number;
  rug: { field: Ramp; border: Ramp; accent: Ramp; fringe: Ramp; fur: boolean };
  stain: number;
  liquid: Liquid;
  liq: Ramp;
  /** light dressed stone (pool curbs, gutters, rose) / dark stone / inlay accent */
  stoneA: Ramp;
  stoneB: Ramp;
  accent: Ramp;
  wood: Ramp;
  nail: Ramp;
  rope: Ramp;
  chkA: Ramp;
  chkB: Ramp;
  /** gilt joint lines between checker squares (sanctum) */
  chkGold: boolean;
  /** mosaic palette: ground, primary, secondary, accent */
  mos: readonly [Ramp, Ramp, Ramp, Ramp];
  bone: Ramp;
  sand: Ramp;
  growth: Ramp;
  shroom: Ramp;
  straw: Ramp;
  sigil: Ramp;
  blood: Ramp;
}

const BLOOD_OLD = R(0x0a0203, 0x1a0406, 0x2e080c, 0x4a1016, 0x74222a);
const ASH = R(0x0a0909, 0x1a1817, 0x2e2a28, 0x4a4542, 0x6e6864);
const ICE = R(0x18324e, 0x285072, 0x427ca4, 0x7cb4dc, 0xd0eeff);
const RUBY = R(0x3a0408, 0x8a0e1a, 0xd8283a, 0xff8090, 0xffe0e8);
const EMERALD = R(0x02200e, 0x0a5a28, 0x22a04a, 0x8ae8a0, 0xe0ffe8);
const SAPPHIRE = R(0x061038, 0x14308a, 0x3a6ae0, 0x9ac0ff, 0xeef4ff);
const HEMP = R(0x22160a, 0x423018, 0x6a4e2c, 0x927248, 0xb89a6a);
const BLACK_MARBLE = R(0x070608, 0x0e0c0f, 0x181419, 0x241e25, 0x362d37);
const BONE_MARBLE = R(0x44382c, 0x685a48, 0x8e7e64, 0xb4a484, 0xd8ccae);

function makeKit(theme: ThemeId): RoomKit {
  const M = FLOOR_MATS[theme];
  const seed = 31000 + theme.length * 131 + theme.charCodeAt(0) * 7;
  const base = {
    theme,
    M,
    seed,
    stain: 0x120406,
    blood: BLOOD_OLD,
    nail: MATERIALS.iron,
    rope: HEMP,
    chkA: BLACK_MARBLE,
    chkB: BONE_MARBLE,
    chkGold: false,
    bone: MATERIALS.boneDry,
    shroom: R(0x3a2a1c, 0x6a5034, 0x9a7a52, 0xc8aa7c, 0xeeddb8),
    straw: R(0x2e2210, 0x56421e, 0x86682e, 0xb08c42, 0xd4b064),
  };
  switch (theme) {
    case 'flooded':
      return {
        ...base,
        rug: {
          field: R(0x0a120a, 0x121e12, 0x1c2c1a, 0x283c24, 0x384e30),
          border: R(0x061412, 0x0c2422, 0x143634, 0x204c48, 0x306660),
          accent: R(0x0c201c, 0x1a3a32, 0x2c5a4c, 0x447c68, 0x64a088),
          fringe: R(0x141a12, 0x222c1e, 0x34402c, 0x48563c, 0x5e6e4e),
          fur: false,
        },
        stain: 0x040a08,
        liquid: 'water',
        liq: M.water,
        stoneA: R(0x10181c, 0x1c282e, 0x2a3a42, 0x3c5058, 0x566e76),
        stoneB: M.alt,
        accent: R(0x0e2a26, 0x1a463e, 0x2a6a5c, 0x48927e, 0x76baa2),
        wood: R(0x0a0e0c, 0x141a16, 0x202820, 0x2e3a2c, 0x40503c),
        nail: MATERIALS.rust,
        mos: [R(0x0c1214, 0x162024, 0x203034, 0x2e4248, 0x40585e), R(0x08201e, 0x0e3a36, 0x18584e, 0x2a7c6c, 0x48a48c), M.growth, R(0x3a4a44, 0x5a6e66, 0x7e948a, 0xa4baae, 0xcce0d4)],
        bone: R(0x2a2e24, 0x50543e, 0x7a7c5c, 0xa4a47e, 0xc8c8a2),
        sand: R(0x1c2420, 0x2a342c, 0x3a463a, 0x4e5c4a, 0x667462),
        growth: M.growth,
        straw: R(0x1a1c10, 0x30321c, 0x4a4a2a, 0x64623a, 0x807c4e),
        sigil: MATERIALS.ghostFire,
      };
    case 'ossuary':
      return {
        ...base,
        rug: {
          field: R(0x342a20, 0x524436, 0x72624c, 0x928064, 0xb0a07e),
          border: R(0x160c06, 0x281608, 0x3c2410, 0x52341a, 0x6a4626),
          accent: R(0x1a1008, 0x2e1e10, 0x463020, 0x604630, 0x806044),
          fringe: R(0x4a3e30, 0x6e604c, 0x948468, 0xb8a888, 0xd8ccb0),
          fur: false,
        },
        stain: 0x1e0c06,
        liquid: 'murk',
        liq: R(0x0c0906, 0x18120a, 0x281e12, 0x42341e, 0x6c5a3a),
        stoneA: R(0x3e3226, 0x5e4e3c, 0x806e56, 0xa28e72, 0xc0ae90),
        stoneB: R(0x1a120a, 0x2c1e12, 0x40301e, 0x56422c, 0x6e583c),
        accent: MATERIALS.boneDry,
        wood: R(0x2a2016, 0x45372a, 0x635240, 0x857158, 0xa48e70),
        mos: [R(0x1a120a, 0x2c1e12, 0x40301e, 0x56422c, 0x6e583c), MATERIALS.boneDry, R(0x1e0806, 0x36100a, 0x521a12, 0x6e2a1c, 0x8c3e2a), R(0x4a3e30, 0x7c6e5a, 0xa89878, 0xcabc9a, 0xe8dcc0)],
        sand: R(0x4a3e2e, 0x685842, 0x88765a, 0xa69476, 0xc4b294),
        growth: R(0x1e1a10, 0x34301c, 0x4e4a2a, 0x6c683c, 0x8c8650),
        sigil: R(0x14300a, 0x2e6a12, 0x6ac424, 0xbcff6a, 0xf0ffd0),
      };
    case 'sanctum':
      return {
        ...base,
        rug: {
          field: R(0x1c0306, 0x32060c, 0x4c0a14, 0x6a121e, 0x8a1e2a),
          border: R(0x140204, 0x260408, 0x3a0810, 0x520e18, 0x6c1822),
          accent: GOLD,
          fringe: R(0x3a2408, 0x6a4a14, 0x9a7428, 0xc89e44, 0xe8c86c),
          fur: false,
        },
        stain: 0x060102,
        liquid: 'blood',
        liq: M.water,
        stoneA: R(0x0e0a10, 0x1a141c, 0x282030, 0x3a3044, 0x50445c),
        stoneB: R(0x1a0306, 0x2e060c, 0x480c14, 0x64141e, 0x86222c),
        accent: GOLD,
        wood: R(0x0e0406, 0x1c080a, 0x2c0e10, 0x421818, 0x5c2422),
        nail: GOLD,
        rope: R(0x2a0408, 0x520a12, 0x7e1620, 0xa83040, 0xd05a60),
        chkA: R(0x050406, 0x0c0a0e, 0x16121a, 0x221c26, 0x342a38),
        chkB: R(0x1a0306, 0x300509, 0x4c0a10, 0x6c141c, 0x902430),
        chkGold: true,
        mos: [BLACK_MARBLE, R(0x1c0306, 0x32060c, 0x4c0a14, 0x6a121e, 0x8a1e2a), R(0x0a0a1e, 0x141434, 0x20204e, 0x30306c, 0x46468c), GOLD],
        sand: R(0x4a3820, 0x6c5430, 0x907044, 0xb4925c, 0xd4b47c),
        growth: R(0x0a100a, 0x142014, 0x1e301c, 0x2c4426, 0x3e5a32),
        shroom: MATERIALS.bloodRed,
        sigil: R(0x4a0606, 0xa01414, 0xf04020, 0xffb050, 0xfff0c0),
      };
    case 'fungal':
      return {
        ...base,
        rug: {
          field: R(0x061412, 0x0a2420, 0x103632, 0x184a44, 0x24625a),
          border: R(0x120a1c, 0x201232, 0x301c4a, 0x442a66, 0x5c3c88),
          accent: R(0x2a1a3a, 0x4a3060, 0x6e4c8a, 0x9a74b4, 0xc8a8dc),
          fringe: R(0x1a1424, 0x2c2238, 0x40344e, 0x584a66, 0x726282),
          fur: false,
        },
        stain: 0x0a0604,
        liquid: 'glow',
        liq: R(0x041410, 0x082a22, 0x10483a, 0x24907a, 0x9af4dc),
        stoneA: M.stone,
        stoneB: M.alt,
        accent: R(0x1a2e28, 0x2a4a40, 0x3e6c5c, 0x5a907c, 0x84b8a0),
        wood: R(0x120c08, 0x20160e, 0x302216, 0x42301e, 0x564028),
        nail: MATERIALS.rust,
        mos: [M.alt, R(0x061412, 0x0a2420, 0x103632, 0x184a44, 0x24625a), R(0x120a1c, 0x201232, 0x301c4a, 0x442a66, 0x5c3c88), R(0x1e3a34, 0x2e6058, 0x4a9484, 0x7ec8b4, 0xc0f0e0)],
        sand: R(0x2a2218, 0x3e3224, 0x544432, 0x6c5a42, 0x887454),
        growth: M.growth,
        shroom: MYCELIUM,
        sigil: MYCELIUM,
      };
    case 'forge':
      return {
        ...base,
        rug: {
          field: R(0x0a0808, 0x131010, 0x1e1918, 0x2a2321, 0x3a302c),
          border: R(0x2a0802, 0x501604, 0x802808, 0xb84812, 0xe8782a),
          accent: R(0x3a2410, 0x5e3c1c, 0x8a5a2c, 0xb47e44, 0xd8a466),
          fringe: R(0x0c0a0a, 0x1a1614, 0x2a2420, 0x3a322c, 0x4c423a),
          fur: true,
        },
        stain: 0x020101,
        liquid: 'lava',
        liq: LAVA,
        stoneA: R(0x141317, 0x222026, 0x323038, 0x46434e, 0x5e5a68),
        stoneB: M.stone,
        accent: MATERIALS.brass,
        wood: R(0x0a0808, 0x141010, 0x201816, 0x2e2420, 0x403028),
        rope: MATERIALS.chain,
        chkA: M.stone,
        chkB: MATERIALS.iron,
        mos: [M.stone, R(0x2a0804, 0x4e1206, 0x7a200a, 0xa83a14, 0xd86020), MATERIALS.iron, MATERIALS.brass],
        bone: R(0x1a1410, 0x3a3028, 0x5e5244, 0x8a7c68, 0xb0a48c),
        sand: R(0x0e0c0c, 0x1a1616, 0x282220, 0x38302c, 0x4c423c),
        growth: R(0x141210, 0x24201c, 0x363028, 0x4a4236, 0x5e5446),
        shroom: R(0x1a0a06, 0x3a160a, 0x5e2610, 0x84401e, 0xa86034),
        straw: R(0x1a120a, 0x302010, 0x4a3418, 0x6a4c24, 0x8a6634),
        sigil: LAVA,
      };
    case 'frost':
      return {
        ...base,
        rug: {
          field: R(0x5e6e82, 0x8292a8, 0xa8b8cc, 0xccd8e6, 0xeef4fa),
          border: R(0x182c48, 0x24426a, 0x365e8e, 0x5484b4, 0x84b0d8),
          accent: R(0x2a3a52, 0x4a6282, 0x7a94b4, 0xaac2dc, 0xdcecf8),
          fringe: R(0x5e6e82, 0x8292a8, 0xa8b8cc, 0xccd8e6, 0xeef4fa),
          fur: true,
        },
        stain: 0x2a3a50,
        blood: R(0x1a0206, 0x3a060c, 0x5a0c14, 0x7e1a22, 0xa83a40),
        liquid: 'ice',
        liq: ICE,
        stoneA: R(0x3a4e66, 0x52688a, 0x6e88aa, 0x94acc8, 0xc0d4e8),
        stoneB: M.stone,
        accent: MATERIALS.silver,
        wood: R(0x1a2028, 0x2a323e, 0x3c4656, 0x566272, 0x7a8898),
        nail: R(0x24344a, 0x3e5878, 0x6a8cb0, 0xa8c8e8, 0xe0f4ff),
        chkA: R(0x8a9cb4, 0xa8bccf, 0xc8d8e8, 0xe4eef8, 0xffffff),
        chkB: R(0x2a4a6e, 0x3c6690, 0x5a88b4, 0x84b0d8, 0xc0e0f8),
        mos: [R(0x1d2838, 0x2a394d, 0x3b4f66, 0x526a86, 0x7690ae), R(0x182c48, 0x24426a, 0x365e8e, 0x5484b4, 0x84b0d8), R(0x8a9cb4, 0xa8bccf, 0xc8d8e8, 0xe4eef8, 0xffffff), MATERIALS.silver],
        bone: R(0x4a5260, 0x7a8494, 0xaab4c2, 0xd4dce6, 0xf4f8ff),
        sand: R(0x6a7c94, 0x8a9cb4, 0xaebed2, 0xd0dcea, 0xeef4fc),
        growth: R(0x2a4050, 0x40606e, 0x5e8890, 0x8ab4b4, 0xc0e0dc),
        shroom: R(0x2a3a52, 0x4a6282, 0x7a94b4, 0xaac2dc, 0xdcecf8),
        straw: R(0x4a4a44, 0x6e6c5e, 0x928e78, 0xb8b49c, 0xdcdccc),
        sigil: R(0x0a2650, 0x2060b0, 0x60b8ff, 0xbce8ff, 0xffffff),
      };
    default:
      return {
        ...base,
        rug: {
          field: R(0x0c0c18, 0x15172a, 0x20243e, 0x2e3454, 0x424a6c),
          border: R(0x221608, 0x3c2810, 0x5a3e18, 0x7c5826, 0x9e7838),
          accent: R(0x2a1c0c, 0x54401e, 0x8a6a34, 0xb8945a, 0xd8bc84),
          fringe: R(0x2a2418, 0x4a4030, 0x6e6248, 0x948664, 0xb4a684),
          fur: false,
        },
        liquid: 'water',
        liq: M.water,
        stoneA: R(0x2a231c, 0x40362c, 0x584a3c, 0x72614e, 0x8e7c64),
        stoneB: M.alt,
        accent: R(0x3e3428, 0x645644, 0x8c7c62, 0xb2a282, 0xd4c6a6),
        wood: R(0x120a06, 0x22150c, 0x342214, 0x4a321e, 0x624428),
        mos: [R(0x1a1612, 0x2a241e, 0x3a322a, 0x4c4236, 0x605444), R(0x0c0c18, 0x15172a, 0x20243e, 0x2e3454, 0x424a6c), R(0x221608, 0x3c2810, 0x5a3e18, 0x7c5826, 0x9e7838), R(0x4a3e30, 0x7c6e5a, 0xa89878, 0xcabc9a, 0xe8dcc0)],
        sand: R(0x2e2418, 0x463824, 0x5e4c32, 0x7a6444, 0x96805a),
        growth: R(0x0e160c, 0x1c2c14, 0x2e461e, 0x48662c, 0x628a3a),
        sigil: MATERIALS.ghostFire,
      };
  }
}

// ---------------------------------------------------------------- canvas helpers

/** Emissive pixel, keeping the stronger of the existing and new glow. */
function glowMax(cv: TexCanvas, x: number, y: number, c: number, a: number): void {
  if (cv.glow.alpha(x, y) >= a) return;
  cv.glowAt(x, y, c, a);
}

/**
 * One repeatable tile: `fn` paints the centre tile of a 3x3 canvas (canvas coords; use W32 / tile-periodic
 * functions) plus a 1-texel ring on the repeat axes so the normal map wraps. `post` may add Painter work.
 */
function seam(fn: ((cv: TexCanvas, x: number, y: number) => void) | null, axes: 'xy' | 'x' | 'y', post?: (cv: TexCanvas) => void): DecoFrame {
  const cv = new TexCanvas(3, 3);
  const rx = axes !== 'y' ? 1 : 0, ry = axes !== 'x' ? 1 : 0;
  if (fn) for (let y = T - ry; y < 2 * T + ry; y++) for (let x = T - rx; x < 2 * T + rx; x++) fn(cv, x, y);
  post?.(cv);
  return canvasTile(cv, 1, 1);
}

/** Single partial tile (content kept away from the tile edges). */
function single(fn: (cv: TexCanvas) => void): DecoFrame {
  const cv = new TexCanvas(1, 1);
  fn(cv);
  return canvasTile(cv, 0, 0);
}

/** Paint a shape at the 9 wrap offsets of a 3x3 seam canvas (bx, by are tile-local). */
function wrapped(bx: number, by: number, draw: (x: number, y: number) => void): void {
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) draw(bx + i * T, by + j * T);
}

/** Organic patch mask for partial overlays: 1 at the core, <=0 outside; always 0 near the tile edges. */
function patch(x: number, y: number, cx: number, cy: number, rx: number, ry: number, seed: number, rough = 0.8): number {
  const e = Math.min(x, y, 31 - x, 31 - y);
  if (e < 1) return -1;
  const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
  const m = 1 - d + (pnoiseP(x, y, 8, T, seed) - 0.5) * rough + (pnoiseP(x, y, 4, T, seed + 1) - 0.5) * rough * 0.5;
  return e < 4 ? Math.min(m, (e - 1) / 3 - 0.2 + m * 0.5) : m;
}

// ---------------------------------------------------------------- rug (nine-slice)

/** Fur strands: texel diagonals are screen-vertical, 4-texel segments, tile-periodic. */
function furTex(rx: number, ry: number, seed: number): number {
  const col = W32(rx - ry);
  const seg = W32(ry + Math.floor(hashi(col, 1, seed) * 4)) >> 2;
  return (hashi(col, seg, seed + 2) - 0.5) * 0.9;
}

/** A tw x th rug occupying tiles 1..tw / 1..th of a (tw+2) x (th+2) canvas. */
function paintRug(cv: TexCanvas, k: RoomKit, tw: number, th: number): void {
  const { field, border, accent, fringe, fur } = k.rug;
  const rw = tw * T, rh = th * T;
  const IY = 3, IX = 6;
  for (let y = T - 1; y <= (th + 1) * T; y++)
    for (let x = T - 1; x <= (tw + 1) * T; x++) {
      const rx = x - T, ry = y - T;
      if (rx < 0 || ry < 0 || rx >= rw || ry >= rh) continue;
      const lx = W32(rx), ly = W32(ry);
      const dN = ry - IY, dS = rh - 1 - IY - ry, dW = rx - IX, dE = rw - 1 - IX - rx;
      if (dN < 0 || dS < 0) {
        // contact shadow under the south edge
        if (dS === -1 && dW >= 0 && dE >= 0) cv.set(x, y, 0x000000, -0.1, 120);
        continue;
      }
      if (dW < 0 || dE < 0) {
        // fringe: knotted tassels on the W / E ends
        const out = dW < 0 ? -dW : -dE;
        const side = dW < 0 ? 1 : 2;
        if (ly & 1) {
          if (out === 1) cv.set(x, y, tone(fringe, 0.8), 0.3);
          continue;
        }
        const len = 2 + Math.floor(hashi(ly, side, k.seed + 31) * 3.6);
        if (out > len) continue;
        const v = out === 1 ? 1.1 : out === len ? 1.4 : 2.3 + (hashi(ly, side + 4, k.seed) - 0.5) * 0.9 + bayer(x, y) * 0.4;
        cv.set(x, y, tone(fringe, v), 0.32 - out * 0.04);
        continue;
      }
      const d = Math.min(dN, dS, dW, dE);
      const far = d === dS || d === dE;
      const tex = fur ? furTex(rx, ry, k.seed) : ((lx - ly + 64) & 3) < 2 ? 0.2 : -0.12;
      let c: number;
      let h = 0.5;
      if (d === 0) {
        c = tone(border, (far ? 0.4 : 2.9) + bayer(x, y) * 0.3);
        h = far ? 0.3 : 0.7;
      } else if (d <= 6) {
        const ex = Math.min(dW, dE), ey = Math.min(dN, dS);
        h = 0.62;
        if (ex <= 6 && ey <= 6) {
          // corner rosette block
          const m = Math.max(Math.abs(ex - 3.5), Math.abs(ey - 3.5));
          c = m > 2 ? tone(accent, 2.1 + tex) : m > 1 ? tone(border, 1.3 + tex) : tone(accent, 3.5);
          if (m <= 1) h = 0.78;
        } else {
          const along = ey <= 6 ? lx : ly;
          const ac = d - 1;
          if (ac === 0 || ac === 5) c = tone(accent, 1.6 + tex + bayer(x, y) * 0.3);
          else if (fur) {
            // leather / ice trim band with lacing stitches
            c = tone(border, 2 + tex * 0.6 + (ac === 1 ? 0.6 : ac === 4 ? -0.5 : 0) + bayer(x, y) * 0.35);
            if ((ac === 2 || ac === 3) && along % 4 === (ac === 2 ? 0 : 1)) {
              c = tone(accent, 3.4);
              h = 0.75;
            }
          } else {
            // woven zigzag running along the edge (period 8)
            const tri = Math.abs((along % 8) - 3.5);
            const line = Math.abs(tri - (ac - 0.5)) < 0.6;
            c = line ? tone(accent, 2.9 + tex) : tri > ac - 0.5 ? tone(border, 2.3 + tex + bayer(x, y) * 0.35) : tone(border, 1.3 + tex + bayer(x, y) * 0.35);
            if (line) h = 0.72;
          }
        }
      } else if (d === 7) {
        c = tone(accent, 0.9);
        h = 0.45;
      } else if (fur) {
        // pelt: forge = striped beast hide, frost = spotted white fur; a stitched lozenge per tile
        let fv = 2.5 + tex * 1.8 + bayer(x, y) * 0.3;
        const warp = nz(rx, ry, 16, k.seed + 8);
        if (k.theme === 'forge') {
          if (Math.sin(((lx + ly) * TAU) / 16 + warp * 5) > 0.55) fv -= 1.4;
        } else {
          const sp = nz(rx, ry, 8, k.seed + 7);
          if (Math.abs(sp - 0.62) < 0.045) fv -= 1.3;
          else if (sp > 0.665) fv -= 0.5;
        }
        c = tone(field, fv);
        h = 0.55 + tex * 0.3;
        const q = Math.max(Math.abs(lx - 15.5), Math.abs(ly - 15.5));
        if (Math.abs(q - 9.5) < 0.6 && ((lx + ly) & 3) < 2) {
          c = tone(accent, 3);
          h = 0.7;
        }
      } else {
        // lozenge medallion per tile (texel squares read as screen diamonds), small lozenges where tiles meet
        const fx = Math.abs(lx - 15.5), fy = Math.abs(ly - 15.5);
        const q = Math.max(fx, fy);
        const cor = 16 - Math.min(fx, fy);
        const diag = Math.abs(fx - fy) < 0.8;
        if (Math.abs(q - 10) < 0.75) {
          c = tone(accent, 2.6 + tex);
          h = 0.58;
        } else if (q < 10) {
          if (q < 2) c = tone(accent, 3.5);
          else if (q < 3) c = tone(border, 1.2);
          else if (diag && q < 7) c = tone(accent, 2.3 + tex);
          else if (Math.abs(q - 6.5) < 0.6) c = tone(border, 2.7 + tex);
          else c = tone(field, (q > 6.5 ? 2.6 : 3) + tex + bayer(x, y) * 0.35);
        } else if (cor < 4.5) c = cor < 1.6 ? tone(accent, 3) : tone(border, 2.2 + tex + bayer(x, y) * 0.3);
        else c = tone(field, 1.5 + tex + bayer(x, y) * 0.4);
      }
      // wear: threadbare patches and grime (tile-periodic so every repeat agrees)
      const wn = nz(rx, ry, 16, k.seed + 41) * 0.65 + nz(rx, ry, 4, k.seed + 42) * 0.35;
      if (wn > 0.64 && (wn - 0.64) * 5 + bayer(x, y) > 0.35) {
        c = mixc(c, tone(fringe, 1.6), 0.5);
        h -= 0.08;
      } else if (wn < 0.3) c = mixc(c, 0x050304, (0.3 - wn) * 1.4);
      // stains: blobs inside some edge / corner frames, never across a tile edge
      const tx = rx >> 5, ty = ry >> 5;
      if (!(tx > 0 && tx < tw - 1 && ty > 0 && ty < th - 1) && hashi(tx, ty, k.seed + 43) < 0.5) {
        const scx = 10 + hashi(tx, ty, k.seed + 44) * 12, scy = 10 + hashi(tx, ty, k.seed + 45) * 12;
        const sd = Math.hypot(lx + 0.5 - scx, ly + 0.5 - scy) / (3.5 + hashi(tx, ty, k.seed + 46) * 2.5) + (nz(rx, ry, 4, k.seed + 47) - 0.5) * 0.6;
        if (sd < 1) c = mixc(c, k.stain, sd > 0.75 ? 0.3 : 0.55);
      }
      cv.set(x, y, c, h + tex * 0.25);
    }
}

// ---------------------------------------------------------------- liquids + pool (nine-slice)

const LQ = { c: 0, h: 0, g: 0, ga: 0 };

/**
 * Tile-periodic Worley edge distance (F2 - F1, texels) for jittered points on a `cell` grid. Edges between a
 * hashed subset of neighbouring cells are dropped (returns 99) so the network does not read as a grid.
 */
function cellEdge(px: number, py: number, cell: number, seed: number, keep = 1): number {
  const n = T / cell;
  const lx = W32(px), ly = W32(py);
  const cx = Math.floor(lx / cell), cy = Math.floor(ly / cell);
  let f1 = 1e9, f2 = 1e9, i1 = 0, i2 = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const hx = ((gx % n) + n) % n, hy = ((gy % n) + n) % n;
      const qx = (gx + 0.05 + hashi(hx, hy, seed) * 0.9) * cell, qy = (gy + 0.05 + hashi(hx, hy, seed + 1) * 0.9) * cell;
      const d = Math.hypot(lx + 0.5 - qx, ly + 0.5 - qy);
      const id = (gy + 8) * 64 + gx + 8;
      if (d < f1) {
        f2 = f1;
        i2 = i1;
        f1 = d;
        i1 = id;
      } else if (d < f2) {
        f2 = d;
        i2 = id;
      }
    }
  if (keep < 1) {
    // gate per neighbour pair, using the pair's offset pattern wrapped into the tile so repeats agree
    const ax = W32((i1 % 64) * cell), ay = W32(Math.floor(i1 / 64) * cell), bx = W32((i2 % 64) * cell), by = W32(Math.floor(i2 / 64) * cell);
    const key = ax < bx || (ax === bx && ay < by) ? [ax, ay, bx, by] : [bx, by, ax, ay];
    if (hashi(key[0]! * 33 + key[1]!, key[2]! * 33 + key[3]!, seed + 2) > keep) return 99;
  }
  return f2 - f1;
}

/** Themed liquid at pool-local texel (px, py); depth 0 at the basin wall .. 1 deep. Result in LQ. */
function liquidAt(k: RoomKit, px: number, py: number, depth: number, x: number, y: number): void {
  const L = k.liq;
  const n = nz(px, py, 16, k.seed + 51) * 0.6 + nz(px, py, 8, k.seed + 52) * 0.4;
  LQ.g = 0;
  LQ.ga = 0;
  switch (k.liquid) {
    case 'lava': {
      // cooling crust plates (Worley cells) drifting on molten seams of varying width
      const e = cellEdge(px, py, 16, k.seed + 53);
      const e2 = cellEdge(px + 7, py + 3, 8, k.seed + 54, 0.45);
      const seamW = 0.6 + nz(px, py, 8, k.seed + 60) * 3.2 + (1 - depth) * 0.8;
      if (e < seamW) {
        LQ.c = tone(LAVA, 2 + (seamW - e) * 0.9 + bayer(x, y) * 0.5);
        LQ.h = -1.8;
        LQ.g = LQ.c;
        LQ.ga = 235;
      } else if (e < seamW + 1) {
        LQ.c = LAVA[0]!;
        LQ.h = -1.2;
        LQ.g = LAVA[1]!;
        LQ.ga = 110;
      } else if (e2 < 0.6) {
        LQ.c = LAVA[1]!;
        LQ.h = -1.1;
        LQ.g = LAVA[1]!;
        LQ.ga = 120;
      } else {
        LQ.c = tone(R(0x0a0606, 0x160e0c, 0x241814, 0x34241c, 0x463024), 1 + Math.min(2.6, (e - seamW) * 0.35) + (n - 0.5) * 0.8 + bayer(x, y) * 0.5);
        LQ.h = -0.9 + Math.min(0.6, (e - seamW) * 0.1);
      }
      return;
    }
    case 'ice': {
      // plates of glossy ice split by a tile-periodic crack network (cell boundaries of jittered points)
      const e = cellEdge(px, py, 16, k.seed + 55, 0.6);
      const e2 = cellEdge(px + 5, py + 11, 8, k.seed + 56, 0.3);
      const sheen = nz(px, py, 16, k.seed + 57);
      let c = tone(L, 0.9 + (1 - depth) * 1.3 + (n - 0.5) * 1.2 + bayer(x, y) * 0.45);
      if (sheen > 0.7 && (sheen - 0.7) * 8 + bayer(x, y) > 0.4) c = mixc(c, 0xd8f0ff, 0.3);
      const h = -0.7;
      if (e < 0.9) c = mixc(c, L[3]!, 0.3);
      else if (e2 < 0.6) c = mixc(c, L[3]!, 0.18);
      if (hashi(W32(px), W32(py), k.seed + 59) > 0.994) c = 0xffffff;
      LQ.c = c;
      LQ.h = h;
      return;
    }
    default: {
      // calm surface, darker towards the middle; ripples are short screen-horizontal streaks
      // (texel x + y = const), keyed on tile-periodic hashes so every repeat agrees
      const lx = W32(px), ly = W32(py);
      const sl = W32(lx + ly + Math.round((n - 0.5) * 6)), sd = W32(lx - ly);
      const lit = hashi(sd >> 2, sl >> 3, k.seed + 59) > 0.74;
      const row = sl & 7;
      let v = 1.05 + (1 - depth) * 1.1 + (n - 0.5) * 0.7 + bayer(x, y) * 0.4;
      if (k.liquid === 'blood') v -= 0.15;
      let c = tone(L, v);
      let h = -1.6;
      if (lit && row === 0) {
        c = (sd & 3) === 1 ? L[4]! : L[3]!;
        h = -1.35;
      } else if (lit && row === 1) c = L[0]!;
      else if (hashi(lx, ly, k.seed + 58) > 0.995) c = L[4]!;
      if (k.liquid === 'murk' && n > 0.64) c = mixc(tone(R(0x16140a, 0x2a2612, 0x403a1c, 0x5a5228), 1 + (n - 0.64) * 9 + bayer(x, y) * 0.5), c, 0.2);
      LQ.c = c;
      LQ.h = h;
      if (k.liquid === 'glow') {
        LQ.g = lit && row === 0 ? L[4]! : L[2]!;
        LQ.ga = lit && row === 0 ? 140 : v > 2.2 ? 55 : 24;
      }
    }
  }
}

/** A tw x th basin in tiles 1..tw / 1..th of a (tw+2) x (th+2) canvas. */
function paintPool(cv: TexCanvas, k: RoomKit, tw: number, th: number): void {
  const pw = tw * T, ph = th * T;
  const C = 7;
  const S = k.stoneA;
  for (let y = T - 1; y <= (th + 1) * T; y++)
    for (let x = T - 1; x <= (tw + 1) * T; x++) {
      const px = x - T, py = y - T;
      if (px < 0 || py < 0 || px >= pw || py >= ph) continue;
      const dN = py, dS = ph - 1 - py, dW = px, dE = pw - 1 - px;
      const d = Math.min(dN, dS, dW, dE);
      if (d < C) {
        // curb: coping blocks (joints every 16 along the edge), rounded top lit from the NW, dark outline
        const ns = d === dN || d === dS;
        const nearSide = d === dS || d === dE;
        const along = ns ? px : py;
        const blk = hashi(W32(along) >> 4, ns ? (d === dN ? 1 : 2) : d === dW ? 3 : 4, k.seed + 61);
        let v = 2.3 + blk * 0.6 + (nz(px, py, 8, k.seed + 62) - 0.5) * 0.8 + bayer(x, y) * 0.3;
        let h = 1.1;
        if (d === 0) {
          v = 0.2;
          h = 0.1;
        } else if (d === 1) {
          v += nearSide ? -0.9 : 1.1;
          h = 0.7;
        } else if (d === 2) v += nearSide ? -0.3 : 0.5;
        else if (d === C - 2) v += nearSide ? 0.6 : -0.4;
        else if (d === C - 1) {
          v += nearSide ? 1.2 : -1;
          h = 0.7;
        }
        let c = tone(S, v);
        if (W32(along) % 16 === 0 && d > 0) {
          c = tone(S, 0.3);
          h = 0.4;
        }
        if (k.theme === 'sanctum' && d === C - 1) c = GOLD[nearSide ? 3 : 1]!;
        if (k.theme === 'flooded' && d >= C - 2 && nz(px, py, 4, k.seed + 63) > 0.62) c = tone(k.M.growth, 1.6 + bayer(x, y));
        if (k.theme === 'frost' && nz(px, py, 8, k.seed + 64) > 0.64) c = mixc(c, 0xe0eef8, 0.6);
        cv.set(x, y, c, h);
        continue;
      }
      const wN = dN - C, wW = dW - C, wS = dS - C, wE = dE - C;
      const wall = Math.min(wN, wW);
      if (wall < 3 && wall <= Math.min(wS, wE)) {
        // far inner walls (N / W) are visible: a short dark stone face down to the waterline
        let c = tone(S, 1.2 - wall * 0.3 + ((wall === wN ? px : py) % 4 === 0 ? -0.5 : 0) + bayer(x, y) * 0.3);
        if (wall === 2) c = k.liquid === 'lava' ? LAVA[1]! : k.liquid === 'ice' ? ICE[3]! : mixc(c, k.liq[1]!, 0.6);
        cv.set(x, y, c, 0.4 - wall * 0.7);
        if (wall === 2 && k.liquid === 'lava') glowMax(cv, x, y, LAVA[2]!, 150);
        continue;
      }
      if (Math.min(wS, wE) === 0) {
        cv.set(x, y, mixc(k.liq[0]!, 0x000000, 0.6), -1.9);
        continue;
      }
      liquidAt(k, px, py, Math.min(1, (Math.min(wN, wW, wS, wE) - 1) / 10), x, y);
      cv.set(x, y, LQ.c, LQ.h);
      if (LQ.ga) glowMax(cv, x, y, LQ.g, LQ.ga);
    }
}

/** Star-shaped ice fracture kept inside the tile at canvas (ox, oy); only marks liquid texels. */
function iceCracks(cv: TexCanvas, ox: number, oy: number, seed: number): void {
  const r = rng(seed);
  const cx = 9 + r() * 14, cy = 9 + r() * 14;
  const arms = 3 + Math.floor(r() * 3);
  for (let b = 0; b < arms; b++) {
    let x = cx, y = cy;
    let a = (b / arms) * TAU + r() * 0.8;
    const len = 6 + r() * 9;
    for (let s = 0; s < len; s++) {
      a += (r() - 0.5) * 0.6;
      x += Math.cos(a);
      y += Math.sin(a);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 2 || yi < 2 || xi > 29 || yi > 29) break;
      const X = ox + xi, Y = oy + yi;
      if (cv.hgt[Y * cv.w + X]! > -0.5) break;
      cv.set(X, Y, s < 3 ? 0xffffff : 0xd8f2ff, -1.1);
      if (s % 2) cv.set(X + 1, Y, ICE[1]!, -0.9);
    }
  }
}

/** Interior-only extras for the alternative pool centres (v = 1, 2) on the tile at canvas (ox, oy). */
function poolFeature(cv: TexCanvas, k: RoomKit, ox: number, oy: number, v: number): void {
  const r = rng(k.seed + 70 + v);
  const L = k.liq;
  const P = cv.p;
  const cx = 10 + r() * 12, cy = 10 + r() * 12;
  if (v === 1) {
    if (k.liquid === 'lava') {
      // a drifting crust raft with glowing seams
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const d = Math.hypot((x + 0.5 - cx) / 6.5, (y + 0.5 - cy) / 4.5) + (nz(x, y, 4, k.seed + 71) - 0.5) * 0.5;
          if (d > 1) continue;
          const seamL = Math.abs(nz(x, y, 8, k.seed + 72) - 0.5) < 0.04;
          cv.set(ox + x, oy + y, seamL ? LAVA[3]! : d > 0.85 ? LAVA[1]! : tone(R(0x0c0808, 0x1a1210, 0x2a1e18, 0x3a2a20), 1.2 + (1 - d) * 2 + bayer(x, y) * 0.5), seamL ? -0.8 : -0.4);
          if (seamL || d > 0.85) glowMax(cv, ox + x, oy + y, LAVA[seamL ? 3 : 1]!, seamL ? 230 : 120);
        }
      return;
    }
    // something lying under the surface: a few bones (frozen in, drowned, steeped in blood)
    const before = cv.snapshot();
    for (let i = 0; i < 3; i++) {
      const bx = cx + (r() - 0.5) * 8, by = cy + (r() - 0.5) * 8, a = r() * Math.PI, l = 2 + r() * 2;
      P.capsule(ox + bx - Math.cos(a) * l, oy + by - Math.sin(a) * l, ox + bx + Math.cos(a) * l, oy + by + Math.sin(a) * l, 0.8, 0.8);
      P.fill(k.bone, { mode: 'emboss', inner: false, alpha: k.liquid === 'ice' ? 120 : 90 });
    }
    P.circle(ox + cx, oy + cy, 2.6).fill(k.bone, { mode: 'sphere', inner: false, alpha: k.liquid === 'ice' ? 140 : 110 });
    cv.liftPainted(before, -1.3, 0.3);
  }
  // ripple ring / frost ring and bubbles
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const dx = x + 0.5 - (32 - cx), dy = y + 0.5 - (32 - cy);
      const d = Math.hypot(dx, dy);
      const arc = hashi(Math.floor((Math.atan2(dy, dx) / TAU + 1) * 9), v, k.seed + 74) > 0.35;
      if (arc && k.liquid !== 'ice' && (Math.abs(d - 4) < 0.55 || (v === 2 && Math.abs(d - 7.5) < 0.5))) {
        const c = k.liquid === 'lava' ? LAVA[d > 6 ? 2 : 3]! : d > 6 ? L[2]! : L[3]!;
        cv.set(ox + x, oy + y, c, -1.4);
        if (k.liquid === 'lava' || k.liquid === 'glow') glowMax(cv, ox + x, oy + y, c, 150);
      }
    }
  for (let i = 0; i < (v === 2 ? 6 : 3); i++) {
    const bx = Math.round(6 + r() * 20), by = Math.round(6 + r() * 20);
    const c = k.liquid === 'ice' ? 0xffffff : L[4]!;
    cv.set(ox + bx, oy + by, c, -1.2);
    cv.set(ox + bx + 1, oy + by + 1, L[1]!, -1.6);
    if (k.liquid === 'lava' || k.liquid === 'glow') glowMax(cv, ox + bx, oy + by, c, 220);
  }
}

// ---------------------------------------------------------------- mosaic (4x4)

/** Mosaic design: palette slot (0 ground, 1 primary, 2 secondary, 3 accent) at polar (r, a). */
function mosDesign(r: number, a: number): number {
  if (r > 54) return 3;
  if (r > 45) return r - 45 < 4.5 + 3.5 * Math.sin(a * 16) ? 1 : 0;
  if (r > 42) return 3;
  if (r < 4) return 3;
  if (r < 9) return 2;
  if (r < 12) return 3;
  if (r < 17) return 1;
  const rs = 40 * (0.5 + 0.5 * Math.pow(Math.abs(Math.cos(a * 4)), 2));
  if (Math.abs(r - rs) < 2.2) return 3;
  if (r < rs) return 2;
  return 0;
}

function paintMosaic(cv: TexCanvas, k: RoomKit): void {
  const N = 4 * T, c = N / 2, RO = c - 2;
  const id = new Int32Array(N * N).fill(-1);
  const pal = new Map<number, number>();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
      if (r > RO) continue;
      const ang = Math.atan2(dy, dx);
      if (r > RO - 4) {
        id[y * N + x] = 900000 + Math.floor(((ang / TAU + 1) * 36) % 36);
        continue;
      }
      if (r < 4) {
        id[y * N + x] = 1;
        continue;
      }
      // tesserae laid in concentric staggered rows (opus vermiculatum)
      const ring = Math.floor(r / 4);
      const n = Math.max(6, Math.round((TAU * (ring + 0.5) * 4) / 4.2));
      const seg = Math.floor((ang / TAU + 1) * n + ring * 0.5) % n;
      const t = 2 + ring * 1000 + seg;
      id[y * N + x] = t;
      if (!pal.has(t)) pal.set(t, mosDesign((ring + 0.5) * 4, ((seg + 0.5 - ring * 0.5) / n) * TAU));
    }
  pal.set(1, 3);
  const [g0, g1, g2, g3] = k.mos;
  const ramps = [g0, g1, g2, g3];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const t = id[y * N + x]!;
      if (t < 0) continue;
      const right = x + 1 < N ? id[y * N + x + 1]! : -1;
      const down = y + 1 < N ? id[(y + 1) * N + x]! : -1;
      const left = x > 0 ? id[y * N + x - 1]! : -1;
      const up = y > 0 ? id[(y - 1) * N + x]! : -1;
      const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
      const wear = nz(x, y, 16, k.seed + 81) * 0.6 + nz(x, y, 8, k.seed + 82) * 0.4;
      if (t >= 900000) {
        // stone frame ring
        let v = 2 + hashi(t, 1, k.seed) * 0.5 + bayer(x, y) * 0.3;
        if (r > RO - 1) v += dx + dy < 0 ? 1 : -1;
        if (r < RO - 3) v -= 0.6;
        const joint = right !== t || down !== t;
        cv.set(x, y, joint ? 0x060504 : tone(g0, v + 0.6), joint ? -0.6 : 0.5);
        continue;
      }
      if (right !== t || down !== t) {
        cv.set(x, y, mixc(k.M.mortar, k.M.dust, 0.2 + wear * 0.3), -0.45);
        continue;
      }
      const slot = pal.get(t) ?? 0;
      if (hashi(t, 2, k.seed + 83) < 0.03 && t !== 1) {
        // a lost tessera
        cv.set(x, y, mixc(k.M.mortar, 0x000000, 0.4), -0.9);
        continue;
      }
      let v = (slot ? 2.5 : 1.9) + (hashi(t, 3, k.seed + 84) - 0.5) * 0.8 + bayer(x, y) * 0.25 + (left !== t || up !== t ? 0.55 : 0);
      if (wear > 0.62) v -= (wear - 0.62) * 4;
      let col = tone(ramps[slot]!, v);
      if (slot === 3 && k.theme === 'sanctum' && hashi(x, y, 5) > 0.93) col = GOLD[4]!;
      cv.set(x, y, col, 0.3 + hashi(t, 4, k.seed) * 0.2);
    }
}

// ---------------------------------------------------------------- planks

/** Board joint per board row: shared by every variant so tile edges always meet. */
const PLANK_OFF = [3, 19, 11, 27];
const PLANK_TONE = [0.15, -0.25, 0.35, -0.1];

function paintPlanks(k: RoomKit, v: number): DecoFrame {
  const Wd = k.wood;
  const extra = (row: number): boolean => hashi(row, v, k.seed + 91) < 0.45;
  const gapCol = (x: number, y: number): number => {
    switch (k.theme) {
      case 'flooded':
        return hashi(x, y, 4) > 0.85 ? k.M.water[3]! : k.M.water[1]!;
      case 'fungal':
        return nz(x, y, 4, k.seed + 92) > 0.6 ? tone(k.M.growth, 2) : 0x060403;
      case 'frost':
        return nz(x, y, 4, k.seed + 92) > 0.5 ? 0xc0d8ec : 0x0a1018;
      default:
        return 0x050303;
    }
  };
  return seam(
    (cv, x, y) => {
      const lx = W32(x), ly = W32(y);
      const row = ly >> 3, by = ly & 7;
      if (by === 7) {
        cv.set(x, y, gapCol(lx, ly), -1.3);
        return;
      }
      const o = PLANK_OFF[row]!;
      const rel = W32(lx - o);
      const ex = extra(row);
      if (rel === 0 || (ex && rel === 16)) {
        cv.set(x, y, 0x050303, -0.9);
        return;
      }
      // segment colour: the one crossing the tile edge is fixed per row, interior ones vary per variant
      const segStart = W32(o + (ex && rel > 16 ? 16 : 0));
      const crosses = segStart + (ex ? 16 : 32) > 32;
      const toff = crosses ? PLANK_TONE[row]! : (hashi(segStart, row, k.seed + 93 + v) - 0.5) * 0.9;
      const grain = pnoiseP(lx, 0, 8, T, k.seed + ly * 13) * 0.6 + pnoiseP(lx, 0, 4, T, k.seed + ly * 7 + 3) * 0.4;
      const line = (by + Math.floor(pnoiseP(lx, 0, 16, T, k.seed + row * 7) * 4)) % 3 === 0;
      let val = 2.3 + toff + (grain - 0.5) * 0.9 + bayer(x, y) * 0.3 + (line ? -0.45 : 0);
      if (by === 0) val += 0.7;
      else if (by === 6) val -= 0.6;
      if (rel === 1 || (ex && rel === 17)) val += 0.5;
      const wear = nz(lx, ly, 16, k.seed + 94);
      if (wear > 0.66) val += 0.4;
      let c = tone(Wd, val);
      if (k.theme === 'forge' && nz(lx, ly, 8, k.seed + 95) > 0.64) c = mixc(c, 0x040202, 0.7);
      if (k.theme === 'frost' && by >= 5 && nz(lx, ly, 8, k.seed + 96) > 0.62) c = mixc(c, 0xc8dcec, 0.45);
      if (k.theme === 'flooded' && by === 6 && nz(lx, ly, 4, k.seed + 97) > 0.5) c = tone(k.M.growth, 1.5);
      cv.set(x, y, c, 0.3 + (by === 0 ? 0.15 : by === 6 ? -0.15 : 0) + (grain - 0.5) * 0.25);
    },
    'xy',
    (cv) => {
      const N = k.nail;
      const nail = (nx: number, ny: number): void =>
        wrapped(W32(nx), W32(ny), (x, y) => {
          cv.set(x, y, N[2]!, 0.7);
          cv.set(x - 1, y, N[3]!, 0.6);
          cv.set(x + 1, y + 1, 0x000000, 0.1, 150);
        });
      for (let row = 0; row < 4; row++) {
        const joints = [PLANK_OFF[row]!];
        if (extra(row)) joints.push(PLANK_OFF[row]! + 16);
        for (const j of joints) {
          nail(j - 2, row * 8 + 2);
          nail(j + 3, row * 8 + 4);
        }
      }
      // knots, only inside the tile
      const r = rng(k.seed + 98 + v);
      for (let i = 0; i < 1 + (v % 2); i++) {
        const kx = 6 + Math.floor(r() * 20), row = Math.floor(r() * 4), ky = row * 8 + 3;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const e = Math.abs(dx) / 2.2 + Math.abs(dy) / 1.2;
            if (e > 1.05) continue;
            cv.set(T + kx + dx, T + ky + dy, tone(k.wood, e > 0.6 ? 0.6 : e > 0.3 ? 2.6 : 1), e > 0.6 ? 0.1 : 0.35);
          }
      }
      // a stain / spill on one variant
      if (v === 3) {
        const sx = 8 + r() * 16, sy = 8 + r() * 16;
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const d = Math.hypot(x + 0.5 - sx, (y + 0.5 - sy) * 1.3) / 5 + (nz(x, y, 4, k.seed + 99) - 0.5) * 0.5;
            if (d < 1 && (y & 7) !== 7) {
              const i = (T + y) * cv.w + T + x;
              cv.buf.data[i] = (0xff000000 | mixc(cv.buf.data[i]! & 0xffffff, k.stain, 0.55)) >>> 0;
            }
          }
      }
    },
  );
}

// ---------------------------------------------------------------- bridge deck

/** Screen-space rail post standing on texel (tx, ty) of a deco frame. */
function addPost(f: DecoFrame, tx: number, ty: number, ramp: Ramp, h: number): void {
  const cu = 32 + tx - ty;
  const vb = Math.round((tx + ty + 1) / 2) + DECO_TOP;
  for (let dy = 0; dy <= h; dy++) {
    const vy = vb - dy;
    if (vy < 0) break;
    for (let du = -1; du <= 1; du++) {
      const u = cu + du;
      if (u < 0 || u >= DECO_W) continue;
      const top = dy === h;
      const c = top ? tone(ramp, du < 0 ? 4 : du === 0 ? 3 : 2) : tone(ramp, du < 0 ? 3 : du === 0 ? 2 : 1) ;
      f.col.set(u, vy, dy === 0 && du > 0 ? scalec(c, 0.7) : c);
      f.nrm.set(u, vy, top ? encodeNormal(0, 0.7, 0.7) : encodeNormal(du * 0.7, 0, 0.7));
    }
  }
}

/** Sagging rope / chain between two screen points (clipped to the frame). */
function addRope(f: DecoFrame, u0: number, v0: number, u1: number, v1: number, ramp: Ramp, chain: boolean): void {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const steps = Math.ceil(len * 2);
  let lu = -99, lv = -99;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = Math.round(u0 + (u1 - u0) * t);
    const v = Math.round(v0 + (v1 - v0) * t + Math.sin(Math.PI * t) * 2.6);
    if (u === lu && v === lv) continue;
    lu = u;
    lv = v;
    if (u < 0 || u >= DECO_W || v < 0 || v + 1 >= DECO_H) continue;
    const c = chain ? tone(ramp, u % 2 ? 3 : 1) : tone(ramp, u % 3 === 0 ? 3 : 2);
    f.col.set(u, v, c);
    f.nrm.set(u, v, encodeNormal(0, 0.6, 0.8));
    f.col.set(u, v + 1, tone(ramp, 0));
    f.nrm.set(u, v + 1, encodeNormal(0, -0.5, 0.85));
  }
}

/**
 * Bridge deck tile. alongY: walking direction is world y. edge: -1 heavy beam on the N (X) / W (Y) side,
 * 1 on the S / E side, 0 plain deck. Planks run across the walking direction; seamless along it.
 */
function paintBridge(k: RoomKit, alongY: boolean, edge: -1 | 0 | 1): DecoFrame {
  const Wd = k.wood;
  const beam = R(scalec(Wd[0]!, 0.8), Wd[0]!, Wd[1]!, Wd[2]!, Wd[3]!);
  const frame = seam(
    (cv, x, y) => {
      const lx = W32(x), ly = W32(y);
      // only the centre tile across the walking direction (the bridge edge must stay crisp)
      if (alongY ? x < T || x >= 2 * T : y < T || y >= 2 * T) return;
      const a = alongY ? ly : lx;
      const ac = alongY ? lx : ly;
      const dc = edge === -1 ? ac : edge === 1 ? 31 - ac : 99;
      if (dc < 8) {
        // heavy side beam along the walking direction, iron strap at the beam joint
        const strap = W32(a) < 3;
        const lit = edge === -1 ? [0.6, 3.2, 3, 2.3, 2.1, 2, 1.2] : [0.4, 1.2, 2, 2.1, 2.3, 3, 3.2];
        if (dc === 7) {
          cv.set(x, y, 0x050303, -0.4);
          return;
        }
        const grain = pnoiseP(a, 0, 8, T, k.seed + dc * 11 + 101);
        let c = tone(beam, lit[dc]! + (grain - 0.5) * 0.8 + bayer(x, y) * 0.3);
        if (strap) c = tone(MATERIALS.iron, lit[dc]! + (W32(a) === 1 && (dc === 2 || dc === 4) ? 1.5 : 0));
        const prof = Math.sin(((dc + 0.5) / 7) * Math.PI);
        cv.set(x, y, c, 0.6 + prof * 0.9);
        return;
      }
      const pb = a & 7;
      if (pb === 7) {
        cv.set(x, y, 0x030202, -2.2);
        return;
      }
      const p = (W32(a) >> 3) & 3;
      const ptone = (hashi(p, 1, k.seed + 102) - 0.5) * 0.8;
      const grain = pnoiseP(ac, 0, 8, T, k.seed + W32(a) * 13) * 0.6 + pnoiseP(ac, 0, 4, T, k.seed + W32(a) * 5) * 0.4;
      let v = 2 + ptone + (grain - 0.5) * 0.9 + bayer(x, y) * 0.3;
      if (pb === 0) v += 0.7;
      else if (pb === 6) v -= 0.7;
      const crack = hashi(p, 2, k.seed + 103) < 0.3 && pb === 3 && Math.abs(ac - (8 + hashi(p, 3, k.seed) * 16)) < 6;
      let c = tone(Wd, v - (crack ? 1.4 : 0));
      // nails over the stringers
      const nailRow = ac === 5 || ac === 26;
      if (nailRow && (pb === 2 || pb === 4)) c = tone(k.nail, 3);
      if (k.theme === 'frost' && nz(ac, a, 8, k.seed + 104) > 0.66) c = mixc(c, 0xc8dcec, 0.45);
      if (k.theme === 'forge' && nz(ac, a, 8, k.seed + 105) > 0.66) c = mixc(c, 0x030202, 0.7);
      if (k.theme === 'flooded' && nz(ac, a, 4, k.seed + 106) > 0.66) c = tone(k.M.growth, 1.4 + bayer(x, y));
      cv.set(x, y, c, 0.2 + (pb === 0 ? 0.15 : pb === 6 ? -0.2 : 0) + (crack ? -0.6 : 0));
    },
    alongY ? 'y' : 'x',
    (cv) => {
      if (!edge) return;
      // post tops on the beam
      for (const pa of [8, 24]) {
        const pc = edge === -1 ? 3 : 28;
        for (let d1 = -1; d1 <= 2; d1++)
          for (let d2 = -1; d2 <= 2; d2++) {
            const tx = alongY ? pc + d2 : pa + d1, ty = alongY ? pa + d1 : pc + d2;
            const ring = d1 === -1 || d2 === -1 || d1 === 2 || d2 === 2;
            cv.set(T + tx, T + ty, tone(beam, ring ? 1 : 2.4 + bayer(tx, ty) * 0.4), 1.6);
          }
      }
    },
  );
  if (edge) {
    const pc = edge === -1 ? 3.5 : 28.5;
    const posts = [-8, 8, 24, 40];
    const top = (pa: number): [number, number] => {
      const tx = alongY ? pc : pa + 0.5, ty = alongY ? pa + 0.5 : pc;
      return [32 + tx - ty, (tx + ty) / 2 + DECO_TOP - 7];
    };
    const chain = k.theme === 'forge';
    for (let i = 0; i < 3; i++) {
      const [u0, v0] = top(posts[i]!);
      const [u1, v1] = top(posts[i + 1]!);
      addRope(frame, u0, v0 + 1, u1, v1 + 1, k.rope, chain);
    }
    for (const pa of [8, 24]) addPost(frame, alongY ? Math.floor(pc) : pa, alongY ? pa : Math.floor(pc), beam, 7);
  }
  return frame;
}

// ---------------------------------------------------------------- marble checker

function paintChecker(k: RoomKit, v: number): DecoFrame {
  return seam((cv, x, y) => {
    const lx = W32(x), ly = W32(y);
    const sx = lx >> 4, sy = ly >> 4;
    const qx = lx & 15, qy = ly & 15;
    if (qx === 0 || qy === 0) {
      if (k.chkGold) cv.set(x, y, (lx + ly) % 3 ? GOLD[2]! : GOLD[3]!, 0.15);
      else cv.set(x, y, 0x040303, -0.8);
      return;
    }
    const dark = ((sx + sy) & 1) === 0;
    const ramp = dark ? k.chkA : k.chkB;
    const sid = sx + sy * 2 + v * 4;
    // veins: per-square sine field warped by noise (squares are separated by joints, so variants may differ)
    const warp = nz(lx, ly, 16, k.seed + 111 + sid) * 6 + nz(lx, ly, 8, k.seed + 112 + sid) * 2.5;
    const vein = Math.abs(Math.sin(((lx * 2 + ly) * TAU) / T + warp + sid));
    let val = 2.2 + (nz(lx, ly, 8, k.seed + 113 + sid) - 0.5) * 0.7 + bayer(x, y) * 0.25;
    if (qx === 1 || qy === 1) val += 0.6;
    else if (qx === 15 || qy === 15) val -= 0.55;
    // polished reflection band
    const band = W32(lx - ly + 5);
    if (band < 4) val += 0.45;
    let c = tone(ramp, val);
    if (vein < 0.06) c = dark ? mixc(c, ramp[4] ?? ramp[3]!, 0.55) : mixc(c, ramp[0]!, 0.5);
    else if (vein < 0.12 && hashi(lx, ly, sid) > 0.5) c = mixc(c, dark ? ramp[3]! : ramp[1]!, 0.35);
    if (hashi(lx, ly, k.seed + 114 + v) > 0.985) c = mixc(c, 0xffffff, 0.5);
    // variant 1: a cracked, chipped square
    if (v === 1 && sx === 1 && sy === 0) {
      const cr = qx > 1 && qx < 15 && qy > 1 && Math.abs(qx + qy - 16 - Math.round((nz(lx, 0, 4, k.seed + 115) - 0.5) * 4)) < 0.7;
      if (cr) {
        c = 0x050404;
        cv.set(x, y, c, -0.9);
        return;
      }
    }
    cv.set(x, y, c, 0.1);
  }, 'xy');
}

// ---------------------------------------------------------------- packed bones

function paintBones(k: RoomKit, v: number): DecoFrame {
  return seam(
    (cv, x, y) => {
      const lx = W32(x), ly = W32(y);
      const n = nz(lx, ly, 8, k.seed + 121);
      cv.set(x, y, mixc(mixc(k.M.mortar, 0x000000, 0.3), k.M.dust, 0.05 + n * 0.3 + bayer(x, y) * 0.08), -0.9 + n * 0.3);
    },
    'xy',
    (cv) => {
      const P = cv.p;
      const B = k.bone;
      const before = cv.snapshot();
      const bone = (bx: number, by: number, a: number, l: number, wrap: boolean): void => {
        const draw = (ox: number, oy: number): void => {
          const ca = Math.cos(a), sa = Math.sin(a);
          const x0 = ox + bx - ca * l, y0 = oy + by - sa * l, x1 = ox + bx + ca * l, y1 = oy + by + sa * l;
          P.capsule(x0, y0, x1, y1, 1.35, 1.35);
          for (const [ex, ey] of [[x0, y0], [x1, y1]] as const) {
            P.circle(ex - sa * 1.2, ey + ca * 1.2, 1.75).circle(ex + sa * 1.2, ey - ca * 1.2, 1.75);
          }
          P.fill(B, { mode: 'emboss', light: -0.1 });
        };
        if (wrap) wrapped(bx, by, (ox, oy) => draw(ox - bx, oy - by));
        else {
          // interior bones never reach a tile edge (variants must stay mixable)
          const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
          const room = Math.min((Math.min(bx, 31 - bx) - 4) / Math.max(0.2, ca), (Math.min(by, 31 - by) - 4) / Math.max(0.2, sa));
          if (room > 2) {
            l = Math.min(l, room);
            draw(T, T);
          }
        }
      };
      const skull = (sx: number, sy: number): void => {
        const X = T + sx, Y = T + sy;
        P.circle(X, Y, 4.3).fill(B, { mode: 'sphere' });
        // screen-horizontal = texel (+1, -1); screen-down = texel (+1, +1)
        P.circle(X - 1.6, Y + 0.6, 1.3).circle(X + 0.6, Y - 1.6, 1.3).fill(R(0x0a0605, 0x0a0605, 0x140c0a, 0x1e1410), { mode: 'flat', tone: 0, inner: false });
        P.px(X + 0.9, Y + 0.9, 0x140c0a);
        for (let t = -1; t <= 1; t++) P.px(X + 3 + t * 0.8, Y + 3 - t * 0.8, t === 0 ? 0x140c0a : B[1]!);
      };
      // interior pieces (vary per variant)
      const r = rng(k.seed + 123 + v * 17);
      const nb = v === 2 ? 8 : 7;
      for (let i = 0; i < nb; i++) bone(8 + r() * 16, 8 + r() * 16, r() * Math.PI, 3.5 + r() * 3, false);
      // edge pieces: identical in every variant, wrapped so the paving continues into any neighbour
      const e = rng(k.seed + 124);
      for (let i = 0; i < 8; i++) {
        const onX = i % 2 === 0;
        const along = 3 + e() * 26;
        bone(onX ? along : 0, onX ? 0 : along, (onX ? Math.PI / 2 : 0) + (e() - 0.5) * 1.2, 3.6 + e() * 2.4, true);
      }
      if (v === 2)
        for (let i = 0; i < 4; i++) {
          // a rib cage: curved short bones in a row
          const ox = 9 + i * 3.2, oy = 11 + i * 1.5;
          P.capsule(T + ox, T + oy, T + ox + 3, T + oy + 6, 0.9, 0.7).fill(B, { mode: 'emboss', light: -0.1 });
        }
      for (let i = 0; i < (v === 2 ? 0 : v + 1); i++) skull(10 + r() * 12, 10 + r() * 12);
      cv.liftPainted(before, -0.1, 1.6);
    },
  );
}

// ---------------------------------------------------------------- partial debris

function paintRubble(cv: TexCanvas, k: RoomKit, v: number): void {
  const r = rng(k.seed + 131 + v);
  const cx = 12 + r() * 8, cy = 12 + r() * 8;
  const rx = 9 + r() * 4, ry = 8 + r() * 4;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const m = patch(x, y, cx, cy, rx, ry, k.seed + 132 + v);
      if (m + bayer(x, y) * 0.25 < 0.08) continue;
      const g = nz(x, y, 4, k.seed + 133 + v);
      cv.set(x, y, mixc(k.M.dust, tone(k.stoneA, 3), 0.1 + g * 0.5 + bayer(x, y) * 0.15), 0.05 + g * 0.2, m > 0.25 ? 220 : 130);
      if (hashi(x, y, k.seed + 134 + v) > 0.86) cv.set(x, y, tone(k.stoneA, 2.8 + g), 0.3);
    }
  const before = cv.snapshot();
  const P = cv.p;
  const chips = 14 + v * 4;
  for (let i = 0; i < chips; i++) {
    const a = r() * TAU, d = r() * 0.85;
    const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
    if (x < 3 || y < 3 || x > 28 || y > 28) continue;
    const big = i < 2;
    const s = big ? 3 + r() * 1.4 : 1.1 + r() * 1.6;
    const pts: number[] = [];
    const nv = 4 + Math.floor(r() * 2);
    const rot = r() * TAU;
    for (let j = 0; j < nv; j++) {
      const t = rot + (j / nv) * TAU;
      const rr = s * (0.7 + r() * 0.5);
      pts.push(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
    }
    const ramp = k.theme === 'frost' && i % 3 === 0 ? ICE : k.theme === 'sanctum' && i % 2 ? k.stoneB : i % 3 === 0 ? k.stoneB : k.stoneA;
    P.poly(pts).fill(ramp, { mode: 'facet', facets: 4, rot, light: 0.2 });
  }
  cv.liftPainted(before, 0.2, 1.3);
}

function paintStraw(cv: TexCanvas, k: RoomKit, v: number): void {
  const r = rng(k.seed + 141 + v);
  const cx = 12 + r() * 8, cy = 12 + r() * 8;
  const S = k.straw;
  // matted bed
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const m = patch(x, y, cx, cy, 10, 8, k.seed + 142 + v);
      if (m + bayer(x, y) * 0.3 < 0.12) continue;
      cv.set(x, y, tone(S, 0.6 + nz(x, y, 4, k.seed + 143) * 1.4 + bayer(x, y) * 0.4), 0.2, m > 0.3 ? 255 : 170);
    }
  // loose strands, clumped directions
  const clump = r() * Math.PI;
  for (let i = 0; i < 70 + v * 25; i++) {
    const a = clump + (r() - 0.5) * (i % 4 === 0 ? 3 : 1.1);
    const d = Math.sqrt(r());
    const ang = r() * TAU;
    let x = cx + Math.cos(ang) * d * 11, y = cy + Math.sin(ang) * d * 9;
    const len = 3 + r() * 5;
    const tn = 1.6 + r() * 2.2;
    for (let s = 0; s < len; s++) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 2 || yi < 2 || xi > 29 || yi > 29) break;
      cv.set(xi, yi, tone(S, tn + (s === 0 ? 0.6 : 0)), 0.5 + tn * 0.1);
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

function paintCoins(cv: TexCanvas, k: RoomKit, v: number): void {
  const r = rng(k.seed + 151 + v);
  const G = MATERIALS.gold;
  const cx = 13 + r() * 6, cy = 13 + r() * 6;
  const coin = (x: number, y: number, h: number): void => {
    const X = Math.round(x), Y = Math.round(y);
    if (X < 2 || Y < 2 || X > 28 || Y > 28) return;
    cv.set(X + 2, Y + 1, 0x000000, h - 0.4, 90);
    cv.set(X + 1, Y + 2, 0x000000, h - 0.4, 90);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx && dy && dx + dy !== 0) {
          if (dx + dy < 0) cv.set(X + dx, Y + dy, G[3]!, h);
          continue;
        }
        const t = dx + dy;
        cv.set(X + dx, Y + dy, t < 0 ? G[3]! : t > 0 ? G[1]! : G[2]!, h + (t ? 0 : 0.15));
      }
    if (hashi(X, Y, v) > 0.6) cv.set(X - 1, Y, G[4]!, h + 0.2);
  };
  const n = 12 + v * 10;
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.pow(r(), 0.7) * (i < n * 0.7 ? 6 : 11);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
    const stack = d < 3 && r() < 0.6 ? 1 + Math.floor(r() * 3) : 0;
    for (let s = 0; s <= stack; s++) coin(x - s * 0.7, y - s * 0.7, 0.4 + s * 0.6);
  }
  const gems = [RUBY, EMERALD, SAPPHIRE];
  for (let i = 0; i < 2 + v; i++) {
    const g = gems[(i + v) % 3]!;
    const X = Math.round(cx + (r() - 0.5) * 12), Y = Math.round(cy + (r() - 0.5) * 12);
    if (X < 3 || Y < 3 || X > 28 || Y > 28) continue;
    for (const [dx, dy, t] of [[0, -1, 4], [-1, 0, 3], [0, 0, 2], [1, 0, 1], [0, 1, 0], [-1, -1, 3], [1, 1, 0]] as const) cv.set(X + dx, Y + dy, g[t]!, 0.9 - t * 0.1);
  }
}

function paintGrowth(cv: TexCanvas, k: RoomKit, v: number): void {
  const r = rng(k.seed + 161 + v);
  const G = k.growth;
  const blobs = v === 2 ? 3 : 2;
  const cs: [number, number, number][] = [];
  for (let i = 0; i < blobs; i++) cs.push([9 + r() * 14, 9 + r() * 14, 5 + r() * 5]);
  const fungal = k.theme === 'fungal';
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let m = -1;
      for (const [cx, cy, rr] of cs) m = Math.max(m, patch(x, y, cx, cy, rr, rr * 0.85, k.seed + 162 + v, 0.9));
      if (m + bayer(x, y) * 0.35 < 0.05) continue;
      const n = nz(x, y, 4, k.seed + 163 + v);
      let c = tone(G, 0.8 + m * 2.2 + n * 1.4 + bayer(x, y) * 0.5);
      // lichen rosettes
      if ((k.theme === 'catacombs' || k.theme === 'ossuary') && nz(x, y, 4, k.seed + 164) > 0.7) c = tone(R(0x2a2614, 0x4a4426, 0x6e6638, 0x928a4e), 1.5 + n * 2);
      cv.set(x, y, c, 0.15 + m * 0.5 + n * 0.2, m > 0.2 ? 255 : 200);
      if (fungal && m > 0.15 && Math.abs(nz(x, y, 8, k.seed + 165 + v) - 0.5) < 0.035) {
        cv.set(x, y, MYCELIUM[2]!, 0.2);
        glowMax(cv, x, y, MYCELIUM[2]!, 150);
      }
    }
  const before = cv.snapshot();
  const P = cv.p;
  const Sh = k.shroom;
  for (let i = 0; i < 3 + v; i++) {
    const [cx, cy, rr] = cs[i % cs.length]!;
    const x = cx + (r() - 0.5) * rr, y = cy + (r() - 0.5) * rr;
    if (x < 3 || y < 3 || x > 28 || y > 28) continue;
    cv.set(Math.round(x + 1), Math.round(y + 1), tone(Sh, 3), 0.6);
    P.ellipse(x, y, 1.5, 1.3).fill(Sh, { mode: 'sphere', inner: false });
    if (fungal) {
      const pink = i % 3 === 1;
      glowMax(cv, Math.round(x), Math.round(y), pink ? 0xff9ae8 : MYCELIUM[3]!, 230);
      glowMax(cv, Math.round(x) - 1, Math.round(y), pink ? 0xd040b8 : MYCELIUM[2]!, 140);
    }
  }
  cv.liftPainted(before, 0.5, 1.2);
}

function paintAsh(cv: TexCanvas, k: RoomKit, v: number): void {
  const r = rng(k.seed + 171 + v);
  const cx = 12 + r() * 8, cy = 12 + r() * 8;
  const forge = k.theme === 'forge';
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const m = patch(x, y, cx, cy, 11 + v * 2, 9 + v, k.seed + 172 + v, 0.9);
      if (m + bayer(x, y) * 0.35 < 0.04) continue;
      const n = nz(x, y, 4, k.seed + 173 + v);
      // charred core, pale ash rim
      const val = m > 0.5 ? 0.4 + n * 1.2 : 1.6 + n * 2 - m * 1.5;
      let c = tone(ASH, val + bayer(x, y) * 0.45);
      if (hashi(x, y, k.seed + 174) > 0.94) c = ASH[4]!;
      cv.set(x, y, c, 0.05 + n * 0.25, m > 0.18 ? 255 : 190);
      if (forge && m > 0.3 && hashi(x, y, k.seed + 175 + v) > 0.955) {
        const hot = hashi(x, y, 9) > 0.5;
        cv.set(x, y, hot ? LAVA[3]! : LAVA[1]!, 0.1);
        glowMax(cv, x, y, hot ? LAVA[3]! : LAVA[2]!, hot ? 255 : 150);
        glowMax(cv, x, y - 1, LAVA[1]!, 70);
      }
    }
}

// ---------------------------------------------------------------- gutters, drain

function paintChannel(k: RoomKit, alongY: boolean): DecoFrame {
  const S = k.stoneA, B = k.blood;
  return seam((cv, x, y) => {
    const lx = W32(x), ly = W32(y);
    const a = alongY ? ly : lx;
    const c = (alongY ? lx : ly) - 15.5;
    const ac = Math.abs(c);
    if (ac > 6.5) return;
    if (ac > 4.5) {
      // lips: blocks every 16 along the gutter
      const outer = ac > 6;
      let v = 2 + (nz(lx, ly, 8, k.seed + 181) - 0.5) * 0.8 + bayer(x, y) * 0.3 + hashi(a >> 4, c < 0 ? 1 : 2, k.seed + 182) * 0.5;
      if (outer) v = c < 0 ? 2.8 : 1;
      else if (ac < 5.5) v += c < 0 ? -0.8 : 1;
      const joint = W32(a) % 16 === 8;
      cv.set(x, y, joint ? tone(S, 0.4) : tone(S, v), joint ? 0.1 : 0.45);
      return;
    }
    if (ac > 3) {
      // far wall face visible, near wall in shadow
      if (c < 0) cv.set(x, y, tone(S, 1.1 - (ac - 3) * 0.3 + bayer(x, y) * 0.3), -0.7);
      else cv.set(x, y, 0x060404, -1.4);
      return;
    }
    // old blood along the bottom, crusted at the margins, wet and glossy in pools
    const level = pnoiseP(a, 0, 8, T, k.seed + 183) * 0.6 + pnoiseP(a, 0, 4, T, k.seed + 184) * 0.4;
    const bw = 0.8 + level * 3;
    if (ac < bw) {
      const n = nz(lx, ly, 4, k.seed + 185);
      let col = tone(B, 0.8 + n * 1.8 + (bw - ac) * 0.3 + bayer(x, y) * 0.4);
      if (level > 0.6 && hashi(lx, ly, k.seed + 186) > 0.94) col = B[4]!;
      cv.set(x, y, col, -1.25);
    } else cv.set(x, y, mixc(tone(S, 0.6 + bayer(x, y) * 0.4), B[1]!, 0.45), -1.5);
  }, alongY ? 'y' : 'x');
}

function paintDrain(cv: TexCanvas, k: RoomKit): void {
  const c = 15.5;
  const B = k.blood;
  const iron = k.theme === 'sanctum' ? GOLD : k.theme === 'frost' ? k.nail : MATERIALS.iron;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const dx = x + 0.5 - c - 0.5, dy = y + 0.5 - c - 0.5;
      const r = Math.hypot(dx, dy);
      if (r > 14.5) continue;
      const ang = Math.atan2(dy, dx);
      if (r > 9.5) {
        // stains running toward the drain
        const s = nz(x, y, 4, k.seed + 191) * 0.55 + nz(x, y, 8, k.seed + 192) * 0.45 - (r - 9.5) * 0.05;
        if (s + bayer(x, y) * 0.15 < 0.5) continue;
        cv.set(x, y, tone(B, 0.6 + s * 2), -0.05, s > 0.58 ? 230 : 140);
        continue;
      }
      if (r > 7) {
        // stone collar
        let v = 2.2 + (nz(x, y, 4, k.seed + 193) - 0.5) * 0.8 + bayer(x, y) * 0.3;
        if (r > 9) v += dx + dy < 0 ? 0.9 : -0.9;
        else if (r < 7.8) v += dx + dy < 0 ? -0.8 : 0.8;
        cv.set(x, y, tone(k.stoneA, v), 0.5);
        continue;
      }
      const spoke = Math.abs(Math.sin(ang * 3)) * r < 0.75;
      const ring = Math.abs(r - 4) < 0.6 || r > 6.2;
      const bar = (x & 3) === 1 && r < 6;
      if (spoke || ring || bar) cv.set(x, y, tone(iron, 2 + (dx + dy < 0 ? 0.8 : -0.4) + bayer(x, y) * 0.3), 0.3);
      else cv.set(x, y, hashi(x, y, 3) > 0.7 ? tone(B, 1) : 0x020101, -2.5);
    }
}

// ---------------------------------------------------------------- arena sand

function paintSand(k: RoomKit, v: number): DecoFrame {
  const S = k.sand;
  const r = rng(k.seed + 201 + v);
  // per-variant interior features (kept inside the tile)
  const spots: [number, number, number][] = [];
  if (v >= 2) for (let i = 0; i < (v === 2 ? 2 : 3); i++) spots.push([8 + r() * 16, 8 + r() * 16, 1.6 + r() * 3.2]);
  const prints: [number, number][] = v === 1 ? [[10 + r() * 4, 9 + r() * 4], [17 + r() * 4, 17 + r() * 4]] : [];
  return seam((cv, x, y) => {
    const lx = W32(x), ly = W32(y);
    const wob = Math.round(1.6 * Math.sin((lx * TAU) / T + pnoiseP(lx, 0, 16, T, k.seed + 202) * 3));
    const ph = W32(ly + wob) % 8;
    const n = nz(lx, ly, 8, k.seed + 203);
    const hs = hashi(lx, ly, k.seed + 204);
    let val = 2.1 + (n - 0.5) * 0.7 + bayer(x, y) * 0.35 + (hs > 0.94 ? 0.6 : hs < 0.05 ? -0.6 : 0);
    let h = 0;
    let flat = false;
    for (const [px, py] of prints) if (Math.hypot(lx - px, (ly - py) * 1.6) < 3.2) flat = true;
    if (!flat) {
      // rake furrow profile: shadowed groove, lit ridge, flat
      const prof = [-0.9, -0.45, 0.25, 0.7, 0.45, 0.15, 0, -0.15][ph]!;
      val += prof;
      h = [-0.6, -0.3, 0.2, 0.45, 0.4, 0.2, 0.05, -0.2][ph]!;
    } else val -= 0.3;
    let c = tone(S, val);
    for (const [sx, sy, sr] of spots) {
      const d = Math.hypot(lx + 0.5 - sx, ly + 0.5 - sy) / sr + (nz(lx, ly, 4, k.seed + 205) - 0.5) * 0.7;
      if (d < 1) c = mixc(c, d < 0.5 ? 0x1c0204 : 0x3a0a08, k.theme === 'frost' ? 0.75 : 0.65);
      else if (d < 1.6 && hashi(lx, ly, k.seed + 206) > 0.86) c = mixc(c, 0x2a0606, 0.6);
    }
    cv.set(x, y, c, h);
  }, 'xy');
}

// ---------------------------------------------------------------- ritual sigil (6x6)

/** Stamp a line segment into a distance buffer (texels to the nearest stroke). */
function stroke(D: Float32Array, n: number, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len * 2));
  for (let s = 0; s <= steps; s++) {
    const px = x0 + ((x1 - x0) * s) / steps, py = y0 + ((y1 - y0) * s) / steps;
    for (let yy = Math.floor(py - 3); yy <= Math.ceil(py + 3); yy++) {
      if (yy < 0 || yy >= n) continue;
      for (let xx = Math.floor(px - 3); xx <= Math.ceil(px + 3); xx++) {
        if (xx < 0 || xx >= n) continue;
        const d = Math.hypot(xx + 0.5 - px, yy + 0.5 - py);
        const i = yy * n + xx;
        if (d < D[i]!) D[i] = d;
      }
    }
  }
}

function paintSigil(cv: TexCanvas, k: RoomKit): void {
  const N = 6 * T, c = N / 2, RO = 92;
  const G = k.sigil;
  const D = new Float32Array(N * N).fill(99);
  // heptagram {7/3} touching the inner ring, node circles on its points
  const vx: number[] = [], vy: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 7;
    vx.push(c + Math.cos(a) * 66);
    vy.push(c + Math.sin(a) * 66);
  }
  for (let i = 0; i < 7; i++) stroke(D, N, vx[i]!, vy[i]!, vx[(i + 3) % 7]!, vy[(i + 3) % 7]!);
  for (let i = 0; i < 7; i++)
    for (let s = 0; s < 24; s++) {
      const a0 = (s / 24) * TAU, a1 = ((s + 1) / 24) * TAU;
      stroke(D, N, vx[i]! + Math.cos(a0) * 5, vy[i]! + Math.sin(a0) * 5, vx[i]! + Math.cos(a1) * 5, vy[i]! + Math.sin(a1) * 5);
    }
  // short spokes between the inner rings
  for (let i = 0; i < 7; i++) {
    const a = Math.PI / 2 + (i * TAU) / 7;
    stroke(D, N, c + Math.cos(a) * 12, c + Math.sin(a) * 12, c + Math.cos(a) * 28, c + Math.sin(a) * 28);
  }
  // rune band: procedural glyphs, upright = pointing outward
  const GL = 24;
  for (let g = 0; g < GL; g++) {
    const a = (g / GL) * TAU;
    const ox = Math.cos(a), oy = Math.sin(a), tx = -oy, ty = ox;
    const at = (col: number, row: number): [number, number] => {
      const t = (col - 1) * 2.6, rr = 79 + (row - 1.5) * 2.7;
      return [c + ox * rr + tx * t, c + oy * rr + ty * t];
    };
    const stem = Math.floor(hashi(g, 0, k.seed + 211) * 3);
    const [s0x, s0y] = at(stem, 0), [s1x, s1y] = at(stem, 3);
    stroke(D, N, s0x, s0y, s1x, s1y);
    const ns = 2 + Math.floor(hashi(g, 1, k.seed + 211) * 2);
    for (let j = 0; j < ns; j++) {
      const c0 = Math.floor(hashi(g, 2 + j * 4, k.seed + 212) * 3), r0 = Math.floor(hashi(g, 3 + j * 4, k.seed + 212) * 4);
      let c1 = c0 + Math.floor(hashi(g, 4 + j * 4, k.seed + 212) * 3) - 1, r1 = r0 + Math.floor(hashi(g, 5 + j * 4, k.seed + 212) * 3) - 1;
      c1 = Math.max(0, Math.min(2, c1));
      r1 = Math.max(0, Math.min(3, r1));
      if (c1 === c0 && r1 === r0) c1 = c0 === stem ? (c0 + 1) % 3 : stem;
      const [ax, ay] = at(c0, r0), [bx, by] = at(c1, r1);
      stroke(D, N, ax, ay, bx, by);
    }
  }
  // age: a few cracks that break the lines
  const broken = new Uint8Array(N * N);
  const r = rng(k.seed + 213);
  for (let i = 0; i < 4; i++) {
    const a0 = r() * TAU;
    let x = c + Math.cos(a0) * (RO + 1), y = c + Math.sin(a0) * (RO + 1);
    let a = a0 + Math.PI + (r() - 0.5) * 0.6;
    const len = 20 + r() * 40;
    for (let s = 0; s < len; s++) {
      a += (r() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi >= 0 && yi >= 0 && xi < N && yi < N) broken[yi * N + xi] = 1;
    }
  }
  const rings = [90, 86.5, 72, 66, 28, 12];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, rr = Math.hypot(dx, dy);
      if (rr > RO) continue;
      const i = y * N + x;
      let d = D[i]!;
      for (const ring of rings) d = Math.min(d, Math.abs(rr - ring));
      if (rr < 2.5) d = 0;
      const band = (rr > 72 && rr < 86.5) || rr < 12;
      if (broken[i] && d < 2.2) {
        cv.set(x, y, 0x060405, -1.2);
        continue;
      }
      if (d < 0.75) {
        const dim = nz(x, y, 8, k.seed + 214) > 0.7;
        const col = dim ? G[2]! : hashi(x, y, k.seed + 215) > 0.85 ? G[4]! : G[3]!;
        cv.set(x, y, col, -0.5);
        glowMax(cv, x, y, col, dim ? 170 : 255);
      } else if (d < 1.7) {
        cv.set(x, y, mixc(G[1]!, 0x000000, 0.5), -1);
        glowMax(cv, x, y, G[2]!, 110);
      } else if (d < 2.7) {
        cv.set(x, y, 0x000000, -0.1, 110);
        glowMax(cv, x, y, G[1]!, 40);
      } else if (band) {
        cv.set(x, y, mixc(0x000000, G[0]!, 0.25), 0, 60 + Math.round(bayer(x, y) * 20));
      }
    }
}

// ---------------------------------------------------------------- compass rose (6x6)

function paintRose(cv: TexCanvas, k: RoomKit): void {
  const N = 6 * T, c = N / 2, RO = 92;
  const A = k.stoneA, B = k.stoneB, Ac = k.accent;
  const gold = k.theme === 'sanctum';
  // points: [cos, sin, length, base along, base half width, tier] x 16, front to back
  const pts: number[] = [];
  const pt = (dir: number, L: number, ab: number, hb: number, tier: number): void => {
    pts.push(Math.cos(dir), Math.sin(dir), L, ab, hb, tier);
  };
  for (let i = 0; i < 4; i++) pt(Math.PI / 4 + (i * Math.PI) / 2, 77, 18, 9, 0);
  for (let i = 0; i < 4; i++) pt((i * Math.PI) / 2, 60, 14, 7, 1);
  for (let i = 0; i < 8; i++) pt(Math.PI / 8 + (i * Math.PI) / 4, 44, 10, 5, 2);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
      if (r > RO) continue;
      const wear = nz(x, y, 16, k.seed + 221) * 0.6 + nz(x, y, 4, k.seed + 222) * 0.4;
      const dn = bayer(x, y) * 0.3;
      const ang = Math.atan2(dy, dx);
      let col: number;
      let h = 0.3;
      if (r > 89) {
        // rim: bevelled border stone
        col = tone(B, 1.6 + (dx + dy < 0 ? 1.2 : -0.9) + dn);
        h = 0.6;
      } else if (r > 88) {
        col = 0x060404;
        h = -0.6;
      } else if (r > 80) {
        // voussoir band: 48 alternating blocks, inlay dot on every joint
        const seg = Math.floor(((ang / TAU + 1) * 48) % 48);
        const segF = ((ang / TAU + 1) * 48) % 1;
        if (segF < 0.06 || segF > 0.97) {
          col = 0x060404;
          h = -0.6;
        } else {
          col = tone(seg % 2 ? A : B, 2.1 + hashi(seg, 1, k.seed) * 0.5 + (r > 87 ? 0.6 : r < 81 ? -0.5 : 0) + dn);
          h = 0.4;
        }
        if (Math.abs(r - 84.5) < 1.3 && (segF < 0.12 || segF > 0.91)) {
          col = tone(Ac, 3 + dn);
          h = 0.6;
        }
      } else if (r > 77.5) {
        col = r > 79.5 || r < 78.2 ? 0x080605 : tone(Ac, 2.6 + dn);
        h = r > 79.5 || r < 78.2 ? -0.5 : 0.5;
      } else {
        // compass points, front to back
        let hit = false;
        col = 0;
        for (let p = 0; p < (r < 16 ? 0 : pts.length); p += 6) {
          const ca = pts[p]!, sa = pts[p + 1]!, L = pts[p + 2]!, ab = pts[p + 3]!, hb = pts[p + 4]!, tier = pts[p + 5]!;
          const along = dx * ca + dy * sa, side = -dx * sa + dy * ca;
          if (along < 0 || along > L) continue;
          const hw = along <= ab ? (along * hb) / ab : (hb * (L - along)) / (L - ab);
          if (Math.abs(side) > hw) continue;
          hit = true;
          const ramp = tier === 0 ? Ac : A;
          if (Math.abs(side) > hw - 1) {
            col = 0x070505;
            h = -0.4;
          } else {
            const lit = side < 0;
            col = tone(ramp, (lit ? 3 : 1.5) + (tier === 0 ? 0.2 : tier === 2 ? -0.7 : 0) + dn + (Math.abs(side) < 0.7 ? 0.8 : 0));
            h = 0.6 + (hw - Math.abs(side)) * 0.08 + (2 - tier) * 0.2;
            if (gold && tier === 0 && lit && hashi(x, y, 7) > 0.97) col = GOLD[4]!;
          }
          break;
        }
        if (!hit) {
          if (r < 16) {
            // centre boss: polished dome in a ring
            if (r > 14) col = r > 15 ? 0x070505 : tone(Ac, 2.2 + dn);
            else {
              const nx = dx / 14, ny = dy / 14;
              const lum = -(nx + ny) * 0.75 + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.6;
              col = tone(Ac, 1.9 + lum * 2 + dn);
              if (lum > 0.62 && hashi(x, y, 9) > (gold ? 0.6 : 0.85)) col = Ac[4] ?? Ac[3]!;
              h = Math.sqrt(Math.max(0, 1 - (r * r) / 196)) * 2.2;
            }
          } else {
            // field stone between the points, laid in sectors and rings
            const segF = ((ang / TAU + 1) * 32) % 1;
            const joint = segF < 0.04 * (40 / r) || Math.abs(r - 46) < 0.6 || Math.abs(r - 62) < 0.6 || Math.abs(r - 30) < 0.6;
            col = joint ? 0x080606 : tone(B, 1.5 + (nz(x, y, 8, k.seed + 223) - 0.5) * 0.8 + dn);
            h = joint ? -0.5 : 0.1;
            if (Math.abs(r - 30) < 2 && !joint && Math.abs(r - 30) > 0.6) col = tone(Ac, 2 + dn);
          }
        }
      }
      if (wear > 0.68 && col !== 0x060404) col = mixc(col, k.M.dust, (wear - 0.68) * 1.6);
      if (wear < 0.25) col = mixc(col, 0x000000, (0.25 - wear) * 1.2);
      cv.set(x, y, col, h);
    }
}

// ---------------------------------------------------------------- build

const roomCache = new Map<ThemeId, DecoFrame[]>();

/** All room-floor overlay frames of a theme, in ROOM_FLOOR_NAMES order (64x40 deco format). */
export function buildRoomFloorFrames(theme: ThemeId): DecoFrame[] {
  const hit = roomCache.get(theme);
  if (hit) return hit;
  const k = makeKit(theme);
  const out = new Map<RoomFloorName, DecoFrame>();
  const nine = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'] as const;

  // rug: one 3x3 rug cut into the nine slices
  const rug = new TexCanvas(5, 5);
  paintRug(rug, k, 3, 3);
  nine.forEach((s, i) => out.set(`rug${s}` as RoomFloorName, canvasTile(rug, 1 + (i % 3), 1 + Math.floor(i / 3))));

  const mos = new TexCanvas(4, 4);
  paintMosaic(mos, k);
  for (let i = 0; i < 16; i++) out.set(`mos${i}` as RoomFloorName, canvasTile(mos, i % 4, Math.floor(i / 4)));

  // pool: one 5x3 basin, the three centre tiles become C / C1 / C2
  const pool = new TexCanvas(7, 5);
  paintPool(pool, k, 5, 3);
  if (k.liquid === 'ice') for (const [tx, ty] of [[3, 2], [4, 2], [1, 1], [5, 3]] as const) iceCracks(pool, tx * T, ty * T, k.seed + 300 + tx * 7 + ty);
  poolFeature(pool, k, 3 * T, 2 * T, 1);
  poolFeature(pool, k, 4 * T, 2 * T, 2);
  const px = [1, 2, 5];
  nine.forEach((s, i) => out.set(`pool${s}` as RoomFloorName, canvasTile(pool, px[i % 3]!, 1 + Math.floor(i / 3))));
  out.set('poolC1', canvasTile(pool, 3, 2));
  out.set('poolC2', canvasTile(pool, 4, 2));

  for (let v = 0; v < 4; v++) out.set(`plank${v}` as RoomFloorName, paintPlanks(k, v));
  out.set('bridgeX', paintBridge(k, false, 0));
  out.set('bridgeXN', paintBridge(k, false, -1));
  out.set('bridgeXS', paintBridge(k, false, 1));
  out.set('bridgeY', paintBridge(k, true, 0));
  out.set('bridgeYW', paintBridge(k, true, -1));
  out.set('bridgeYE', paintBridge(k, true, 1));
  for (let v = 0; v < 2; v++) out.set(`checker${v}` as RoomFloorName, paintChecker(k, v));
  for (let v = 0; v < 3; v++) out.set(`bones${v}` as RoomFloorName, paintBones(k, v));
  for (let v = 0; v < 3; v++) out.set(`rubble${v}` as RoomFloorName, single((cv) => paintRubble(cv, k, v)));
  out.set('chanX', paintChannel(k, false));
  out.set('chanY', paintChannel(k, true));
  out.set('drain', single((cv) => paintDrain(cv, k)));
  for (let v = 0; v < 2; v++) out.set(`straw${v}` as RoomFloorName, single((cv) => paintStraw(cv, k, v)));
  for (let v = 0; v < 2; v++) out.set(`coins${v}` as RoomFloorName, single((cv) => paintCoins(cv, k, v)));
  for (let v = 0; v < 4; v++) out.set(`sand${v}` as RoomFloorName, paintSand(k, v));
  for (let v = 0; v < 3; v++) out.set(`growth${v}` as RoomFloorName, single((cv) => paintGrowth(cv, k, v)));
  for (let v = 0; v < 2; v++) out.set(`ash${v}` as RoomFloorName, single((cv) => paintAsh(cv, k, v)));

  const sig = new TexCanvas(6, 6);
  paintSigil(sig, k);
  for (let i = 0; i < 36; i++) out.set(`sigil${i}` as RoomFloorName, canvasTile(sig, i % 6, Math.floor(i / 6)));
  const rose = new TexCanvas(6, 6);
  paintRose(rose, k);
  for (let i = 0; i < 36; i++) out.set(`rose${i}` as RoomFloorName, canvasTile(rose, i % 6, Math.floor(i / 6)));

  const frames = ROOM_FLOOR_NAMES.map((n) => {
    const f = out.get(n);
    if (!f) throw new Error(`room floor frame missing: ${n}`);
    return f;
  });
  roomCache.set(theme, frames);
  nzCache.clear();
  return frames;
}

/** True if any room-floor frame of the theme has emissive pixels. */
export function roomFloorHasGlow(theme: ThemeId): boolean {
  return buildRoomFloorFrames(theme).some((f) => f.glow.data.some((c) => c >>> 24 !== 0));
}
