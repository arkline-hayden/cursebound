import * as Phaser from 'phaser';
import { HH, HW, iso } from './iso';

// Click-to-move feedback on the ground plane, drawn pixel by pixel (integer coordinates, 1px strokes with a dark
// drop pixel) so it reads as part of the pixel art rather than vector chrome:
//   - click marker: four chevrons converge on the clicked point along the tile diamond while a diamond ring blooms
//     and fades (gold for a walk, red for an attack-move, pale blue for a pickup / door);
//   - hover: corner brackets of an iso ellipse under the foe (or item / door) the cursor is over; brighter than and
//     separate from the red sprite rim (CombatScene.updateHover);
//   - locked attack-move target: a red ring with four ticks slowly turning around the feet;
//   - developer overlay: the hero's remaining path as a dotted line.
// Unlit, above floor decals and shadows (-54), below every actor and wall.

export type ClickMarkKind = 'move' | 'attack' | 'item';

interface Mark { x: number; y: number; t0: number; kind: ClickMarkKind }

const COLORS: Record<ClickMarkKind, { main: number; hi: number }> = {
  move: { main: 0xffc860, hi: 0xfff2c8 },
  attack: { main: 0xff4a3a, hi: 0xffc0a8 },
  item: { main: 0x8fd8ff, hi: 0xe8f8ff },
};
const INK = 0x070505;
const DUR = 520;

export interface ClickFxState {
  /** screen (scene) point of the hovered thing's feet, its world radius and what it is */
  hover: { x: number; y: number; r: number; kind: 'enemy' | 'item' } | null;
  /** screen point and world radius of the locked attack-move target */
  target: { x: number; y: number; r: number } | null;
  /** world points (hero first) of the remaining walk, drawn only when set */
  path: { x: number; y: number }[] | null;
  /** reduced motion: no pulsing or turning */
  still: boolean;
}

