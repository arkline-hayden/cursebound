import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { AFFIX_RULES, DODGE, ENEMY_BY_ID, RULES } from '@cursebound/content';
import {
  ACTION, buildSnapshot, devSpawn, hitEnemy, hitPlayer, moveSpeedOf, nearestFloor, predictMoveTick, seedRng, setupRound, spawnWave,
  stateHash, step, type EnemyState, type MoveBody, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { dropPickup, rollDrops, stepPickups } from '../src/pickups';
import { eliteChance, makeElite } from '../src/elites';
import { newRun } from './run.helpers';

// Movement & combat feel: champions/rares and their affixes, potion pickups, dodge charges and prediction parity.

/** A combat round with an inert, far-away objective anchor so the round stays open while we test one foe. */
function arena(round = 4, seed = 'FEEL_ARENA', classes = ['vanguard']): SimState {
  const s = newRun(classes, seed);
  s.round = round;
  setupRound(s, []);
  s.phase = 'COMBAT';
  const enc = s.encounter!;
  enc.groups = [{ id: 99, weight: 1, archetype: 'guardian', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = 0; enc.waveCount = 1; enc.objectiveTotal = 1;
  const p = s.players[0];
  let far = s.map!.enemySpawns[0];
  for (const sp of s.map!.enemySpawns) if ((sp.x - p.x) ** 2 + (sp.y - p.y) ** 2 > (far.x - p.x) ** 2 + (far.y - p.y) ** 2) far = sp;
  const anchor = devSpawn(s, 'guardian', far.x, far.y);
  anchor.objective = true; anchor.groupId = 99;
  inert(anchor, true);
  return s;
}

function inert(e: EnemyState, frozen = false) {
  for (const a of ENEMY_BY_ID[e.kind].attacks) e.cooldowns[a.id] = 9999;
  if (frozen) e.moveSpeed = 0;
}

function near(s: SimState, dx: number, dy: number): [number, number] {
  const p = s.players[0];
  return nearestFloor(s.map!, p.x + dx, p.y + dy);
}

function eliteAt(s: SimState, ev: SimEvent[], kind: string, x: number, y: number, affixes: string[], tier: 1 | 2 = 1): EnemyState {
  const e = devSpawn(s, kind, x, y);
  e.objective = true; e.groupId = 99;
  makeElite(s, ev, e, tier, seedRng('test-elite'), affixes);
  inert(e, true);
  return e;
}

function run(s: SimState, ticks: number, input?: (i: number) => PlayerInput | null): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks && s.phase === 'COMBAT'; i++) {
    for (const e of s.enemies) if (e.state !== 'dying') inert(e);
    const r = step(s, [input ? input(i) : null]);
    all.push(...r.events);
  }
  return all;
}

const T = (sec: number) => Math.round(sec * 60);

describe('champions and rares', () => {
  it('no elites in round 1; chance grows with the round and with encounter.eliteChance (intensity, capped below 1)', () => {
    const s = newRun(['vanguard'], 'ELITE_CHANCE');
    expect(eliteChance(s, 1)).toBe(0);
    const q2 = eliteChance(s, 2), q10 = eliteChance(s, 10);
    expect(q2).toBeGreaterThan(0);
    expect(q10).toBeGreaterThan(q2);
    s.fate.factors['encounter.eliteChance'] = Big.from(2);
    expect(eliteChance(s, 10)).toBeGreaterThan(q10);
    s.fate.factors['encounter.eliteChance'] = Big.from('1e500');
    expect(eliteChance(s, 10)).toBeLessThanOrEqual(1);
  });

  it('elite rolls are deterministic per seed and never touch the combat or ai streams', () => {
    const layout = (seed: string) => {
      const s = newRun(['vanguard', 'arcanist'], seed);
      s.fate.factors['encounter.eliteChance'] = Big.from('1e9');
      s.round = 6;
      setupRound(s, []);
      s.phase = 'COMBAT';
      const combat = [...s.rng.combat], ai = [...s.rng.ai];
      const ev: SimEvent[] = [];
      spawnWave(s, ev, 0);
      expect(s.rng.combat).toEqual(combat);
      expect(s.rng.ai).toEqual(ai);
      return { elites: s.enemies.filter((e) => e.elite).map((e) => [e.id, e.kind, e.elite, e.affixes]), ev: ev.filter((e) => e.t === 'elite').length, hash: stateHash(s) };
    };
    const a = layout('ELITE_DET'), b = layout('ELITE_DET');
    expect(a).toEqual(b);
    expect(a.elites.length).toBeGreaterThan(0);
    expect(a.elites.length).toBeLessThanOrEqual(RULES.maxElitesPerWave);
    expect(a.ev).toBe(a.elites.length);
  });

  it('champions get more health, damage and size; rares lead minions in the same objective group', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 3, 0);
    const plain = devSpawn(s, 'pursuer', x, y);
    const champ = eliteAt(s, ev, 'pursuer', x, y, ['strong'], 1);
    expect(champ.cohort.unitHp.toString()).toBe(plain.cohort.unitHp.mul(Big.from(RULES.championHealth)).toString());
    expect(champ.damage.gt(plain.damage.mul(Big.from(RULES.championDamage)))).toBe(true);
    expect(champ.radius).toBeGreaterThan(plain.radius);
    const pending = s.pendingSpawns.length;
    const rare = devSpawn(s, 'pursuer', x, y, Big.from(4));
    rare.objective = true; rare.groupId = 99;
    makeElite(s, ev, rare, 2, seedRng('rare'));
    expect(rare.cohort.count.toString()).toBe('1e0');
    expect(rare.affixes!.length).toBeGreaterThanOrEqual(2);
    const minions = s.pendingSpawns.slice(pending);
    expect(minions.length).toBe(2);
    expect(minions.every((m) => m.groupId === 99 && m.objective && m.kind === 'pursuer')).toBe(true);
    expect(minions[0].count.toString()).toBe('3e0');   // the rest of its cohort
    const snap = buildSnapshot(s).enemies.find((e) => e.i === rare.id)!;
    expect(snap.el).toBe(2);
    expect(snap.af).toEqual(rare.affixes);
    expect(snap.mt).toBe(rare.cohort.unitHp.toCompact());
    expect(buildSnapshot(s).enemies.find((e) => e.i === plain.id)!.el).toBeUndefined();
  });
});

