import * as Phaser from 'phaser';
import type { Snapshot } from '@cursebound/simulation';
import type { Juice } from './Juice';
import { iso } from './iso';
import { gfx } from '../gfx';

// Ground pickups (cosmetic only; the authority decides collection). Healing potions are red flasks that pop out of
// the fallen, bob over a soft red glow and blink before they expire; resource orbs are blue motes. On the 'pickup'
// event the flask bursts into red sparkles that streak to the drinker. Uses the art agent's 'fx:potion:health'
// (16x16, 4-frame glint anim) and 'fx:globe:resource' when present, otherwise draws its own.

type SnapPickup = Snapshot['pickups'][number];

interface View {
  spr: Phaser.GameObjects.Sprite;
  glow?: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  x: number; y: number;          // rendered world position (smoothed toward the snapshot)
  seen: number;                  // first seen (ms)
  kind: string;
  tier: number;
  lastSpark: number;
  /** the pop-out arc has landed (its clink played, or it was already lying there when first seen) */
  landed: boolean;
}

const LOOK: Record<string, { tex: string; fallback: string; glow: number; spark: number }> = {
  potion: { tex: 'fx:potion:health', fallback: 'pk:potion', glow: 0xff2a3a, spark: 0xff4a5a },
  orb: { tex: 'fx:globe:resource', fallback: 'pk:orb', glow: 0x4aa8ff, spark: 0x8fd0ff },
};

export class PickupRenderer {
  private views = new Map<number, View>();
  private collected = new Set<number>();

  /** `onDrop`: a freshly dropped potion or orb lands at world (x, y) (the scene plays item_drop) */
  constructor(private scene: Phaser.Scene, private juice: Juice, private onDrop?: (kind: string, x: number, y: number) => void) {
    this.ensureTextures();
  }

