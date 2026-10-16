import { describe, expect, it } from 'vitest';
import { CLASSES, classUnlockLevel } from '@cursebound/content';
import {
  LINEUP, PARTY, announceText, arcPositions, fitStage, lineupBaseline, lineupNeeds, lockInfo, partyOrder, stepIndex,
} from '../apps/client/src/game/vessel/layout';
import { FLAVOR, VESSEL_CLASSES, flavorOf, isVesselClass } from '../apps/client/src/game/vessel/palette';
import { fxFrames, heroArt } from '../apps/client/src/game/vessel/sprites';
import { VesselRenderer } from '../apps/client/src/game/vessel/renderer';
import { HERO_ACTOR_IDS } from '../apps/client/src/game/art/actors';
import { SFX_IDS, vesselPickSfx } from '../apps/client/src/game/audio/sfx';

// Vessel Select (ui/VesselSelect.tsx): the lineup layout and selection maths, lock text, party seating, the per-class
// flavour and stings, and a smoke run of the software stage renderer (selection, locked silhouettes, the confirm
// flourish and its skip).

describe('selection and layout', () => {
  it('steps around the lineup in both directions', () => {
    expect(stepIndex(0, 1, 10)).toBe(1);
    expect(stepIndex(9, 1, 10)).toBe(0);
    expect(stepIndex(0, -1, 10)).toBe(9);
    expect(stepIndex(3, -14, 10)).toBe(9);
    expect(stepIndex(5, 0, 10)).toBe(5);
    expect(stepIndex(2, 1, 0)).toBe(0);
  });

  it('stands the lineup in a shallow arc: centre front, ends a step back, evenly spaced, symmetric', () => {
    const p = arcPositions(10, 200, 150, LINEUP);
    expect(p).toHaveLength(10);
    for (let i = 1; i < 10; i++) expect(p[i]!.x - p[i - 1]!.x).toBeCloseTo(LINEUP.spacing, 0);
    expect(p[0]!.y).toBe(150 - LINEUP.arc);
    expect(p[9]!.y).toBe(150 - LINEUP.arc);
    expect(Math.max(...p.map((q) => q.y))).toBeLessThanOrEqual(150);
    for (let i = 0; i < 5; i++) { expect(p[i]!.y).toBe(p[9 - i]!.y); expect(p[i]!.depth).toBeCloseTo(p[9 - i]!.depth, 6); }
    expect(p[0]!.depth).toBe(1);
    expect(arcPositions(1, 50, 80, PARTY)).toEqual([{ x: 50, y: 80, depth: 0 }]);
  });

  it('picks the largest whole-pixel zoom that fits the lineup in the free band', () => {
    const need = lineupNeeds(10, LINEUP);
    const f720 = fitStage({ devW: 1280, devH: 720, insetTop: 72, insetBottom: 200, need });
    expect(f720.zoom).toBe(3);
    expect(f720.w).toBe(427);
    expect(f720.h).toBe(240);
    expect(f720.w).toBeGreaterThanOrEqual(need.w);
    // the same window on a 2x display renders the same art at twice the device pixels
    const hidpi = fitStage({ devW: 2560, devH: 1440, insetTop: 144, insetBottom: 400, need });
    expect(hidpi.zoom).toBe(6);
    expect(hidpi.w).toBe(427);
    expect(fitStage({ devW: 1920, devH: 1080, insetTop: 72, insetBottom: 200, need }).zoom).toBe(4);
    // a cramped window still renders (zoom 1), never zero
    const tiny = fitStage({ devW: 300, devH: 120, need });
    expect(tiny.zoom).toBe(1);
    expect(tiny.w).toBe(300);
    // the baseline puts the whole lineup (back heads to front plinths) inside the free band
    const base = lineupBaseline(f720, LINEUP);
    expect(base - LINEUP.arc - 48).toBeGreaterThanOrEqual(f720.freeTop);
    expect(base + 16).toBeLessThanOrEqual(f720.freeBottom);
  });
});

describe('locks', () => {
  it('describes a locked class with its level and the player progress', () => {
    expect(lockInfo(6, 2)).toEqual({ locked: true, chip: 'Lv 6', line: 'Unlocks at level 6', progress: 'Level 2 / 6' });
    expect(lockInfo(6, 6).locked).toBe(false);
    expect(lockInfo(6, 9)).toEqual({ locked: false, chip: '', line: '', progress: null });
    // level not known yet: nothing is shown locked (the authority still refuses locked classes)
    expect(lockInfo(20, null).locked).toBe(false);
    expect(lockInfo(1, 1).locked).toBe(false);
  });

  it('announces the highlighted class and its lock for screen readers', () => {
    expect(announceText('Ranger', 'Ranged hunter · precision', lockInfo(1, 4))).toBe('Ranger selected. Ranged hunter · precision.');
    expect(announceText('Templar', 'Holy frontliner · support', lockInfo(10, 2))).toBe('Templar, locked. Unlocks at level 10; you are level 2 / 10.');
  });

  it('locks exactly the classes above the player level', () => {
    const locked = CLASSES.filter((c) => lockInfo(classUnlockLevel(c.id), 1).locked).map((c) => c.id).sort();
    expect(locked).toEqual(['artificer', 'duelist', 'hexbinder', 'templar', 'warden']);
  });
});

