import { Big } from '@cursebound/numeric';
import { SKILL_BY_ID } from '@cursebound/content';
import { cohortHpFrac, healPlayer, hitEnemy, shieldPlayer } from '../combat';
import { registerClassHooks, type SimHooks } from '../hooks';
import { inCone, q } from '../geometry';
import { areaCoverage, cosHalf, flinch, knockback, livingEnemies, makeHazard, spawnPlayerProjectiles } from '../players';
import { B, ONE, hitDamage, playerDerived, toFloatClamped, treeFactor } from '../stats';
import type { Hazard, PlayerState, SimEvent, SimState } from '../types';
import {
  DT, ZERO, aimPoint, baseHit, castEv, clearVars, enemiesNear, grantRally, has, hitArea, isLive, pullToward, pushEnemy, rank,
  restoreDodge, startDash, stepDash, ticks, addShieldQuiet,
} from './kitHelpers';

// Vanguard deep tree + evolved skills (content: packages/content/src/classes/vanguard.ts). The base kit (Cleave,
// Earthbreaker, Guard Stance, Sweeping Strike, Rally Cry, Bastion, Follow Through, ...) stays inline in players.ts and
// combat.ts; this module adds the evolutions and new mechanics through SimHooks.
//
// Hazard kinds: v_charge (follows the charging Vanguard, hit list in hitSlots), v_whirl (follows the spin),
//               v_aftershock (fuse; detonates at nextTick), v_banner (war banner, pulses every second).
// Cast events:  skill ids, plus v_leap (x,y -> landing dx,dy), v_retaliate_blast, v_maelstrom, v_provoke, v_aftershock,
//               v_execute (on an executed enemy), v_last_stand (radius in dx where relevant).
// p.vars:       vg_cT/X/Y charge dash, vg_wT/X/Y whirl dash, vg_l* leap, vg_ret/vg_retAt retaliate, vg_mael pulse
//               clock, vg_rmp/vg_rmpU rampage, vg_ft/vg_ftRestore follow through, vg_ls last stand round.

const CID = 'vanguard';
const CLEAVER = new Set(['v_sweeping_strike', 'v_whirlwind', 'v_executioner']);
/** Cleave Guard (melee sustain): a connecting Cleave shields the Vanguard for this fraction of maximum health, once per swing. */
export const CLEAVE_SHIELD = '0.016';

/** Cleaver-skill damage: Heavy Edge scales the whole Sweeping Strike family. */
function ssDmg(state: SimState, p: PlayerState, skillId: string): Big {
  const d = hitDamage(state, p, skillId, 'physical');
  return skillId === 'v_sweeping_strike' ? d : d.mul(treeFactor(p, 'skill.v_sweeping_strike.damage').factor);
}
function ssDot(p: PlayerState) {
  const r = rank(p, 'v_deep_cut');
  return r > 0 ? { type: 'physical' as const, fractionPerSec: (0.1 * r).toFixed(2), durationSec: 3 } : undefined;
}
const ssVuln = (p: PlayerState) => (has(p, 'v_fracture') ? { factor: '1.1', sec: 2 } : undefined);

function sunderingWave(state: SimState, ev: SimEvent[], p: PlayerState) {
  if (!has(p, 'v_sundering_path')) return;
  const wave = SKILL_BY_ID['v_sundering_wave'];
  spawnPlayerProjectiles(state, ev, p, wave, playerDerived(state, p).projectileCount, hitDamage(state, p, 'v_sundering_wave', 'physical'), 'wave');
}

function aftershock(state: SimState, p: PlayerState, x: number, y: number, r: number, dmg: Big) {
  if (!has(p, 'v_aftershock')) return;
  state.hazards.push(makeHazard(state, {
    kind: 'v_aftershock', owner: 'player', ownerId: p.slot, x, y, radius: r, nextTick: state.tick + 30, untilTick: state.tick + 31,
    interval: 9999, damage: dmg.mul(B('0.6')), dtype: 'physical', generation: 1,
  }));
}