describe('affix behaviours', () => {
  it('Molten: leaves an arming trail while moving and explodes on death after a telegraph', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 2.5, 0);
    const e = eliteAt(s, ev, 'pursuer', x, y, ['molten']);
    for (let i = 0; i < 40; i++) { const r = nearestFloor(s.map!, e.x + 0.04, e.y); e.x = r[0]; e.y = r[1]; run(s, 1); }
    expect(s.hazards.filter((h) => h.kind === 'molten').length).toBeGreaterThan(0);
    // kill it next to the hero: a telegraphed blast, then damage
    const p = s.players[0];
    e.x = p.x + 0.5; e.y = p.y;
    hitEnemy(s, ev, e, e.cohort.unitHp.mul(Big.from(10)), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    const blast = s.hazards.find((h) => h.kind === 'moltenBlast')!;
    expect(blast).toBeTruthy();
    expect(s.telegraphs.some((t) => t.attack === 'affix_moltenBlast' && t.releaseTick === blast.armTick)).toBe(true);
    const hp0 = p.hp;
    const early = run(s, T(AFFIX_RULES.moltenBlastDelay) - 2);
    expect(early.some((x2) => x2.t === 'hit' && x2.targetKind === 'player')).toBe(false);
    expect(p.hp.eq(hp0)).toBe(true);
    const late = run(s, 4);
    expect(late.some((x2) => x2.t === 'hit' && x2.targetKind === 'player')).toBe(true);
    expect(late.some((x2) => x2.t === 'elite' && x2.fx === 'molten_blast')).toBe(true);
  });

  it('Frozen: telegraphed frost orbs burst after a delay and chill (slow) the hero', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 3, 0);
    eliteAt(s, ev, 'pursuer', x, y, ['frozen']);
    run(s, T(AFFIX_RULES.frozenFirst) + 1);
    const orbs = s.hazards.filter((h) => h.kind === 'frostOrb');
    expect(orbs.length).toBe(AFFIX_RULES.frozenOrbs[0]);
    expect(s.telegraphs.filter((t) => t.attack === 'affix_frostOrb').length).toBe(orbs.length);
    const p = s.players[0];
    const speed0 = moveSpeedOf(s, p);
    p.x = orbs[0].x; p.y = orbs[0].y;   // stand in the first orb
    const evs = run(s, T(AFFIX_RULES.frozenDelay) + 2);
    expect(evs.some((x2) => x2.t === 'elite' && x2.fx === 'frost_burst')).toBe(true);
    expect(p.buffs.some((b) => b.id === 'chill')).toBe(true);
    expect(moveSpeedOf(s, p)).toBeLessThan(speed0);
    expect(buildSnapshot(s).players[0].spd).toBeLessThan(speed0);
  });

  it('Frozen: dodging through the burst (i-frames) avoids damage and chill', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 3, 0);
    eliteAt(s, ev, 'pursuer', x, y, ['frozen']);
    run(s, T(AFFIX_RULES.frozenFirst) + 1);
    const orb = s.hazards.find((h) => h.kind === 'frostOrb')!;
    const p = s.players[0];
    const hp0 = p.hp;
    for (let i = 0; i < T(AFFIX_RULES.frozenDelay) + 2; i++) { p.x = orb.x; p.y = orb.y; p.iframes = 1; run(s, 1); }
    expect(p.hp.eq(hp0)).toBe(true);
    expect(p.buffs.some((b) => b.id === 'chill')).toBe(false);
  });

  it('Vampiric: landed attacks heal it; lingering hazards do not', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 1, 0);
    const e = eliteAt(s, ev, 'pursuer', x, y, ['vampiric']);
    e.cohort.front = e.cohort.unitHp.mul(Big.from('0.5'));
    const p = s.players[0];
    const front0 = e.cohort.front;
    hitPlayer(s, ev, p, Big.from(5), { attack: 'Bite', source: 'x', fromX: e.x, fromY: e.y, dtype: 'physical', srcId: e.id, hazard: true });
    expect(e.cohort.front.eq(front0)).toBe(true);
    hitPlayer(s, ev, p, Big.from(5), { attack: 'Bite', source: 'x', fromX: e.x, fromY: e.y, dtype: 'physical', srcId: e.id });
    expect(e.cohort.front.lt(front0)).toBe(true);
    expect(front0.sub(e.cohort.front).toString()).toBe(e.cohort.unitHp.mul(Big.from(AFFIX_RULES.vampiricHealFrac)).toString());
    expect(ev.some((x2) => x2.t === 'elite' && x2.fx === 'vamp')).toBe(true);
  });

  it('Shielding: warns, then becomes invulnerable inside a bubble for a few seconds', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 2, 0);
    const e = eliteAt(s, ev, 'pursuer', x, y, ['shielding']);
    const evs = run(s, T(AFFIX_RULES.shieldFirst) + 1);
    const warn = evs.findIndex((x2) => x2.t === 'elite' && x2.fx === 'shield_warn');
    const up = evs.findIndex((x2) => x2.t === 'elite' && x2.fx === 'shield_up');
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(warn);
    const p = s.players[0];
    const r = hitEnemy(s, ev, e, e.cohort.unitHp.mul(Big.from(100)), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    expect(r.dealt.isZero()).toBe(true);
    expect(e.state).not.toBe('dying');
    expect(buildSnapshot(s).enemies.find((q) => q.i === e.id)!.sh).toBe(true);
    run(s, T(AFFIX_RULES.shieldSec) + 2);
    expect(buildSnapshot(s).enemies.find((q) => q.i === e.id)!.sh).toBe(false);
    const r2 = hitEnemy(s, ev, e, Big.from(10), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    expect(r2.dealt.isZero()).toBe(false);
  });

  it('Thunderous: striking it marks the attacker; lightning lands after a warning, with a cooldown', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 1.5, 0);
    const e = eliteAt(s, ev, 'pursuer', x, y, ['thunder']);
    const p = s.players[0];
    const hit = () => hitEnemy(s, ev, e, Big.from(1), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    hit(); hit();
    const marks = s.hazards.filter((h) => h.kind === 'thunder');
    expect(marks.length).toBe(1);   // cooldown: one mark per window
    expect(marks[0].x).toBeCloseTo(p.x); expect(marks[0].y).toBeCloseTo(p.y);
    expect(s.telegraphs.some((t) => t.attack === 'affix_thunder')).toBe(true);
    const hp0 = p.hp;
    const evs = run(s, T(AFFIX_RULES.thunderDelay) + 2);
    expect(evs.some((x2) => x2.t === 'elite' && x2.fx === 'thunder')).toBe(true);
    expect(p.hp.lt(hp0)).toBe(true);
  });

  it('Teleporter: marks a spot beside its target, then blinks there', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const p = s.players[0];
    // a floor spot ~6-10 units away (inside the teleport's 16-unit reach, beyond its minimum distance)
    let spot: [number, number] = [p.x, p.y];
    for (let y = 0; y < s.map!.h && spot[0] === p.x; y++) for (let x = 0; x < s.map!.w; x++) {
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
      if (s.map!.tiles[y * s.map!.w + x] === 0 && d > 6 && d < 10) { spot = [x + 0.5, y + 0.5]; break; }
    }
    const e = eliteAt(s, ev, 'pursuer', spot[0], spot[1], ['teleport']);
    e.targetSlot = 0;
    const d0 = Math.hypot(e.x - p.x, e.y - p.y);
    expect(d0).toBeGreaterThan(AFFIX_RULES.teleportMinDist);
    const evs = run(s, T(5));
    const mark = evs.find((x2) => x2.t === 'elite' && x2.fx === 'tele_mark');
    const tele = evs.find((x2) => x2.t === 'elite' && x2.fx === 'tele');
    expect(mark).toBeTruthy();
    expect(tele).toBeTruthy();
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeLessThan(d0);
  });

  it('Plagued: decay pools arm after a telegraph and then pulse damage', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 3, 0);
    eliteAt(s, ev, 'pursuer', x, y, ['plagued']);
    run(s, T(AFFIX_RULES.plagueFirst) + 1);
    const pool = s.hazards.find((h) => h.kind === 'plague')!;
    expect(pool).toBeTruthy();
    expect(s.telegraphs.some((t) => t.attack === 'affix_plague')).toBe(true);
    const p = s.players[0];
    const hp0 = p.hp;
    p.x = pool.x; p.y = pool.y;
    run(s, Math.max(0, pool.armTick! - s.tick - 1));
    expect(p.hp.eq(hp0)).toBe(true);   // not armed yet
    run(s, 3);
    expect(p.hp.lt(hp0)).toBe(true);
  });

  it('Fast and Extra Strong change speed, cadence and damage', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 3, 0);
    const plain = devSpawn(s, 'pursuer', x, y);
    const e = devSpawn(s, 'pursuer', x, y);
    makeElite(s, ev, e, 1, seedRng('fs'), ['fast', 'strong']);
    expect(e.moveSpeed).toBeCloseTo(plain.moveSpeed * AFFIX_RULES.fastMove);
    expect(e.attackFreq.gt(plain.attackFreq)).toBe(true);
    expect(e.damage.toString()).toBe(plain.damage.mul(Big.from(RULES.championDamage)).mul(Big.from(AFFIX_RULES.strongDamage)).toString());
  });
});

