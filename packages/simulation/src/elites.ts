import { Big } from '@cursebound/numeric';
import { AFFIXES, AFFIX_BY_ID, AFFIX_RULES as A, ENEMY_BY_ID, RULES, TICK_RATE, eliteName, type DamageType } from '@cursebound/content';
import { cohortRadius, cohortTotalHp, enemyAttackDamage, hitPlayer } from './combat';
import { registerGlobalHooks } from './hooks';
import { nearestFloor } from './map';
import { makeHazard } from './players';
import { addChill, afflict, dropPatch } from './afflictions';
import { nextFloat, nextInt, seedRng, type RngState } from './rng';
import { B, ONE, fateFactor } from './stats';
import type { EnemyState, Hazard, PlayerState, SimEvent, SimState } from './types';

// Champions and rares (Diablo-style monster affixes). Some ordinary wave groups roll into champions (tier 1, blue,
// 1–2 affixes) or rares (tier 2, gold, 2–3 affixes, a few minions). The roll uses its own stream seeded from the run
// seed, round, wave and group, so combat randomness never changes which packs are elite. Elites have much more
// health, a size bump and a guaranteed potion (pickups.ts). Every damaging affix is telegraphed: a circle marked on
// the ground (state.telegraphs) before it arms or detonates. Affix hazards are handled here via the hazardTick hook.

const ZERO = Big.ZERO;
const T = (sec: number) => Math.max(1, Math.round(sec * TICK_RATE));

export const AFFIX_HAZARDS = ['molten', 'moltenBlast', 'frostOrb', 'thunder', 'plague', 'blink', 'blindBurst'] as const;

/** Per-group elite chance q = C / (1 + C), C = base × (1 + perRound × (r − 1)) × encounter.eliteChance. */
export function eliteChance(state: SimState, round = state.round): number {
  if (round < RULES.eliteMinRound) return 0;
  const C = B(RULES.eliteIntensityBase).mul(ONE.add(B(RULES.eliteIntensityPerRound).mul(B(round - 1)))).mul(fateFactor(state, 'encounter.eliteChance'));
  if (C.isZero()) return 0;
  return Math.max(0, Math.min(1, C.div(C.add(ONE)).toNumber()));
}

export function isElite(e: EnemyState): boolean { return (e.elite ?? 0) > 0; }
export function hasAffix(e: EnemyState, id: string): boolean { return !!e.affixes && e.affixes.includes(id); }

function baseName(e: EnemyState): string { return ENEMY_BY_ID[e.kind]?.name ?? e.kind; }
function displayName(e: EnemyState | undefined, fallback: string): string { return e ? eliteName(baseName(e), e.affixes) : fallback; }

function allowed(id: string, e: EnemyState): boolean {
  const def = ENEMY_BY_ID[e.kind];
  // ranged foes want distance: a teleport onto the hero would only hurt them
  if (id === 'teleport' && def && def.preferredRange[1] > 3) return false;
  return true;
}

function pickAffixes(rng: RngState, n: number, e: EnemyState): string[] {
  const pool = AFFIXES.map((a) => a.id).filter((id) => allowed(id, e));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const id = pool.splice(nextInt(rng, pool.length), 1)[0];
    if (out.some((o) => AFFIX_BY_ID[o]?.excludes?.includes(id) || AFFIX_BY_ID[id]?.excludes?.includes(o))) continue;
    out.push(id);
  }
  return out;
}

