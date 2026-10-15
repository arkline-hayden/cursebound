import { Big } from '@cursebound/numeric';
import {
  BOSS_BY_ID, CLASS_BY_ID, ENEMY_BY_ID, FATES_BLESSING, GEAR_SLOTS, LEGENDARIES, LEGENDARY_BY_ID, LOOT_RULES, NODE_BY_ID, RULES, SKILL_BY_ID, TICK_SEC,
  perkParam, type DamageType, type GearSlot, type LegendaryDef,
} from '@cursebound/content';
import { isBlessingItem, settleBlessing, stepBlessingLoot } from './blessing';
import { addDot, addStagger, applySingle, cohortHpFrac, cohortRadius, healPlayer, hitEnemy, killEnemy, shieldPlayer } from './combat';
import { refreshMaxHp } from './fate';
import { inCone, moveCircle, norm } from './geometry';
import { registerGlobalHooks, type EnemyHitInfo } from './hooks';
import { nearestFloor } from './map';
import { areaCoverage, cosHalf, knockback, livingEnemies, makeHazard } from './players';
import { nextFloat, nextInt, seedRng, type RngState } from './rng';
import { rebuildSkills } from './sim';
import { B, ONE, derivePlayer, hitDamage, playerDerived, registerGearDynamicFactor, toFloatClamped } from './stats';
import { ACTION, type EnemyState, type GroundLoot, type Hazard, type LootRecord, type PlayerState, type SimEvent, type SimState, type SkillRuntime } from './types';

// Legendary gear (content: packages/content/src/legendaries.ts): drops, ground loot, pickup / swap, equip and every
// perk. Registered as global hooks (imported by sim.ts for its side effects). Deterministic: only state, the seeded
// streams (drops: state.rng.loot; perk procs: state.rng.combat) and hook arguments. Follow-up damage is generation 1
// and perk procs only trigger from generation-0 hits, so chains stay finite. Per-player perk state lives in
// p.vars under 'lg.*' (plain numbers); per-enemy markers in e.gvars.

const DT = TICK_SEC;
const ZERO = Big.ZERO;
const ticks = (sec: number) => Math.max(1, Math.round(sec / DT));
const NEVER = Number.MAX_SAFE_INTEGER;

// ---------------- Lookups ----------------

export function gearOf(p: PlayerState): Partial<Record<GearSlot, string>> {
  return p.gear ?? (p.gear = {});
}

export function canEquip(p: PlayerState, def: LegendaryDef): boolean {
  return !def.classId || def.classId === p.classId;
}

function lootList(state: SimState): GroundLoot[] {
  return state.loot ?? (state.loot = []);
}

function lootRng(state: SimState): RngState {
  return state.rng.loot ?? (state.rng.loot = seedRng(state.seed, 'loot'));
}

/** Perk id -> equipped items carrying it (class-only items count only for their class). Cached by gear signature. */
const perkCache = new Map<string, Map<string, LegendaryDef[]>>();
function perkMap(p: PlayerState): Map<string, LegendaryDef[]> | null {
  const g = p.gear;
  if (!g) return null;
  let sig = p.classId;
  for (const s of GEAR_SLOTS) sig += '|' + (g[s] ?? '');
  let m = perkCache.get(sig);
  if (!m) {
    m = new Map();
    for (const s of GEAR_SLOTS) {
      const id = g[s];
      const def = id ? LEGENDARY_BY_ID[id] : undefined;
      if (!def || !canEquip(p, def)) continue;
      const arr = m.get(def.perk.id) ?? [];
      arr.push(def);
      m.set(def.perk.id, arr);
    }
    if (perkCache.size > 512) perkCache.clear();
    perkCache.set(sig, m);
  }
  return m;
}

function perk(p: PlayerState | undefined, id: string): LegendaryDef | undefined {
  return p ? perkMap(p)?.get(id)?.[0] : undefined;
}

function perks(p: PlayerState, id: string): LegendaryDef[] {
  return perkMap(p)?.get(id) ?? [];
}

const mag = (def: LegendaryDef) => B(def.perk.magnitude);
const magN = (def: LegendaryDef) => Number(def.perk.magnitude);

/** Hotbar slot of a skill for its class: 0..2 = branch actives (in branch order), 3 = signature, -1 = other. */
const slotMapCache = new Map<string, Map<string, number>>();
export function hotbarSlotOf(classId: string, skillId: string): number {
  let m = slotMapCache.get(classId);
  if (!m) {
    m = new Map();
    const cls = CLASS_BY_ID[classId];
    if (cls) {
      cls.branches.forEach((b, i) => {
        for (const id of cls.nodes) {
          const n = NODE_BY_ID[id];
          if (n && n.branch === b.id && n.grantsSkill && !m!.has(n.grantsSkill)) m!.set(n.grantsSkill, i);
        }
      });
      m.set(cls.signatureSkill, 3);
    }
    slotMapCache.set(classId, m);
  }
  return m.get(skillId) ?? -1;
}

function bumpDyn(p: PlayerState) {
  p.vars['lg.dv'] = ((p.vars['lg.dv'] ?? 0) + 1) % 1e9;
}

function eliteTier(e: EnemyState): number {
  const t = e.elite as unknown;
  return typeof t === 'number' ? t : t ? 1 : 0;
}

function basicDamage(state: SimState, p: PlayerState, dtype: DamageType): Big {
  return hitDamage(state, p, CLASS_BY_ID[p.classId].basicSkill, dtype);
}

// ---------------- Live stat factors (Ledger "gear" column) ----------------