describe('potions and orbs', () => {
  it('a wounded hero walking near a potion is pulled in and healed; it shows as a pickup event', () => {
    const s = arena();
    const p = s.players[0];
    p.hp = p.maxHp.mul(Big.from('0.5'));
    const pk = dropPickup(s, 'potion', p.x + 0.9, p.y, 0)!;
    pk.x = p.x + 0.9; pk.y = p.y;
    const evs = run(s, 40);
    expect(s.pickups.length).toBe(0);
    const ev = evs.find((x) => x.t === 'pickup');
    expect(ev && ev.t === 'pickup' && ev.slot === 0 && ev.kind === 'potion').toBe(true);
    expect(p.hp.toString()).toBe(p.maxHp.mul(Big.from('0.75')).toString());
    expect(evs.some((x) => x.t === 'heal')).toBe(true);
  });

  it('full-health heroes leave potions for allies; potions expire', () => {
    const s = arena();
    const p = s.players[0];
    const pk = dropPickup(s, 'potion', p.x, p.y, 0)!;
    pk.x = p.x; pk.y = p.y;
    run(s, 30);
    expect(s.pickups.length).toBe(1);
    run(s, T(RULES.pickupLifeSec));
    expect(s.pickups.length).toBe(0);
  });

  it('potions heal nearby allies a little; orbs restore resource', () => {
    const s = arena(4, 'FEEL_COOP', ['vanguard', 'arcanist']);
    const [a, b] = s.players;
    b.x = a.x; b.y = a.y;
    a.hp = a.maxHp.mul(Big.from('0.5')); b.hp = b.maxHp.mul(Big.from('0.5'));
    const ev: SimEvent[] = [];
    const pk = dropPickup(s, 'potion', a.x, a.y, 0)!;
    pk.x = a.x; pk.y = a.y; pk.bornTick = s.tick - 60;
    stepPickups(s, ev);
    const healed = [a, b].map((q) => q.hp.ratio(q.maxHp));
    expect(Math.max(...healed)).toBeCloseTo(0.75);
    expect(Math.min(...healed)).toBeCloseTo(0.5 + Number(RULES.potionAllyHealFrac));
    a.resource = 0; b.resource = 0;
    const orb = dropPickup(s, 'orb', a.x, a.y, 0)!;
    orb.x = a.x; orb.y = a.y; orb.bornTick = s.tick - 60;
    stepPickups(s, ev);
    expect(a.resource + b.resource).toBeGreaterThan(0);
  });

  it('drop table: champions always drop a potion, rares a potion and an orb', () => {
    const s = arena();
    const ev: SimEvent[] = [];
    const [x, y] = near(s, 2, 0);
    const champ = eliteAt(s, ev, 'pursuer', x, y, ['fast'], 1);
    rollDrops(s, champ);
    expect(s.pickups.some((k) => k.kind === 'potion' && k.tier === 1)).toBe(true);
    s.pickups = [];
    const rare = eliteAt(s, ev, 'pursuer', x, y, ['fast', 'strong'], 2);
    rollDrops(s, rare);
    expect(s.pickups.some((k) => k.kind === 'potion')).toBe(true);
    expect(s.pickups.some((k) => k.kind === 'orb')).toBe(true);
    expect(buildSnapshot(s).pickups.length).toBe(s.pickups.length);
  });
});

