import { Big } from '@cursebound/numeric';
import { SKILL_BY_ID } from '@cursebound/content';
import { addStagger, cohortHpFrac, healPlayer, hitEnemy, killEnemy } from '../combat';
import { inCone, moveCircle, norm } from '../geometry';
import { registerClassHooks } from '../hooks';
import { areaCoverage, cosHalf, cutCooldowns, flinch, livingEnemies, newProjectileId } from '../players';
import { B, ONE } from '../stats';
import type { EnemyState, Hazard, PlayerState, Projectile, SimEvent, SimState } from '../types';
import {
  DT, addHazard, buffActive, castEv, endHazard, enemiesIn, enemyById, findHazard, followAttachment, has, hitCircle,
  hitOne, isLive, kitGlobal, registerTargetScale, landingPoint, moving, pull, radiusOf, rank, refundCooldown, registerFamily, registerTempDamage, setBuff, shove,
  skillDmg, slotBit, slotOf, startDash, startLeap, statFactor, stepMove, stun, subDmg, ticks, vuln,
} from './tbkit';

// Berserker kit (content: packages/content/src/classes/berserker.ts). Deterministic: state and inputs only. p.vars:
//   b_last                 last tick the Berserker dealt or took damage
//   b_frenzy / b_frenzyT   Frenzy stacks and the tick of the last gain (ui_frenzy / ui_frenzyMax mirror them)
//   b_fhTick / b_fhN       per-tick cap on Rage from active skill hits
//   b_ls                   lifesteal accumulated this tick (fraction of maximum health, applied once per tick)
//   b_ww*                  Whirlwind / Bladestorm spin (Until, Kind 1|2, Next pulse, Axe, Start, Slot)
//   b_blStart              Bloodlust start tick (Battle Trance cap)
//   b_udReady/b_udEnd/b_udDealt  Undying Rage cooldown, window end, damage dealt during it (fraction of max health)
//   b_bfUntil              Bounding Fury empowered-leap window; b_wmCd / b_wmOther Warmonger per-cast budgets
//   b_avStart              Avatar start tick (kill extensions cap); b_dlReady Deathless recharge; b_wwExtra Endless Storm overtime
// Rage (no resource): connecting swings, active-skill hits and health lost cut seconds from every recharging skill.
//   mv_*                   scripted leap / lunge (tbkit)
// Buffs: avatar, bloodlust, unchained, undying, battle_cry (any class: attack frequency x1.2).
// Hazards: b_avatar, b_whirl, b_frenzy, b_undying (attached to the Berserker), b_fear (attached to an enemy, dx/dy =
// flee direction), b_quake (outer = next ring), b_aftershock, b_fissure, b_leap_mark. Projectile: b_axe.
// Cosmetic cast events: b_chop_spin, b_avatar_whirl, b_whirl_tick (dx = radius, dy = kind), b_leap_land / b_cataclysm_land
// (dx = radius), b_quake_ring (dx = radius, dy = ring), b_aftershock, b_execute_cleave, b_execute, b_wall_slam, b_flay_burst,
// b_harvest, b_undying, b_deathless. b_leap / b_cataclysm carry the landing point in dx/dy; b_avatar carries
// (duration, 0) in dx/dy.

const CLS = 'berserker';
const BR = { fury: 0, carnage: 1, warcry: 2 } as const;
const TAG = { LEAP: 21, CATA: 22, EXEC: 23 } as const;

const K = {
  chop: { range: 1.8, arc: 120, wide: 180, strike: '0.5', flinch: 0.18 },
  // Rage: seconds cut from every recharging skill (swing that connects, active skill hit (max 2 per tick), per 1% health lost)
  rage: { swing: 0.1, skillHit: 0.03, capPerTick: 2, perPct: 0.02 },
  frenzy: { base: 5, perRank: 3, god: 5, sec: 3, atk: 1.05 },
  avatar: { sec: 5, perKill: 0.25, maxSec: 7, radius: 3, knock: 1.5, stagger: 120, dmg: 1.4, taken: 0.8, whirlR: 2.4, whirlCoef: '0.6', reach: 1.35 },
  lust: { sec: 6, steal: 6, feastBelow: 0.5, tranceSec: 9, tranceKill: 0.5, tranceMax: 15, frenzy: 3 },
  bath: { radius: 2.8, rend: 0.3, heal: 0.03, healMax: 5 },
  unchained: { sec: 7, taken: 1.2 },
  undying: { cd: 45, sec: 4, dmg: 1.3, heal: 0.4, cap: 0.6 },
  deathWish: 0.3, deathless: { cd: 40, iframes: 1 },
  whirl: { sec: 2.5, every: 0.25, radius: 2.2, pull: 0.15, mPull: 0.45, mR: 1.25, stagger: 6 },
  blade: { sec: 3, every: 0.2, radius: 2.6, axeEvery: 0.5, axeRange: 8, axeCoef: '0.8', axeSpeed: 13 },
  rend: { perRank: 0.08, sec: 4 }, flay: { rend: 0.15, r: 1.6, coef: '0.8' },
  exec: { lunge: 2.5, speed: 16, range: 3.2, arc: 200, rend: '1.5', below: 0.15, stagger: 60 },
  hemorrhage: '1.25', endless: { max: 10 }, harvest: { r: 2, coef: '0.5', rage: 0.15 },
  leap: { min: 1.5, max: 6, air: 0.45, radius: 2.4, knock: 1.5, stagger: 60 },
  meteor: { reach: 3, radius: 1.25, air: 0.15 }, bounding: { sec: 3, dmg: '1.3' },
  after: { delay: 0.5, radius: 3.2, perRank: 0.8 },
  shout: { radius: 5, fear: 2, vuln: '1.2', vulnSec: 6, knock: 1.0, stagger: 80, cry: 6, atk: 1.2, rage: 0.5 },
  cata: { max: 7, air: 0.5, rings: [2.2, 3.6, 5.0], every: 0.25, stun: 0.4, stagger: 40, knock: 0.6 },
  brothers: { radius: 5, heal: '0.06', cd: 0.5 }, concussive: { perRank: 1, stun: 1 },
  tectonic: { radius: 2.6, sec: 4, coef: '0.4', vuln: '1.15' },
  warmonger: { cd: 0.4, cdMax: 4, other: 0.1, otherMax: 1 },
};

