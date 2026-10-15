import { describe, expect, it } from 'vitest';
import { CAM, CameraRig, clampToMap, edgePanVelocity, type RigFrame } from '../apps/client/src/game/cameraRig';
import { ACTION_IDS, DEFAULT_SETTINGS, KEYS_CLICK, KEYS_WASD, normalizeSettings } from '../apps/client/src/lib/settings';

// League of Legends-style camera: unlocked by default (stays where you leave it), edge panning and middle-drag,
// a lock that follows the hero, held Center / F-keys, pad play always locked, spectating follows the watched
// teammate until you pan, a new round cuts to the hero, a respawn eases back, and the centre stays on the map.

const frame = (o: Partial<RigFrame> = {}): RigFrame => ({
  dt: 1 / 60, follow: { x: 0, y: 0 }, subject: 'p0', spectating: false, locked: false, forceFollow: false,
  hold: null, pan: { x: 0, y: 0 }, snap: 'none', cine: null, reduced: false, map: null, ...o,
});
/** run `n` frames with the same intent */
const run = (rig: CameraRig, n: number, o: Partial<RigFrame>) => { for (let i = 0; i < n; i++) rig.step(frame(o)); return rig.pos!; };

describe('edge pan velocity', () => {
  it('is zero away from the edges and inside the margin it pans toward that edge', () => {
    expect(edgePanVelocity(640, 360, 1280, 720)).toEqual({ x: 0, y: 0 });
    expect(edgePanVelocity(0, 360, 1280, 720, 6, 100)).toEqual({ x: -100, y: 0 });
    expect(edgePanVelocity(1279, 360, 1280, 720, 6, 100)).toEqual({ x: 100, y: 0 });
    expect(edgePanVelocity(640, 3, 1280, 720, 6, 100)).toEqual({ x: 0, y: -100 });
    expect(edgePanVelocity(640, 719, 1280, 720, 6, 100)).toEqual({ x: 0, y: 100 });
    expect(edgePanVelocity(7, 360, 1280, 720, 6, 100)).toEqual({ x: 0, y: 0 });   // just outside the margin
  });

  it('pans diagonally in corners at the same speed and respects the speed setting', () => {
    const v = edgePanVelocity(0, 0, 1280, 720, 6, 100);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(100);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeLessThan(0);
    expect(edgePanVelocity(0, 360, 1280, 720, 6, 0)).toEqual({ x: 0, y: 0 });
    expect(edgePanVelocity(0, 360, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(edgePanVelocity(0, 360, 1280, 720).x).toBe(-CAM.edgeSpeed);
  });
});

describe('map clamp', () => {
  it('leaves a point on the floor alone and pulls a point in the void back onto the padded diamond', () => {
    const map = { w: 40, h: 30 };
    const inside = { x: 32 * (10 - 10), y: 16 * (10 + 10) };   // world (10, 10)
    expect(clampToMap(inside, map)).toBe(inside);
    // world (100, 10) -> x clamps to w + pad
    const far = { x: 32 * (100 - 10), y: 16 * (100 + 10) };
    const c = clampToMap(far, map, 1.5);
    expect(c.x).toBeCloseTo(32 * (41.5 - 10));
    expect(c.y).toBeCloseTo(16 * (41.5 + 10));
    // world (-20, -20) -> (-pad, -pad)
    const c2 = clampToMap({ x: 0, y: 16 * -40 }, map, 1);
    expect(c2).toEqual({ x: 0, y: 16 * -2 });
  });

  it('keeps a panning camera on the map', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    const p = run(rig, 600, { pan: { x: 50, y: 0 }, map: { w: 20, h: 20 } });
    const a = p.x / 32, b = p.y / 16;
    expect((a + b) / 2).toBeLessThanOrEqual(20 + CAM.boundsPad + 1e-6);
    expect((b - a) / 2).toBeGreaterThanOrEqual(-CAM.boundsPad - 1e-6);
  });
});

describe('camera rig', () => {
  it('starts on the hero, then (unlocked) stays where you leave it while the hero walks away', () => {
    const rig = new CameraRig();
    expect(rig.step(frame({ follow: null }))).toBeNull();
    expect(rig.step(frame({ follow: { x: 10, y: 20 } }))).toEqual({ x: 10, y: 20 });
    expect(run(rig, 60, { follow: { x: 500, y: 300 } })).toEqual({ x: 10, y: 20 });
  });

  it('pans with edge / drag input when unlocked', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    expect(run(rig, 10, { pan: { x: 3, y: -2 } })).toEqual({ x: 30, y: -20 });
  });

  it('locked follows the hero and ignores panning', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    const p = run(rig, 120, { locked: true, follow: { x: 200, y: 100 }, pan: { x: 40, y: 0 } });
    expect(p.x).toBeCloseTo(200, 0);
    expect(p.y).toBeCloseTo(100, 0);
    // reduced motion follows without easing
    expect(rig.step(frame({ locked: true, reduced: true, follow: { x: 7, y: 9 } }))).toEqual({ x: 7, y: 9 });
  });

  it('a held Center key follows the hero while held; on release the unlocked camera stays put', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    run(rig, 10, { pan: { x: 30, y: 0 } });
    const held = run(rig, 30, { hold: { x: 0, y: 0 }, pan: { x: 30, y: 0 } });
    expect(held.x).toBeCloseTo(0, 3);
    expect(run(rig, 30, { follow: { x: 999, y: 999 } }).x).toBeCloseTo(0, 3);
  });

  it('controller play is always a locked follow', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    const p = run(rig, 120, { forceFollow: true, follow: { x: -80, y: 40 }, pan: { x: 10, y: 10 } });
    expect(p.x).toBeCloseTo(-80, 0);
    expect(p.y).toBeCloseTo(40, 0);
  });

  it('a new round cuts to the hero; a respawn eases back and then the camera is free again', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    run(rig, 20, { pan: { x: 20, y: 0 } });
    expect(rig.step(frame({ snap: 'cut', follow: { x: 5, y: 6 } }))).toEqual({ x: 5, y: 6 });
    run(rig, 20, { pan: { x: 20, y: 0 } });
    rig.step(frame({ snap: 'ease', follow: { x: 0, y: 0 } }));
    expect(rig.returning).toBe(true);
    const back = run(rig, 200, { follow: { x: 0, y: 0 } });
    expect(Math.hypot(back.x, back.y)).toBeLessThanOrEqual(CAM.arrivePx);
    expect(rig.returning).toBe(false);
    // arrived: free again, the hero walking off no longer drags the camera
    expect(run(rig, 30, { follow: { x: 400, y: 0 } }).x).toBeLessThan(2);
  });

  it('panning during an ease-back cancels it', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    run(rig, 20, { pan: { x: 20, y: 0 } });
    rig.step(frame({ snap: 'ease' }));
    rig.step(frame({ pan: { x: 1, y: 0 } }));
    expect(rig.returning).toBe(false);
  });

  it('spectating follows the watched teammate until you pan; cycling or Center follows again', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    // fallen: now watching p1 at (300, 0)
    const watch = { spectating: true, subject: 'p1', follow: { x: 300, y: 0 } };
    expect(run(rig, 200, watch).x).toBeCloseTo(300, 0);
    run(rig, 5, { ...watch, pan: { x: -10, y: 0 } });
    expect(rig.spectFree).toBe(true);
    const still = rig.pos!.x;
    expect(run(rig, 30, { ...watch, follow: { x: 500, y: 0 } }).x).toBe(still);
    // cycling to p2 follows again
    expect(run(rig, 200, { ...watch, subject: 'p2', follow: { x: -100, y: 0 } }).x).toBeCloseTo(-100, 0);
    // pan away, then Center (hold on the watched teammate) re-follows
    run(rig, 5, { ...watch, subject: 'p2', follow: { x: -100, y: 0 }, pan: { x: 10, y: 0 } });
    rig.step(frame({ ...watch, subject: 'p2', follow: { x: -100, y: 0 }, hold: { x: -100, y: 0 } }));
    expect(rig.spectFree).toBe(false);
  });

  it('coming back from spectating eases back to your own hero', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    run(rig, 100, { spectating: true, subject: 'p1', follow: { x: 300, y: 0 } });
    rig.step(frame({ subject: 'p0', follow: { x: 0, y: 0 } }));
    expect(rig.returning).toBe(true);
    expect(run(rig, 200, { follow: { x: 0, y: 0 } }).x).toBeLessThanOrEqual(CAM.arrivePx);
  });

  it('a cutscene owns the camera and play resumes from where it ended', () => {
    const rig = new CameraRig();
    run(rig, 1, {});
    expect(rig.step(frame({ cine: { x: 77, y: 88 } }))).toEqual({ x: 77, y: 88 });
    expect(run(rig, 10, { follow: { x: 0, y: 0 } })).toEqual({ x: 77, y: 88 });
  });
});

