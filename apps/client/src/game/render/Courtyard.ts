import * as Phaser from 'phaser';
import { courtyardPlan, inPlaza, type CourtyardFeature } from '@cursebound/simulation';
import {
  BANNER_H, BANNER_W, CY, DUMMY_H, DUMMY_W, FOUNTAIN_CX, FOUNTAIN_CY, FOUNTAIN_FRAMES, FOUNTAIN_H, FOUNTAIN_W, GATE_FRAME, HOUSE_H, RACK_H, RACK_W,
  STALL_CX, STALL_CY, STALL_H, STALL_W, STUB_FRAMES, STUB_H, courtyardSheets, houseFrame, paintCourtyardFloor,
} from '../art/courtyardArt';
import { gradeTexture } from '../art/atmosphere';
import { addFramedTexture } from '../art/texutil';
import { gfx } from '../gfx';
import { HH, HW, iso, isoBounds } from './iso';
import { renderTheme, type RenderTheme } from './themes';
import type { MapLike, Occluder } from './DungeonRenderer';

// Training grounds renderer (DungeonRenderer.build hands the 'courtyard' theme here): a sunlit medieval town square.
// The floor is one baked image of concentric cobble rings (art/courtyardArt.ts); the house ring stands as timber-framed
// blocks with hip roofs on the far side (W, N and the diagonals), with gateway arches at the compass points, while the
// near arc (the south-east, between the camera and the square) is cut down to low garden walls so the yard always
// reads; a second rank of roofs behind the houses gives the town depth. The fountain, market stalls, straw dummies,
// weapon racks and banner poles stand where the simulation carved them (courtyardPlan, a pure function of decorSeed).
// Daylight: a bright warm ambient for Light2D, no torches, a gentle grade, chimney smoke and drifting petals.
// Cosmetic density follows the graphics tier (animated decor, particle budget).

export const COURTYARD_THEME: RenderTheme = {
  ...renderTheme('catacombs'),
  ambient: 0xfff8ec, torch: 0xffe6b8, floorTint: 0xffffff, wallTint: 0xffffff, particles: 'dust', particleTint: 0xfff0d0,
  decalTint: 0xffffff, shaftColor: 0xfff2d0, fogColor: 0xe8e0d0, fogAlpha: 0, grade: 0xeadcc4, torchBoost: 1,
};

const WALL_H_BY_LEVEL = [68, 80, 94], ROOF_H_BY_LEVEL = [30, 34, 40];

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface CourtyardBuild {
  objs: Phaser.GameObjects.GameObject[];
  occluders: Occluder[];
  /** px each wall tile (house, garden wall) is drawn tall above its floor diamond (tile index -> px; click picking) */
  wallPx: Map<number, number>;
  decalRT: Phaser.GameObjects.RenderTexture;
  theme: RenderTheme;
  bounds: { x: number; y: number; w: number; h: number };
  origin: { x: number; y: number };
  stats: { sprites: number; ms: number };
  /** undo scene-wide changes (camera background) */
  cleanup: () => void;
}

function ensureTextures(s: Phaser.Scene) {
  for (const sh of courtyardSheets()) addFramedTexture(s, sh.key, sh.w, sh.h, sh.rgba, sh.fw, sh.fh, sh.count);
  if (!s.anims.exists('cy:fountain:flow')) s.anims.create({ key: 'cy:fountain:flow', frames: Array.from({ length: FOUNTAIN_FRAMES }, (_, i) => ({ key: CY.fountain, frame: i })), frameRate: 7, repeat: -1 });
  for (let c = 0; c < 4; c++) {
    const key = `cy:banner:sway:${c}`;
    if (!s.anims.exists(key)) s.anims.create({ key, frames: [0, 1, 2, 1].map((k) => ({ key: CY.banner, frame: c * 3 + k })), frameRate: 4, repeat: -1 });
  }
}