describe('party seating', () => {
  const seat = (slot: number, you = false) => ({ slot, you });
  it('puts you in the centre and the others alternating outward, open seats after', () => {
    expect(partyOrder([seat(0), seat(1, true), seat(2)], 5).map((s) => s?.slot ?? null)).toEqual([null, 2, 1, 0, null]);
    expect(partyOrder([seat(0, true)], 5).map((s) => s?.slot ?? null)).toEqual([null, null, 0, null, null]);
    expect(partyOrder([seat(0), seat(1), seat(2), seat(3), seat(4, true)], 5).map((s) => s?.slot ?? null)).toEqual([3, 1, 4, 0, 2]);
    expect(partyOrder([seat(0, true)], 1).map((s) => s?.slot ?? null)).toEqual([0]);
    // a spectator-less list without "you" still fills from the centre
    expect(partyOrder([seat(7)], 3).map((s) => s?.slot ?? null)).toEqual([null, 7, null]);
  });
});

describe('class flavour', () => {
  it('every playable class has a portal flavour, a hero rig and its own sting', () => {
    for (const c of CLASSES) {
      expect(isVesselClass(c.id), c.id).toBe(true);
      expect(FLAVOR[c.id as keyof typeof FLAVOR].motes.length, c.id).toBeGreaterThan(1);
      const sfx = vesselPickSfx(c.id);
      expect(sfx).toBe(`vessel_pick_${c.id}`);
      expect(SFX_IDS).toContain(sfx);
    }
    expect([...VESSEL_CLASSES].sort()).toEqual([...HERO_ACTOR_IDS].sort());
    expect(vesselPickSfx('nobody')).toBe('vessel_pick_vanguard');
    expect(flavorOf('nobody')).toBe(FLAVOR.vanguard);
    for (const id of ['vessel_shift', 'vessel_locked', 'vessel_roar'] as const) expect(SFX_IDS).toContain(id);
  });

  it('borrows the in-game class effect sprites it needs', () => {
    for (const key of ['fx:berserker:fear', 'fx:cryomancer:spike', 'fx:cryomancer:cluster', 'fx:hexbinder:sigil', 'fx:berserker:rage', 'fx:vanguard:crack', 'fx:duelist:xslash', 'fx:artificer:cog']) {
      expect(fxFrames(key).length, key).toBeGreaterThan(0);
    }
    const art = heroArt('ranger');
    expect(art.idle.frames.length).toBe(art.idle.durations.length);
    expect(art.cast.frames.length).toBeGreaterThan(2);
    expect(art.idle.frames[0]!.w).toBe(48);
  });
});

describe('stage renderer', () => {
  const setup = (level: number | null, opts: { reducedMotion?: boolean; particles?: number } = {}) => {
    const fit = fitStage({ devW: 1280, devH: 720, insetTop: 72, insetBottom: 200, need: lineupNeeds(10, LINEUP) });
    const cx = Math.round(fit.w / 2), base = lineupBaseline(fit, LINEUP);
    const pos = arcPositions(10, cx, base, LINEUP);
    const r = new VesselRenderer({ particles: opts.particles ?? 1, reducedMotion: !!opts.reducedMotion, animatedDecor: true });
    r.layout(fit.w, fit.h, cx, base, LINEUP.arc, pos, CLASSES.map((c) => ({ classId: c.id, locked: lockInfo(classUnlockLevel(c.id), level).locked })));
    r.select(0, false);
    while (r.warm()) { /* build every asset */ }
    return { r, pos };
  };
  const lum = (r: VesselRenderer, x0: number, y0: number, w: number, h: number) => {
    let s = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * r.w + x) * 4; s += r.pixels[i]! + r.pixels[i + 1]! + r.pixels[i + 2]!; }
    return s / (w * h * 3);
  };

  it('lights the chosen hero and leaves locked heroes as dark silhouettes', () => {
    const { r, pos } = setup(1);
    expect(r.ready).toBe(true);
    const ranger = CLASSES.findIndex((c) => c.id === 'ranger'), duelist = CLASSES.findIndex((c) => c.id === 'duelist');
    r.select(ranger, true);
    for (let k = 0; k < 90; k++) r.step(1 / 60);
    r.render();
    const body = (i: number) => lum(r, pos[i]!.x - 6, pos[i]!.y + 5 - 30, 12, 24);   // the stepped-forward torso
    expect(body(ranger)).toBeGreaterThan(body(duelist) * 2);
    // the light column rises above the chosen hero's head
    const above = (i: number) => lum(r, pos[i]!.x - 2, pos[i]!.y - 80, 4, 20);
    expect(above(ranger)).toBeGreaterThan(above(duelist) + 10);
    expect(r.pixels.length).toBe(r.w * r.h * 4);
  });

  it('runs the confirm flourish once, and a skip ends it at once', () => {
    const { r } = setup(20);
    r.select(3, true);
    let calls = 0;
    r.flourish(3, () => calls++);
    expect(r.flourishing).toBe(true);
    for (let k = 0; k < 120; k++) { r.step(1 / 60); r.render(); }
    expect(calls).toBe(1);
    expect(r.flourishing).toBe(false);
    r.resetFlourish();
    let skipped = 0;
    r.flourish(3, () => skipped++);
    r.step(1 / 60);
    r.skipFlourish();
    r.skipFlourish();
    expect(skipped).toBe(1);
    // reduced motion: a short flash, no long animation
    const rm = setup(20, { reducedMotion: true, particles: 0 }).r;
    let done = 0;
    rm.flourish(0, () => done++);
    for (let k = 0; k < 24; k++) rm.step(1 / 60);
    expect(done).toBe(1);
  });
});
