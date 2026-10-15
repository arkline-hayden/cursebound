import * as Phaser from 'phaser';
import type { DungeonRenderer } from './DungeonRenderer';
import { FONT_NUM, FONT_WORLD, WORLD_TEXT_PX } from '@/ui/fonts';
import { fxCount } from '../gfx';

// Combat feel layer — purely cosmetic (never changes authoritative results; dropping any of it drops no damage).
// Hit-stop, budgeted shake, time dilation, recoil, particles, persistent gore decals, weapon arcs, shockwaves,
// afterimages and pixel numbers (crits pop bigger). Reduced motion / effects / flashes settings and the graphics
// tier's particle budget are respected here, so callers can fire freely. Damage numbers, weapon arcs and shockwave
// rings ignore the tier: they carry hit and area information.

export const GORE: Record<string, { color: number; decal: 'blood' | 'ichor' | 'slime'; shards: number }> = {
  pursuer: { color: 0x8a1c1c, decal: 'blood', shards: 0xb8b0a0 },
  skirmisher: { color: 0x5a1440, decal: 'blood', shards: 0x3a2a3a },
  artillery: { color: 0x7ab83a, decal: 'slime', shards: 0x5a7a2a },
  guardian: { color: 0xd8cfb4, decal: 'ichor', shards: 0xe8e0c8 },
  hexer: { color: 0x9a1a2a, decal: 'blood', shards: 0x6a3a9a },
  broodcaller: { color: 0xd8c040, decal: 'ichor', shards: 0xc87a8a },
  mite: { color: 0x9a3a2a, decal: 'blood', shards: 0x8a6a5a },
  prismstag: { color: 0x8fd8ff, decal: 'ichor', shards: 0xe8e8f0 },
  bellroot: { color: 0xf0a030, decal: 'ichor', shards: 0xa07040 },
  player: { color: 0xa01a1a, decal: 'blood', shards: 0xa01a1a },
};

export type NumberStyle = 'sm' | 'md' | 'lg' | 'crit' | 'heal';

/**
 * Themed particle bits (art/fxJuice.ts textures, tinted per call). Each kind has its own motion: feathers and leaves
 * flutter down, gears and thorns fly and fall, runes, crosses, skulls, bubbles and motes rise and fade, ice and stars
 * scatter, zaps flicker. Emitters are created on first use.
 */
export type BitKind = 'feather' | 'leaf' | 'gear' | 'rune' | 'ice' | 'star' | 'cross' | 'thorn' | 'skull' | 'zap' | 'bubble' | 'mote';

/** Optional aim for a bit burst: screen-space angle and spread in degrees, speed multiplier. */
export interface BitDir { angle?: number; spread?: number; speed?: number }

