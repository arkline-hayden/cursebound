import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID } from '@cursebound/content';
import { cohortHpFrac, healPlayer, hitEnemy, hitPlayer, shieldPlayer, addStagger } from '../combat';
import { inCone, norm, rayDistance } from '../geometry';
import { registerClassHooks } from '../hooks';
import { nextFloat } from '../rng';
import { areaCoverage, cosHalf, flinch, livingEnemies, newProjectileId, revivePlayer, spawnPlayerProjectiles } from '../players';
import { B, ONE, playerDerived } from '../stats';
import type { EnemyState, Hazard, PlayerState, Projectile, SimEvent, SimState } from '../types';
import {
  DT, MV_DASH, addHazard, castEv, endHazard, enemiesIn, enemyById, findHazard, followAttachment, gainResource, has, hitCircle, hitOne,
  kitGlobal, landingPoint, moving, pull, rank, refundCooldown, registerFamily, shove, skillDmg, skyPoint, startDash, startLeap, statBig,
  stepMove, stun, subDmg, ticks, vuln,
} from './tbkit';

// Templar kit (content: packages/content/src/classes/templar.ts). Deterministic: state, inputs and the combat rng
// stream (Heaven's Call target picks) only. p.vars:
//   t_combo        basic swings since the last radiant shockwave (0..2)
//   t_ret          stored Retribution as a fraction of maximum health (ui_retribution mirrors it in % for the HUD)
//   t_diRound      round in which Divine Intervention was spent
//   th<id>/tn<id>  hovering hammer end tick / next grind tick (Grinding Halt)
//   mv_*           scripted charge / leap (tbkit)
// Hazards (tbkit conventions): t_consecration, t_beacon (holy ground), t_judgment (pending pillar), t_smite_mark
// (pending Heaven's Call smite), t_condemn (mark on an enemy, outer = stacks), t_charge (charge contact list),
// t_dome, t_vow (attached to a player), t_leap_mark, t_bastion_aura.
// Projectiles: t_hammer (outbound), t_hammer_h (hovering), t_hammer_r (returning, skillId t_hammer_return), t_bolt.
// Cosmetic cast events: t_shockwave, t_judgment_land, t_skyfall_smite, t_smite_hit, t_condemn_burst (dx = stacks,
// dy = 1 on a Final Verdict), t_hammer_hover, t_hammer_spin, t_hammer_catch, t_charge_end, t_dome_up, t_dome_block,
// t_intercession_land, t_vow_burst, t_heaven_smite, t_intervention, t_retribution. Events that target a point carry it in dx/dy:
// t_judgment_day, t_smite, t_beacon, t_intercession.

const CLS = 'templar';
const BR = { radiance: 0, judgment: 1, aegis: 2 } as const;
const TAG = { CHARGE: 11, AEGIS: 12, INTERCESSION: 13 } as const;

const T = {
  basic: { range: 2.0, arc: 110, zeal: 4, every: 3, shockRange: 2.9, shockArc: 120, shockCoef: '0.9', shockStagger: 20 },
  jd: { range: 6, delay: 0.35, pullR: 3.5, pull: 2.0, radius: 3, stun: 1.5, stagger: 180, groundSec: 5 },
  ground: { every: 0.5, coef: '0.35', heal: '0.012', radius: 2.6, sec: 5 },
  blind: { stun: 1.0, stagger: 40, vuln: '1.15', sec: 4 },
  searing: { vuln: '1.12', sec: 1 },
  dawn: { radius: 3.5, stun: 1.0, stagger: 60, knock: 0.8, heal: '0.08' },
  beacon: { range: 6, sec: 8, radius: 3, boltRange: 6, boltSpeed: 12, heal: '0.01' },
  ward: '0.5', avenging: { frac: '0.6', range: 5 }, sanctum: { taken: 0.8, atk: 1.2 },
  hammer: { back: 16, catchR: 0.8, shepherd: 1.5, shepherdStagger: 25, hover: 1.2, spinEvery: 0.2, spinR: 1.5, spinCoef: '0.35', hitStagger: 15 },
  skyfall: { min: 2, max: 7, coef: '2.2', radius: 2, stun: 0.8, stagger: 50 },
  smite: { range: 9, near: 3.5, targets: 3, splash: 1.0, stun: 0.5, stagger: 30 },
  condemn: { sec: 6, perRank: 0.8, radius: 1.8, verdictBelow: 0.35, verdict: '2.5', verdictStagger: 40, cd: 0.5, zeal: 3, maxInq: 3, spread: 3, spreadR: 3 },
  heaven: { count: 3, range: 7, coef: '1', radius: 1.2, gap: 0.2 },
  charge: { dist: 5, speed: 18, hitR: 1.0, push: 1.2, stagger: 30, taken: 0.5, slamR: 1.8, slamCoef: 0.8, slamStun: 0.5, slamStagger: 30, pathShield: '0.1', pathR: 2, juggR: 2, juggCoef: '1' },
  dome: { radius: 3, sec: 4, taken: 0.6 },
  inter: { allyRange: 8, fallback: 6, air: 0.4, landR: 2.2, knock: 1.0, stagger: 30, vowR: 3, vow: '0.18', vowSec: 6, burst: '1.5', burstR: 2.2 },
  angel: { range: 5, revive: 0.5, bleed: 0.5 },
  intervention: { range: 8, keep: '0.3', iframes: 2 },
  bastion: { range: 4, taken: 0.75, transfer: '0.25' },
  ret: { store: 0.4, mult: '2', radius: 2.6 },
};

