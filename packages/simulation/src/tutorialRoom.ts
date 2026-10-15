import { Big } from '@cursebound/numeric';
import { DODGE, LEGENDARIES, TICK_RATE, referenceSec, type LegendaryDef } from '@cursebound/content';
import { createEnemy } from './director';
import { canEquip, dropLegendary } from './gear';
import { nearestFloor } from './map';
import { encodeTopology } from './mapgen';
import { FLOOR, fill, rect, solid } from './mapgrid';
import { ONE } from './stats';
import type { EnemyState, GuideState, MapState, PlayerState, SimEvent, SimState } from './types';

// The guided first-run tutorial ("First Descent"; a tutorial room's run, server rooms.ts, never persisted or scored).
// One small hand-built crypt — a spawn chamber, a short passage and a training hall — and six prompted steps that
// advance when they are done (the client draws the prompt near the hero from the snapshot's `gd`):
//   0 move    walk to the glowing mark in the passage to the hall
//   1 attack  strike the straw-stuffed ghoul (a dummy: it never moves or attacks) until it falls
//   2 skills  cast each hotbar skill once (bits 0..2; fresh dummies stand in the hall to aim at)
//   3 dodge   a Bile Toad lobs telegraphed globs: dodge while one is coming and come out unhurt
//   4 loot    a legendary drops: walk over it to wear it (bit 0); a second one for the same slot drops beside you:
//             stand by it to see the quick-compare, or swap it (bit 1)
//   5 door    the hall clears and the three Fate doors open (the regular in-world vote): walk through one
// Committing a door ends the run ("You're ready": sim.ts finalizes instead of building round 2). Heroes cannot fall
// for good (they stand straight back up) and there is no skill pick between the hall and the doors.
// Everything lives in SimState.guide, absent from every other run (their state hashes are untouched). Deterministic:
// positions are fixed tiles of the authored map, the legendaries the first matching pair in content order.

export const GUIDE_STEPS = ['move', 'attack', 'skills', 'dodge', 'loot', 'door'] as const;
export type GuideStep = typeof GUIDE_STEPS[number];
const STEP = Object.fromEntries(GUIDE_STEPS.map((s, i) => [s, i])) as Record<GuideStep, number>;

/** Tiles from the walk mark that count as arrived; tiles from the second legendary that show its quick-compare. */
export const GUIDE_MARK_RADIUS = 1.6;
export const GUIDE_COMPARE_RADIUS = 2.4;
/** Ticks the hero stands by the second legendary for the comparison to count. */
export const GUIDE_COMPARE_TICKS = Math.round(1.5 * TICK_RATE);
/** Pause after a step completes before the next one is set up (lets the success flourish read). */
const STEP_GAP = Math.round(0.6 * TICK_RATE);

const DUMMY = 'pursuer';
const TOAD = 'artillery';
/** Authored spots (tile centres): the walk mark in the passage (on screen from the spawn), the first dummy, the skill
 *  dummies, the toad. */
const MARK = { x: 12.5, y: 11.5 };
const DUMMY_AT = { x: 19.5, y: 11.5 };
const SKILL_DUMMIES = [{ x: 21.5, y: 9.5 }, { x: 22.5, y: 11.5 }, { x: 21.5, y: 13.5 }];
const TOAD_AT = { x: 28.5, y: 11.5 };

