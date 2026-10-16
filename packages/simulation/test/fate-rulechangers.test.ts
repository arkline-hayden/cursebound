import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { MECHANICS, MECHANIC_BASE_MAGNITUDE, MECHANIC_BY_ID } from '@cursebound/content';
import {
  B, BOON_HOOKS, GRASP_WARN_SEC, applyCard, createEnemy, bindMechanic, buildSnapshot, cohortTotalHp, computeForecast, computeLedger, deserializeState, devSpawn, hitEnemy,
  hitPlayer, killEnemy, mech, pandoraMagnitude, playerDerived, serializeState, stackMagnitudes, stateHash, step, stepPlayerHazard,
  stepPlayerProjectile, type EnemyState, type Projectile, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun, runBot } from './run.helpers';

// The rule-changer wave of Fate mechanics (boons.ts): Shadow Twin, Grave Thralls, Last Stand, Gravity Well, Momentum,
// Mirror Ward, Pandora's Gift / Curse, Blood Price, Restless Dead, Grave Hands and Shadow Pact. Each triggers as written,
// stacks multiplicatively and stays deterministic.

const ONE = Big.ONE;

/** A run sitting in round-1 combat with the arena emptied, so tests place their own foes. */
function arena(classes: string[] = ['vanguard'], seed = 'FATE_WAVE2'): SimState {
  const s = newRun(classes, seed);
  for (let i = 0; i < 4000 && s.phase !== 'COMBAT'; i++) {
    const cmds = s.phase === 'LOADOUT_LOCK' ? s.players.filter((p) => !p.ready).map((p) => ({ type: 'READY' as const, slot: p.slot, ready: true })) : [];
    step(s, [], cmds);
  }
  expect(s.phase).toBe('COMBAT');
  s.enemies = []; s.projectiles = []; s.hazards = []; s.telegraphs = []; s.pendingSpawns = [];
  s.fate.factors['player.critTendency'] = Big.ZERO;
  s.stateVersion++;
  return s;
}

function toVoting(classes: string[], seed = 'FATE_VOTE2'): SimState {
  const s = newRun(classes, seed);
  for (let i = 0; i < 100000 && s.phase !== 'VOTING'; i++) {
    const cmds: Parameters<typeof step>[2] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'COMBAT') { for (const p of s.players) p.iframes = 10; for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0); }
    step(s, [], cmds);
  }
  return s;
}

const bind = (s: SimState, id: string, magnitude: string, copies = 1) => {
  for (let i = 0; i < copies; i++) bindMechanic(s, id, magnitude, { offerId: 'test', cardId: 'test', seq: i });
};

function foe(s: SimState, dx: number, dy = 0, count = ONE, hp = B('1e12')): EnemyState {
  const p = s.players[0];
  const e = devSpawn(s, 'pursuer', p.x + dx, p.y + dy, count);
  e.cohort.unitHp = hp;
  e.dormant = false;
  return e;
}

const strike = (s: SimState, ev: SimEvent[], e: EnemyState, dmg: Big, generation = 0) =>
  hitEnemy(s, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: 0, skillId: 'v_cleave', fromX: s.players[0].x, fromY: s.players[0].y, allowCrit: false, generation });

/** One tick of the Fate machinery without the round flow: player hazards, the global tick. */
function tick(s: SimState, ev: SimEvent[]) {
  s.tick++;
  if (s.encounter) s.encounter.activeTicks++;
  for (const h of [...s.hazards]) if (h.owner === 'player') stepPlayerHazard(s, ev, h);
  s.hazards = s.hazards.filter((h) => h.untilTick > s.tick);
  BOON_HOOKS.onTick!(s, ev);
}

const casts = (ev: SimEvent[], skill: string) => ev.filter((e) => e.t === 'cast' && e.skill === skill).length;
const lost = (e: EnemyState, before: Big) => before.sub(cohortTotalHp(e.cohort));
const hurt = (s: SimState, amount: Big) => hitPlayer(s, [], s.players[0], amount, { attack: 'test', source: 'test', fromX: s.players[0].x, fromY: s.players[0].y, dtype: 'physical' });