registerFamily({
  t_dawnbreak: 't_consecrate', t_beacon: 't_consecrate',
  t_skyfall: 't_hammer_throw', t_smite: 't_hammer_throw',
  t_aegis_charge: 't_shield_charge', t_intercession: 't_shield_charge',
});

const JUDGMENT_SKILLS = new Set(['t_hammer_throw', 't_skyfall', 't_smite']);
/** Hits that apply Condemn (Condemnation). */
const CONDEMNING = new Set(['t_hammer_throw', 't_skyfall', 't_hammer_return', 't_hammer_spin', 't_skyfall_smite', 't_smite', 't_heaven_smite']);
/** Hits that detonate Condemn. */
const DETONATING = new Set(['t_hammer', 't_shockwave']);

const isTemplar = (p: PlayerState | undefined): p is PlayerState => !!p && p.classId === CLS;
const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

// ---------------- healing ----------------

/** Heal granted by a Templar: Holy healing, Radiant Ward overheal shields and Avenging Light retaliation. */
function grantHeal(state: SimState, ev: SimEvent[], src: PlayerState, a: PlayerState, amount: Big) {
  if (a.lifeState !== 'alive' || amount.isZero()) return;
  const amt = amount.mul(statBig(state, src, 'player.holyHealing'));
  const eff = amt.mul(playerDerived(state, a).healing);
  const missing = a.maxHp.sub(a.hp);
  healPlayer(state, ev, a, amt);
  if (has(src, 't_radiant_ward') && eff.gt(missing)) shieldPlayer(state, ev, a, eff.sub(missing).mul(B(T.ward)));
  if (has(src, 't_avenging_light')) {
    const e = enemiesIn(state, a.x, a.y, T.avenging.range)[0];
    if (e) hitOne(state, ev, src, e, eff.mul(B(T.avenging.frac)).mul(playerDerived(state, src).typeMult.astral), { dtype: 'astral', skillId: 't_avenging', generation: 1, allowCrit: false }, a.x, a.y);
  }
}

function grantShield(state: SimState, ev: SimEvent[], src: PlayerState, a: PlayerState, frac: string) {
  if (a.lifeState !== 'alive') return;
  shieldPlayer(state, ev, a, a.maxHp.mul(B(frac)).mul(statBig(state, src, 'player.holyHealing')));
}

// ---------------- holy ground ----------------

const groundDmg = (state: SimState, p: PlayerState) => subDmg(state, p, 'astral', T.ground.coef, 't_consecrate');

function blind(state: SimState, ev: SimEvent[], x: number, y: number, r: number) {
  for (const e of enemiesIn(state, x, y, r)) { stun(state, ev, e, T.blind.stun, T.blind.stagger); vuln(state, e, T.blind.vuln, T.blind.sec); }
}

function consecrate(state: SimState, p: PlayerState, x: number, y: number, r: number, sec: number, follow: boolean): Hazard {
  return addHazard(state, p, {
    kind: 't_consecration', x, y, radius: r, untilTick: state.tick + ticks(sec), interval: ticks(T.ground.every), nextTick: state.tick,
    damage: groundDmg(state, p), dtype: 'astral', speed: follow ? 1 : 0,
  });
}

function groundPulse(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard, healFrac: string, hitEnemies: boolean) {
  if (hitEnemies) {
    for (const e of enemiesIn(state, h.x, h.y, h.radius)) {
      hitOne(state, ev, p, e, h.damage, { dtype: 'astral', skillId: 't_consecration', allowCrit: false }, h.x, h.y, h.radius);
      if (has(p, 't_searing_light')) vuln(state, e, T.searing.vuln, T.searing.sec);
    }
  }
  for (const a of state.players) {
    if (a.lifeState !== 'alive' || d2(a.x, a.y, h.x, h.y) > h.radius * h.radius) continue;
    grantHeal(state, ev, p, a, a.maxHp.mul(B(healFrac)));
  }
}

/** Is `a` standing in holy ground of a Templar who owns Holy Sanctum? */
function inSanctum(state: SimState, a: PlayerState): boolean {
  for (const h of state.hazards) {
    if (h.owner !== 'player' || (h.kind !== 't_consecration' && h.kind !== 't_beacon') || h.untilTick <= state.tick) continue;
    const o = state.players[h.ownerId];
    if (!o || !has(o, 't_sanctum')) continue;
    if (d2(a.x, a.y, h.x, h.y) <= h.radius * h.radius) return true;
  }
  return false;
}

// ---------------- condemn ----------------

function condemn(state: SimState, p: PlayerState, e: EnemyState, stacks: number) {
  if (!has(p, 't_condemnation')) return;
  const max = has(p, 't_inquisitor') ? T.condemn.maxInq : 1;
  let h = findHazard(state, 't_condemn', p.slot, e.id);
  if (!h) h = addHazard(state, p, { kind: 't_condemn', x: e.x, y: e.y, radius: e.radius, untilTick: state.tick + ticks(T.condemn.sec), speed: 2, hitSlots: [e.id], outer: 0 });
  h.outer = Math.min(max, h.outer + stacks);
  h.untilTick = Math.max(h.untilTick, state.tick + ticks(T.condemn.sec));
}