/** Turn a freshly spawned wave group into a champion (1) or rare (2). `forced` pins the affixes (tests, dev tools). */
export function makeElite(state: SimState, ev: SimEvent[], e: EnemyState, tier: 1 | 2, rng: RngState, forced?: string[]) {
  const n = tier === 2 ? 2 + nextInt(rng, 2) : 1 + nextInt(rng, 2);
  const affixes = forced ? forced.filter((id) => AFFIX_BY_ID[id]) : pickAffixes(rng, n, e);
  const t = state.tick;
  e.elite = tier;
  e.affixes = affixes;
  e.avars = {
    wave: state.encounter?.wave ?? 0, born: t,
    mlAt: t, mlX: e.x, mlY: e.y,
    fzAt: t + T(A.frozenFirst),
    shAt: t + T(A.shieldFirst), shWarn: 0, shUntil: 0,
    thAt: t,
    tpAt: t + T(2.5 + nextFloat(rng) * 1.5), tpMark: 0, tpX: e.x, tpY: e.y,
    plAt: t + T(A.plagueFirst),
    jlAt: t + T(A.jailerFirst), jlFire: 0, jlDx: 1, jlDy: 0,
    blAt: t + T(A.blindFirst),
    vnAt: t, vnX: e.x, vnY: e.y,
    glAt: t + T(A.glacialEvery),
  };
  e.cohort.unitHp = e.cohort.unitHp.mul(B(tier === 2 ? RULES.rareHealth : RULES.championHealth));
  let dmg = B(tier === 2 ? RULES.rareDamage : RULES.championDamage);
  if (affixes.includes('strong')) dmg = dmg.mul(B(A.strongDamage));
  e.damage = e.damage.mul(dmg);
  if (affixes.includes('fast')) { e.moveSpeed *= A.fastMove; e.attackFreq = e.attackFreq.mul(B(A.fastAttack)); }
  if (tier === 2 && state.map) {
    // the rare leads alone; the rest of its cohort plus a couple of extra units become minions in the same group
    const minions: Big[] = [];
    if (e.cohort.count.gt(ONE)) { minions.push(e.cohort.count.sub(ONE)); e.cohort.count = ONE; }
    const M = fateFactor(state, 'encounter.spawnQuantity');
    const extra = M.floorInt() > 0n ? Big.from(M.floorInt()) : ONE;
    while (minions.length < 2) minions.push(extra);
    for (let i = 0; i < minions.length; i++) {
      const ang = (i / minions.length) * Math.PI * 2 + nextFloat(rng) * 0.8;
      const [mx, my] = nearestFloor(state.map, e.x + Math.cos(ang) * 1.1, e.y + Math.sin(ang) * 1.1);
      state.pendingSpawns.push({ kind: e.kind, x: mx, y: my, count: minions[i], summonerId: null, objective: e.objective, groupId: e.groupId, ...(e.pack !== undefined ? { pack: e.pack } : {}), ...(e.dormant ? { dormant: true } : {}) });
    }
  }
  applyRadius(e);
  ev.push({ t: 'elite', id: e.id, fx: 'spawn', x: e.x, y: e.y, tier });
}

function applyRadius(e: EnemyState) {
  const def = ENEMY_BY_ID[e.kind];
  if (!def) return;
  e.radius = cohortRadius(def.radius, e.cohort.count) * ((e.elite ?? 0) >= 2 ? RULES.rareRadius : RULES.championRadius);
}

/** Roll a spawned ordinary wave group (deterministic per seed/round/wave/group). */
export function rollElite(state: SimState, ev: SimEvent[], e: EnemyState) {
  const enc = state.encounter;
  if (!enc || enc.isBoss || e.boss || !e.objective || isElite(e) || !ENEMY_BY_ID[e.kind]) return;
  // population packs (director.ts): only the pack's lead (its first group) may become a champion or rare
  if (e.pack !== undefined) {
    const lead = enc.groups.find((g) => g.pack === e.pack);
    if (lead && lead.id !== e.groupId) return;
  }
  const q = eliteChance(state);
  if (q <= 0) return;
  const rng = seedRng(state.seed, 'elite', state.round, enc.wave, e.groupId);
  if (nextFloat(rng) >= q) return;
  const already = state.enemies.filter((o) => o !== e && isElite(o) && o.avars?.wave === enc.wave).length;
  if (already >= RULES.maxElitesPerWave) return;
  const rare = state.round >= RULES.rareMinRound && nextFloat(rng) < RULES.rareShare;
  makeElite(state, ev, e, rare ? 2 : 1, rng);
}

// ---------------- helpers ----------------

function alivePlayers(state: SimState): PlayerState[] {
  return state.players.filter((p) => p.lifeState === 'alive');
}

