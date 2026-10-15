import * as Phaser from 'phaser';
import type { Snapshot } from '@cursebound/simulation';
import { HH, HW, iso } from './iso';
import { gfx } from '../gfx';

// The tutorial's walk mark (simulation tutorialRoom.ts, snapshot `gd.m`): gold rune diamonds on the floor that
// breathe in hard steps, a soft gold light, and a chevron bobbing above, drawn pixel by pixel like the click markers
// (ClickFx). Unlit, above floor decals (-54), below actors and walls. Present only while the move step wants it.

const GOLD = 0xffc860, HI = 0xfff2c8, INK = 0x070505;
/** chevron rows (x offsets of the left arm; the right arm mirrors it) */
const CHEVRON = [0, 1, 2, 3, 4, 5];

export class GuideMark {
  private g: Phaser.GameObjects.Graphics;
  /** the chevron floats above walls and actors (a marker, never hidden behind a wall face) */
  private top: Phaser.GameObjects.Graphics;
  private glow: Phaser.GameObjects.Image | null = null;

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(-53);
    this.top = scene.add.graphics().setDepth(4650);
  }

  update(snap: Snapshot, now: number, still: boolean) {
    const g = this.g;
    g.clear();
    this.top.clear();
    const m = snap.gd?.m;
    if (!m) { this.glow?.setVisible(false); return; }
    const c = iso.p(m[0], m[1]);
    const cx = Math.round(c.x), cy = Math.round(c.y);
    const beat = still ? 0 : Math.floor(now / 140) % 6;   // six hard steps, no tweening
    if (!this.glow && gfx().softGlow && this.scene.textures.exists('light:soft')) {
      this.glow = this.scene.add.image(cx, cy, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(GOLD).setDepth(-54);
    }
    this.glow?.setVisible(true).setPosition(cx, cy).setScale(0.34, 0.26).setAlpha(0.32 + (beat % 3) * 0.06);
    // concentric diamonds (the outer one breathes), each a 2px line over a dark drop line
    const ring = (s: number, col: number, alpha: number) => {
      const w = Math.round(HW * s), h = Math.round(HH * s);
      g.lineStyle(2, INK, alpha * 0.8).strokePoints([{ x: cx - w, y: cy + 2 }, { x: cx, y: cy - h + 2 }, { x: cx + w, y: cy + 2 }, { x: cx, y: cy + h + 2 }], true);
      g.lineStyle(2, col, alpha).strokePoints([{ x: cx - w, y: cy }, { x: cx, y: cy - h }, { x: cx + w, y: cy }, { x: cx, y: cy + h }], true);
    };
    ring(0.5, HI, 1);
    ring(0.8, GOLD, 1);
    ring(1.0 + beat * 0.05, GOLD, 0.9 - beat * 0.12);
    g.fillStyle(INK, 1).fillRect(cx - 3, cy - 1, 6, 6);
    g.fillStyle(HI, 1).fillRect(cx - 3, cy - 3, 6, 6);
    // chevron above, bobbing a pixel per step
    const t = this.top;
    const by = cy - 52 - (still ? 0 : [0, 1, 2, 3, 2, 1][beat]);
    for (const i of CHEVRON) {
      t.fillStyle(INK, 1).fillRect(cx - 12 + i * 2 + 2, by + i * 2 + 2, 4, 4).fillRect(cx + 8 - i * 2 + 2, by + i * 2 + 2, 4, 4);
    }
    for (const i of CHEVRON) {
      t.fillStyle(i < 2 ? HI : GOLD, 1).fillRect(cx - 12 + i * 2, by + i * 2, 4, 4).fillRect(cx + 8 - i * 2, by + i * 2, 4, 4);
    }
  }

  destroy() { this.g.destroy(); this.top.destroy(); this.glow?.destroy(); }
}