function detonate(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, h: Hazard) {
  const stacks = Math.max(1, h.outer);
  endHazard(state, h);
  h.hitSlots = [-1]; h.outer = 0;
  const r = rank(p, 't_condemnation');
  let dmg = subDmg(state, p, 'astral', Big.from((T.condemn.perRank * r * stacks).toFixed(2)));
  const verdict = has(p, 't_final_verdict') && cohortHpFrac(e.cohort) < T.condemn.verdictBelow;
  if (verdict) dmg = dmg.mul(B(T.condemn.verdict));
  const x = e.x, y = e.y;
  hitCircle(state, ev, p, x, y, T.condemn.radius, dmg, { dtype: 'astral', skillId: 't_condemn', generation: 1, stagger: has(p, 't_final_verdict') ? T.condemn.verdictStagger : 10 });
  castEv(ev, p, 't_condemn_burst', x, y, stacks, verdict ? 1 : 0);
  const m = rank(p, 't_momentum');
  if (m > 0) { refundCooldown(p, BR.judgment, T.condemn.cd * m); gainResource(state, p, T.condemn.zeal * m); }
  if (has(p, 't_inquisitor')) {
    let n = 0;
    for (const o of enemiesIn(state, x, y, T.condemn.spreadR)) {
      if (o.id === e.id) continue;
      condemn(state, p, o, 1);
      if (++n >= T.condemn.spread) break;
    }
  }
}

// ---------------- basic attack ----------------

function basic(state: SimState, ev: SimEvent[], p: PlayerState, k: Big) {
  const dmg = skillDmg(state, p, 't_hammer');
  // reach and arc from content (t_hammer shape), so click-to-move, the lunge and the swing agree
  const hs = SKILL_BY_ID['t_hammer'].shape;
  const R = hs.kind === 'arc' ? hs.range : T.basic.range;
  const ch = cosHalf(hs.kind === 'arc' ? hs.arcDeg : T.basic.arc);
  let hitAny = false;
  for (const e of livingEnemies(state)) {
    if (!inCone(p.x, p.y, p.aimX, p.aimY, R, ch, e.x, e.y, e.radius)) continue;
    hitEnemy(state, ev, e, dmg, k, { dtype: 'physical', srcSlot: p.slot, skillId: 't_hammer', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, R), allowCrit: true });
    flinch(state, e, p.x, p.y, 0.2);
    hitAny = true;
  }
  castEv(ev, p, 't_hammer', p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
  if (hitAny) gainResource(state, p, T.basic.zeal);
  // radiant shockwave on every third swing (grouped packets carry their share of shockwaves)
  let waves: Big;
  if (k.lte(B(1000000))) {
    const c = (p.vars.t_combo ?? 0) + k.toNumber();
    const w = Math.floor(c / T.basic.every);
    p.vars.t_combo = c - w * T.basic.every;
    waves = Big.from(w);
  } else waves = Big.from(k.div(B(T.basic.every)).floorInt());
  if (waves.isZero()) return;
  const sd = subDmg(state, p, 'astral', T.basic.shockCoef);
  const sch = cosHalf(T.basic.shockArc);
  for (const e of livingEnemies(state)) {
    if (!inCone(p.x, p.y, p.aimX, p.aimY, T.basic.shockRange, sch, e.x, e.y, e.radius)) continue;
    hitEnemy(state, ev, e, sd, waves, { dtype: 'astral', srcSlot: p.slot, skillId: 't_shockwave', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, T.basic.shockRange), allowCrit: true, stagger: T.basic.shockStagger });
    flinch(state, e, p.x, p.y, 0.4);
  }
  castEv(ev, p, 't_shockwave', p.x, p.y, p.aimX, p.aimY, waves.gt(ONE) ? waves.toCompact() : undefined);
}

// ---------------- hammers ----------------

function returnLeg(state: SimState, ev: SimEvent[], p: PlayerState, pr: Projectile) {
  const dx = p.x - pr.x, dy = p.y - pr.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  if (pr.skillId === 't_skyfall') pr.crit = true;            // remembers the Skyfall family for the hover/return legs
  pr.kind = 't_hammer_r'; pr.skillId = 't_hammer_return'; pr.hitIds = []; pr.pierce = 999;
  pr.vx = (dx / d) * T.hammer.back; pr.vy = (dy / d) * T.hammer.back; pr.range = d + 0.5;
  delete p.vars['th' + pr.id]; delete p.vars['tn' + pr.id];
}

