import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CLASSES, CLASS_BY_ID, NODES, NODE_BY_ID, RULES, SKILLS, SKILL_BY_ID } from '@cursebound/content';
import {
  bossReinforceUnits, buildSnapshot, derivePlayer, killEnemy, serializeState, stateHash, step,
  type Command, type EnemyState, type SimEvent, type SimState,
} from '@cursebound/simulation';
import oldCooldowns from '../../content/test/fixtures/cooldowns-content-1.1.json';
import { BTN, arena, inp, run, spawn } from './tb.helpers';
import { newRun, runBot } from './run.helpers';

// Content 1.2 / sim 1.2 / rules 1.3 rebalance: no resource anywhere, cooldowns x0.7, the full starting kit, boss
// reinforcement waves at 2/3 and 1/3 health, and enemy tactics.

/** Instant-clear the state machine (heroes invulnerable, foes killed) up to COMBAT of `round`. */
function skipTo(s: SimState, round: number) {
  let seq = 1;
  for (let i = 0; i < 400000 && !(s.round === round && s.phase === 'COMBAT'); i++) {
    const cmds: Command[] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'VOTING' && s.offer) for (const p of s.players) if (!s.offer.votes[p.slot].locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: seq++, cardSlot: 0, locked: true });
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    if (s.phase === 'COMBAT') for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    for (const p of s.players) p.iframes = 10;
    step(s, [], cmds);
  }
}

/** A boss fight at round 5, past the grand entrance, heroes parked and invulnerable. */
function bossFight(classes: string[], seed: string) {
  const s = newRun(classes, seed);
  skipTo(s, 5);
  for (let i = 0; i < 600 && (s.cinematicUntilTick ?? 0) > s.tick; i++) step(s, [], []);
  const boss = s.enemies.find((e) => e.boss)!;
  const events: SimEvent[] = [];
  const tick = (n: number) => { for (let i = 0; i < n; i++) { for (const p of s.players) p.iframes = 10; events.push(...step(s, [], []).events); } };
  const setFrac = (f: number) => { boss.cohort.spread = Big.ZERO; boss.cohort.front = boss.cohort.unitHp.mul(Big.from((1 - f).toFixed(6))); };
  return { s, boss, events, tick, setFrac };
}

describe('no resource', () => {
  it('classes, skills, players and the snapshot carry no resource at all', () => {
    for (const c of CLASSES) expect('resource' in c, c.id).toBe(false);
    for (const k of SKILLS) expect('resourceCost' in k, k.id).toBe(false);
    const s = newRun(CLASSES.slice(0, 5).map((c) => c.id), 'NO_RESOURCE');
    runBot(s, { maxTicks: 60 * 40, untilRound: 2 });
    for (const p of s.players) expect('resource' in p).toBe(false);
    const snap = JSON.stringify(buildSnapshot(s));
    expect(snap).not.toMatch(/"res"|"resMax"|"resName"|resource/i);
    const d = derivePlayer(s, s.players[0]) as unknown as Record<string, unknown>;
    expect(Object.keys(d).filter((k) => /resource|emberCost/i.test(k))).toEqual([]);
  });

  it('skills are gated by cooldowns alone: a ready skill always casts', () => {
    const s = arena(['berserker']);
    const p = s.players[0];
    spawn(s, 11.5, 10, { hp: 1e9 });
    const ev = run(s, 1, () => [inp(BTN.SIG)]);
    expect(ev.some((e) => e.t === 'cast' && e.skill === 'b_avatar')).toBe(true);
    expect(p.skills[3].charges).toBe(0);
    expect(p.skills[3].cooldown).toBeCloseTo(SKILL_BY_ID['b_avatar'].cooldownSec, 6);
  });
});

describe('cooldowns x0.7', () => {
  it('every skill cooldown is the 1.1 cooldown x0.7, rounded to the nearest 0.5s', () => {
    const old = oldCooldowns as Record<string, number>;
    let scaled = 0;
    for (const k of SKILLS) {
      const o = old[k.id];
      expect(o, `${k.id} missing from the 1.1 fixture`).toBeDefined();
      if (o > 0) { expect(k.cooldownSec, k.id).toBe(Math.max(0.5, Math.round(o * 0.7 * 2) / 2)); scaled++; }
      else expect(k.cooldownSec, k.id).toBe(0);
    }
    expect(scaled).toBeGreaterThanOrEqual(100);
  });

  it('skill-scoped cooldown modifiers shorten the cooldown a cast starts (Heat Sink)', () => {
    const s = arena(['arcanist']);
    const p = s.players[0];
    p.ranks['a_heat_sink'] = 2; s.stateVersion++;
    run(s, 1, () => [inp(BTN.S1)]);
    const k = p.skills.find((x) => x.skillId === 'a_fireline')!;
    expect(k.cooldown).toBeCloseTo(SKILL_BY_ID['a_fireline'].cooldownSec * 0.92 * 0.92, 6);
    expect(k.full).toBeCloseTo(k.cooldown, 9);
  });
});

