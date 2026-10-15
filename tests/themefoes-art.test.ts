import { describe, expect, it } from 'vitest';
import { ENEMIES, ENEMY_BY_ID, RUNNER_KIND, THEME_FOES } from '@cursebound/content';
import { ACTOR_IDS, ACTOR_META, buildActorSheet, type ActorId } from '../apps/client/src/game/art/actors';
import { ACTOR_DISPLAY_NAME } from '../apps/client/src/game/art/manifest';
import { THEME_FOE_GROUND, THEME_FOE_IDS } from '../apps/client/src/game/art/draw/themeFoes';

// Every foe the simulation can spawn has its own procedural sprite (walk, wind-up, attack, hit and death frames on the
// standard foe rig) and a nameplate name; the theme foes of the sky island, moon and server room included.

const opaque = (rgba: Uint8ClampedArray, w: number, fx: number, fy: number, fw: number, fh: number): number => {
  let n = 0;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (rgba[((fy + y) * w + fx + x) * 4 + 3]! > 24) n++;
  return n;
};

describe('every foe has art and a nameplate name', () => {
  it('each enemy kind has its own actor sprite and a display name matching its content name (the nameplate)', () => {
    for (const e of ENEMIES) {
      if (e.id === RUNNER_KIND) continue;   // the treasure imp has its own sprite (render/RoomEvents.ts), not an actor rig
      expect((ACTOR_IDS as readonly string[]).includes(e.id), `${e.id} has no sprite`).toBe(true);
      const name = ACTOR_DISPLAY_NAME[e.id as ActorId];
      expect(name, e.id).toBe(e.name);
      expect(e.name.length, e.id).toBeGreaterThan(2);
      expect(e.name.length, e.id).toBeLessThanOrEqual(24);   // fits a nameplate over the health bar
    }
  });

  it('the theme foes are exactly the content theme rosters, with grounds matching their sprite feet', () => {
    expect([...THEME_FOE_IDS].sort()).toEqual(Object.values(THEME_FOES).flat().sort());
    for (const id of THEME_FOE_IDS) {
      const m = ACTOR_META[id];
      expect(Math.round(m.originY * m.frameH), id).toBe(THEME_FOE_GROUND[id]);
      expect(m.states).toEqual(expect.arrayContaining(['idle', 'run', 'windup', 'attack', 'hit', 'death']));
      expect(ENEMY_BY_ID[id]).toBeTruthy();
    }
  });

  it('theme foe sheets: every direction and state renders a visible body; the death ends in a burst, not a body', () => {
    for (const id of THEME_FOE_IDS) {
      const sh = buildActorSheet(id);
      const perRow = Math.floor(sh.width / sh.frameW);
      const at = (f: number) => [(f % perRow) * sh.frameW, Math.floor(f / perRow) * sh.frameH] as const;
      for (const dir of ['e', 'se', 's', 'ne', 'n']) {
        for (const st of ['idle', 'run', 'windup', 'attack', 'hit']) {
          const a = sh.anims.find((x) => x.dir === dir && x.state === st);
          expect(a, `${id} ${st} ${dir}`).toBeTruthy();
          for (const fr of a!.frames) {
            const [fx, fy] = at(fr.frame);
            expect(opaque(sh.rgba, sh.width, fx, fy, sh.frameW, sh.frameH), `${id} ${st} ${dir}`).toBeGreaterThan(30);
          }
        }
        const death = sh.anims.find((x) => x.dir === dir && x.state === 'death')!;
        const idle = sh.anims.find((x) => x.dir === dir && x.state === 'idle')!;
        const [ix, iy] = at(idle.frames[0]!.frame);
        const [dx, dy] = at(death.frames[death.frames.length - 1]!.frame);
        expect(opaque(sh.rgba, sh.width, dx, dy, sh.frameW, sh.frameH), `${id} death ${dir}`).toBeLessThan(opaque(sh.rgba, sh.width, ix, iy, sh.frameW, sh.frameH));
      }
      // walk cycles move: not every run frame is the same picture
      const run = sh.anims.find((x) => x.dir === 'se' && x.state === 'run')!;
      const sig = (f: number) => { const [fx, fy] = at(f); let h = 0; for (let y = 0; y < sh.frameH; y++) for (let x = 0; x < sh.frameW; x++) h = (h * 31 + sh.rgba[((fy + y) * sh.width + fx + x) * 4 + 3]!) >>> 0; return h; };
      expect(new Set(run.frames.map((f) => sig(f.frame))).size, id).toBeGreaterThan(1);
    }
  });
});
