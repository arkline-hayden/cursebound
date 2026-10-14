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
    this.shards = add('pfx:shard', { lifespan: { min: 380, max: 720 }, speed: { min: 80, max: 240 }, angle: { min: 0, max: 360 }, gravityY: 420, rotate: { start: 0, end: 540 } }).setDepth(4595);
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

  arc(x: number, y: number, angle: number, tint: number, scale = 1) {
    const s = this.scene;
    if (!s.textures.exists('pfx:slashArc')) return;
    const img = s.add.image(x, y, 'pfx:slashArc').setRotation(angle).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(4650).setScale(0.6 * scale).setAlpha(1);
    s.tweens.add({ targets: img, scale: 1.15 * scale, alpha: 0, duration: 170, ease: 'Quad.easeOut', onComplete: () => img.destroy() });
  }

  /** Shockwave lying flat on the iso ground plane; radiusPx is the horizontal (screen) radius. */
  ring(x: number, y: number, radiusPx: number, tint: number, ms = 300) {
    const s = this.scene;
    if (!s.textures.exists('pfx:ring')) return;
    const img = s.add.image(x, y, 'pfx:ring').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(4640).setScale(0.2, 0.1).setAlpha(1);
    const k = (radiusPx * 2) / 64;
    s.tweens.add({ targets: img, scaleX: k, scaleY: k * 0.5, alpha: 0, duration: ms, ease: 'Cubic.easeOut', onComplete: () => img.destroy() });
  }

  impact(x: number, y: number, tint: number, scale = 1) {
    const s = this.scene;
    if (this.reduced || !s.textures.exists('pfx:flash')) return;
    const img = s.add.image(x, y, 'pfx:flash').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(4655).setScale(0.35 * scale).setRotation(Math.random() * Math.PI);
    s.tweens.add({ targets: img, scale: 0.7 * scale, alpha: 0, duration: 110, onComplete: () => img.destroy() });
  }

  afterimage(src: Phaser.GameObjects.Sprite, tint = 0x8fd8ff, alpha = 0.45, ms = 220) {
    if (this.reduced) return;
    const s = this.scene;
    const img = s.add.image(src.x, src.y, src.texture.key, src.frame.name).setOrigin(src.originX, src.originY).setFlipX(src.flipX)
      .setScale(src.scaleX, src.scaleY).setRotation(src.rotation).setTintFill(tint).setAlpha(alpha).setDepth(src.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: img, alpha: 0, duration: ms, onComplete: () => img.destroy() });
  }

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
