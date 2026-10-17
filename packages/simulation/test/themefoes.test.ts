import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import {
  DUNGEON_THEMES, ENEMIES, ENEMY_BY_ID, LOOT_RULES, MINIBOSS_EXCLUDED_ROLES, MINIBOSS_MECHANICS, MINIBOSS_NAMES, PACK_BY_ID, RULES, THEME_FOES,
  THEME_PACKS, isBossRound, miniBossName, validateContent,
} from '@cursebound/content';
import {
  buildSnapshot, devSpawn, enemyUnitHealth, hasStatus, hitEnemy, killEnemy, makeMiniBoss, miniBossBaseHealth, miniBossChance, miniBossScore, nearestFloor,
  rayDistance, seedRng, setupRound, spawnWave, stateHash, step, type EnemyState, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Theme foes (content 1.5) and named mini-bosses (rules 1.6, simulation minibosses.ts).

const NEW_THEMES = ['sky', 'moon', 'server'] as const;
const T = (sec: number) => Math.round(sec * 60);

/** A COMBAT round on a forced theme with the population spawned (wave 0) but nothing stepped yet. */
function floor(seed: string, round: number, theme: string, classId = 'vanguard'): { s: SimState; ev: SimEvent[] } {
  const s = newRun([classId], seed);
  s.round = round;
  s.nextTheme = { round, theme };
  setupRound(s, []);
  s.phase = 'COMBAT';
  const ev: SimEvent[] = [];
  spawnWave(s, ev, 0);
  return { s, ev };
}

/** A combat arena with an inert, far-away objective anchor so the round stays open while we test. */
function arena(seed = 'THEME_ARENA', round = 3): SimState {
  const s = newRun(['vanguard'], seed);
  s.round = round;
  setupRound(s, []);
  s.phase = 'COMBAT';
  s.enemies = []; s.pendingSpawns = [];
  const enc = s.encounter!;
  enc.groups = [{ id: 99, weight: 1, archetype: 'pursuer', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = 0; enc.waveCount = 1; enc.objectiveTotal = 1;
  const p = s.players[0];
  let fx = p.x, fy = p.y, fd = -1;
  const map = s.map!;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] !== 0) continue;
    const x = (i % map.w) + 0.5, y = Math.floor(i / map.w) + 0.5;
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d > fd) { fd = d; fx = x; fy = y; }
  }
  const anchor = devSpawn(s, 'pursuer', fx, fy);
  anchor.objective = true; anchor.groupId = 99; anchor.staggerUntil = 1e12;
  return s;
}

/** The most open direction from the hero (unit vector) and its free length. */
function openDir(s: SimState): [number, number, number] {
  const p = s.players[0];
  let best: [number, number, number] = [1, 0, 0];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const dx = Math.round(Math.cos(a) * 1e6) / 1e6, dy = Math.round(Math.sin(a) * 1e6) / 1e6;
    const d = rayDistance(s.map!, p.x, p.y, dx, dy, 12);
    if (d > best[2] + 1e-9) best = [dx, dy, d];
  }
  return best;
}

/** A foe near the hero whose attacks all wait except `only` (ready at once), standing still. */
function foe(s: SimState, kind: string, dx: number, dy: number, only?: string): EnemyState {
  const p = s.players[0];
  const [x, y] = nearestFloor(s.map!, p.x + dx, p.y + dy);
  const e = devSpawn(s, kind, x, y);
  for (const a of ENEMY_BY_ID[kind].attacks) e.cooldowns[a.id] = a.id === only ? 0 : 9999;
  e.perceiveIn = 1;
  return e;
}

function run(s: SimState, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks && s.phase === 'COMBAT'; i++) all.push(...step(s, [null]).events);
  return all;
}

const isMini = (e: EnemyState) => !!e.mini;