function apex(state: SimState, ev: SimEvent[], p: PlayerState, pr: Projectile) {
  if (pr.skillId === 't_skyfall') {
    const x = pr.x, y = pr.y;
    const hit = hitCircle(state, ev, p, x, y, T.skyfall.radius, subDmg(state, p, 'astral', T.skyfall.coef, 't_skyfall'), { dtype: 'astral', skillId: 't_skyfall_smite', stagger: T.skyfall.stagger });
    for (const e of hit) stun(state, ev, e, T.skyfall.stun, 0);
    castEv(ev, p, 't_skyfall_smite', x, y, T.skyfall.radius, 0);
  }
  if (has(p, 't_hammerfall')) {
    const [dx, dy] = norm(pr.vx, pr.vy);
    if (pr.skillId === 't_skyfall') pr.crit = true;
    pr.kind = 't_hammer_h';
    // creeps 0.02 units over the hover; expires on its own (~1.5s) if nobody steers it home
    const v = 0.02 / T.hammer.hover;
    pr.vx = (dx || 1) * v; pr.vy = dy * v; pr.range = 0.035;
    p.vars['th' + pr.id] = state.tick + ticks(T.hammer.hover);
    p.vars['tn' + pr.id] = state.tick;
    castEv(ev, p, 't_hammer_hover', pr.x, pr.y, T.hammer.spinR, 0);
  } else returnLeg(state, ev, p, pr);
}

function steerHammers(state: SimState, ev: SimEvent[], p: PlayerState) {
  let caught = false;
  for (const pr of state.projectiles) {
    if (pr.owner !== 'player' || pr.ownerId !== p.slot) continue;
    if (pr.kind === 't_hammer') {
      const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
      const [dx, dy] = norm(pr.vx, pr.vy);
      const stepLen = sp * DT;
      const ahead = state.map ? rayDistance(state.map, pr.x, pr.y, dx, dy, stepLen + pr.radius) : 99;
      if (pr.range <= stepLen + 1e-3 || ahead < stepLen + pr.radius * 0.5) apex(state, ev, p, pr);
    } else if (pr.kind === 't_hammer_h') {
      const next = p.vars['tn' + pr.id] ?? state.tick;
      if (state.tick >= next) {
        p.vars['tn' + pr.id] = state.tick + ticks(T.hammer.spinEvery);
        const fam = pr.crit ? 't_skyfall' : 't_hammer_throw';
        hitCircle(state, ev, p, pr.x, pr.y, T.hammer.spinR, subDmg(state, p, 'physical', T.hammer.spinCoef, fam), { dtype: 'physical', skillId: 't_hammer_spin' });
        castEv(ev, p, 't_hammer_spin', pr.x, pr.y, T.hammer.spinR, 0);
      }
      if (state.tick >= (p.vars['th' + pr.id] ?? 0)) returnLeg(state, ev, p, pr);
    } else if (pr.kind === 't_hammer_r') {
      const dx = p.x - pr.x, dy = p.y - pr.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < T.hammer.catchR) { pr.range = -1; caught = true; continue; }
      pr.vx = (dx / d) * T.hammer.back; pr.vy = (dy / d) * T.hammer.back; pr.range = d + 0.5;
    }
  }
  if (caught) {
    state.projectiles = state.projectiles.filter((pr) => !(pr.owner === 'player' && pr.ownerId === p.slot && pr.kind === 't_hammer_r' && pr.range < 0));
    castEv(ev, p, 't_hammer_catch', p.x, p.y, p.aimX, p.aimY);
  }
}

function spawnBolt(state: SimState, p: PlayerState, x: number, y: number, e: EnemyState, damage: Big) {
  const [dx, dy] = norm(e.x - x, e.y - y);
  const pr: Projectile = {
    id: newProjectileId(state), kind: 't_bolt', owner: 'player', ownerId: p.slot, x, y,
    vx: (dx || 1) * T.beacon.boltSpeed, vy: dy * T.beacon.boltSpeed, radius: 0.3, range: T.beacon.boltRange + 1, damage, weight: ONE,
    dtype: 'astral', pierce: 0, hitIds: [], skillId: 't_beacon', crit: false, lobTarget: null, bornTick: state.tick,
  };
  state.projectiles.push(pr);
}

// ---------------- Aegis ----------------

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return d2(px, py, ax + vx * t, ay + vy * t);
}

function chargeSkill(p: PlayerState) { return p.vars.mv_tag === TAG.AEGIS ? 't_aegis_charge' : 't_shield_charge'; }

function chargeContacts(state: SimState, ev: SimEvent[], p: PlayerState) {
  const h = findHazard(state, 't_charge', p.slot);
  if (!h) return;
  const dx = p.vars.mv_dx ?? 1, dy = p.vars.mv_dy ?? 0;
  const jugg = has(p, 't_juggernaut');
  const skill = chargeSkill(p);
  for (const e of enemiesIn(state, p.x, p.y, T.charge.hitR)) {
    if (h.hitSlots.includes(e.id)) continue;
    h.hitSlots.push(e.id);
    hitOne(state, ev, p, e, skillDmg(state, p, skill), { dtype: 'physical', skillId: skill, stagger: T.charge.stagger }, p.x, p.y);
    if (!jugg) {
      const side = (e.x - p.x) * -dy + (e.y - p.y) * dx >= 0 ? 1 : -1;
      shove(state, e, -dy * side + dx * 0.3, dx * side + dy * 0.3, T.charge.push);
    }
  }
  if (jugg && state.map) {
    for (const id of h.hitSlots) {
      const e = enemyById(state, id);
      if (!e || e.boss) continue;
      const tx = p.x + dx * (0.55 + e.radius), ty = p.y + dy * (0.55 + e.radius);
      pull(state, e, tx, ty, 2);
      e.staggerUntil = Math.max(e.staggerUntil, state.tick + 2);
      e.attack = null;
    }
  }
}