describe('stacking stays multiplicative', () => {
  it('compound, chance and factor rules for the new mechanics', () => {
    expect(stackMagnitudes('shadow_twin', ['0.35', '0.35']).toString()).toBe('8.225e-1');
    expect(stackMagnitudes('restless_dead', ['0.2', '0.2']).toString()).toBe('3.6e-1');
    expect(stackMagnitudes('gravity_well', ['2', '5']).toString()).toBe('1e1');
    expect(stackMagnitudes('pandora', ['1.5', '1.5']).toString()).toBe('2.25e0');
    expect(stackMagnitudes('blood_price', ['0.05', '0.05']).toString()).toBe('1.025e-1');
  });
  it('cards bind with Ledger provenance and survive a checkpoint', () => {
    const s = newRun(['vanguard']);
    applyCard(s, 'shadow_twin', 'o1', []);
    applyCard(s, 'doppelganger', 'o2', []);
    expect(s.fate.mechanics!.shadow_twin.stacks).toBe(2);
    expect(mech(s, 'shadow_twin')!.toString()).toBe('1.43e0');            // 1.35 × 1.8 − 1
    expect(mech(s, 'shadow_pact')!.toString()).toBe('9.4e-1');            // 1 − 0.4 × 0.15
    const back = deserializeState(serializeState(s));
    expect(stateHash(back)).toBe(stateHash(s));
  });
});