export function buildCourtyard(s: Phaser.Scene, map: MapLike, o: { lighting: boolean; lit: <T extends Phaser.GameObjects.GameObject>(obj: T) => T }): CourtyardBuild {
  const t0 = performance.now();
  ensureTextures(s);
  const knobs = gfx();
  const animated = knobs.animatedDecor;
  const plan = courtyardPlan(map.decorSeed);
  const { cx, cy } = plan;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const occluders: Occluder[] = [];
  const wallPx = new Map<number, number>();
  const b = isoBounds(map.w, map.h);
  const ox = b.minX, oy = b.minY;
  const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= map.w || y >= map.h || map.tiles[y * map.w + x] === 1;
  if (o.lighting) s.lights.setAmbientColor(COURTYARD_THEME.ambient);
  const cam = s.cameras.main;
  cam.setBackgroundColor('#2a2420');

  // ---- the floor: one baked image of the rings (cached per layout seed)
  const floorKey = `${CY.floor}:${map.decorSeed}:${map.w}x${map.h}`;
  if (!s.textures.exists(floorKey)) {
    const buf = paintCourtyardFloor(plan, ox, oy, b.width, b.height, map.decorSeed);
    addFramedTexture(s, floorKey, buf.w, buf.h, buf.toRGBA(), buf.w, buf.h, 1);
  }
  objs.push(o.lit(s.add.image(ox, oy, floorKey, 0).setOrigin(0, 0).setDepth(-100)));
  const decalRT = s.add.renderTexture(ox, oy, b.width, b.height).setOrigin(0, 0).setDepth(-90);
  objs.push(o.lit(decalRT));

  // ---- the house ring
  const arches = new Map<number, CourtyardFeature>();
  for (const f of plan.features) if (f.kind === 'arch') arches.set(f.y * map.w + f.x, f);
  const chimneys: { x: number; y: number }[] = [];
  const lights: Phaser.GameObjects.Light[] = [];
  let sprites = 0;
  const near = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !isWall(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (!isWall(x, y) || inPlaza(x, y)) continue;
    const T = iso.p(x, y);
    const depth = (x + y + 1) * 10;
    const rx = x + 0.5 - cx, ry = y + 0.5 - cy, r = Math.hypot(rx, ry);
    const boundary = near(x, y);
    // between the camera and the square: a low garden wall instead of a house
    const front = !isWall(x - 1, y - 1) || (!isWall(x - 1, y) && !isWall(x, y - 1));
    if (boundary && front) {
      const img = s.add.image(T.x - HW, T.y - (STUB_H - 32), CY.stub, Math.floor(hash(x, y, 3) * STUB_FRAMES)).setOrigin(0, 0).setDepth(depth);
      objs.push(o.lit(img)); sprites++;
      wallPx.set(y * map.w + x, STUB_H - 32);
      continue;
    }
    // far ranks: roofs behind the houses (never on the near arc, where they would cover the square)
    const nearArc = (rx + ry) / (r || 1) > 0.3;
    const rank = boundary ? 0 : r - plan.r;
    if (!boundary && (nearArc || rank > 3.6)) continue;
    // houses come in runs of a few tiles sharing a height and palette; doors, shopfronts and banners vary per tile
    const group = Math.floor(((Math.atan2(ry, rx) + Math.PI) / (Math.PI * 2)) * 34);
    const level = boundary ? Math.floor(hash(group, 1, map.decorSeed) * 3) : 2;
    const palette = Math.floor(hash(group, 2, map.decorSeed) * 4);
    const arch = arches.get(y * map.w + x);
    const frame = arch ? GATE_FRAME + (arch.v % 2) : houseFrame(level, palette, Math.floor(hash(x, y, map.decorSeed + 7) * 3));
    const img = s.add.image(T.x - HW, T.y - (HOUSE_H - 32), CY.house, frame).setOrigin(0, 0).setDepth(depth - (boundary ? 0 : 0.5));
    if (!boundary) img.setTint(0xd8d0c8);   // the rank behind sits a touch further into the haze
    objs.push(o.lit(img)); sprites++;
    // facade and roof above the floor diamond (the frame's top is empty sky)
    wallPx.set(y * map.w + x, (arch ? 100 : WALL_H_BY_LEVEL[level]!) + (arch ? 36 : ROOF_H_BY_LEVEL[level]!) - 16);
    if (boundary && (!isWall(x, y - 1) || !isWall(x - 1, y))) {
      const top = HOUSE_H - 16 - (arch ? 100 : WALL_H_BY_LEVEL[level]!) - (arch ? 36 : ROOF_H_BY_LEVEL[level]!);
      occluders.push({ objs: [img], depth, x0: T.x - HW, x1: T.x + HW, y0: T.y - (HOUSE_H - 32) + top, y1: T.y + HH * 2, alpha: 1 });
    }
    // chimneys (frames whose spec has one: every third index) smoke a little
    if (!arch && frame % 3 === 0 && chimneys.length < 8 && hash(x, y, 11) < 0.5) {
      chimneys.push({ x: T.x - HW + 45, y: T.y - (HOUSE_H - 32) + HOUSE_H - 16 - WALL_H_BY_LEVEL[level]! - ROOF_H_BY_LEVEL[level]! + 2 });
    }
  }

  // ---- the pieces standing in the square
  for (const f of plan.features) {
    if (f.kind === 'arch') continue;
    const wx = f.x + f.w / 2, wy = f.y + f.h / 2;
    const p = iso.p(wx, wy);
    const depth = (wx + wy) * 10 + 1;
    let spr: Phaser.GameObjects.Sprite;
    if (f.kind === 'fountain') {
      const fp = iso.p(cx, cy);
      spr = s.add.sprite(fp.x, fp.y, CY.fountain, 0).setOrigin(FOUNTAIN_CX / FOUNTAIN_W, FOUNTAIN_CY / FOUNTAIN_H).setDepth((cx + cy) * 10 + 1);
      if (animated) spr.play('cy:fountain:flow');
      occluders.push({ objs: [spr], depth: (cx + cy) * 10 + 1, x0: fp.x - 100, x1: fp.x + 100, y0: fp.y - FOUNTAIN_CY, y1: fp.y + 40, alpha: 1 });
      // a cool glint of light off the water
      if (o.lighting) lights.push(s.lights.addLight(fp.x, fp.y - 30, 200, 0xbfe6ff, 0.35));
    } else if (f.kind === 'stall') {
      spr = s.add.sprite(p.x, p.y, CY.stall, (f.w === 2 ? 0 : 4) + (f.v % 4)).setOrigin(STALL_CX / STALL_W, STALL_CY / STALL_H).setDepth(depth);
      occluders.push({ objs: [spr], depth, x0: p.x - STALL_CX, x1: p.x + STALL_CX, y0: p.y - STALL_CY, y1: p.y + 20, alpha: 1 });
    } else if (f.kind === 'dummy') {
      spr = s.add.sprite(p.x, p.y + 4, CY.dummy, f.v % 2).setOrigin(0.5, (DUMMY_H - 4) / DUMMY_H).setDepth(depth);
      if (hash(f.x, f.y, 1) < 0.5) spr.setFlipX(true);
    } else if (f.kind === 'rack') {
      spr = s.add.sprite(p.x, p.y + 4, CY.rack, f.v % 2).setOrigin(0.5, (RACK_H - 4) / RACK_H).setDepth(depth);
      if (Math.cos(f.ang) > 0) spr.setFlipX(true);
    } else {
      spr = s.add.sprite(p.x, p.y + 6, CY.banner, (f.v % 4) * 3).setOrigin(0.5, (BANNER_H - 4) / BANNER_H).setDepth(depth);
      if (animated) spr.play({ key: `cy:banner:sway:${f.v % 4}`, startFrame: f.v % 3 });
      occluders.push({ objs: [spr], depth, x0: p.x - BANNER_W / 2, x1: p.x + BANNER_W / 2, y0: p.y - BANNER_H, y1: p.y + 8, alpha: 1 });
    }
    void DUMMY_W; void RACK_W;
    objs.push(o.lit(spr)); sprites++;
  }

  // ---- daylight life: chimney smoke and petals drifting across the square
  const budget = knobs.particles;
  if (animated && budget > 0) {
    for (const c of chimneys) {
      const em = s.add.particles(c.x + 3, c.y, CY.smoke, {
        speedX: { min: 3, max: 9 }, speedY: { min: -16, max: -9 }, lifespan: 3400, frequency: 520 / budget, alpha: { start: 0.42, end: 0 }, scale: { start: 0.5, end: 1.6 },
      }).setDepth(4700);
      objs.push(em);
    }
    const center = iso.p(cx, cy);
    const em = s.add.particles(0, 0, CY.petal, {
      x: { min: center.x - 600, max: center.x + 600 }, y: { min: center.y - 420, max: center.y + 120 }, speedX: { min: 6, max: 18 }, speedY: { min: 8, max: 18 },
      lifespan: 7000, frequency: 260 / budget, alpha: { start: 0.9, end: 0 }, rotate: { min: 0, max: 360 }, scale: { min: 0.8, max: 1.3 },
    }).setDepth(4800);
    objs.push(em);
  }

  // ---- a soft warm grade (no dungeon gloom)
  const gt = gradeTexture(COURTYARD_THEME.grade);
  if (!s.textures.exists(gt.key)) addFramedTexture(s, gt.key, gt.width, gt.height, gt.rgba, gt.width, gt.height, 1, true);
  const grade = s.add.image(cam.width / 2, cam.height / 2, gt.key).setScrollFactor(0).setDepth(4400).setBlendMode(Phaser.BlendModes.MULTIPLY)
    .setDisplaySize(cam.width * 1.3, cam.height * 1.3).setAlpha(0.45);
  objs.push(grade);

  return {
    objs, occluders, wallPx, decalRT, theme: COURTYARD_THEME,
    bounds: { x: b.minX - HW * 2, y: b.minY - HOUSE_H - HH * 2, w: b.width + HW * 4, h: b.height + HOUSE_H + HH * 4 },
    origin: { x: ox, y: oy },
    stats: { sprites, ms: performance.now() - t0 },
    cleanup: () => { cam.setBackgroundColor('#050303'); for (const l of lights) s.lights?.removeLight(l); },
  };
}
