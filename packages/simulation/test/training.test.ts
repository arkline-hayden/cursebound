import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { BOSSES, CLASS_BY_ID, NODE_BY_ID, PACK_TEMPLATES, TRAINING_THEME } from '@cursebound/content';
import {
  COURTYARD, TRAINING_POINTS, buildSnapshot, courtyardPlan, deserializeState, isWall, serializeState, stateHash, step,
  type Command, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Training grounds (training.ts, courtyard.ts): the courtyard map, the endless sandbox rules (no clear, no wipe, no
// score, free skill tree, class swaps) and deterministic TRAIN tools; TRAIN is refused outside training runs.

const train = (seed = 'TRAIN_1', classes = ['vanguard']) => newRun(classes, seed, { training: true });
const idle = (s: SimState): PlayerInput[] => s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 }));

/** Step a training run into COMBAT (it starts without a ready vote). */
function toYard(s: SimState): SimState {
  for (let i = 0; i < 600 && s.phase !== 'COMBAT'; i++) step(s, idle(s), []);
  return s;
}

function cmd(s: SimState, c: Omit<Extract<Command, { type: 'TRAIN' }>, 'type' | 'slot'> & { slot?: number }) {
  return step(s, idle(s), [{ type: 'TRAIN', slot: c.slot ?? 0, op: c.op, ...(c.arg !== undefined ? { arg: c.arg } : {}), ...(c.tier !== undefined ? { tier: c.tier } : {}) }]);
}

