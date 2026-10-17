import { SKILL_BY_ID, TICK_RATE } from '@cursebound/content';
import { LIMITS } from '@cursebound/protocol';
import { ACTION } from '@cursebound/simulation';
import { BODY_RADIUS, circleFree, findPathEx, lineClear, nearestFloorTile, pathLength, pointInTile, type GridMap, type Pt } from './path';
import { engageDecision, shotClear, type GroundKind, type GroundThing, type PickableEnemy, type Reach } from './targeting';

// Diablo-style click-to-move controller. Turns clicks into the existing per-tick intention (world move vector + aim
// offset + ACTION bits) so the authority, prediction and replays are untouched:
//   LMB ground            walk there along a smoothed A* path (marker on the ground)
//   hold LMB              keep walking toward the cursor (straight at it every tick while in view, re-path ~7 Hz)
//                         once the press is held past CLICK.holdMs or dragged; a shorter press is a click and walks to
//                         the clicked point (the camera follows the hero, so the ground under a still pointer slides
//                         along with every step: tracking it from the first frame dragged clicks past their point)
//   LMB foe               attack-move: close to basic-attack reach (and projectile line of sight), then stand and
//                         swing at it until it falls; still holding, take the next foe under the cursor or walk on
//   Shift + LMB           attack in place toward the cursor, never move
//   LMB pickup/loot/door  walk onto it (pickups and loot collect by touch, standing in a door is the vote)
//   skills                aim at the cursor, cast without cancelling the walk (teleports and guards stop it)
//   Space                 dodge toward the cursor
// Phases: COMBAT allows everything, VOTING walking and dodging only (doors), anything else sends neutral input.
// Direct movement (arrow keys, WASD scheme, gamepad stick) always wins and cancels click orders. Pure (time and
// world state come in per frame), so the decision logic is unit tested from tests/. InputTicks (below) is the bridge
// from rendered frames to the authority's 60 Hz input ticks: it re-runs the controller for every tick a frame
// carries, from the predicted body that tick starts at.

export type Scheme = 'click' | 'wasd';

export interface DriveFrame {
  /** ms, monotonic */
  now: number;
  scheme: Scheme;
  /** snapshot phase: COMBAT allows everything, VOTING walking and dodging only, anything else nothing */
  phase: string;
  /** cinematic playing, a modal panel open or no snapshot: neutral input */
  blocked: boolean;
  life: 'alive' | 'downed' | 'dead' | null;
  /** predicted body position */
  self: Pt | null;
  buffs: readonly string[];
  /** chain tether [anchorX, anchorY, radius] while 'chained' */
  tether: readonly [number, number, number] | null;
  /** equipped skill ids in slot order (signature last), '' for empty slots */
  skills: readonly string[];
  map: GridMap | null;
  enemies: readonly PickableEnemy[];
  reach: Reach;
  /** ground point under the pointer (null when the pointer is off the canvas) */
  cursor: Pt | null;
  /** the pointer on screen in view px, independent of the camera (null: no mouse); tells a dragged hold from a click */
  pointer: Pt | null;
  hoverEnemy: PickableEnemy | null;
  hoverGround: GroundThing | null;
  /** move / attack button held, pressed since the previous frame, attack-in-place modifier held */
  primary: boolean;
  primaryEdge: boolean;
  force: boolean;
  /** ACTION bits held from keys / pad (skills, dodge, interact; ATTACK only from the WASD scheme or a pad) */
  buttons: number;
  /** ACTION bits newly pressed since the previous frame */
  pressed: number;
  /** world-plane direct movement from keys or the left stick */
  keyMove: Pt;
  /** world-plane right-stick aim */
  padAim: Pt | null;
  usingPad: boolean;
  assist: { autoAttack: boolean; aimAssist: boolean };
}

export interface DriveOut { mx: number; my: number; ax: number; ay: number; buttons: number }

export type Order =
  | { k: 'walk'; x: number; y: number }
  | { k: 'goto'; x: number; y: number; what: GroundKind }
  | { k: 'attack'; i: number; g: number; x: number; y: number; r: number; engaged: boolean };