describe('starting kit', () => {
  it('a new run owns every base skill at rank 1 for free and the hotbar is full for every class', () => {
    for (const c of CLASSES) {
      const s = newRun([c.id], 'KIT_' + c.id);
      const p = s.players[0];
      const base = NODES.filter((n) => n.classId === c.id && n.tier === 0 && n.grantsSkill);
      expect(base.length, c.id).toBe(c.branches.length);
      for (const n of base) { expect(n.starting, n.id).toBe(true); expect(p.ranks[n.id], n.id).toBe(1); }
      expect(p.skillPoints).toBe(RULES.startingSkillPoints);
      expect(Object.values(p.spentByBranch).reduce((a, b) => a + b, 0)).toBe(0);
      expect(p.skills.map((k) => k.skillId).every(Boolean), c.id).toBe(true);
      expect(p.skills[3].skillId).toBe(c.signatureSkill);
      const r = step(s, [], [{ type: 'ALLOCATE', slot: 0, nodeId: base[0].id }]);
      expect(r.outcomes[0]).toMatchObject({ ok: false, code: 'STARTING_GRANT' });
      // tier 1 is open from the start (the base skill used to cost the first point)
      const t1 = NODES.find((n) => n.classId === c.id && n.tier === 1 && !n.prereqs.length)!;
      expect(step(s, [], [{ type: 'ALLOCATE', slot: 0, nodeId: t1.id }]).outcomes[0].ok, t1.id).toBe(true);
    }
  });

  it('saved builds skip the auto-granted base nodes (they are `starting`)', () => {
    for (const c of CLASSES) for (const b of c.branches) {
      const n = NODES.find((x) => x.classId === c.id && x.branch === b.id && x.tier === 0 && x.grantsSkill)!;
      expect(NODE_BY_ID[n.id].starting).toBe(true);
      expect(n.costPerRank).toBe(0);
    }
  });

  it('the cooldown Mastery replaces the regeneration one', () => {
    const s = newRun(['ranger'], 'MASTERY_REC');
    const p = s.players[0];
    const before = derivePlayer(s, p).recovery;
    p.mastery.recovery = 2;
    expect(derivePlayer(s, p).recovery.toNumber()).toBeCloseTo(before.toNumber() * 1.05 * 1.05, 9);
  });
});

describe('boss reinforcements', () => {
  it('fire exactly once at 2/3 and once at 1/3 health, telegraphed, then arrive at the summoning circles', () => {
    const f = bossFight(['vanguard', 'ranger'], 'BOSS_ADDS_1');
    const adds = () => f.events.filter((e): e is Extract<SimEvent, { t: 'boss_adds' }> => e.t === 'boss_adds');
    const minions = () => f.s.enemies.filter((e) => e.summonerId === f.boss.id && e.state !== 'dying');
    f.setFrac(0.7); f.tick(30);
    expect(adds()).toHaveLength(0);
    f.setFrac(0.6); f.tick(1);
    expect(adds().map((e) => e.wave)).toEqual([1]);
    expect(adds()[0].n).toBe(bossReinforceUnits(2, 5, 1));
    const circles = f.s.telegraphs.filter((t) => t.attack === 'reinforce');
    expect(circles).toHaveLength(adds()[0].n);
    expect(minions()).toHaveLength(0);                                    // still telegraphing
    f.tick(Math.round(RULES.bossReinforceWarnSec * 60) + 2);
    expect(minions()).toHaveLength(adds()[0].n);
    for (const m of minions()) expect(m.objective).toBe(false);
    f.setFrac(0.5); f.tick(60);
    expect(adds()).toHaveLength(1);                                       // healing back over 2/3 and crossing again never re-fires
    f.setFrac(0.9); f.tick(5); f.setFrac(0.6); f.tick(5);
    expect(adds()).toHaveLength(1);
    f.setFrac(0.3); f.tick(1);
    expect(adds().map((e) => e.wave)).toEqual([1, 2]);
    f.setFrac(0.1); f.tick(200);
    expect(adds()).toHaveLength(2);
  });

  it('one blow through both thresholds calls both waves; scales with party size and round; deterministic', () => {
    const play = () => {
      const f = bossFight(['templar', 'arcanist', 'warden'], 'BOSS_ADDS_2');
      f.setFrac(0.2); f.tick(120);
      return f;
    };
    const a = play(), b = play();
    const waves = a.events.filter((e) => e.t === 'boss_adds');
    expect(waves.map((e) => (e as { wave: number }).wave)).toEqual([1, 2]);
    expect(stateHash(a.s)).toBe(stateHash(b.s));
    expect(serializeState(a.s)).toBe(serializeState(b.s));
    expect(bossReinforceUnits(3, 5, 1)).toBeGreaterThan(bossReinforceUnits(1, 5, 1));
    expect(bossReinforceUnits(1, 20, 1)).toBeGreaterThan(bossReinforceUnits(1, 5, 1));
    expect(bossReinforceUnits(1, 5, 2)).toBeGreaterThan(bossReinforceUnits(1, 5, 1));
  });
});

