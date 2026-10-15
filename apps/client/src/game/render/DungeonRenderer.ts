import * as Phaser from 'phaser';
import { DECALS, PROPS, ensureTheme, normalKey, type PropDef } from '../art/dungeon';
import { isoFloorFrame, isoWallGlowFrames, pickIsoStub, pickIsoWall } from '../art/isoTerrain';
import { DECO_TOP } from '../art/isoFloor';
import { ATMO_KEYS, gradeTexture } from '../art/atmosphere';
import { addFramedTexture } from '../art/texutil';
import type { ThemeId } from '../art/dungeonThemes';
import { renderTheme, type RenderTheme } from './themes';
import { HH, HW, STUB_H, WALL_H, iso, isoBounds } from './iso';
import { ensureIsoFallback, wallPropFor } from './isoArt';
import { planDressing, trailMarks, type DressingPlan, type PlanStamp } from './dressing';
import { Ambient } from './Ambient';
import { Skybox } from './Skybox';
import { gfx as gfxKnobs } from '../gfx';
import type { MapRoom } from '@cursebound/simulation';

// Isometric dungeon renderer (PRD §15.1, Diablo-style 2:1 projection over the flat simulation plane).
// Floors are baked into one lit render texture of diamonds cut from a seamless world-space masonry macro, together
// with everything flat that makes a floor feel lived in: dais, runners, slabs, grates, wall-base grit, grime,
// footprints, drag marks, old blood, coins and every low prop. A second render texture with the same layout holds the
// floor's normal map (Light2D reads it through the floor texture's data source), a third, unlit and additive, holds
// what glows by itself (lava seams, mycelium, sigils). Only things with height or motion stay sprites, depth-sorted
// with actors. Every boundary wall is a tall block sprite sorted by screen row (its own normal map rakes the torch
// light across the masonry); walls between the camera and a room are cut down to stubs so rooms always read, and the
// slab's side face hangs below them into the chasm where only rock lies beyond. Full-height walls that hide a hero
// fade out. Lighting is Phaser's Light2D: torches, braziers, candles, coloured glows, light shafts through the vault,
// plus dynamic spell lights. Atmosphere: low fog banks, a theme screen grade and drifting particles.
// What goes where comes from the deterministic planner in dressing.ts (typed rooms: roomDressing.ts); ambient life
// lives in Ambient.ts. Chasms (MapState voids) draw no masonry: the floor's edge hangs over the drop as a cliff with
// mist far below. Cosmetic density follows gfx().decorDensity; with gfx().animatedDecor off, props hold still,
// flames stop flickering and the fog, haze and light shafts stay put. Open-air themes (RenderTheme.backdrop) hang
// a sky or starfield behind the floor (Skybox.ts); the sky island draws its back walls as a low rim (lowWalls).

export interface MapLike {
  w: number;
  h: number;
  tiles: number[];
  decorSeed: number;
  theme?: string;
  layout?: string;
  topology?: string;
  rooms?: MapRoom[];
  voids?: number[];
  arena?: string;
  bossSpawn?: { x: number; y: number };
  playerSpawns?: { x: number; y: number }[];
  enemySpawns?: { x: number; y: number }[];
}

interface TorchLight { light: Phaser.GameObjects.Light; base: number; radius: number; flicker: number; phase: number; rate: number; glow?: Phaser.GameObjects.Image; core?: Phaser.GameObjects.Light; coreBase?: number }
interface Occluder { objs: (Phaser.GameObjects.Image | Phaser.GameObjects.Sprite)[]; depth: number; x0: number; x1: number; y0: number; y1: number; alpha: number }
type Placeable = Pick<PropDef, 'key' | 'anim' | 'originX' | 'originY' | 'light' | 'emissive' | 'glowKey' | 'glowAnim' | 'sway' | 'variants'> & { id?: string };