function guardSeconds(p: PlayerState, base: number) { return base + (has(p, 'v_unbreakable') ? 1 : 0); }

function startGuard(state: SimState, p: PlayerState, sec: number) {
  p.guardTimer = sec;
  p.guardMoved = false;
  p.guardAbsorbed = ZERO;
}

function bastionAt(state: SimState, p: PlayerState) {
  if (!has(p, 'v_bastion')) return;
  state.hazards = state.hazards.filter((h) => !(h.kind === 'bastion' && h.ownerId === p.slot));
  state.hazards.push(makeHazard(state, { kind: 'bastion', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 2.5, untilTick: state.tick + Math.max(1, ticks(p.guardTimer)), interval: 9999, damage: ZERO, dtype: 'physical' }));
}

function provoke(state: SimState, ev: SimEvent[], p: PlayerState) {
  if (!has(p, 'v_provoke')) return;
  const until = state.tick + ticks(3);
  for (const e of enemiesNear(state, p.x, p.y, 5)) {
    if (!e.boss) { e.targetSlot = p.slot; e.perceiveIn = ticks(3); }
    if (!(e.vulnUntil > state.tick && Number(e.vulnFactor) > 1.15)) { e.vulnUntil = until; e.vulnFactor = '1.15'; }
  }
  castEv(ev, p, 'v_provoke', p.x, p.y, 5, 0);
}

/** Standard Bearer / Valor support effects for the Rally family. */
function rallyAllies(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, r: number, rallyUntil: number, bearer = has(p, 'v_standard_bearer'), valor = has(p, 'v_valor')) {
  for (const a of state.players) {
    if (a.lifeState !== 'alive' || (a.x - x) ** 2 + (a.y - y) ** 2 > r * r) continue;
    if (rallyUntil > 0) grantRally(a, rallyUntil);
    if (bearer) shieldPlayer(state, ev, a, a.maxHp.mul(B('0.15')));
    if (valor) { healPlayer(state, ev, a, a.maxHp.mul(B('0.08'))); restoreDodge(a); }
  }
}

function rampageStacks(state: SimState, p: PlayerState): number {
  return state.tick < (p.vars.vg_rmpU ?? 0) ? (p.vars.vg_rmp ?? 0) : 0;
}

// ---------------- skills ----------------

