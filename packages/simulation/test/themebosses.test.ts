import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { BOSS_ADDS, BOSS_ARENAS, BOSS_LOOT, BOSS_BY_ID, RULES, SKY_FALL, THEME_BOSSES, contentHash, validateContent } from '@cursebound/content';
import {
  bossAltitude, bossForRound, bossImmune, botCommands, botInput, buildSnapshot, deserializeState, generateDungeon, hitEnemy, isVoidAt,
  killEnemy, makeHazard, pushHero, safeSpot, serializeState, setupRound, spawnWave, stateHash, step,
  type Command, type EnemyState, type MapState, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Theme bosses (content bossesSkyMoon.ts, simulation bosses/*): the Gale Wyrm on sky floors and the Crater Horror on
// moon floors. Selection by theme, their lairs, phases and modules, reinforcements at 2/3 and 1/3, checkpoint
// determinism mid-fight, and the gale's void safety (a push over the brink is the long fall, never a silent death).

/** Instant-clear the state machine up to COMBAT of `round`, forcing that round's theme (as a door would). */
function skipTo(s: SimState, round: number, theme?: string) {
  let seq = 1;
  for (let i = 0; i < 400000 && !(s.round === round && s.phase === 'COMBAT'); i++) {
    if (theme && s.round === round - 1) s.nextTheme = { round, theme };
    const cmds: Command[] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'VOTING' && s.offer) for (const p of s.players) if (!s.offer.votes[p.slot].locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: seq++, cardSlot: 0, locked: true });
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    if (s.phase === 'COMBAT') for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    for (const p of s.players) p.iframes = 10;
    step(s, [], cmds);
  }
}

/** A theme boss fight at round 5 past the grand entrance. `guard`: heroes stay invulnerable while ticking. */
function lair(theme: 'sky' | 'moon', classes: string[], seed: string) {
  const s = newRun(classes, seed);
  skipTo(s, 5, theme);
  for (let i = 0; i < 600 && (s.cinematicUntilTick ?? 0) > s.tick; i++) step(s, [], []);
  for (const p of s.players) { p.iframes = 0; p.hp = p.maxHp; }
  const boss = s.enemies.find((e) => e.boss)!;
  const events: SimEvent[] = [];
  const tick = (n: number, guard = true, inputs?: () => (PlayerInput | null)[]) => {
    for (let i = 0; i < n; i++) {
      if (guard) for (const p of s.players) p.iframes = 10;
      events.push(...step(s, inputs ? inputs() : [], []).events);
    }
  };
  const setFrac = (f: number) => { boss.cohort.spread = Big.ZERO; boss.cohort.front = boss.cohort.unitHp.mul(Big.from((1 - f).toFixed(6))); };
  return { s, boss, events, tick, setFrac };
}

const tileOf = (m: MapState, x: number, y: number) => Math.floor(y) * m.w + Math.floor(x);
const isFloor = (m: MapState, x: number, y: number) => m.tiles[tileOf(m, x, y)] === 0;
const foeFx = (ev: SimEvent[], fx: string) => ev.filter((e): e is Extract<SimEvent, { t: 'foe_fx' }> => e.t === 'foe_fx' && e.fx === fx);

