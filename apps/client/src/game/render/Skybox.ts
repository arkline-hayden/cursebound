import type * as Phaser from 'phaser';
import { SKY_KEYS, moonBackdrop, moonStar, skyBackdrop, skyCloud, skyIslet, skyUnderside } from '../art/skyArt';
import type { PixelBuffer } from '../art/draw/pixel';
import { addFramedTexture } from '../art/texutil';
import type { DressingPlan } from './dressing';
import { iso, isoBounds } from './iso';

// What lies beyond the floor's edge on the open-air themes (client-only, cosmetic). The sky island floats in open
// air: a screen-fixed sky with the sun, clouds drifting by below and around the shard on a slower parallax plane,
// the shard's own underside hanging from its brink and a few islets bobbing nearby. The dead moon hangs its black
// starfield with the Earth behind the floor, a handful of stars twinkling. Unlit (Light2D never darkens the sky).
// Density follows gfx().decorDensity; with animated decor off nothing drifts, bobs or twinkles.

/** Behind everything the world draws (the floor render texture sits at -100, chasm cliffs at -101). */
const BACKDROP_DEPTH = -2000;
const CLOUD_DEPTH = -1500;
const ISLET_DEPTH = -1400;
/** Just under the brink's cliff faces (VOID_DEPTH - 0.5 in DungeonRenderer). */
const UNDERSIDE_DEPTH = -101.5;

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function upload(scene: Phaser.Scene, key: string, frames: PixelBuffer[]): void {
  if (scene.textures.exists(key) || !frames.length) return;
  const fw = frames[0]!.w, fh = frames[0]!.h;
  const rgba = new Uint8ClampedArray(fw * frames.length * fh * 4);
  frames.forEach((f, i) => {
    const src = f.toRGBA();
    for (let y = 0; y < fh; y++) rgba.set(src.subarray(y * fw * 4, (y + 1) * fw * 4), (y * fw * frames.length + i * fw) * 4);
  });
  addFramedTexture(scene, key, fw * frames.length, fh, rgba, fw, fh, frames.length);
}

export class Skybox {
  private objs: Phaser.GameObjects.Image[] = [];
  private backdrop: Phaser.GameObjects.Image | null = null;
  private drift: { img: Phaser.GameObjects.Image; x: number; y: number; vx: number; x0: number; x1: number }[] = [];
  private bobs: { img: Phaser.GameObjects.Image; y: number; amp: number; phase: number; rate: number }[] = [];
  private twinkles: { img: Phaser.GameObjects.Image; phase: number; rate: number }[] = [];
  private last = -1;