function targetOf(state: SimState, e: EnemyState, range: number): PlayerState | null {
  const t = e.targetSlot !== null ? state.players[e.targetSlot] : undefined;
  if (t && t.lifeState === 'alive' && (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= range * range) return t;
  let best: PlayerState | null = null; let bd = range * range;
  for (const p of alivePlayers(state)) {
    const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    if (d2 <= bd) { bd = d2; best = p; }
  }
  return best;
}

/** Heal the front unit of a cohort first, then shared damage. */
function healCohort(e: EnemyState, amount: Big) {
  const c = e.cohort;
  if (!c.front.isZero()) { const d = Big.min(c.front, amount); c.front = c.front.sub(d); amount = amount.sub(d); }
  if (!amount.isZero() && !c.spread.isZero()) c.spread = c.spread.sub(amount);
}

/** Affix hazard with a matching ground telegraph that fills until `armTick`. */
function affixHazard(state: SimState, e: EnemyState, kind: string, x: number, y: number, radius: number, armTick: number, damage: Big, dtype: DamageType, untilTick = armTick + 1, telegraph = true): Hazard {
  const h = makeHazard(state, { kind, owner: 'enemy', ownerId: e.id, x, y, radius, armTick, untilTick, interval: 30, damage, dtype });
  state.hazards.push(h);
  if (telegraph) state.telegraphs.push({ id: state.nextId++, ownerId: e.id, shape: { kind: 'circle', radius }, x, y, dx: 1, dy: 0, startTick: state.tick, releaseTick: armTick, attack: `affix_${kind}` });
  return h;
}

function inside(p: PlayerState, h: Hazard, pad: number) {
  return (p.x - h.x) ** 2 + (p.y - h.y) ** 2 <= (h.radius + pad) ** 2;
}

const ATTACK_NAME: Record<string, string> = {
  molten: 'Molten Trail', moltenBlast: 'Molten Death', frostOrb: 'Frost Orb', thunder: 'Thunder Strike', plague: 'Plague Pool', blindBurst: 'Shadow Burst',
};

// ---------------- per-tick affix behaviour ----------------

type AffixTick = (state: SimState, ev: SimEvent[], e: EnemyState, av: Record<string, number>) => void;

const AFFIX_TICK: Record<string, AffixTick> = {
  molten(state, _ev, e, av) {
    if (state.tick < (av.mlAt ?? 0)) return;
    const dx = e.x - (av.mlX ?? e.x), dy = e.y - (av.mlY ?? e.y);
    if (dx * dx + dy * dy < 0.35 * 0.35) return;
    av.mlAt = state.tick + T(A.moltenTrailEvery); av.mlX = e.x; av.mlY = e.y;
    // arms after a beat so the patch only ever burns behind the walker
    affixHazard(state, e, 'molten', e.x, e.y, A.moltenTrailRadius, state.tick + 18, enemyAttackDamage(state, e, A.moltenTrailCoef, false), 'ember', state.tick + T(A.moltenTrailSec), false);
  },
  frozen(state, ev, e, av) {
    if (state.tick < (av.fzAt ?? 0)) return;
    const tgt = targetOf(state, e, 12);
    if (!tgt || !state.map) { av.fzAt = state.tick + 30; return; }
    av.fzAt = state.tick + T(A.frozenEvery);
    const n = A.frozenOrbs[(e.elite ?? 1) >= 2 ? 1 : 0];
    const arm = state.tick + T(A.frozenDelay);
    const dmg = enemyAttackDamage(state, e, A.frozenCoef, true);
    for (let i = 0; i < n; i++) {
      const ang = nextFloat(state.rng.ai) * Math.PI * 2;
      const r = i === 0 ? 0.35 : 1.3 + nextFloat(state.rng.ai) * 0.9;
      const [x, y] = nearestFloor(state.map, tgt.x + Math.cos(ang) * r, tgt.y + Math.sin(ang) * r);
      affixHazard(state, e, 'frostOrb', x, y, A.frozenRadius, arm, dmg, 'frost');
    }
    ev.push({ t: 'elite', id: e.id, fx: 'frost_cast', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y });
  },
  shielding(state, ev, e, av) {
    const t = state.tick;
    if (av.shUntil && t >= av.shUntil) {
      av.shUntil = 0;
      if (e.shieldUntil <= t) e.shield = ZERO;
      ev.push({ t: 'elite', id: e.id, fx: 'shield_down', x: e.x, y: e.y });
    }
    if (av.shUntil) return;
    if (!targetOf(state, e, 10)) { if (t >= (av.shAt ?? 0) - T(A.shieldWarn)) { av.shAt = t + T(A.shieldWarn) + 30; av.shWarn = 0; } return; }
    if (!av.shWarn && t >= (av.shAt ?? 0) - T(A.shieldWarn)) { av.shWarn = 1; ev.push({ t: 'elite', id: e.id, fx: 'shield_warn', x: e.x, y: e.y }); }
    if (t >= (av.shAt ?? 0)) {
      const until = t + T(A.shieldSec);
      // an absorb far beyond the cohort's remaining health: invulnerable for the bubble's duration
      e.shield = cohortTotalHp(e.cohort).mul(B('1e12')).add(B('1e12'));
      e.shieldUntil = until;
      av.shUntil = until; av.shWarn = 0;
      av.shAt = until + T(A.shieldEvery);
      ev.push({ t: 'elite', id: e.id, fx: 'shield_up', x: e.x, y: e.y });
    }
  },
  teleport(state, ev, e, av) {
    const t = state.tick;
    if (av.tpMark) {
      if (t < av.tpMark) return;
      av.tpMark = 0;
      for (const h of state.hazards) if (h.kind === 'blink' && h.ownerId === e.id) h.untilTick = t;
      if (e.attack || e.staggerUntil > t) { av.tpAt = t + 20; return; }
      const fx = e.x, fy = e.y;
      e.x = av.tpX; e.y = av.tpY; e.vx = 0; e.vy = 0; e.path = [];
      // a beat after landing before it may strike: arrival is readable, never an instant hit
      for (const k of Object.keys(e.cooldowns)) if (k !== '_pause') e.cooldowns[k] = Math.max(e.cooldowns[k], 0.55);
      ev.push({ t: 'elite', id: e.id, fx: 'tele', x: fx, y: fy, tx: e.x, ty: e.y });
      av.tpAt = t + T(A.teleportEvery[0] + nextFloat(state.rng.ai) * (A.teleportEvery[1] - A.teleportEvery[0]));
      return;
    }
    if (t < (av.tpAt ?? 0)) return;
    const tgt = targetOf(state, e, 16);
    if (!tgt || e.attack || !state.map) { av.tpAt = t + 30; return; }
    if ((tgt.x - e.x) ** 2 + (tgt.y - e.y) ** 2 < A.teleportMinDist ** 2) { av.tpAt = t + 30; return; }
    const ang = nextFloat(state.rng.ai) * Math.PI * 2;
    const [x, y] = nearestFloor(state.map, tgt.x + Math.cos(ang) * 1.6, tgt.y + Math.sin(ang) * 1.6);
    av.tpX = x; av.tpY = y; av.tpMark = t + T(A.teleportMark);
    state.hazards.push(makeHazard(state, { kind: 'blink', owner: 'enemy', ownerId: e.id, x, y, radius: 0.7, untilTick: av.tpMark + 2, interval: 99999, damage: ZERO, dtype: 'astral' }));
    ev.push({ t: 'elite', id: e.id, fx: 'tele_mark', x: e.x, y: e.y, tx: x, ty: y });
  },
  plagued(state, ev, e, av) {
    const t = state.tick;
    if (t < (av.plAt ?? 0)) return;
    const tgt = targetOf(state, e, 10);
    if (!tgt || !state.map) { av.plAt = t + 30; return; }
    av.plAt = t + T(A.plagueEvery);
    const arm = t + T(A.plagueArm);
    const dmg = enemyAttackDamage(state, e, A.plagueCoef, false);
    const spots: [number, number][] = [[tgt.x, tgt.y]];
    if ((tgt.x - e.x) ** 2 + (tgt.y - e.y) ** 2 > (A.plagueRadius * 1.5) ** 2) spots.push([e.x, e.y]);
    for (const [sx, sy] of spots) {
      const [x, y] = nearestFloor(state.map, sx, sy);
      affixHazard(state, e, 'plague', x, y, A.plagueRadius, arm, dmg, 'decay', arm + T(A.plagueSec));
    }
    ev.push({ t: 'elite', id: e.id, fx: 'plague', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y });
  },
  jailer(state, ev, e, av) {
    // a marked lane, then a chained hook along it (afflictions.ts: 'affix_hook' chains the hero it hits)
    const t = state.tick;
    if (av.jlFire) {
      if (t < av.jlFire) return;
      av.jlFire = 0;
      const speed = A.jailerSpeed;
      state.projectiles.push({
        id: state.nextId++, kind: 'hook', owner: 'enemy', ownerId: e.id, x: e.x + av.jlDx * e.radius, y: e.y + av.jlDy * e.radius,
        vx: av.jlDx * speed, vy: av.jlDy * speed, radius: 0.28, range: A.jailerRange + 1, damage: enemyAttackDamage(state, e, A.jailerCoef, true),
        weight: ONE, dtype: 'physical', pierce: 0, hitIds: [], skillId: 'affix_hook', crit: false, lobTarget: null, bornTick: t,
      });
      ev.push({ t: 'elite', id: e.id, fx: 'hook_throw', x: e.x, y: e.y, tx: e.x + av.jlDx * A.jailerRange, ty: e.y + av.jlDy * A.jailerRange });
      return;
    }
    if (t < (av.jlAt ?? 0)) return;
    const tgt = targetOf(state, e, A.jailerRange);
    if (!tgt || e.attack || !state.map) { av.jlAt = t + 30; return; }
    let dx = tgt.x - e.x, dy = tgt.y - e.y;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l; dy /= l;
    av.jlAt = t + T(A.jailerEvery); av.jlFire = t + T(A.jailerWarn); av.jlDx = dx; av.jlDy = dy;
    state.telegraphs.push({ id: state.nextId++, ownerId: e.id, shape: { kind: 'line', length: A.jailerRange, width: 0.45 }, x: e.x, y: e.y, dx, dy, startTick: t, releaseTick: av.jlFire, attack: 'affix_hook' });
  },
  blinding(state, ev, e, av) {
    const t = state.tick;
    if (t < (av.blAt ?? 0)) return;
    if (!targetOf(state, e, A.blindRadius + 3) || !state.map) { av.blAt = t + 30; return; }
    av.blAt = t + T(A.blindEvery);
    affixHazard(state, e, 'blindBurst', e.x, e.y, A.blindRadius, t + T(A.blindWarn), enemyAttackDamage(state, e, A.blindCoef, true), 'astral');
    ev.push({ t: 'elite', id: e.id, fx: 'blind_warn', x: e.x, y: e.y });
  },
  venomous(state, _ev, e, av) {
    if (state.tick < (av.vnAt ?? 0)) return;
    const dx = e.x - (av.vnX ?? e.x), dy = e.y - (av.vnY ?? e.y);
    if (dx * dx + dy * dy < 0.35 * 0.35) return;
    av.vnAt = state.tick + T(A.venomTrailEvery); av.vnX = e.x; av.vnY = e.y;
    // poisons only behind the walker (arms after a beat); damage = poison per second
    dropPatch(state, e.id, 'venom', e.x, e.y, A.venomTrailRadius, A.venomTrailSec, enemyAttackDamage(state, e, A.venomDpsCoef, false), 0.3);
  },
  glacial(state, ev, e, av) {
    // freezing aura: heroes inside gather a chill stack every glacialEvery seconds (three freeze)
    if (state.tick < (av.glAt ?? 0)) return;
    av.glAt = state.tick + T(A.glacialEvery);
    for (const p of alivePlayers(state)) {
      if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 > (A.glacialRadius + 0.3) ** 2 || p.iframes > 0) continue;
      addChill(state, ev, p, A.glacialSlow, 1.5, 1);
    }
  },
};

