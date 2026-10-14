import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CLASSES, CLASS_BY_ID, RULES, SKILL_BY_ID } from '@cursebound/content';
import { derivePlayer, deserializeState, hitPlayer, serializeState, stateHash } from '@cursebound/simulation';
import type { EnemyState } from '@cursebound/simulation';
import { ACTION, aimAt, arena, damaged, run, spawnAt, type Arena } from './classkit.helpers';
import { CLEAVE_SHIELD } from '../src/classes/vanguard';
import { FANG_CRIT_HEAL } from '../src/classes/duelist';
import { SAP_HEAL } from '../src/classes/warden';

// Shared melee rules (content RULES.meleeDamageTakenMult / meleeLungeDist; simulation stats.ts, players.ts).

const MELEE = ['vanguard', 'duelist', 'templar', 'berserker', 'warden'];
const reachOf = (classId: string) => {
  const s = SKILL_BY_ID[CLASS_BY_ID[classId].basicSkill].shape;
  if (s.kind !== 'arc') throw new Error('not an arc');
  return s.range;
};

describe('melee archetype', () => {
  it('exactly the five melee classes are flagged melee, and each swings an arc basic attack', () => {
    expect(CLASSES.filter((c) => c.melee).map((c) => c.id).sort()).toEqual(MELEE.slice().sort());
    for (const id of MELEE) expect(SKILL_BY_ID[CLASS_BY_ID[id].basicSkill].shape.kind).toBe('arc');
  });

  it('Close Quarters: melee heroes take x meleeDamageTakenMult incoming damage on top of armor; casters do not', () => {
    const v = arena('vanguard', [], 'MELEE_CQ_V');
    const a = arena('arcanist', [], 'MELEE_CQ_A');
    const K = Big.from(RULES.armorK);
    const dv = derivePlayer(v.s, v.s.players[0]), da = derivePlayer(a.s, a.s.players[0]);
    expect(dv.incomingFactor.toNumber()).toBeCloseTo(K.div(K.add(dv.armor)).mul(Big.from(RULES.meleeDamageTakenMult)).toNumber(), 12);
    expect(da.incomingFactor.toNumber()).toBeCloseTo(K.div(K.add(da.armor)).toNumber(), 12);
    // the hit itself
    const pv = v.s.players[0], pa = a.s.players[0];
    pv.iframes = 0; pa.iframes = 0;
    const takenV = hitPlayer(v.s, [], pv, Big.from(100), { attack: 'test', source: 'test', fromX: pv.x + 1, fromY: pv.y, dtype: 'physical' });
    const takenA = hitPlayer(a.s, [], pa, Big.from(100), { attack: 'test', source: 'test', fromX: pa.x + 1, fromY: pa.y, dtype: 'physical' });
    expect(takenV.toNumber()).toBeCloseTo(100 * Number(RULES.armorK) / (Number(RULES.armorK) + CLASS_BY_ID.vanguard.base.armor) * Number(RULES.meleeDamageTakenMult), 6);
    expect(takenA.toNumber()).toBeCloseTo(100 * Number(RULES.armorK) / (Number(RULES.armorK) + CLASS_BY_ID.arcanist.base.armor), 6);
  });
});

/** Hold ATTACK (aimed at `e`) until the first hit lands on it (slow swingers need up to ~0.8 s for the first swing);
 *  returns how far the hero moved by then. Flinch pushes foes back, so later swings may lunge again. */
function untilFirstHit(a: Arena, e: EnemyState, maxTicks = 150): number {
  const p = a.s.players[0];
  const x0 = p.x, y0 = p.y;
  for (let i = 0; i < maxTicks && !damaged(e); i++) run(a, 1, ACTION.ATTACK, 1, aimAt(a, e));
  return Math.hypot(p.x - x0, p.y - y0);
}