  constructor(private scene: Phaser.Scene, kind: 'sky' | 'stars', plan: DressingPlan, mapW: number, mapH: number, private opts: { animated: boolean; density: number; seed: number }) {
    const cam = scene.cameras.main;
    if (kind === 'sky') {
      upload(scene, SKY_KEYS.sky, [skyBackdrop()]);
      upload(scene, SKY_KEYS.cloud, [0, 1, 2, 3].map(skyCloud));
      upload(scene, SKY_KEYS.underside, [0, 1, 2, 3].map(skyUnderside));
      upload(scene, SKY_KEYS.islet, [0, 1, 2].map(skyIslet));
    } else {
      upload(scene, SKY_KEYS.moon, [moonBackdrop()]);
      upload(scene, SKY_KEYS.star, [moonStar()]);
    }
    // the backdrop: screen-fixed, centred and oversized so camera zooms never uncover an edge
    this.backdrop = scene.add.image(cam.width / 2, cam.height / 2, kind === 'sky' ? SKY_KEYS.sky : SKY_KEYS.moon).setScrollFactor(0).setDepth(BACKDROP_DEPTH);
    this.fit();
    this.objs.push(this.backdrop);
    const b = isoBounds(mapW, mapH);
    const seed = opts.seed;
    const density = Math.max(0, opts.density);
    if (kind === 'stars') {
      // a few bright stars twinkle (screen-fixed like the starfield)
      const n = Math.round(8 * Math.min(1.5, density));
      for (let i = 0; i < n; i++) {
        const img = scene.add.image(hash(i, 1, seed) * cam.width, hash(i, 2, seed) * cam.height * 0.75, SKY_KEYS.star).setScrollFactor(0).setDepth(BACKDROP_DEPTH + 1).setTint(i % 3 ? 0xd8e4ff : 0xffffff);
        this.objs.push(img);
        this.twinkles.push({ img, phase: hash(i, 3, seed) * 6.28, rate: 0.0012 + hash(i, 4, seed) * 0.002 });
      }
      return;
    }
    // clouds on a slower parallax plane below and around the shard: they read as far beneath it
    const sf = 0.72;
    const nClouds = Math.round(12 * Math.min(1.5, density));
    const x0 = b.minX - 260, x1 = b.maxX + 260;
    for (let i = 0; i < nClouds; i++) {
      const wx = x0 + hash(i, 5, seed) * (x1 - x0), wy = b.minY - 80 + hash(i, 6, seed) * (b.height + 320);
      // place so the cloud sits at its intended world point when the camera centres there (parallax plane)
      const px = sf * wx + (1 - sf) * cam.width / 2, py = sf * wy + (1 - sf) * cam.height / 2;
      const s = 1 + hash(i, 7, seed) * 1.2;
      const img = scene.add.image(px, py, SKY_KEYS.cloud, i % 4).setScrollFactor(sf).setDepth(CLOUD_DEPTH + i * 0.01).setScale(s).setAlpha(0.75 + hash(i, 8, seed) * 0.25).setFlipX(hash(i, 9, seed) < 0.5);
      this.objs.push(img);
      this.drift.push({ img, x: px, y: py, vx: 3 + hash(i, 10, seed) * 6, x0: sf * x0 + (1 - sf) * cam.width / 2, x1: sf * x1 + (1 - sf) * cam.width / 2 });
    }
    // the shard's underside hanging from its brink (not under bridges: a deck has no rock beneath it)
    let k = 0;
    for (const c of plan.voidCliffs) {
      if (c.bridge) continue;
      k++;
      const r = hash(c.x, c.y, seed + 11);
      if (r > 0.55) continue;
      const T = iso.p(c.x + 0.5, c.y + 0.5);
      const ox = c.L && !c.R ? -12 : c.R && !c.L ? 12 : 0;
      const img = scene.add.image(Math.round(T.x + ox), Math.round(T.y + 42 + r * 10), SKY_KEYS.underside, k % 4).setOrigin(0.5, 0).setDepth(UNDERSIDE_DEPTH - r * 0.1).setFlipX(r < 0.27);
      if (r < 0.18) img.setScale(1.5, 1.7).setY(img.y + 18).setTint(0xb8d0ec);
      this.objs.push(img);
    }
    // islets adrift near the edges, bobbing on the updraughts
    const nIslets = Math.round(5 * Math.min(1.5, density));
    for (let i = 0; i < nIslets; i++) {
      const side = i % 4;
      const wx = side === 0 ? b.minX - 60 - hash(i, 12, seed) * 120 : side === 1 ? b.maxX + 60 + hash(i, 12, seed) * 120 : b.minX + hash(i, 12, seed) * b.width;
      const wy = side < 2 ? b.minY + hash(i, 13, seed) * b.height : side === 2 ? b.minY - 40 - hash(i, 13, seed) * 60 : b.maxY + 60 + hash(i, 13, seed) * 80;
      const img = scene.add.image(wx, wy, SKY_KEYS.islet, i % 3).setDepth(ISLET_DEPTH + i * 0.01).setScale(1 + hash(i, 14, seed) * 0.8);
      this.objs.push(img);
      this.bobs.push({ img, y: wy, amp: 3 + hash(i, 15, seed) * 4, phase: hash(i, 16, seed) * 6.28, rate: 0.0006 + hash(i, 17, seed) * 0.0006 });
    }
  }

  private fit(): void {
    const cam = this.scene.cameras.main;
    this.backdrop?.setPosition(cam.width / 2, cam.height / 2).setDisplaySize(cam.width * 1.5, cam.height * 1.5);
  }

  update(time: number): void {
    const dt = this.last < 0 ? 16 : Math.min(50, time - this.last);
    this.last = time;
    const cam = this.scene.cameras.main;
    if (this.backdrop && Math.abs(this.backdrop.displayWidth - cam.width * 1.5) > 1) this.fit();
    if (!this.opts.animated) return;
    for (const d of this.drift) {
      d.x += (d.vx * dt) / 1000;
      if (d.x > d.x1) d.x = d.x0;
      d.img.setX(Math.round(d.x));
    }
    for (const bb of this.bobs) bb.img.setY(Math.round(bb.y + Math.sin(time * bb.rate + bb.phase) * bb.amp));
    for (const t of this.twinkles) t.img.setAlpha(0.35 + 0.65 * Math.max(0, Math.sin(time * t.rate + t.phase)));
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.drift = [];
    this.bobs = [];
    this.twinkles = [];
    this.backdrop = null;
  }
}
