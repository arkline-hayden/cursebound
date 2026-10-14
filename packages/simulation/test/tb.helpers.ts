import { Big } from '@cursebound/numeric';
import { contentHash, NODE_BY_ID } from '@cursebound/content';
import { createRun, devSpawn, rebuildSkills, step, type EnemyState, type PlayerInput, type SimEvent, type SimState } from '@cursebound/simulation';

let seq = 0;

// Arena harness for the Templar / Berserker kit tests: a real run advanced into COMBAT, then an open 30x30 room,
// no encounter spawns, and hand-placed enemies that keep the round alive.

export function arena(classes: string[], seed = 'TB_ARENA'): SimState {
  const s = createRun({
    runId: 'run_' + seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 20), seed, mode: classes.length > 1 ? 'coop' : 'solo', trust: 'local', contentHash: contentHash(),
    roster: classes.map((c, i) => ({ slot: i, profileId: 'p' + i, name: 'P' + i, classId: c })),
  });
  for (let i = 0; i < 2000 && s.phase !== 'COMBAT'; i++) {
    const cmds = s.phase === 'LOADOUT_LOCK' ? s.players.filter((p) => !p.ready).map((p) => ({ type: 'READY' as const, slot: p.slot, ready: true })) : [];
    step(s, [], cmds);
  }
  if (s.phase !== 'COMBAT') throw new Error('arena: never reached COMBAT');
  const w = 30, h = 30;
  const tiles: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0);
  s.map = { ...s.map!, w, h, tiles };
  s.enemies = []; s.projectiles = []; s.hazards = []; s.telegraphs = []; s.pendingSpawns = [];
  const enc = s.encounter!;
  enc.groups = [{ id: 0, weight: 1, archetype: 'pursuer', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = enc.waveCount - 1; enc.objectiveTotal = 1; enc.completedWeight = 0;
  s.players.forEach((p, i) => { p.x = 10; p.y = 10 + i * 2; p.vx = 0; p.vy = 0; p.aimX = 1; p.aimY = 0; p.iframes = 1000; });
  // a distant, effectively unkillable anchor keeps the round in COMBAT whatever the test kills
  spawn(s, 27, 27, { hp: 1e30 });
  seq = 0;
  return s;
}

/** Spawn an objective enemy (keeps the round in COMBAT). `hp` overrides the unit health. */
export function spawn(s: SimState, x: number, y: number, opts: { kind?: string; hp?: number; count?: number; speed?: number } = {}): EnemyState {
  const e = devSpawn(s, opts.kind ?? 'pursuer', x, y, Big.from(opts.count ?? 1));
  e.objective = true; e.groupId = 0;
  if (opts.hp !== undefined) e.cohort.unitHp = Big.from(opts.hp);
  e.moveSpeed = opts.speed ?? 0;                                                          // stationary unless asked
  e.cooldowns = { ...e.cooldowns, _pause: 0 };
  for (const k of Object.keys(e.cooldowns)) if (k !== '_pause') e.cooldowns[k] = 999;   // no attacks during kit tests
  return e;
}

/** Grant nodes directly (tests only): ranks, branch spend and the rebuilt hotbar. */
export function give(s: SimState, slot: number, nodes: Record<string, number>) {
  const p = s.players[slot];
  for (const [id, r] of Object.entries(nodes)) {
    const n = NODE_BY_ID[id];
    if (!n) throw new Error('unknown node ' + id);
    p.ranks[id] = r;
    p.spentByBranch[n.branch] = (p.spentByBranch[n.branch] ?? 0) + r;
  }
  s.stateVersion++;
  rebuildSkills(p);
}

export function inp(buttons = 0, aimX = 1, aimY = 0, moveX = 0, moveY = 0): PlayerInput {
  return { seq: ++seq, moveX, moveY, aimX, aimY, buttons };
}

/** Step `n` ticks with per-tick inputs; returns every event. */
export function run(s: SimState, n: number, inputs: (t: number) => (PlayerInput | null)[] = () => []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < n; t++) all.push(...step(s, inputs(t)).events);
  return all;
}

export const casts = (ev: SimEvent[], skill: string) => ev.filter((e): e is Extract<SimEvent, { t: 'cast' }> => e.t === 'cast' && e.skill === skill);
export const hitsOn = (ev: SimEvent[], id: number) => ev.filter((e) => e.t === 'hit' && e.targetKind === 'enemy' && e.target === id).length;
export const hpLeft = (e: EnemyState) => e.cohort.unitHp.sub(e.cohort.spread).sub(e.cohort.front);
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Button bits: SKILL1 2, SKILL2 4, SKILL3 8, SIGNATURE 16, ATTACK 1. */
export const BTN = { ATTACK: 1, S1: 2, S2: 4, S3: 8, SIG: 16 } as const;