registerFamily({
  b_bloodbath: 'b_bloodlust', b_unchained: 'b_bloodlust',
  b_bladestorm: 'b_whirlwind', b_executioner: 'b_whirlwind',
  b_shout: 'b_leap', b_cataclysm: 'b_leap',
});

const WARCRY_SKILLS = new Set(['b_leap', 'b_shout', 'b_cataclysm']);
const WARCRY_HITS = new Set(['b_leap', 'b_quake', 'b_aftershock']);
const BASIC_HITS = new Set(['b_chop', 'b_avatar_whirl']);
const isBerserker = (p: PlayerState | undefined): p is PlayerState => !!p && p.classId === CLS;
const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

// ---------------- Fury & Frenzy ----------------

/** Rage: cut `sec` from every recharging skill (pain and carnage speed the whole hotbar; there is no resource). */
function rage(p: PlayerState, sec: number) {
  if (sec > 0 && p.lifeState === 'alive') cutCooldowns(p, sec, p.skills.length - 1);   // actives only: the Avatar keeps its own clock
}

const markCombat = (state: SimState, p: PlayerState) => { p.vars.b_last = state.tick; };

function frenzyMax(state: SimState, p: PlayerState): number {
  const m = K.frenzy.base + K.frenzy.perRank * rank(p, 'b_deep_frenzy') + (has(p, 'b_blood_god') ? K.frenzy.god : 0);
  return buffActive(state, p, 'unchained') ? m * 2 : m;
}

function addFrenzy(state: SimState, p: PlayerState, n: number) {
  p.vars.b_frenzy = Math.min(frenzyMax(state, p), (p.vars.b_frenzy ?? 0) + n);
  p.vars.b_frenzyT = state.tick;
}

const whirling = (state: SimState, p: PlayerState) => (p.vars.b_wwUntil ?? 0) > state.tick;

function hasRend(state: SimState, p: PlayerState, e: EnemyState): boolean {
  return e.dots.some((d) => d.src === p.slot && d.type === 'physical' && d.until > state.tick);
}

function rendDot(state: SimState, p: PlayerState, frac: number) {
  if (frac <= 0) return undefined;
  const f = frac * statFactor(state, p, 'player.bleedDamage');
  return { type: 'physical' as const, fractionPerSec: (Math.round(f * 10000) / 10000).toFixed(4), durationSec: K.rend.sec };
}

const hemo = (state: SimState, p: PlayerState) => has(p, 'b_hemorrhage') ? (e: EnemyState) => (hasRend(state, p, e) ? B(K.hemorrhage) : null) : undefined;
registerTargetScale(CLS, (state, p, e) => (has(p, 'b_hemorrhage') && hasRend(state, p, e) ? B(K.hemorrhage) : null));

function enterBloodlust(state: SimState, p: PlayerState, sec: number) {
  const s = has(p, 'b_battle_trance') ? Math.max(sec, K.lust.tranceSec) : sec;
  setBuff(p, 'bloodlust', state.tick + ticks(s));
  p.vars.b_blStart = state.tick;
}

// ---------------- basic attack ----------------

