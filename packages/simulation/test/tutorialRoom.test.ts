import { describe, expect, it } from 'vitest';
import { TUTORIAL_CARD } from '@cursebound/content';
import {
  ACTION, GUIDE_COMPARE_TICKS, GUIDE_STEPS, buildSnapshot, deserializeState, guideLootIds, isWall, serializeState, stateHash, step,
  type Command, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Guided first-run tutorial (tutorialRoom.ts): the hand-built crypt, steps that advance only when done (move, attack,
// each skill, a dodge through a telegraphed glob, a legendary + its quick-compare, a Fate door), then the run ends.

const guided = (classId = 'vanguard', seed = 'tutorial-1') => newRun([classId], seed, { tutorial: true, guided: true });

class Pilot {
  seq = 1;
  events: SimEvent[] = [];
  constructor(public s: SimState) {}
  get p() { return this.s.players[0]; }
  /** one tick: walk toward (x, y) (stop within `stop`), aim at it, holding `buttons` */
  tick(x?: number, y?: number, buttons = 0, stop = 0.25, cmds: Command[] = []) {
    const p = this.p;
    let mx = 0, my = 0, ax = p.aimX, ay = p.aimY;
    if (x !== undefined && y !== undefined) {
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
      if (d > 1e-6) { ax = dx / d * Math.min(6, Math.max(1, d)); ay = dy / d * Math.min(6, Math.max(1, d)); }
      if (d > stop) { mx = dx / d; my = dy / d; }
    }
    const inp: PlayerInput = { seq: this.seq++, moveX: Math.round(mx * 127) / 127, moveY: Math.round(my * 127) / 127, aimX: ax, aimY: ay, buttons };
    const r = step(this.s, [inp], cmds);
    this.events.push(...r.events);
    return r;
  }
  until(cond: () => boolean, max: number, each: (i: number) => void) {
    for (let i = 0; i < max && !cond(); i++) each(i);
    return cond();
  }
}

const stepName = (s: SimState) => GUIDE_STEPS[s.guide!.step];

describe('guided tutorial', () => {
  it('starts straight into the tutorial crypt with a walk mark, and plays through every step to the Fate doors', () => {
    const s = guided();
    const pl = new Pilot(s);
    expect(s.guide).toBeTruthy();
    expect(pl.until(() => s.phase === 'COMBAT', 600, () => pl.tick())).toBe(true);
    expect(s.map!.layout).toBe('tutorial');
    expect(s.encounter!.groups).toHaveLength(0);
    for (const p of s.players) expect(isWall(s.map!, Math.floor(p.x), Math.floor(p.y))).toBe(false);
    expect(stepName(s)).toBe('move');
    const snap = buildSnapshot(s);
    expect(snap.gd).toMatchObject({ s: 0, d: 0 });
    expect(snap.gd!.m).toEqual([s.guide!.mx, s.guide!.my]);

    // standing still never advances a step
    for (let i = 0; i < 240; i++) pl.tick();
    expect(stepName(s)).toBe('move');

    // 0 move: walk to the mark
    const [mx, my] = [s.guide!.mx!, s.guide!.my!];
    expect(pl.until(() => stepName(s) === 'attack', 60 * 20, () => pl.tick(mx, my))).toBe(true);
    const dummy = s.enemies.find((e) => s.guide!.ids.includes(e.id))!;
    expect(dummy).toBeTruthy();
    // dummies never move or attack
    const at = { x: dummy.x, y: dummy.y };
    for (let i = 0; i < 120; i++) pl.tick();
    expect([dummy.x, dummy.y]).toEqual([at.x, at.y]);
    expect(dummy.attack).toBeNull();

    // 1 attack: strike the dummy until it falls
    expect(pl.until(() => stepName(s) === 'skills', 60 * 30, () => pl.tick(dummy.x, dummy.y, ACTION.ATTACK, 1.0))).toBe(true);

    // 2 skills: each hotbar skill once (the step does not advance on two of three)
    const bits = [ACTION.SKILL1, ACTION.SKILL2, ACTION.SKILL3];
    const target = () => s.enemies.find((e) => s.guide!.ids.includes(e.id) && e.state !== 'dying') ?? s.enemies[0];
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 30; i++) { const t = target(); pl.tick(t?.x, t?.y, i < 3 ? bits[k] : 0, 1.6); }
    }
    expect(stepName(s)).toBe('skills');
    expect(s.guide!.done).toBe(3);
    expect(buildSnapshot(s).gd!.d).toBe(3);
    expect(pl.until(() => stepName(s) === 'dodge', 60 * 10, (i) => { const t = target(); pl.tick(t?.x, t?.y, i % 30 < 3 ? bits[2] : 0, 1.6); })).toBe(true);

    // 3 dodge: when the toad's glob is coming, dash clear of it
    const toad = s.enemies.find((e) => s.guide!.ids.includes(e.id))!;
    expect(toad.kind).toBe('artillery');
    let dashFor = 0, dir: [number, number] = [0, 1];
    const dodged = pl.until(() => stepName(s) === 'loot', 60 * 60, () => {
      const p = pl.p;
      const tele = s.telegraphs.find((t) => t.ownerId === toad.id && t.releaseTick >= s.tick - 2);
      if (tele && dashFor === 0) {
        const vx = p.x - tele.x, vy = p.y - tele.y, l = Math.hypot(vx, vy);
        dir = l > 0.3 ? [vx / l, vy / l] : [-(toad.y - p.y) / (Math.hypot(toad.x - p.x, toad.y - p.y) || 1), (toad.x - p.x) / (Math.hypot(toad.x - p.x, toad.y - p.y) || 1)];
        if (s.map && isWall(s.map, Math.floor(p.x + dir[0] * 3), Math.floor(p.y + dir[1] * 3))) dir = [-dir[0], -dir[1]];
        dashFor = 50;
      }
      if (dashFor > 0) { pl.tick(p.x + dir[0] * 4, p.y + dir[1] * 4, dashFor === 50 || dashFor === 49 ? ACTION.DODGE : 0, 0); dashFor--; }
      else pl.tick(20.5, 11.5, 0, 0.5);
    });
    expect(dodged).toBe(true);
    expect(s.enemies.some((e) => e.id === toad.id && e.state !== 'dying')).toBe(false);   // it crumbled

    // 4 loot: walk over the legendary (worn), then stand by the second one (quick-compare)
    const [a, b] = guideLootIds(pl.p)!;
    const item = (id: string) => (s.loot ?? []).find((it) => it.itemId === id);
    expect(item(a)).toBeTruthy();
    expect(pl.until(() => Object.values(pl.p.gear ?? {}).includes(a), 60 * 10, () => { const it = item(a); pl.tick(it?.x, it?.y, 0, 0.1); })).toBe(true);
    expect(pl.until(() => !!item(b), 30, () => pl.tick())).toBe(true);
    expect(s.guide!.done & 1).toBe(1);
    const nearB = item(b)!;
    for (let i = 0; i < 60 * 3 && Math.hypot(pl.p.x - nearB.x, pl.p.y - nearB.y) > 1.5; i++) pl.tick(nearB.x, nearB.y, 0, 1.2);
    for (let i = 0; i < GUIDE_COMPARE_TICKS - 5; i++) pl.tick();
    expect(stepName(s)).toBe('loot');
    expect(pl.until(() => s.phase === 'VOTING', 60 * 10, () => pl.tick())).toBe(true);

    // 5 door: the regular in-world vote (the tutorial card behind door I), walking through ends the run
    expect(stepName(s)).toBe('door');
    expect(s.offer!.cards[0]).toBe(TUTORIAL_CARD.id);
    expect(s.doors!.list).toHaveLength(3);
    const d = s.doors!.list[0];
    expect(pl.until(() => s.phase === 'FATE_COMMIT', 60 * 20, () => pl.tick(d.x, d.y, 0, 0.2))).toBe(true);
    expect(s.commits[0].cardId).toBe(TUTORIAL_CARD.id);
    pl.tick(undefined, undefined, 0, 0.25, [{ type: 'DURABLE', what: 'commit' }]);
    expect(pl.until(() => s.phase === 'FINALIZE', 60 * 5, () => pl.tick())).toBe(true);
    expect(s.guide!.step).toBe(GUIDE_STEPS.length);
    expect(s.endReason).toBe('retired');
    expect(s.round).toBe(1);   // no round 2
    pl.tick(undefined, undefined, 0, 0.25, [{ type: 'DURABLE', what: 'finalize' }]);
    pl.tick();
    expect(s.phase).toBe('RESULTS');
    // the step markers reached the authority's domain log
    const steps = pl.events.flatMap((e) => (e.t === 'domain' && e.type === 'tutorial_step' ? [String(e.payload.step)] : []));
    expect(steps).toEqual(['move', 'attack', 'skills', 'dodge', 'loot']);
  });

  it('heroes stand back up instead of failing, and the run is deterministic across a checkpoint', () => {
    const a = guided('ranger', 'tutorial-1'), b = guided('ranger', 'tutorial-1');
    const pa = new Pilot(a), pb = new Pilot(b);
    pa.until(() => a.phase === 'COMBAT', 600, () => pa.tick());
    pb.until(() => b.phase === 'COMBAT', 600, () => pb.tick());
    const p = a.players[0];
    p.lifeState = 'downed'; p.downTimer = 3;
    b.players[0].lifeState = 'downed'; b.players[0].downTimer = 3;
    pa.tick(); pb.tick();
    expect(p.lifeState).toBe('alive');
    expect(a.phase).toBe('COMBAT');
    const b2 = deserializeState(serializeState(b));
    const pb2 = new Pilot(b2); pb2.seq = pb.seq;
    for (let i = 0; i < 600; i++) { pa.tick(15.5, 11.5); pb2.tick(15.5, 11.5); }
    expect(stateHash(b2)).toBe(stateHash(a));
    expect(GUIDE_STEPS[a.guide!.step]).toBe('attack');
  });

  it('ordinary runs carry no guide (their state and snapshots are unchanged)', () => {
    const s = newRun(['vanguard'], 'PLAIN_RUN');
    expect('guide' in s).toBe(false);
    expect(buildSnapshot(s).gd).toBeUndefined();
    const t = newRun(['vanguard'], 'tutorial-1', { tutorial: true });   // the legacy tutorial flag alone
    expect('guide' in t).toBe(false);
  });
});
