import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { GEAR_SLOTS, LEGENDARIES, LEGENDARY_BY_ID, LEGENDARY_PERK_IDS, LOOT_RULES, validateContent, validateLegendaries } from '@cursebound/content';
import {
  ACTION, breakdown, buildSnapshot, chooseLegendary, derivePlayer, deserializeState, devSpawn, dropLegendary, equipLegendary, hitEnemy, hitPlayer,
  lootChance, lootSnapshot, rollLoot, serializeState, settleLoot, skillCoef, stateHash, step, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { hooks } from '../src/hooks';
import { newRun, runBot } from './run.helpers';

// Legendary gear: catalogue, drops, ground loot, pickup / swap, stat factors, perks and replay stability.

const B = (x: string | number) => Big.from(x);

function toCombat(classes: string[] = ['vanguard'], seed = 'LG_TEST_SEED'): SimState {
  const s = newRun(classes, seed);
  runBot(s, { maxTicks: 6000, untilRound: 1 });
  expect(s.phase).toBe('COMBAT');
  return s;
}

/** Remove encounter actors so direct hook calls see only what a test spawns (no step() afterwards). */
function isolate(s: SimState) {
  s.enemies = []; s.projectiles = []; s.hazards = []; s.telegraphs = []; s.pickups = []; s.loot = [];
}

function spawnNear(s: SimState, dx = 1, dy = 0) {
  const p = s.players[0];
  const e = devSpawn(s, 'pursuer', p.x + dx, p.y + dy);
  e.cohort.unitHp = B('1e9');   // sturdy target: damage comparisons without kills
  return e;
}

const idle = (seq: number, buttons = 0): PlayerInput => ({ seq, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons });
const remainingHp = (e: { cohort: { unitHp: Big; spread: Big; front: Big; count: Big } }) => e.cohort.unitHp.sub(e.cohort.spread).sub(e.cohort.front);

describe('legendary catalogue', () => {
  it('validates: 30+ items, every slot, known stats, positive factors, implemented perks', () => {
    expect(validateLegendaries()).toEqual([]);
    expect(validateContent()).toEqual([]);
    expect(LEGENDARIES.length).toBeGreaterThanOrEqual(30);
    for (const slot of GEAR_SLOTS) expect(LEGENDARIES.some((x) => x.slot === slot)).toBe(true);
    expect(LEGENDARIES.some((x) => x.classId === 'vanguard')).toBe(true);
    expect(LEGENDARIES.some((x) => x.classId === 'arcanist')).toBe(true);
    expect(LEGENDARIES.filter((x) => x.perk.id === 'path_sigil').map((x) => x.perk.params?.slot).sort()).toEqual([0, 1, 2]);
    const used = new Set(LEGENDARIES.map((x) => x.perk.id));
    for (const id of LEGENDARY_PERK_IDS) expect(used.has(id)).toBe(true);
  });
});

describe('legendary drops', () => {
  it('drop chances are low for ordinary foes, modest for elites, certain for bosses', () => {
    const s = toCombat();
    isolate(s);
    const e = spawnNear(s, 3, 0);
    e.objective = true;
    s.round = 1;
    expect(lootChance(s, e)).toBeCloseTo(LOOT_RULES.baseChance, 9);
    s.round = 200;
    expect(lootChance(s, e)).toBeLessThanOrEqual(LOOT_RULES.maxChance);
    expect(LOOT_RULES.maxChance).toBeLessThanOrEqual(0.015);
    e.objective = false;
    expect(lootChance(s, e)).toBeLessThan(LOOT_RULES.maxChance);
    e.elite = 1; expect(lootChance(s, e)).toBe(LOOT_RULES.championChance);
    e.elite = 2; expect(lootChance(s, e)).toBe(LOOT_RULES.rareChance);
    e.elite = undefined; e.boss = true; expect(lootChance(s, e)).toBe(1);
  });

  it('empirical ordinary drop rate stays near 0.5%; the per-round cap holds; bosses always drop', () => {
    const s = toCombat();
    isolate(s);
    s.round = 1;
    const e = spawnNear(s, 3, 0);
    e.objective = true;
    let drops = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      s.lootFound = []; s.loot = [];
      const ev: SimEvent[] = [];
      rollLoot(s, ev, e);
      if (ev.some((x) => x.t === 'loot')) drops++;
    }
    expect(drops / N).toBeGreaterThan(0.002);
    expect(drops / N).toBeLessThan(0.009);
    // cap: even rares cannot exceed maxDropsPerRound random drops in one round
    s.lootFound = []; s.loot = [];
    e.elite = 2;
    for (let i = 0; i < 2000; i++) rollLoot(s, [], e);
    expect(s.lootFound.filter((f) => f.round === s.round).length).toBe(LOOT_RULES.maxDropsPerRound);
    // bosses ignore the cap
    e.elite = undefined; e.boss = true;
    const ev: SimEvent[] = [];
    rollLoot(s, ev, e);
    expect(ev.filter((x) => x.t === 'loot').length).toBe(LOOT_RULES.bossDrops);
    expect(s.lootFound.filter((f) => f.source === 'boss').length).toBe(LOOT_RULES.bossDrops);
  });

  it('class-only items drop only for classes in the party and the party avoids exact duplicates', () => {
    const s = toCombat(['vanguard']);
    for (let i = 0; i < 300; i++) {
      const id = chooseLegendary(s)!;
      const def = LEGENDARY_BY_ID[id];
      expect(!def.classId || def.classId === 'vanguard').toBe(true);
    }
    equipLegendary(s, [], s.players[0], 'lg_kingslayers_oath');
    for (let i = 0; i < 300; i++) expect(chooseLegendary(s)).not.toBe('lg_kingslayers_oath');
  });

  it('drops are deterministic for the same seed and inputs', () => {
    const play = () => {
      const s = newRun(['vanguard', 'arcanist'], 'LG_DETERMINISM');
      const loot: string[] = [];
      runBot(s, {
        maxTicks: 60 * 60 * 5,
        onEvents: (ev, st) => {
          for (const x of ev) if (x.t === 'loot' || x.t === 'equip') loot.push(JSON.stringify(x));
          for (const e of st.enemies) if (!e.boss) e.elite = 2;   // every foe a rare (12%): drops within a short run
        },
      });
      expect(loot.length).toBeGreaterThan(0);
      return { hash: stateHash(s), loot, found: JSON.stringify(s.lootFound) };
    };
    const a = play(), b = play();
    expect(a.hash).toBe(b.hash);
    expect(a.loot).toEqual(b.loot);
    expect(a.found).toBe(b.found);
  });
});