/** `ui`: requested by a UI (minimap, door panel) rather than a fresh click on the ground. */
export interface ClickFxEvent { kind: 'move' | 'attack' | 'item'; x: number; y: number; ui?: boolean }

export const SKILL_BITS = ACTION.SKILL1 | ACTION.SKILL2 | ACTION.SKILL3 | ACTION.SIGNATURE;
const SLOT_BITS = [ACTION.SKILL1, ACTION.SKILL2, ACTION.SKILL3];

/** Tunables (tiles / ms). */
export const CLICK = {
  arriveTol: 0.15,
  gotoTol: { pickup: 0.3, loot: 0.35, door: 0.4 } as Record<GroundKind, number>,
  waypointTol: 0.35,
  /** a ground press steers after the cursor (hold to move) once held this long or dragged this far (view px) */
  holdMs: 250,
  dragPx: 6,
  holdRepathMs: 150,
  chaseRepathMs: 220,
  stuckMs: 400,
  stuckProgress: 0.08,
  maxRetries: 3,
  standOnSelf: 0.4,
  giveUpDist: 32,
  jump: 0.9,
};

/** Skills that end a walk when cast: movement skills (teleports) and stances (guards). */
export function skillStopsWalk(skillId: string | undefined): boolean {
  if (!skillId) return false;
  const s = SKILL_BY_ID[skillId];
  if (!s) return false;
  return s.shape.kind === 'teleport' || s.shape.kind === 'guard' || skillId === 'v_guard_stance';
}

const len = (x: number, y: number) => Math.hypot(x, y);

export class ClickMove {
  order: Order | null = null;
  /** remaining waypoints of the current walk (world tiles) */
  path: Pt[] = [];
  /** what holding the move button keeps doing: walk after the cursor, keep attacking, attack in place */
  holdMode: 'walk' | 'attack' | 'force' | null = null;
  /** marker requests for the renderer; the scene drains this every frame */
  fx: ClickFxEvent[] = [];
  private pathGoal: Pt | null = null;
  private pathEnd: Pt | null = null;
  /** the path is one straight leg to the goal in plain view (steer moves its end along with a moving goal) */
  private straight = false;
  private pathAt = -1e9;
  private skipAt = -1e9;
  private progressBest = Infinity;
  private progressAt = 0;
  private retries = 0;
  private stuckAt = -1e9;
  private lastSelf: Pt | null = null;
  private pendingMoveTo: Pt | null = null;
  /** a held ground press that is still a click: when and where (screen) it went down. Null once it steers. */
  private heldClick: { at: number; pointer: Pt | null } | null = null;

  /** Contract: a UI (minimap, door panel) asks the hero to walk to a world point. */
  moveTo(x: number, y: number) {
    if (Number.isFinite(x) && Number.isFinite(y)) this.pendingMoveTo = { x, y };
  }

  cancel() {
    this.order = null;
    this.path = [];
    this.straight = false;
    this.pathGoal = null;
    this.pathEnd = null;
    this.retries = 0;
  }

  /** Locked attack-move target, if any (renderers mark it). */
  get target(): { i: number; g: number } | null {
    return this.order?.k === 'attack' ? { i: this.order.i, g: this.order.g } : null;
  }