/** Depth of props that lie flat on the floor: above the floor and decal textures, below hazards (-80), telegraphs (-70) and shadows. */
const FLAT_DEPTH = -86;
/** Unlit emissive floor layer (above the floor, below combat decals). */
const GLOW_DEPTH = -95;
/** The slab's side faces hanging into the chasm. */
const CLIFF_DEPTH = -99;
/** Cliffs at the brink of a chasm: under the floor, so nearer floor (a bridge, the far rim) covers them. */
const VOID_DEPTH = -101;
/** Low fog banks: over the floor and flat props, under shadows and actors. */
const FOG_DEPTH = -84;
/** Theme grade: over the world, under bars / numbers (4500+) and particles. */
const GRADE_DEPTH = 4400;

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class DungeonRenderer {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private occluders: Occluder[] = [];
  private torches: TorchLight[] = [];
  private dyn: { light: Phaser.GameObjects.Light; until: number; fade: number; base: number }[] = [];
  private shafts: { beam: Phaser.GameObjects.Image; pool: Phaser.GameObjects.Image; light: Phaser.GameObjects.Light | null; base: number; phase: number }[] = [];
  private fogs: { img: Phaser.GameObjects.Image; x: number; y: number; dx: number; dy: number; rate: number; phase: number; a: number }[] = [];
  private grade: Phaser.GameObjects.Image | null = null;
  decalRT: Phaser.GameObjects.RenderTexture | null = null;
  private floorRT: Phaser.GameObjects.RenderTexture | null = null;
  private normalRT: Phaser.GameObjects.RenderTexture | null = null;
  private origin = { x: 0, y: 0 };
  private stamp: Phaser.GameObjects.Image | null = null;
  private map: MapLike | null = null;
  private key: number[] | null = null;
  private ambient: Ambient | null = null;
  private skybox: Skybox | null = null;
  lighting: boolean;
  /** animated decor on (gfx tier), read at build */
  private animated = true;
  theme: RenderTheme = renderTheme('catacombs');
  /** screen-space bounds of the current map, including wall height */
  bounds = { x: 0, y: 0, w: 0, h: 0 };
  /** diagnostics: ms the last build() took, and what it produced */
  buildMs = 0;
  buildStats = { sprites: 0, stamps: 0, lights: 0, vignettes: 0, planMs: 0, floorFx: 0, cliffs: 0, normals: false };
  /** the dressing plan of the current map (read-only; tests and tools) */
  plan: DressingPlan | null = null;

  constructor(private scene: Phaser.Scene, opts: { lighting?: boolean; ambient?: number } = {}) {
    this.lighting = opts.lighting !== false && !!scene.lights;
    if (this.lighting) {
      scene.lights.enable();
      scene.lights.setAmbientColor(opts.ambient ?? 0x3a3044);
    }
  }

  private lit<T extends Phaser.GameObjects.GameObject & { setPipeline?: (p: string) => unknown }>(o: T): T {
    if (this.lighting && o.setPipeline) o.setPipeline('Light2D');
    return o;
  }

  build(map: MapLike) {
    if (this.key === map.tiles) return;
    const t0 = performance.now();
    this.destroy(false);
    this.key = map.tiles;
    this.map = map;
    const s = this.scene;
    const theme = map.theme ?? 'catacombs';
    ensureTheme(s, theme);
    ensureIsoFallback(s, theme);
    const themeId = theme as ThemeId;
    const th = this.theme = renderTheme(theme);
    const knobs = gfxKnobs();
    this.animated = knobs.animatedDecor;
    const plan = this.plan = planDressing(map, { density: knobs.decorDensity });
    const roomKey = `iso:room:${theme}`, roomGlowKey = `iso:roomglow:${theme}`;
    const voidSet = new Set(plan.voids);
    const floorKey = `iso:floor:${theme}`, wallKey = `iso:wall:${theme}`, stubKey = `iso:stub:${theme}`;
    const decoKey = `iso:deco:${theme}`, cliffKey = `iso:cliff:${theme}`;
    const floorGlowKey = `iso:floorglow:${theme}`, decoGlowKey = `iso:decoglow:${theme}`, wallGlowKey = `iso:wallglow:${theme}`;
    const has = (k: string) => s.textures.exists(k);
    const floorFrames = Math.max(1, s.textures.get(floorKey).frameTotal - 1);
    const macroFloor = floorFrames >= 64;
    const wallFrames = Math.max(1, s.textures.get(wallKey).frameTotal - 1);
    const stubFrames = Math.max(1, s.textures.get(stubKey).frameTotal - 1);
    const wallGlowFlags = isoWallGlowFrames(themeId);
    if (this.lighting) s.lights.setAmbientColor(th.ambient);
    const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= map.w || y >= map.h || map.tiles[y * map.w + x] === 1;
    /** masonry only (chasm tiles cast no contact shadow and grow no wall) */
    const isRock = (x: number, y: number) => isWall(x, y) && !voidSet.has(y * map.w + x);
    const seed = map.decorSeed + 17;
    const b = isoBounds(map.w, map.h);
    this.origin = { x: b.minX, y: b.minY };
    this.bounds = { x: b.minX - HW * 2, y: b.minY - WALL_H - HH * 2, w: b.width + HW * 4, h: b.height + WALL_H + HH * 4 };
    const ox = b.minX, oy = b.minY;
    let stamps = 0;
    const floorFrameAt = (x: number, y: number) => (macroFloor ? isoFloorFrame(x, y) : Math.floor(hash(x, y, seed) * floorFrames));

    // ---- floor: diamonds + every flat layer baked into one lit render texture, in a single batch
    const floor = this.floorRT = s.add.renderTexture(ox, oy, b.width, b.height).setOrigin(0, 0).setDepth(-100);
    const stamp = this.stamp = s.make.image({ x: 0, y: 0, key: '__WHITE', add: false });
    const gfx = s.make.graphics({ x: 0, y: 0 }, false);
    floor.beginDraw();
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (isWall(x, y)) continue;
      floor.batchDrawFrame(floorKey, floorFrameAt(x, y), iso.x(x, y) - HW - ox, iso.y(x, y) - oy);
    }
    // per-room floor treatments: rugs, pools, planks, marble, sand, bones, medallions, bridge decks
    if (has(roomKey)) for (const fd of plan.roomFloor) floor.batchDrawFrame(roomKey, fd.frame, iso.x(fd.x, fd.y) - HW - ox, iso.y(fd.x, fd.y) - DECO_TOP - oy);
    // dais, centrepieces, runners, slabs, grates, wall-base grit, cracks (tile-aligned overlays)
    if (has(decoKey)) for (const fd of plan.floor) floor.batchDrawFrame(decoKey, fd.frame, iso.x(fd.x, fd.y) - HW - ox, iso.y(fd.x, fd.y) - DECO_TOP - oy);
    const bake = (st: PlanStamp) => {
      if (!s.textures.exists(st.key)) return;
      const tex = s.textures.get(st.key);
      const frames = Math.max(1, tex.frameTotal - 1);
      const def = st.prop ? PROPS[st.prop] : undefined;
      stamp.setTexture(st.key, Math.min(frames - 1, st.frame)).setOrigin(def ? def.originX : 0.5, def ? def.originY : 0.5)
        .setScale(st.sx ?? 1, st.sy ?? 1).setFlip(!!st.flip, !!st.flipY).setAlpha(st.alpha ?? 1);
      if (st.tint !== undefined) stamp.setTint(st.tint);
      else stamp.clearTint();
      const p = iso.p(st.x, st.y);
      floor.batchDraw(stamp, Math.round(p.x - ox), Math.round(p.y - oy));
      stamps++;
    };
    for (const st of plan.grime) bake(st);
    // the old free-form edge decals give way to the tile-aligned wall-base overlays when the theme has them
    if (!has(decoKey)) for (const st of plan.edges) bake(st);
    for (const st of plan.decals) bake(st);
    // trails (footprints, drag marks, blood) and soft contact shadows under older props
    for (const t of plan.trails) for (const m of trailMarks(t)) gfx.fillStyle(m.color, m.a).fillRect(m.x - ox, m.y - oy, m.w, m.h);
    for (const sh of plan.shadows) {
      const p = iso.p(sh.x, sh.y);
      gfx.fillStyle(0x000000, sh.a * 0.55).fillEllipse(p.x - ox, p.y - oy, sh.rx * 2, sh.ry * 2);
      gfx.fillStyle(0x000000, sh.a * 0.45).fillEllipse(p.x - ox, p.y - oy, sh.rx * 1.3, sh.ry * 1.3);
    }
    floor.batchDraw(gfx);
    gfx.clear();
    for (const st of plan.low) bake(st);
    // contact shadows where floor meets wall: deep against the tall back walls, light against the cut front walls
    const edge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number, depth: number, alpha: number) => {
      const A = iso.p(ax, ay), B = iso.p(bx, by);
      for (let k = 0; k < 3; k++) {
        const d0 = depth * (k / 3), d1 = depth * ((k + 1) / 3);
        const o0 = iso.dir(nx * d0, ny * d0), o1 = iso.dir(nx * d1, ny * d1);
        gfx.fillStyle(0x000000, alpha * (1 - k / 3)).fillPoints([
          { x: A.x + o0.x - ox, y: A.y + o0.y - oy }, { x: B.x + o0.x - ox, y: B.y + o0.y - oy },
          { x: B.x + o1.x - ox, y: B.y + o1.y - oy }, { x: A.x + o1.x - ox, y: A.y + o1.y - oy },
        ], true);
      }
    };
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (isWall(x, y)) continue;
      if (isRock(x, y - 1)) edge(x, y, x + 1, y, 0, 1, 0.5, 0.55);
      if (isRock(x - 1, y)) edge(x, y, x, y + 1, 1, 0, 0.5, 0.5);
      if (isRock(x, y + 1)) edge(x, y + 1, x + 1, y + 1, 0, -1, 0.25, 0.3);
      if (isRock(x + 1, y)) edge(x + 1, y, x + 1, y + 1, -1, 0, 0.25, 0.3);
    }
    floor.batchDraw(gfx);
    floor.endDraw();
    gfx.destroy();
    stamp.clearTint().setFlip(false, false).setScale(1).setAlpha(1);
    this.objs.push(this.lit(floor));

    // ---- the floor's normal map: same diamonds and overlays, read by Light2D through the floor's data source
    let normals = false;
    if (this.lighting && has(normalKey(floorKey))) {
      const nrt = this.normalRT = s.make.renderTexture({ x: 0, y: 0, width: b.width, height: b.height }, false);
      nrt.fill(0x8080ff, 1);
      nrt.beginDraw();
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (isWall(x, y)) continue;
        nrt.batchDrawFrame(normalKey(floorKey), floorFrameAt(x, y), iso.x(x, y) - HW - ox, iso.y(x, y) - oy);
      }
      if (has(normalKey(roomKey))) for (const fd of plan.roomFloor) nrt.batchDrawFrame(normalKey(roomKey), fd.frame, iso.x(fd.x, fd.y) - HW - ox, iso.y(fd.x, fd.y) - DECO_TOP - oy);
      if (has(normalKey(decoKey))) for (const fd of plan.floor) nrt.batchDrawFrame(normalKey(decoKey), fd.frame, iso.x(fd.x, fd.y) - HW - ox, iso.y(fd.x, fd.y) - DECO_TOP - oy);
      nrt.endDraw();
      const glTex = (nrt.texture.source[0] as unknown as { glTexture?: unknown }).glTexture;
      if (glTex) {
        (floor.texture as unknown as { setDataSource: (d: unknown) => void }).setDataSource(glTex);
        normals = true;
      }
    }

    // ---- what glows by itself on the floor: lava seams, mycelium, sigils (unlit, additive)
    if (has(floorGlowKey) || has(decoGlowKey) || (has(roomGlowKey) && plan.roomFloor.length)) {
      const grt = s.add.renderTexture(ox, oy, b.width, b.height).setOrigin(0, 0).setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
      grt.beginDraw();
      if (has(floorGlowKey)) for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (isWall(x, y)) continue;
        grt.batchDrawFrame(floorGlowKey, floorFrameAt(x, y), iso.x(x, y) - HW - ox, iso.y(x, y) - oy);
      }
      if (has(roomGlowKey)) for (const fd of plan.roomFloor) grt.batchDrawFrame(roomGlowKey, fd.frame, iso.x(fd.x, fd.y) - HW - ox, iso.y(fd.x, fd.y) - DECO_TOP - oy);
      if (has(decoGlowKey)) for (const fd of plan.floor) grt.batchDrawFrame(decoGlowKey, fd.frame, iso.x(fd.x, fd.y) - HW - ox, iso.y(fd.x, fd.y) - DECO_TOP - oy);
      grt.endDraw();
      this.objs.push(grt);
    }

    // persistent combat decals (blood, scorch) stamped during play
    this.decalRT = s.add.renderTexture(ox, oy, b.width, b.height).setOrigin(0, 0).setDepth(-90);
    this.objs.push(this.lit(this.decalRT));

    // ---- the slab's side faces under the cut front walls, hanging into the chasm
    if (has(cliffKey)) plan.cliffs.forEach((cl, k) => {
      const T = iso.p(cl.x, cl.y);
      if (cl.L) this.objs.push(this.lit(s.add.image(T.x - HW, T.y, cliffKey, cl.v).setOrigin(0, 0).setDepth(CLIFF_DEPTH)));
      if (cl.R) this.objs.push(this.lit(s.add.image(T.x - HW, T.y, cliffKey, 3 + cl.v).setOrigin(0, 0).setDepth(CLIFF_DEPTH)));
      // mist curling far below the edge: the chasm has a bottom you will never see
      if (k % 3 === 0 && has(ATMO_KEYS.fog)) {
        const img = s.add.image(Math.round(T.x), Math.round(T.y + 74), ATMO_KEYS.fog).setTint(th.fogColor).setAlpha(Math.min(0.2, th.fogAlpha * 1.3)).setScale(1.3, 0.9).setDepth(CLIFF_DEPTH - 0.5);
        this.fogs.push({ img, x: T.x, y: T.y + 74, dx: 14, dy: 2, rate: 0.00007 + (k % 5) * 0.00001, phase: k * 0.7, a: 0.15 });
        this.objs.push(img);
      }
    });

    // ---- the brink of every chasm: strata hanging into the dark (a bridge shows only its deck's thickness), mist below
    if (has(cliffKey)) plan.voidCliffs.forEach((cl, k) => {
      const T = iso.p(cl.x, cl.y);
      for (const [on, f] of [[cl.L, cl.v], [cl.R, 3 + cl.v]] as const) {
        if (!on) continue;
        const img = this.lit(s.add.image(T.x - HW, T.y, cliffKey, f).setOrigin(0, 0).setDepth(VOID_DEPTH));
        if (cl.bridge) img.setCrop(0, 0, 64, HH * 2 + 7).setTint(0x9a7a5a);
        this.objs.push(img);
      }
      if (k % 4 === 0 && has(ATMO_KEYS.fog)) {
        const img = s.add.image(Math.round(T.x), Math.round(T.y + 96), ATMO_KEYS.fog).setTint(th.fogColor).setAlpha(Math.min(0.22, th.fogAlpha * 1.4)).setScale(1.5, 1).setDepth(VOID_DEPTH - 1);
        this.fogs.push({ img, x: T.x, y: T.y + 96, dx: 16, dy: 3, rate: 0.00006 + (k % 5) * 0.00001, phase: k * 0.9, a: 0.16 });
        this.objs.push(img);
      }
    });

    // ---- walls (classification and face dressing come from the plan)
    const blockerAt = new Map(plan.blockers.map((b) => [b.y * map.w + b.x, b] as const));
    let blockerLights = 0;
    for (const w of plan.walls) {
      const { x, y } = w;
      const T = iso.p(x, y);
      const depth = (x + y + 1) * 10;
      const c = iso.p(x + 0.5, y + 0.5);
      const bk = w.kind === 'pillar' || w.kind === 'pair' ? blockerAt.get(y * map.w + x) : undefined;
      const bdef = bk ? PROPS[bk.id] : undefined;
      if (bk && bdef && s.textures.exists(bdef.key)) {
        // room furniture the simulation carved (bookcase, iron maiden, obelisk, ...) stands on the tile centre
        const light = !!bdef.light && blockerLights < 6;
        if (light) blockerLights++;
        const spr = this.placeDef({ ...bdef, id: bk.id }, c.x, c.y, depth, bk.flip, bk.frame, light);
        if (spr) {
          const main = spr[0]!;
          this.occluders.push({ objs: spr, depth, x0: c.x - main.displayWidth / 2, x1: c.x + main.displayWidth / 2, y0: c.y - main.displayHeight * bdef.originY, y1: c.y + HH, alpha: 1 });
          continue;
        }
      }
      if (w.kind === 'pillar' || w.kind === 'pair') {
        // free-standing pieces become props: pillars, and 2x1 blocks read as paired sarcophagi
        const standId = w.kind === 'pillar' ? (th.pillarProp && PROPS[th.pillarProp] ? th.pillarProp : 'pillar') : 'sarcophagus';
        const p = PROPS[standId];
        if (p && s.textures.exists(p.key)) {
          const img = s.add.image(c.x, c.y + HH * 0.5, p.key).setOrigin(p.originX, p.originY).setDepth(depth);
          this.objs.push(this.lit(img));
          this.occluders.push({ objs: [img], depth, x0: c.x - img.width / 2, x1: c.x + img.width / 2, y0: c.y - img.height, y1: c.y + HH, alpha: 1 });
          continue;
        }
      }
      // open-air floors (the sky shard) keep their back walls as a low rim: drawn like cut front walls, undressed
      if (w.kind === 'stub' || (th.lowWalls && w.kind === 'block')) {
        const sf = stubFrames >= 4 ? pickIsoStub(x, y, seed) : Math.floor(hash(x, y, seed + 1) * stubFrames);
        const img = s.add.image(T.x - HW, T.y - STUB_H, stubKey, Math.min(stubFrames - 1, sf)).setOrigin(0, 0).setDepth(depth);
        this.objs.push(this.lit(img));
        continue;
      }
      const fN = !isWall(x, y - 1), fW = !isWall(x - 1, y), fNW = !isWall(x - 1, y - 1);
      const frame = Math.min(wallFrames - 1, pickIsoWall(themeId, isWall, x, y, seed, { L: !!w.L?.torch, R: !!w.R?.torch }));
      const img = s.add.image(T.x - HW, T.y - WALL_H, wallKey, frame).setOrigin(0, 0).setDepth(depth);
      this.objs.push(this.lit(img));
      const occ: Occluder | null = fN || fW || fNW ? { objs: [img], depth, x0: T.x - HW, x1: T.x + HW, y0: T.y - WALL_H, y1: T.y + HH * 2, alpha: 1 } : null;
      if (occ) this.occluders.push(occ);
      // lava, runes and candle flames set into the face glow on their own
      if (wallGlowFlags[frame] && has(wallGlowKey)) {
        const g = s.add.image(T.x - HW, T.y - WALL_H, wallGlowKey, frame).setOrigin(0, 0).setDepth(depth + 0.02).setBlendMode(Phaser.BlendModes.ADD);
        this.objs.push(g);
        occ?.objs.push(g);
      }
      // wall-mounted dressing on the faces that look into a room
      for (const side of ['L', 'R'] as const) {
        const fd = w[side];
        if (!fd) continue;
        const A = side === 'L' ? iso.p(x, y + 1) : iso.p(x + 1, y);
        const B = iso.p(x + 1, y + 1);
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        if (fd.torch) {
          const spr = this.placeProp(fd.id, mx, my - 26, depth + 0.4);
          if (spr && occ) occ.objs.push(...spr);
          continue;
        }
        const def = wallPropFor(s, fd.id, side);
        if (!def) continue;
        const hang = def.originY < 0.5;
        const lift = def.mount ?? (hang ? WALL_H - 6 : 16);
        const spr = this.placeDef({ ...def, id: fd.id }, mx, my - lift, depth + 0.3, false, fd.frame, fd.light);
        if (spr && occ) occ.objs.push(...spr);
      }
    }

    // cobwebs strung across inside corners of two tall walls
    if (!th.lowWalls) for (const cw of plan.cobwebs) {
      const T = iso.p(cw.x, cw.y);
      this.placeProp('cobweb', T.x, T.y - WALL_H + 4, (cw.x + cw.y + 1) * 10 - 9.5);
    }

    // ---- standing and flat props: vignettes, clutter, braziers
    for (const sp of plan.sprites) {
      const def = PROPS[sp.id];
      if (!def) continue;
      const p = iso.p(sp.x, sp.y);
      const depth = sp.layer === 'flat' ? FLAT_DEPTH + (sp.x + sp.y) * 0.01 : (sp.x + sp.y) * 10 + sp.bias;
      const spr = this.placeDef({ ...def, id: sp.id }, p.x, p.y, depth, sp.flip, sp.frame, sp.light);
      // tall pieces fade like walls when a hero slips behind them
      if (spr && sp.layer === 'row' && (def.h ?? 0) >= 40) {
        const main = spr[0]!;
        const w0 = main.displayWidth, h0 = main.displayHeight;
        this.occluders.push({ objs: spr, depth, x0: p.x - w0 / 2, x1: p.x + w0 / 2, y0: p.y - h0 * def.originY, y1: p.y + 4, alpha: 1 });
      }
    }

    // ---- themed ambient particles drifting through the whole floor
    const P = th.particles;
    const key = P === 'snow' && s.textures.exists('pfx:snow') ? 'pfx:snow' : (P === 'spores' || P === 'data') && s.textures.exists('pfx:spore') ? 'pfx:spore' : P === 'drips' && s.textures.exists('pfx:drip') ? 'pfx:drip' : P === 'petals' && s.textures.exists('pfx:snow') ? 'pfx:snow' : 'pfx:ember';
    if (s.textures.exists(key)) {
      const cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig =
        P === 'snow' ? { speedX: { min: -14, max: 4 }, speedY: { min: 14, max: 30 }, lifespan: 7000, frequency: 60, alpha: { start: 0.8, end: 0 } }
        // petals and seeds blown across the sky shard on the wind
        : P === 'petals' ? { speedX: { min: 30, max: 70 }, speedY: { min: -6, max: 14 }, lifespan: 6000, frequency: 140, alpha: { start: 0.85, end: 0 }, rotate: { min: 0, max: 360 } }
        // data motes rising off the racks, a few at a time
        : P === 'data' ? { speedX: { min: -3, max: 3 }, speedY: { min: -26, max: -10 }, lifespan: 3200, frequency: 120, alpha: { start: 0.8, end: 0 } }
        : P === 'drips' ? { speedY: { min: 120, max: 180 }, lifespan: 900, frequency: 200, alpha: { start: 0.7, end: 0.2 } }
        : P === 'embers' ? { speedX: { min: -10, max: 10 }, speedY: { min: -40, max: -14 }, lifespan: 3500, frequency: 90, alpha: { start: 0.9, end: 0 } }
        : P === 'spores' ? { speedX: { min: -8, max: 8 }, speedY: { min: -14, max: -4 }, lifespan: 6000, frequency: 80, alpha: { start: 0.7, end: 0 } }
        : { speedX: { min: -6, max: 6 }, speedY: { min: -10, max: -2 }, lifespan: 6000, frequency: 160, alpha: { start: 0.35, end: 0 } };
      const mgr = s.add.particles(0, 0, key, {
        x: { min: b.minX, max: b.maxX }, y: { min: -WALL_H, max: b.maxY }, scale: { min: 0.6, max: 1.1 }, tint: th.particleTint,
        blendMode: P === 'drips' || P === 'snow' || P === 'petals' ? 'NORMAL' : 'ADD', ...cfg,
      }).setDepth(4800);
      this.objs.push(mgr);
    }

    // ---- shafts of light falling through cracks in the vault, with dust turning in them
    if (has(ATMO_KEYS.shaft)) for (const sh of plan.shafts) {
      const q = iso.p(sh.x, sh.y);
      const beam = s.add.image(Math.round(q.x + 20 * sh.w), Math.round(q.y + 6), ATMO_KEYS.shaft).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD)
        .setTint(th.shaftColor).setAlpha(0.27).setScale(sh.w, 1).setDepth(4600);
      const pool = s.add.image(Math.round(q.x), Math.round(q.y), ATMO_KEYS.pool).setBlendMode(Phaser.BlendModes.ADD)
        .setTint(th.shaftColor).setAlpha(0.2).setScale(sh.w * 1.1, sh.w * 1.1).setDepth(FOG_DEPTH - 1);
      const light = this.lighting ? s.lights.addLight(q.x, q.y - 8, 90 * sh.w, th.shaftColor, 0.55) : null;
      this.shafts.push({ beam, pool, light, base: 0.55, phase: hash(Math.floor(sh.x), Math.floor(sh.y), seed) * 10 });
      this.objs.push(beam, pool);
      if (s.textures.exists('pfx:dust') && this.animated) {
        const dust = s.add.particles(0, 0, 'pfx:dust', {
          x: { min: q.x - 14 * sh.w, max: q.x + 22 * sh.w }, y: { min: q.y - 150, max: q.y - 4 }, speedX: { min: -3, max: 3 }, speedY: { min: 2, max: 8 },
          lifespan: 4000, frequency: 240, alpha: { start: 0.55, end: 0 }, scale: { min: 0.5, max: 0.9 }, tint: th.shaftColor, blendMode: 'ADD',
        }).setDepth(4601);
        this.objs.push(dust);
      }
    }

    // ---- low fog banks creeping over the floor (unlit, tinted per theme)
    if (has(ATMO_KEYS.fog)) for (const fg of plan.fog) {
      const q = iso.p(fg.x, fg.y);
      const sc = fg.r / 2.2;
      const a = th.fogAlpha * (0.7 + hash(Math.floor(fg.x * 7), Math.floor(fg.y * 7), seed) * 0.6);
      const img = s.add.image(Math.round(q.x), Math.round(q.y), ATMO_KEYS.fog).setTint(th.fogColor).setAlpha(a).setScale(sc, sc).setDepth(FOG_DEPTH);
      this.fogs.push({ img, x: q.x, y: q.y, dx: 10 + hash(1, Math.floor(fg.x), seed) * 18, dy: 3 + hash(2, Math.floor(fg.y), seed) * 4, rate: 0.00008 + hash(3, Math.floor(fg.x), seed) * 0.00008, phase: hash(4, Math.floor(fg.y), seed) * 6.3, a });
      this.objs.push(img);
    }

    // ---- low drifting haze: a few huge soft blooms tinted by the theme, barely there but it makes the air thick
    if (s.textures.exists('light:soft')) {
      const n = Math.min(14, 4 + Math.floor((map.w * map.h) / 90));
      for (let i = 0; i < n; i++) {
        const wx = 2 + hash(i, 1, seed) * (map.w - 4), wy = 2 + hash(i, 2, seed) * (map.h - 4);
        const q = iso.p(wx, wy);
        const sc = 2.2 + hash(i, 3, seed) * 2.4;
        const img = s.add.image(q.x, q.y, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(th.particleTint)
          .setAlpha(0.035 + hash(i, 4, seed) * 0.035).setScale(sc, sc * 0.45).setDepth(4750);
        if (this.animated) s.tweens.add({ targets: img, x: q.x + 60 + hash(i, 5, seed) * 80, y: q.y + 10, duration: 14000 + hash(i, 6, seed) * 12000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.objs.push(img);
      }
    }

    // ---- theme grade: a screen-fixed multiply wash, warm or cold at the edges of the view
    {
      const gt = gradeTexture(th.grade);
      if (!has(gt.key)) addFramedTexture(s, gt.key, gt.width, gt.height, gt.rgba, gt.width, gt.height, 1, true);
      const cam = s.cameras.main;
      // centred and oversized so camera zooms (cutscenes) never uncover an edge
      this.grade = s.add.image(cam.width / 2, cam.height / 2, gt.key).setScrollFactor(0).setDepth(GRADE_DEPTH)
        .setBlendMode(Phaser.BlendModes.MULTIPLY).setDisplaySize(cam.width * 1.3, cam.height * 1.3);
      this.objs.push(this.grade);
    }

    // ---- ambient life: critters, smoke, spores, embers, drips, gusts
    this.ambient = new Ambient(s, plan.ambient, this.lighting);

    // ---- open-air themes: the sky (clouds below, the shard's underside, islets) or the moon's starfield
    if (th.backdrop) this.skybox = new Skybox(s, th.backdrop, plan, map.w, map.h, { animated: this.animated, density: knobs.decorDensity, seed });

    this.buildMs = performance.now() - t0;
    this.buildStats = { sprites: plan.sprites.length, stamps, lights: this.torches.length, vignettes: plan.stats.vignettes, planMs: plan.stats.ms, floorFx: plan.floor.length, cliffs: plan.cliffs.length, normals };
  }

  private placeProp(id: string, x: number, y: number, depth: number, flip = false) {
    const p = PROPS[id];
    if (!p) return null;
    return this.placeDef({ ...p, id }, x, y, depth, flip);
  }

  /** Place a prop sprite (+ its unlit glow layer). Returns the sprites, or null if the texture is missing. */
  private placeDef(p: Placeable, x: number, y: number, depth: number, flip = false, frame = 0, withLight = true): Phaser.GameObjects.Sprite[] | null {
    const s = this.scene;
    if (!s.textures.exists(p.key)) return null;
    const spr = s.add.sprite(Math.round(x), Math.round(y), p.key).setOrigin(p.originX, p.originY).setDepth(depth).setFlipX(flip);
    const out = [spr];
    const anim = p.anim && !p.variants ? s.anims.get(p.anim) : undefined;
    if (anim && anim.frames.length > 0 && this.animated) {
      spr.play({ key: p.anim!, startFrame: Math.floor(Math.random() * anim.frames.length) });
      // no two flames, chains or banners keep the same rhythm
      spr.anims.timeScale = p.sway ? 0.7 + Math.random() * 0.6 : 0.8 + Math.random() * 0.45;
    } else if (frame > 0) spr.setFrame(frame);
    // emitters are unlit so they glow in the dark; props with a separate glow layer keep a lit body
    const glowLayer = p.glowKey && s.textures.exists(p.glowKey) ? p.glowKey : null;
    if (!(p.emissive || (p.light && !glowLayer))) this.lit(spr);
    this.objs.push(spr);
    if (glowLayer) {
      const g = s.add.sprite(spr.x, spr.y, glowLayer).setOrigin(p.originX, p.originY).setDepth(depth + 0.05).setFlipX(flip);
      const ga = p.glowAnim ? s.anims.get(p.glowAnim) : undefined;
      if (ga && ga.frames.length > 0 && this.animated) {
        g.play({ key: p.glowAnim!, startFrame: Math.floor(Math.random() * ga.frames.length) });
        g.anims.timeScale = 0.8 + Math.random() * 0.45;
      }
      this.objs.push(g);
      out.push(g);
    }
    if (p.light && this.lighting && withLight) {
      const lx = x, ly = y - (spr.height * p.originY) * 0.6;
      const warm = p.id === 'torch' || p.id === 'brazier';
      const lightColor = warm ? this.theme.torch : p.light.color;
      const boost = warm || p.id === this.theme.torchProp ? this.theme.torchBoost : 1;
      const radius = p.light.radius * 1.35 * (warm ? 1.1 : 1);
      const light = s.lights.addLight(lx, ly, radius, lightColor, p.light.intensity * 1.1 * boost);
      // a tight hot core under big flames: a brighter pool right at the source, the wide light falls off softly
      let core: Phaser.GameObjects.Light | undefined;
      if (warm || p.id === this.theme.torchProp) core = s.lights.addLight(lx, ly + 6, radius * 0.38, lightColor, 0.55 * boost);
      let glow: Phaser.GameObjects.Image | undefined;
      if (s.textures.exists('light:soft')) {
        glow = s.add.image(lx, ly, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(lightColor).setAlpha(0.22).setDepth(4700).setScale(radius / 256, radius / 384);
        this.objs.push(glow);
      }
      this.torches.push({ light, base: p.light.intensity * 1.1 * boost, radius, flicker: p.light.flicker, phase: Math.random() * 100, rate: 0.7 + Math.random() * 0.7, glow, core, coreBase: 0.55 * boost });
    }
    return out;
  }

  /** Short-lived light for spells, projectiles, explosions (screen coordinates). */
  flashLight(x: number, y: number, radius: number, color: number, intensity: number, ms: number) {
    if (!this.lighting) return;
    if (this.dyn.length > 14) { const old = this.dyn.shift()!; this.scene.lights.removeLight(old.light); }
    const light = this.scene.lights.addLight(x, y, radius, color, intensity);
    this.dyn.push({ light, until: this.scene.time.now + ms, fade: ms, base: intensity });
  }

  /** Stamp a persistent decal flat onto the floor at a screen position. */
  addDecal(kind: 'blood' | 'scorch' | 'ichor' | 'slime', x: number, y: number, tint: number, scale = 1) {
    const rt = this.decalRT;
    const key = DECALS[kind];
    if (!rt || !key || !this.scene.textures.exists(key) || !this.stamp) return;
    const frames = this.scene.textures.get(key).frameTotal - 1;
    const st = this.stamp.setTexture(key, frames > 1 ? Math.floor(Math.random() * frames) : undefined).setOrigin(0.5, 0.5);
    st.setTint(tint).setScale(scale * 1.3, scale * 0.65).setFlipX(Math.random() < 0.5).setFlipY(Math.random() < 0.5).setAlpha(0.85);
    rt.draw(st, x - this.origin.x, y - this.origin.y);
    st.clearTint();
  }

  /** Bake a fallen body (last frame of its death animation) into the floor decals. */
  stampCorpse(texture: string, frame: string | number, x: number, y: number, ox: number, oy: number, flip: boolean) {
    const rt = this.decalRT;
    if (!rt || !this.stamp || !this.scene.textures.exists(texture)) return;
    const st = this.stamp.setTexture(texture, frame).setOrigin(ox, oy).setScale(1, 1).setFlipX(flip).setFlipY(false).setAlpha(0.92).setTint(0x8a7c7c);
    rt.draw(st, x - this.origin.x, y - this.origin.y);
    st.clearTint();
    // the dead draw flies
    this.ambient?.addFlies(x, y);
  }

  /** focus: screen-space feet positions + depths of heroes; tall walls in front of them fade out. */
  update(time: number, focus: { x: number; y: number; depth: number }[] | null) {
    if (this.animated) for (const t of this.torches) {
      const tt = time * t.rate;
      const f = 1 + (Math.sin(tt / 90 + t.phase) * 0.5 + Math.sin(tt / 37 + t.phase * 2) * 0.35 + (Math.random() - 0.5) * 0.4) * t.flicker;
      t.light.intensity = t.base * f;
      t.light.radius = t.radius * (0.96 + 0.04 * f);
      if (t.core) t.core.intensity = (t.coreBase ?? 0.5) * (0.85 + 0.3 * f);
      if (t.glow) t.glow.setAlpha(0.16 + 0.08 * f);
    }
    if (this.animated) for (const sh of this.shafts) {
      // clouds drifting over the crack: the shaft breathes slowly
      const k = 0.8 + 0.2 * Math.sin(time / 2300 + sh.phase) + 0.08 * Math.sin(time / 610 + sh.phase * 3);
      sh.beam.setAlpha(0.27 * k);
      sh.pool.setAlpha(0.2 * k);
      if (sh.light) sh.light.intensity = sh.base * k;
    }
    if (this.animated) for (const fg of this.fogs) {
      const a = time * fg.rate + fg.phase;
      fg.img.setPosition(Math.round(fg.x + Math.sin(a) * fg.dx), Math.round(fg.y + Math.sin(a * 0.7) * fg.dy));
    }
    if (this.grade) {
      const cam = this.scene.cameras.main;
      if (Math.abs(this.grade.displayWidth - cam.width * 1.3) > 1 || Math.abs(this.grade.displayHeight - cam.height * 1.3) > 1) this.grade.setPosition(cam.width / 2, cam.height / 2).setDisplaySize(cam.width * 1.3, cam.height * 1.3);
    }
    for (let i = this.dyn.length - 1; i >= 0; i--) {
      const d = this.dyn[i];
      const left = d.until - time;
      if (left <= 0) { this.scene.lights.removeLight(d.light); this.dyn.splice(i, 1); continue; }
      d.light.intensity = d.base * (left / d.fade);
    }
    for (const o of this.occluders) {
      let hide = false;
      if (focus) for (const f of focus) {
        if (f.depth >= o.depth) continue;
        if (f.x + 18 > o.x0 && f.x - 18 < o.x1 && f.y > o.y0 && f.y - 52 < o.y1) { hide = true; break; }
      }
      const target = hide ? 0.28 : 1;
      if (Math.abs(o.alpha - target) < 0.01) continue;
      o.alpha += (target - o.alpha) * 0.2;
      for (const obj of o.objs) obj.setAlpha(o.alpha);
    }
    this.ambient?.update(time, focus);
    this.skybox?.update(time);
  }

  litObject<T extends Phaser.GameObjects.GameObject>(o: T): T { return this.lit(o as T & { setPipeline?: (p: string) => unknown }); }

  destroy(full = true) {
    this.ambient?.destroy();
    this.ambient = null;
    this.skybox?.destroy();
    this.skybox = null;
    // the floor's data source points at the normal render texture: detach before either is destroyed
    if (this.floorRT) (this.floorRT.texture as unknown as { dataSource: unknown[] }).dataSource.length = 0;
    for (const o of this.objs) { this.scene.tweens?.killTweensOf(o); o.destroy(); }
    this.objs = [];
    this.normalRT?.destroy(); this.normalRT = null; this.floorRT = null;
    this.stamp?.destroy(); this.stamp = null;
    for (const t of this.torches) { this.scene.lights?.removeLight(t.light); if (t.core) this.scene.lights?.removeLight(t.core); }
    for (const sh of this.shafts) if (sh.light) this.scene.lights?.removeLight(sh.light);
    for (const d of this.dyn) this.scene.lights?.removeLight(d.light);
    this.torches = []; this.dyn = []; this.occluders = []; this.decalRT = null; this.shafts = []; this.fogs = []; this.grade = null;
    if (full) { this.key = null; this.plan = null; }
  }
}