type EmitterCfg = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;
const velRot = { onEmit: () => 0, onUpdate: (p: Phaser.GameObjects.Particles.Particle) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)) + 90 };
const BIT_CFG: Record<BitKind, { key: string; depth: number; cfg: EmitterCfg }> = {
  feather: { key: 'pfx:feather', depth: 4596, cfg: { frame: [0, 1], lifespan: { min: 600, max: 1100 }, speed: { min: 40, max: 130 }, gravityY: 70, rotate: { min: -40, max: 40 }, alpha: { start: 1, end: 0.2 } } },
  leaf: { key: 'pfx:leaf', depth: 4596, cfg: { frame: [0, 1], lifespan: { min: 650, max: 1200 }, speed: { min: 30, max: 120 }, gravityY: 80, rotate: { start: 0, end: 360 }, alpha: { start: 1, end: 0.3 } } },
  gear: { key: 'pfx:gear', depth: 4596, cfg: { frame: [0, 1, 2], lifespan: { min: 450, max: 850 }, speed: { min: 90, max: 230 }, gravityY: 520, rotate: { start: 0, end: 720 } } },
  rune: { key: 'pfx:rune', depth: 4606, cfg: { frame: [0, 1, 2, 3], lifespan: { min: 500, max: 900 }, speed: { min: 10, max: 55 }, gravityY: -55, alpha: { start: 1, end: 0 }, blendMode: 'ADD' } },
  ice: { key: 'pfx:ice', depth: 4597, cfg: { frame: [0, 1, 2], lifespan: { min: 380, max: 720 }, speed: { min: 100, max: 270 }, gravityY: 400, rotate: { start: 0, end: 360 } } },
  star: { key: 'pfx:star', depth: 4608, cfg: { frame: [0, 1], lifespan: { min: 220, max: 520 }, speed: { min: 20, max: 150 }, scale: { start: 1.2, end: 0 }, blendMode: 'ADD' } },
  cross: { key: 'pfx:cross', depth: 4606, cfg: { lifespan: { min: 500, max: 950 }, speed: { min: 10, max: 55 }, gravityY: -65, alpha: { start: 1, end: 0 }, blendMode: 'ADD' } },
  thorn: { key: 'pfx:thorn', depth: 4596, cfg: { lifespan: { min: 320, max: 620 }, speed: { min: 120, max: 270 }, gravityY: 320, rotate: velRot } },
  skull: { key: 'pfx:skull', depth: 4604, cfg: { lifespan: { min: 600, max: 1000 }, speed: { min: 10, max: 45 }, gravityY: -50, alpha: { start: 1, end: 0 } } },
  zap: { key: 'pfx:zap', depth: 4609, cfg: { frame: [0, 1], lifespan: { min: 80, max: 190 }, speed: { min: 30, max: 130 }, scale: { start: 1.2, end: 0.6 }, blendMode: 'ADD' } },
  bubble: { key: 'pfx:bubble', depth: 4598, cfg: { lifespan: { min: 500, max: 950 }, speed: { min: 10, max: 45 }, gravityY: -55, scale: { start: 0.6, end: 1.3 }, alpha: { start: 0.95, end: 0 } } },
  mote: { key: 'pfx:spark', depth: 4607, cfg: { lifespan: { min: 600, max: 1200 }, speed: { min: 8, max: 45 }, gravityY: -32, scale: { start: 1, end: 0 }, blendMode: 'ADD' } },
};

/** Pooled cosmetic images alive at once before decorative extras (starbursts, orbs, beams, glyphs) are skipped. */
const MAX_LIVE = 240;
const MAX_LIVE_LOW = 110;

/** Shake budget: total recent shake "energy" above which further shakes are damped, so chains never nauseate. */
const SHAKE_CAP = 0.03;
const SHAKE_BUDGET = 0.05;
const SHAKE_DRAIN_PER_SEC = 0.06;

/** Camera shake is off for everyone; flip only for local experiments. */
const SHAKE_DISABLED = true;

export class Juice {
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private drops!: Phaser.GameObjects.Particles.ParticleEmitter;
  private shards!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private embers!: Phaser.GameObjects.Particles.ParticleEmitter;
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private bitEm = new Map<BitKind, { e: Phaser.GameObjects.Particles.ParticleEmitter; aimed: boolean; speed: unknown }>();
  /** pooled one-shot images per texture key (rings, flashes, slashes, glyphs, afterimages), recycled on fade-out */
  private pool = new Map<string, Phaser.GameObjects.Image[]>();
  private live = 0;
  private popRect?: Phaser.GameObjects.Rectangle;
  private popTween?: Phaser.Tweens.Tween;
  private texts: Phaser.GameObjects.Text[] = [];
  private textPool: Phaser.GameObjects.Text[] = [];
  private shakeEnergy = 0;
  private shakeAt = 0;
  private shakeLevel = 0;
  private shakeEnd = 0;
  private dilation = 1;
  private dilateUntil = 0;
  private dilateFrom = 1;
  private dilateMs = 0;
  freezeUntil = 0;
  /** Presentation clock (ms): stops during hit-stop and runs slower during time dilation. Use for cosmetic motion. */
  clock = 0;
  low = false;
  reduced = false;
  shakeOn = true;
  flashOn = true;
  motionOn = true;
  numbersOn = true;