describe('boons', () => {
  it('Shadow Twin: the shade banks direct damage and repeats a share on its strike; copies multiply', () => {
    const run = (copies: number) => {
      const s = arena(); bind(s, 'shadow_twin', '0.5', copies);
      const p = s.players[0]; const ev: SimEvent[] = [];
      BOON_HOOKS.onPlayerTick!(s, ev, p);
      expect(s.hazards.filter((h) => h.kind === 'fate_shade')).toHaveLength(1);
      BOON_HOOKS.onPlayerTick!(s, ev, p);
      expect(s.hazards.filter((h) => h.kind === 'fate_shade')).toHaveLength(1);   // one shade per hero
      const e = foe(s, 1);
      const dealt = strike(s, ev, e, B(1000)).dealt;
      strike(s, ev, e, B(1000), 1);                                     // follow-up hits are never banked
      const before = cohortTotalHp(e.cohort);
      for (let i = 0; i < 30; i++) tick(s, ev);
      expect(casts(ev, 'boon_shadow_twin')).toBe(1);
      for (let i = 0; i < 30; i++) tick(s, ev);
      expect(casts(ev, 'boon_shadow_twin')).toBe(1);                    // nothing banked, nothing repeated
      return lost(e, before).ratio(dealt);
    };
    const one = run(1), two = run(2);
    expect(one).toBeGreaterThan(0.3);
    expect(two / one).toBeCloseTo(1.25 / 0.5, 6);
  });
  it('Grave Thralls: every 6th kill and every slain elite raise a thrall; capped per hero; thralls hunt and strike', () => {
    const s = arena(); bind(s, 'grave_thralls', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const thralls = () => s.hazards.filter((h) => h.kind === 'fate_thrall' && h.untilTick > s.tick);
    for (let i = 0; i < 5; i++) strike(s, ev, foe(s, 6, i * 0.1, ONE, B(10)), B(1000));
    expect(thralls()).toHaveLength(0);
    strike(s, ev, foe(s, 6, 0, ONE, B(10)), B(1000));
    expect(thralls()).toHaveLength(1);
    const elite = foe(s, 6, 1, ONE, B(10)); elite.elite = 1;
    strike(s, ev, elite, B(1000));
    expect(thralls()).toHaveLength(2);
    for (let i = 0; i < 4; i++) { const el = foe(s, 6, 2, ONE, B(10)); el.elite = 2; strike(s, ev, el, B(1000)); }
    expect(thralls()).toHaveLength(3);                                  // the oldest crumbles past the cap
    expect(casts(ev, 'boon_grave_thralls')).toBe(6);
    // a sturdy foe near the thralls: they rise, close in and strike for the hero's damage
    const target = foe(s, 4, 0);
    const before = cohortTotalHp(target.cohort);
    const banked = p.vars.boon_thrall_kills;
    for (let i = 0; i < 180; i++) tick(s, ev);
    expect(lost(target, before).gt(Big.ZERO)).toBe(true);
    const pd = playerDerived(s, p);
    expect(thralls()[0].damage.toString()).toBe(pd.damage.mul(pd.typeMult.physical).mul(B('0.5')).toString());
    expect(p.vars.boon_thrall_kills).toBe(banked);                      // thrall blows never count toward more thralls
  });
  it('Last Stand: below the line heroes hit harder and take half; announced once per crossing', () => {
    const s = arena(); bind(s, 'last_stand', '0.5');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const full = strike(s, ev, foe(s, 1), B(1000)).dealt;
    p.hp = p.maxHp.mul(B('0.2'));
    const low = strike(s, ev, foe(s, 1), B(1000)).dealt;
    expect(low.ratio(full)).toBeCloseTo(1.5, 9);
    // damage taken: half below the line, judged on health before the blow
    const h0 = p.hp;
    hurt(s, p.maxHp.mul(B('0.1')));
    const taken = h0.sub(p.hp);
    p.hp = p.maxHp;
    const h1 = p.hp;
    hurt(s, p.maxHp.mul(B('0.1')));
    expect(taken.ratio(h1.sub(p.hp))).toBeCloseTo(0.5, 9);
    // a blow larger than what is left, but not twice as large, leaves a wounded hero standing
    p.hp = p.maxHp.mul(B('0.1')); p.iframes = 0;
    hurt(s, p.maxHp.mul(B('0.15')).div(playerDerived(s, p).incomingFactor));
    expect(p.lifeState).toBe('alive');
    // crossing announcement
    p.hp = p.maxHp; BOON_HOOKS.onPlayerTick!(s, ev, p);
    p.hp = p.maxHp.mul(B('0.3')); BOON_HOOKS.onPlayerTick!(s, ev, p); BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(casts(ev, 'boon_last_stand')).toBe(1);
  });
  it('Gravity Well: a crit drags nearby foes inward and crushes them; bosses hold; per-hero cooldown', () => {
    const s = arena(); bind(s, 'gravity_well', '2');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const centre = foe(s, 2), near = foe(s, 4), far = foe(s, 12);
    const boss = createEnemy(s, 'prismstag', p.x + 2, p.y + 1.5, ONE, { boss: true, objective: false, groupId: -1, summonerId: null });
    s.enemies.push(boss);
    const nB = cohortTotalHp(near.cohort), fB = cohortTotalHp(far.cohort);
    const crit = () => BOON_HOOKS.onEnemyHit!(s, ev, p, centre, { dealt: B(10), crit: true, kill: false, dtype: 'physical', skillId: 'v_cleave', srcSlot: 0, fromX: p.x, fromY: p.y, generation: 0 });
    crit();
    expect(casts(ev, 'boon_gravity_well')).toBe(1);
    expect(near.knockX).toBeLessThan(0);                               // sliding toward the well (it sits west of the foe)
    expect(lost(near, nB).gt(Big.ZERO)).toBe(true);
    expect(lost(far, fB).isZero()).toBe(true);
    expect(boss.knockX === 0 && boss.knockY === 0).toBe(true);           // bosses hold their ground
    crit();
    expect(casts(ev, 'boon_gravity_well')).toBe(1);                    // cooling down
    s.tick += 120;
    crit();
    expect(casts(ev, 'boon_gravity_well')).toBe(2);
    // not on ordinary hits
    BOON_HOOKS.onEnemyHit!(s, ev, p, centre, { dealt: B(10), crit: false, kill: false, dtype: 'physical', skillId: 'v_cleave', srcSlot: 0, fromX: p.x, fromY: p.y, generation: 0 });
    s.tick += 120;
    BOON_HOOKS.onEnemyHit!(s, ev, p, centre, { dealt: B(10), crit: false, kill: false, dtype: 'physical', skillId: 'v_cleave', srcSlot: 0, fromX: p.x, fromY: p.y, generation: 0 });
    expect(casts(ev, 'boon_gravity_well')).toBe(2);
  });
  it('Momentum: travel charges the next hit; the release covers that whole tick, then resets', () => {
    const s = arena(); bind(s, 'momentum', '1');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const base = strike(s, ev, foe(s, 1), B(1000)).dealt;
    // walk 6 units in half-unit steps (charging), plus one blink that only counts as one capped stride
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    for (let i = 0; i < 11; i++) { p.x += 0.5; BOON_HOOKS.onPlayerTick!(s, ev, p); }
    expect(p.vars.boon_mo).toBeCloseTo(5.5, 9);
    expect(casts(ev, 'boon_momentum_ready')).toBe(0);
    p.x += 30; BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(p.vars.boon_mo).toBe(6);
    expect(casts(ev, 'boon_momentum_ready')).toBe(1);
    const a = strike(s, ev, foe(s, 1), B(1000)).dealt;
    const b = strike(s, ev, foe(s, 1.2), B(1000)).dealt;               // same tick: shares the release
    expect(a.ratio(base)).toBeCloseTo(2, 9);
    expect(b.ratio(base)).toBeCloseTo(2, 9);
    s.tick++;
    expect(strike(s, ev, foe(s, 1), B(1000)).dealt.ratio(base)).toBeCloseTo(1, 9);
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(casts(ev, 'boon_momentum')).toBe(1);
  });
  it('Mirror Ward: shots near a fresh dodge turn on their sender at the hero\'s damage', () => {
    const s = arena(); bind(s, 'mirror_ward', '3');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const src = foe(s, -2.5);
    const shot = (): Projectile => ({ id: s.nextId++, kind: 'shadebolt', owner: 'enemy', ownerId: src.id, x: p.x - 0.8, y: p.y, vx: 8, vy: 0, radius: 0.2, range: 6, damage: B(50), weight: B(4), dtype: 'astral', pierce: 0, hitIds: [], skillId: 'shadebolt', crit: false, lobTarget: null, bornTick: s.tick });
    const early = shot(); s.projectiles.push(early);
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(early.owner).toBe('enemy');                                 // no dodge, no reflection
    BOON_HOOKS.onDodge!(s, ev, p);
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(early.owner).toBe('player');
    expect(early.vx).toBeLessThan(0);                                  // back toward the sender
    const pd = playerDerived(s, p);
    expect(early.damage.toString()).toBe(pd.damage.mul(pd.typeMult.astral).mul(B(3)).toString());
    expect(early.weight.toString()).toBe(ONE.toString());
    expect(casts(ev, 'boon_mirror_ward')).toBe(1);
    const before = cohortTotalHp(src.cohort);
    for (let i = 0; i < 60 && stepPlayerProjectile(s, ev, early); i++) s.tick++;
    expect(lost(src, before).gt(Big.ZERO)).toBe(true);
    s.tick += 60;
    const late = shot(); s.projectiles.push(late);
    BOON_HOOKS.onPlayerTick!(s, ev, p);
    expect(late.owner).toBe('enemy');                                  // the window closed
  });
  it("Pandora's Gift and Curse roll one boon and one bane per round, deterministically, and clear the next round", () => {
    const roll = () => {
      const s = arena(['vanguard'], 'PANDORA'); bind(s, 'pandora', '1.5'); bind(s, 'pandora_curse', '1.25');
      const ev: SimEvent[] = [];
      BOON_HOOKS.onRoundStart!(s, ev);
      return { s, ev };
    };
    const { s, ev } = roll();
    const ids = Object.keys(s.fate.rolled ?? {});
    expect(ids).toHaveLength(2);
    const boon = ids.find((id) => MECHANIC_BY_ID[id].kind === 'boon')!, bane = ids.find((id) => MECHANIC_BY_ID[id].kind === 'bane')!;
    expect(boon && bane).toBeTruthy();
    expect(mech(s, boon)!.toString()).toBe(stackMagnitudes(boon, [pandoraMagnitude(MECHANIC_BY_ID[boon], 1.5)]).toString());
    expect(mech(s, bane)!.toString()).toBe(stackMagnitudes(bane, [pandoraMagnitude(MECHANIC_BY_ID[bane], 1.25)]).toString());
    const c = ev.find((e) => e.t === 'cast' && e.skill === 'boon_pandora') as Extract<SimEvent, { t: 'cast' }>;
    expect(MECHANICS[c.dx].id).toBe(boon);
    expect(MECHANICS[c.dy].id).toBe(bane);
    expect(Object.keys(roll().s.fate.rolled!)).toEqual(ids);           // same seed, same roll
    const led = computeLedger(s).mechanics;
    expect(led.find((m) => m.id === 'pandora')!.text).toContain(`This round: ${MECHANIC_BY_ID[boon].name}`);
    expect(led.find((m) => m.id === 'pandora_curse')!.text).toContain(`This round: ${MECHANIC_BY_ID[bane].name}`);
    expect(stateHash(deserializeState(serializeState(s)))).toBe(stateHash(s));
    // many rounds: never Pandora itself, never a projectile-only boon for a melee party, always within the pool
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      BOON_HOOKS.onRoundStart!(s, []);
      const r = Object.keys(s.fate.rolled!);
      expect(r).toHaveLength(2);
      r.forEach((id) => seen.add(id));
    }
    expect(seen.has('pandora') || seen.has('pandora_curse') || seen.has('splitting_shots')).toBe(false);
    for (const id of seen) expect(MECHANIC_BASE_MAGNITUDE[id]).toBeTruthy();
    expect(seen.size).toBeGreaterThan(12);
    // a chance boon never rolls to certainty
    expect(Number(pandoraMagnitude(MECHANIC_BY_ID.executioner, 100))).toBeLessThan(1);
    // unbound: nothing rolls, and the old roll is cleared
    const plain = arena();
    plain.fate.rolled = { echo: B('0.5') };
    BOON_HOOKS.onRoundStart!(plain, []);
    expect(plain.fate.rolled).toBeUndefined();
  });
});

