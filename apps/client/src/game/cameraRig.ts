import { HH, HW } from './render/iso';

// League of Legends-style play camera (pure: no Phaser, no DOM; CombatScene feeds it one frame of intent and applies
// the returned centre). Points are ground points in screen (iso) pixels: the spot on the floor the view centres on.
//   - Unlocked (the default): the camera stays where you leave it. Moving the pointer to the window edge pans
//     (edgePanVelocity), dragging with the middle mouse button pans.
//   - Locked: follows the hero exactly like the old Diablo camera (smoothed, with a slight aim look-ahead).
//   - Held keys (Center camera, F1 / F2-F5) follow their subject while held, locked or not; on release an unlocked
//     camera stays where it is.
//   - A controller always plays with a locked follow camera.
//   - Spectating (fallen for the round): follows the watched teammate until you pan; cycling teammates, pressing
//     Center or locking follows again.
//   - New round: cuts to the hero. Respawn / revive: eases back to the hero, then stays free.
//   - A cutscene owns the camera; the rig tracks it so play resumes from where the scene ended (on the hero).
//   - The centre is clamped to the map's floor diamond (plus a small margin), so panning never drifts into the void.

export interface Pt { x: number; y: number }

export const CAM = {
  /** CSS px from the window edge where edge panning starts (small, like LoL) */
  edgeMargin: 6,
  /** view px per second at edge-pan speed 1 (a 640 px wide view crosses in under a second) */
  edgeSpeed: 720,
  /** follow smoothing time constant in ms (the old camera's feel) */
  followMs: 110,
  /** hold-to-centre / F-key smoothing in ms (near-instant, like LoL's Space) */
  holdMs: 45,
  /** tiles past the map edge the centre may reach */
  boundsPad: 1.5,
  /** an ease-back counts as arrived within this many px */
  arrivePx: 1,
} as const;

/**
 * Edge-pan velocity (view px / s) for a pointer at (px, py) in a w x h window (CSS px). Inside the margin on a side
 * the camera pans that way; corners pan diagonally at the same speed. Zero anywhere else.
 */
export function edgePanVelocity(px: number, py: number, w: number, h: number, margin: number = CAM.edgeMargin, speed: number = CAM.edgeSpeed): Pt {
  if (!(w > 0 && h > 0) || speed <= 0) return { x: 0, y: 0 };
  const dx = px <= margin ? -1 : px >= w - 1 - margin ? 1 : 0;
  const dy = py <= margin ? -1 : py >= h - 1 - margin ? 1 : 0;
  if (!dx && !dy) return { x: 0, y: 0 };
  const l = Math.hypot(dx, dy);
  return { x: (dx / l) * speed, y: (dy / l) * speed };
}

/** Clamp a ground point (screen px) so its world position stays on a w x h map, padded by `pad` tiles. */
export function clampToMap(p: Pt, map: { w: number; h: number }, pad: number = CAM.boundsPad): Pt {
  // inverse 2:1 projection (render/iso.ts): screen (x, y) -> world (wx, wy)
  const a = p.x / HW, b = p.y / HH;
  const wx = (a + b) / 2, wy = (b - a) / 2;
  const cx = Math.min(map.w + pad, Math.max(-pad, wx));
  const cy = Math.min(map.h + pad, Math.max(-pad, wy));
  if (cx === wx && cy === wy) return p;
  return { x: (cx - cy) * HW, y: (cx + cy) * HH };
}

/** One frame of camera intent. */
export interface RigFrame {
  /** seconds since the last frame */
  dt: number;
  /** what a locked camera follows: the hero (with aim look-ahead), or the watched teammate while spectating */
  follow: Pt | null;
  /** identity of the follow subject ('p0', 'p2'…): a change (death, cycling teammates, revival) re-follows */
  subject: string | null;
  /** you have fallen for the round and watch a teammate */
  spectating: boolean;
  /** camera lock setting */
  locked: boolean;
  /** controller play: always a locked follow */
  forceFollow: boolean;
  /** a held Center / F-key: follow this point while held, whatever the lock */
  hold: Pt | null;
  /** manual pan this frame in view px (edge velocity x dt plus middle-mouse drag); ignored while following */
  pan: Pt;
  /** 'cut' jumps to the follow point (new round), 'ease' glides back to it (respawn) */
  snap: 'none' | 'cut' | 'ease';
  /** a cutscene drives the camera at this ground point (the rig only tracks it) */
  cine: Pt | null;
  /** reduced motion: no easing */
  reduced: boolean;
  /** map size in tiles, for clamping (null: unclamped) */
  map: { w: number; h: number } | null;
}

export class CameraRig {
  /** current ground point at the view centre (null until the first frame with a subject) */
  pos: Pt | null = null;
  /** gliding back to the follow point after a respawn */
  returning = false;
  /** spectating but panned away from the watched teammate */
  spectFree = false;
  private subject: string | null = null;

  /** True while the camera is glued to its subject (locked, held, pad, spectating, easing back). */
  following(f: Pick<RigFrame, 'locked' | 'forceFollow' | 'hold' | 'spectating'>): boolean {
    return !!f.hold || f.locked || f.forceFollow || (f.spectating && !this.spectFree) || this.returning;
  }

  step(f: RigFrame): Pt | null {
    if (f.cine) {
      this.pos = { x: f.cine.x, y: f.cine.y };
      this.returning = false;
      return this.pos;
    }
    if (f.subject !== this.subject) {
      // died (now watching a teammate), cycled teammates, or came back: follow the new subject again
      if (this.subject !== null) { this.spectFree = false; if (!f.spectating) this.returning = true; }
      this.subject = f.subject;
    }
    if (!this.pos) {
      if (!f.follow) return null;
      this.pos = { x: f.follow.x, y: f.follow.y };
    }
    if (f.snap === 'cut' && f.follow) { this.pos = { x: f.follow.x, y: f.follow.y }; this.returning = false; this.spectFree = false; }
    else if (f.snap === 'ease') { this.returning = true; this.spectFree = false; }
    if (f.hold) { this.returning = false; this.spectFree = false; }
    const glued = !!f.hold || f.locked || f.forceFollow;
    const panning = f.pan.x !== 0 || f.pan.y !== 0;
    // a manual pan breaks a spectate follow or an ease-back (never a lock, a held key or pad play)
    if (panning && !glued) { if (f.spectating) this.spectFree = true; this.returning = false; }
    const target = f.hold ?? (this.following(f) ? f.follow : null);
    if (target) {
      const k = f.reduced ? 1 : Math.min(1, (f.dt * 1000) / (f.hold ? CAM.holdMs : CAM.followMs));
      this.pos = { x: this.pos.x + (target.x - this.pos.x) * k, y: this.pos.y + (target.y - this.pos.y) * k };
      if (this.returning && Math.hypot(target.x - this.pos.x, target.y - this.pos.y) <= CAM.arrivePx) this.returning = false;
    } else if (panning) {
      this.pos = { x: this.pos.x + f.pan.x, y: this.pos.y + f.pan.y };
    }
    if (f.map) this.pos = clampToMap(this.pos, f.map);
    return this.pos;
  }
}