function castSkill(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined {
  const tick = state.tick;
  switch (skillId) {
    case 'v_shield_charge': {
      if (p.guardTimer > 0) return false;
      startGuard(state, p, guardSeconds(p, 1.3));
      startDash(p, 'vg_c', p.aimX, p.aimY, 5, 0.3);
      state.hazards.push(makeHazard(state, {
        kind: 'v_charge', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, radius: 1.1,
        untilTick: tick + ticks(0.3) + 2, interval: 1, damage: hitDamage(state, p, skillId, 'physical'), dtype: 'physical',
      }));
      provoke(state, ev, p);
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'v_retaliate': {
      if (p.guardTimer > 0) return false;
      const sec = guardSeconds(p, 1.5);
      startGuard(state, p, sec);
      bastionAt(state, p);
      p.vars.vg_ret = 1;
      p.vars.vg_retAt = tick + ticks(sec);
      provoke(state, ev, p);
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'v_whirlwind': {
      startDash(p, 'vg_w', p.aimX, p.aimY, 4, 0.3);
      state.hazards.push(makeHazard(state, {
        kind: 'v_whirl', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, radius: 2,
        untilTick: tick + ticks(0.3) + 2, interval: 1, damage: ssDmg(state, p, skillId), dtype: 'physical',
      }));
      p.vars.vg_ft = 0;
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'v_executioner': {
      const skill = SKILL_BY_ID[skillId];
      if (skill.shape.kind !== 'arc') return false;
      const dmg = ssDmg(state, p, skillId);
      const ch = cosHalf(skill.shape.arcDeg);
      const R = skill.shape.range;
      for (const e of livingEnemies(state)) {
        if (!inCone(p.x, p.y, p.aimX, p.aimY, R, ch, e.x, e.y, e.radius)) continue;
        const low = !e.boss && cohortHpFrac(e.cohort) < 0.35;
        const res = hitEnemy(state, ev, e, low ? dmg.mul(B('2.5')) : dmg, ONE, {
          dtype: 'physical', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, coverage: areaCoverage(e, R), allowCrit: true,
          dot: ssDot(p), vuln: ssVuln(p), stagger: 120,
        });
        if (low) {
          castEv(ev, p, 'v_execute', e.x, e.y, p.aimX, p.aimY);
          if (!res.kills.isZero()) p.resource = Math.min(playerDerived(state, p).resourceMax, p.resource + 10);
        }
        flinch(state, e, p.x, p.y, 0.5);
      }
      sunderingWave(state, ev, p);
      p.vars.vg_ft = 0;
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'v_war_banner': {
      const [tx, ty] = aimPoint(state, p, 5, 0);
      state.hazards.push(makeHazard(state, {
        kind: 'v_banner', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 4, untilTick: tick + ticks(8), nextTick: tick + 1,
        interval: 60, damage: hitDamage(state, p, skillId, 'physical'), dtype: 'physical',
      }));
      rallyAllies(state, ev, p, tx, ty, 4, tick + 66);
      castEv(ev, p, skillId, p.x, p.y, tx, ty);
      return true;
    }
    case 'v_thunder_shout': {
      const hits = hitArea(state, ev, p.x, p.y, 5, hitDamage(state, p, skillId, 'physical'), {
        dtype: 'physical', srcSlot: p.slot, skillId, allowCrit: true, stagger: 100, vuln: { factor: '1.2', sec: 4 },
      });
      for (const { e } of hits) if (isLive(e)) knockback(state, e, p.x, p.y, 2);
      rallyAllies(state, ev, p, p.x, p.y, 5, tick + ticks(4));
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'v_earthbreaker': {
      if (!has(p, 'v_warlord_leap')) return undefined;
      const [tx, ty] = aimPoint(state, p, 6, 1);
      p.vars.vg_lT = 24; p.vars.vg_lSX = p.x; p.vars.vg_lSY = p.y; p.vars.vg_lTX = tx; p.vars.vg_lTY = ty;
      p.iframes = Math.max(p.iframes, 0.45);
      castEv(ev, p, 'v_leap', p.x, p.y, tx, ty);
      return true;
    }
  }
  return undefined;
}

function land(state: SimState, ev: SimEvent[], p: PlayerState) {
  const skill = SKILL_BY_ID['v_earthbreaker'];
  const dmg = hitDamage(state, p, 'v_earthbreaker', 'physical').mul(B('1.4'));
  const R = skill.shape.kind === 'circle' ? skill.shape.radius : 2.6;
  const hits = hitArea(state, ev, p.x, p.y, R, dmg, { dtype: 'physical', srcSlot: p.slot, skillId: 'v_earthbreaker', allowCrit: true, stagger: 160 });
  for (const { e } of hits) if (isLive(e)) knockback(state, e, p.x, p.y, skill.knockback ?? 1.6);
  castEv(ev, p, 'v_earthbreaker', p.x, p.y, p.aimX, p.aimY);
  aftershock(state, p, p.x, p.y, 2.6, hitDamage(state, p, 'v_earthbreaker', 'physical'));
}

// ---------------- hazards ----------------

function stepHazard(state: SimState, ev: SimEvent[], h: Hazard): boolean | undefined {
  const p = state.players[h.ownerId];
  switch (h.kind) {
    case 'v_charge': {
      if (!p || p.lifeState !== 'alive') { h.untilTick = state.tick; return true; }
      h.x = p.x; h.y = p.y;
      for (const e of enemiesNear(state, p.x, p.y, h.radius, h.hitSlots)) {
        h.hitSlots.push(e.id);
        hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'v_shield_charge', fromX: p.x - h.dx, fromY: p.y - h.dy, allowCrit: true, stagger: 90 });
        if (!isLive(e)) continue;
        const side = h.dx * (e.y - p.y) - h.dy * (e.x - p.x) >= 0 ? 1 : -1;
        const px = -h.dy * side, py = h.dx * side;
        knockback(state, e, e.x - px - h.dx * 0.5, e.y - py - h.dy * 0.5, 1.4);
      }
      return true;
    }
    case 'v_whirl': {
      if (!p || p.lifeState !== 'alive') { h.untilTick = state.tick; return true; }
      h.x = p.x; h.y = p.y;
      for (const e of enemiesNear(state, p.x, p.y, h.radius, h.hitSlots)) {
        h.hitSlots.push(e.id);
        hitEnemy(state, ev, e, h.damage, ONE, {
          dtype: 'physical', srcSlot: p.slot, skillId: 'v_whirlwind', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, h.radius),
          allowCrit: true, dot: ssDot(p), vuln: ssVuln(p), stagger: 40,
        });
        if (!isLive(e)) continue;
        const side = h.dx * (e.y - p.y) - h.dy * (e.x - p.x) >= 0 ? 1 : -1;   // flung to the side of the path
        pushEnemy(state, e, -h.dy * side, h.dx * side, 0.9);
      }
      return true;
    }
    case 'v_aftershock': {
      if (state.tick < h.nextTick) return true;
      h.untilTick = state.tick;
      const hits = hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'physical', srcSlot: h.ownerId, skillId: 'v_aftershock', allowCrit: false, stagger: 60, generation: 1 });
      for (const { e } of hits) if (isLive(e)) pushEnemy(state, e, e.x - h.x, e.y - h.y, 0.8);
      if (p) castEv(ev, p, 'v_aftershock', h.x, h.y, h.radius, 0);
      return true;
    }
    case 'v_banner': {
      if (state.tick < h.nextTick) return true;
      h.nextTick = state.tick + h.interval;
      for (const a of state.players) if (a.lifeState === 'alive' && (a.x - h.x) ** 2 + (a.y - h.y) ** 2 <= h.radius * h.radius) grantRally(a, state.tick + 66);
      hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'physical', srcSlot: h.ownerId, skillId: 'v_war_banner', allowCrit: false });
      return true;
    }
  }
  return undefined;
}