registerGearDynamicFactor((p, stat) => {
  // kill-streak movement stacks
  if (stat !== 'player.movementSpeed') return null;
  const n = p.vars?.['lg.streak'] ?? 0;
  const def = n > 0 ? perk(p, 'kill_streak_speed') : undefined;
  return def ? { item: def.id, factor: mag(def).powInt(n) } : null;
});
registerGearDynamicFactor((p, stat) => {
  // low-health frenzy
  if (stat !== 'player.damage' && stat !== 'player.attackFrequency') return null;
  if (!p.vars?.['lg.low']) return null;
  const def = perk(p, 'last_stand');
  if (!def) return null;
  return { item: def.id, factor: stat === 'player.damage' ? mag(def) : B(perkParam(def, 'attack', 1)) };
});
registerGearDynamicFactor((p, stat) => {
  // Standard of the Last Stand: Rally Cry damage blessing (granted by an ally's item, so it lives in this player's vars)
  if (stat !== 'player.damage') return null;
  const f = p.vars?.['lg.banner.f'];
  return f && (p.vars['lg.banner.until'] ?? 0) > 0 ? { item: 'lg_standard_of_the_last_stand', factor: B(f) } : null;
});
registerGearDynamicFactor((p, stat) => {
  // skill damage: path sigils, signature mastery, the patient king's empowered cast
  if (!stat.startsWith('skill.') || !stat.endsWith('.damage')) return null;
  const skillId = stat.slice(6, -7);
  const skill = SKILL_BY_ID[skillId];
  if (!skill || skill.slot === 'basic') return null;
  const m = perkMap(p);
  if (!m) return null;
  const slot = hotbarSlotOf(p.classId, skillId);
  let factor = ONE;
  let item = '';
  for (const def of m.get('path_sigil') ?? []) if (slot >= 0 && slot === perkParam(def, 'slot', -1)) { factor = factor.mul(mag(def)); item = def.id; }
  if (slot === 3) for (const def of m.get('signature_mastery') ?? []) { factor = factor.mul(mag(def)); item = def.id; }
  if (p.vars['lg.emp']) for (const def of m.get('empowered_skill') ?? []) { factor = factor.mul(mag(def)); item = def.id; }
  return item ? { item, factor } : null;
});

// ---------------- Drops ----------------

/** Drop chance for one enemy death event (bosses always drop; see rollLoot). */
export function lootChance(state: SimState, e: EnemyState): number {
  if (e.boss) return 1;
  const tier = eliteTier(e);
  if (tier >= 2) return LOOT_RULES.rareChance;
  if (tier === 1) return LOOT_RULES.championChance;
  const r = Math.max(1, state.round);
  const base = Math.min(LOOT_RULES.maxChance, LOOT_RULES.baseChance * (1 + LOOT_RULES.perRound * (r - 1)));
  return e.objective ? base : base * LOOT_RULES.summonFactor;
}

function randomDropsThisRound(state: SimState): number {
  let n = 0;
  for (const f of state.lootFound ?? []) if (f.round === state.round && f.source !== 'boss') n++;
  return n;
}

/** Pick an item for the party: class-only items only for classes present; avoid items already equipped or on the ground.
 *  Fate's Blessing (blessing.ts) is one more entry in the pool, so it is exactly as likely as any single legendary. */
export function chooseLegendary(state: SimState): string | null {
  const classes = new Set(state.players.map((p) => p.classId));
  const eligible = LEGENDARIES.filter((d) => !d.classId || classes.has(d.classId));
  if (!eligible.length) return null;
  const taken = new Set<string>();
  for (const p of state.players) for (const s of GEAR_SLOTS) { const id = p.gear?.[s]; if (id) taken.add(id); }
  for (const it of state.loot ?? []) taken.add(it.itemId);
  let pool = eligible.filter((d) => !taken.has(d.id));
  if (!pool.length) pool = eligible;
  const ids = [...pool.map((d) => d.id), FATES_BLESSING.id];
  return ids[nextInt(lootRng(state), ids.length)];
}

/** Place a legendary on the ground near (x, y). */
export function dropLegendary(state: SimState, ev: SimEvent[], x: number, y: number, source: LootRecord['source'], itemId?: string): GroundLoot | null {
  const id = itemId ?? chooseLegendary(state);
  if (!id || (!LEGENDARY_BY_ID[id] && !isBlessingItem(id))) return null;
  const rng = lootRng(state);
  const ang = nextFloat(rng) * Math.PI * 2;
  const r = 0.3 + nextFloat(rng) * 0.5;
  let px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
  if (state.map) [px, py] = nearestFloor(state.map, px, py);
  const it: GroundLoot = { id: state.nextId++, itemId: id, x: Math.round(px * 1000) / 1000, y: Math.round(py * 1000) / 1000, bornTick: state.tick };
  const loot = lootList(state);
  loot.push(it);
  if (loot.length > LOOT_RULES.maxGround) loot.splice(0, loot.length - LOOT_RULES.maxGround);
  const found = state.lootFound ?? (state.lootFound = []);
  found.push({ itemId: id, round: state.round, source });
  if (found.length > 64) found.splice(0, found.length - 64);
  ev.push({ t: 'loot', id: it.id, itemId: id, x: it.x, y: it.y, src: source });
  ev.push({ t: 'domain', type: 'legendary_dropped', payload: { round: state.round, itemId: id, source } });
  return it;
}

/** Drop roll for an enemy death event (one roll per event; the roll is always drawn so later drops stay stable). */
export function rollLoot(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (state.phase !== 'COMBAT') return;
  if (e.boss) {
    if (e.summonerId !== null) return;   // a boss's echo (bosses/corruptCore.ts mirror split) carries no loot
    // the boss's signature legendary (BossDef.loot) first, while nobody wears it and none lies on the ground
    const sig = BOSS_BY_ID[e.kind]?.loot;
    const taken = !!sig && (state.players.some((p) => Object.values(p.gear ?? {}).includes(sig)) || (state.loot ?? []).some((it) => it.itemId === sig));
    for (let i = 0; i < LOOT_RULES.bossDrops; i++) dropLegendary(state, ev, e.x, e.y, 'boss', i === 0 && sig && !taken ? sig : undefined);
    return;
  }
  const roll = nextFloat(lootRng(state));
  if (roll >= lootChance(state, e)) return;
  if (randomDropsThisRound(state) >= LOOT_RULES.maxDropsPerRound) return;
  dropLegendary(state, ev, e.x, e.y, eliteTier(e) > 0 ? 'elite' : 'enemy');
}

// ---------------- Equip, pickup, swap ----------------

function clearPerkVars(p: PlayerState, perkId: string) {
  const keys: Record<string, string[]> = {
    fifth_shockwave: ['lg.basic'], crit_lightning: ['lg.crit.t'], empowered_skill: ['lg.emp', 'lg.emp.next'], kill_streak_speed: ['lg.streak', 'lg.streak.until'],
    bell_toll: ['lg.bell.next'], thorns_nova: ['lg.thorn.t'], orbiting_blades: ['lg.orb.next'], healing_aura: ['lg.aura.next'], gravity_well: ['lg.well.next'],
    last_stand: ['lg.low'], life_leech: ['lg.leech.t'], arc_thunderclap: ['lg.arc'], aegis_release: ['lg.guard'],
  };
  for (const k of keys[perkId] ?? []) delete p.vars[k];
}