describe('banes', () => {
  it('Blood Price: casting costs max health, never below the floor', () => {
    const s = arena(); bind(s, 'blood_price', '0.1');
    const p = s.players[0]; const ev: SimEvent[] = [];
    const sk = p.skills[0].skillId;
    BOON_HOOKS.onCast!(s, ev, p, sk);
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.9, 9);
    p.hp = p.maxHp.mul(B('0.05'));
    BOON_HOOKS.onCast!(s, ev, p, sk);
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.01, 9);
    BOON_HOOKS.onCast!(s, ev, p, sk);
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.01, 9);
    expect(p.lifeState).toBe('alive');
    expect(casts(ev, 'bane_blood_price')).toBe(2);
  });
  it('Restless Dead: deaths raise hunting wisps (capped) that burst on contact; a dodge slips through', () => {
    const s = arena(); bind(s, 'restless_dead', '0.9');
    const p = s.players[0]; const ev: SimEvent[] = [];
    for (let i = 0; i < 30; i++) strike(s, ev, foe(s, 4, i * 0.05, ONE, B(10)), B(1000));
    const wisps = s.hazards.filter((h) => h.kind === 'fate_wisp');
    expect(wisps.length).toBe(MECHANIC_BY_ID.restless_dead.params.max);
    s.hazards = [wisps[0]];
    p.iframes = 100;
    for (let i = 0; i < 150; i++) tick(s, ev);
    expect(p.hp.toString()).toBe(p.maxHp.toString());                  // dodging: the wisp passes through
    expect(s.hazards).toHaveLength(1);
    p.iframes = 0;
    for (let i = 0; i < 30 && s.hazards.length; i++) tick(s, ev);
    expect(casts(ev, 'bane_wisp_burst')).toBe(1);
    expect(1 - p.hp.ratio(p.maxHp)).toBeCloseTo(0.08, 6);
  });
  it('Grave Hands: lingering is seized after the grace; moving or a cleared room releases you', () => {
    const s = arena(); bind(s, 'grave_hands', '0.1');
    const p = s.players[0]; const ev: SimEvent[] = [];
    foe(s, 20);
    const grasp = () => s.hazards.filter((h) => h.kind === 'fate_grasp' && h.untilTick > s.tick);
    tick(s, ev);                                                        // anchors
    for (let i = 0; i < 90 - Math.round(GRASP_WARN_SEC * 60); i++) tick(s, ev);
    expect(grasp()).toHaveLength(1);
    expect(p.hp.toString()).toBe(p.maxHp.toString());
    for (let i = 0; i < Math.round(GRASP_WARN_SEC * 60); i++) tick(s, ev);
    expect(1 - p.hp.ratio(p.maxHp)).toBeCloseTo(0.1, 6);
    for (let i = 0; i < 30; i++) tick(s, ev);
    expect(1 - p.hp.ratio(p.maxHp)).toBeCloseTo(0.2, 6);
    expect(casts(ev, 'bane_grave_hands')).toBe(2);
    p.x += 1; tick(s, ev);
    expect(grasp()).toHaveLength(0);
    const h = p.hp;
    for (let i = 0; i < 60; i++) { p.x += i % 2 ? 0.7 : -0.7; tick(s, ev); }
    expect(p.hp.toString()).toBe(h.toString());                         // shuffling past the leash keeps you free
    s.enemies = [];
    for (let i = 0; i < 200; i++) tick(s, ev);
    expect(p.hp.toString()).toBe(h.toString());                         // no awake foes, no hands
  });
  it('Shadow Pact: elites roll once for a linked twin that fades with them', () => {
    const s = arena(); bind(s, 'shadow_pact', '0.99');
    const ev: SimEvent[] = [];
    const elite = foe(s, 5, 0, ONE, B(1000)); elite.elite = 1;
    const plain = foe(s, 6, 0, ONE, B(1000));
    tick(s, ev);
    const twins = s.enemies.filter((e) => e.summonerId === elite.id);
    expect(twins).toHaveLength(1);
    expect(s.enemies.some((e) => e.summonerId === plain.id)).toBe(false);
    const twin = twins[0];
    expect(twin.objective).toBe(false);
    expect(twin.cohort.unitHp.toString()).toBe(B(1000).mul(B('0.6')).toString());
    expect(twin.damage.toString()).toBe(elite.damage.mul(B('0.8')).toString());
    expect(casts(ev, 'bane_shadow_pact')).toBe(1);
    tick(s, ev);
    expect(s.enemies.filter((e) => e.summonerId === elite.id)).toHaveLength(1);   // once per elite
    killEnemy(s, ev, elite, 0);
    expect(twin.state).toBe('dying');
  });
});