/** The tutorial crypt: spawn chamber (west), a three-wide passage, the training hall (east) with four pillars. */
export function generateTutorialMap(): MapState {
  const g = solid(36, 22);
  rect(g, 3, 8, 7, 6, FLOOR);      // spawn chamber
  rect(g, 10, 10, 4, 3, FLOOR);    // passage
  rect(g, 14, 4, 19, 15, FLOOR);   // training hall
  for (const [x, y] of [[17, 7], [29, 7], [17, 15], [29, 15]]) fill(g, x, y);
  const m: MapState = {
    w: g.w, h: g.h, tiles: g.t, topology: 'tutorial', fallback: false, decorSeed: 4242, theme: 'catacombs', layout: 'tutorial',
    playerSpawns: [{ x: 5.5, y: 10.5 }, { x: 5.5, y: 11.5 }, { x: 6.5, y: 10.5 }, { x: 6.5, y: 11.5 }, { x: 4.5, y: 11.5 }],
    enemySpawns: [{ x: 26.5, y: 11.5 }, { x: 30.5, y: 6.5 }, { x: 30.5, y: 16.5 }, { x: 22.5, y: 6.5 }],
    rooms: [
      { x: 3, y: 8, w: 7, h: 6, kind: 'approach', shape: 'rect', v: 11 },
      { x: 10, y: 10, w: 4, h: 3, kind: 'hall', shape: 'hall', v: 12 },
      { x: 14, y: 4, w: 19, h: 15, kind: 'barracks', shape: 'rect', v: 13 },
    ],
  };
  m.topology = encodeTopology(m);
  return m;
}

export function newGuide(): GuideState {
  return { step: 0, at: 0, done: 0, ids: [], dodge: 0, hurt: 0, taken: '0', near: 0 };
}

/** The first pair of legendaries for one gear slot this hero can wear (content order), preferring a slot the hero has
 *  empty so the first one is worn by walking over it: what step 4 drops (remembered in GuideState.items). */
export function guideLoot(p: PlayerState): [LegendaryDef, LegendaryDef] | null {
  for (const emptyOnly of [true, false]) {
    const bySlot = new Map<string, LegendaryDef[]>();
    for (const d of LEGENDARIES) {
      if (d.classId || !canEquip(p, d) || (emptyOnly && p.gear?.[d.slot])) continue;
      const l = bySlot.get(d.slot) ?? [];
      l.push(d);
      bySlot.set(d.slot, l);
      if (l.length === 2) return [l[0], l[1]];
    }
  }
  return null;
}

/** ROUND_SETUP of a guided run: the crypt, an encounter with nothing to clear, heroes in the spawn chamber. */
export function setupGuide(state: SimState, ev: SimEvent[]) {
  state.map = generateTutorialMap();
  state.enemies = []; state.projectiles = []; state.hazards = []; state.telegraphs = []; state.pendingSpawns = []; state.reactions = []; state.bossPhaseEvents = [];
  state.encounter = {
    round: state.round, isBoss: false, bossId: null, bossEntityId: null, groups: [], wave: 0, waveCount: 1, waveTimer: 0,   // no waves at all
    objectiveTotal: 0, completedWeight: 0, referenceTicks: referenceSec(1) * TICK_RATE, activeTicks: 0, budget: '0', pressure: ONE, phaseAddsSpawned: [],
  };
  state.players.forEach((p, i) => {
    const s = state.map!.playerSpawns[i % state.map!.playerSpawns.length];
    p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
    p.dodgeTimer = 0; p.guardTimer = 0; p.iframes = 0; p.attackWork = 0;
  });
  const g = state.guide ?? (state.guide = newGuide());
  enter(state, ev, g, 0);
  ev.push({ t: 'domain', type: 'tutorial_started', payload: { topology: state.map.topology } });
}

/** Dummies stand still (sim.ts combatTick runs them through the training-idle step). */
export function guideIdle(state: SimState, e: EnemyState): boolean {
  const g = state.guide;
  return !!g && g.step < STEP.dodge && g.ids.includes(e.id);
}

function living(state: SimState, g: GuideState): EnemyState[] {
  return state.enemies.filter((e) => g.ids.includes(e.id) && e.state !== 'dying');
}

function spawn(state: SimState, ev: SimEvent[], g: GuideState, kind: string, at: { x: number; y: number }) {
  const [x, y] = nearestFloor(state.map!, at.x, at.y);
  const e = createEnemy(state, kind, x, y, ONE, { objective: false, groupId: -1, summonerId: null });
  state.enemies.push(e);
  g.ids.push(e.id);
  ev.push({ t: 'spawn', id: e.id, kind, x, y });
  return e;
}