describe('theme bosses: content and selection', () => {
  it('validates, and every theme boss has its arena, adds and loot table', () => {
    expect(validateContent()).toEqual([]);
    expect(THEME_BOSSES).toMatchObject({ sky: 'skydrake', moon: 'moonhorror' });
    for (const b of ['skydrake', 'moonhorror']) {
      expect(BOSS_BY_ID[b], b).toBeDefined();
      expect(BOSS_ARENAS[b], b).toHaveLength(1);
      expect(BOSS_ADDS[b]?.length, b).toBeGreaterThan(0);
      expect(BOSS_LOOT[b]?.length, b).toBeGreaterThan(0);
      expect(BOSS_BY_ID[b].phases.map((p) => p.healthFrac)).toEqual([1, 0.5]);
    }
  });

  it('a sky boss round fights the Gale Wyrm in the floating ring, a moon one the Crater Horror in its basin', () => {
    for (const [theme, boss, arena] of [['sky', 'skydrake', 'skyring'], ['moon', 'moonhorror', 'crater']] as const) {
      for (let k = 0; k < 4; k++) {
        const seed = `THEMEBOSS_${theme}_${k}`;
        const st = newRun(['vanguard'], seed);
        st.round = 5 * (k + 1);
        st.nextTheme = { round: st.round, theme };
        setupRound(st, []);
        expect(st.map!.theme).toBe(theme);
        expect(st.encounter!.bossId).toBe(boss);
        expect(bossForRound(seed, st.round, theme)).toBe(boss);
        expect(st.map!.arena).toBe(arena);
        spawnWave(st, [], 0);
        const e = st.enemies.find((x) => x.boss)!;
        expect(e.kind).toBe(boss);
        expect({ x: e.x, y: e.y }).toEqual(st.map!.bossSpawn);
        const room = st.map!.rooms!.find((r) => r.kind === 'arena')!;
        expect(e.x >= room.x && e.x < room.x + room.w && e.y >= room.y && e.y < room.y + room.h).toBe(true);
      }
    }
  });

  it('every other theme keeps the Hollow Stag and the Bell Golem', () => {
    const seen = new Set<string>();
    for (const theme of ['catacombs', 'flooded', 'ossuary', 'sanctum', 'fungal', 'forge', 'frost']) for (const r of [5, 10, 15, 20]) {
      const st = newRun(['vanguard'], 'OLD_BOSSES_' + theme);
      st.round = r;
      st.nextTheme = { round: r, theme };
      setupRound(st, []);
      seen.add(st.encounter!.bossId!);
      expect(['prismstag', 'bellroot']).toContain(st.encounter!.bossId);
    }
    expect([...seen].sort()).toEqual(['bellroot', 'prismstag']);
  });

  it('the lairs: an open dais, a ring over open sky with a hole of sky at its heart, a boulder-strewn basin', () => {
    for (let s = 0; s < 6; s++) {
      const sky = generateDungeon('LAIR' + s, 5, true, 'sky');
      const moon = generateDungeon('LAIR' + s, 5, true, 'moon');
      for (const m of [sky, moon]) {
        expect(m.fallback).toBe(false);
        const b = m.bossSpawn!;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(m.tiles[(Math.floor(b.y) + dy) * m.w + Math.floor(b.x) + dx]).toBe(0);
      }
      expect(sky.arena).toBe('skyring');
      expect(moon.arena).toBe('crater');
      // the ring: its centre is open sky and the rim drops into chasm all round
      const room = sky.rooms!.find((r) => r.kind === 'arena')!;
      const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
      expect(isVoidAt(sky, cx, cy)).toBe(true);
      expect(isVoidAt(sky, room.x + room.w - 0.5, cy) || isVoidAt(sky, room.x + room.w + 0.5, cy)).toBe(true);
      expect(sky.voids!.length).toBeGreaterThan(200);
      // the basin has satellite boulders (blocking) and no chasm
      expect(moon.voids ?? []).toHaveLength(0);
      const mroom = moon.rooms!.find((r) => r.kind === 'arena')!;
      let boulders = 0;
      for (let y = mroom.y + 1; y < mroom.y + mroom.h - 1; y++) for (let x = mroom.x + 1; x < mroom.x + mroom.w - 1; x++) {
        const i = y * moon.w + x;
        if (moon.tiles[i] === 1 && moon.tiles[i - 1] === 0 && moon.tiles[i + 1] === 0 && moon.tiles[i - moon.w] === 0 && moon.tiles[i + moon.w] === 0) boulders++;
      }
      expect(boulders).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('the Gale Wyrm', () => {
  it('phase 1 dives, breathes the gale and rakes; every module is telegraphed first', () => {
    const f = lair('sky', ['vanguard', 'ranger'], 'WYRM_P1');
    expect(f.boss.kind).toBe('skydrake');
    const seen = new Set<string>();
    const telegraphed = new Set<string>();
    for (let i = 0; i < 60 * 40 && seen.size < 3; i++) {
      f.tick(1);
      for (const t of f.s.telegraphs) telegraphed.add(t.attack);
      for (const e of f.events.splice(0)) if (e.t === 'enemy_attack' && e.stage === 'release') { seen.add(e.attack); expect(telegraphed.has(e.attack), e.attack).toBe(true); }
    }
    expect([...seen].sort()).toEqual(['dive', 'gale', 'talon']);
    expect(f.boss.phaseIndex).toBe(0);
  });

  it('phase 2 at half health: it climbs out of reach, rains lightning feathers, then stoops and lands winded', () => {
    const f = lair('sky', ['vanguard', 'ranger'], 'WYRM_P2');
    f.setFrac(0.45);
    f.tick(1);
    expect(f.events.some((e) => e.t === 'boss_phase' && e.phase === 1)).toBe(true);
    expect(f.boss.phaseIndex).toBe(1);
    let aloft = 0, immuneHit = false, feathers = 0, maxAlt = 0;
    for (let i = 0; i < 60 * 20 && !foeFx(f.events, 'drake_land').length; i++) {
      f.tick(1);
      const alt = bossAltitude(f.s, f.boss);
      maxAlt = Math.max(maxAlt, alt);
      feathers = Math.max(feathers, f.s.telegraphs.filter((t) => t.attack === 'stormfeather').length);
      if (bossImmune(f.s, f.boss)) {
        aloft++;
        const before = f.boss.cohort.front;
        const r = hitEnemy(f.s, [], f.boss, Big.from(10000n), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'test', fromX: f.boss.x, fromY: f.boss.y, allowCrit: false, stagger: 9999 });
        expect(r.dealt.isZero()).toBe(true);
        expect(f.boss.cohort.front.eq(before)).toBe(true);
        expect(f.boss.staggerUntil).toBeLessThanOrEqual(f.s.tick);
        immuneHit = true;
        expect(buildSnapshot(f.s).enemies.find((e) => e.i === f.boss.id)!.alt).toBeGreaterThanOrEqual(0.5);
      }
    }
    expect(maxAlt).toBe(1);
    expect(aloft).toBeGreaterThan(60 * 5);   // circling for several seconds
    expect(immuneHit).toBe(true);
    expect(feathers).toBeGreaterThanOrEqual(3);
    expect(foeFx(f.events, 'feather_strike').length).toBeGreaterThan(6);
    expect(foeFx(f.events, 'drake_land')).toHaveLength(1);
    // landed winded: staggered (vulnerable) and back in reach on solid rock
    expect(f.boss.staggerUntil).toBeGreaterThan(f.s.tick);
    expect(bossImmune(f.s, f.boss)).toBe(false);
    expect(isFloor(f.s.map!, f.boss.x, f.boss.y)).toBe(true);
    expect(isVoidAt(f.s.map!, f.boss.x, f.boss.y)).toBe(false);
  });

  it('calls its harpies and wind elementals exactly once at 2/3 and once at 1/3 health', () => {
    const f = lair('sky', ['vanguard', 'ranger'], 'WYRM_ADDS');
    const adds = () => f.events.filter((e): e is Extract<SimEvent, { t: 'boss_adds' }> => e.t === 'boss_adds');
    f.setFrac(0.7); f.tick(30);
    expect(adds()).toHaveLength(0);
    f.setFrac(0.6); f.tick(1);
    expect(adds().map((e) => e.wave)).toEqual([1]);
    f.tick(Math.round(RULES.bossReinforceWarnSec * 60) + 2);
    const minions = f.s.enemies.filter((e) => e.summonerId === f.boss.id && e.state !== 'dying');
    expect(minions.length).toBe(adds()[0].n);
    for (const m of minions) { expect(BOSS_ADDS.skydrake).toContain(m.kind); expect(m.objective).toBe(false); }
    f.setFrac(0.3); f.tick(1);
    expect(adds().map((e) => e.wave)).toEqual([1, 2]);
    f.setFrac(0.1); f.tick(120);
    expect(adds()).toHaveLength(2);
  });

  it('drops one of its own signature legendaries', () => {
    const f = lair('sky', ['vanguard'], 'WYRM_LOOT');
    const ev: SimEvent[] = [];
    killEnemy(f.s, ev, f.boss, 0);
    const loot = ev.filter((e): e is Extract<SimEvent, { t: 'loot' }> => e.t === 'loot');
    expect(loot).toHaveLength(1);
    expect(BOSS_LOOT.skydrake).toContain(loot[0].itemId);
  });
});

describe('the gale is void-safe', () => {
  /** A hero on the ring's brink with chasm one step outward, the Wyrm parked (staggered) and a gale blowing outward. */
  function brink(seed: string, opts: { gale?: boolean } = {}) {
    const f = lair('sky', ['vanguard'], seed);
    const m = f.s.map!;
    const room = m.rooms!.find((r) => r.kind === 'arena')!;
    const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
    // scan outward from the centre along a few headings for the last rock before open sky
    let spot: { x: number; y: number; ux: number; uy: number } | null = null;
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.25]) {
      const ux = Math.cos(a), uy = Math.sin(a);
      let last: [number, number] | null = null;
      for (let r = 2; r < room.w; r += 0.25) {
        const x = cx + ux * r, y = cy + uy * r;
        if (isFloor(m, x, y)) last = [x, y];
        else if (last && isVoidAt(m, x, y)) { spot = { x: last[0], y: last[1], ux, uy }; break; }
      }
      if (spot) break;
    }
    expect(spot).toBeTruthy();
    const p = f.s.players[0];
    p.x = spot!.x; p.y = spot!.y; p.vx = 0; p.vy = 0; p.iframes = 0; p.hp = p.maxHp;
    f.boss.attack = null; f.boss.staggerUntil = f.s.tick + 60 * 60;   // parked
    if (opts.gale !== false) {
      f.s.hazards.push(makeHazard(f.s, {
        kind: 'gale', owner: 'enemy', ownerId: f.boss.id, x: p.x - spot!.ux * 4, y: p.y - spot!.uy * 4, dx: spot!.ux, dy: spot!.uy, radius: 7.5,
        inner: Math.cos((35 * Math.PI) / 180), speed: SKY_FALL.pushSpeed, untilTick: f.s.tick + 90, interval: 1, damage: Big.ZERO, dtype: 'storm',
      }));
    }
    return { ...f, p, spot: spot! };
  }

  it('a hero standing at the brink in the gale takes the long fall: heavy damage, back on solid rock, never killed from full health', () => {
    const b = brink('GALE_FALL');
    b.tick(90, false);
    const falls = foeFx(b.events, 'void_fall');
    expect(falls).toHaveLength(1);
    expect(b.p.lifeState).toBe('alive');
    const lost = 1 - b.p.hp.ratio(b.p.maxHp);
    expect(lost).toBeGreaterThan(0.08);
    expect(lost).toBeLessThanOrEqual(Number(SKY_FALL.healthFrac) + 1e-9);
    const m = b.s.map!;
    // set down on solid rock: floor with no chasm within SKY_FALL.safeRadius tiles, and still on rock afterwards
    const land = falls[0];
    expect(isFloor(m, land.tx!, land.ty!)).toBe(true);
    for (let dy = -SKY_FALL.safeRadius; dy <= SKY_FALL.safeRadius; dy++) for (let dx = -SKY_FALL.safeRadius; dx <= SKY_FALL.safeRadius; dx++) {
      expect(isVoidAt(m, land.tx! + dx, land.ty! + dy)).toBe(false);
    }
    expect(isFloor(m, b.p.x, b.p.y)).toBe(true);
    expect(b.events.some((e) => e.t === 'teleport' && e.slot === 0 && e.style === 'skyfall')).toBe(true);
    expect(b.s.deathRecaps.length === 0 || b.s.deathRecaps.every((r) => r.attack === 'The Long Fall')).toBe(true);
  });

  it('walking into the wind holds the brink; a dash (i-frames) ignores the gale; no push ever leaves a hero over a chasm', () => {
    const walk = brink('GALE_WALK');
    const into = { seq: 0, moveX: -walk.spot.ux, moveY: -walk.spot.uy };
    walk.tick(90, false, () => [{ seq: ++into.seq, moveX: Math.round(into.moveX * 127) / 127, moveY: Math.round(into.moveY * 127) / 127, aimX: 1, aimY: 0, buttons: 0 }]);
    expect(foeFx(walk.events, 'void_fall')).toHaveLength(0);
    expect(walk.p.hp.eq(walk.p.maxHp)).toBe(true);

    const dash = brink('GALE_DASH');
    const x0 = dash.p.x, y0 = dash.p.y;
    for (let i = 0; i < 30; i++) { dash.p.iframes = 1; dash.tick(1, false); }
    expect(Math.hypot(dash.p.x - x0, dash.p.y - y0)).toBeLessThan(1e-9);
    expect(foeFx(dash.events, 'void_fall')).toHaveLength(0);

    // fuzz: random shoves anywhere on the ring never leave a hero standing in a wall or over the void
    const fz = brink('GALE_FUZZ', { gale: false });
    const m = fz.s.map!;
    const floors: number[] = [];
    for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === 0) floors.push(i);
    let r = 12345;
    const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
    let fell = 0, a = 0;
    for (let k = 0; k < 4000; k++) {
      const p = fz.p;
      // episodes: a random spot and a steady shove in one random direction (one push per tick)
      if (k % 40 === 0) { const t = floors[Math.floor(rnd() * floors.length)]; p.x = (t % m.w) + 0.5; p.y = Math.floor(t / m.w) + 0.5; p.hp = p.maxHp; p.lifeState = 'alive'; a = rnd() * Math.PI * 2; }
      p.iframes = 0;
      fz.s.tick++;
      const d = 0.03 + rnd() * 0.09, wob = (rnd() - 0.5) * 0.4;
      const ev: SimEvent[] = [];
      if (pushHero(fz.s, ev, p, Math.cos(a + wob) * d, Math.sin(a + wob) * d, fz.boss)) fell++;
      expect(isFloor(m, p.x, p.y)).toBe(true);
      expect(isVoidAt(m, p.x, p.y)).toBe(false);
    }
    expect(fell).toBeGreaterThan(0);
    // the landing spot is always solid rock
    for (const t of floors.slice(0, 200)) {
      const [sx, sy] = safeSpot(m, (t % m.w) + 0.5, Math.floor(t / m.w) + 0.5, SKY_FALL.safeRadius);
      expect(isFloor(m, sx, sy)).toBe(true);
    }
  });
});

describe('the Crater Horror', () => {
  it('phase 1: tentacles, gravity well, low gravity and the void beam, each telegraphed first', () => {
    const f = lair('moon', ['vanguard', 'ranger'], 'HORROR_P1');
    expect(f.boss.kind).toBe('moonhorror');
    const hz = new Set<string>();
    const telegraphed = new Set<string>();
    for (let i = 0; i < 60 * 45 && hz.size < 4; i++) {
      f.tick(1);
      for (const t of f.s.telegraphs) telegraphed.add(t.attack);
      for (const h of f.s.hazards) if (h.owner === 'enemy' && h.ownerId === f.boss.id) hz.add(h.kind);
    }
    expect([...hz].sort()).toEqual(['gravwell', 'lowgrav', 'tentacle', 'voidbeam']);
    for (const a of ['tentacles', 'gravwell', 'lowgrav', 'voidbeam', 'voidbeam_start']) expect(telegraphed.has(a), a).toBe(true);
    // rooted in its pit
    const home = f.s.map!.bossSpawn!;
    expect(Math.hypot(f.boss.x - home.x, f.boss.y - home.y)).toBeLessThanOrEqual(1.21);
  });

  it('the gravity well drags heroes toward its core; low gravity slows them; i-frames ignore the pull', () => {
    const f = lair('moon', ['vanguard'], 'HORROR_WELL');
    const p = f.s.players[0];
    f.boss.attack = null; f.boss.staggerUntil = f.s.tick + 60 * 60;
    const m = f.s.map!;
    const room = m.rooms!.find((r) => r.kind === 'arena')!;
    const [wx, wy] = safeSpot(m, room.x + room.w * 0.3, room.y + room.h / 2, 1);
    p.x = wx + 2.5; p.y = wy; p.iframes = 0;
    f.s.hazards.push(makeHazard(f.s, { kind: 'gravwell', owner: 'enemy', ownerId: f.boss.id, x: wx, y: wy, radius: 4.2, inner: 1.1, speed: 2.2, untilTick: f.s.tick + 120, interval: 30, nextTick: f.s.tick + 30, damage: Big.from(1n), dtype: 'astral' }));
    f.tick(30, false);
    expect(Math.hypot(p.x - wx, p.y - wy)).toBeLessThan(2.5 - 0.5);
    f.s.hazards.push(makeHazard(f.s, { kind: 'lowgrav', owner: 'enemy', ownerId: f.boss.id, x: p.x, y: p.y, radius: 2.2, untilTick: f.s.tick + 120, interval: 10, damage: Big.ZERO, dtype: 'astral' }));
    f.tick(12, false);
    expect(p.buffs.some((b) => b.id === 'slowed' && b.until > f.s.tick)).toBe(true);
    const x0 = p.x, y0 = p.y;
    for (let i = 0; i < 20; i++) { p.iframes = 1; f.tick(1, false); }
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeLessThan(1e-9);
  });

  it('phase 2 at half health opens with the void beam and spawns crawling brood; adds come at 2/3 and 1/3', () => {
    const f = lair('moon', ['vanguard', 'ranger'], 'HORROR_P2');
    const adds = () => f.events.filter((e): e is Extract<SimEvent, { t: 'boss_adds' }> => e.t === 'boss_adds');
    f.setFrac(0.6); f.tick(1);
    expect(adds().map((e) => e.wave)).toEqual([1]);
    f.setFrac(0.45); f.tick(1);
    expect(f.boss.phaseIndex).toBe(1);
    expect(adds().map((e) => e.wave)).toEqual([1]);
    f.setFrac(0.3); f.tick(1);
    expect(adds().map((e) => e.wave)).toEqual([1, 2]);
    let beamFirst: boolean | null = null;
    let brood = 0;
    for (let i = 0; i < 60 * 40 && !brood; i++) {
      // the heroes deal with the reinforcement waves (the brood is capped while plenty of spawn crawl about)
      if (i === 120) for (const e of f.s.enemies) if (!e.boss && e.state !== 'dying') killEnemy(f.s, [], e, 0);
      f.tick(1);
      for (const e of f.events.splice(0)) {
        if (e.t === 'enemy_attack' && e.stage === 'windup' && beamFirst === null && e.id === f.boss.id) beamFirst = e.attack === 'voidbeam';
        if (e.t === 'foe_fx' && e.fx === 'brood_emerge') brood++;
      }
    }
    expect(beamFirst).toBe(true);
    expect(brood).toBeGreaterThan(0);
    f.tick(2);
    const spawn = f.s.enemies.filter((e) => e.summonerId === f.boss.id && e.state !== 'dying');
    expect(spawn.every((e) => BOSS_ADDS.moonhorror.includes(e.kind))).toBe(true);
    expect(spawn.some((e) => e.kind === 'craterspawn')).toBe(true);
  });

  it('drops one of its own signature legendaries', () => {
    const f = lair('moon', ['vanguard'], 'HORROR_LOOT');
    const ev: SimEvent[] = [];
    killEnemy(f.s, ev, f.boss, 0);
    const loot = ev.filter((e): e is Extract<SimEvent, { t: 'loot' }> => e.t === 'loot');
    expect(BOSS_LOOT.moonhorror).toContain(loot[0].itemId);
  });
});

describe('theme boss fights are deterministic across a checkpoint', () => {
  for (const theme of ['sky', 'moon'] as const) {
    it(`${theme}: a botted fight restored mid-module reproduces the uninterrupted fight`, () => {
      const play = (restoreAt: number | null) => {
        const f = lair(theme, ['vanguard', 'ranger'], 'CKPT_' + theme);
        f.setFrac(0.48);   // into phase 2 (and past the first reinforcement wave) at once
        let s = f.s, seq = 0;
        for (let t = 0; t < 60 * 18; t++) {
          if (t === restoreAt) s = deserializeState(serializeState(s));
          const cmds = s.players.flatMap((p) => botCommands(s, p.slot, 1, () => 0));
          const inputs = s.phase === 'COMBAT' ? s.players.map((p) => botInput(s, p.slot, ++seq)) : [];
          step(s, inputs, cmds);
        }
        return s;
      };
      const a = play(null), b = play(60 * 4 + 7);   // restored while the opener of phase 2 runs
      expect(stateHash(b)).toBe(stateHash(a));
      expect(serializeState(b)).toBe(serializeState(a));
      // the fight was still on, in its second phase, with the first wave called
      expect(a.round).toBe(5);
      expect(a.encounter!.phaseAddsSpawned[0]).toBe(1);
      expect(a.enemies.find((e) => e.boss)?.phaseIndex ?? 1).toBe(1);
    });
  }
});

/** Silence unused-type lint on helpers kept for readability. */
export type _E = EnemyState;