describe('ground loot, pickup and swap', () => {
  it('walking over an item auto-equips an empty slot; an occupied slot needs Interact; the old item drops at your feet', () => {
    const s = toCombat(['vanguard'], 'LG_SWAP_SEED');
    const p = s.players[0];
    let seq = p.lastInputSeq + 1;
    const events: SimEvent[] = [];
    const tick = (buttons = 0) => { const r = step(s, [idle(seq++, buttons)]); events.push(...r.events); };
    const place = (itemId: string) => { const it = dropLegendary(s, [], p.x, p.y, 'enemy', itemId)!; it.x = p.x; it.y = p.y; return it; };

    place('lg_kingslayers_oath');
    for (let i = 0; i < 40; i++) tick();
    expect(p.gear?.weapon).toBe('lg_kingslayers_oath');
    expect(s.loot).toHaveLength(0);
    expect(events.some((e) => e.t === 'equip' && e.itemId === 'lg_kingslayers_oath' && !e.replaced)).toBe(true);

    place('lg_executioners_edge');
    for (let i = 0; i < 40; i++) tick();
    expect(p.gear?.weapon).toBe('lg_kingslayers_oath');   // no Interact: no swap
    expect(s.loot).toHaveLength(1);
    expect(buildSnapshot(s).lt.map((x) => x.it)).toEqual(['lg_executioners_edge']);

    tick(ACTION.INTERACT);
    expect(p.gear?.weapon).toBe('lg_executioners_edge');
    expect(s.loot!.map((x) => x.itemId)).toEqual(['lg_kingslayers_oath']);
    expect(events.some((e) => e.t === 'equip' && e.itemId === 'lg_executioners_edge' && e.replaced === 'lg_kingslayers_oath')).toBe(true);
    const dropped = s.loot![0];
    expect(Math.hypot(dropped.x - p.x, dropped.y - p.y)).toBeLessThan(LOOT_RULES.pickupRange);

    // holding Interact is not a new press: the dropped item stays on the ground
    for (let i = 0; i < 45; i++) tick(ACTION.INTERACT);
    expect(p.gear?.weapon).toBe('lg_executioners_edge');
    tick(0);
    tick(ACTION.INTERACT);
    expect(p.gear?.weapon).toBe('lg_kingslayers_oath');
  });

  it('class-only items cannot be worn by other classes', () => {
    const s = toCombat(['vanguard'], 'LG_CLASS_SEED');
    const p = s.players[0];
    let seq = p.lastInputSeq + 1;
    const it = dropLegendary(s, [], p.x, p.y, 'enemy', 'lg_riftwalkers_sandals')!;
    it.x = p.x; it.y = p.y;
    for (let i = 0; i < 40; i++) step(s, [idle(seq++, i % 2 ? ACTION.INTERACT : 0)]);
    expect(p.gear?.boots).toBeUndefined();
    expect(s.loot).toHaveLength(1);
  });

  it('round clear hands unclaimed items to an open slot, otherwise carries them into the next round', () => {
    const s = toCombat(['vanguard'], 'LG_SETTLE_SEED');
    isolate(s);
    const p = s.players[0];
    const ev: SimEvent[] = [];
    dropLegendary(s, ev, p.x + 3, p.y, 'boss', 'lg_deathless_vow');
    settleLoot(s, ev);
    expect(p.gear?.amulet).toBe('lg_deathless_vow');
    dropLegendary(s, ev, p.x + 3, p.y, 'boss', 'lg_hourglass_of_the_patient_king');
    settleLoot(s, ev);
    expect(p.gear?.amulet).toBe('lg_deathless_vow');
    expect(s.loot).toHaveLength(1);
    expect(s.loot![0].carry).toBe(true);
    expect(lootSnapshot(s)).toEqual([]);
    const ev2: SimEvent[] = [];
    hooks.onRoundStart(s, ev2);
    expect(s.loot![0].carry).toBeUndefined();
    expect(ev2.some((e) => e.t === 'loot' && e.src === 'carry')).toBe(true);
    expect(lootSnapshot(s)).toHaveLength(1);
  });
});

