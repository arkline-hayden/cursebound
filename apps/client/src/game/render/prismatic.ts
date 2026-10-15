import type * as Phaser from 'phaser';
import { fxCount, gfx } from '../gfx';

// Prismatic (rainbow) presentation for Fate's Blessing: hue-cycling colours in hard steps (pixel art never blends
// smoothly), a segmented rainbow ring that turns, and a small pool of pixel sparkles. Shared by the ground pickup
// (LootRenderer) and the blessed door (Doors). Cosmetic only; sparkle counts follow the graphics tier (gfx.ts).

/** HSV (h in turns) to 0xRRGGBB. */
export function hsv(h: number, s: number, v: number): number {
  const f = (n: number) => {
    const k = (n + (((h % 1) + 1) % 1) * 6) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/** The cycling hue at time `now` (ms), quantised to `steps` per turn; `offset` in turns, `period` ms per turn. */
export function prismHue(now: number, offset = 0, period = 1800, steps = 12): number {
  const h = now / period + offset;
  return Math.floor((((h % 1) + 1) % 1) * steps) / steps;
}

export function prismColor(now: number, offset = 0, s = 0.8, v = 1, period = 1800): number {
  return hsv(prismHue(now, offset, period), s, v);
}

/** A rainbow ellipse ring of `segs` hard-coloured segments that turns with time. */
export function prismRing(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, now: number, alpha: number, width = 2, segs = 18, period = 2400) {
  const turn = now / period;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
    g.lineStyle(width, hsv(k / segs + turn, 0.75, 1), alpha);
    g.beginPath();
    g.moveTo(Math.round(cx + Math.cos(a0) * rx), Math.round(cy + Math.sin(a0) * ry));
    g.lineTo(Math.round(cx + Math.cos(a1) * rx), Math.round(cy + Math.sin(a1) * ry));
    g.strokePath();
  }
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; big: boolean }

/** Pixel sparkles: tiny squares that drift up, twinkle into a plus at their peak and wheel through the hues. */
export class PrismSparkles {
  private list: Spark[] = [];
  private acc = new Map<number, number>();

  /** Emit `n` sparkles (already tier-scaled by the caller, or scaled here with `scale`) around (x, y). */
  burst(x: number, y: number, n: number, spread = 18, speed = 40, scale = true) {
    const count = scale ? fxCount(n) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.list.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - speed * 0.6, life: 0, max: 500 + Math.random() * 600, hue: Math.random(), big: Math.random() < 0.3 });
    }
    if (this.list.length > 260) this.list.splice(0, this.list.length - 260);
  }

  /** Continuous emission keyed by an owner id: `rate` sparkles per second at full particle budget. */
  stream(key: number, x: number, y: number, rate: number, dt: number, spread = 10) {
    const budget = gfx().particles;
    if (budget <= 0) return;
    let a = (this.acc.get(key) ?? 0) + rate * budget * dt;
    while (a >= 1) {
      a -= 1;
      this.list.push({ x: x + (Math.random() - 0.5) * spread * 2, y: y - Math.random() * 6, vx: (Math.random() - 0.5) * 8, vy: -14 - Math.random() * 22, life: 0, max: 700 + Math.random() * 700, hue: Math.random(), big: Math.random() < 0.25 });
    }
    this.acc.set(key, a);
  }

  forget(key: number) { this.acc.delete(key); }

  /** Advance and draw into `g` (cleared by the caller). */
  draw(g: Phaser.GameObjects.Graphics, now: number, dtMs: number) {
    const dt = dtMs / 1000;
    this.list = this.list.filter((s) => (s.life += dtMs) < s.max);
    for (const s of this.list) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy *= 0.97;
      const t = s.life / s.max;
      const col = hsv(s.hue + now / 900, 0.6, 1);
      const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const x = Math.round(s.x), y = Math.round(s.y);
      g.fillStyle(col, a).fillRect(x, y, 1, 1);
      if (s.big && t > 0.3 && t < 0.6) {
        g.fillStyle(0xffffff, a).fillRect(x, y, 1, 1);
        g.fillStyle(col, a * 0.8).fillRect(x - 1, y, 1, 1).fillRect(x + 1, y, 1, 1).fillRect(x, y - 1, 1, 1).fillRect(x, y + 1, 1, 1);
      }
    }
  }

  get size() { return this.list.length; }
}
