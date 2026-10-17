// The local hero as drawn on the locked play camera (pure: CombatScene feeds it the prediction every frame, the
// tests drive it from tests/tracking.harness.ts).
//   - Position: the prediction advances in whole 60 Hz input ticks, frames do not (144 Hz shows a tick on some frames
//     and none on others; uneven frames carry 0, 1 or 2). The hero is drawn along the latest tick's stretch of the walk
//     (GameConnection.pred px/py -> qx/qy) by how far the clock is into the next tick (InputTicks.alpha), so it glides
//     at its real speed on any frame pacing instead of stepping (an older low-pass on the stepped body still juddered
//     and trailed the prediction by ~0.2 tiles, which also lagged every turn).
//   - Reconciliation: when a snapshot moves the predicted body (GameConnection.drift), the drawn hero stays put and
//     the difference blends out over a few frames; a jump past SELF_VIEW.snapTiles (teleport, resync) snaps.
//   - Camera: the view centres on the hero's drawn pixel. Sprites sit at whole pixels while Phaser floors a fractional
//     camera scroll, so a camera on the unrounded point put the hero one pixel off on every other frame (a constant
//     shimmer against the floor while walking); lockedScroll derives the scroll from the same rounded pixel.

import type { Pt } from './input/path';

/** Screen px the play camera centres above the hero's feet (its body, not its shadow, sits mid-view). */
export const CAM_LIFT = 22;

export const SELF_VIEW = {
  /** time constant (ms) a reconciliation correction blends out with */
  blendMs: 60,
  /** a correction this large (tiles) is a teleport or a resync: snap instead of sliding */
  snapTiles: 1.5,
};

/** The latest input tick's stretch of the predicted walk: from (px, py) to (qx, qy). */
export interface TickBody { px: number; py: number; qx: number; qy: number }

export class SelfView {
  /** where the hero is drawn this frame (world tiles) */
  x = 0;
  y = 0;
  init = false;
  /** correction still being blended out (drawn minus predicted, tiles) */
  private ox = 0;
  private oy = 0;

  /** New round, teleport, death: draw at the body again, no blend. */
  reset() { this.init = false; this.ox = 0; this.oy = 0; }

  /** A reconciliation moved the predicted body by (dx, dy): keep the hero where it is drawn and blend it out. */
  correct(dx: number, dy: number) {
    if (!this.init || (!dx && !dy)) return;
    this.ox -= dx; this.oy -= dy;
    if (Math.hypot(this.ox, this.oy) > SELF_VIEW.snapTiles) { this.ox = 0; this.oy = 0; }
  }

  /** One rendered frame of the predicted hero: `alpha` = fraction of the next input tick already elapsed. */
  frame(b: TickBody, alpha: number, dtMs: number): Pt {
    const a = Math.max(0, Math.min(1, alpha));
    const tx = b.px + (b.qx - b.px) * a, ty = b.py + (b.qy - b.py) * a;
    if (!this.init) { this.ox = 0; this.oy = 0; this.init = true; }
    else if (this.ox || this.oy) {
      const k = Math.exp(-Math.max(0, dtMs) / SELF_VIEW.blendMs);
      this.ox *= k; this.oy *= k;
      if (Math.hypot(this.ox, this.oy) < 1e-4) { this.ox = 0; this.oy = 0; }
    }
    this.x = tx + this.ox; this.y = ty + this.oy;
    return { x: this.x, y: this.y };
  }

  /** Not predicted (downed, dead, between rounds): drawn exactly where the snapshot has it. */
  place(x: number, y: number) { this.x = x; this.y = y; this.init = true; this.ox = 0; this.oy = 0; }
}

/**
 * Camera scroll (view px, whole pixels) that puts the screen point `focus` (the hero's feet, iso px) at the view
 * centre, `lift` px below it. Rounded exactly like the sprite is placed (Math.round), so the hero never shimmers.
 */
export function lockedScroll(focus: Pt, viewW: number, viewH: number, lift = CAM_LIFT): Pt {
  return { x: Math.round(focus.x) - Math.floor(viewW / 2), y: Math.round(focus.y) - lift - Math.floor(viewH / 2) };
}