function chop(state: SimState, ev: SimEvent[], p: PlayerState, k: Big) {
  const avatar = buffActive(state, p, 'avatar');
  // reach and arc from content (b_chop shape), so click-to-move, the lunge and the swing agree
  const cs = SKILL_BY_ID['b_chop'].shape;
  const range = radiusOf(p, 'b_chop', cs.kind === 'arc' ? cs.range : K.chop.range) * (avatar ? K.avatar.reach : 1);
  const maxed = has(p, 'b_blood_god') && (p.vars.b_frenzy ?? 0) >= frenzyMax(state, p);
  const arc = maxed ? 360 : rank(p, 'b_widening_gyre') >= 2 ? K.chop.wide : cs.kind === 'arc' ? cs.arcDeg : K.chop.arc;
  const ch = cosHalf(arc);
  const strikes = buffActive(state, p, 'unchained') ? 3 : 2;
  const dmg = skillDmg(state, p, 'b_chop').mul(B(K.chop.strike));
  const dot = rendDot(state, p, K.rend.perRank * rank(p, 'b_rend'));
  const hm = hemo(state, p);
  let hitAny = false;
  for (const e of livingEnemies(state)) {
    const inside = arc >= 360 ? d2(e.x, e.y, p.x, p.y) <= (range + e.radius) ** 2 : inCone(p.x, p.y, p.aimX, p.aimY, range, ch, e.x, e.y, e.radius);
    if (!inside) continue;
    const s = hm?.(e);
    const dd = s ? dmg.mul(s) : dmg;
    for (let i = 0; i < strikes; i++) {
      hitEnemy(state, ev, e, dd, k, { dtype: 'physical', srcSlot: p.slot, skillId: 'b_chop', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, range), allowCrit: true, dot });
    }
    flinch(state, e, p.x, p.y, K.chop.flinch);
    hitAny = true;
  }
  castEv(ev, p, arc >= 360 ? 'b_chop_spin' : 'b_chop', p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
  if (avatar) {
    const wd = subDmg(state, p, 'physical', K.avatar.whirlCoef);
    for (const e of enemiesIn(state, p.x, p.y, K.avatar.whirlR)) {
      hitEnemy(state, ev, e, wd, k, { dtype: 'physical', srcSlot: p.slot, skillId: 'b_avatar_whirl', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, K.avatar.whirlR), allowCrit: true, stagger: 8 });
      hitAny = true;
    }
    castEv(ev, p, 'b_avatar_whirl', p.x, p.y, K.avatar.whirlR, 0);
  }
  if (hitAny) { rage(p, K.rage.swing); addFrenzy(state, p, 1); markCombat(state, p); }
}

// ---------------- Carnage ----------------

function whirlRadius(p: PlayerState, kind: number): number {
  const base = kind === 2 ? K.blade.radius : K.whirl.radius;
  return radiusOf(p, kind === 2 ? 'b_bladestorm' : 'b_whirlwind', base) * (has(p, 'b_maelstrom') ? K.whirl.mR : 1);
}

function whirlPulse(state: SimState, ev: SimEvent[], p: PlayerState) {
  const kind = p.vars.b_wwKind ?? 1;
  const R = whirlRadius(p, kind);
  const skill = kind === 2 ? 'b_bladestorm' : 'b_whirlwind';
  const dot = rendDot(state, p, K.rend.perRank * rank(p, 'b_rend') + (has(p, 'b_flaying_spin') ? K.flay.rend : 0));
  const hit = hitCircle(state, ev, p, p.x, p.y, R, skillDmg(state, p, skill), { dtype: 'physical', skillId: skill, dot, stagger: K.whirl.stagger });
  const pl = has(p, 'b_maelstrom') ? K.whirl.mPull : K.whirl.pull;
  for (const e of hit) pull(state, e, p.x, p.y, pl);
  castEv(ev, p, 'b_whirl_tick', p.x, p.y, R, kind);
}

function flingAxe(state: SimState, p: PlayerState, R: number) {
  let best: EnemyState | undefined; let bd = K.blade.axeRange ** 2;
  for (const e of state.enemies) {
    if (!isLive(e)) continue;
    const d = d2(e.x, e.y, p.x, p.y);
    if (d <= R * R || d > bd) continue;
    bd = d; best = e;
  }
  if (!best) return;
  const [dx, dy] = norm(best.x - p.x, best.y - p.y);
  const pr: Projectile = {
    id: newProjectileId(state), kind: 'b_axe', owner: 'player', ownerId: p.slot, x: p.x + dx * 0.4, y: p.y + dy * 0.4,
    vx: (dx || 1) * K.blade.axeSpeed, vy: dy * K.blade.axeSpeed, radius: 0.35, range: K.blade.axeRange, damage: subDmg(state, p, 'physical', K.blade.axeCoef, 'b_bladestorm').mul(has(p, 'b_hemorrhage') && hasRend(state, p, best) ? B(K.hemorrhage) : ONE),
    weight: ONE, dtype: 'physical', pierce: 1, hitIds: [], skillId: 'b_bladestorm_axe', crit: false, lobTarget: null, bornTick: state.tick,
  };
  state.projectiles.push(pr);
}

function stepWhirl(state: SimState, ev: SimEvent[], p: PlayerState) {
  const v = p.vars;
  if (!v.b_wwUntil) return;
  // Endless Storm: holding the key keeps the spin going past its duration; the overtime is added to its cooldown
  if (has(p, 'b_endless_storm') && v.b_wwUntil - state.tick <= 1 && v.b_wwUntil >= state.tick
    && (p.prevButtons & slotBit(p, v.b_wwSlot ?? -1)) && state.tick - (v.b_wwStart ?? 0) < ticks(K.endless.max)) {
    v.b_wwUntil = state.tick + 2;
    v.b_wwExtra = (v.b_wwExtra ?? 0) + DT;
    const h = findHazard(state, 'b_whirl', p.slot);
    if (h) h.untilTick = v.b_wwUntil + 1;
  }
  if (v.b_wwUntil <= state.tick) {
    v.b_wwUntil = 0;
    const s = p.skills[v.b_wwSlot ?? -1];
    if ((v.b_wwExtra ?? 0) > 0 && s && s.charges < s.maxCharges) s.cooldown += v.b_wwExtra!;
    v.b_wwExtra = 0;
    return;
  }
  const kind = v.b_wwKind ?? 1;
  if (state.tick >= (v.b_wwNext ?? 0)) {
    v.b_wwNext = state.tick + ticks(kind === 2 ? K.blade.every : K.whirl.every);
    whirlPulse(state, ev, p);
  }
  if (kind === 2 && state.tick >= (v.b_wwAxe ?? 0)) {
    v.b_wwAxe = state.tick + ticks(K.blade.axeEvery);
    flingAxe(state, p, whirlRadius(p, 2));
  }
}