  /** Pixel-art fallbacks when the art pack has no potion/orb textures. */
  private ensureTextures() {
    const s = this.scene;
    if (!s.textures.exists('pk:potion')) {
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x140606, 1).fillRect(3, 0, 6, 3).fillRect(3, 3, 6, 3).fillRect(0, 6, 12, 10);   // outline
      g.fillStyle(0x6a3a1a, 1).fillRect(4, 0, 4, 2);                                                  // cork
      g.fillStyle(0xcfdbe4, 0.95).fillRect(4, 2, 4, 4);                                              // neck glass
      g.fillStyle(0xdbe6ee, 1).fillRect(1, 6, 10, 1);                                                // shoulder rim
      g.fillStyle(0x8a0a18, 1).fillRect(1, 7, 10, 8);                                                // liquid
      g.fillStyle(0xc81428, 1).fillRect(2, 7, 8, 6);
      g.fillStyle(0xff4a56, 1).fillRect(2, 8, 3, 3);                                                 // highlight
      g.fillStyle(0xffffff, 1).fillRect(2, 8, 1, 1).fillRect(9, 7, 1, 2);
      g.fillStyle(0x5a0610, 1).fillRect(1, 14, 10, 1);
      g.generateTexture('pk:potion', 12, 16);
      g.destroy();
    }
    if (!s.textures.exists('pk:orb')) {
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x0a1830, 1).fillCircle(6, 6, 6);
      g.fillStyle(0x2a6ad0, 1).fillCircle(6, 6, 5);
      g.fillStyle(0x6ab4ff, 1).fillCircle(5, 5, 3);
      g.fillStyle(0xffffff, 1).fillRect(4, 3, 2, 2);
      g.generateTexture('pk:orb', 12, 12);
      g.destroy();
    }
  }

  private make(p: SnapPickup, now: number, tick: number): View {
    const s = this.scene;
    const look = LOOK[p.k] ?? LOOK.potion;
    const tex = s.textures.exists(look.tex) ? look.tex : look.fallback;
    const spr = s.add.sprite(0, 0, tex).setOrigin(0.5, 1);
    if (s.anims.exists(look.tex) && tex === look.tex) spr.play({ key: look.tex, repeat: -1 });
    spr.setScale(p.t > 0 ? 1.3 : 1.05);
    const glow = gfx().softGlow && s.textures.exists('light:soft')
      ? s.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(look.glow).setAlpha(0.4).setScale(p.t > 0 ? 0.24 : 0.17, (p.t > 0 ? 0.24 : 0.17) * 0.8)
      : undefined;
    const shadow = s.add.ellipse(0, 0, 12, 5, 0x000000, 0.5).setDepth(-58);
    const v: View = { spr, glow, shadow, x: p.x, y: p.y, seen: now, kind: p.k, tier: p.t, lastSpark: now, landed: tick - p.b > 30 };
    this.views.set(p.i, v);
    return v;
  }

  /** Render this frame's pickups. Unknown kinds (other modules) are skipped. */
  update(pickups: SnapPickup[] | undefined, tick: number, now: number, delta: number) {
    const seen = new Set<number>();
    for (const p of pickups ?? []) {
      if (!LOOK[p.k] || this.collected.has(p.i)) continue;
      seen.add(p.i);
      const v = this.views.get(p.i) ?? this.make(p, now, tick);
      // magnet pull arrives in 20 Hz steps: glide toward the authoritative spot
      const k = Math.min(1, delta / 55);
      v.x += (p.x - v.x) * k; v.y += (p.y - v.y) * k;
      const q = iso.p(v.x, v.y);
      const age = now - v.seen;
      // pop out of the body in a little arc, then bob
      const pop = age < 320 ? Math.sin((age / 320) * Math.PI) * 18 : 0;
      if (!v.landed && age >= 300) { v.landed = true; this.onDrop?.(p.k, p.x, p.y); }
      const bob = Math.sin(now / 280 + p.i) * 2.5;
      const lift = 8 + pop + bob;
      const left = p.u > 0 ? p.u - tick : Infinity;
      const blink = left < 240 && Math.floor(now / (left < 90 ? 70 : 140)) % 2 === 0;
      const depth = iso.depth(v.x, v.y) + 3;
      v.spr.setPosition(Math.round(q.x), Math.round(q.y - lift)).setDepth(depth).setAlpha(blink ? 0.35 : 1)
        .setAngle(Math.sin(now / 400 + p.i) * 6);
      v.glow?.setPosition(Math.round(q.x), Math.round(q.y - lift - 6)).setDepth(depth - 0.1).setAlpha((0.32 + 0.12 * Math.sin(now / 200 + p.i)) * (blink ? 0.4 : 1));
      v.shadow.setPosition(Math.round(q.x), Math.round(q.y)).setScale(1 - Math.min(0.5, (lift - 8) / 40));
      if (!this.juice.low && now - v.lastSpark > (v.tier > 0 ? 260 : 520)) {
        v.lastSpark = now;
        this.juice.embersAt(q.x + (Math.random() - 0.5) * 8, q.y - lift - 6, 1, (LOOK[v.kind] ?? LOOK.potion).spark);
      }
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { this.destroyView(v); this.views.delete(id); }
    for (const id of this.collected) if (!(pickups ?? []).some((p) => p.i === id)) this.collected.delete(id);
  }

  /** The authority says `slot` collected pickup `id`: burst and streak to the drinker at screen point (tx, ty). */
  collect(id: number, kind: string, wx: number, wy: number, tx: number, ty: number) {
    const v = this.views.get(id);
    const look = LOOK[kind] ?? LOOK.potion;
    const q = v ? { x: v.spr.x, y: v.spr.y - 6 } : (() => { const p = iso.p(wx, wy); return { x: p.x, y: p.y - 14 }; })();
    const J = this.juice;
    J.sparksAt(q.x, q.y, 14, look.spark);
    J.embersAt(q.x, q.y, 12, look.glow);
    J.ring(q.x, q.y + 10, 22, look.glow, 260);
    if (!J.reduced && this.scene.textures.exists('pfx:ember')) {
      const n = Math.max(2, Math.round(7 * Math.min(1, gfx().particles)));
      for (let i = 0; i < n; i++) {
        const m = this.scene.add.image(q.x + (Math.random() - 0.5) * 14, q.y + (Math.random() - 0.5) * 10, 'pfx:ember')
          .setTint(look.spark).setBlendMode(Phaser.BlendModes.ADD).setDepth(4700).setScale(1.4);
        this.scene.tweens.add({ targets: m, x: tx + (Math.random() - 0.5) * 8, y: ty - 18 + (Math.random() - 0.5) * 10, scale: 0.4, duration: 220 + i * 30, ease: 'Cubic.easeIn', onComplete: () => m.destroy() });
      }
    }
    if (v) { this.destroyView(v); this.views.delete(id); }
    this.collected.add(id);
  }

  private destroyView(v: View) { v.spr.destroy(); v.glow?.destroy(); v.shadow.destroy(); }

  clear() { for (const v of this.views.values()) this.destroyView(v); this.views.clear(); this.collected.clear(); }
}