describe('gear factors in the stat pipeline', () => {
  it('equipped modifiers multiply derived stats, show as their own Breakdown factor and keep the health fraction', () => {
    const s = toCombat(['vanguard'], 'LG_FACTOR_SEED');
    const p = s.players[0];
    p.hp = p.maxHp.mul(B('0.5'));
    const before = derivePlayer(s, p);
    const v0 = s.stateVersion;
    equipLegendary(s, [], p, 'lg_thornmail_of_the_briar_king');   // armor ×1.2, max health ×1.08
    const after = derivePlayer(s, p);
    expect(s.stateVersion).toBeGreaterThan(v0);
    expect(after.maxHp.eq(before.maxHp.mul(B('1.08')))).toBe(true);
    expect(after.armor.eq(before.armor.mul(B('1.2')))).toBe(true);
    expect(breakdown(s, p, 'player.maxHealth').gear.eq(B('1.08'))).toBe(true);
    expect(breakdown(s, p, 'player.maxHealth').gearSources).toEqual([{ item: 'lg_thornmail_of_the_briar_king', factor: '1.08' }]);
    expect(p.maxHp.eq(after.maxHp)).toBe(true);
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.5, 9);
    const snap = buildSnapshot(s).players[0];
    expect(snap.gr?.[GEAR_SLOTS.indexOf('chest')]).toBe('lg_thornmail_of_the_briar_king');
  });

  it('slot sigils add a charge and multiply the hotbar skill; signature items multiply the signature', () => {
    const s = newRun(['vanguard'], 'LG_SIGIL_SEED');
    step(s, [], [{ type: 'ALLOCATE', slot: 0, nodeId: 'v_sweeping_strike' }]);   // cleaver = second branch (hotbar slot 2)
    const p = s.players[0];
    const slot = p.skills.findIndex((x) => x.skillId === 'v_sweeping_strike');
    expect(slot).toBe(1);
    const coef0 = skillCoef(p, 'v_sweeping_strike');
    equipLegendary(s, [], p, 'lg_ring_of_the_first_path');   // wrong slot: no effect
    expect(p.skills[slot].maxCharges).toBe(1);
    equipLegendary(s, [], p, 'lg_pendant_of_the_second_path');
    expect(p.skills[slot].maxCharges).toBe(2);
    expect(skillCoef(p, 'v_sweeping_strike').eq(coef0.mul(B('1.4')))).toBe(true);
    const sig0 = skillCoef(p, 'v_earthbreaker');
    equipLegendary(s, [], p, 'lg_crown_of_the_final_word');
    expect(skillCoef(p, 'v_earthbreaker').eq(sig0.mul(B('1.6')))).toBe(true);
    expect(skillCoef(p, 'v_cleave').eq(B('1'))).toBe(true);   // basic attacks untouched
  });
});