function executeCleave(state: SimState, ev: SimEvent[], p: PlayerState) {
  const range = radiusOf(p, 'b_executioner', K.exec.range);
  const ch = cosHalf(K.exec.arc);
  const base = skillDmg(state, p, 'b_executioner');
  const hm = has(p, 'b_hemorrhage');
  for (const e of livingEnemies(state)) {
    if (!inCone(p.x, p.y, p.aimX, p.aimY, range, ch, e.x, e.y, e.radius)) continue;
    let dmg = base;
    if (hasRend(state, p, e)) { dmg = dmg.mul(B(K.exec.rend)); if (hm) dmg = dmg.mul(B(K.hemorrhage)); }
    hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'b_executioner', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, range), allowCrit: true, stagger: K.exec.stagger });
    if (isLive(e) && !e.boss && e.cohort.count.lte(ONE) && cohortHpFrac(e.cohort) < K.exec.below) {
      castEv(ev, p, 'b_execute', e.x, e.y, p.aimX, p.aimY);
      killEnemy(state, ev, e, p.slot);
    } else flinch(state, e, p.x, p.y, 0.5);
  }
  castEv(ev, p, 'b_execute_cleave', p.x, p.y, p.aimX, p.aimY);
}

// ---------------- Warcry ----------------

/** Warcry knockback: Concussive Force punishes enemies slammed into walls. */
function knock(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, fromX: number, fromY: number, dist: number) {
  const wall = shove(state, e, e.x - fromX, e.y - fromY, dist);
  const c = rank(p, 'b_concussive');
  if (wall && c > 0 && isLive(e)) {
    hitOne(state, ev, p, e, subDmg(state, p, 'physical', Big.from((K.concussive.perRank * c).toFixed(1))), { dtype: 'physical', skillId: 'b_wall_slam', generation: 1 }, fromX, fromY);
    stun(state, ev, e, K.concussive.stun, 30);
    castEv(ev, p, 'b_wall_slam', e.x, e.y, e.x - fromX, e.y - fromY);
  }
}

function landRadius(p: PlayerState, skill: string, base: number) {
  return radiusOf(p, skill, base) * (has(p, 'b_meteor') ? K.meteor.radius : 1);
}

function warcryCommon(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number) {
  if (has(p, 'b_blood_brothers')) {
    for (const a of state.players) {
      if (a.lifeState !== 'alive' || d2(a.x, a.y, x, y) > K.brothers.radius ** 2) continue;
      healPlayer(state, ev, a, a.maxHp.mul(B(K.brothers.heal)));
      cutCooldowns(a, K.brothers.cd);
    }
  }
  if (has(p, 'b_tectonic')) {
    addHazard(state, p, {
      kind: 'b_fissure', x, y, radius: K.tectonic.radius, untilTick: state.tick + ticks(K.tectonic.sec), interval: ticks(0.5), nextTick: state.tick + ticks(0.5),
      damage: subDmg(state, p, 'physical', K.tectonic.coef, 'b_leap'),
    });
  }
}

function quakeRing(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, i: number, mult = ONE) {
  const radii = K.cata.rings.map((r) => landRadius(p, 'b_cataclysm', r));
  const outer = radii[i], inner = i === 0 ? 0 : radii[i - 1] - 0.3;
  const dmg = skillDmg(state, p, 'b_cataclysm').mul(mult);
  for (const e of enemiesIn(state, x, y, outer)) {
    const d = Math.sqrt(d2(e.x, e.y, x, y));
    if (d + e.radius < inner) continue;
    hitOne(state, ev, p, e, dmg, { dtype: 'physical', skillId: 'b_quake', stagger: K.cata.stagger }, x, y, outer);
    stun(state, ev, e, K.cata.stun, 0);
    knock(state, ev, p, e, x, y, K.cata.knock);
  }
  castEv(ev, p, 'b_quake_ring', x, y, outer, i);
}