describe('melee reach and lunge', () => {
  for (const id of MELEE) {
    it(`${id}: a foe whose body is just inside the content reach is hit without any lunge`, () => {
      const a = arena(id, [], 'MELEE_REACH_' + id);
      const e = spawnAt(a, 'guardian', reachOf(id) + 0.55 - 0.1);   // guardian radius 0.55
      const moved = untilFirstHit(a, e);
      expect(damaged(e)).toBe(true);
      expect(moved).toBeLessThan(1e-9);
    });

    it(`${id}: a foe slightly out of reach is closed on by a lunge (at most meleeLungeDist) and hit`, () => {
      const a = arena(id, [], 'MELEE_LUNGE_' + id);
      const e = spawnAt(a, 'guardian', reachOf(id) + 0.55 + RULES.meleeLungeDist * 0.7);
      const moved = untilFirstHit(a, e);
      expect(moved).toBeGreaterThan(0.2);
      expect(moved).toBeLessThanOrEqual(RULES.meleeLungeDist + 1e-9);
      expect(damaged(e)).toBe(true);
    });
  }

  it('a foe beyond reach + lunge distance is not chased, and casters never lunge', () => {
    const a = arena('vanguard', [], 'MELEE_FAR');
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', reachOf('vanguard') + 0.55 + RULES.meleeLungeDist + 0.4);
    const x0 = p.x, y0 = p.y;
    run(a, 90, ACTION.ATTACK, 90, aimAt(a, e));
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeLessThan(1e-9);
    expect(damaged(e)).toBe(false);

    const c = arena('arcanist', [], 'MELEE_CASTER');
    const pc = c.s.players[0];
    const t = spawnAt(c, 'guardian', 2.4);
    const cx = pc.x, cy = pc.y;
    run(c, 90, ACTION.ATTACK, 90, aimAt(c, t));
    expect(Math.hypot(pc.x - cx, pc.y - cy)).toBeLessThan(1e-9);
  });

  it('rooted heroes do not lunge', () => {
    const a = arena('duelist', [], 'MELEE_ROOT');
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', reachOf('duelist') + 0.55 + RULES.meleeLungeDist * 0.7);
    p.buffs.push({ id: 'rooted', until: a.s.tick + 600, value: 0 });
    const x0 = p.x, y0 = p.y;
    run(a, 90, ACTION.ATTACK, 90, aimAt(a, e));
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeLessThan(1e-9);
  });

  it('lunges are deterministic and survive checkpoint/restore', () => {
    const script = (seed: string) => {
      const a = arena('berserker', [], seed);
      for (let i = 0; i < 4; i++) spawnAt(a, 'pursuer', reachOf('berserker') + 0.4 + 0.25 * i, -30 + 20 * i, 1, i % 2 === 0);
      return a;
    };
    const x = script('MELEE_DET'), y = script('MELEE_DET');
    run(x, 90, ACTION.ATTACK); run(y, 90, ACTION.ATTACK);
    expect(stateHash(x.s)).toBe(stateHash(y.s));
    const z = { ...x, s: deserializeState(serializeState(x.s)) };
    run(x, 90, ACTION.ATTACK); run(z, 90, ACTION.ATTACK);
    expect(stateHash(z.s)).toBe(stateHash(x.s));
  });
});

describe('melee sustain perks', () => {
  it('Vanguard Cleave Guard: one connecting swing shields CLEAVE_SHIELD of maximum health, however many foes it hits', () => {
    const a = arena('vanguard', [], 'MELEE_CLEAVE_GUARD');
    const p = a.s.players[0];
    const e1 = spawnAt(a, 'pursuer', 1.2, -20, 1);
    spawnAt(a, 'pursuer', 1.2, 20, 1);
    p.shield = Big.ZERO;
    for (let i = 0; i < 150 && !damaged(e1); i++) run(a, 1, ACTION.ATTACK, 1, aimAt(a, e1));
    expect(damaged(e1)).toBe(true);
    expect(p.shield.toNumber()).toBeCloseTo(p.maxHp.toNumber() * Number(CLEAVE_SHIELD), 6);
  });

  it('Duelist Keen Edge: a critical Twin Fangs swing heals FANG_CRIT_HEAL of maximum health once', () => {
    const a = arena('duelist', [], 'MELEE_KEEN_EDGE');
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 1.5);
    a.s.fate.factors['player.critTendency'] = Big.from('1e9');   // every hit crits
    a.s.stateVersion++;
    p.hp = p.maxHp.mul(Big.from('0.5'));
    for (let i = 0; i < 150 && !damaged(e); i++) run(a, 1, ACTION.ATTACK, 1, aimAt(a, e));
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.5 + Number(FANG_CRIT_HEAL), 6);
  });

  it('Warden Living Sap: a connecting Thornspear thrust heals SAP_HEAL of maximum health once', () => {
    const a = arena('warden', [], 'MELEE_LIVING_SAP');
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 1.5);
    p.hp = p.maxHp.mul(Big.from('0.5'));
    for (let i = 0; i < 150 && !damaged(e); i++) run(a, 1, ACTION.ATTACK, 1, aimAt(a, e));
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.5 + Number(SAP_HEAL), 6);
  });
});

describe('melee copy states the live numbers', () => {
  it('basic attack descriptions quote the sustain perks and the shared melee rules', () => {
    const pct = (x: string) => `${(Number(x) * 100).toFixed(1)}%`;
    expect(SKILL_BY_ID.v_cleave.description).toContain(pct(CLEAVE_SHIELD));
    expect(SKILL_BY_ID.d_twin_fangs.description).toContain(pct(FANG_CRIT_HEAL));
    expect(SKILL_BY_ID.w_thornspear.description).toContain(pct(SAP_HEAL));
    const cq = `${Math.round((1 - Number(RULES.meleeDamageTakenMult)) * 100)}% less damage`;
    for (const id of MELEE) {
      const d = SKILL_BY_ID[CLASS_BY_ID[id].basicSkill].description;
      expect(d).toContain(cq);
      expect(d).toContain(`${RULES.meleeLungeDist} units`);
      expect(d).toContain(String(reachOf(id)));
    }
  });
});