  constructor(private scene: Phaser.Scene, private dungeon: DungeonRenderer) {
    const add = (key: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const tex = scene.textures.exists(key) ? key : '__WHITE';
      const e = scene.add.particles(0, 0, tex, { emitting: false, ...cfg });
      this.emitters.push(e);
      return e;
    };
    this.sparks = add('pfx:streak', { lifespan: { min: 120, max: 260 }, speed: { min: 140, max: 320 }, angle: { min: 0, max: 360 }, scale: { start: 1, end: 0 }, blendMode: 'ADD', rotate: { onEmit: () => 0, onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)) + 90 } }).setDepth(4600);
    this.drops = add('pfx:drop', { lifespan: { min: 260, max: 520 }, speed: { min: 60, max: 220 }, angle: { min: 0, max: 360 }, gravityY: 520, scale: { min: 0.8, max: 1.6 } }).setDepth(4590);
    this.shards = add('pfx:shard', { frame: [0, 1, 2], lifespan: { min: 380, max: 720 }, speed: { min: 80, max: 240 }, angle: { min: 0, max: 360 }, gravityY: 420, rotate: { start: 0, end: 540 } }).setDepth(4595);
    this.smoke = add('pfx:smoke', { lifespan: { min: 380, max: 800 }, speed: { min: 10, max: 50 }, angle: { min: 0, max: 360 }, scale: { start: 0.6, end: 1.4 }, alpha: { start: 0.5, end: 0 } }).setDepth(4580);
    this.embers = add('pfx:ember', { lifespan: { min: 300, max: 800 }, speed: { min: 20, max: 90 }, angle: { min: 230, max: 310 }, gravityY: -40, scale: { start: 1.2, end: 0 }, blendMode: 'ADD' }).setDepth(4605);
  }

  /**
   * Cosmetic particle count for this frame: scaled by the graphics tier (gfx().particles, stochastic rounding so a
   * stream of single embers thins evenly) and halved again while frames run slow. Every burst routes through here,
   * so class kits, elites, loot and afflictions all follow the tier without their own checks.
   */
  private count(n: number): number {
    const k = fxCount(n);
    return this.low ? Math.ceil(k / 2) : k;
  }

  get frozen() { return this.scene.time.now < this.freezeUntil; }
  /** Current cosmetic time scale (1 normal, < 1 during a dilation flourish). */
  get timeScale() { return this.dilation; }

  hitStop(ms: number) {
    if (this.reduced || !this.motionOn) return;
    this.freezeUntil = Math.max(this.freezeUntil, this.scene.time.now + ms);
    this.scene.anims.globalTimeScale = 0;
    this.scene.time.delayedCall(ms, () => { if (!this.frozen) this.scene.anims.globalTimeScale = this.dilation; });
  }

  /** Brief slow motion for animations, tweens and particles, easing back to normal over `ms`. Never touches the authority. */
  dilate(scale: number, ms: number) {
    if (this.reduced || !this.motionOn) return;
    this.dilateFrom = Math.max(0.1, Math.min(1, scale));
    this.dilateMs = ms;
    this.dilateUntil = this.scene.time.now + ms;
    this.applyDilation(this.dilateFrom);
  }

  private applyDilation(v: number) {
    this.dilation = v;
    if (!this.frozen) this.scene.anims.globalTimeScale = v;
    this.scene.tweens.timeScale = v;
    for (const e of this.emitters) e.timeScale = v;
  }

  /**
   * Camera shake is disabled by design (player feedback: it hurt readability). Callers keep calling this so
   * impact timing stays documented in the fx code; impacts read through hit-stop, flashes and particles instead.
   */
  shake(intensity: number, ms = 120) {
    if (SHAKE_DISABLED || !this.shakeOn || !this.motionOn || intensity <= 0) return;
    const now = this.scene.time.now;
    this.shakeEnergy = Math.max(0, this.shakeEnergy - ((now - this.shakeAt) / 1000) * SHAKE_DRAIN_PER_SEC);
    this.shakeAt = now;
    const damp = Math.max(0.2, 1 - this.shakeEnergy / SHAKE_BUDGET);
    const k = Math.min(SHAKE_CAP, intensity * damp);
    this.shakeEnergy += k * Math.min(2, ms / 120);
    if (now < this.shakeEnd && k <= this.shakeLevel) return;
    this.shakeLevel = k;
    this.shakeEnd = now + ms;
    this.scene.cameras.main.shake(ms, k, true);
  }

  flash(color: number, ms = 60) {
    if (!this.flashOn || this.reduced) return;
    const c = Phaser.Display.Color.IntegerToRGB(color);
    this.scene.cameras.main.flash(ms, c.r, c.g, c.b, true);
  }

  sparksAt(x: number, y: number, n: number, tint = 0xffd890) {
    if (this.reduced) return;
    this.sparks.setParticleTint(tint);
    this.sparks.explode(this.count(n), x, y);
  }

  bleed(kind: string, x: number, y: number, n: number, dirX = 0, dirY = 0) {
    const g = GORE[kind] ?? GORE.pursuer;
    if (!this.reduced) {
      this.drops.setParticleTint(g.color);
      // spray biased away from the hit: spawn slightly past the target along the hit direction
      const l = Math.hypot(dirX, dirY) || 1;
      this.drops.explode(this.count(n), x + (dirX / l) * 6, y + (dirY / l) * 6);
    }
  }

  gib(kind: string, x: number, y: number, big = false) {
    const g = GORE[kind] ?? GORE.pursuer;
    if (!this.reduced) {
      this.drops.setParticleTint(g.color);
      this.drops.explode(this.count(big ? 40 : 18), x, y);
      this.shards.setParticleTint(g.shards);
      this.shards.explode(this.count(big ? 24 : 8), x, y);
      this.smoke.setParticleTint(0x2a2220);
      this.smoke.explode(this.count(big ? 10 : 4), x, y + 4);
    }
    this.dungeon.addDecal(g.decal, x, y + 6, g.color, big ? 2.2 : 1 + Math.random() * 0.5);
  }

  dust(x: number, y: number, n = 3, tint = 0x5a4a40) {
    if (this.reduced) return;
    this.smoke.setParticleTint(tint);
    this.smoke.explode(this.low ? Math.min(1, this.count(n)) : this.count(n), x, y);
  }

  embersAt(x: number, y: number, n: number, tint = 0xff9a3a) {
    if (this.reduced) return;
    this.embers.setParticleTint(tint);
    this.embers.explode(this.count(n), x, y);
  }

  /**
   * Burst of themed bits (feathers, leaves, gears, runes, ice, stars, crosses, thorns, skulls, zaps, bubbles, motes).
   * Count follows the graphics tier like every other burst; `dir` aims the spray (screen degrees) for cones and trails.
   */
  bits(kind: BitKind, x: number, y: number, n: number, tint: number, dir?: BitDir) {
    if (this.reduced) return;
    this.emitBits(kind, x, y, this.count(n), tint, dir);
  }

  /** A trail of bits strewn along a screen-space segment (travel paths of dashes, chains, thrown things). */
  bitsAlong(kind: BitKind, x0: number, y0: number, x1: number, y1: number, n: number, tint: number, dir?: BitDir) {
    if (this.reduced) return;
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const t = (i + Math.random()) / k;
      this.emitBits(kind, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1, tint, dir);
    }
  }

  private emitBits(kind: BitKind, x: number, y: number, k: number, tint: number, dir?: BitDir) {
    if (k <= 0) return;
    const b = this.bitEmitter(kind);
    if (!b) return;
    const e = b.e;
    if (dir?.angle !== undefined) {
      const sp = dir.spread ?? 40;
      e.ops.angle.loadConfig({ angle: { min: dir.angle - sp / 2, max: dir.angle + sp / 2 } });
      b.aimed = true;
    } else if (b.aimed) { e.ops.angle.loadConfig({ angle: { min: 0, max: 360 } }); b.aimed = false; }
    const sk = e.ops.speedX.propertyKey;
    if (dir?.speed !== undefined && dir.speed !== 1) {
      const base = b.speed as { min: number; max: number };
      e.ops.speedX.loadConfig({ [sk]: { min: base.min * dir.speed, max: base.max * dir.speed } });
    } else if (e.ops.speedX.propertyValue !== b.speed) e.ops.speedX.loadConfig({ [sk]: b.speed });
    e.setParticleTint(tint);
    e.explode(k, x, y);
  }

  private bitEmitter(kind: BitKind) {
    let b = this.bitEm.get(kind);
    if (b) return b;
    const spec = BIT_CFG[kind];
    if (!this.scene.textures.exists(spec.key)) return undefined;
    const e = this.scene.add.particles(0, 0, spec.key, { emitting: false, angle: { min: 0, max: 360 }, ...spec.cfg }).setDepth(spec.depth);
    e.timeScale = this.dilation;
    this.emitters.push(e);
    b = { e, aimed: false, speed: e.ops.speedX.propertyValue };
    this.bitEm.set(kind, b);
    return b;
  }

  /** Cosmetic image budget: false when the pool is saturated (or effects are reduced), so decorative extras skip. */
  private room(): boolean {
    return !this.reduced && this.live < (this.low ? MAX_LIVE_LOW : MAX_LIVE);
  }

  /** A pooled one-shot image, reset to defaults (additive, centred, untinted); hand it to `fade` to recycle. */
  private grab(key: string): Phaser.GameObjects.Image | null {
    const s = this.scene;
    if (!s.textures.exists(key)) return null;
    const img = this.pool.get(key)?.pop() ?? s.add.image(0, 0, key);
    this.live++;
    return img.setVisible(true).setActive(true).setAlpha(1).setAngle(0).setScale(1).setOrigin(0.5, 0.5).setFlip(false, false).clearTint()
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  private release(img: Phaser.GameObjects.Image, poolKey: string) {
    this.live--;
    img.setVisible(false).setActive(false);
    let list = this.pool.get(poolKey);
    if (!list) { list = []; this.pool.set(poolKey, list); }
    if (list.length < 48) list.push(img); else img.destroy();
  }

  /** Tween a pooled image and recycle it when the tween ends. */
  private fade(img: Phaser.GameObjects.Image, props: Record<string, number>, ms: number, ease = 'Quad.easeOut', delay = 0, poolKey = img.texture.key) {
    this.scene.tweens.add({ targets: img, ...props, duration: ms, delay, ease, onComplete: () => this.release(img, poolKey) });
  }

  arc(x: number, y: number, angle: number, tint: number, scale = 1) {
    const img = this.grab('pfx:slashArc');
    if (!img) return;
    img.setPosition(x, y).setRotation(angle).setTint(tint).setDepth(4650).setScale(0.6 * scale);
    this.fade(img, { scale: 1.15 * scale, alpha: 0 }, 170);
  }

  /** Shockwave lying flat on the iso ground plane; radiusPx is the horizontal (screen) radius. */
  ring(x: number, y: number, radiusPx: number, tint: number, ms = 300) {
    const img = this.grab('pfx:ring');
    if (!img) return;
    img.setPosition(x, y).setTint(tint).setDepth(4640).setScale(0.2, 0.1);
    const k = (radiusPx * 2) / 64;
    this.fade(img, { scaleX: k, scaleY: k * 0.5, alpha: 0 }, ms, 'Cubic.easeOut');
  }

  /**
   * Thick wave-front shockwave on the ground plane (hard outer edge, dimmer trailing bands). Carries area information,
   * so it ignores the tier; reduced effects fall back to the thin ring. `delay` staggers multi-wave slams.
   */
  shockwave(x: number, y: number, radiusPx: number, tint: number, ms = 360, delay = 0) {
    if (this.reduced) { this.ring(x, y, radiusPx, tint, ms); return; }
    const img = this.grab('pfx:ringThick');
    if (!img) return;
    img.setPosition(x, y).setTint(tint).setDepth(4639).setScale(0.15, 0.075).setAlpha(delay ? 0 : 1);
    const k = (radiusPx * 2) / 64;
    if (delay) this.scene.tweens.add({ targets: img, alpha: 1, duration: 1, delay });
    this.fade(img, { scaleX: k, scaleY: k * 0.5, alpha: 0 }, ms, 'Cubic.easeOut', delay);
  }

  impact(x: number, y: number, tint: number, scale = 1) {
    if (this.reduced) return;
    const img = this.grab('pfx:flash');
    if (!img) return;
    img.setPosition(x, y).setTint(tint).setDepth(4655).setScale(0.35 * scale).setRotation(Math.random() * Math.PI);
    this.fade(img, { scale: 0.7 * scale, alpha: 0 }, 110, 'Linear');
  }

  /** Eight-point star flash that snaps open and fades (crits, hard impacts, holy smites, glints). Cosmetic. */
  starburst(x: number, y: number, tint: number, scale = 1, ms = 170) {
    if (!this.room()) return;
    const img = this.grab('pfx:starburst');
    if (!img) return;
    img.setPosition(x, y).setTint(tint).setDepth(4656).setScale(0.25 * scale).setRotation(Math.random() < 0.5 ? 0 : Math.PI / 4);
    this.fade(img, { scale: 0.9 * scale, alpha: 0, angle: img.angle + 20 }, ms, 'Cubic.easeOut');
  }

  /** Banded glow bloom (cast flashes, orb pops, charge-ups). `grow` > 1 swells it while it fades. Cosmetic. */
  orb(x: number, y: number, tint: number, scale = 1, ms = 220, grow = 1.6) {
    if (!this.room()) return;
    const img = this.grab('pfx:orb');
    if (!img) return;
    img.setPosition(x, y).setTint(tint).setDepth(4652).setScale(scale);
    this.fade(img, { scale: scale * grow, alpha: 0 }, ms);
  }

  /** Rune circle flat on the ground under a cast: fades in, swells slightly, fades out. Cosmetic. */
  glyph(x: number, y: number, radiusPx: number, tint: number, ms = 600) {
    if (!this.room()) return;
    const img = this.grab('pfx:glyph');
    if (!img) return;
    const k = (radiusPx * 2) / 64;
    img.setPosition(x, y).setTint(tint).setDepth(-68).setScale(k * 0.8, k * 0.4).setAlpha(0);
    this.scene.tweens.add({ targets: img, alpha: 0.95, duration: Math.min(120, ms * 0.25), ease: 'Quad.easeOut' });
    this.fade(img, { scaleX: k * 1.05, scaleY: k * 0.525, alpha: 0 }, ms, 'Quad.easeIn', Math.min(120, ms * 0.25));
  }

  /** Vertical light column standing on a screen point (smites, summons, sky strikes): narrows as it fades. Cosmetic. */
  beam(x: number, y: number, heightPx: number, widthPx: number, tint: number, ms = 320) {
    if (!this.room()) return;
    const img = this.grab('pfx:beam');
    if (!img) return;
    img.setPosition(x, y).setOrigin(0.5, 1).setTint(tint).setDepth(4661).setScale(widthPx / 16, heightPx / 64);
    this.fade(img, { scaleX: 0, alpha: 0 }, ms, 'Cubic.easeIn');
  }

  /**
   * Crisp crescent slash (pfx:slashThin) or the heavy arc (pfx:slashArc). `flip` mirrors it for backhands. Carries the
   * swing's area, so like `arc` it ignores the tier.
   */
  slash(x: number, y: number, angle: number, tint: number, scale = 1, opts: { thin?: boolean; flip?: boolean; ms?: number } = {}) {
    const img = this.grab(opts.thin ? 'pfx:slashThin' : 'pfx:slashArc');
    if (!img) return;
    img.setPosition(x, y).setRotation(angle).setTint(tint).setDepth(4651).setScale(0.7 * scale).setFlipY(!!opts.flip);
    this.fade(img, { scale: 1.12 * scale, alpha: 0 }, opts.ms ?? 190);
  }

  /** Three raking claw marks along `angle` (talons, maws, fangs). */
  claw(x: number, y: number, angle: number, tint: number, scale = 1, ms = 220) {
    const img = this.grab('pfx:claw');
    if (!img) return;
    img.setPosition(x, y).setRotation(angle).setTint(tint).setDepth(4651).setScale(0.6 * scale, 1.1 * scale);
    this.fade(img, { scaleX: 1.25 * scale, alpha: 0 }, ms);
  }

  /**
   * Screen-space colour pop for big moments (keystones, signature detonations): a soft additive wash over the view,
   * gentler than `flash` and in any colour. Respects the flashes and reduced-effects settings.
   */
  pop(color: number, alpha = 0.2, ms = 160) {
    if (!this.flashOn || this.reduced) return;
    const s = this.scene;
    const cam = s.cameras.main;
    if (!this.popRect) this.popRect = s.add.rectangle(0, 0, 8, 8, 0xffffff, 1).setScrollFactor(0).setDepth(4890).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.popTween?.stop();
    const r = this.popRect.setPosition(cam.width / 2, cam.height / 2).setSize(cam.width * 3, cam.height * 3).setOrigin(0.5, 0.5)
      .setFillStyle(color, 1).setAlpha(alpha).setVisible(true);
    this.popTween = s.tweens.add({ targets: r, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => r.setVisible(false) });
  }

  afterimage(src: Phaser.GameObjects.Sprite, tint = 0x8fd8ff, alpha = 0.45, ms = 220, ox = 0, oy = 0) {
    if (this.reduced) return;
    const img = this.grab(src.texture.key);
    if (!img) return;
    img.setFrame(src.frame.name).setPosition(src.x + ox, src.y + oy).setOrigin(src.originX, src.originY).setFlipX(src.flipX)
      .setScale(src.scaleX, src.scaleY).setRotation(src.rotation).setTintFill(tint).setAlpha(alpha).setDepth(src.depth - 0.5);
    this.fade(img, { alpha: 0 }, ms, 'Linear');
  }

  /** A row of fading afterimages trailing back from a sprite along screen direction (ux, uy), `gap` px apart. */
  ghosts(src: Phaser.GameObjects.Sprite, n: number, ux: number, uy: number, tint: number, gap = 8, alpha = 0.5, ms = 260) {
    if (this.reduced) return;
    const k = Math.max(1, Math.min(n, this.count(n)));
    for (let i = 1; i <= k; i++) this.afterimage(src, tint, alpha * (1 - (i - 1) / (k + 1)), ms - i * 20, -ux * gap * i, -uy * gap * i);
  }

  /** Graphics-tier particle count for kits that spawn their own cosmetic sprites (same rounding as every burst). */
  budget(n: number): number { return this.reduced ? 0 : this.count(n); }

  /** Floating pixel number. 'crit' pops large with an overshoot and a hot outline; 'heal' rises softly. */
  number(x: number, y: number, text: string, color: string, size: NumberStyle = 'sm') {
    if (!this.numbersOn) return;
    if (this.texts.length > (this.low ? 30 : 70) && size !== 'crit') return;
    const s = this.scene;
    const small = size !== 'crit' && size !== 'lg' && size !== 'md';
    const px = small ? WORLD_TEXT_PX.numberSmall : WORLD_TEXT_PX.number;
    const t = this.textPool.pop() ?? s.add.text(0, 0, '', { fontFamily: FONT_NUM, fontSize: `${WORLD_TEXT_PX.number}px`, color: '#fff', stroke: '#070505', strokeThickness: 3, resolution: 1 });
    const stroke = size === 'crit' ? '#5a0a0a' : '#070505';
    t.setText(text).setFontFamily(small ? FONT_WORLD : FONT_NUM).setColor(color).setFontSize(px).setStroke(stroke, size === 'crit' ? 4 : 3).setOrigin(0.5, 1)
      .setPosition(Math.round(x + (Math.random() - 0.5) * (size === 'crit' ? 6 : 14)), Math.round(y - (size === 'crit' ? 34 : 28))).setDepth(size === 'crit' ? 4910 : 4900)
      .setAlpha(1).setVisible(true).setAngle(size === 'crit' && !this.reduced ? (Math.random() - 0.5) * 14 : 0)
      .setScale(size === 'crit' ? (this.reduced ? 1.8 : 2.8) : size === 'lg' ? 1.8 : 1.4);
    t.setData('born', s.time.now);
    t.setData('kind', size);
    t.setData('vx', size === 'crit' ? (Math.random() - 0.5) * 16 : (Math.random() - 0.5) * 30);
    t.setData('vy', size === 'crit' ? -80 : size === 'lg' ? -70 : size === 'heal' ? -34 : -55);
    this.texts.push(t);
  }

  update(dt: number) {
    const now = this.scene.time.now;
    // time dilation eases back to 1
    if (this.dilation < 1) {
      const left = this.dilateUntil - now;
      this.applyDilation(left <= 0 ? 1 : this.dilateFrom + (1 - this.dilateFrom) * (1 - left / Math.max(1, this.dilateMs)) ** 2);
    }
    if (!this.frozen && this.scene.anims.globalTimeScale === 0) this.scene.anims.globalTimeScale = this.dilation;
    if (!this.frozen) this.clock += dt * 1000 * this.dilation;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      const kind = t.getData('kind') as NumberStyle;
      const life = kind === 'crit' ? 1.05 : 0.85;
      const age = (now - (t.getData('born') as number)) / 1000;
      if (age > life) { t.setVisible(false); this.texts.splice(i, 1); this.textPool.push(t); continue; }
      if (this.frozen) continue;
      const vy = (t.getData('vy') as number) + (kind === 'crit' ? 170 : 140) * age;
      t.x += (t.getData('vx') as number) * dt;
      t.y += vy * dt;
      if (kind === 'crit') {
        // pop: overshoot then settle to 1.6, slow fade at the end
        const k = age < 0.07 ? 2.8 : Math.max(1.6, t.scaleX - dt * 9);
        t.setScale(k).setAngle(t.angle * Math.pow(0.02, dt));
      } else {
        const pop = age < 0.08 ? 1 : 0;
        t.setScale(Math.max(1, t.scaleX - dt * 6 * (1 - pop)));
      }
      const fadeAt = life - 0.3;
      t.setAlpha(age < fadeAt ? 1 : 1 - (age - fadeAt) / 0.3);
      t.x = Math.round(t.x); t.y = Math.round(t.y);
    }
  }
}