// ---------------- hooks ----------------

const vanguardHooks: SimHooks = {
  castSkill,
  hazardTick: stepHazard,

  basicAttack(state, ev, p, k) {
    p.vars.vg_swing = state.tick;   // Cleave Guard only answers real swings (not other sources tagged v_cleave)
    if (!has(p, 'v_rampage') || rampageStacks(state, p) < 5) return undefined;
    const skill = SKILL_BY_ID['v_cleave'];
    if (skill.shape.kind !== 'arc') return undefined;
    castEv(ev, p, 'v_cleave', p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
    const dmg = hitDamage(state, p, 'v_cleave', 'physical');
    const ch = cosHalf(skill.shape.arcDeg);
    for (const e of livingEnemies(state)) {
      if (!inCone(p.x, p.y, p.aimX, p.aimY, skill.shape.range, ch, e.x, e.y, e.radius)) continue;
      hitEnemy(state, ev, e, dmg, k, { dtype: 'physical', srcSlot: p.slot, skillId: 'v_cleave', fromX: p.x, fromY: p.y, coverage: areaCoverage(e, skill.shape.range), allowCrit: true });
      flinch(state, e, p.x, p.y, 0.16);
    }
    const wave = SKILL_BY_ID['v_sundering_wave'];
    spawnPlayerProjectiles(state, ev, p, wave, playerDerived(state, p).projectileCount, hitDamage(state, p, 'v_sundering_wave', 'physical'), 'wave');
    return true;
  },

  onCast(state, ev, p, skillId) {
    switch (skillId) {
      case 'v_guard_stance':
        if (has(p, 'v_unbreakable')) {
          p.guardTimer += 1;
          for (const h of state.hazards) if (h.kind === 'bastion' && h.ownerId === p.slot && h.bornTick === state.tick) h.untilTick += ticks(1);
        }
        provoke(state, ev, p);
        break;
      case 'v_rally_cry':
        if (has(p, 'v_valor')) rallyAllies(state, ev, p, p.x, p.y, 4, 0, false, true);   // inline Rally Cry already applied Rally and Standard Bearer
        break;
      case 'v_sweeping_strike':
        p.vars.vg_ft = 0;
        aftershock(state, p, p.x + p.aimX * 1.2, p.y + p.aimY * 1.2, 2.2, hitDamage(state, p, 'v_sweeping_strike', 'physical'));
        break;
      case 'v_executioner':
        aftershock(state, p, p.x + p.aimX * 1.5, p.y + p.aimY * 1.5, 2.2, ssDmg(state, p, 'v_executioner'));
        break;
      case 'v_earthbreaker':
        if (!has(p, 'v_warlord_leap')) aftershock(state, p, p.x, p.y, 2.6, hitDamage(state, p, 'v_earthbreaker', 'physical'));
        break;
    }
  },

  onEnemyHit(state, ev, p, e, info) {
    // Cleave Guard: once per connecting swing (grouped packets included), quietly (no per-swing shield event)
    if (p && p.classId === CID && info.skillId === 'v_cleave' && info.generation === 0 && p.vars.vg_swing === state.tick && p.vars.vg_cs !== state.tick) {
      p.vars.vg_cs = state.tick;
      addShieldQuiet(state, p, p.maxHp.mul(B(CLEAVE_SHIELD)));
    }
    if (!p || p.classId !== CID || !info.kill) return;
    // Follow Through, applied after the cast finished paying its charge (see onPlayerTick)
    if (CLEAVER.has(info.skillId ?? '') && has(p, 'v_follow_through') && !(p.vars.vg_ft ?? 0)) {
      p.vars.vg_ft = 1;
      p.vars.vg_ftRestore = 1;
    }
  },

  onKill(state, ev, e, p) {
    if (!p || p.classId !== CID || !has(p, 'v_rampage')) return;
    p.vars.vg_rmp = Math.min(5, rampageStacks(state, p) + 1);
    p.vars.vg_rmpU = state.tick + ticks(5);
  },

  onPlayerDamaged(state, ev, p, info) {
    if (p.classId !== CID || !has(p, 'v_last_stand') || p.vars.vg_ls === state.round) return;
    if (info.dealt.lt(p.hp)) return;
    p.vars.vg_ls = state.round;
    p.hp = info.dealt.add(ONE);          // hitPlayer subtracts `dealt` next: exactly 1 health remains
    p.iframes = Math.max(p.iframes, 2);
    shieldPlayer(state, ev, p, p.maxHp.mul(B('0.3')));
    castEv(ev, p, 'v_last_stand', p.x, p.y, 0, 0);
  },

  onPlayerTick(state, ev, p) {
    const tick = state.tick;
    // a gap in ticks means the Vanguard was downed: scripted movement in flight is cancelled, not resumed
    if (tick - (p.vars.vg_seen ?? tick) > 1) { p.vars.vg_cT = 0; p.vars.vg_wT = 0; p.vars.vg_lT = 0; p.vars.vg_ret = 0; }
    p.vars.vg_seen = tick;
    // Shield Charge dash; Bastion forms where it ends
    if (stepDash(state, p, 'vg_c') === 'ended' && p.guardTimer > 0) { p.guardMoved = false; bastionAt(state, p); }
    // Whirlwind dash; wave and aftershock where it ends
    if (stepDash(state, p, 'vg_w') === 'ended') {
      sunderingWave(state, ev, p);
      aftershock(state, p, p.x, p.y, 2.2, ssDmg(state, p, 'v_whirlwind'));
    }
    // Warlord's Leap
    const lt = p.vars.vg_lT ?? 0;
    if (lt > 0) {
      const t = lt - 1;
      p.vars.vg_lT = t;
      const f = 1 - t / 24;
      p.x = q(p.vars.vg_lSX + (p.vars.vg_lTX - p.vars.vg_lSX) * f);
      p.y = q(p.vars.vg_lSY + (p.vars.vg_lTY - p.vars.vg_lSY) * f);
      p.vx = 0; p.vy = 0;
      if (t === 0) land(state, ev, p);
    }
    // Retaliate detonation when the brace ends
    if ((p.vars.vg_ret ?? 0) === 1 && p.guardTimer <= 0) {
      p.vars.vg_ret = 0;
      if (tick - (p.vars.vg_retAt ?? 0) <= 30) {
        const dmg = hitDamage(state, p, 'v_retaliate', 'physical').add(p.guardAbsorbed.mul(B('1.5')));
        const hits = hitArea(state, ev, p.x, p.y, 3, dmg, { dtype: 'physical', srcSlot: p.slot, skillId: 'v_retaliate', allowCrit: true, stagger: 120 });
        for (const { e } of hits) if (isLive(e)) knockback(state, e, p.x, p.y, 1.8);
        castEv(ev, p, 'v_retaliate_blast', p.x, p.y, 3, 0);
      }
    }
    // Iron Maelstrom pulses while guarding
    if (has(p, 'v_iron_maelstrom') && p.guardTimer > 0 && tick >= (p.vars.vg_mael ?? 0)) {
      p.vars.vg_mael = tick + 30;
      const hits = hitArea(state, ev, p.x, p.y, 2.5, baseHit(state, p, 'physical').mul(B('0.6')), { dtype: 'physical', srcSlot: p.slot, skillId: 'v_iron_maelstrom', allowCrit: true, stagger: 20 });
      for (const { e } of hits) if (isLive(e)) pullToward(state, e, p.x, p.y, 0.35);
      castEv(ev, p, 'v_maelstrom', p.x, p.y, 2.5, 0);
    }
    // Follow Through restore (deferred so the cast's own charge payment does not eat it)
    if (p.vars.vg_ftRestore) {
      p.vars.vg_ftRestore = 0;
      const s = p.skills.find((x) => CLEAVER.has(x.skillId));
      if (s && s.charges < s.maxCharges) { s.charges = s.maxCharges; s.cooldown = 0; }
    }
    // Rampage: extra attack work per stack
    const stacks = rampageStacks(state, p);
    if (stacks > 0) {
      const freq = toFloatClamped(playerDerived(state, p).attackFreq, 1e6);
      if (freq < 1e5) p.attackWork += freq * DT * (Math.pow(1.1, stacks) - 1);
    }
    // Warchief: permanent Rally aura and faster Rally-skill cooldown
    if (has(p, 'v_warchief')) {
      if ((tick + p.slot) % 30 === 0) for (const a of state.players) if (a.lifeState === 'alive' && (a.x - p.x) ** 2 + (a.y - p.y) ** 2 <= 16) grantRally(a, tick + 36);
      const s = p.skills[2];
      if (s && s.skillId && s.charges < s.maxCharges) s.cooldown -= DT * toFloatClamped(playerDerived(state, p).recovery, 1e12) * 0.5;
    }
  },

  onRoundStart(state) {
    for (const p of state.players) if (p.classId === CID) { const ls = p.vars.vg_ls; clearVars(p, 'vg_'); if (ls !== undefined) p.vars.vg_ls = ls; }
  },
};

registerClassHooks(CID, vanguardHooks);