describe('perks (sample)', () => {
  it('Deathless Vow survives lethal damage once per round', () => {
    const s = toCombat(['vanguard'], 'LG_VOW_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_deathless_vow');
    p.iframes = 0;
    const hit = () => hitPlayer(s, [], p, B('1e30'), { attack: 'test', source: 'test', fromX: p.x + 1, fromY: p.y, dtype: 'physical' });
    hit();
    expect(p.lifeState).toBe('alive');
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.3, 6);
    expect(p.iframes).toBeGreaterThanOrEqual(1.5);
    p.iframes = 0;
    hit();
    expect(p.lifeState).toBe('downed');
  });

  it('Kingslayer\'s Oath deals ×1.35 to elites; Executioner\'s Edge doubles hits on wounded foes', () => {
    const s = toCombat(['vanguard'], 'LG_SLAYER_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_kingslayers_oath');
    const plain = spawnNear(s, 1, 0), elite = spawnNear(s, 0, 1);
    elite.elite = 1;
    const o = { dtype: 'physical' as const, srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false };
    hitEnemy(s, [], plain, B(1000), B(1), o);
    hitEnemy(s, [], elite, B(1000), B(1), o);
    const dPlain = plain.cohort.unitHp.sub(remainingHp(plain)), dElite = elite.cohort.unitHp.sub(remainingHp(elite));
    expect(dElite.ratio(dPlain)).toBeCloseTo(1.35, 6);
    equipLegendary(s, [], p, 'lg_executioners_edge');
    const wounded = spawnNear(s, -1, 0);
    wounded.cohort.front = wounded.cohort.unitHp.mul(B('0.9'));
    const before = remainingHp(wounded);
    hitEnemy(s, [], wounded, B(1000), B(1), o);
    const healthy = spawnNear(s, 0, -1);
    hitEnemy(s, [], healthy, B(1000), B(1), o);
    const dW = before.sub(remainingHp(wounded)), dH = healthy.cohort.unitHp.sub(remainingHp(healthy));
    expect(dW.ratio(dH)).toBeCloseTo(2, 6);
  });

  it('Hourglass: the next skill deals ×3 and the cast spends the charge of power', () => {
    const s = newRun(['vanguard'], 'LG_HOURGLASS_SEED');
    step(s, [], [{ type: 'ALLOCATE', slot: 0, nodeId: 'v_sweeping_strike' }]);
    const p = s.players[0];
    const base = skillCoef(p, 'v_sweeping_strike');
    equipLegendary(s, [], p, 'lg_hourglass_of_the_patient_king');
    expect(skillCoef(p, 'v_sweeping_strike').eq(base.mul(B(3)))).toBe(true);
    hooks.onCast(s, [], p, 'v_sweeping_strike');
    expect(skillCoef(p, 'v_sweeping_strike').eq(base)).toBe(true);
    s.tick += 601;
    hooks.onPlayerTick(s, [], p);
    expect(skillCoef(p, 'v_sweeping_strike').eq(base.mul(B(3)))).toBe(true);
  });

  it('Helm of the Drowned Bell tolls: damage and a stun', () => {
    const s = toCombat(['vanguard'], 'LG_BELL_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_helm_of_the_drowned_bell');
    const e = spawnNear(s, 1.5, 0);
    p.vars['lg.bell.next'] = 0;
    const ev: SimEvent[] = [];
    hooks.onPlayerTick(s, ev, p);
    expect(ev.some((x) => x.t === 'perk' && x.perk === 'bell_toll')).toBe(true);
    expect(e.staggerUntil).toBeGreaterThan(s.tick);
    expect(remainingHp(e).lt(e.cohort.unitHp)).toBe(true);
    const ev2: SimEvent[] = [];
    hooks.onPlayerTick(s, ev2, p);
    expect(ev2.some((x) => x.t === 'perk' && x.perk === 'bell_toll')).toBe(false);   // 6s period
  });

  it('Frostbitten Grasp chills (slow) and the slow expires exactly', () => {
    const s = toCombat(['vanguard'], 'LG_CHILL_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_frostbitten_grasp');
    const e = spawnNear(s, 1, 0);
    const v = e.moveSpeed;
    hitEnemy(s, [], e, B(10), B(1), { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    expect(e.moveSpeed).toBeCloseTo(v * 0.65, 9);
    s.tick += 200;
    hooks.onTick(s, []);
    expect(e.moveSpeed).toBeCloseTo(v, 9);
  });

  it('every 5th basic attack releases a shockwave; Gauntlets refund about 20% of charges', () => {
    const s = toCombat(['vanguard'], 'LG_SHOCK_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_grandfathers_thunder');
    spawnNear(s, 1, 0);
    let waves = 0;
    for (let i = 0; i < 10; i++) {
      const ev: SimEvent[] = [];
      hooks.onBasicAttack(s, ev, p, Big.ONE);
      waves += ev.filter((x) => x.t === 'perk' && x.perk === 'fifth_shockwave').length;
    }
    expect(waves).toBe(2);
    equipLegendary(s, [], p, 'lg_gauntlets_of_the_endless_chain');
    p.skills[3] = { skillId: 'v_earthbreaker', cooldown: 12, charges: 0, maxCharges: 1, mark: null };
    let refunds = 0;
    for (let i = 0; i < 1000; i++) {
      p.skills[3].charges = 0;
      hooks.onCast(s, [], p, 'v_earthbreaker');
      if (p.skills[3].charges === 1) refunds++;
    }
    expect(refunds).toBeGreaterThan(140);
    expect(refunds).toBeLessThan(260);
  });

  it('Shadowstep Treads leave a shade that explodes after its delay', () => {
    const s = toCombat(['vanguard'], 'LG_SHADE_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_shadowstep_treads');
    const e = spawnNear(s, 1, 0);
    hooks.onDodge(s, [], p);
    const h = s.hazards.find((x) => x.kind === 'lg_shade')!;
    expect(h).toBeTruthy();
    const ev: SimEvent[] = [];
    expect(hooks.hazardTick(s, ev, h)).toBe(true);   // not yet
    expect(ev).toHaveLength(0);
    s.tick = h.nextTick;
    hooks.hazardTick(s, ev, h);
    expect(ev.some((x) => x.t === 'perk' && x.perk === 'dodge_shade')).toBe(true);
    expect(remainingHp(e).lt(e.cohort.unitHp)).toBe(true);
  });

  it('Mirrorglass Loop mirrors fresh projectiles at 70% damage; Ravenous Fang heals on kills', () => {
    const s = toCombat(['arcanist'], 'LG_MIRROR_SEED');
    isolate(s);
    const p = s.players[0];
    equipLegendary(s, [], p, 'lg_mirrorglass_loop');
    s.projectiles.push({ id: s.nextId++, kind: 'spark', owner: 'player', ownerId: 0, x: p.x + 0.4, y: p.y, vx: 11, vy: 0, radius: 0.25, range: 9, damage: B(100), weight: B(1), dtype: 'ember', pierce: 0, hitIds: [], skillId: 'a_spark', crit: false, bornTick: s.tick });
    hooks.onPlayerTick(s, [], p);
    expect(s.projectiles).toHaveLength(2);
    expect(s.projectiles[1].vx).toBe(-11);
    expect(s.projectiles[1].damage.eq(B(70))).toBe(true);
    equipLegendary(s, [], p, 'lg_ravenous_fang');
    p.hp = p.maxHp.mul(B('0.5'));
    const e = devSpawn(s, 'pursuer', p.x + 1, p.y);
    hitEnemy(s, [], e, B('1e12'), B(1), { dtype: 'ember', srcSlot: 0, skillId: 'test', fromX: p.x, fromY: p.y, allowCrit: false });
    expect(e.state).toBe('dying');
    expect(p.hp.ratio(p.maxHp)).toBeGreaterThan(0.505);
  });
});

describe('replay stability with gear', () => {
  it('gear and loot survive checkpoints: restore + continue equals continuous play', () => {
    const mk = () => {
      const s = newRun(['vanguard', 'arcanist'], 'LG_REPLAY_SEED');
      equipLegendary(s, [], s.players[0], 'lg_helm_of_the_drowned_bell');
      equipLegendary(s, [], s.players[0], 'lg_thornmail_of_the_briar_king');
      equipLegendary(s, [], s.players[1], 'lg_stormcallers_coil');
      equipLegendary(s, [], s.players[1], 'lg_frostbitten_grasp');
      equipLegendary(s, [], s.players[1], 'lg_shadowstep_treads');
      return s;
    };
    const a = mk();
    runBot(a, { maxTicks: 1500 });
    dropLegendary(a, [], a.players[0].x + 2, a.players[0].y, 'enemy', 'lg_ravenous_fang');
    const b = deserializeState(serializeState(a));
    expect(stateHash(b)).toBe(stateHash(a));
    expect(b.players[1].gear).toEqual(a.players[1].gear);
    expect(b.loot).toEqual(a.loot);
    runBot(a, { maxTicks: 2500 });
    runBot(b, { maxTicks: 2500 });
    expect(stateHash(b)).toBe(stateHash(a));
  });
});