/** Equip an item (replacing the slot's current item, which is returned). Refreshes stats, max health and charges. */
export function equipLegendary(state: SimState, ev: SimEvent[], p: PlayerState, itemId: string): string | undefined {
  const def = LEGENDARY_BY_ID[itemId];
  if (!def) return undefined;
  const gear = gearOf(p);
  const old = gear[def.slot];
  const oldDef = old ? LEGENDARY_BY_ID[old] : undefined;
  const beforeMax = p.maxHp;
  p.gear = { ...gear, [def.slot]: itemId };     // new object: equips never mutate a shared map in place
  if (oldDef && oldDef.perk.id !== def.perk.id) clearPerkVars(p, oldDef.perk.id);
  bumpDyn(p);
  state.stateVersion++;
  const after = derivePlayer(state, p);
  refreshMaxHp(p, beforeMax, after.maxHp);
  rebuildSkills(p);
  for (const s of p.skills) if (s.charges < 0) s.charges = 0;
  if (def.perk.id === 'empowered_skill') p.vars['lg.emp'] = 1;
  ev.push({ t: 'equip', slot: p.slot, gs: def.slot, itemId, ...(old ? { replaced: old } : {}), x: p.x, y: p.y });
  ev.push({ t: 'domain', type: 'legendary_equipped', payload: { round: state.round, slot: p.slot, itemId, replaced: old ?? null } });
  return old;
}

/** Ground items this player could swap into an occupied slot (in range, wearable, not the identical item), nearest first. */
export function swappableLoot(state: SimState, p: PlayerState): GroundLoot | null {
  let best: GroundLoot | null = null;
  let bd = LOOT_RULES.pickupRange ** 2;
  for (const it of state.loot ?? []) {
    const def = LEGENDARY_BY_ID[it.itemId];
    if (!def || !canEquip(p, def)) continue;
    const cur = p.gear?.[def.slot];
    if (!cur || cur === it.itemId) continue;
    const d2 = (p.x - it.x) ** 2 + (p.y - it.y) ** 2;
    if (d2 <= bd) { bd = d2; best = it; }
  }
  return best;
}

/** Per tick: walk-over auto-equip into empty slots; Interact (edge) swaps the nearest occupied-slot item. */
export function stepLoot(state: SimState, ev: SimEvent[]) {
  const edges = state.players.map((p) => {
    const cur = p.lifeState === 'alive' && (p.prevButtons & ACTION.INTERACT) !== 0;
    const prev = !!p.vars['lg.int'];
    if (cur) p.vars['lg.int'] = 1; else if (prev) delete p.vars['lg.int'];
    return cur && !prev;
  });
  const loot = state.loot;
  if (!loot?.length) return;
  const delay = ticks(LOOT_RULES.pickupDelaySec);
  const R2 = LOOT_RULES.pickupRange ** 2;
  const acted = new Set<number>();
  const dropped: GroundLoot[] = [];
  const keep: GroundLoot[] = [];
  const swapTarget = state.players.map((p) => (edges[p.slot] ? swappableLoot(state, p) : null));
  for (const it of loot) {
    if (isBlessingItem(it.itemId)) { if (!stepBlessingLoot(state, ev, it, delay)) keep.push(it); continue; }   // into a pack (blessing.ts)
    const def = LEGENDARY_BY_ID[it.itemId];
    if (!def) continue;
    if (it.carry || state.tick - it.bornTick < delay) { keep.push(it); continue; }
    const cands = state.players
      .filter((p) => p.lifeState === 'alive' && !acted.has(p.slot) && canEquip(p, def) && (p.x - it.x) ** 2 + (p.y - it.y) ** 2 <= R2)
      .sort((a, b) => ((a.x - it.x) ** 2 + (a.y - it.y) ** 2) - ((b.x - it.x) ** 2 + (b.y - it.y) ** 2) || a.slot - b.slot);
    let taken = false;
    for (const p of cands) {
      if (gearOf(p)[def.slot]) continue;
      equipLegendary(state, ev, p, def.id);
      acted.add(p.slot);
      taken = true;
      break;
    }
    if (!taken) for (const p of cands) {
      if (swapTarget[p.slot] !== it) continue;
      const old = equipLegendary(state, ev, p, def.id);
      acted.add(p.slot);
      taken = true;
      if (old && LEGENDARY_BY_ID[old]) {
        // the replaced item drops at the hero's feet (a fresh pop delay, so it is not instantly re-taken)
        let fx = p.x - p.aimX * 0.35, fy = p.y - p.aimY * 0.35;
        if (state.map) [fx, fy] = nearestFloor(state.map, fx, fy);
        const back: GroundLoot = { id: state.nextId++, itemId: old, x: Math.round(fx * 1000) / 1000, y: Math.round(fy * 1000) / 1000, bornTick: state.tick };
        dropped.push(back);
        ev.push({ t: 'loot', id: back.id, itemId: old, x: back.x, y: back.y, src: 'carry' });
      }
      break;
    }
    if (!taken) keep.push(it);
  }
  state.loot = keep.concat(dropped);
}

/** Round clear: unclaimed items go to the nearest member with an open slot; the rest carry into the next round. */
export function settleLoot(state: SimState, ev: SimEvent[]) {
  const loot = state.loot;
  if (!loot?.length) return;
  const keep: GroundLoot[] = [];
  for (const it of loot) {
    if (isBlessingItem(it.itemId)) { if (!settleBlessing(state, ev, it)) keep.push({ ...it, carry: true }); continue; }
    const def = LEGENDARY_BY_ID[it.itemId];
    if (!def) continue;
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const p of state.players) {
      if (!canEquip(p, def) || gearOf(p)[def.slot]) continue;
      const d2 = (p.x - it.x) ** 2 + (p.y - it.y) ** 2;
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (best) equipLegendary(state, ev, best, def.id);
    else keep.push({ ...it, carry: true });
  }
  state.loot = keep;
}