describe('Forecast and the real loop', () => {
  it('every new mechanic forecasts its value, short copy and details', () => {
    const s = toVoting(['vanguard']);
    for (const trio of [['shadow_twin', 'necromancers_due', 'last_stand'], ['gravity_well', 'momentum', 'mirror_ward'], ['blood_magic', 'pandoras_box', 'lord_of_graves'],
      ['collapsing_star', 'doppelganger', 'deathwish'], ['quickblood', 'restless_feet', 'haunted_spoils'], ['lone_shade', 'desperation', 'cracked_mirror']]) {
      s.offer!.cards = trio;
      const fc = computeForecast(s)!;
      expect(JSON.stringify(fc)).not.toMatch(/Infinity|NaN|\{v\}/);
      for (const card of fc.cards) {
        expect(card.mechanics.length).toBeGreaterThan(0);
        for (const m of card.mechanics) {
          expect(m.change).toBe('New rule');
          expect(m.short.length).toBeLessThanOrEqual(48);
          expect(m.details.length, m.id).toBeGreaterThan(0);
        }
      }
    }
    s.offer!.cards = ['pandoras_box', 'last_stand', 'blood_magic'];
    const fc = computeForecast(s)!;
    expect(fc.cards[0].mechanics.map((m) => m.value.after)).toEqual(['×1.5', '×1.25']);
    expect(fc.cards[1].mechanics[0].short).toBe('Below 35% HP: +75% dmg, half damage taken');
  });
  it('a bot run with every new mechanic bound is deterministic and never produces NaN/Infinity', () => {
    const mk = () => {
      const s = newRun(['vanguard', 'arcanist'], 'MECH_LOOP2');
      for (const [id, m] of [['shadow_twin', '0.35'], ['grave_thralls', '0.5'], ['last_stand', '0.75'], ['gravity_well', '2'], ['momentum', '1'], ['mirror_ward', '3'],
        ['pandora', '1.5'], ['blood_price', '0.02'], ['restless_dead', '0.1'], ['grave_hands', '0.01'], ['shadow_pact', '0.5'], ['pandora_curse', '1.25']] as const) bind(s, id, m);
      s.fate.factors['encounter.eliteChance'] = B(20);                   // elites (and their twins) show up early
      return runBot(s, { maxTicks: 60 * 60 });
    };
    const a = mk(), b = mk();
    expect(stateHash(a)).toBe(stateHash(b));
    expect(JSON.stringify(buildSnapshot(a))).not.toMatch(/Infinity|NaN/);
    expect(a.round).toBeGreaterThanOrEqual(1);
  });
});