function leapLand(state: SimState, ev: SimEvent[], p: PlayerState, cata: boolean) {
  const x = p.x, y = p.y;
  // Bounding Fury: the second leap of a pair lands harder
  const emp = p.vars.b_bfEmp ? B(K.bounding.dmg) : ONE;
  p.vars.b_bfEmp = 0;
  if (!cata) {
    const R = landRadius(p, 'b_leap', K.leap.radius);
    const hit = hitCircle(state, ev, p, x, y, R, skillDmg(state, p, 'b_leap').mul(emp), { dtype: 'physical', skillId: 'b_leap', stagger: K.leap.stagger });
    for (const e of hit) knock(state, ev, p, e, x, y, K.leap.knock);
    castEv(ev, p, 'b_leap_land', x, y, R, 0);
  } else {
    quakeRing(state, ev, p, x, y, 0, emp);
    addHazard(state, p, { kind: 'b_quake', x, y, radius: landRadius(p, 'b_cataclysm', K.cata.rings[2]), nextTick: state.tick + ticks(K.cata.every), untilTick: state.tick + ticks(K.cata.every * 2) + 2, outer: 1 });
    castEv(ev, p, 'b_cataclysm_land', x, y, landRadius(p, 'b_cataclysm', K.cata.rings[0]), 0);
  }
  const a = rank(p, 'b_aftershock');
  if (a > 0) {
    addHazard(state, p, {
      kind: 'b_aftershock', x, y, radius: K.after.radius, nextTick: state.tick + ticks(K.after.delay), untilTick: state.tick + ticks(K.after.delay) + 2, outer: 0,
      damage: subDmg(state, p, 'physical', Big.from((K.after.perRank * a).toFixed(2)), cata ? 'b_cataclysm' : 'b_leap'),
    });
  }
  warcryCommon(state, ev, p, x, y);
}

function shout(state: SimState, ev: SimEvent[], p: PlayerState) {
  const R = K.shout.radius;
  let n = 0;
  for (const e of enemiesIn(state, p.x, p.y, R)) {
    n++;
    knock(state, ev, p, e, p.x, p.y, K.shout.knock);
    vuln(state, e, K.shout.vuln, K.shout.vulnSec);
    if (e.boss) { addStagger(state, ev, e, K.shout.stagger); continue; }
    if (!isLive(e)) continue;
    const old = findHazard(state, 'b_fear', p.slot, e.id);
    if (old) endHazard(state, old);
    const [fx, fy] = norm(e.x - p.x, e.y - p.y);
    addHazard(state, p, { kind: 'b_fear', x: e.x, y: e.y, dx: fx || 1, dy: fy, radius: e.radius, untilTick: state.tick + ticks(K.shout.fear), speed: 2, hitSlots: [e.id] });
  }
  for (const a of state.players) {
    if (a.lifeState !== 'alive' || d2(a.x, a.y, p.x, p.y) > R * R) continue;
    setBuff(a, 'battle_cry', state.tick + ticks(K.shout.cry), K.shout.atk);
  }
  rage(p, K.shout.rage);
  if (has(p, 'b_warmonger') && n > 0) {
    refundCooldown(p, BR.warcry, Math.min(K.warmonger.cdMax, K.warmonger.cd * n));
    rage(p, Math.min(K.warmonger.otherMax, K.warmonger.other * n));
    p.vars.b_wmCd = K.warmonger.cdMax; p.vars.b_wmOther = K.warmonger.otherMax;
  }
  warcryCommon(state, ev, p, p.x, p.y);
  castEv(ev, p, 'b_shout', p.x, p.y, R, n);
}

function stepFear(state: SimState, h: Hazard) {
  const e = enemyById(state, h.hitSlots[0]);
  if (!e || e.boss || !state.map) { endHazard(state, h); return; }
  const sp = e.moveSpeed * 0.9;
  const r = moveCircle(state.map, e.x, e.y, h.dx * sp * DT, h.dy * sp * DT, Math.min(e.radius, 0.6));
  e.x = r.x; e.y = r.y;
  e.staggerUntil = Math.max(e.staggerUntil, state.tick + 2);
  e.attack = null; e.state = 'move'; e.vx = h.dx * sp; e.vy = h.dy * sp; e.fx = h.dx; e.fy = h.dy;
  h.x = e.x; h.y = e.y;
}

// ---------------- casting ----------------