describe('theme foes: content', () => {
  it('validates; sky, moon and server room each field four native foes with their own roles and one impeding effect each', () => {
    expect(validateContent()).toEqual([]);
    for (const t of NEW_THEMES) {
      const foes = THEME_FOES[t];
      expect(foes, t).toHaveLength(4);
      expect(new Set(foes.map((id) => ENEMY_BY_ID[id].role)).size, t).toBeGreaterThanOrEqual(3);
      for (const id of foes) {
        const d = ENEMY_BY_ID[id];
        expect(d.themes).toContain(t);
        expect(d.tags).toContain('objective');
        // individually weak (inside the catacomb foes' envelope) and impeding: an affliction or a shove
        expect(d.baseHealth).toBeLessThanOrEqual(340);
        expect(d.baseDamage).toBeLessThanOrEqual(34);
        const impedes = d.attacks.filter((a) => a.inflict || a.push);
        expect(impedes.length, id).toBeGreaterThanOrEqual(1);
      }
    }
    // the generic catacomb themes keep their foes; theme natives never leak into another theme's packs
    const natives = new Set(Object.values(THEME_FOES).flat());
    for (const t of DUNGEON_THEMES.map((x) => x.id)) {
      for (const id of Object.keys(THEME_PACKS[t])) {
        const pk = PACK_BY_ID[id];
        for (const k of [pk.lead, ...pk.fodder]) if (natives.has(k)) expect(ENEMY_BY_ID[k].themes, `${t}/${id}/${k}`).toContain(t);
      }
    }
  });

  it("each new theme's pack table is led by its own foes (a few generic packs mixed in)", () => {
    for (const t of NEW_THEMES) {
      const w = THEME_PACKS[t];
      const total = Object.values(w).reduce((a, b) => a + b, 0);
      const native = Object.entries(w).filter(([id]) => THEME_FOES[t].includes(PACK_BY_ID[id].lead)).reduce((a, [, x]) => a + x, 0);
      expect(native / total, t).toBeGreaterThanOrEqual(0.75);
      expect(native, t).toBeLessThan(total);   // some generic foes still mix in
      for (const f of THEME_FOES[t]) expect(Object.keys(w).some((id) => PACK_BY_ID[id].lead === f || PACK_BY_ID[id].fodder.includes(f)), `${t}/${f}`).toBe(true);
    }
  });

  it('the population of a sky / moon / server floor is mostly its own foes, and every native shows up', () => {
    for (const t of NEW_THEMES) {
      const seen = new Set<string>();
      let native = 0, all = 0;
      for (let k = 0; k < 4; k++) for (const r of [2, 3, 4]) {
        const { s } = floor(`THEME_POP_${t}_${k}`, r, t);
        expect(s.map!.theme).toBe(t);
        for (const g of s.encounter!.groups) {
          all++;
          if (THEME_FOES[t].includes(g.archetype)) { native++; seen.add(g.archetype); }
        }
      }
      expect(native / all, t).toBeGreaterThan(0.6);
      expect([...seen].sort(), t).toEqual([...THEME_FOES[t]].sort());
    }
  });

  it('swarm packs come bigger (crawlers, malware)', () => {
    expect(PACK_BY_ID.crawlers.extra).toBeGreaterThan(0);
    expect(PACK_BY_ID.malware.extra).toBeGreaterThan(0);
    for (const id of ['mooncrawler', 'malware']) expect(ENEMY_BY_ID[id].role).toBe('swarm');
  });
});