  update(f: DriveFrame): DriveOut {
    const neutral: DriveOut = { mx: 0, my: 0, ax: 0, ay: 0, buttons: 0 };
    // COMBAT: everything; VOTING: walk (and dodge) to a door; every other phase (ROUND_SETUP, FATE_COMMIT's
    // walk-through, intermissions) and cinematics / open panels: no input at all
    if (f.blocked || (f.phase !== 'COMBAT' && f.phase !== 'VOTING') || !f.self || f.life !== 'alive') {
      this.cancel();
      this.holdMode = null;
      this.pendingMoveTo = null;
      this.lastSelf = null;
      return neutral;
    }
    const self = f.self;
    const canAct = f.phase === 'COMBAT';            // voting: walk (and dodge) to a door, no attacks or casts
    const click = f.scheme === 'click' && !f.usingPad;

    // dashes, teleports and knockbacks invalidate the path
    if (this.lastSelf && len(self.x - this.lastSelf.x, self.y - this.lastSelf.y) > CLICK.jump) this.invalidate();
    this.lastSelf = { x: self.x, y: self.y };

    if (this.pendingMoveTo) {
      const p = this.pendingMoveTo;
      this.pendingMoveTo = null;
      this.setWalk(f, p.x, p.y, true, true);
      this.holdMode = null;
    }

    const keyMoving = len(f.keyMove.x, f.keyMove.y) > 0.05;
    if (keyMoving) { this.cancel(); this.holdMode = this.holdMode === 'force' ? 'force' : null; }

    if (click) {
      if (f.primaryEdge) this.press(f, canAct);
      if (!f.primary) this.holdMode = null;
      else if (f.force && canAct) this.holdMode = 'force';        // Shift turns any held click into attack-in-place
      if (this.holdMode === 'force' && !canAct) this.holdMode = null;
      if (this.holdMode === 'force') this.cancel();
      else if (this.holdMode === 'attack') this.retarget(f, canAct);
      if (this.holdMode === 'walk' && f.cursor && !keyMoving && this.steering(f)) this.trackCursor(f);
    } else this.holdMode = null;

    if (!canAct && this.order?.k === 'attack') this.cancel();

    let buttons = canAct ? f.buttons : f.buttons & ACTION.DODGE;
    if (canAct && (f.pressed & SKILL_BITS) && this.pressedStopSkill(f)) this.cancel();

    // ---- movement
    let mx = 0, my = 0;
    let aim: Pt | null = null;
    if (keyMoving) { mx = f.keyMove.x; my = f.keyMove.y; }
    else if (this.order) {
      const r = this.execute(f);
      mx = r.mx; my = r.my;
      if (r.attack && canAct) { buttons |= ACTION.ATTACK; aim = r.aim; }
    }
    if (click && this.holdMode === 'force') {
      mx = 0; my = 0;
      buttons |= ACTION.ATTACK;
      aim = this.aimPoint(f) ?? aim;
    }

    // ---- aim
    if (f.usingPad) {
      if (f.padAim) { const l = len(f.padAim.x, f.padAim.y) || 1; aim = { x: (f.padAim.x / l) * 5, y: (f.padAim.y / l) * 5 }; }
      else if (keyMoving) aim = { x: f.keyMove.x * 4, y: f.keyMove.y * 4 };
    } else if (!click) {
      aim = this.aimPoint(f) ?? aim;                                // WASD: the hero faces the cursor
    } else if (canAct && (buttons & SKILL_BITS)) {
      aim = this.aimPoint(f) ?? aim;                                // skills land on the cursor
    } else if (!aim && (mx || my)) {
      const l = len(mx, my) || 1;
      aim = { x: (mx / l) * 2, y: (my / l) * 2 };                   // face where we walk; idle keeps its facing
    }

    // ---- dodge toward the cursor (or along the walk when there is no cursor)
    if (click && (f.pressed & ACTION.DODGE)) {
      if (f.cursor && !keyMoving) {
        const dx = f.cursor.x - self.x, dy = f.cursor.y - self.y, d = len(dx, dy);
        if (d > 0.1) { mx = dx / d; my = dy / d; }
      }
      if (!f.primary) this.cancel();                                // a dash is a deliberate reposition
    }

    // ---- casual assists (Settings > Assistance)
    if (canAct && (f.assist.autoAttack || f.assist.aimAssist)) {
      let best: PickableEnemy | null = null, bd = 64;
      for (const e of f.enemies) {
        if (e.st === 'dying') continue;
        const d = (e.x - self.x) ** 2 + (e.y - self.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const off = { x: best.x - self.x, y: best.y - self.y };
        if (!click) {
          if (f.assist.aimAssist || (f.assist.autoAttack && !(buttons & ACTION.ATTACK))) aim = off;
          if (f.assist.autoAttack) buttons |= ACTION.ATTACK;
        } else {
          const idle = !this.order && !this.holdMode && !keyMoving;
          if (f.assist.autoAttack && idle) { buttons |= ACTION.ATTACK; aim = off; }
          else if (f.assist.aimAssist && this.order?.k !== 'attack' && (buttons & (ACTION.ATTACK | SKILL_BITS))) aim = off;
        }
      }
    }

    if (!canAct) buttons &= ACTION.DODGE;
    const ax = aim ? Math.max(-64, Math.min(64, aim.x)) : 0, ay = aim ? Math.max(-64, Math.min(64, aim.y)) : 0;
    return { mx, my, ax, ay, buttons };
  }

  // ---------------- orders ----------------

  private press(f: DriveFrame, canAct: boolean) {
    if (f.force && canAct) { this.cancel(); this.holdMode = 'force'; return; }
    const e = canAct ? f.hoverEnemy : null;
    if (e) {
      this.setAttack(e);
      this.holdMode = 'attack';
      this.fx.push({ kind: 'attack', x: e.x, y: e.y });
      return;
    }
    const g = f.hoverGround;
    if (g) {
      this.cancel();
      this.order = { k: 'goto', x: g.x, y: g.y, what: g.kind };
      this.holdMode = null;
      this.fx.push({ kind: 'item', x: g.x, y: g.y });
      return;
    }
    if (f.cursor) {
      this.setWalk(f, f.cursor.x, f.cursor.y, true);
      this.holdMode = 'walk';
      this.heldClick = { at: f.now, pointer: f.pointer };
    }
  }

  private setAttack(e: PickableEnemy) {
    this.cancel();
    this.order = { k: 'attack', i: e.i, g: e.g, x: e.x, y: e.y, r: e.r, engaged: false };
  }

  private setWalk(f: DriveFrame, x: number, y: number, marker: boolean, ui = false) {
    const p = this.clampGoal(f, { x, y });
    this.cancel();
    this.order = { k: 'walk', x: p.x, y: p.y };
    if (marker) {
      let m = p;
      if (f.map) { const ti = nearestFloorTile(f.map, p.x, p.y); if (ti >= 0) m = pointInTile(f.map, ti, p.x, p.y); }
      this.fx.push({ kind: 'move', x: m.x, y: m.y, ui });
    }
  }

  /**
   * Does a held ground press steer after the cursor yet? Only once it is held past CLICK.holdMs, dragged on screen
   * or the hero has reached the clicked point; until then it is a click and the walk keeps the clicked point. The
   * play camera is locked on the hero, so the ground under a pointer resting on screen slides along with every step:
   * following it from the first frame moved a click's goal on by however far the hero walked while the button was
   * down. The drag test uses the screen pointer, which the camera does not move.
   */
  private steering(f: DriveFrame): boolean {
    const c = this.heldClick;
    if (!c) return true;
    const dragged = !!(f.pointer && c.pointer && len(f.pointer.x - c.pointer.x, f.pointer.y - c.pointer.y) > CLICK.dragPx);
    const o = this.order;
    const reached = o?.k === 'walk' && !!f.self && len(o.x - f.self.x, o.y - f.self.y) < CLICK.standOnSelf;
    if (f.now - c.at < CLICK.holdMs && !dragged && !reached) return false;
    this.heldClick = null;
    return true;
  }

  /** Holding the move button on the ground: the walk goal follows the cursor. */
  private trackCursor(f: DriveFrame) {
    const self = f.self!;
    const c = this.clampGoal(f, f.cursor!);
    if (len(c.x - self.x, c.y - self.y) < CLICK.standOnSelf) {
      // cursor on the hero: stand still instead of jittering around the feet
      if (this.order?.k === 'walk') { this.order = null; this.path = []; this.pathGoal = null; this.pathEnd = null; }
      return;
    }
    if (this.order?.k === 'walk') { this.order.x = c.x; this.order.y = c.y; }
    else { this.cancel(); this.order = { k: 'walk', x: c.x, y: c.y }; }
  }

  /** Holding after an attack-move: when the target falls, take the next foe under the cursor or walk on. */
  private retarget(f: DriveFrame, canAct: boolean) {
    const o = this.order;
    if (o?.k === 'attack' && f.enemies.some((e) => e.i === o.i && e.g === o.g && e.st !== 'dying')) return;
    const e = canAct ? f.hoverEnemy : null;
    if (e) { this.setAttack(e); return; }
    this.holdMode = 'walk';
    this.heldClick = null;   // held all along: walk after the cursor straight away
  }

  private pressedStopSkill(f: DriveFrame): boolean {
    const n = f.skills.length;
    for (let i = 0; i < n; i++) {
      const bit = i === n - 1 ? ACTION.SIGNATURE : SLOT_BITS[i];
      if (bit && (f.pressed & bit) && skillStopsWalk(f.skills[i])) return true;
    }
    return false;
  }

  /** Chain tether: never ask for a goal outside the leash (the sim would just hold us at its edge). */
  private clampGoal(f: DriveFrame, p: Pt): Pt {
    let { x, y } = p;
    if (f.tether && f.buffs.includes('chained')) {
      const [ax, ay, r] = f.tether;
      const d = len(x - ax, y - ay), lim = Math.max(0.2, r - 0.3);
      if (d > lim) { x = ax + ((x - ax) / d) * lim; y = ay + ((y - ay) / d) * lim; }
    }
    if (f.map) { x = Math.max(0.05, Math.min(f.map.w - 0.05, x)); y = Math.max(0.05, Math.min(f.map.h - 0.05, y)); }
    return { x, y };
  }

  private aimPoint(f: DriveFrame): Pt | null {
    const t = f.hoverEnemy ?? f.cursor;
    if (!t || !f.self) return null;
    return { x: t.x - f.self.x, y: t.y - f.self.y };
  }

  private execute(f: DriveFrame): { mx: number; my: number; attack: boolean; aim: Pt | null } {
    const o = this.order!;
    const self = f.self!;
    const none = { mx: 0, my: 0, attack: false, aim: null };
    if (o.k === 'attack') {
      const e = f.enemies.find((x) => x.i === o.i && x.g === o.g);
      if (!e || e.st === 'dying') { this.cancel(); return none; }    // target down
      o.x = e.x; o.y = e.y; o.r = e.r;
      const d = len(e.x - self.x, e.y - self.y);
      if (d > CLICK.giveUpDist) { this.cancel(); return none; }
      const los = !f.reach.ranged || shotClear(f.map, self, e);
      if (engageDecision({ self, target: e, reach: f.reach, engaged: o.engaged, los }) === 'attack') {
        o.engaged = true;
        this.path = [];
        this.pathGoal = null;
        return { mx: 0, my: 0, attack: true, aim: { x: e.x - self.x, y: e.y - self.y } };
      }
      o.engaged = false;
      const m = this.steer(f, { x: e.x, y: e.y }, 0.05, CLICK.chaseRepathMs, 0.5);
      if (m.gaveUp) this.cancel();
      return { mx: m.mx, my: m.my, attack: false, aim: null };
    }
    const tol = o.k === 'goto' ? CLICK.gotoTol[o.what] : CLICK.arriveTol;
    const holding = o.k === 'walk' && this.holdMode === 'walk';
    const m = this.steer(f, { x: o.x, y: o.y }, tol, holding ? CLICK.holdRepathMs : 1e9, 0.25);
    if (!holding && (m.arrived || m.failed || m.gaveUp)) this.cancel();
    return { mx: m.mx, my: m.my, attack: false, aim: null };
  }

  /**
   * Follow (and when needed rebuild) the path to `goal`. `arrived`: within `tol`; `failed`: standing at the closest
   * reachable point (no route closer); `gaveUp`: stuck re-paths exhausted.
   */
  private steer(f: DriveFrame, goal: Pt, tol: number, repathMs: number, drift: number): { mx: number; my: number; arrived: boolean; failed: boolean; gaveUp: boolean } {
    const self = f.self!;
    const now = f.now;
    const stop = (arrived: boolean, failed: boolean, gaveUp = false) => ({ mx: 0, my: 0, arrived, failed, gaveUp });
    if (len(goal.x - self.x, goal.y - self.y) <= tol) { this.path = []; return stop(true, false); }
    let moved = this.pathGoal ? len(this.pathGoal.x - goal.x, this.pathGoal.y - goal.y) : Infinity;
    // A moving goal (the held cursor, a chased foe) still in plain view: the straight leg ends at the goal every tick.
    // Re-pathing only every repathMs / drift steered at a goal up to that old (the heading stepped ~7 times a second
    // while sweeping the cursor) and stood the hero still whenever it reached the stale goal first.
    if (this.straight && this.path.length <= 1 && moved > 1e-3 && Number.isFinite(moved)
      && (!f.map || (circleFree(f.map, goal.x, goal.y, BODY_RADIUS) && lineClear(f.map, self.x, self.y, goal.x, goal.y)))) {
      this.path = [{ x: goal.x, y: goal.y }];
      this.pathEnd = { x: goal.x, y: goal.y };
      if (moved > drift) {
        // as far as a re-path would have taken it: a new destination for the stuck clock
        this.pathGoal = { x: goal.x, y: goal.y };
        this.progressBest = Infinity;
        this.progressAt = now;
      }
      moved = 0;
    }
    const stale = !this.pathGoal
      || (moved > drift && now - this.pathAt >= repathMs)
      || (!this.path.length && moved > 1e-3 && now - this.pathAt >= 100);
    if (stale) this.repath(f, goal);
    // frozen / rooted: hold the order, do not fight the status, do not count it as being stuck
    if (f.buffs.includes('frozen') || f.buffs.includes('rooted')) { this.progressAt = now; return stop(false, false); }
    if (!this.path.length) return stop(false, !this.pathEnd || len(this.pathEnd.x - goal.x, this.pathEnd.y - goal.y) > tol);
    while (this.path.length > 1 && len(this.path[0].x - self.x, this.path[0].y - self.y) < CLICK.waypointTol) this.path.shift();
    // opportunistic smoothing: drop a corner as soon as the next waypoint is in view
    if (f.map && this.path.length > 1 && now - this.skipAt > 90) {
      this.skipAt = now;
      if (lineClear(f.map, self.x, self.y, this.path[1].x, this.path[1].y)) this.path.shift();
    }
    const wp = this.path[0];
    const dx = wp.x - self.x, dy = wp.y - self.y, d = len(dx, dy);
    const last = this.path.length === 1;
    if (last && d <= Math.max(tol, 0.1)) { this.path = []; return stop(len(wp.x - goal.x, wp.y - goal.y) <= tol, false); }
    // stuck: no progress along the path for a while → re-path around crowds, give up after a few tries
    const remaining = pathLength(self.x, self.y, this.path);
    if (remaining < this.progressBest - CLICK.stuckProgress) {
      this.progressBest = remaining;
      this.progressAt = now;
      if (now - this.stuckAt > 1500) this.retries = 0;
    } else if (now - this.progressAt > CLICK.stuckMs) {
      this.retries++;
      this.stuckAt = now;
      if (this.retries > CLICK.maxRetries) { this.path = []; this.pathEnd = null; return stop(false, true, true); }
      this.repath(f, goal);
      if (!this.path.length) return stop(false, true);
    }
    const mag = last ? Math.min(1, Math.max(0.4, d / 0.3)) : 1;     // ease into the last few pixels, no overshoot
    return { mx: (dx / d) * mag, my: (dy / d) * mag, arrived: false, failed: false, gaveUp: false };
  }

  private repath(f: DriveFrame, goal: Pt) {
    const self = f.self!;
    // a genuinely new destination earns a fresh set of stuck retries
    if (!this.pathGoal || len(this.pathGoal.x - goal.x, this.pathGoal.y - goal.y) > 1) this.retries = 0;
    this.pathGoal = { x: goal.x, y: goal.y };
    this.pathAt = f.now;
    this.progressBest = Infinity;
    this.progressAt = f.now;
    const map = f.map;
    this.straight = true;
    if (!map) { this.path = [{ ...goal }]; this.pathEnd = { ...goal }; return; }
    // in plain view: walk straight (no A*, no jitter while the cursor drags the goal around)
    if (this.retries === 0 && circleFree(map, goal.x, goal.y, 0.3) && lineClear(map, self.x, self.y, goal.x, goal.y)) {
      this.path = [{ ...goal }];
      this.pathEnd = { ...goal };
      return;
    }
    this.straight = false;
    const crowd = this.retries > 0 ? crowdCost(f, goal) : undefined;
    const res = findPathEx(map, self.x, self.y, goal.x, goal.y, { cost: crowd });
    this.path = res.points;
    this.pathEnd = res.goal;
  }

  private invalidate() {
    this.path = [];
    this.straight = false;
    this.pathGoal = null;
    this.pathEnd = null;
    this.progressBest = Infinity;
  }
}

/** ms per authority input tick */
export const TICK_MS = 1000 / TICK_RATE;
/** the most input ticks one frame sends: a longer stall's older ticks are dropped (the authority holds no more) */
export const LATE_TICKS = LIMITS.lateTicks;

/**
 * Rendered frames to the authority's 60 Hz input ticks (CombatScene.sendInputs). Per frame:
 *  - how many ticks the frame carries, on the real clock (Phaser's smoothed delta spread a stall over the next ten
 *    frames). A stalled frame sends the stall's ticks, up to LATE_TICKS: the authority held our last input through
 *    the gap and takes the late inputs as done by those held ticks (authority.ts submitInput), so they neither move
 *    the hero twice nor queue up as lag. Sending only the frame's own tick left the prediction short of every tick
 *    the authority held, and each stall came back as a forward correction.
 *  - the controller runs once per frame (clicks, hover, markers) and again for every further tick, from the
 *    predicted body that tick starts at: several ticks on one steer walked past the goal on slow frames.
 *  - fresh presses of a frame that carries no tick (refresh rates above 60 Hz) ride on the next one that does, so
 *    a dodge still goes toward the cursor it was pressed at.
 */
export class InputTicks {
  private acc = 0;
  private last: number | null = null;
  private carry = 0;