describe('training grounds', () => {
  it('opens straight into a circular courtyard with nothing to clear', () => {
    const s = toYard(train());
    expect(s.phase).toBe('COMBAT');
    expect(s.training).toEqual({ ai: true });
    const m = s.map!;
    expect(m.theme).toBe(TRAINING_THEME.id);
    expect(m.layout).toBe('courtyard');
    expect([m.w, m.h]).toEqual([COURTYARD.w, COURTYARD.h]);
    // round plaza: floor at the cardinal rims, houses (walls) just outside, the fountain blocks the centre
    const c = m.w / 2;
    expect(isWall(m, Math.floor(c), Math.floor(c))).toBe(true);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(isWall(m, Math.floor(c + dx * 15), Math.floor(c + dy * 15))).toBe(false);
      expect(isWall(m, Math.floor(c + dx * 18.5), Math.floor(c + dy * 18.5))).toBe(true);
    }
    // every blocking piece of the plan is carved, and the heroes start on open floor
    const plan = courtyardPlan(m.decorSeed);
    for (const f of plan.features.filter((x) => x.kind !== 'arch' && x.kind !== 'fountain')) expect(isWall(m, f.x, f.y)).toBe(true);
    expect(plan.features.filter((x) => x.kind === 'stall')).toHaveLength(4);
    expect(plan.features.filter((x) => x.kind === 'dummy')).toHaveLength(5);
    for (const p of s.players) expect(isWall(m, Math.floor(p.x), Math.floor(p.y))).toBe(false);
    expect(s.encounter!.groups).toHaveLength(0);
    for (let i = 0; i < 600; i++) step(s, idle(s), []);
    expect(s.phase).toBe('COMBAT');   // never clears
    expect(s.scoreText).toBe('0');
    expect(s.offer).toBeNull();
    expect(buildSnapshot(s).tr).toEqual({ ai: 1 });
  });

  it('heroes respawn instead of wiping', () => {
    const s = toYard(train());
    const p = s.players[0];
    p.hp = Big.ZERO; p.lifeState = 'downed'; p.downTimer = 5;
    const r = step(s, idle(s), []);
    expect(s.phase).toBe('COMBAT');
    expect(p.lifeState).toBe('alive');
    expect(p.hp.eq(p.maxHp)).toBe(true);
    expect(r.events.some((e) => e.t === 'training' && e.op === 'respawn')).toBe(true);
  });

  it('every node is rankable with unlimited points and refunds are free mid-fight', () => {
    const s = toYard(train('TRAIN_TREE', ['arcanist']));
    const p = s.players[0];
    expect(p.skillPoints).toBe(TRAINING_POINTS);
    const cls = CLASS_BY_ID[p.classId];
    let bought = 0;
    for (let pass = 0; pass < 8; pass++) for (const id of cls.nodes) {
      const n = NODE_BY_ID[id];
      if (n.starting) continue;
      const r = step(s, idle(s), [{ type: 'ALLOCATE', slot: 0, nodeId: id }]);
      if (r.outcomes[0].ok) bought++;
    }
    expect(bought).toBeGreaterThan(10);
    expect(p.skillPoints).toBe(TRAINING_POINTS);
    const ref = step(s, idle(s), [{ type: 'REFUND_ALL', slot: 0 }]);
    expect(ref.outcomes[0].ok).toBe(true);
    expect(Object.keys(p.ranks).every((id) => NODE_BY_ID[id].starting)).toBe(true);
    expect(p.skillPoints).toBe(TRAINING_POINTS);
  });

  it('swaps class in place with a fresh kit', () => {
    const s = toYard(train('TRAIN_SWAP'));
    const p = s.players[0];
    const x = p.x, y = p.y;
    const r = cmd(s, { op: 'class', arg: 'ranger' });
    expect(r.outcomes[0].ok).toBe(true);
    expect(p.classId).toBe('ranger');
    expect([p.x, p.y]).toEqual([x, y]);
    expect(p.skills[3].skillId).toBe(CLASS_BY_ID.ranger.signatureSkill);
    expect(p.hp.eq(p.maxHp)).toBe(true);
    expect(cmd(s, { op: 'class', arg: 'nobody' }).outcomes[0]).toMatchObject({ ok: false, code: 'UNKNOWN_CLASS' });
  });

  it('spawns every pack template (ordinary, champion, rare) and both bosses, clears, freezes AI, heals, resets cooldowns', () => {
    const s = toYard(train('TRAIN_TOOLS'));
    for (const t of PACK_TEMPLATES) {
      for (const tier of [0, 1, 2]) {
        const before = s.enemies.length;
        const r = cmd(s, { op: 'spawn', arg: t.id, tier });
        expect(r.outcomes[0].ok).toBe(true);
        step(s, idle(s), []);   // a rare's minions arrive on the next tick
        expect(s.enemies.length).toBe(before + (tier === 2 ? 6 : 4));
        const lead = s.enemies[before];
        expect(lead.kind).toBe(t.lead);
        expect(lead.elite ?? 0).toBe(tier);
        for (const e of s.enemies.slice(before)) expect(isWall(s.map!, Math.floor(e.x), Math.floor(e.y))).toBe(false);
        cmd(s, { op: 'clear' });
        expect(s.enemies).toHaveLength(0);
      }
    }
    for (const b of BOSSES) {
      expect(cmd(s, { op: 'boss', arg: b.id }).outcomes[0].ok).toBe(true);
      expect(s.enemies.filter((e) => e.boss)).toHaveLength(1);
      expect(cmd(s, { op: 'boss', arg: b.id }).outcomes[0]).toMatchObject({ ok: false, code: 'BOSS_ACTIVE' });
      expect(buildSnapshot(s).enc?.bossId).toBe(b.id);
      cmd(s, { op: 'clear' });
    }
    // AI off: foes stand still
    cmd(s, { op: 'spawn', arg: 'hounds' });
    expect(cmd(s, { op: 'ai', arg: 'off' }).outcomes[0].ok).toBe(true);
    const pos = s.enemies.map((e) => [e.x, e.y]);
    for (let i = 0; i < 120; i++) step(s, idle(s), []);
    expect(s.enemies.map((e) => [e.x, e.y])).toEqual(pos);
    expect(s.enemies.every((e) => !e.attack)).toBe(true);
    cmd(s, { op: 'ai', arg: 'on' });
    expect(s.training!.ai).toBe(true);
    // heal + cooldowns
    const p = s.players[0];
    p.hp = p.maxHp.div(Big.from(4n));
    p.skills.forEach((k) => { if (k.skillId) { k.charges = 0; k.cooldown = 9; } });
    cmd(s, { op: 'heal' });
    cmd(s, { op: 'cooldowns' });
    expect(p.hp.eq(p.maxHp)).toBe(true);
    expect(p.skills.filter((k) => k.skillId).every((k) => k.charges === k.maxCharges && k.cooldown === 0)).toBe(true);
    // foe level scales new spawns
    expect(cmd(s, { op: 'level', arg: '20' }).outcomes[0].ok).toBe(true);
    expect(s.round).toBe(20);
    expect(cmd(s, { op: 'spawn', arg: 'nope' }).outcomes[0]).toMatchObject({ ok: false, code: 'UNKNOWN_PACK' });
  });

  it('spawning is deterministic and survives a checkpoint round trip', () => {
    const script = (s: SimState) => {
      const evs: SimEvent[] = [];
      toYard(s);
      const plan: [number, Omit<Extract<Command, { type: 'TRAIN' }>, 'type' | 'slot'>][] = [
        [5, { op: 'spawn', arg: 'cult', tier: 2 }], [40, { op: 'spawn', arg: 'rime', tier: 1 }], [90, { op: 'boss', arg: 'prismstag' }], [300, { op: 'ai', arg: 'off' }], [420, { op: 'clear' }], [430, { op: 'spawn', arg: 'gloom' }],
      ];
      for (let t = 0; t < 600; t++) {
        const c = plan.find(([at]) => at === t);
        const r = step(s, s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: Math.sin(t / 30), moveY: Math.cos(t / 40), aimX: 1, aimY: 0.5, buttons: t % 3 === 0 ? 1 : 0 })), c ? [{ type: 'TRAIN', slot: 0, ...c[1] }] : []);
        evs.push(...r.events);
        if (t === 300) s = deserializeState(serializeState(s));
      }
      return { hash: stateHash(s), spawns: evs.filter((e) => e.t === 'spawn').length, s };
    };
    const a = script(train('TRAIN_DET'));
    const b = script(train('TRAIN_DET'));
    expect(a.hash).toBe(b.hash);
    expect(a.spawns).toBe(b.spawns);
    expect(a.spawns).toBeGreaterThan(8);
  });

  it('TRAIN is refused outside training runs (state unchanged)', () => {
    const s = newRun(['vanguard'], 'TRAIN_NOT');
    for (let i = 0; i < 400 && s.phase !== 'COMBAT'; i++) step(s, idle(s), s.phase === 'LOADOUT_LOCK' ? [{ type: 'READY', slot: 0, ready: true }] : []);
    expect(s.phase).toBe('COMBAT');
    const n = s.enemies.length;
    for (const op of ['spawn', 'boss', 'clear', 'ai', 'cooldowns', 'heal', 'class', 'level']) {
      const r = step(s, idle(s), [{ type: 'TRAIN', slot: 0, op, arg: op === 'spawn' ? 'hounds' : op === 'boss' ? 'bellroot' : op === 'ai' ? 'off' : op === 'class' ? 'ranger' : op === 'level' ? '9' : undefined }]);
      expect(r.outcomes[0]).toMatchObject({ ok: false, code: 'NOT_TRAINING' });
    }
    expect(s.enemies.length).toBeGreaterThanOrEqual(n - 2);
    expect(s.players[0].classId).toBe('vanguard');
    expect(s.training).toBeUndefined();
    // an ordinary run's state never grows training fields (replays of normal runs are unchanged)
    expect(JSON.stringify(buildSnapshot(s))).not.toContain('"tr"');
  });
});