describe('theme foes: behaviour', () => {
  it('Gale Wisp: the gust bursts on its marked circle and shoves the hero out of it', () => {
    const s = arena('GALE_PUSH');
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    p.x -= dx * 0.4; p.y -= dy * 0.4;
    foe(s, 'galewisp', dx * 4.5, dy * 4.5, 'gust');
    const x0 = p.x, y0 = p.y;
    const ev = run(s, T(1.6));
    const push = ev.find((e) => e.t === 'foe_fx' && e.fx === 'push');
    expect(push).toBeTruthy();
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeGreaterThan(0.5);
  });

  it('Cloud Golem: the hail slam detonates around itself and chills', () => {
    const s = arena('GOLEM_QUAKE');
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    foe(s, 'cloudgolem', dx * 1.5, dy * 1.5, 'hailslam');
    const ev = run(s, T(1.4));
    expect(ev.some((e) => e.t === 'foe_fx' && e.fx === 'hailslam')).toBe(true);
    expect(ev.some((e) => e.t === 'afflict' && e.slot === 0 && (e.s === 'chill' || e.s === 'frozen'))).toBe(true);
    expect(s.telegraphs.some((t) => t.attack === 'hailslam')).toBe(false);
    void p;
  });

  it('Lunar Leaper: marks a circle at range, bounds onto it and roots the hero under the landing', () => {
    const s = arena('LEAPER_JUMP');
    const p = s.players[0];
    const [dx, dy, free] = openDir(s);
    const d = Math.min(5, free - 0.5);
    const e = foe(s, 'moonleaper', dx * d, dy * d, 'leap');
    const sx = e.x, sy = e.y;
    let marked = false;
    const ev: SimEvent[] = [];
    for (let i = 0; i < T(2.2) && s.phase === 'COMBAT'; i++) {
      ev.push(...step(s, [null]).events);
      if (s.telegraphs.some((t) => t.ownerId === e.id && (t.attack === 'leap' || t.attack === 'leap_land'))) marked = true;
    }
    expect(marked).toBe(true);
    expect(ev.some((x) => x.t === 'foe_fx' && x.fx === 'leap_land')).toBe(true);
    expect(Math.hypot(e.x - sx, e.y - sy)).toBeGreaterThan(2);
    expect(ev.some((x) => x.t === 'afflict' && x.s === 'rooted')).toBe(true);
    void p;
  });

  it('Glitch Wraith: blinks onto its marked point, in sight of the hero', () => {
    const s = arena('GLITCH_BLINK');
    const [dx, dy] = openDir(s);
    const e = foe(s, 'glitchwraith', dx * 4, dy * 4, 'blink');
    let b: Extract<SimEvent, { t: 'foe_fx' }> | undefined;
    let at: [number, number] = [0, 0];
    for (let i = 0; i < T(1.2) && !b; i++) {
      b = step(s, [null]).events.find((x): x is Extract<SimEvent, { t: 'foe_fx' }> => x.t === 'foe_fx' && x.fx === 'blink');
      at = [e.x, e.y];
    }
    expect(b).toBeTruthy();
    expect(at[0]).toBeCloseTo(b!.tx!, 5);
    expect(at[1]).toBeCloseTo(b!.ty!, 5);
    expect(Math.hypot(b!.tx! - b!.x, b!.ty! - b!.y)).toBeGreaterThan(0.5);
  });

  it('Lunar Sentry tractor beam chains, Storm-Hawk bolt silences, Firewall line roots and lingers', () => {
    for (const [kind, attack, status] of [['lunarsentry', 'tractor', 'chained'], ['stormhawk', 'staticbolt', 'silenced'], ['firewall', 'quarantine', 'rooted']] as const) {
      const s = arena(`IMPEDE_${kind}`);
      const p = s.players[0];
      const [dx, dy, free] = openDir(s);
      const d = Math.min(4, free - 0.5);
      foe(s, kind, dx * d, dy * d, attack);
      let lingered = false;
      const ev: SimEvent[] = [];
      for (let i = 0; i < T(2.5) && s.phase === 'COMBAT'; i++) {
        ev.push(...step(s, [null]).events);
        if (s.hazards.some((h) => h.kind === 'firewall')) lingered = true;
      }
      expect(ev.some((x) => x.t === 'afflict' && x.s === status), kind).toBe(true);
      if (kind === 'firewall') expect(lingered).toBe(true);
      void p;
    }
  });

  it('the Firewall Sentinel blocks hits from the front with its shield wall', () => {
    const s = arena('FIREWALL_FRONT');
    const e = foe(s, 'firewall', 3, 0);
    e.fx = -1; e.fy = 0;   // its shield faces -x
    expect(ENEMY_BY_ID.firewall.tags).toContain('frontal');
    const hit = (fromX: number) => hitEnemy(s, [], e, Big.from(100), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX, fromY: e.y, allowCrit: false }).dealt;
    const front = hit(e.x - 2);
    e.cohort.front = Big.ZERO;
    const back = hit(e.x + 2);
    expect(back.gt(front.mul(Big.from(3)))).toBe(true);
  });
});