function retributionRelease(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number) {
  if (!has(p, 't_retribution')) return;
  const stored = p.vars.t_ret ?? 0;
  p.vars.t_ret = 0;
  if (stored < 0.005) return;
  const dmg = p.maxHp.mul(Big.from(stored.toFixed(4))).mul(B(T.ret.mult));
  hitCircle(state, ev, p, x, y, T.ret.radius, dmg, { dtype: 'astral', skillId: 't_retribution', generation: 1, allowCrit: false, stagger: 60 });
  castEv(ev, p, 't_retribution', x, y, T.ret.radius, stored);
}

function chargeEnd(state: SimState, ev: SimEvent[], p: PlayerState, tag: number) {
  const h = findHazard(state, 't_charge', p.slot);
  const x = p.x, y = p.y;
  const dx = p.vars.mv_dx ?? 1, dy = p.vars.mv_dy ?? 0;
  const slam = rank(p, 't_shield_slam');
  if (slam > 0) {
    const hit = hitCircle(state, ev, p, x, y, T.charge.slamR, subDmg(state, p, 'physical', Big.from((T.charge.slamCoef * slam).toFixed(2)), 't_shield_charge'), { dtype: 'physical', skillId: 't_shield_slam', stagger: T.charge.slamStagger * slam });
    for (const e of hit) stun(state, ev, e, T.charge.slamStun * slam, 0);
  }
  if (has(p, 't_juggernaut')) {
    hitCircle(state, ev, p, x, y, T.charge.juggR, subDmg(state, p, 'physical', T.charge.juggCoef, 't_shield_charge'), { dtype: 'physical', skillId: 't_juggernaut', stagger: 30 });
    for (const id of h?.hitSlots ?? []) { const e = enemyById(state, id); if (e) shove(state, e, dx, dy, 1.0); }
  }
  if (has(p, 't_guardians_path')) {
    const x0 = p.vars.mv_x0 ?? x, y0 = p.vars.mv_y0 ?? y;
    for (const a of state.players) {
      if (a.lifeState !== 'alive') continue;
      if (a !== p && segDist2(a.x, a.y, x0, y0, x, y) > T.charge.pathR * T.charge.pathR) continue;
      grantShield(state, ev, p, a, T.charge.pathShield);
    }
  }
  if (tag === TAG.AEGIS) {
    addHazard(state, p, { kind: 't_dome', x, y, radius: T.dome.radius, untilTick: state.tick + ticks(T.dome.sec) });
    castEv(ev, p, 't_dome_up', x, y, T.dome.radius, 0);
  }
  retributionRelease(state, ev, p, x, y);
  castEv(ev, p, 't_charge_end', x, y, dx, dy);
  if (h) endHazard(state, h);
}

function intercessionLand(state: SimState, ev: SimEvent[], p: PlayerState) {
  const x = p.x, y = p.y;
  const hit = hitCircle(state, ev, p, x, y, T.inter.landR, skillDmg(state, p, 't_intercession'), { dtype: 'physical', skillId: 't_intercession', stagger: T.inter.stagger });
  for (const e of hit) shove(state, e, e.x - x, e.y - y, T.inter.knock);
  for (const a of state.players) {
    if (a.lifeState !== 'alive' || d2(a.x, a.y, x, y) > T.inter.vowR * T.inter.vowR) continue;
    grantShield(state, ev, p, a, T.inter.vow);
    const old = findVow(state, a.slot);
    if (old) endHazard(state, old);
    addHazard(state, p, { kind: 't_vow', x: a.x, y: a.y, radius: 0.8, untilTick: state.tick + ticks(T.inter.vowSec), speed: 3, hitSlots: [a.slot], inner: a.slot });
  }
  retributionRelease(state, ev, p, x, y);
  castEv(ev, p, 't_intercession_land', x, y, T.inter.landR, 0);
}

function findVow(state: SimState, slot: number): Hazard | undefined {
  for (const h of state.hazards) if (h.kind === 't_vow' && h.untilTick > state.tick && h.hitSlots[0] === slot) return h;
  return undefined;
}

// ---------------- casting ----------------

