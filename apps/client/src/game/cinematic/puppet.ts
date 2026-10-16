import * as Phaser from 'phaser';
import { ACTOR_META, animFor, type ActorId, type ActorState } from '../art/actors';
import { ensureActor } from '../art/generate';
import type { DungeonRenderer } from '../render/DungeonRenderer';
import { iso } from '../render/iso';

// Cutscene stand-ins built from the real actor textures and animations (animFor: same keys, same 8-way facing and
// mirroring as the live scene). The real actor is hidden while its puppet acts, so nobody ever appears twice.
// A puppet can carry a "glow" twin: a copy of its current frame filled with one colour and blended additively,
// used for stepping out of / into light.

export interface PathPoint { x: number; y: number }

/** 8-way screen facing for a world-space direction (the live scene's mapping, iso.facing8). */
export function dirOf(wx: number, wy: number): number {
  return iso.facing8(wx, wy);
}

export class Puppet {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Ellipse;
  private glowSpr: Phaser.GameObjects.Sprite | null = null;
  private glowAlpha = 0;
  private animKey = '';
  x: number; y: number;
  /** extra screen-space lift (falling bosses), px */
  lift = 0;
  dir = 2;
  state: ActorState = 'idle';
  alpha = 1;
  private path: PathPoint[] = [];
  private cum: number[] = [];
  private lastStepDust = 0;
  onStep: ((px: number, py: number) => void) | null = null;

  constructor(private scene: Phaser.Scene, readonly actor: ActorId, x: number, y: number, dungeon: DungeonRenderer | null) {
    ensureActor(scene, actor);
    const meta = ACTOR_META[actor];
    this.x = x; this.y = y;
    const q = iso.p(x, y);
    this.shadow = scene.add.ellipse(q.x, q.y, meta.shadowRadius * 2, meta.shadowRadius * 0.8, 0x000000, 0.55).setDepth(-60);
    this.sprite = scene.add.sprite(q.x, q.y, `actor:${actor}`).setOrigin(meta.originX, meta.originY);
    dungeon?.litObject(this.sprite);
    this.play('idle', 2);
    this.sync();
  }

  play(state: ActorState, dir = this.dir, restart = false) {
    this.state = state; this.dir = dir;
    const a = animFor(this.actor, state, dir);
    this.sprite.setFlipX(a.flipX);
    if ((restart || this.animKey !== a.key) && this.scene.anims.exists(a.key)) {
      this.animKey = a.key;
      this.sprite.play(a.key, !restart);
    }
  }

  /** Face a world point. */
  face(wx: number, wy: number) { this.play(this.state, dirOf(wx - this.x, wy - this.y)); }

  /** Walk route for progress-driven movement (see setProgress). */
  setPath(points: PathPoint[]) {
    this.path = [{ x: this.x, y: this.y }, ...points];
    this.cum = [0];
    for (let i = 1; i < this.path.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.path[i].x - this.path[i - 1].x, this.path[i].y - this.path[i - 1].y));
  }
  get pathLength() { return this.cum.length ? this.cum[this.cum.length - 1] : 0; }

  /** Place the puppet `k` (0..1) along its path, running and facing along the segment; idles at the end. */
  setProgress(k: number, endState: ActorState = 'idle') {
    if (this.path.length < 2) { if (k >= 1 && this.state === 'run') this.play(endState); return; }
    const total = this.pathLength;
    const d = Math.max(0, Math.min(1, k)) * total;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.path[i - 1], b = this.path[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - this.cum[i - 1]) / seg));
    this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t;
    if (k >= 1) { if (this.state !== endState) this.play(endState); }
    else this.play('run', dirOf(b.x - a.x, b.y - a.y));
  }

  /** Additive single-colour twin of the current frame (0 = off). */
  setGlow(color: number, alpha: number) {
    this.glowAlpha = alpha;
    if (alpha <= 0.001) { this.glowSpr?.setVisible(false); return; }
    if (!this.glowSpr) {
      this.glowSpr = this.scene.add.sprite(0, 0, this.sprite.texture.key).setOrigin(this.sprite.originX, this.sprite.originY).setBlendMode(Phaser.BlendModes.ADD);
    }
    this.glowSpr.setTintFill(color).setVisible(true);
  }

  /** Push position, depth, alpha and the glow twin to the display objects. Call once per frame. */
  sync(now = this.scene.time.now) {
    const q = iso.p(this.x, this.y);
    const depth = iso.depth(this.x, this.y);
    this.sprite.setPosition(Math.round(q.x), Math.round(q.y - this.lift)).setDepth(depth).setAlpha(this.alpha);
    const ground = Math.max(0.25, 1 - this.lift / 260);
    this.shadow.setPosition(Math.round(q.x), Math.round(q.y)).setScale(ground).setAlpha(Math.min(1, this.alpha * 1.4) * ground);
    if (this.glowSpr && this.glowAlpha > 0.001) {
      this.glowSpr.setPosition(this.sprite.x, this.sprite.y).setDepth(depth + 0.5).setFlipX(this.sprite.flipX).setAlpha(this.glowAlpha)
        .setFrame(this.sprite.frame.name);
    }
    if (this.state === 'run' && this.onStep && now - this.lastStepDust > 260) { this.lastStepDust = now; this.onStep(q.x, q.y); }
  }

  /** Screen point of the feet. */
  get screen() { return iso.p(this.x, this.y); }

  destroy() {
    this.sprite.destroy(); this.shadow.destroy(); this.glowSpr?.destroy();
  }
}
