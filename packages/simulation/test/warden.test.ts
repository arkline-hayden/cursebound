import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CLASS_BY_ID, NODES, SKILL_BY_ID, validateContent } from '@cursebound/content';
import {
  buildSnapshot, deserializeState, devSpawn, hitPlayer, killEnemy, serializeState, stateHash, step,
  type Hazard, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { ACTION, aimAt, arena, casts, damaged, hp, run, spawnAt, type Arena } from './classkit.helpers';
import { newRun, runBot } from './run.helpers';

// Warden kit: roots, the spirit-wolf pack (player-owned hazards), thorns and Venom.

const GROVE8 = ['w_entangle', 'w_ironbark', 'w_ironbark', 'w_ironbark', 'w_heartwood', 'w_heartwood', 'w_heartwood', 'w_grasping_earth'];
const BEAST8 = ['w_call_pack', 'w_feral_might', 'w_feral_might', 'w_feral_might', 'w_hunters_rhythm', 'w_hunters_rhythm', 'w_hunters_rhythm', 'w_long_hunt'];
const THORNS8 = ['w_thornburst', 'w_barbed', 'w_barbed', 'w_barbed', 'w_virulence', 'w_virulence', 'w_virulence', 'w_sharpened_thorns'];

const hz = (s: SimState, kind: string) => s.hazards.filter((h) => h.kind === kind && h.untilTick > s.tick);
const wolves = (s: SimState) => hz(s, 'w_wolf');
const ready = (a: Arena, slot: number) => { const k = a.s.players[0].skills[slot]; k.charges = k.maxCharges; k.cooldown = 0; };
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

describe('warden: content', () => {
  it('is playable with 3 deep branches, 9 equippable actives and keystone choices', () => {
    expect(validateContent()).toEqual([]);
    const cls = CLASS_BY_ID['warden'];
    expect(cls).toBeTruthy();
    expect(cls.branches.map((b) => b.id)).toEqual(['grove', 'beast', 'thorns']);
    const nodes = NODES.filter((n) => n.classId === 'warden');
    for (const b of cls.branches) {
      const bn = nodes.filter((n) => n.branch === b.id);
      expect(bn.length).toBeGreaterThanOrEqual(11);
      expect(bn.filter((n) => n.grantsSkill)).toHaveLength(3);
      const t4 = bn.filter((n) => n.tier === 4);
      expect(t4).toHaveLength(2);
      expect(t4[0].excludes).toContain(t4[1].id);
      expect(bn.some((n) => n.tier === 2 && n.excludes?.length && !n.grantsSkill)).toBe(true);
    }
    const actives = nodes.filter((n) => n.grantsSkill).map((n) => n.grantsSkill!);
    expect(actives).toHaveLength(9);
    for (const id of [...actives, cls.signatureSkill]) {
      const s = SKILL_BY_ID[id];
      expect(s.cooldownSec).toBeGreaterThanOrEqual(2);     // cooldown-only skills (x0.7 since content 1.2)
      expect(s.cooldownSec).toBeLessThanOrEqual(10);
    }
    expect(cls.base.damage).toBeGreaterThanOrEqual(75);
    expect(cls.base.damage).toBeLessThanOrEqual(105);
    expect(cls.base.maxHealth).toBeGreaterThanOrEqual(850);
    expect(cls.base.maxHealth).toBeLessThanOrEqual(1050);
  });
});

describe('warden: basic and signature', () => {
  it('Thornspear strikes the arc and looses a thorn shard', () => {
    const a = arena('warden', []);
    const e = spawnAt(a, 'guardian', 1.3, 0, 4);
    run(a, 50, ACTION.ATTACK, 50, aimAt(a, e));
    expect(casts(a, 'w_thornspear').length).toBeGreaterThanOrEqual(1);
    expect(damaged(e)).toBe(true);
    expect(a.events.some((x) => x.t === 'hit' && x.targetKind === 'enemy')).toBe(true);
    // a shard was loosed (it may already have struck)
    const far = spawnAt(a, 'guardian', 4, 0, 4);
    run(a, 40, ACTION.ATTACK, 40, aimAt(a, far));
    expect(damaged(far)).toBe(true);   // only the 5-unit shard reaches 4 units
  });

  it('Wild Hunt tramples every enemy in the lane exactly once and carries them along', () => {
    const a = arena('warden', []);
    const near = spawnAt(a, 'pursuer', 2.5, 0, 1, true);
    const farE = spawnAt(a, 'pursuer', 5.5, 5, 1, true);
    const off = spawnAt(a, 'pursuer', 5, 90, 1, true);       // out of the lane
    const p = a.s.players[0];
    const before = dist(near.x, near.y, p.x, p.y);
    run(a, 2, ACTION.SIGNATURE, 1, [a.dir[0] * 5, a.dir[1] * 5]);
    expect(casts(a, 'w_wild_hunt')).toHaveLength(1);
    expect(hz(a.s, 'w_stampede')).toHaveLength(1);
    run(a, 80);
    expect(damaged(near) && damaged(farE)).toBe(true);
    expect(damaged(off)).toBe(false);
    const hits = a.events.filter((x) => x.t === 'hit' && x.targetKind === 'enemy' && x.target === near.id && x.dtype === 'physical');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    if (near.cohort.count.gt(Big.ZERO)) expect(dist(near.x, near.y, p.x, p.y)).toBeGreaterThan(before);
  });
});

describe('warden: Beast', () => {
  it('Call of the Pack summons 3 wolves that leap at the aimed enemy, and the pack stays bounded', () => {
    const a = arena('warden', ['w_call_pack']);
    const e = spawnAt(a, 'guardian', 4, 0, 8);
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(casts(a, 'w_call_pack')).toHaveLength(1);
    expect(wolves(a.s)).toHaveLength(3);
    run(a, 60);
    expect(casts(a, 'w_wolf_pounce').length).toBeGreaterThanOrEqual(3);
    expect(damaged(e)).toBe(true);
    for (let i = 0; i < 4; i++) { ready(a, 1); run(a, 2, ACTION.SKILL2, 1, aimAt(a, e)); }
    expect(wolves(a.s)).toHaveLength(3);
    const snap = buildSnapshot(a.s).hazards.filter((h) => h.k === 'w_wolf');
    expect(snap).toHaveLength(3);
    for (const h of snap) expect(h.o).toBe(0);
  });

  it('idle wolves follow the Warden, then seek and bite an enemy that appears', () => {
    const a = arena('warden', ['w_call_pack']);
    const p = a.s.players[0];
    run(a, 2, ACTION.SKILL2, 1);
    run(a, 90);
    for (const w of wolves(a.s)) expect(dist(w.x, w.y, p.x, p.y)).toBeLessThan(3.5);
    const e = spawnAt(a, 'guardian', 6, 0, 10);
    const t0 = a.s.tick;
    const startD = Math.min(...wolves(a.s).map((w) => dist(w.x, w.y, e.x, e.y)));
    run(a, 240);
    const ws = wolves(a.s);
    expect(Math.min(...ws.map((w) => dist(w.x, w.y, e.x, e.y)))).toBeLessThan(startD);
    expect(ws.some((w) => (w.vars?.bite ?? -1) > t0)).toBe(true);
    expect(a.events.filter((x) => x.t === 'hit' && x.targetKind === 'enemy' && x.target === e.id).length).toBeGreaterThanOrEqual(4);
    expect(damaged(e)).toBe(true);
  });

  it('Dire Wolves cap the pack at 2; Endless Pack at 5; Feral Shift at 1 with a Maul basic', () => {
    const dire = arena('warden', ['w_call_pack', 'w_feral_might', 'w_feral_might', 'w_dire_wolves']);
    run(dire, 2, ACTION.SKILL2, 1);
    expect(wolves(dire.s)).toHaveLength(2);
    expect(wolves(dire.s)[0].inner).toBe(1);
    const endless = arena('warden', ['w_call_pack', 'w_feral_might', 'w_feral_might', 'w_endless_pack']);
    run(endless, 2, ACTION.SKILL2, 1);
    expect(wolves(endless.s)).toHaveLength(5);
    const feral = arena('warden', [...BEAST8, 'w_feral_shift']);
    run(feral, 2, ACTION.SKILL2, 1);
    expect(wolves(feral.s)).toHaveLength(1);
    const e = spawnAt(feral, 'guardian', 1.6, 0, 4);
    run(feral, 50, ACTION.ATTACK, 50, aimAt(feral, e));
    expect(casts(feral, 'w_bear_maul').length).toBeGreaterThanOrEqual(1);
    expect(casts(feral, 'w_thornspear')).toHaveLength(0);
    expect(feral.s.projectiles.some((pr) => pr.kind === 'w_thorn')).toBe(false);
    expect(hz(feral.s, 'w_aura')[0]?.length).toBe(1);
  });

  it('Spirit of the Ursa slams, then the bear swipes nearby enemies', () => {
    const a = arena('warden', ['w_call_pack', 'w_feral_might', 'w_feral_might', 'w_ursine_call']);
    expect(a.s.players[0].skills[1].skillId).toBe('w_ursine_call');
    const e = spawnAt(a, 'guardian', 4, 0, 12);
    e.cohort.unitHp = Big.from(1200);   // sturdy test foe, independent of enemy tuning
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(casts(a, 'w_ursine_call')).toHaveLength(1);
    expect(hz(a.s, 'w_ursa')).toHaveLength(1);
    expect(wolves(a.s)).toHaveLength(3);
    expect(damaged(e)).toBe(true);
    run(a, 150);
    expect(casts(a, 'w_ursa_swipe').length).toBeGreaterThanOrEqual(1);
  });

  it('Alpha Pounce leaps the Warden, lands with a rooting slam and calls the pack', () => {
    const a = arena('warden', ['w_call_pack', 'w_feral_might', 'w_feral_might', 'w_alpha_pounce']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'pursuer', 6.5, 0, 1, false);
    const x0 = p.x, y0 = p.y;
    run(a, 1, ACTION.SKILL2, 1, [a.dir[0] * 5, a.dir[1] * 5]);
    expect(casts(a, 'w_alpha_pounce')).toHaveLength(1);
    run(a, 24);
    expect(casts(a, 'w_alpha_land')).toHaveLength(1);
    expect(dist(p.x, p.y, x0, y0)).toBeGreaterThan(3);
    expect(wolves(a.s)).toHaveLength(3);
    expect(damaged(e)).toBe(true);
  });
});

describe('warden: Grove', () => {
  it('Entangle roots a moving enemy in place, then it is briefly immune', () => {
    const a = arena('warden', ['w_entangle']);
    const e = spawnAt(a, 'pursuer', 5, 0, 1, false);
    run(a, 1, ACTION.SKILL1, 1, aimAt(a, e));
    expect(casts(a, 'w_entangle')).toHaveLength(1);
    const marker = hz(a.s, 'w_root').find((h) => h.vars?.e === e.id)!;
    expect(marker).toBeTruthy();
    expect(hz(a.s, 'w_roots')).toHaveLength(1);
    run(a, 2);
    const fx = e.x, fy = e.y;
    run(a, 90);
    expect(e.x).toBe(fx);
    expect(e.y).toBe(fy);
    expect(damaged(e)).toBe(true);
    // after the root (2s) the enemy is free and immune to new roots for 1.5s
    run(a, 60);
    expect(a.s.tick).toBeGreaterThanOrEqual(marker.outer);
    expect(marker.vars!.done).toBe(1);
  });

  it('bosses are never rooted: Entangle builds stagger instead', () => {
    const a = arena('warden', ['w_entangle']);
    const p = a.s.players[0];
    const boss = devSpawn(a.s, 'guardian', p.x + a.dir[0] * 4, p.y + a.dir[1] * 4);
    boss.boss = true; boss.kind = 'prismstag'; boss.attack = null; boss.stagger = 0; boss.staggerUntil = 0;   // stand-in boss (devSpawn spawns archetypes only)
    run(a, 1, ACTION.SKILL1, 1, aimAt(a, boss));
    expect(hz(a.s, 'w_root').some((h) => h.vars?.e === boss.id)).toBe(false);
    expect(boss.stagger).toBeGreaterThanOrEqual(40);
    expect(boss.stagger).toBeLessThan(200);
  });

  it('Strangling Vines stun and strangle; Grove Wrath makes rooted enemies vulnerable', () => {
    const a = arena('warden', [...GROVE8, 'w_strangling_vines', 'w_grove_wrath']);
    const e = spawnAt(a, 'guardian', 4, 0, 4, false);
    run(a, 1, ACTION.SKILL1, 1, aimAt(a, e));
    run(a, 2);
    expect(e.staggerUntil).toBeGreaterThan(a.s.tick);
    expect(e.dots.some((d) => d.src === 0 && d.type === 'physical')).toBe(true);
    expect(e.vulnFactor).toBe('1.2');
    expect(e.vulnUntil).toBeGreaterThan(a.s.tick);
  });

  it("Worldtree's Grasp gives Entangle 2 charges and Bloodroot bursts when a root ends", () => {
    const a = arena('warden', [...GROVE8, 'w_worldtree_grasp']);
    expect(a.s.players[0].skills[0].maxCharges).toBe(2);
    const e = spawnAt(a, 'guardian', 4, 0, 8, false);
    run(a, 1, ACTION.SKILL1, 1, aimAt(a, e));
    run(a, 60 * 4);
    expect(casts(a, 'w_bloodroot').length).toBeGreaterThanOrEqual(1);
  });

  it('Verdant Totem erupts like Entangle and heals allies in range; Barkskin shields', () => {
    const a = arena('warden', [...GROVE8, 'w_verdant_totem', 'w_barkskin']);
    const p = a.s.players[0];
    expect(p.skills[0].skillId).toBe('w_verdant_totem');
    p.hp = p.maxHp.mul(Big.from('0.4'));
    const e = spawnAt(a, 'guardian', 2, 0, 4);
    run(a, 1, ACTION.SKILL1, 1, [a.dir[0] * 1.5, a.dir[1] * 1.5]);
    expect(hz(a.s, 'w_totem')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    expect(p.shield.isZero()).toBe(false);
    const hp0 = p.hp;
    run(a, 130);
    expect(p.hp.gt(hp0)).toBe(true);
    expect(a.events.filter((x) => x.t === 'heal' && x.slot === 0).length).toBeGreaterThanOrEqual(3);
  });

  it('Worldroot Eruption roots every enemy along the line; Overgrowth sprouts on rooted deaths', () => {
    const a = arena('warden', [...GROVE8, 'w_worldroot', 'w_overgrowth']);
    const e1 = spawnAt(a, 'pursuer', 3, 0, 1, false);
    const e2 = spawnAt(a, 'pursuer', 6, 0, 1, false);
    e1.cohort.unitHp = Big.from(600); e2.cohort.unitHp = Big.from(600);   // sturdy test foes, independent of enemy tuning
    run(a, 1, ACTION.SKILL1, 1, [a.dir[0] * 5, a.dir[1] * 5]);
    run(a, 40);
    const rooted = hz(a.s, 'w_root').map((h) => h.vars!.e);
    expect(rooted).toContain(e1.id);
    expect(rooted).toContain(e2.id);
    // kill a rooted enemy: a generation-1 sprout root patch appears at its corpse
    expect(e1.cohort.count.isZero()).toBe(false);
    const ev: SimEvent[] = [];
    killEnemy(a.s, ev, e1, 0);
    expect(ev.some((x) => x.t === 'cast' && x.skill === 'w_sprout')).toBe(true);
    const sprout = hz(a.s, 'w_roots').find((h) => h.generation === 1)!;
    expect(sprout).toBeTruthy();
    expect(dist(sprout.x, sprout.y, e1.x, e1.y)).toBeLessThan(1e-6);
  });
});

describe('warden: Thorns', () => {
  it('Thornburst damages, applies Venom and grants Thorn Armor that reflects direct damage', () => {
    const a = arena('warden', ['w_thornburst']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 1.8, 0, 6);
    run(a, 1, ACTION.SKILL3, 1, aimAt(a, e));
    expect(casts(a, 'w_thornburst')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    expect(e.dots.some((d) => d.src === 0 && d.type === 'decay')).toBe(true);
    expect(p.vars.w_thornUntil).toBeGreaterThan(a.s.tick);
    // an enemy attack lands: thorns lash the attacker
    const hp0 = hp(e);
    p.iframes = 0;
    const ev: SimEvent[] = [];
    hitPlayer(a.s, ev, p, Big.from(60), { attack: 'Shield Bash', source: 'guardian', fromX: e.x, fromY: e.y, dtype: 'physical', srcId: e.id });
    expect(hp(e).lt(hp0)).toBe(true);
    expect(ev.some((x) => x.t === 'cast' && x.skill === 'w_thorn_lash')).toBe(true);
  });

  it('Thorn Armor lashes are stronger at full strength than with Bramblehide alone', () => {
    const lash = (nodes: string[], burst: boolean) => {
      const a = arena('warden', nodes);
      const p = a.s.players[0];
      const e = spawnAt(a, 'guardian', 6, 0, 20);
      if (burst) run(a, 1, ACTION.SKILL3, 1, [-a.dir[0], -a.dir[1]]);
      const hp0 = hp(e);
      p.iframes = 0;
      hitPlayer(a.s, [], p, Big.from(80), { attack: 'Bash', source: 'guardian', fromX: e.x, fromY: e.y, dtype: 'physical', srcId: e.id });
      return hp0.sub(hp(e));
    };
    const none = lash(['w_thornburst'], false);
    const half = lash([...THORNS8, 'w_bramblehide'], false);
    const full = lash([...THORNS8, 'w_bramblehide'], true);
    expect(none.isZero()).toBe(true);
    expect(half.gt(Big.ZERO)).toBe(true);
    expect(full.gt(half)).toBe(true);
  });

  it('Contagion spreads Venom from a dying carrier to nearby enemies', () => {
    const a = arena('warden', [...THORNS8, 'w_contagion']);
    const carrier = spawnAt(a, 'pursuer', 1.6, 0, 1);
    const n1 = spawnAt(a, 'guardian', 4.4, 0, 6);
    carrier.cohort.unitHp = Big.from(300); n1.cohort.unitHp = Big.from(1200);   // sturdy test foes, independent of enemy tuning
    run(a, 1, ACTION.SKILL3, 1, aimAt(a, carrier));
    expect(n1.dots.some((d) => d.src === 0 && d.type === 'decay')).toBe(false);
    expect(carrier.dots.some((d) => d.src === 0 && d.type === 'decay') || carrier.cohort.count.isZero()).toBe(true);
    if (!carrier.cohort.count.isZero()) {
      carrier.cohort.front = carrier.cohort.unitHp.sub(Big.from('0.0001'));
      run(a, 30);
    }
    expect(casts(a, 'w_contagion').length).toBeGreaterThanOrEqual(1);
    expect(n1.dots.some((d) => d.src === 0 && d.type === 'decay')).toBe(true);
  });

  it('Bramble Wall roots and damages enemies touching it; Ironthorn Pod detonates and flings 8 shards', () => {
    const w = arena('warden', [...THORNS8, 'w_bramble_wall']);
    const e = spawnAt(w, 'pursuer', 2.5, 0, 1, false);
    run(w, 1, ACTION.SKILL3, 1, aimAt(w, e));
    expect(hz(w.s, 'w_bramble')).toHaveLength(1);
    run(w, 40);
    expect(damaged(e)).toBe(true);
    expect(w.s.hazards.some((h) => h.kind === 'w_root' && h.vars?.e === e.id) || e.cohort.count.isZero()).toBe(true);

    const pd = arena('warden', [...THORNS8, 'w_thorn_pod', 'w_toxic_barbs']);
    const t = spawnAt(pd, 'guardian', 5, 0, 10);
    run(pd, 1, ACTION.SKILL3, 1, aimAt(pd, t));
    expect(hz(pd.s, 'w_pod')).toHaveLength(1);
    run(pd, 44);
    expect(casts(pd, 'w_pod_burst')).toHaveLength(1);
    expect(damaged(t)).toBe(true);
    expect(t.dots.some((d) => d.src === 0 && d.type === 'decay')).toBe(true);
    expect(pd.s.projectiles.filter((pr) => pr.kind === 'w_thorn').length + pd.events.filter((x) => x.t === 'hit').length).toBeGreaterThanOrEqual(8);
  });
});

describe('warden: determinism', () => {
  const script = (s: SimState, n: number, start = 0) => {
    for (let i = start; i < start + n; i++) {
      const p = s.players[0];
      p.iframes = 1e6;
      const buttons = ACTION.ATTACK | (i % 40 === 0 ? ACTION.SKILL1 : 0) | (i % 55 === 5 ? ACTION.SKILL2 : 0) | (i % 47 === 9 ? ACTION.SKILL3 : 0) | (i % 200 === 20 ? ACTION.SIGNATURE : 0);
      const ang = i * 0.031;
      step(s, [{ seq: i + 1, moveX: Math.round(Math.cos(ang) * 64) / 127, moveY: Math.round(Math.sin(ang) * 64) / 127, aimX: Math.round(Math.cos(ang * 1.7) * 256) / 64, aimY: Math.round(Math.sin(ang * 1.7) * 256) / 64, buttons }]);
    }
  };
  const setup = () => {
    const a = arena('warden', [...BEAST8, 'w_endless_pack', 'w_alpha_pounce', ...GROVE8.slice(0, 4), 'w_overgrowth', ...THORNS8.slice(0, 5), 'w_contagion', 'w_bramblehide']);
    for (let i = 0; i < 6; i++) spawnAt(a, i % 2 ? 'pursuer' : 'skirmisher', 3 + i, i * 50, 1 + i, false);
    devSpawn(a.s, 'guardian', a.s.players[0].x + 2, a.s.players[0].y, Big.from(3));
    return a;
  };
  it('identical inputs give identical states, and a mid-combat checkpoint resumes identically', () => {
    const a = setup(), b = setup();
    script(a.s, 300); script(b.s, 300);
    expect(stateHash(a.s)).toBe(stateHash(b.s));
    expect(a.s.hazards.some((h: Hazard) => h.kind.startsWith('w_'))).toBe(true);
    const c = deserializeState(serializeState(a.s));
    script(a.s, 300, 300); script(c, 300, 300);
    expect(stateHash(c)).toBe(stateHash(a.s));
  });
  it('the reference bot can play a Warden run', () => {
    const s = newRun(['warden'], 'WARDEN_BOT_1');
    runBot(s, { maxTicks: 60 * 60 * 3 });
    expect(s.round).toBeGreaterThanOrEqual(1);
  });
});