describe('named mini-bosses: spawning', () => {
  it('spawn chance: none in round 1, on boss rounds, in training or the tutorial; RULES.miniBossChance otherwise', () => {
    const s = newRun(['vanguard'], 'MB_CHANCE');
    expect(miniBossChance(s, 1)).toBe(0);
    expect(miniBossChance(s, RULES.bossEvery)).toBe(0);
    expect(miniBossChance(s, RULES.miniBossMinRound)).toBe(RULES.miniBossChance);
    expect(miniBossChance({ ...s, tutorial: true }, 3)).toBe(0);
    expect(miniBossChance({ ...s, training: { ai: true } }, 3)).toBe(0);
  });

  it('about one per round on most rounds: the rate matches RULES.miniBossChance, never more than one', () => {
    let rounds = 0, minis = 0;
    for (let k = 0; k < 18; k++) for (const r of [2, 3, 4, 6, 7, 8]) {
      const theme = DUNGEON_THEMES[(k + r) % DUNGEON_THEMES.length].id;
      const { s } = floor(`MB_RATE_${k}`, r, theme);
      const groups = s.encounter!.groups.filter((g) => g.mini);
      expect(groups.length).toBeLessThanOrEqual(1);
      rounds++;
      if (groups.length) minis++;
    }
    const rate = minis / rounds;
    expect(rate).toBeGreaterThan(RULES.miniBossChance - 0.12);
    expect(rate).toBeLessThan(RULES.miniBossChance + 0.12);
    // never on round 1 or a boss round
    for (let k = 0; k < 6; k++) {
      expect(floor(`MB_R1_${k}`, 1, 'catacombs').s.encounter!.groups.some((g) => g.mini)).toBe(false);
      const b = newRun(['vanguard'], `MB_BOSS_${k}`); b.round = RULES.bossEvery; setupRound(b, []);
      expect(isBossRound(b.round) && b.encounter!.groups.some((g) => g.mini)).toBe(false);
    }
  });

  it('is deterministic: the same seed gives the same mini-boss (kind, name, mechanics, place) and the same state', () => {
    const a = floor('MB_DET', 3, 'moon');
    const b = floor('MB_DET', 3, 'moon');
    const ma = a.s.enemies.find(isMini), mb = b.s.enemies.find(isMini);
    expect(ma).toBeTruthy();
    expect({ k: mb!.kind, n: mb!.mini!.name, m: mb!.mini!.mechs, x: mb!.x, y: mb!.y }).toEqual({ k: ma!.kind, n: ma!.mini!.name, m: ma!.mini!.mechs, x: ma!.x, y: ma!.y });
    run(a.s, 600); run(b.s, 600);
    expect(stateHash(a.s)).toBe(stateHash(b.s));
    // a different seed gives a different identity
    const names = new Set<string>();
    for (let k = 0; k < 8; k++) { const m = floor(`MB_NAMES_${k}`, 3, 'server').s.enemies.find(isMini); if (m) names.add(m.mini!.name); }
    expect(names.size).toBeGreaterThan(3);
  });

  it('stands in a proper room far from the heroes, as an idle theme foe that never rolls elite', () => {
    let found = 0;
    for (let k = 0; k < 10; k++) {
      const theme = NEW_THEMES[k % 3];
      const { s } = floor(`MB_ROOM_${k}`, 4, theme);
      const m = s.enemies.find(isMini);
      if (!m) continue;
      found++;
      const p = s.players[0];
      expect(Math.hypot(m.x - p.x, m.y - p.y)).toBeGreaterThan(RULES.packSafeRadius - 2);
      expect(m.dormant).toBe(true);
      expect(m.elite ?? 0).toBe(0);
      expect(MINIBOSS_EXCLUDED_ROLES).not.toContain(ENEMY_BY_ID[m.kind].role);
      expect(s.encounter!.groups.find((g) => g.id === m.groupId)!.mini).toBe(true);
      const tx = Math.floor(m.x), ty = Math.floor(m.y);
      const room = s.map!.rooms?.find((r) => tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h);
      if (room) expect(['hall', 'bridge', 'approach', 'arena']).not.toContain(room.kind);
      // escorts share its pack
      expect(s.enemies.filter((e) => e.pack === m.pack && e !== m).length).toBeGreaterThanOrEqual(1);
    }
    expect(found).toBeGreaterThan(4);
  });

  it('is tougher than a rare of its kind and far below a boss, bigger, with a name and 1-2 mechanics', () => {
    const s = arena('MB_STATS', 4);
    for (const kind of ['harpy', 'cloudgolem', 'moonleaper', 'glitchwraith', 'gaoler', 'pursuer']) {
      const e = devSpawn(s, kind, s.players[0].x + 3, s.players[0].y);
      const base = e.cohort.unitHp, r0 = e.radius;
      makeMiniBoss(s, [], e, seedRng('MB', kind));
      const rare = base.mul(Big.from(RULES.rareHealth));
      expect(e.cohort.unitHp.gt(rare), kind).toBe(true);
      expect(e.cohort.unitHp.toNumber()).toBeCloseTo(enemyUnitHealth(s, miniBossBaseHealth(kind), 4, 1).toNumber(), 6);
      expect(e.cohort.unitHp.lt(enemyUnitHealth(s, 1350, 4, 8).mul(Big.from('0.35')))).toBe(true);
      expect(e.radius).toBeGreaterThan(r0);
      expect(e.mini!.name.length).toBeGreaterThan(5);
      expect(e.mini!.mechs.length).toBeGreaterThanOrEqual(1);
      expect(e.mini!.mechs.length).toBeLessThanOrEqual(2);
      for (const m of e.mini!.mechs) expect(MINIBOSS_MECHANICS.some((x) => x.id === m)).toBe(true);
    }
  });

  it('names come from theme-flavoured parts', () => {
    expect(miniBossName('catacombs', 0, 0, 0)).toBe('Grimtooth the Unbowed');
    for (const t of DUNGEON_THEMES.map((x) => x.id)) {
      const n = miniBossName(t, 3, 5, 1);
      const parts = MINIBOSS_NAMES[t];
      expect(parts.first.some((f) => n.startsWith(f)), `${t}: ${n}`).toBe(true);
      expect(parts.epithet.some((x) => n.endsWith(x)), `${t}: ${n}`).toBe(true);
      expect(n.length).toBeLessThanOrEqual(32);
    }
  });
});

