import * as Phaser from 'phaser';
import type { Snapshot } from '@cursebound/simulation';
import { HH, HW, iso } from './iso';

// The tutorial's walk mark (simulation tutorialRoom.ts, snapshot `gd.m`): a gold rune diamond on the floor that
// breathes in hard steps, with a chevron bobbing above it, drawn pixel by pixel like the click markers (ClickFx).
// Unlit, above floor decals (-54), below actors and walls. Present only while the move step wants it.

const GOLD = 0xffc860, HI = 0xfff2c8, INK = 0x070505;

export class GuideMark {
  private g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(-53);
  }

  update(snap: Snapshot, now: number, still: boolean) {
    const g = this.g;
    g.clear();
    const m = snap.gd?.m;
    if (!m) return;
    const c = iso.p(m[0], m[1]);
    const cx = Math.round(c.x), cy = Math.round(c.y);
    const beat = still ? 1 : Math.floor(now / 140) % 6;   // six hard steps, no tweening
    // two concentric diamonds (the outer one breathes), each a 2px line with a dark drop pixel
    const ring = (s: number, col: number, alpha: number) => {
      const w = Math.round(HW * s), h = Math.round(HH * s);
      g.lineStyle(2, INK, alpha * 0.8).strokePoints([{ x: cx - w, y: cy + 2 }, { x: cx, y: cy - h + 2 }, { x: cx + w, y: cy + 2 }, { x: cx, y: cy + h + 2 }], true);
      g.lineStyle(2, col, alpha).strokePoints([{ x: cx - w, y: cy }, { x: cx, y: cy - h }, { x: cx + w, y: cy }, { x: cx, y: cy + h }], true);
    };
    ring(0.55, HI, 1);
    ring(0.8 + beat * 0.06, GOLD, 1 - beat * 0.12);
    // centre rune: a 4x4 pixel lozenge
    g.fillStyle(INK, 1).fillRect(cx - 2, cy, 4, 4);
    g.fillStyle(HI, 1).fillRect(cx - 2, cy - 2, 4, 4);
    // chevron above, bobbing one pixel per step
    const by = cy - 40 - (still ? 0 : [0, 1, 2, 3, 2, 1][beat]);
    for (let i = 0; i < 5; i++) {
      g.fillStyle(INK, 1).fillRect(cx - 6 + i + 1, by + i + 1, 2, 2).fillRect(cx + 5 - i + 1, by + i + 1, 2, 2);
      g.fillStyle(GOLD, 1).fillRect(cx - 6 + i, by + i, 2, 2).fillRect(cx + 5 - i - 1, by + i, 2, 2);
    }
  }

  destroy() { this.g.destroy(); }
}