/** Remove a step's leftovers without kill rewards (no loot / potion rolls): they crumble. */
function dismiss(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (e.state === 'dying') return;
  e.state = 'dying'; e.deathTimer = 0.4; e.attack = null; e.cohort.count = Big.ZERO;
  ev.push({ t: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y });
  state.telegraphs = state.telegraphs.filter((t) => t.ownerId !== e.id);
  state.projectiles = state.projectiles.filter((pr) => !(pr.owner === 'enemy' && pr.ownerId === e.id));
  state.hazards = state.hazards.filter((h) => !(h.owner === 'enemy' && h.ownerId === e.id));
}

function readyHero(p: PlayerState) {
  for (const s of p.skills) { if (!s.skillId) continue; s.cooldown = 0; s.charges = s.maxCharges; delete s.full; }
  p.dodgeCharges = p.dodgeMax ?? DODGE.charges; p.dodgeCooldown = 0;
  if (p.lifeState === 'alive') p.hp = p.maxHp;
}

/** Set up step `step`: place what it needs; leftovers of the previous step crumble. */
function enter(state: SimState, ev: SimEvent[], g: GuideState, step: number) {
  for (const e of living(state, g)) dismiss(state, ev, e);
  g.step = step; g.at = state.tick; g.done = 0; g.ids = []; g.dodge = 0; g.near = 0;
  delete g.mx; delete g.my; delete g.items;
  const p = state.players[0];
  if (p) readyHero(p);
  switch (GUIDE_STEPS[step]) {
    case 'move': g.mx = MARK.x; g.my = MARK.y; break;
    case 'attack': spawn(state, ev, g, DUMMY, DUMMY_AT); break;
    case 'skills': for (const at of SKILL_DUMMIES) spawn(state, ev, g, DUMMY, at); break;
    case 'dodge': {
      // the toad outlasts any burst (the step is about its globs, not about killing it); it crumbles when done
      const toad = spawn(state, ev, g, TOAD, TOAD_AT);
      toad.cohort.unitHp = toad.cohort.unitHp.mul(Big.from(1000));
      toad.cooldowns.lob = 1.2;
      break;
    }
    case 'loot': {
      const pair = p ? guideLoot(p) : null;
      if (!p || !pair) break;   // nothing wearable (cannot happen with current content): guideTick skips the step
      g.items = [pair[0].id, pair[1].id];
      const it = dropLegendary(state, ev, p.x + p.aimX * 1.6, p.y + p.aimY * 1.6, 'enemy', pair[0].id);
      if (it) g.ids.push(it.id);
      break;
    }
  }
  ev.push({ t: 'domain', type: 'tutorial_step', payload: { step: GUIDE_STEPS[step] ?? 'done' } });
}

/**
 * Per COMBAT tick of a guided run (sim.ts combatTick, instead of the clear and wipe checks). Returns true when the
 * hall is done (sim.ts then clears the round, and the Fate doors open).
 */