/** Carried items reappear around the party when the next round's combat begins. */
function placeCarried(state: SimState, ev: SimEvent[]) {
  const carried = (state.loot ?? []).filter((x) => x.carry);
  if (!carried.length) return;
  const alive = state.players.filter((p) => p.lifeState === 'alive');
  const ref = alive.length ? alive : state.players;
  const cx = ref.reduce((s, p) => s + p.x, 0) / ref.length, cy = ref.reduce((s, p) => s + p.y, 0) / ref.length;
  carried.forEach((it, i) => {
    const a = 0.6 + (i / carried.length) * Math.PI * 2;
    let x = cx + Math.cos(a) * 1.6, y = cy + Math.sin(a) * 1.6;
    if (state.map) [x, y] = nearestFloor(state.map, x, y);
    it.x = Math.round(x * 1000) / 1000; it.y = Math.round(y * 1000) / 1000;
    it.bornTick = state.tick;
    delete it.carry;
    ev.push({ t: 'loot', id: it.id, itemId: it.itemId, x: it.x, y: it.y, src: 'carry' });
  });
}

// ---------------- Perk helpers ----------------

/** Extra damage that is already a final amount (post mitigation): applied straight to the cohort (enemy shields absorb first). */
function bonusDamage(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, amount: Big, dtype: DamageType) {
  if (e.state === 'dying' || e.cohort.count.isZero() || amount.isZero()) return;
  let a = amount;
  if (!e.shield.isZero() && e.shieldUntil > state.tick) {
    if (e.shield.gte(a)) { e.shield = e.shield.sub(a); return; }
    a = a.sub(e.shield);
    e.shield = ZERO;
  }
  const r = applySingle(e.cohort, a, ONE);
  if (r.dealt.isZero() && r.kills.isZero()) return;
  p.stats.damageDealt = p.stats.damageDealt.add(r.dealt);
  p.dpsBucket = p.dpsBucket.add(r.dealt);
  const dead = e.cohort.count.isZero();
  ev.push({ t: 'hit', target: e.id, targetKind: 'enemy', amount: r.dealt.toCompact(), crit: false, dtype, x: e.x, y: e.y, kill: dead || !r.kills.isZero(), src: p.slot });
  if (dead) killEnemy(state, ev, e, p.slot, dtype);
  else if (!r.kills.isZero()) {
    const base = e.boss ? BOSS_BY_ID[e.kind]?.radius : ENEMY_BY_ID[e.kind]?.radius;
    if (base) e.radius = cohortRadius(base, e.cohort.count);
  }
}

function stun(state: SimState, ev: SimEvent[], e: EnemyState, sec: number) {
  if (e.state === 'dying') return;
  if (e.boss) { addStagger(state, ev, e, 60); return; }
  const d = e.ccResistUntil > state.tick ? sec * 0.3 : sec;
  e.staggerUntil = Math.max(e.staggerUntil, state.tick + ticks(d));
  e.attack = null;
  e.state = 'stagger';
  e.vx = 0; e.vy = 0;
  e.ccResistUntil = state.tick + ticks(RULES.crowdControlResistSec);
}

function chill(state: SimState, e: EnemyState, slow: number, sec: number) {
  const g = e.gvars ?? (e.gvars = {});
  if (!g.chillF) {
    const f = 1 - Math.min(0.9, Math.max(0, slow));
    e.moveSpeed *= f;
    g.chillF = f;
  }
  g.chillUntil = Math.max(g.chillUntil ?? 0, state.tick + ticks(sec));
}

function unchill(e: EnemyState) {
  const g = e.gvars;
  if (!g?.chillF) return;
  e.moveSpeed /= g.chillF;
  delete g.chillF;
  delete g.chillUntil;
}

interface NovaOpts { knock?: number; stun?: number; dot?: { type: DamageType; fractionPerSec: string; durationSec: number }; skip?: number }

/** Area burst of generation-1 damage around (x, y). */
function nova(state: SimState, ev: SimEvent[], p: PlayerState, perkId: string, x: number, y: number, radius: number, perHit: Big, dtype: DamageType, o: NovaOpts = {}) {
  for (const e of livingEnemies(state)) {
    if (e.id === o.skip) continue;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 > (radius + e.radius) ** 2) continue;
    hitEnemy(state, ev, e, perHit, ONE, { dtype, srcSlot: p.slot, skillId: `lg_${perkId}`, fromX: x, fromY: y, coverage: areaCoverage(e, radius), allowCrit: true, generation: 1, dot: o.dot });
    if (o.knock) knockback(state, e, x, y, o.knock);
    if (o.stun) stun(state, ev, e, o.stun);
  }
  ev.push({ t: 'perk', slot: p.slot, perk: perkId, x, y, r: radius });
}

/** Advance a skill's recharge by `sec` seconds (the same charge rules as the player step). */
function advanceCooldown(s: SkillRuntime, sec: number) {
  if (!s.skillId || s.charges >= s.maxCharges || !(sec > 0)) return;
  const base = SKILL_BY_ID[s.skillId]?.cooldownSec ?? 0;
  if (base <= 0) { s.charges = s.maxCharges; s.cooldown = 0; return; }
  s.cooldown -= sec;
  while (s.cooldown <= 0 && s.charges < s.maxCharges) {
    s.charges++;
    if (s.charges < s.maxCharges) s.cooldown += base; else s.cooldown = 0;
  }
}

function signatureId(p: PlayerState): string {
  return CLASS_BY_ID[p.classId]?.signatureSkill ?? '';
}

function delayed(state: SimState, p: PlayerState, kind: string, x: number, y: number, delaySec: number, radius: number, damage: Big, dtype: DamageType, extra: Partial<Hazard> = {}) {
  const at = state.tick + ticks(delaySec);
  state.hazards.push(makeHazard(state, { kind, owner: 'player', ownerId: p.slot, x, y, radius, nextTick: at, untilTick: at + 1, interval: NEVER, damage, dtype, generation: 1, ...extra }));
}

let exploding = false;   // transient re-entrancy guard (pyre explosions killing burning foes do not explode again)