function cast(state: SimState, ev: SimEvent[], p: PlayerState, id: string): boolean | undefined {
  if (moving(state, p)) return false;
  const tick = state.tick;
  switch (id) {
    case 't_judgment_day': {
      const [tx, ty] = skyPoint(state, p, T.jd.range);
      addHazard(state, p, { kind: 't_judgment', x: tx, y: ty, radius: T.jd.radius, nextTick: tick + ticks(T.jd.delay), untilTick: tick + ticks(T.jd.delay) + 2, outer: 0 });
      castEv(ev, p, id, p.x, p.y, tx, ty);
      return true;
    }
    case 't_consecrate': {
      consecrate(state, p, p.x, p.y, T.ground.radius, T.ground.sec, has(p, 't_sanctuary'));
      if (has(p, 't_blinding_light')) blind(state, ev, p.x, p.y, T.ground.radius);
      castEv(ev, p, id, p.x, p.y, T.ground.radius, 0);
      return true;
    }
    case 't_dawnbreak': {
      const hit = hitCircle(state, ev, p, p.x, p.y, T.dawn.radius, skillDmg(state, p, id), { dtype: 'astral', skillId: id, stagger: T.dawn.stagger });
      for (const e of hit) { stun(state, ev, e, T.dawn.stun, 0); shove(state, e, e.x - p.x, e.y - p.y, T.dawn.knock); if (has(p, 't_blinding_light')) vuln(state, e, T.blind.vuln, T.blind.sec); }
      for (const a of state.players) if (a.lifeState === 'alive' && d2(a.x, a.y, p.x, p.y) <= T.dawn.radius * T.dawn.radius) grantHeal(state, ev, p, a, a.maxHp.mul(B(T.dawn.heal)));
      consecrate(state, p, p.x, p.y, T.ground.radius, T.ground.sec, has(p, 't_sanctuary'));
      castEv(ev, p, id, p.x, p.y, T.dawn.radius, 0);
      return true;
    }
    case 't_beacon': {
      const [tx, ty] = landingPoint(state, p, T.beacon.range, 0.5);
      const follow = has(p, 't_sanctuary');
      addHazard(state, p, {
        kind: 't_beacon', x: follow ? p.x : tx, y: follow ? p.y : ty, radius: T.beacon.radius, untilTick: tick + ticks(T.beacon.sec),
        interval: ticks(T.ground.every), nextTick: tick, damage: skillDmg(state, p, id), dtype: 'astral', speed: follow ? 1 : 0,
      });
      if (has(p, 't_blinding_light')) blind(state, ev, follow ? p.x : tx, follow ? p.y : ty, T.beacon.radius);
      castEv(ev, p, id, p.x, p.y, follow ? p.x : tx, follow ? p.y : ty);
      return true;
    }
    case 't_hammer_throw':
    case 't_skyfall': {
      const skill = SKILL_BY_ID[id];
      const before = state.projectiles.length;
      spawnPlayerProjectiles(state, ev, p, skill, playerDerived(state, p).projectileCount, skillDmg(state, p, id), 't_hammer');
      if (id === 't_skyfall') {
        const want = Math.min(T.skyfall.max, Math.max(T.skyfall.min, p.aimDist || T.skyfall.max));
        for (let i = before; i < state.projectiles.length; i++) state.projectiles[i].range = want;
      }
      castEv(ev, p, id, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 't_smite': {
      const [ax, ay] = skyPoint(state, p, T.smite.range, 1);
      const targets = enemiesIn(state, ax, ay, T.smite.near).slice(0, T.smite.targets);
      const dmg = skillDmg(state, p, id);
      const strike = (x: number, y: number) => {
        const hit = hitCircle(state, ev, p, x, y, T.smite.splash, dmg, { dtype: 'astral', skillId: id, stagger: T.smite.stagger });
        for (const e of hit) stun(state, ev, e, T.smite.stun, 0);
        castEv(ev, p, 't_smite_hit', x, y, T.smite.splash, 0);
      };
      if (!targets.length) strike(ax, ay);
      else for (const e of targets) strike(e.x, e.y);
      castEv(ev, p, id, p.x, p.y, ax, ay);
      return true;
    }
    case 't_shield_charge':
    case 't_aegis_charge': {
      startDash(state, p, p.aimX, p.aimY, T.charge.dist, T.charge.speed, id === 't_aegis_charge' ? TAG.AEGIS : TAG.CHARGE);
      addHazard(state, p, { kind: 't_charge', x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, untilTick: tick + ticks(1), speed: 1, hitSlots: [] });
      castEv(ev, p, id, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 't_intercession': {
      const reach = Math.min(p.aimDist || 4, T.inter.allyRange);
      const ax = p.x + p.aimX * reach, ay = p.y + p.aimY * reach;
      let best: PlayerState | null = null; let bd = Infinity;
      for (const a of state.players) {
        if (a === p || a.lifeState !== 'alive' || d2(a.x, a.y, p.x, p.y) > T.inter.allyRange ** 2) continue;
        const d = d2(a.x, a.y, ax, ay);
        if (d < bd) { bd = d; best = a; }
      }
      let tx: number, ty: number;
      if (best) {
        let [dx, dy] = norm(best.x - p.x, best.y - p.y);
        if (dx === 0 && dy === 0) { dx = p.aimX; dy = p.aimY; }
        const dist = Math.max(0, Math.sqrt(d2(best.x, best.y, p.x, p.y)) - 0.7);
        [tx, ty] = landingPoint(state, p, dist, 0, dx, dy, dist);
      } else [tx, ty] = landingPoint(state, p, T.inter.fallback, 1.5);
      startLeap(state, p, tx, ty, T.inter.air, TAG.INTERCESSION);
      addHazard(state, p, { kind: 't_leap_mark', x: tx, y: ty, radius: T.inter.landR, untilTick: tick + ticks(T.inter.air) + 1 });
      castEv(ev, p, id, p.x, p.y, tx, ty);
      return true;
    }
  }
  return undefined;
}

// ---------------- hooks ----------------

registerClassHooks(CLS, {
  castSkill: cast,
  basicAttack(state, ev, p, k) {
    if (moving(state, p)) return true;
    basic(state, ev, p, k);
    return true;
  },
  onCast(state, ev, p, skillId) {
    if (!JUDGMENT_SKILLS.has(skillId) || !has(p, 't_heavens_call')) return;
    const pool = enemiesIn(state, p.x, p.y, T.heaven.range);
    for (let i = 0; i < T.heaven.count && pool.length; i++) {
      const e = pool[Math.min(pool.length - 1, Math.floor(nextFloat(state.rng.combat) * pool.length))];
      const at = state.tick + ticks(T.heaven.gap * (i + 1));
      addHazard(state, p, { kind: 't_smite_mark', x: e.x, y: e.y, radius: T.heaven.radius, nextTick: at, untilTick: at + 2, hitSlots: [e.id], outer: 0 });
    }
  },
  onEnemyHit(state, ev, p, e, info) {
    if (!isTemplar(p) || info.generation !== 0 || !info.skillId) return;
    if (CONDEMNING.has(info.skillId)) condemn(state, p, e, 1);
    if (info.skillId === 't_hammer_return' && has(p, 't_shepherd')) {
      if (e.boss) addStagger(state, ev, e, T.hammer.shepherdStagger);
      else pull(state, e, p.x, p.y, T.hammer.shepherd);
    } else if ((info.skillId === 't_hammer_throw' || info.skillId === 't_skyfall' || info.skillId === 't_hammer_return') && e.boss) addStagger(state, ev, e, T.hammer.hitStagger);
    if (DETONATING.has(info.skillId) && has(p, 't_condemnation')) {
      const h = findHazard(state, 't_condemn', p.slot, e.id);
      if (h) detonate(state, ev, p, e, h);
    }
  },
  onPlayerDamaged(state, ev, p, info) {
    if (has(p, 't_retribution')) {
      p.vars.t_ret = Math.min(1, (p.vars.t_ret ?? 0) + Math.min(1, info.dealt.ratio(p.maxHp)) * T.ret.store);
    }
  },
  onPlayerTick(state, ev, p) {
    const tag = p.vars.mv_tag ?? 0;
    const r = stepMove(state, p);
    if ((r === 'moving' || r === 'end') && (tag === TAG.CHARGE || tag === TAG.AEGIS)) chargeContacts(state, ev, p);
    if (r === 'end' && (tag === TAG.CHARGE || tag === TAG.AEGIS)) chargeEnd(state, ev, p, tag);
    if (r === 'land' && tag === TAG.INTERCESSION) intercessionLand(state, ev, p);
    steerHammers(state, ev, p);
    if (has(p, 't_living_bastion')) {
      const h = findHazard(state, 't_bastion_aura', p.slot);
      if (h) h.untilTick = state.tick + 2;
      else addHazard(state, p, { kind: 't_bastion_aura', x: p.x, y: p.y, radius: T.bastion.range, untilTick: state.tick + 2, speed: 1 });
    }
    if (has(p, 't_retribution')) p.vars.ui_retribution = Math.round((p.vars.t_ret ?? 0) * 100);
  },
  hazardTick(state, ev, h) {
    if (!h.kind.startsWith('t_')) return undefined;
    const p = state.players[h.ownerId];
    if (!p) return true;
    if (h.kind === 't_smite_mark') {
      const e = enemyById(state, h.hitSlots[0]);
      if (e) { h.x = e.x; h.y = e.y; }
      if (h.outer === 0 && state.tick >= h.nextTick) {
        h.outer = 1;
        hitCircle(state, ev, p, h.x, h.y, T.heaven.radius, subDmg(state, p, 'astral', T.heaven.coef, 't_hammer_throw'), { dtype: 'astral', skillId: 't_heaven_smite', stagger: 20 });
        castEv(ev, p, 't_heaven_smite', h.x, h.y, T.heaven.radius, 0);
        endHazard(state, h);
      }
      return true;
    }
    if (!followAttachment(state, h)) return true;
    switch (h.kind) {
      case 't_consecration':
        if (state.tick >= h.nextTick) { h.nextTick = state.tick + h.interval; groundPulse(state, ev, p, h, T.ground.heal, true); }
        break;
      case 't_beacon':
        if (state.tick >= h.nextTick) {
          h.nextTick = state.tick + h.interval;
          groundPulse(state, ev, p, h, T.beacon.heal, false);
          const e = enemiesIn(state, h.x, h.y, T.beacon.boltRange)[0];
          if (e) spawnBolt(state, p, h.x, h.y, e, h.damage);
        }
        break;
      case 't_judgment':
        if (h.outer === 0 && state.tick >= h.nextTick) {
          h.outer = 1;
          for (const e of enemiesIn(state, h.x, h.y, T.jd.pullR)) pull(state, e, h.x, h.y, T.jd.pull);
          const hit = hitCircle(state, ev, p, h.x, h.y, T.jd.radius, skillDmg(state, p, 't_judgment_day'), { dtype: 'astral', skillId: 't_judgment_day', stagger: T.jd.stagger });
          for (const e of hit) stun(state, ev, e, T.jd.stun, 0);
          consecrate(state, p, h.x, h.y, T.jd.radius, T.jd.groundSec, false);
          castEv(ev, p, 't_judgment_land', h.x, h.y, T.jd.radius, 0);
        }
        break;
    }
    return true;
  },
  onRoundStart(state) {
    for (const p of state.players) {
      if (!isTemplar(p)) continue;
      for (const k of Object.keys(p.vars)) if (/^t[hn]\d/.test(k)) delete p.vars[k];
      p.vars.mv_mode = 0; p.vars.t_combo = 0; p.vars.t_ret = 0;
      if (has(p, 't_retribution')) p.vars.ui_retribution = 0;
    }
  },
});

// ---------------- party-wide effects (any class) ----------------

const templars = (state: SimState) => state.players.filter((t) => t.classId === CLS && t.lifeState === 'alive');

kitGlobal.taken((state, p) => {
  let f = 1;
  if (p.classId === CLS && moving(state, p) && p.vars.mv_mode === MV_DASH) f *= T.charge.taken;
  let dome = false, bastion = false;
  for (const h of state.hazards) {
    if (!dome && h.kind === 't_dome' && h.untilTick > state.tick && d2(p.x, p.y, h.x, h.y) <= h.radius * h.radius) { dome = true; f *= T.dome.taken; }
  }
  for (const t of templars(state)) {
    if (!bastion && t !== p && has(t, 't_living_bastion') && d2(p.x, p.y, t.x, t.y) <= T.bastion.range ** 2) { bastion = true; f *= T.bastion.taken; }
  }
  if (inSanctum(state, p)) f *= T.sanctum.taken;
  return f;
});

kitGlobal.attackSpeed((state, p) => (inSanctum(state, p) ? T.sanctum.atk : 1));

kitGlobal.lethal((state, ev, p) => {
  for (const t of templars(state)) {
    if (!has(t, 't_divine_intervention') || t.vars.t_diRound === state.round) continue;
    if (t !== p && d2(p.x, p.y, t.x, t.y) > T.intervention.range ** 2) continue;
    t.vars.t_diRound = state.round;
    p.iframes = Math.max(p.iframes, T.intervention.iframes);
    castEv(ev, t, 't_intervention', p.x, p.y, p.slot, 0);
    return { keep: p.maxHp.mul(B(T.intervention.keep)) };
  }
  return null;
}, 10);

kitGlobal.after((state, ev, p, info) => {
  // Vow bursts when its shield is gone
  const vow = findVow(state, p.slot);
  if (vow && p.shield.isZero()) {
    const o = state.players[vow.ownerId];
    endHazard(state, vow);
    if (o) {
      const hit = hitCircle(state, ev, o, p.x, p.y, T.inter.burstR, subDmg(state, o, 'astral', T.inter.burst, 't_intercession'), { dtype: 'astral', skillId: 't_vow_burst', generation: 1, stagger: 30 });
      for (const e of hit) shove(state, e, e.x - p.x, e.y - p.y, 1.0);
      castEv(ev, o, 't_vow_burst', p.x, p.y, T.inter.burstR, 0);
    }
  }
  // Living Bastion: a quarter of the original blow is redirected to the Templar
  for (const t of templars(state)) {
    if (t === p || !has(t, 't_living_bastion') || d2(p.x, p.y, t.x, t.y) > T.bastion.range ** 2) continue;
    const share = info.dealt.mul(B(T.bastion.transfer));
    kitGlobal.quiet(() => hitPlayer(state, ev, t, share, { attack: 'Living Bastion', source: info.source, fromX: info.fromX, fromY: info.fromY, dtype: info.dtype, hazard: info.hazard }));
    break;
  }
});

kitGlobal.playerTick((state, ev, p) => {
  const angels = templars(state).filter((t) => has(t, 't_guardian_angel'));
  if (!angels.length) return;
  const near = (x: number, y: number) => angels.some((t) => d2(x, y, t.x, t.y) <= T.angel.range ** 2);
  // revivers near a Guardian Angel channel x1.5 faster
  if (near(p.x, p.y)) {
    for (const a of state.players) {
      if (a.lifeState !== 'downed' || a.reviverSlot !== p.slot) continue;
      a.reviveProgress += DT * playerDerived(state, p).reviveSpeed * T.angel.revive;
      if (a.reviveProgress >= RULES.reviveChannelSec) { revivePlayer(state, ev, a, p.slot); p.stats.revives++; }
    }
  }
  // downed allies near the angel bleed out at half speed
  if (p.classId === CLS && has(p, 't_guardian_angel')) {
    for (const a of state.players) {
      if (a.lifeState !== 'downed' || a.selfReviveChannel > 0 || d2(a.x, a.y, p.x, p.y) > T.angel.range ** 2) continue;
      a.downTimer = Math.min(RULES.downedSec, a.downTimer + DT * T.angel.bleed);
    }
  }
});

kitGlobal.tick((state, ev) => {
  // Aegis Domes destroy enemy projectiles that enter them
  let domes: Hazard[] | null = null;
  for (const h of state.hazards) if (h.kind === 't_dome' && h.untilTick > state.tick) (domes ??= []).push(h);
  if (!domes) return;
  const ds = domes;
  state.projectiles = state.projectiles.filter((pr) => {
    if (pr.owner !== 'enemy') return true;
    const dome = ds.find((h) => d2(pr.x, pr.y, h.x, h.y) <= h.radius * h.radius);
    if (!dome) return true;
    const o = state.players[dome.ownerId];
    if (o) castEv(ev, o, 't_dome_block', pr.x, pr.y, dome.x, dome.y);
    return false;
  });
});

export {};