describe('named mini-bosses: encounter, mechanics, loot', () => {
  /** A forced mini-boss of `kind` next to the hero, awake, with the given mechanics. */
  function boss(seed: string, kind: string, mechs: string[]): { s: SimState; e: EnemyState } {
    const s = arena(seed, 4);
    const [dx, dy, free] = openDir(s);
    const d = Math.min(2.5, free - 1);
    const [x, y] = nearestFloor(s.map!, s.players[0].x + dx * d, s.players[0].y + dy * d);
    const e = devSpawn(s, kind, x, y);
    makeMiniBoss(s, [], e, seedRng(seed), mechs);
    for (const a of ENEMY_BY_ID[kind].attacks) e.cooldowns[a.id] = 9999;
    return { s, e };
  }

  it('announces itself when found, and the snapshot carries its name and mechanics', () => {
    const { s, e } = boss('MB_AWAKE', 'harpy', ['enrage']);
    const ev = run(s, 2);
    const aw = ev.find((x): x is Extract<SimEvent, { t: 'miniboss' }> => x.t === 'miniboss' && x.op === 'awake');
    expect(aw?.name).toBe(e.mini!.name);
    const se = buildSnapshot(s).enemies.find((x) => x.i === e.id)!;
    expect(se.mb).toBe(e.mini!.name);
    expect(se.mm).toEqual(['enrage']);
    expect(se.el).toBeUndefined();
  });

  it('ground slam: a marked circle, a channel, then a shockwave that hurts and shoves', () => {
    const { s, e } = boss('MB_SLAM', 'cloudgolem', ['slam']);
    const p = s.players[0];
    const ev: SimEvent[] = [];
    let marked = false;
    for (let i = 0; i < T(5); i++) {
      ev.push(...step(s, [null]).events);
      if (s.telegraphs.some((t) => t.attack === 'mb_slam')) marked = true;
    }
    expect(marked).toBe(true);
    expect(ev.some((x) => x.t === 'miniboss' && x.op === 'slam_warn')).toBe(true);
    expect(ev.some((x) => x.t === 'miniboss' && x.op === 'slam')).toBe(true);
    expect(ev.some((x) => x.t === 'hit' && x.targetKind === 'player')).toBe(true);
    expect(ev.some((x) => x.t === 'foe_fx' && x.fx === 'push')).toBe(true);
    void p; void e;
  });

  it('summons linked minions through circles; enrage below 40%; a ward at 70%', () => {
    const a = boss('MB_SUMMON', 'galewisp', ['summon']);
    run(a.s, T(6));
    const minions = a.s.enemies.filter((x) => x.summonerId === a.e.id && x.state !== 'dying');
    expect(minions.length).toBeGreaterThanOrEqual(2);
    expect(minions.every((x) => !x.objective)).toBe(true);
    killEnemy(a.s, [], a.e, 0);
    expect(a.s.enemies.filter((x) => x.summonerId === a.e.id && x.state !== 'dying')).toHaveLength(0);

    const b = boss('MB_ENRAGE', 'moonleaper', ['enrage', 'shield']);
    run(b.s, 2);
    const speed = b.e.moveSpeed;
    b.e.cohort.front = b.e.cohort.unitHp.mul(Big.from('0.35'));   // 65% health: the first ward
    let ev = run(b.s, 2);
    expect(ev.some((x) => x.t === 'miniboss' && x.op === 'shield')).toBe(true);
    expect(b.e.shieldUntil).toBeGreaterThan(b.s.tick);
    b.e.cohort.front = b.e.cohort.unitHp.mul(Big.from('0.7'));    // 30%: enraged and warded again
    ev = run(b.s, 2);
    expect(ev.some((x) => x.t === 'miniboss' && x.op === 'enrage')).toBe(true);
    expect(b.e.moveSpeed).toBeGreaterThan(speed);
    expect(buildSnapshot(b.s).enemies.find((x) => x.i === b.e.id)!.enr).toBe(1);
  });

  it('venom trail: poisonous puddles where it walks', () => {
    const { s, e } = boss('MB_POISON', 'harpy', ['poison']);
    e.moveSpeed = 2; e.attack = null;
    for (const a of ENEMY_BY_ID.harpy.attacks) e.cooldowns[a.id] = 9999;
    run(s, T(1.2));
    expect(s.hazards.some((h) => h.kind === 'venom' && h.ownerId === e.id)).toBe(true);
  });

  it('its own loot: rare-tier potions and a haste orb, a legendary at miniBossLegendaryChance, and a score burst', () => {
    const { s, e } = boss('MB_LOOT', 'stormhawk', ['enrage']);
    run(s, 2);
    const score0 = BigInt(s.scoreText);
    const pts = miniBossScore(s);
    expect(pts).toBeGreaterThan(0n);
    const ev: SimEvent[] = [];
    killEnemy(s, ev, e, 0);
    const slain = ev.find((x): x is Extract<SimEvent, { t: 'miniboss' }> => x.t === 'miniboss' && x.op === 'slain');
    expect(slain?.pts).toBe(pts.toString());
    expect(BigInt(s.scoreText) - score0).toBe(pts);
    const rare = s.pickups.filter((k) => k.tier === 2);
    expect(rare.filter((k) => k.kind === 'potion').length).toBeGreaterThanOrEqual(2);
    expect(rare.filter((k) => k.kind === 'orb').length).toBeGreaterThanOrEqual(1);
    expect(ev.some((x) => x.t === 'domain' && x.type === 'miniboss_slain')).toBe(true);

    // the legendary roll, over many kills: near RULES.miniBossLegendaryChance (well above a rare's)
    let drops = 0;
    const N = 160;
    for (let k = 0; k < N; k++) {
      const t = boss(`MB_LEG_${k}`, 'harpy', ['enrage']);
      const ev2: SimEvent[] = [];
      killEnemy(t.s, ev2, t.e, 0);
      if (ev2.some((x) => x.t === 'loot')) drops++;
    }
    expect(drops / N).toBeGreaterThan(RULES.miniBossLegendaryChance - 0.12);
    expect(drops / N).toBeLessThan(RULES.miniBossLegendaryChance + 0.14);
    expect(RULES.miniBossLegendaryChance).toBeGreaterThan(LOOT_RULES.rareChance);
  });

  it('a population mini-boss is part of the round: killing it counts toward the clear', () => {
    let m: EnemyState | undefined, s!: SimState;
    for (let k = 0; k < 6 && !m; k++) { s = floor(`MB_OBJ_${k}`, 3, 'sky').s; m = s.enemies.find(isMini); }
    expect(m).toBeTruthy();
    expect(m!.objective).toBe(true);
    const g = s.encounter!.groups.find((x) => x.id === m!.groupId)!;
    killEnemy(s, [], m!, 0);
    run(s, 2);
    expect(g.defeated).toBe(true);
    expect(hasStatus(s, s.players[0], 'chained')).toBe(false);
  });
});