describe('camera settings and keys', () => {
  it('defaults to an unlocked camera with edge panning, Y to lock, C to centre, F1-F5 for the party', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ camLocked: false, edgePan: true, edgePanSpeed: 1 });
    for (const keys of [KEYS_CLICK, KEYS_WASD]) {
      expect(keys).toMatchObject({ cameraLock: ['KeyY'], cameraCenter: ['KeyC'], cameraSelf: ['F1'], cameraAlly1: ['F2'], cameraAlly4: ['F5'] });
      // one key, one job in both layouts (Space stays Dodge)
      const all = ACTION_IDS.flatMap((a) => keys[a]);
      expect(new Set(all).size).toBe(all.length);
      expect(keys.dodge).toEqual(['Space']);
    }
  });

  it('gives older saves the camera keys without stealing a key the player already uses', () => {
    const keys = { ...KEYS_CLICK } as Record<string, string[]>;
    for (const a of ['cameraLock', 'cameraCenter', 'cameraSelf', 'cameraAlly1', 'cameraAlly2', 'cameraAlly3', 'cameraAlly4']) delete keys[a];
    keys.interact = ['KeyC'];
    const { s } = normalizeSettings({ controlsRev: 99, keys } as never);
    expect(s.keys.interact).toEqual(['KeyC']);
    expect(s.keys.cameraCenter).toEqual([]);
    expect(s.keys.cameraLock).toEqual(['KeyY']);
    expect(s.camLocked).toBe(false);
  });

  it('repairs an out-of-range edge pan speed', () => {
    expect(normalizeSettings({ controlsRev: 99, edgePanSpeed: 9 }).s.edgePanSpeed).toBe(1);
    expect(normalizeSettings({ controlsRev: 99, edgePanSpeed: 1.5 }).s.edgePanSpeed).toBe(1.5);
  });
});