function cast(state: SimState, ev: SimEvent[], p: PlayerState, id: string): boolean | undefined {
  if (moving(state, p)) return false;
  const tick = state.tick;
  switch (id) {
    case 'b_avatar': {
      const sec = K.avatar.sec;   // kills while it lasts extend it (onKill), up to K.avatar.maxSec
      p.vars.b_avStart = tick;
      setBuff(p, 'avatar', tick + ticks(sec));
      const hit = hitCircle(state, ev, p, p.x, p.y, K.avatar.radius, skillDmg(state, p, id), { dtype: 'physical', skillId: id, stagger: K.avatar.stagger });
      for (const e of hit) shove(state, e, e.x - p.x, e.y - p.y, K.avatar.knock);
      const old = findHazard(state, 'b_avatar', p.slot);
      if (old) endHazard(state, old);
      addHazard(state, p, { kind: 'b_avatar', x: p.x, y: p.y, radius: 1.2, untilTick: tick + ticks(sec), speed: 1, outer: Math.round(sec * 10) / 10 });
      markCombat(state, p);
      castEv(ev, p, id, p.x, p.y, Math.round(sec * 100) / 100, 0);
      return true;
    }
    case 'b_bloodlust': {
      enterBloodlust(state, p, K.lust.sec);
      addFrenzy(state, p, K.lust.frenzy);
      castEv(ev, p, id, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'b_bloodbath': {
      const dot = rendDot(state, p, K.bath.rend);
      const hit = hitCircle(state, ev, p, p.x, p.y, K.bath.radius, skillDmg(state, p, id), { dtype: 'physical', skillId: id, dot, stagger: 30 });
      for (const e of hit) flinch(state, e, p.x, p.y, 0.4);
      const n = Math.min(K.bath.healMax, hit.length);
      if (n > 0) healPlayer(state, ev, p, p.maxHp.mul(Big.from((K.bath.heal * n).toFixed(2))));
      enterBloodlust(state, p, K.lust.sec);
      castEv(ev, p, id, p.x, p.y, K.bath.radius, n);
      return true;
    }
    case 'b_unchained': {
      enterBloodlust(state, p, K.unchained.sec);
      setBuff(p, 'unchained', tick + ticks(K.unchained.sec));
      castEv(ev, p, id, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'b_whirlwind':
    case 'b_bladestorm': {
      const kind = id === 'b_bladestorm' ? 2 : 1;
      const v = p.vars;
      v.b_wwKind = kind; v.b_wwStart = tick; v.b_wwUntil = tick + ticks(kind === 2 ? K.blade.sec : K.whirl.sec);
      v.b_wwNext = tick; v.b_wwAxe = tick + ticks(K.blade.axeEvery); v.b_wwSlot = slotOf(p, id);
      const old = findHazard(state, 'b_whirl', p.slot);
      if (old) endHazard(state, old);
      addHazard(state, p, { kind: 'b_whirl', x: p.x, y: p.y, radius: whirlRadius(p, kind), untilTick: v.b_wwUntil + 1, speed: 1, outer: kind });
      castEv(ev, p, id, p.x, p.y, whirlRadius(p, kind), kind);
      return true;
    }
    case 'b_executioner': {
      startDash(state, p, p.aimX, p.aimY, K.exec.lunge, K.exec.speed, TAG.EXEC);
      castEv(ev, p, id, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'b_leap':
    case 'b_cataclysm': {
      const cata = id === 'b_cataclysm';
      const meteor = has(p, 'b_meteor');
      const max = (cata ? K.cata.max : K.leap.max) + (meteor ? K.meteor.reach : 0);
      const air = (cata ? K.cata.air : K.leap.air) + (meteor ? K.meteor.air : 0);
      const [tx, ty] = landingPoint(state, p, max, K.leap.min);
      startLeap(state, p, tx, ty, air, cata ? TAG.CATA : TAG.LEAP);
      addHazard(state, p, { kind: 'b_leap_mark', x: tx, y: ty, radius: cata ? landRadius(p, id, K.cata.rings[0]) : landRadius(p, id, K.leap.radius), untilTick: tick + ticks(air) + 1 });
      castEv(ev, p, id, p.x, p.y, tx, ty);
      return true;
    }
    case 'b_shout': {
      shout(state, ev, p);
      return true;
    }
  }
  return undefined;
}

// ---------------- hooks ----------------

registerTempDamage(CLS, (state, p) => {
  let f = 1;
  if (buffActive(state, p, 'avatar')) f *= K.avatar.dmg;
  if (buffActive(state, p, 'undying')) f *= K.undying.dmg;
  const dw = rank(p, 'b_death_wish');
  if (dw > 0 && !p.maxHp.isZero()) f *= 1 + K.deathWish * dw * Math.max(0, 1 - Math.min(1, p.hp.ratio(p.maxHp)));
  return f === 1 ? ONE : Big.from(Math.round(f * 10000) / 10000);
});

registerClassHooks(CLS, {
  castSkill: cast,
  basicAttack(state, ev, p, k) {
    if (moving(state, p) || whirling(state, p)) return true;
    chop(state, ev, p, k);
    return true;
  },
  extraCharges(p, skillId) {
    return has(p, 'b_bounding') && (skillId === 'b_leap' || skillId === 'b_cataclysm') ? 1 : 0;
  },
  onCast(state, ev, p, skillId) {
    if (skillId === 'b_leap' || skillId === 'b_cataclysm') {
      if (has(p, 'b_bounding')) {
        const second = (p.vars.b_bfUntil ?? 0) > state.tick;
        p.vars.b_bfEmp = second ? 1 : 0;
        p.vars.b_bfUntil = second ? 0 : state.tick + ticks(K.bounding.sec);
      }
    }
    if (WARCRY_SKILLS.has(skillId) && skillId !== 'b_shout') { p.vars.b_wmCd = 0; p.vars.b_wmOther = 0; }
  },
  onEnemyHit(state, ev, p, e, info) {
    if (!isBerserker(p)) return;
    markCombat(state, p);
    const v = p.vars;
    // lifesteal (Bloodlust, Blood God), applied once per tick in onPlayerTick
    let pct = 0;
    if (buffActive(state, p, 'bloodlust')) pct += K.lust.steal * (has(p, 'b_blood_feast') && p.hp.ratio(p.maxHp) < K.lust.feastBelow ? 2 : 1);
    if (has(p, 'b_blood_god')) pct += v.b_frenzy ?? 0;
    if (pct > 0 && !p.maxHp.isZero()) v.b_ls = Math.min(10, (v.b_ls ?? 0) + Math.min(10, info.dealt.ratio(p.maxHp)) * pct / 100);
    if (buffActive(state, p, 'undying') && !p.maxHp.isZero()) v.b_udDealt = Math.min(100, (v.b_udDealt ?? 0) + Math.min(100, info.dealt.ratio(p.maxHp)));
    if (info.generation !== 0 || !info.skillId) return;
    if (!BASIC_HITS.has(info.skillId)) {
      if (v.b_fhTick !== state.tick) { v.b_fhTick = state.tick; v.b_fhN = 0; }
      if ((v.b_fhN ?? 0) < K.rage.capPerTick) { v.b_fhN = (v.b_fhN ?? 0) + 1; rage(p, K.rage.skillHit); }
    }
    if (WARCRY_HITS.has(info.skillId) && has(p, 'b_warmonger')) {
      if ((v.b_wmCd ?? 0) < K.warmonger.cdMax) { refundCooldown(p, BR.warcry, K.warmonger.cd); v.b_wmCd = (v.b_wmCd ?? 0) + K.warmonger.cd; }
      if ((v.b_wmOther ?? 0) < K.warmonger.otherMax) { rage(p, K.warmonger.other); v.b_wmOther = (v.b_wmOther ?? 0) + K.warmonger.other; }
    }
  },
  onKill(state, ev, e, p) {
    if (!isBerserker(p) || p.lifeState !== 'alive') return;
    // Avatar: every kill extends it (up to K.avatar.maxSec from its start)
    const av = p.buffs.find((x) => x.id === 'avatar' && x.until > state.tick);
    if (av) {
      av.until = Math.min((p.vars.b_avStart ?? state.tick) + ticks(K.avatar.maxSec), av.until + ticks(K.avatar.perKill));
      const h = findHazard(state, 'b_avatar', p.slot);
      if (h) h.untilTick = av.until;
    }
    if (has(p, 'b_battle_trance')) {
      const b = p.buffs.find((x) => x.id === 'bloodlust' && x.until > state.tick);
      if (b) b.until = Math.min((p.vars.b_blStart ?? state.tick) + ticks(K.lust.tranceMax), b.until + ticks(K.lust.tranceKill));
    }
    if (whirling(state, p) && has(p, 'b_flaying_spin')) {
      hitCircle(state, ev, p, e.x, e.y, K.flay.r, subDmg(state, p, 'physical', K.flay.coef, 'b_whirlwind'), { dtype: 'physical', skillId: 'b_flay_burst', generation: 1, allowCrit: false });
      castEv(ev, p, 'b_flay_burst', e.x, e.y, K.flay.r, 0);
    }
    if (has(p, 'b_red_harvest') && hasRend(state, p, e)) {
      let rest = Big.ZERO;
      for (const d of e.dots) {
        if (d.src !== p.slot || d.type !== 'physical' || d.until <= state.tick) continue;
        rest = rest.add(d.perSec.mul(Big.from(((d.until - state.tick) * DT).toFixed(3))));
      }
      const dmg = subDmg(state, p, 'physical', K.harvest.coef).add(rest);
      hitCircle(state, ev, p, e.x, e.y, K.harvest.r, dmg, { dtype: 'physical', skillId: 'b_harvest', generation: 1, allowCrit: false });
      rage(p, K.harvest.rage);
      castEv(ev, p, 'b_harvest', e.x, e.y, K.harvest.r, 0);
    }
  },
  onPlayerDamaged(state, ev, p) {
    // Rage for the health actually lost is granted after the kit's damage adjustments and lethal guards (kitGlobal.after)
    markCombat(state, p);
    p.vars.b_hpPre = p.maxHp.isZero() ? 0 : Math.min(1, p.hp.ratio(p.maxHp));
  },
  onPlayerTick(state, ev, p) {
    const v = p.vars;
    const tag = v.mv_tag ?? 0;
    const r = stepMove(state, p);
    if (r === 'land' && (tag === TAG.LEAP || tag === TAG.CATA)) leapLand(state, ev, p, tag === TAG.CATA);
    if (r === 'end' && tag === TAG.EXEC) executeCleave(state, ev, p);
    stepWhirl(state, ev, p);
    // lifesteal accumulated this tick
    if ((v.b_ls ?? 0) > 0) { healPlayer(state, ev, p, p.maxHp.mul(Big.from(Math.min(1, v.b_ls).toFixed(6)))); v.b_ls = 0; }
    // Undying Rage ends: heal from the carnage dealt
    if ((v.b_udEnd ?? 0) > 0 && state.tick >= v.b_udEnd) {
      v.b_udEnd = 0;
      const frac = Math.min(K.undying.cap, (v.b_udDealt ?? 0) * K.undying.heal);
      if (frac > 0) healPlayer(state, ev, p, p.maxHp.mul(Big.from(frac.toFixed(4))));
    }
    const avatar = buffActive(state, p, 'avatar');
    // Frenzy expiry (frozen by Bloodlust and Avatar), clamp to the current cap
    const max = frenzyMax(state, p);
    let st = Math.min(v.b_frenzy ?? 0, max);
    if (st > 0 && !avatar && !buffActive(state, p, 'bloodlust') && state.tick - (v.b_frenzyT ?? 0) > ticks(K.frenzy.sec)) st = 0;
    v.b_frenzy = st;
    v.ui_frenzy = st; v.ui_frenzyMax = max;
    const fh = findHazard(state, 'b_frenzy', p.slot);
    if (st > 0) {
      if (fh) { fh.untilTick = state.tick + 2; fh.outer = st; fh.width = max; }
      else addHazard(state, p, { kind: 'b_frenzy', x: p.x, y: p.y, radius: 0.6, untilTick: state.tick + 2, speed: 1, outer: st, width: max });
    } else if (fh) endHazard(state, fh);
  },
  hazardTick(state, ev, h) {
    if (!h.kind.startsWith('b_')) return undefined;
    const p = state.players[h.ownerId];
    if (!p) return true;
    if (h.kind === 'b_fear') { stepFear(state, h); return true; }
    if (!followAttachment(state, h)) return true;
    switch (h.kind) {
      case 'b_quake':
        if (state.tick >= h.nextTick && h.outer <= 2) {
          quakeRing(state, ev, p, h.x, h.y, h.outer);
          h.outer++;
          h.nextTick = state.tick + ticks(K.cata.every);
          if (h.outer > 2) endHazard(state, h);
        }
        break;
      case 'b_aftershock':
        if (h.outer === 0 && state.tick >= h.nextTick) {
          h.outer = 1;
          hitCircle(state, ev, p, h.x, h.y, h.radius, h.damage, { dtype: 'physical', skillId: 'b_aftershock', stagger: 30 });
          castEv(ev, p, 'b_aftershock', h.x, h.y, h.radius, 0);
          endHazard(state, h);
        }
        break;
      case 'b_fissure':
        if (state.tick >= h.nextTick) {
          h.nextTick = state.tick + h.interval;
          for (const e of enemiesIn(state, h.x, h.y, h.radius)) {
            hitOne(state, ev, p, e, h.damage, { dtype: 'physical', skillId: 'b_fissure', allowCrit: false }, h.x, h.y, h.radius);
            vuln(state, e, K.tectonic.vuln, 1);
          }
        }
        break;
    }
    return true;
  },
  onRoundStart(state) {
    for (const p of state.players) {
      if (!isBerserker(p)) continue;
      const v = p.vars;
      v.b_frenzy = 0; v.b_wwExtra = 0; v.b_wwUntil = 0; v.mv_mode = 0; v.b_ls = 0; v.b_udEnd = 0; v.b_bfUntil = 0; v.b_last = state.tick;
      v.ui_frenzy = 0; v.ui_frenzyMax = frenzyMax(state, p);
    }
  },
});

// ---------------- party-wide effects ----------------

kitGlobal.taken((state, p) => {
  if (p.classId !== CLS) return 1;
  let f = 1;
  if (buffActive(state, p, 'avatar')) f *= K.avatar.taken;
  if (buffActive(state, p, 'unchained')) f *= K.unchained.taken;
  return f;
});

kitGlobal.attackSpeed((state, p) => {
  let m = 1;
  const cry = p.buffs.find((b) => b.id === 'battle_cry' && b.until > state.tick);
  if (cry) m *= cry.value > 1 ? cry.value : K.shout.atk;
  if (p.classId === CLS) { const st = p.vars.b_frenzy ?? 0; if (st > 0) m *= Math.pow(K.frenzy.atk, st); }
  return m;
});

kitGlobal.after((state, ev, p, info) => {
  if (p.classId !== CLS || p.maxHp.isZero()) return;
  const final = p.hp.gt(info.dealt) ? p.hp.sub(info.dealt) : Big.ZERO;
  const lost = Math.max(0, (p.vars.b_hpPre ?? 0) - Math.min(1, final.ratio(p.maxHp)));
  if (lost > 0) rage(p, lost * 100 * K.rage.perPct);
});

kitGlobal.lethal((state, ev, p) => {
  if (p.classId !== CLS) return null;
  if (buffActive(state, p, 'undying')) return { keep: ONE };
  if (has(p, 'b_undying') && state.tick >= (p.vars.b_udReady ?? 0)) {
    p.vars.b_udReady = state.tick + ticks(K.undying.cd);
    p.vars.b_udEnd = state.tick + ticks(K.undying.sec);
    p.vars.b_udDealt = 0;
    setBuff(p, 'undying', p.vars.b_udEnd);
    addHazard(state, p, { kind: 'b_undying', x: p.x, y: p.y, radius: 1, untilTick: p.vars.b_udEnd, speed: 1 });
    castEv(ev, p, 'b_undying', p.x, p.y, K.undying.sec, 0);
    return { keep: ONE };
  }
  if (has(p, 'b_deathless') && state.tick >= (p.vars.b_dlReady ?? 0)) {
    p.vars.b_dlReady = state.tick + ticks(K.deathless.cd);
    p.iframes = Math.max(p.iframes, K.deathless.iframes);
    castEv(ev, p, 'b_deathless', p.x, p.y, K.deathless.cd, 0);
    return { keep: ONE };
  }
  return null;
}, 0);

export {};