function onKillPerks(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState | null) {
  const m = perkMap(p);
  if (!m) return;
  const heal = m.get('kill_heal')?.[0];
  if (heal && p.lifeState === 'alive') healPlayer(state, ev, p, p.maxHp.mul(mag(heal)));
  const streak = m.get('kill_streak_speed')?.[0];
  if (streak && p.lifeState === 'alive') {
    const max = perkParam(streak, 'stacks', 5);
    p.vars['lg.streak'] = Math.min(max, (p.vars['lg.streak'] ?? 0) + 1);
    p.vars['lg.streak.until'] = state.tick + ticks(perkParam(streak, 'duration', 4));
    bumpDyn(p);
  }
  if (!e) return;
  const pyre = m.get('pyre_explosion')?.[0];
  if (pyre && e.burning && !exploding) {
    exploding = true;
    try { nova(state, ev, p, 'pyre_explosion', e.x, e.y, perkParam(pyre, 'radius', 2), basicDamage(state, p, 'ember').mul(mag(pyre)), 'ember', { skip: e.id }); }
    finally { exploding = false; }
  }
  const plague = m.get('plague_spread')?.[0];
  if (plague && e.dots.length) {
    const R = perkParam(plague, 'radius', 3);
    const n = perkParam(plague, 'targets', 3);
    const live = livingEnemies(state).filter((o) => o.id !== e.id && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= (R + o.radius) ** 2)
      .sort((a, b) => ((a.x - e.x) ** 2 + (a.y - e.y) ** 2) - ((b.x - e.x) ** 2 + (b.y - e.y) ** 2) || a.id - b.id)
      .slice(0, n);
    const f = mag(plague);
    for (const t of live) {
      for (const d of e.dots) {
        if (d.until <= state.tick) continue;
        addDot(state, t, d.src, d.type, d.perSec.mul(f), (d.until - state.tick) * DT);
      }
      ev.push({ t: 'perk', slot: p.slot, perk: 'plague_spread', x: e.x, y: e.y, tx: t.x, ty: t.y });
    }
  }
}

// ---------------- Hooks ----------------