export function guideTick(state: SimState, ev: SimEvent[]): boolean {
  const g = state.guide;
  const p = state.players[0];
  if (!g || !p || !state.map) return false;
  // fallen heroes stand straight back up (nobody fails the tutorial)
  for (const h of state.players) {
    if (h.lifeState === 'alive') continue;
    h.lifeState = 'alive'; h.hp = h.maxHp; h.downTimer = 0; h.selfReviveChannel = 0; h.reviveProgress = 0; h.reviverSlot = null; h.downsThisRound = 0;
    h.iframes = Math.max(h.iframes, 1);
    ev.push({ t: 'revived', slot: h.slot, by: null });
  }
  const taken = p.stats.damageTaken.toCompact();
  if (taken !== g.taken) { g.taken = taken; g.hurt = state.tick; }
  const step = GUIDE_STEPS[g.step];
  if (!step || step === 'door') return false;
  // a finished step waits a beat, then the next one is set up
  const complete = (bits: number) => g.done === bits;
  if (g.done < 0) {
    if (state.tick - g.at < STEP_GAP) return false;
    if (g.step === STEP.loot) return true;   // the hall is done: clear the round, the doors open
    enter(state, ev, g, g.step + 1);
    return false;
  }
  const finish = () => { g.done = -1; g.at = state.tick; ev.push({ t: 'domain', type: 'tutorial_step_done', payload: { step } }); };
  switch (step) {
    case 'move':
      if (Math.hypot(p.x - (g.mx ?? MARK.x), p.y - (g.my ?? MARK.y)) <= GUIDE_MARK_RADIUS) finish();
      break;
    case 'attack':
      if (!living(state, g).length) finish();
      break;
    case 'skills': {
      p.skills.slice(0, 3).forEach((s, i) => { if (!s.skillId || s.charges < s.maxCharges) g.done |= 1 << i; });
      if (complete(7)) { finish(); break; }
      if (!living(state, g).length) for (const at of SKILL_DUMMIES) spawn(state, ev, g, DUMMY, at);   // keep something to aim at
      break;
    }
    case 'dodge': {
      const toad = living(state, g)[0];
      if (!toad) { finish(); break; }
      // no lingering poison: only a glob that lands counts as being hit
      if (p.aff?.poison) delete p.aff.poison;
      if (p.buffs.some((b) => b.id === 'poisoned')) p.buffs = p.buffs.filter((b) => b.id !== 'poisoned');
      const threat = state.telegraphs.some((t) => t.ownerId === toad.id && t.releaseTick >= state.tick - 2)
        || state.projectiles.some((pr) => pr.owner === 'enemy' && pr.ownerId === toad.id);
      if (ev.some((e) => e.t === 'dodge' && e.slot === p.slot) && threat) g.dodge = state.tick;
      if (g.dodge > 0 && g.hurt >= g.dodge) g.dodge = 0;                 // dodged, but the glob still landed
      if (g.dodge > 0 && !threat && state.tick > g.dodge) finish();     // came out of it unhurt
      break;
    }
    case 'loot': {
      if (!g.items) { finish(); break; }
      const [a, b] = g.items;
      for (const e of ev) {
        if (e.t !== 'equip' || e.slot !== p.slot) continue;
        if (e.itemId === a && !(g.done & 1)) {
          g.done |= 1;
          const it = dropLegendary(state, ev, p.x - p.aimX * 1.8, p.y - p.aimY * 1.8, 'enemy', b);
          if (it) g.ids.push(it.id);
        } else if (e.itemId === b) g.done |= 2;                       // swapped: compared for sure
      }
      if (g.done & 1 && !(g.done & 2)) {
        const second = (state.loot ?? []).find((it) => it.itemId === b && g.ids.includes(it.id));
        g.near = second && Math.hypot(p.x - second.x, p.y - second.y) <= GUIDE_COMPARE_RADIUS ? g.near + 1 : 0;
        if (g.near >= GUIDE_COMPARE_TICKS) g.done |= 2;
      }
      if (complete(3)) finish();
      break;
    }
  }
  return false;
}

/** VOTING: the hall is cleared and the doors stand open (step 5). */
export function guideAtDoors(state: SimState) {
  const g = state.guide;
  if (!g) return;
  g.step = STEP.door; g.at = state.tick; g.done = 0; g.ids = []; delete g.mx; delete g.my;
}

/** Snapshot view (client prompts): step, sub-goal bits (-1 = just completed), the walk mark, the compare item. */
export interface SnapGuide { s: number; d: number; m?: [number, number] }
export function guideSnapshot(state: SimState): SnapGuide | undefined {
  const g = state.guide;
  if (!g) return undefined;
  const out: SnapGuide = { s: g.step, d: g.done };
  if (g.mx !== undefined && g.my !== undefined && g.done >= 0) out.m = [g.mx, g.my];
  return out;
}