describe('named mini-bosses: training grounds', () => {
  it('TRAIN miniboss spawns a named mini-boss with escorts, one at a time; it drops loot but pays no score', () => {
    const s = newRun(['vanguard'], 'TRAIN_MB', { training: true });
    for (let i = 0; i < 600 && s.phase !== 'COMBAT'; i++) step(s, [null], []);
    expect(s.phase).toBe('COMBAT');
    const r = step(s, [null], [{ type: 'TRAIN', slot: 0, op: 'miniboss' }]);
    expect(r.outcomes[0].ok).toBe(true);
    const m = s.enemies.find(isMini)!;
    expect(m).toBeTruthy();
    expect(s.enemies.length).toBe(1 + RULES.miniBossEscorts);
    expect(step(s, [null], [{ type: 'TRAIN', slot: 0, op: 'miniboss' }]).outcomes[0]).toMatchObject({ ok: false, code: 'MINIBOSS_ACTIVE' });
    expect(step(s, [null], [{ type: 'TRAIN', slot: 0, op: 'miniboss', arg: 'nopack' }]).outcomes[0]).toMatchObject({ ok: false });
    const score = s.scoreText;
    killEnemy(s, [], m, 0);
    expect(s.scoreText).toBe(score);
    expect(s.pickups.filter((k) => k.tier === 2).length).toBeGreaterThanOrEqual(3);
    const r2 = step(s, [null], [{ type: 'TRAIN', slot: 0, op: 'miniboss', arg: 'firewall' }]);
    expect(r2.outcomes[0].ok).toBe(true);   // a guardian pack id names its lead even though guardians never roll naturally
    void ENEMIES;
  });
});