// ---------------- affix hazards ----------------

function pulse(state: SimState, ev: SimEvent[], h: Hazard) {
  const arm = h.armTick ?? h.bornTick;
  if (state.tick < arm || (state.tick - arm) % Math.max(1, h.interval) !== 0) return;
  const owner = state.enemies.find((x) => x.id === h.ownerId);
  const source = displayName(owner, AFFIX_BY_ID[h.kind === 'molten' ? 'molten' : 'plagued']?.name ?? 'Affix');
  for (const p of alivePlayers(state)) {
    if (!inside(p, h, 0.2)) continue;
    hitPlayer(state, ev, p, h.damage, { attack: ATTACK_NAME[h.kind] ?? h.kind, source, fromX: h.x, fromY: h.y, dtype: h.dtype, hazard: true, srcId: h.ownerId });
  }
}

function detonate(state: SimState, ev: SimEvent[], h: Hazard) {
  if (state.tick < (h.armTick ?? h.untilTick - 1)) return;
  const owner = state.enemies.find((x) => x.id === h.ownerId);
  const source = displayName(owner, h.kind === 'moltenBlast' ? 'Molten corpse' : 'Elite');
  for (const p of alivePlayers(state)) {
    if (!inside(p, h, 0.3) || p.iframes > 0) continue;
    hitPlayer(state, ev, p, h.damage, { attack: ATTACK_NAME[h.kind] ?? h.kind, source, fromX: h.x, fromY: h.y, dtype: h.dtype, srcId: h.ownerId });
    // frost orbs chill (a chill stack toward freezing, afflictions.ts); shadow bursts blind
    if (h.kind === 'frostOrb' && p.lifeState === 'alive') addChill(state, ev, p, A.chillSlow, A.chillSec, 1);
    if (h.kind === 'blindBurst' && p.lifeState === 'alive') afflict(state, ev, p, 'blinded', 2.2, { srcId: h.ownerId, source, attack: 'Shadow Burst', ignoreIframes: true });
  }
  ev.push({ t: 'elite', id: h.ownerId, fx: h.kind === 'moltenBlast' ? 'molten_blast' : h.kind === 'frostOrb' ? 'frost_burst' : h.kind === 'blindBurst' ? 'blind_burst' : 'thunder', x: h.x, y: h.y, tx: owner?.x, ty: owner?.y });
  h.untilTick = state.tick;   // consumed
}