export class ClickFx {
  private g: Phaser.GameObjects.Graphics;
  private marks: Mark[] = [];
  private batch: number[] = [];

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(-54);
  }

  /** Drop a click marker at a world point. */
  mark(x: number, y: number, kind: ClickMarkKind) {
    this.marks.push({ x, y, t0: this.scene.time.now, kind });
    if (this.marks.length > 3) this.marks.shift();
  }

  clear() {
    this.marks = [];
    this.g.clear();
  }

  destroy() { this.g.destroy(); }

  update(now: number, st: ClickFxState) {
    const g = this.g.clear();
    this.marks = this.marks.filter((m) => now - m.t0 < DUR);
    for (const m of this.marks) this.drawMark(g, m, (now - m.t0) / DUR);
    if (st.target) this.drawTarget(g, st.target.x, st.target.y, st.target.r, now, st.still);
    if (st.hover) {
      const same = st.target && Math.abs(st.target.x - st.hover.x) < 1 && Math.abs(st.target.y - st.hover.y) < 1;
      if (!same) this.drawBrackets(g, st.hover.x, st.hover.y, st.hover.r, st.hover.kind === 'enemy' ? 0xffd0c0 : 0xffe6a0, st.hover.kind === 'enemy' ? 0xff5040 : 0xc89a40, now, st.still);
    }
    if (st.path && st.path.length > 1) this.drawPath(g, st.path);
    this.flush(g);
  }

  // ---------------- pieces ----------------

  /** Queue one pixel; `flush` draws every dark drop pixel first, then the colours, so shapes never shadow themselves. */
  private px(_g: Phaser.GameObjects.Graphics, x: number, y: number, col: number, a = 1) {
    this.batch.push(x, y, col, a);
  }

  private flush(g: Phaser.GameObjects.Graphics) {
    const b = this.batch;
    for (let i = 0; i < b.length; i += 4) g.fillStyle(INK, 0.85 * b[i + 3]).fillRect(b[i], b[i + 1] + 1, 1, 1);
    for (let i = 0; i < b.length; i += 4) g.fillStyle(b[i + 2], b[i + 3]).fillRect(b[i], b[i + 1], 1, 1);
    b.length = 0;
  }

  /** Pixel arc of the iso ellipse (rx, ry) between angles a0..a1 (radians, screen space). */
  private arc(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, col: number, a = 1) {
    const steps = Math.max(8, Math.ceil(((a1 - a0) / (Math.PI * 2)) * (rx + ry) * Math.PI * 1.2));
    let lx = NaN, ly = NaN;
    for (let i = 0; i <= steps; i++) {
      const t = a0 + ((a1 - a0) * i) / steps;
      const x = Math.round(cx + Math.cos(t) * rx), y = Math.round(cy + Math.sin(t) * ry);
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      this.px(g, x, y, col, a);
    }
  }

  private drawMark(g: Phaser.GameObjects.Graphics, m: Mark, t: number) {
    const c = COLORS[m.kind];
    const p = iso.p(m.x, m.y);
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const ease = 1 - (1 - Math.min(1, t / 0.55)) ** 3;
    const fade = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
    // chevrons along the diamond corners, pointing inward
    const reach = 1.15 - 0.8 * ease;
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const tipX = Math.round(cx + dx * HW * 0.62 * reach), tipY = Math.round(cy + dy * HH * 0.62 * reach);
      this.chevron(g, tipX, tipY, dx, dy, c.main, c.hi, fade);
    }
    // diamond ring blooming out of the point
    if (t > 0.25) {
      const k = (t - 0.25) / 0.75;
      const s = 0.25 + 0.5 * k;
      const hw = Math.max(2, Math.round(HW * s)), hh = Math.max(1, Math.round(HH * s));
      this.diamond(g, cx, cy, hw, hh, c.main, (1 - k) * 0.9);
    }
    // the point itself
    for (let k = -1; k <= 1; k++) this.px(g, cx + k, cy, c.hi, fade);
  }

  /** A small arrowhead whose tip sits at (x, y) and whose body trails outward along the screen axis (dx, dy). */
  private chevron(g: Phaser.GameObjects.Graphics, x: number, y: number, dx: number, dy: number, main: number, hi: number, a: number) {
    // rows of the arrowhead, from the tip outward (flattened 2:1 for the top / bottom ones)
    if (dx !== 0) {
      for (let i = 0; i < 4; i++) {
        const col = x + dx * i;
        const half = Math.min(i, 2);
        for (let j = -half; j <= half; j++) {
          const edge = Math.abs(j) === half;
          this.px(g, col, y + j, edge ? main : hi, a);
        }
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const row = y + dy * i;
        const half = [0, 2, 3][i];
        for (let j = -half; j <= half; j++) {
          const edge = Math.abs(j) >= half - 1;
          this.px(g, x + j, row, edge ? main : hi, a);
        }
      }
    }
  }

  /** Pixel outline of an iso diamond centred on (cx, cy). */
  private diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, hw: number, hh: number, col: number, a: number) {
    for (let x = 0; x <= hw; x++) {
      const y = Math.round((hh * (hw - x)) / hw);
      this.px(g, cx + x, cy - y, col, a); this.px(g, cx - x, cy - y, col, a);
      this.px(g, cx + x, cy + y, col, a); this.px(g, cx - x, cy + y, col, a);
    }
  }

  /** Four corner brackets of the ellipse under a hovered thing. */
  private drawBrackets(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, hi: number, main: number, now: number, still: boolean) {
    const rr = Math.min(2.6, Math.max(0.35, r)) + 0.18;
    const rx = Math.round(iso.rx(rr)), ry = Math.round(iso.ry(rr));
    const pulse = still ? 1 : 0.8 + 0.2 * Math.sin(now / 140);
    const span = 0.42;
    for (let q = 0; q < 4; q++) {
      const mid = Math.PI / 4 + (q * Math.PI) / 2;
      this.arc(g, Math.round(x), Math.round(y), rx + 1, ry + 1, mid - span, mid + span, main, pulse);
      this.arc(g, Math.round(x), Math.round(y), rx, ry, mid - span, mid + span, hi, pulse);
    }
  }

  /** Locked attack target: a red ring with four turning ticks. */
  private drawTarget(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, now: number, still: boolean) {
    const rr = Math.min(2.6, Math.max(0.35, r)) + 0.12;
    const rx = Math.round(iso.rx(rr)), ry = Math.round(iso.ry(rr));
    const cx = Math.round(x), cy = Math.round(y);
    this.arc(g, cx, cy, rx, ry, 0, Math.PI * 2, 0xd8281e, 0.9);
    const spin = still ? 0 : now / 900;
    for (let q = 0; q < 4; q++) {
      const a = spin + (q * Math.PI) / 2;
      const ox = Math.cos(a), oy = Math.sin(a);
      for (let k = 1; k <= 3; k++) this.px(g, Math.round(cx + ox * (rx + k)), Math.round(cy + oy * (ry + k * 0.5)), 0xffb0a0, 1);
    }
  }

  private drawPath(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]) {
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = iso.p(pts[i - 1].x, pts[i - 1].y), b = iso.p(pts[i].x, pts[i].y);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0; s < d; s += 1) {
        if ((n++ & 7) > 2) continue;
        const t = s / d;
        this.px(g, Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), 0x7fffd4, 0.8);
      }
    }
  }
}