registerGlobalHooks({
  extraCharges(p, skillId) {
    if (!p.gear) return 0;
    const slot = hotbarSlotOf(p.classId, skillId);
    if (slot < 0) return 0;
    let n = 0;
    for (const def of perks(p, 'path_sigil')) if (perkParam(def, 'slot', -1) === slot) n += Math.max(0, Math.round(perkParam(def, 'charges', 1)));
    return n;
  },

  onRoundStart(state, ev) {
    if (!state.loot) state.loot = [];
    for (const p of state.players) {
      if (p.vars['lg.banner.until'] !== undefined) { delete p.vars['lg.banner.until']; delete p.vars['lg.banner.f']; bumpDyn(p); }
      if (!p.gear || !GEAR_SLOTS.some((s) => p.gear![s])) continue;   // gearless heroes are untouched
      for (const k of ['lg.cheat', 'lg.streak', 'lg.streak.until', 'lg.low', 'lg.guard', 'lg.arc', 'lg.basic']) delete p.vars[k];
      if (perk(p, 'empowered_skill')) p.vars['lg.emp'] = 1;
      const soon = state.tick + ticks(2);
      if (perk(p, 'bell_toll')) p.vars['lg.bell.next'] = soon;
      if (perk(p, 'gravity_well')) p.vars['lg.well.next'] = soon;
      bumpDyn(p);
    }
    placeCarried(state, ev);
  },

  onTick(state, ev) {
    stepLoot(state, ev);
    // chill expiry
    for (const e of state.enemies) if (e.gvars?.chillF && (e.gvars.chillUntil ?? 0) <= state.tick) unchill(e);
    // potions (pickups.ts emits 'pickup' events earlier this tick)
    let potionPerk = false;
    for (const p of state.players) if (p.gear && perk(p, 'potion_plus')) { potionPerk = true; break; }
    if (potionPerk) {
      for (const e of ev) {
        if (e.t !== 'pickup' || e.kind !== 'potion') continue;
        const p = state.players[e.slot];
        const def = perk(p, 'potion_plus');
        if (!p || !def || p.lifeState !== 'alive') continue;
        const heal = p.maxHp.mul(B(RULES.potionHealFrac));
        healPlayer(state, ev, p, heal.mul(mag(def)));
        shieldPlayer(state, ev, p, heal.mul(ONE.add(mag(def))).mul(B(perkParam(def, 'shield', 0.5))));
        ev.push({ t: 'perk', slot: p.slot, perk: 'potion_plus', x: p.x, y: p.y });
      }
    }
  },

  hazardTick(state, ev, h) {
    if (!h.kind.startsWith('lg_')) return undefined;
    if (state.tick < h.nextTick) return true;
    h.nextTick = NEVER;
    const p = state.players[h.ownerId];
    if (!p) return true;
    if (h.kind === 'lg_shade') nova(state, ev, p, 'dodge_shade', h.x, h.y, h.radius, h.damage, h.dtype);
    else if (h.kind === 'lg_meteor') nova(state, ev, p, 'signature_meteor', h.x, h.y, h.radius, h.damage, h.dtype, { dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 }, knock: 0.5 });
    else if (h.kind === 'lg_phantom') {
      const alive = p.lifeState === 'alive';
      const ox = alive ? p.x : h.x, oy = alive ? p.y : h.y;
      const dx = alive ? p.aimX : h.dx, dy = alive ? p.aimY : h.dy;
      const ch = cosHalf(h.inner || 150);
      for (const e of livingEnemies(state)) {
        if (!inCone(ox, oy, dx, dy, h.radius, ch, e.x, e.y, e.radius)) continue;
        hitEnemy(state, ev, e, h.damage, ONE, { dtype: h.dtype, srcSlot: p.slot, skillId: 'lg_phantom_sweep', fromX: ox, fromY: oy, coverage: areaCoverage(e, h.radius), allowCrit: true, generation: 1 });
      }
      ev.push({ t: 'perk', slot: p.slot, perk: 'phantom_sweep', x: ox, y: oy, tx: ox + dx * h.radius, ty: oy + dy * h.radius, r: h.radius });
    }
    return true;
  },

  onDodge(state, ev, p) {
    const m = perkMap(p);
    if (!m) return;
    const shade = m.get('dodge_shade')?.[0];
    if (shade) {
      delayed(state, p, 'lg_shade', p.x, p.y, perkParam(shade, 'delay', 0.8), perkParam(shade, 'radius', 2.2), basicDamage(state, p, 'astral').mul(mag(shade)), 'astral');
    }
    const ward = m.get('dodge_ward')?.[0];
    if (ward) {
      shieldPlayer(state, ev, p, p.maxHp.mul(mag(ward)));
      p.iframes += perkParam(ward, 'iframes', 0.25);
      ev.push({ t: 'perk', slot: p.slot, perk: 'dodge_ward', x: p.x, y: p.y });
    }
  },

  onCast(state, ev, p, skillId) {
    const m = perkMap(p);
    if (!m) return;
    const sig = skillId === signatureId(p);
    // the patient king: the empowered cast is spent (its damage was snapshotted during the cast)
    const emp = m.get('empowered_skill')?.[0];
    if (emp && p.vars['lg.emp']) {
      delete p.vars['lg.emp'];
      p.vars['lg.emp.next'] = state.tick + ticks(perkParam(emp, 'period', 10));
      ev.push({ t: 'perk', slot: p.slot, perk: 'empowered_skill', x: p.x, y: p.y });
    }
    const free = m.get('free_charge')?.[0];
    if (free && nextFloat(state.rng.combat) < magN(free)) {
      const s = p.skills.find((x) => x.skillId === skillId);
      if (s && s.charges < s.maxCharges) {
        s.charges++;
        if (s.charges >= s.maxCharges) s.cooldown = 0;
        ev.push({ t: 'perk', slot: p.slot, perk: 'free_charge', x: p.x, y: p.y });
      }
    }
    if (sig) {
      const meteor = m.get('signature_meteor')?.[0];
      if (meteor && state.map) {
        const reach = Math.min(8, Math.max(1, p.aimDist || 4));
        const [tx, ty] = nearestFloor(state.map, p.x + p.aimX * reach, p.y + p.aimY * reach);
        const R = perkParam(meteor, 'radius', 2.4);
        delayed(state, p, 'lg_meteor', tx, ty, perkParam(meteor, 'delay', 0.6), R, basicDamage(state, p, 'ember').mul(mag(meteor)), 'ember');
        ev.push({ t: 'perk', slot: p.slot, perk: 'meteor_call', x: p.x, y: p.y, tx, ty, r: R });
      }
      const refresh = m.get('signature_refresh')?.[0];
      if (refresh) {
        for (const s of p.skills) if (s.skillId && s.skillId !== skillId) advanceCooldown(s, magN(refresh));
        ev.push({ t: 'perk', slot: p.slot, perk: 'signature_refresh', x: p.x, y: p.y });
      }
    }
    // class items
    if (skillId === 'v_sweeping_strike') {
      const ph = m.get('phantom_sweep')?.[0];
      const sk = SKILL_BY_ID[skillId];
      if (ph && sk && sk.shape.kind === 'arc') {
        delayed(state, p, 'lg_phantom', p.x, p.y, perkParam(ph, 'delay', 0.25), sk.shape.range, hitDamage(state, p, skillId, 'physical').mul(mag(ph)), 'physical', { dx: p.aimX, dy: p.aimY, inner: sk.shape.arcDeg });
      }
    } else if (skillId === 'v_rally_cry') {
      const ban = m.get('last_stand_banner')?.[0];
      if (ban) {
        const until = state.tick + ticks(6);
        for (const a of state.players) {
          if (a.lifeState !== 'alive' || (a.x - p.x) ** 2 + (a.y - p.y) ** 2 > 16) continue;
          healPlayer(state, ev, a, a.maxHp.mul(B(perkParam(ban, 'heal', 0.12))));
          a.vars['lg.banner.f'] = magN(ban);
          a.vars['lg.banner.until'] = until;
          bumpDyn(a);
        }
        ev.push({ t: 'perk', slot: p.slot, perk: 'last_stand_banner', x: p.x, y: p.y, r: 4 });
      }
    } else if (skillId === 'a_fireline') {
      const fl = m.get('fireline_extend')?.[0];
      if (fl) for (const h of state.hazards) if (h.kind === 'fireline' && h.owner === 'player' && h.ownerId === p.slot && h.bornTick === state.tick) h.untilTick += ticks(magN(fl));
    } else if (skillId === 'a_arc_bolt') {
      const tc = m.get('arc_thunderclap')?.[0];
      const id = p.vars['lg.arc'];
      delete p.vars['lg.arc'];
      const t = tc && id !== undefined ? state.enemies.find((e) => e.id === id) : undefined;
      if (tc && t) nova(state, ev, p, 'arc_thunderclap', t.x, t.y, perkParam(tc, 'radius', 2), hitDamage(state, p, skillId, 'storm').mul(mag(tc)), 'storm');
    } else if (skillId === 'a_phase_step') {
      const pb = m.get('phase_burst')?.[0];
      if (pb) {
        nova(state, ev, p, 'phase_burst', p.x, p.y, perkParam(pb, 'radius', 2.2), basicDamage(state, p, 'astral').mul(mag(pb)), 'astral');
        p.iframes = Math.max(p.iframes, perkParam(pb, 'iframes', 0.5));
      }
    }
  },

  onEnemyHit(state, ev, p, e, info: EnemyHitInfo) {
    if (!p || !p.gear || info.generation >= 1) return;
    const m = perkMap(p);
    if (!m || !m.size) return;
    if (info.skillId === 'a_arc_bolt' && m.has('arc_thunderclap')) p.vars['lg.arc'] = e.id;
    if (info.kill && !e.cohort.count.isZero()) onKillPerks(state, ev, p, null);   // partial cohort kill (a full death goes through onKill)
    const alive = !e.cohort.count.isZero() && e.state !== 'dying';
    if (info.crit) {
      const ltn = m.get('crit_lightning')?.[0];
      if (ltn && state.tick >= (p.vars['lg.crit.t'] ?? 0)) {
        p.vars['lg.crit.t'] = state.tick + ticks(perkParam(ltn, 'icd', 0.4));
        const amount = info.dealt.mul(mag(ltn));
        const R = perkParam(ltn, 'radius', 1.4);
        const half = amount.mul(B('0.5'));
        for (const o of livingEnemies(state)) {
          if (o === e || (o.x - e.x) ** 2 + (o.y - e.y) ** 2 > (R + o.radius) ** 2) continue;
          bonusDamage(state, ev, p, o, half, 'storm');
        }
        if (alive) bonusDamage(state, ev, p, e, amount, 'storm');
        ev.push({ t: 'perk', slot: p.slot, perk: 'crit_lightning', x: e.x, y: e.y, r: R });
      }
      const pyre = m.get('pyre_explosion')?.[0];
      if (pyre && alive) addDot(state, e, p.slot, 'ember', info.dealt.mul(B(perkParam(pyre, 'ignite', 0.3))), perkParam(pyre, 'igniteSec', 3));
    }
    if (!alive) {
      const leech0 = m.get('life_leech')?.[0];
      if (leech0) leech(state, ev, p, leech0, info.dealt);
      return;
    }
    const cold = m.get('hits_chill')?.[0];
    if (cold) {
      if (e.gvars?.chillF) bonusDamage(state, ev, p, e, info.dealt.mul(B(perkParam(cold, 'bonus', 0.15))), 'frost');
      if (!e.cohort.count.isZero()) chill(state, e, magN(cold), perkParam(cold, 'duration', 1.5));
    }
    const slayer = m.get('elite_slayer')?.[0];
    if (slayer && (e.boss || eliteTier(e) > 0)) bonusDamage(state, ev, p, e, info.dealt.mul(mag(slayer).sub(ONE)), info.dtype);
    const exe = m.get('execute')?.[0];
    if (exe && !e.cohort.count.isZero() && cohortHpFrac(e.cohort) < perkParam(exe, 'threshold', 0.25)) bonusDamage(state, ev, p, e, info.dealt.mul(mag(exe).sub(ONE)), info.dtype);
    const lee = m.get('life_leech')?.[0];
    if (lee) leech(state, ev, p, lee, info.dealt);
  },

  onKill(state, ev, e, p) {
    rollLoot(state, ev, e);
    if (p && p.gear) onKillPerks(state, ev, p, e);
  },

  onPlayerDamaged(state, ev, p, info) {
    const m = perkMap(p);
    if (!m) return;
    const vow = m.get('cheat_death')?.[0];
    if (vow && !p.vars['lg.cheat'] && info.dealt.gte(p.hp)) {
      // the core subtracts `dealt` right after this hook: leave the hero at the vow's health fraction instead of downed
      p.vars['lg.cheat'] = 1;
      p.hp = info.dealt.add(p.maxHp.mul(mag(vow)));
      p.iframes = Math.max(p.iframes, perkParam(vow, 'iframes', 1.5));
      ev.push({ t: 'perk', slot: p.slot, perk: 'cheat_death', x: p.x, y: p.y });
    }
    const thorns = m.get('thorns_nova')?.[0];
    if (thorns && state.tick >= (p.vars['lg.thorn.t'] ?? 0)) {
      p.vars['lg.thorn.t'] = state.tick + ticks(perkParam(thorns, 'icd', 1));
      nova(state, ev, p, 'thorns_nova', p.x, p.y, perkParam(thorns, 'radius', 2.5), basicDamage(state, p, 'physical').mul(mag(thorns)), 'physical');
    }
  },

  onBasicAttack(state, ev, p) {
    const shock = perkMap(p)?.get('fifth_shockwave')?.[0];
    if (!shock) return;
    const n = (p.vars['lg.basic'] ?? 0) + 1;
    if (n >= Math.max(1, perkParam(shock, 'every', 5))) {
      p.vars['lg.basic'] = 0;
      nova(state, ev, p, 'fifth_shockwave', p.x, p.y, perkParam(shock, 'radius', 2.5), basicDamage(state, p, 'physical').mul(mag(shock)), 'physical', { knock: 0.6 });
    } else p.vars['lg.basic'] = n;
  },

  onPlayerTick(state, ev, p) {
    // timed blessings granted by allies expire even when this hero has no gear
    if (p.vars['lg.banner.until'] !== undefined && state.tick >= p.vars['lg.banner.until']) {
      delete p.vars['lg.banner.until']; delete p.vars['lg.banner.f']; bumpDyn(p);
    }
    const m = perkMap(p);
    if (!m || !m.size) return;
    const t = state.tick;
    const emp = m.get('empowered_skill')?.[0];
    if (emp && !p.vars['lg.emp'] && t >= (p.vars['lg.emp.next'] ?? 0)) {
      p.vars['lg.emp'] = 1;
      ev.push({ t: 'perk', slot: p.slot, perk: 'empowered_ready', x: p.x, y: p.y });
    }
    if (p.vars['lg.streak'] && t >= (p.vars['lg.streak.until'] ?? 0)) { delete p.vars['lg.streak']; delete p.vars['lg.streak.until']; bumpDyn(p); }
    const bell = m.get('bell_toll')?.[0];
    if (bell && t >= (p.vars['lg.bell.next'] ?? 0)) {
      p.vars['lg.bell.next'] = t + ticks(perkParam(bell, 'period', 6));
      nova(state, ev, p, 'bell_toll', p.x, p.y, perkParam(bell, 'radius', 3.5), basicDamage(state, p, 'physical').mul(mag(bell)), 'physical', { stun: perkParam(bell, 'stun', 1) });
    }
    const well = m.get('gravity_well')?.[0];
    if (well && t >= (p.vars['lg.well.next'] ?? 0)) {
      p.vars['lg.well.next'] = t + ticks(perkParam(well, 'period', 8));
      const R = perkParam(well, 'radius', 5), pull = perkParam(well, 'pull', 1.5);
      for (const e of livingEnemies(state)) {
        const d = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2);
        if (d > R + e.radius || e.boss || !state.map) continue;
        const step = Math.min(pull, Math.max(0, d - 0.9));
        if (step <= 0) continue;
        const [nx, ny] = norm(p.x - e.x, p.y - e.y);
        const r = moveCircle(state.map, e.x, e.y, nx * step, ny * step, Math.min(e.radius, 0.6));
        e.x = r.x; e.y = r.y;
      }
      nova(state, ev, p, 'gravity_well', p.x, p.y, R, basicDamage(state, p, 'astral').mul(mag(well)), 'astral');
    }
    const blades = m.get('orbiting_blades')?.[0];
    if (blades && t >= (p.vars['lg.orb.next'] ?? 0)) {
      p.vars['lg.orb.next'] = t + ticks(perkParam(blades, 'interval', 0.5));
      const R = perkParam(blades, 'radius', 1.8);
      if (livingEnemies(state).some((e) => (e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= (R + e.radius) ** 2)) {
        nova(state, ev, p, 'orbiting_blades', p.x, p.y, R, basicDamage(state, p, 'physical').mul(mag(blades)), 'physical');
      }
    }
    const aura = m.get('healing_aura')?.[0];
    if (aura && t >= (p.vars['lg.aura.next'] ?? 0)) {
      p.vars['lg.aura.next'] = t + ticks(1);
      const R2 = perkParam(aura, 'radius', 4) ** 2;
      for (const a of state.players) {
        if (a.lifeState !== 'alive' || a.hp.gte(a.maxHp) || (a.x - p.x) ** 2 + (a.y - p.y) ** 2 > R2) continue;
        healPlayer(state, ev, a, a.maxHp.mul(mag(aura)));
      }
    }
    const wolf = m.get('last_stand')?.[0];
    if (wolf) {
      const low = !p.maxHp.isZero() && p.hp.ratio(p.maxHp) < perkParam(wolf, 'threshold', 0.35);
      if (low !== !!p.vars['lg.low']) {
        if (low) p.vars['lg.low'] = 1; else delete p.vars['lg.low'];
        bumpDyn(p);
      }
    }
    const crown = m.get('signature_mastery')?.[0];
    if (crown) {
      const s = p.skills[p.skills.length - 1];
      if (s && s.skillId === signatureId(p) && s.charges < s.maxCharges) {
        const rec = toFloatClamped(playerDerived(state, p).recovery, 1e12);
        advanceCooldown(s, DT * rec * Math.max(0, perkParam(crown, 'recovery', 1.35) - 1));
      }
    }
    const mirror = m.get('mirror_projectiles')?.[0];
    if (mirror) {
      const fresh = state.projectiles.filter((pr) => pr.owner === 'player' && pr.ownerId === p.slot && pr.bornTick === t).slice(0, 7);
      const f = mag(mirror);
      for (const pr of fresh) {
        state.projectiles.push({
          ...pr, id: state.nextId++, x: 2 * p.x - pr.x, y: 2 * p.y - pr.y, vx: -pr.vx, vy: -pr.vy, damage: pr.damage.mul(f), hitIds: [], lobTarget: null,
        });
      }
    }
    const aegis = m.get('aegis_release')?.[0];
    if (aegis) {
      const guarding = p.guardTimer > 0;
      if (!guarding && p.vars['lg.guard'] && !p.guardAbsorbed.isZero()) {
        const R = perkParam(aegis, 'radius', 3);
        nova(state, ev, p, 'aegis_release', p.x, p.y, R, p.guardAbsorbed.mul(mag(aegis)), 'physical', { knock: perkParam(aegis, 'knockback', 1.2) });
      }
      if (guarding) p.vars['lg.guard'] = 1; else delete p.vars['lg.guard'];
    }
  },
});

