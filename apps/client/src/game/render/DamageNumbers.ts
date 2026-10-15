import * as Phaser from 'phaser';
import { Big, formatBig } from '@cursebound/numeric';
import { FONT_NUM, FONT_WORLD, WORLD_TEXT_PX } from '@/ui/fonts';
import { gfx } from '../gfx';
import type { Juice } from './Juice';
import {
  FLOAT_MS, NUMBER_CAP, ROLL_MAX_MS, ROLL_WINDOW_MS, accumulate, expiresAt, isOpen, numberKey, overCap, popScale,
  type NumKind, type Rolling,
} from './numberAccumulator';

// Rolling damage numbers (presentation only). One number per target and kind: hits inside the roll window tick the
// total up with a small pop instead of spawning a cloud; crits get their own big gold number with a heavy outline and a
// scale-bounce; heals are green, damage to you red. Texts are pooled, the count is capped per graphics tier (crits go
// last), sizes are whole pixel steps of the number font so they stay crisp at the play zoom, and everything respects
// the damage-numbers setting (Juice.numbersOn). Motion runs on the presentation clock, so hit-stop freezes it too.

interface Live { roll: Rolling; text: Phaser.GameObjects.Text; popAt: number; fresh: boolean; dx: number; tilt: number }

/** Font size (world px), fill and outline per kind. */
const LOOK: Record<NumKind, { px: number; font: string; stroke: string; sw: number; lift: number; rise: number }> = {
  dmg: { px: WORLD_TEXT_PX.number, font: FONT_NUM, stroke: '#070505', sw: 3, lift: 30, rise: 26 },
  crit: { px: 30, font: FONT_NUM, stroke: '#3a0c00', sw: 5, lift: 44, rise: 22 },
  heal: { px: WORLD_TEXT_PX.number, font: FONT_NUM, stroke: '#04140a', sw: 3, lift: 34, rise: 22 },
  hurt: { px: WORLD_TEXT_PX.number, font: FONT_NUM, stroke: '#1a0404', sw: 3, lift: 36, rise: 24 },
  ally: { px: WORLD_TEXT_PX.numberSmall, font: FONT_WORLD, stroke: '#070505', sw: 3, lift: 34, rise: 20 },
};

/** Fixed colours: crit gold, heal green, hurt red, ally pink (plain damage takes the damage type's colour). */
export const NUMBER_COLOR = { crit: '#ffd23a', heal: '#7dff6a', hurt: '#ff4a4a', ally: '#ff9a9a' } as const;

/** Retro readout: whole numbers below a thousand, suffixes and scientific notation beyond (same rule as the HUD). */
export function numberText(b: Big): string {
  if (b.lt(Big.from(1000))) { const n = b.toNumber(); return n > 0 && n < 1 ? '1' : String(Math.round(n)); }
  return formatBig(b);
}

export class DamageNumbers {
  private live = new Map<string, Live>();
  private pool: Phaser.GameObjects.Text[] = [];

  constructor(private scene: Phaser.Scene, private juice: Juice) {}

  /** Fold one hit into its target's number (or start one). `x, y` = the target's feet in screen px. */
  add(target: string, kind: NumKind, amount: Big, x: number, y: number, color: string) {
    if (!this.juice.numbersOn || amount.isZero()) return;
    const now = this.juice.clock;
    const key = numberKey(target, kind);
    const cur = this.live.get(key);
    const { roll, fresh } = accumulate(cur && isOpen(cur.roll, now) ? cur.roll : undefined, { target, kind, amount, at: now, x, y, color });
    if (!fresh && cur) {
      cur.roll = roll; cur.popAt = now; cur.fresh = false;
      this.paint(cur);
      return;
    }
    // a released number of the same key keeps floating away under a new one
    if (cur) { this.live.delete(key); this.live.set(`${key}#${cur.roll.born}`, { ...cur, roll: { ...cur.roll, key: `${key}#${cur.roll.born}` } }); }
    for (const k of overCap([...this.live.values()].map((l) => l.roll), NUMBER_CAP[gfx().tier], now)) this.drop(k);
    const reduced = this.juice.reduced;
    const n: Live = {
      roll, text: this.grab(kind), popAt: now, fresh: true,
      dx: kind === 'crit' ? 6 + Math.random() * 6 : (Math.random() - 0.5) * 10,
      tilt: kind === 'crit' && !reduced ? (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 5) : 0,
    };
    this.live.set(key, n);
    this.paint(n);
    this.place(n, now);
  }

  /** Drop everything (round change, numbers switched off). */
  clear() { for (const k of [...this.live.keys()]) this.drop(k); }

  update() {
    if (!this.juice.numbersOn) { if (this.live.size) this.clear(); return; }
    const now = this.juice.clock;
    for (const [k, n] of this.live) {
      if (now >= expiresAt(n.roll)) { this.drop(k); continue; }
      this.place(n, now);
    }
  }

  private place(n: Live, now: number) {
    const r = n.roll;
    const L = LOOK[r.kind];
    const closeAt = Math.min(r.last + ROLL_WINDOW_MS[r.kind], r.born + ROLL_MAX_MS);
    let rise: number, alpha = 1;
    if (now < closeAt) rise = Math.min(6, (now - r.born) * 0.012);            // hovering while it rolls
    else {
      const k = Math.min(1, (now - closeAt) / FLOAT_MS[r.kind]);
      rise = 6 + L.rise * (1 - (1 - k) * (1 - k));                            // then floats up, easing out
      alpha = k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.45);
    }
    let s = popScale(now - n.popAt, r.kind, n.fresh);
    if (this.juice.reduced) s = 1 + (s - 1) * 0.4;
    const t = n.text;
    const tiltK = Math.max(0, 1 - (now - r.born) / 260);
    t.setPosition(Math.round(r.x + n.dx), Math.round(r.y - L.lift - rise)).setScale(s).setAlpha(alpha).setAngle(n.tilt * tiltK);
  }

  private paint(n: Live) {
    const r = n.roll;
    const label = r.kind === 'heal' ? `+${numberText(r.total)}` : r.kind === 'hurt' || r.kind === 'ally' ? `-${numberText(r.total)}` : r.kind === 'crit' ? `${numberText(r.total)}!` : numberText(r.total);
    n.text.setText(label).setColor(r.color);
  }

  private grab(kind: NumKind): Phaser.GameObjects.Text {
    const L = LOOK[kind];
    const t = this.pool.pop() ?? this.scene.add.text(0, 0, '', { fontFamily: FONT_NUM, fontSize: `${WORLD_TEXT_PX.number}px`, color: '#fff', resolution: 1 });
    t.setFontFamily(L.font).setFontSize(L.px).setStroke(L.stroke, L.sw).setOrigin(0.5, 1).setDepth(kind === 'crit' ? 4912 : kind === 'hurt' ? 4906 : 4900)
      .setVisible(true).setActive(true).setAlpha(1).setAngle(0).setScale(1);
    // crits carry a hard drop shadow under the outline so the gold punches off any floor
    if (kind === 'crit') t.setShadow(0, 2, '#000000', 0, true, true); else t.setShadow(0, 0, '#000000', 0, false, false);
    return t;
  }

  private drop(key: string) {
    const n = this.live.get(key);
    if (!n) return;
    this.live.delete(key);
    n.text.setVisible(false).setActive(false);
    if (this.pool.length < 64) this.pool.push(n.text); else n.text.destroy();
  }
}