describe('enemy tactics', () => {
  /** A mobile, attacking foe for AI tests (tb.helpers spawns stationary, passive dummies). */
  const foe = (s: SimState, kind: string, x: number, y: number): EnemyState => {
    const e = spawn(s, x, y, { kind, hp: 1e6, speed: 3 });
    e.perceiveIn = 1;
    return e;
  };

  it('melee foes surround a hero instead of queueing behind each other', () => {
    const s = arena(['vanguard']);
    const p = s.players[0];
    p.x = 15; p.y = 15;
    const hounds = [0, 1, 2, 3].map((i) => foe(s, 'pursuer', 22 + i * 0.9, 15));   // a conga line east of the hero
    run(s, 150);
    const angles = hounds.map((e) => Math.atan2(e.y - p.y, e.x - p.x)).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 0; i < angles.length; i++) maxGap = Math.max(maxGap, ((angles[(i + 1) % angles.length] - angles[i]) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
    expect(maxGap).toBeLessThan(Math.PI * 1.5);                            // spread around, not all on one side
    for (const e of hounds) expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeLessThan(3);
  });

  it('foes step out of a hero\'s lingering ground fire', () => {
    const s = arena(['arcanist']);
    const p = s.players[0];
    const e = foe(s, 'hexer', 18, 10);
    s.hazards.push({
      id: s.nextId++, kind: 'a_crater', owner: 'player', ownerId: p.slot, x: 18, y: 10, dx: 1, dy: 0, length: 0, width: 0, radius: 2.4,
      inner: 0, outer: 0, speed: 0, bornTick: s.tick, untilTick: s.tick + 600, nextTick: s.tick + 9999, interval: 9999,
      damage: Big.from(1), dtype: 'ember', generation: 0, hitSlots: [],
    });
    run(s, 90);
    expect(Math.hypot(e.x - 18, e.y - 10)).toBeGreaterThan(2.4 + e.radius);
  });

  it('a badly hurt caster breaks off and regroups with its allies (once)', () => {
    const s = arena(['ranger']);
    const p = s.players[0];
    const caster = foe(s, 'hexer', 16, 10);
    foe(s, 'guardian', 22, 10);
    caster.cohort.front = caster.cohort.unitHp.mul(Big.from('0.8'));
    run(s, 8);
    expect(caster.action).toBe('regroup');
    expect(caster.fled).toBe(1);
    const d0 = Math.hypot(caster.x - p.x, caster.y - p.y);
    run(s, 60);
    expect(Math.hypot(caster.x - p.x, caster.y - p.y)).toBeGreaterThan(d0);
    run(s, 200);
    expect(caster.action).not.toBe('regroup');                            // the panic passes and never returns
  });

  it('predators pick the wounded hero over a healthy one at the same distance', () => {
    const s = arena(['vanguard', 'templar']);
    const [a, b] = s.players;
    a.x = 10; a.y = 8; b.x = 10; b.y = 12;
    b.hp = b.maxHp.mul(Big.from('0.2'));
    const e = foe(s, 'pursuer', 16, 10);
    run(s, 3);
    expect(e.targetSlot).toBe(b.slot);
  });
});

describe('content sanity', () => {
  it('every class keeps exactly one free signature and its basic attack', () => {
    for (const c of CLASSES) {
      expect(SKILL_BY_ID[c.signatureSkill].cooldownSec).toBeGreaterThan(0);
      expect(SKILL_BY_ID[c.basicSkill].cooldownSec).toBe(0);
      expect(CLASS_BY_ID[c.id]).toBe(c);
    }
  });
});