function leech(state: SimState, ev: SimEvent[], p: PlayerState, def: LegendaryDef, dealt: Big) {
  if (p.lifeState !== 'alive' || p.hp.gte(p.maxHp) || state.tick < (p.vars['lg.leech.t'] ?? 0)) return;
  p.vars['lg.leech.t'] = state.tick + 6;   // at most ten leech heals per second
  const cap = p.maxHp.mul(B(perkParam(def, 'cap', 0.02)));
  healPlayer(state, ev, p, Big.min(cap, dealt.mul(mag(def))));
}

// ---------------- Presentation helpers (snapshot) ----------------

/** 0..1 readiness of an item's perk for the HUD (1 = ready / passive). */
export function perkReadiness(state: SimState, p: PlayerState, def: LegendaryDef): number {
  const v = p.vars;
  const t = state.tick;
  const timer = (key: string, periodSec: number) => {
    const next = v[key];
    if (next === undefined || next <= t) return 1;
    return Math.max(0, Math.min(1, 1 - (next - t) / ticks(periodSec)));
  };
  switch (def.perk.id) {
    case 'cheat_death': return v['lg.cheat'] ? 0 : 1;
    case 'empowered_skill': return v['lg.emp'] ? 1 : timer('lg.emp.next', perkParam(def, 'period', 10)) * 0.99;
    case 'bell_toll': return timer('lg.bell.next', perkParam(def, 'period', 6));
    case 'gravity_well': return timer('lg.well.next', perkParam(def, 'period', 8));
    case 'crit_lightning': return timer('lg.crit.t', perkParam(def, 'icd', 0.4));
    case 'thorns_nova': return timer('lg.thorn.t', perkParam(def, 'icd', 1));
    case 'fifth_shockwave': return Math.min(1, ((v['lg.basic'] ?? 0) + 1) / Math.max(1, perkParam(def, 'every', 5)));
    case 'kill_streak_speed': return Math.min(1, (v['lg.streak'] ?? 0) / Math.max(1, perkParam(def, 'stacks', 5)));
    case 'last_stand': return v['lg.low'] ? 1 : 0;
    default: return 1;
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Compact per-player gear for snapshots: item ids in GEAR_SLOTS order ('' = empty) and perk readiness. */
export function gearSnapshot(state: SimState, p: PlayerState): { gr: string[]; gp: number[] } | null {
  const g = p.gear;
  if (!g) return null;
  let any = false;
  const gr = GEAR_SLOTS.map((s) => { const id = g[s] ?? ''; if (id) any = true; return id; });
  if (!any) return null;
  const gp = GEAR_SLOTS.map((s) => { const def = g[s] ? LEGENDARY_BY_ID[g[s]!] : undefined; return def ? r3(perkReadiness(state, p, def)) : 0; });
  return { gr, gp };
}

/** Ground loot for snapshots (hidden outside combat: unclaimed items are settled or carried at round clear). */
export function lootSnapshot(state: SimState): { i: number; it: string; x: number; y: number }[] {
  if (state.phase !== 'COMBAT' || !state.loot?.length) return [];
  return state.loot.filter((x) => !x.carry).map((x) => ({ i: x.id, it: x.itemId, x: r3(x.x), y: r3(x.y) }));
}