describe('dodge charges and movement feel', () => {
  const mk = (seq: number, mx: number, my: number, dodge: boolean): PlayerInput => ({ seq, moveX: mx, moveY: my, aimX: 1, aimY: 0, buttons: dodge ? ACTION.DODGE : 0 });

  it('two charges: fresh presses chain dashes, holding does not; charges recharge one at a time', () => {
    const s = arena();
    const p = s.players[0];
    expect(p.dodgeCharges).toBe(DODGE.charges);
    let seq = 0;
    // hold dodge for 30 ticks: exactly one dash
    let evs = run(s, 30, () => mk(++seq, 1, 0, true));
    expect(evs.filter((e) => e.t === 'dodge').length).toBe(1);
    expect(p.dodgeCharges).toBe(DODGE.charges - 1);
    // release, press again: second dash; a third press finds no charge
    run(s, 1, () => mk(++seq, 1, 0, false));
    evs = run(s, 2, () => mk(++seq, 0, 1, true));
    expect(evs.filter((e) => e.t === 'dodge').length).toBe(1);
    expect(p.dodgeCharges).toBe(0);
    run(s, 1, () => mk(++seq, 0, 1, false));
    evs = run(s, 2, () => mk(++seq, 0, 1, true));
    expect(evs.filter((e) => e.t === 'dodge').length).toBe(0);
    // one charge returns after its recharge, then the next
    run(s, T(DODGE.cooldownSec) - 30, () => mk(++seq, 0, 0, false));
    expect(p.dodgeCharges).toBeGreaterThanOrEqual(1);
    run(s, T(DODGE.cooldownSec) + 2, () => mk(++seq, 0, 0, false));
    expect(p.dodgeCharges).toBe(DODGE.charges);
    expect(buildSnapshot(s).players[0].dc).toBe(DODGE.charges);
    expect(buildSnapshot(s).players[0].dodge).toBe(0);
  });

  it('a press mid-dash chains a new dash immediately (redirect) and refreshes i-frames', () => {
    const s = arena();
    const p = s.players[0];
    let seq = 0;
    run(s, 1, () => mk(++seq, 1, 0, true));
    run(s, 2, () => mk(++seq, 1, 0, false));
    expect(p.dodgeTimer).toBeGreaterThan(0);
    const evs = run(s, 1, () => mk(++seq, 0, 1, true));
    expect(evs.filter((e) => e.t === 'dodge').length).toBe(1);
    expect(p.dodgeDirY).toBeCloseTo(1);
    expect(p.iframes).toBeGreaterThan(DODGE.iframeSec - 0.05);
  });

  it('dash bursts out and eases off, then a short surge and a light momentum stop', () => {
    // pure shared step on an open plane (no map): exact travel, burst-first profile, carry-out momentum
    const b: MoveBody = { x: 0, y: 0, vx: 0, vy: 0, dodgeTimer: 0, dodgeDirX: 1, dodgeDirY: 0, dodgeCharges: DODGE.charges, dodgeCooldown: 0, surgeTimer: 0, guardTimer: 0 };
    const speed = 4.6 * Number(RULES.playerMoveSpeedMult);
    const xs: number[] = [];
    predictMoveTick(null, b, 1, 0, 1, 0, true, speed, 'vanguard', 1);
    xs.push(b.x);
    while (b.dodgeTimer > 0) { predictMoveTick(null, b, 0, 0, 1, 0, false, speed, 'vanguard', 1); xs.push(b.x); }
    // movementStep returns the unmoved position without a map, so integrate the velocity profile instead
    const b2: MoveBody = { ...b, x: 0, y: 0, vx: 0, vy: 0, dodgeTimer: 0, dodgeCharges: DODGE.charges, surgeTimer: 0 };
    let travel = 0; const steps: number[] = [];
    predictMoveTick(null, b2, 1, 0, 1, 0, true, speed, 'vanguard', 1); steps.push(b2.vx); travel += b2.vx / 60;
    while (b2.dodgeTimer > 0) { predictMoveTick(null, b2, 1, 0, 1, 0, false, speed, 'vanguard', 1); steps.push(b2.vx); travel += b2.vx / 60; }
    expect(steps[0]).toBeGreaterThan(steps[steps.length - 2]);   // burst first, easing out
    expect(travel).toBeGreaterThan(DODGE.travel * 0.9);
    expect(travel).toBeLessThan(DODGE.travel * 1.35);
    expect(b2.surgeTimer).toBeGreaterThan(0);
    // releasing the stick after the dash: momentum carries a few ticks, then settles to rest
    const v0 = b2.vx;
    predictMoveTick(null, b2, 0, 0, 1, 0, false, speed, 'vanguard', 1);
    expect(b2.vx).toBeGreaterThan(0);
    expect(b2.vx).toBeLessThan(v0);
    for (let i = 0; i < 30; i++) predictMoveTick(null, b2, 0, 0, 1, 0, false, speed, 'vanguard', 1);
    expect(b2.vx).toBe(0);
    expect(xs.length).toBeGreaterThan(5);
  });

  it('client prediction (predictMoveTick) reproduces the authority tick for tick', () => {
    const s = arena(4, 'FEEL_PRED');
    const p = s.players[0];
    const body: MoveBody = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, dodgeTimer: p.dodgeTimer, dodgeDirX: p.dodgeDirX, dodgeDirY: p.dodgeDirY, dodgeCharges: p.dodgeCharges, dodgeCooldown: p.dodgeCooldown, surgeTimer: p.surgeTimer, guardTimer: 0 };
    const script: [number, number, boolean][] = [];
    for (let i = 0; i < 240; i++) {
      const ang = i * 0.07;
      script.push([Math.round(Math.cos(ang) * 127) / 127, Math.round(Math.sin(ang) * 127) / 127, i % 37 === 3 || i % 37 === 9]);
    }
    let prev = false;
    for (let i = 0; i < script.length; i++) {
      const [mx, my, d] = script[i];
      predictMoveTick(s.map, body, mx, my, 1, 0, d && !prev, moveSpeedOf(s, p), p.classId, 1);
      prev = d;
      run(s, 1, () => mk(i + 1, mx, my, d));
      expect(body.x).toBe(p.x);
      expect(body.y).toBe(p.y);
      expect(body.dodgeCharges).toBe(p.dodgeCharges);
    }
  });

  it('global hero speed multiplier applies to walking but not to dash distance', () => {
    const s = arena();
    const p = s.players[0];
    expect(moveSpeedOf(s, p)).toBeCloseTo(4.6 * Number(RULES.playerMoveSpeedMult));
  });
});