  /** How far the clock is into the next input tick (0..1): the scene draws the hero that far along the latest one. */
  get alpha(): number { return Math.max(0, Math.min(1, this.acc / TICK_MS)); }

  /** `send` applies one tick's intention (sends it, predicts it) and returns the predicted body after it, or null. */
  run(now: number, cm: ClickMove, f: DriveFrame, send: (out: DriveOut) => Pt | null): number {
    const dt = this.last === null ? TICK_MS : Math.max(0, now - this.last);
    this.last = now;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= TICK_MS - 1e-3) { this.acc -= TICK_MS; ticks++; }   // (a frame of exactly one tick is one tick)
    if (ticks > LATE_TICKS) ticks = LATE_TICKS;
    const frame = this.carry ? { ...f, buttons: f.buttons | this.carry, pressed: f.pressed | this.carry } : f;
    this.carry = ticks ? 0 : frame.pressed;
    let out = cm.update(frame);
    for (let i = 0; i < ticks; i++) {
      const self = send(out);
      if (i + 1 < ticks) out = cm.update({ ...frame, self: self ?? frame.self, primaryEdge: false, pressed: 0 });
    }
    return ticks;
  }
}

/** Extra A* cost for tiles crowded by foes (other than the one we chase), so a re-path walks around a blocking pack. */
function crowdCost(f: DriveFrame, goal: Pt): ((tx: number, ty: number) => number) | undefined {
  const bodies = f.enemies.filter((e) => e.st !== 'dying' && len(e.x - goal.x, e.y - goal.y) > 0.6);
  if (!bodies.length) return undefined;
  const occ = new Map<number, number>();
  const w = f.map!.w;
  for (const e of bodies) {
    const r = Math.min(1.5, e.r + 0.3);
    for (let ty = Math.floor(e.y - r); ty <= Math.floor(e.y + r); ty++) {
      for (let tx = Math.floor(e.x - r); tx <= Math.floor(e.x + r); tx++) {
        const k = ty * w + tx;
        occ.set(k, (occ.get(k) ?? 0) + 4);
      }
    }
  }
  return (tx, ty) => occ.get(ty * w + tx) ?? 0;
}