registerGlobalHooks({
  onEnemySpawn(state, ev, e) { rollElite(state, ev, e); },

  onTick(state, ev) {
    for (const e of state.enemies) {
      if (!isElite(e) || e.state === 'dying' || e.cohort.count.isZero() || e.dormant) continue;   // idle packs hold their affixes
      const av = e.avars ?? (e.avars = {});
      applyRadius(e);
      for (const a of e.affixes ?? []) AFFIX_TICK[a]?.(state, ev, e, av);
    }
  },

  hazardTick(state, ev, h) {
    if (h.owner !== 'enemy') return undefined;
    switch (h.kind) {
      case 'molten': case 'plague': pulse(state, ev, h); return true;
      case 'moltenBlast': case 'frostOrb': case 'thunder': case 'blindBurst': detonate(state, ev, h); return true;
      case 'blink': return true;
    }
    return undefined;
  },

  onEnemyHit(state, ev, p, e, info) {
    // Thunderous: being struck marks the attacker's spot; lightning lands there after a warning
    if (!p || p.lifeState !== 'alive' || info.generation > 0 || !isElite(e) || !hasAffix(e, 'thunder')) return;
    const av = e.avars ?? (e.avars = {});
    if (state.tick < (av.thAt ?? 0)) return;
    av.thAt = state.tick + T(A.thunderCooldown);
    affixHazard(state, e, 'thunder', p.x, p.y, A.thunderRadius, state.tick + T(A.thunderDelay), enemyAttackDamage(state, e, A.thunderCoef, true), 'storm');
    ev.push({ t: 'elite', id: e.id, fx: 'thunder_mark', x: e.x, y: e.y, tx: p.x, ty: p.y });
  },

  onPlayerDamaged(state, ev, p, info) {
    // Vampiric: heals whenever one of its attacks lands (not its lingering pools)
    if (info.srcId === undefined || info.hazard) return;
    const e = state.enemies.find((x) => x.id === info.srcId);
    if (!e || !isElite(e) || !hasAffix(e, 'vampiric') || e.state === 'dying' || e.cohort.count.isZero()) return;
    healCohort(e, e.cohort.unitHp.mul(B(A.vampiricHealFrac)));
    ev.push({ t: 'elite', id: e.id, fx: 'vamp', x: e.x, y: e.y, tx: p.x, ty: p.y });
  },

  onKill(state, ev, e) {
    if (!isElite(e)) return;
    for (const h of state.hazards) if (h.kind === 'blink' && h.ownerId === e.id) h.untilTick = state.tick;
    if (e.shieldUntil > state.tick) { e.shield = ZERO; e.shieldUntil = state.tick; }
    if (hasAffix(e, 'molten')) {
      // Molten: the corpse swells and explodes after a clear warning
      affixHazard(state, e, 'moltenBlast', e.x, e.y, A.moltenBlastRadius, state.tick + T(A.moltenBlastDelay), enemyAttackDamage(state, e, A.moltenBlastCoef, true), 'ember');
      ev.push({ t: 'elite', id: e.id, fx: 'molten_arm', x: e.x, y: e.y });
    }
    if (hasAffix(e, 'blinding')) {
      // Blinding: a last shadow burst where it fell, after a clear warning
      affixHazard(state, e, 'blindBurst', e.x, e.y, A.blindRadius + 0.2, state.tick + T(A.blindDeathWarn), enemyAttackDamage(state, e, A.blindCoef, true), 'astral');
      ev.push({ t: 'elite', id: e.id, fx: 'blind_warn', x: e.x, y: e.y });
    }
  },
});
