import { Big } from '@cursebound/numeric';
import { CLASS_BY_ID, DODGE, RULES, SKILL_BY_ID, TICK_SEC, type SkillDef } from '@cursebound/content';
import { addStagger, cohortRadius, healPlayer, hitEnemy, shieldPlayer } from './combat';
import { breakChain } from './afflictions';
import { hooks } from './hooks';
import { dir8, inCone, inLine, isWallAt, moveCircle, norm, q, rayDistance } from './geometry';
import { nearestFloor } from './map';
import { nextFloat } from './rng';
import { B, ONE, hitDamage, playerDerived, toFloatClamped } from './stats';
import { ACTION, type EnemyState, type Hazard, type PlayerInput, type PlayerState, type Projectile, type SimEvent, type SimState } from './types';

// Player movement, abilities and life states (PRD §5, §6.1, §7). Inputs are intentions only (REQ NET01).

const DT = TICK_SEC;
const DT_B = B(TICK_SEC);
const ZERO = Big.ZERO;
const MAX_SPEED = 1e7;

/**
 * Shared movement step used by the authority and by client prediction (identical code path).
 * Dashes burst out and ease off (DODGE.easeStart -> easeEnd, mean 1); after a dash a short speed surge decays
 * (surgeTimer); walking carries light momentum: the velocity blends toward the wanted velocity each tick
 * (fast to accelerate or reverse, a touch slower to stop). Pass `vx/vy` (previous velocity) to enable momentum.
 */
export function movementStep(
  map: SimState['map'],
  p: { x: number; y: number; dodgeTimer: number; dodgeDirX: number; dodgeDirY: number; guardTimer: number; vx?: number; vy?: number; surgeTimer?: number },
  moveX: number, moveY: number, speed: number, dodgeSpeed: number,
  lim?: MoveLimitsIn,
): { x: number; y: number; vx: number; vy: number } {
  // afflictions (afflictions.ts): frozen / rooted heroes cannot move at all
  if (lim?.lock) return { x: p.x, y: p.y, vx: 0, vy: 0 };
  let mx = moveX, my = moveY;
  const ml = Math.sqrt(mx * mx + my * my);
  if (ml > 1) { mx /= ml; my /= ml; }          // normalized: diagonals have no speed advantage
  let vx: number, vy: number;
  if (p.dodgeTimer > 0) {
    const f = Math.min(1, Math.max(0, p.dodgeTimer / DODGE.durationSec));
    const k = DODGE.easeEnd + (DODGE.easeStart - DODGE.easeEnd) * f;
    vx = p.dodgeDirX * dodgeSpeed * k; vy = p.dodgeDirY * dodgeSpeed * k;
  } else {
    let s = p.guardTimer > 0 ? speed * 0.5 : speed;
    const sg = p.surgeTimer ?? 0;
    if (sg > 0) s *= 1 + (DODGE.surgeMult - 1) * Math.min(1, sg / DODGE.surgeSec);
    const tx = mx * s, ty = my * s;
    if (p.vx === undefined || p.vy === undefined || !Number.isFinite(p.vx) || !Number.isFinite(p.vy)) { vx = tx; vy = ty; }
    else {
      const t2 = tx * tx + ty * ty, v2 = p.vx * p.vx + p.vy * p.vy;
      const k = t2 >= v2 || tx * p.vx + ty * p.vy < 0 ? RULES.moveAccelBlend : RULES.moveDecelBlend;
      vx = p.vx + (tx - p.vx) * k; vy = p.vy + (ty - p.vy) * k;
      const ex = tx - vx, ey = ty - vy, tol = 0.15 + 0.03 * Math.sqrt(t2);
      if (ex * ex + ey * ey < tol * tol) { vx = tx; vy = ty; }   // settle instead of creeping forever
    }
  }
  if (!map) return { x: p.x, y: p.y, vx, vy };
  const r = moveCircle(map, p.x, p.y, vx * DT, vy * DT, RULES.playerRadius);
  if (lim?.teth) {
    // chained: never further from the anchor than the chain radius (or than already, if hooked from outside it)
    const [ax, ay, tr] = lim.teth;
    const nx = r.x - ax, ny = r.y - ay;
    const d = Math.sqrt(nx * nx + ny * ny);
    const cx = p.x - ax, cy = p.y - ay;
    const maxR = Math.max(tr, Math.sqrt(cx * cx + cy * cy));
    if (d > maxR + 1e-9) {
      const k = maxR / d;
      const r2 = moveCircle(map, p.x, p.y, ax + nx * k - p.x, ay + ny * k - p.y, RULES.playerRadius);
      return { x: r2.x, y: r2.y, vx: (r2.x - p.x) / DT, vy: (r2.y - p.y) / DT };
    }
  }
  return { x: r.x, y: r.y, vx, vy };
}

/** Movement limits from afflictions as the shared movement step reads them: lock = no movement (frozen / rooted),
 *  teth = chain anchor and radius. */
export interface MoveLimitsIn { lock?: number | boolean; teth?: [number, number, number] | null }

/** Authority view of a hero's movement limits: ticks of movement lock left, chain [x, y, r] and its ticks left.
 *  The snapshot sends these (lk, teth, tk) so prediction applies exactly the same limits. */
export function moveLimitsOf(state: SimState, p: PlayerState): { lock: number; teth: [number, number, number] | null; tethT: number } {
  let lock = 0, tethT = 0;
  let teth: [number, number, number] | null = null;
  for (const b of p.buffs) {
    if (b.until <= state.tick) continue;
    if (b.id === 'frozen' || b.id === 'rooted') lock = Math.max(lock, b.until - state.tick);
    else if (b.id === 'chained' && p.aff?.n.tr) { tethT = b.until - state.tick; teth = [p.aff.n.tx ?? p.x, p.aff.n.ty ?? p.y, p.aff.n.tr]; }
  }
  return { lock, teth, tethT };
}

/** Status test on a hero's buffs (afflictions: 'frozen', 'silenced', ...). */
export function hasBuff(state: SimState, p: PlayerState, id: string): boolean {
  for (const b of p.buffs) if (b.id === id && b.until > state.tick) return true;
  return false;
}

/** Dash speed for a ground speed: dodge distance scales with tree/Fate speed and slows, not with RULES.playerMoveSpeedMult. */
export function dodgeSpeedFor(speed: number, classId: string): number {
  const base = (CLASS_BY_ID[classId]?.base.moveSpeed ?? 4.6) * Number(RULES.playerMoveSpeedMult);
  return (DODGE.travel / DODGE.durationSec) * (speed / base);
}

/** Shared dodge charge recharge (authority and prediction). `dt` is already scaled by the recovery rate. */
export function rechargeDodge(p: { dodgeCharges: number; dodgeCooldown: number }, dt: number) {
  const max = DODGE.charges;
  if (!(p.dodgeCharges >= 0)) p.dodgeCharges = max;            // checkpoints from before dodge charges
  if (p.dodgeCharges >= max) { p.dodgeCharges = max; p.dodgeCooldown = 0; return; }
  p.dodgeCooldown -= dt;
  while (p.dodgeCooldown <= 0 && p.dodgeCharges < max) {
    p.dodgeCharges++;
    p.dodgeCooldown = p.dodgeCharges < max ? p.dodgeCooldown + DODGE.cooldownSec : 0;
  }
}

/**
 * Shared dodge trigger (authority and prediction): a fresh press (`edge`) with a charge available and no guard
 * starts a dash along the move input (or the aim when standing still). Pressing again mid-dash chains a new dash.
 */
export function tryStartDodge(
  p: { dodgeTimer: number; dodgeDirX: number; dodgeDirY: number; dodgeCharges: number; dodgeCooldown: number; surgeTimer: number; guardTimer: number },
  edge: boolean, moveX: number, moveY: number, aimX: number, aimY: number,
): boolean {
  if (!edge || p.guardTimer > 0 || !(p.dodgeCharges > 0)) return false;
  let [dx, dy] = norm(moveX, moveY);
  if (dx === 0 && dy === 0) { [dx, dy] = norm(aimX, aimY); if (dx === 0 && dy === 0) dx = 1; }
  p.dodgeDirX = dx; p.dodgeDirY = dy;
  p.dodgeTimer = DODGE.durationSec;
  if (p.dodgeCharges >= DODGE.charges) p.dodgeCooldown = DODGE.cooldownSec;   // recharge clock starts when leaving full
  p.dodgeCharges--;
  p.surgeTimer = 0;
  return true;
}

/** Shared per-tick timer advance after movementStep: dash time runs out into a speed surge. */
export function advanceMoveTimers(p: { dodgeTimer: number; surgeTimer: number }, dt: number) {
  if (p.surgeTimer > 0) p.surgeTimer = Math.max(0, p.surgeTimer - dt);
  if (p.dodgeTimer > 0) {
    p.dodgeTimer = Math.max(0, p.dodgeTimer - dt);
    if (p.dodgeTimer <= 0) p.surgeTimer = DODGE.surgeSec;
  }
}

/** A movement body as seen by prediction (the subset of PlayerState the shared movement rules touch). */
export interface MoveBody {
  x: number; y: number; vx: number; vy: number;
  dodgeTimer: number; dodgeDirX: number; dodgeDirY: number; dodgeCharges: number; dodgeCooldown: number;
  surgeTimer: number; guardTimer: number;
  /** afflictions (snapshot lk / teth / tk): ticks of movement lock left, chain anchor + radius, chain ticks left */
  lock?: number;
  teth?: [number, number, number] | null;
  tethT?: number;
}

/**
 * Client prediction: one tick of exactly the movement rules stepPlayer applies, in the same order
 * (recharge -> dash trigger -> movementStep -> timers). `dodgeEdge` = dodge held now and not on the previous input;
 * `recovery` = recovery-rate multiplier (snapshot `rr`). Returns true if a dash started.
 */
export function predictMoveTick(
  map: SimState['map'], b: MoveBody, moveX: number, moveY: number, aimX: number, aimY: number,
  dodgeEdge: boolean, speed: number, classId: string, recovery: number,
): boolean {
  const locked = (b.lock ?? 0) > 0;
  rechargeDodge(b, DT * recovery);
  const dashed = tryStartDodge(b, dodgeEdge && !locked, moveX, moveY, aimX, aimY);
  if (dashed && b.teth) b.teth = null;   // a dash breaks a chain (authority: afflictions.breakChain)
  const teth = b.teth && (b.tethT ?? 0) > 0 ? b.teth : null;
  const m = movementStep(map, b, moveX, moveY, speed, dodgeSpeedFor(speed, classId), { lock: locked, teth });
  b.x = m.x; b.y = m.y; b.vx = m.vx; b.vy = m.vy;
  advanceMoveTimers(b, DT);
  if (b.lock) b.lock = Math.max(0, b.lock - 1);
  if (b.tethT) { b.tethT = Math.max(0, b.tethT - 1); if (!b.tethT) b.teth = null; }
  return dashed;
}

/** Effective ground speed: derived movement speed × the strongest active chill. The snapshot sends this as `spd`. */
export function moveSpeedOf(state: SimState, p: PlayerState): number {
  const s = toFloatClamped(playerDerived(state, p).moveSpeed, MAX_SPEED);
  let slow = 0;
  let haste = 0;   // Fate Bloodrush (boons.ts): +value movement while active
  for (const b of p.buffs) {
    if ((b.id === 'chill' || b.id === 'slowed') && b.until > state.tick && b.value > slow) slow = b.value;   // afflictions: strongest slow
    else if (b.id === 'bloodrush' && b.until > state.tick && b.value > haste) haste = b.value;
  }
  const hs = haste > 0 ? Math.min(MAX_SPEED, s * (1 + haste)) : s;
  return slow > 0 ? hs * (1 - Math.min(0.9, slow)) : hs;
}

export function cosHalf(deg: number): number {
  return Math.cos((deg / 2) * Math.PI / 180);
}

export function livingEnemies(state: SimState): EnemyState[] {
  return state.enemies.filter((e) => e.state !== 'dying' && !e.cohort.count.isZero());
}

export function areaCoverage(e: EnemyState, radius: number): number {
  if (e.cohort.count.lte(ONE)) return 1;
  const cr = e.radius;
  return Math.min(1, (radius * radius) / (cr * cr));
}

export function newProjectileId(state: SimState): number {
  return state.nextId++;
}

function resourceCost(state: SimState, p: PlayerState, skill: SkillDef): number {
  let c = skill.resourceCost;
  if (skill.damageType === 'ember' && c > 0) c *= toFloatClamped(playerDerived(state, p).emberCost, 1e9);
  if (c > 0) c *= hooks.costFactor(state, p, skill.id);
  return c;
}

// ---------------- Basic attacks ----------------

/**
 * Melee lunge (RULES.meleeLungeDist): a melee basic swing that would find no foe inside its reach steps toward the
 * nearest foe inside the swing arc within reach + lunge distance, just far enough for its body to be in reach
 * (+0.1). Reach and arc come from the class basic skill shape (content). Wall-safe, deterministic (state only; ties
 * by id). Skipped during tbkit scripted moves (leaps, charges) and while rooted, frozen or chained. Returns the
 * distance stepped.
 */
export function meleeLunge(state: SimState, p: PlayerState): number {
  const cls = CLASS_BY_ID[p.classId];
  const L = RULES.meleeLungeDist;
  if (!cls?.melee || !state.map || !(L > 0) || (p.vars.mv_mode ?? 0) > 0) return 0;
  const lim = moveLimitsOf(state, p);
  if (lim.lock > 0 || lim.teth) return 0;   // rooted / frozen / chained heroes do not lunge
  const sh = SKILL_BY_ID[cls.basicSkill]?.shape;
  if (!sh || sh.kind !== 'arc') return 0;
  const ch = cosHalf(sh.arcDeg);
  let best: EnemyState | null = null, bd = Infinity;
  for (const e of livingEnemies(state)) {
    if (inCone(p.x, p.y, p.aimX, p.aimY, sh.range, ch, e.x, e.y, e.radius)) return 0;   // already connects
    if (!inCone(p.x, p.y, p.aimX, p.aimY, sh.range + L, ch, e.x, e.y, e.radius)) continue;
    const d = Math.sqrt((e.x - p.x) ** 2 + (e.y - p.y) ** 2) - e.radius;
    if (d < bd || (d === bd && best && e.id < best.id)) { bd = d; best = e; }
  }
  if (!best) return 0;
  const step = Math.min(L, bd - sh.range + 0.1);
  if (!(step > 0)) return 0;
  const [nx, ny] = norm(best.x - p.x, best.y - p.y);
  const r = moveCircle(state.map, p.x, p.y, nx * step, ny * step, RULES.playerRadius);
  p.x = r.x; p.y = r.y;
  return step;
}

function fireBasic(state: SimState, ev: SimEvent[], p: PlayerState, k: Big) {
  meleeLunge(state, p);
  if (hooks.basicAttack(state, ev, p, k)) { p.attackAnim = 0.25; return; }
  const cls = CLASS_BY_ID[p.classId];
  const skill = SKILL_BY_ID[cls.basicSkill];
  p.attackAnim = 0.25;
  ev.push({ t: 'cast', slot: p.slot, skill: skill.id, x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, count: k.gt(ONE) ? k.toCompact() : undefined });
  if (skill.shape.kind === 'arc') {
    const dmg = hitDamage(state, p, skill.id, skill.damageType);
    const ch = cosHalf(skill.shape.arcDeg);
    for (const e of livingEnemies(state)) {
      if (!inCone(p.x, p.y, p.aimX, p.aimY, skill.shape.range, ch, e.x, e.y, e.radius)) continue;
      hitEnemy(state, ev, e, dmg, k, { dtype: skill.damageType, srcSlot: p.slot, skillId: skill.id, fromX: p.x, fromY: p.y, coverage: areaCoverage(e, skill.shape.range), allowCrit: true });
      flinch(state, e, p.x, p.y, 0.16);
    }
  } else if (skill.shape.kind === 'projectile') {
    spawnPlayerProjectiles(state, ev, p, skill, k.mul(playerDerived(state, p).projectileCount), hitDamage(state, p, skill.id, skill.damageType), 'spark');
  }
}

const MAX_REPS = 7;
const spreadCache = new Map<string, [number, number][]>();
function spreadDirs(n: number, spreadDeg: number): [number, number][] {
  const key = n + ':' + spreadDeg;
  let v = spreadCache.get(key);
  if (!v) {
    v = [];
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : ((i - (n - 1) / 2) * spreadDeg) * Math.PI / 180;
      v.push([Math.cos(a), Math.sin(a)]);
    }
    spreadCache.set(key, v);
  }
  return v;
}

/**
 * Weighted projectile packets (PRD §12.2): a burst of logical count `total` becomes up to MAX_REPS representative
 * projectiles, each carrying an integer logical weight (floor + deterministic residue). Hit evaluation uses the weight.
 */
export function spawnPlayerProjectiles(state: SimState, ev: SimEvent[], p: PlayerState, skill: SkillDef, total: Big, damage: Big, kind: string) {
  if (skill.shape.kind !== 'projectile') return;
  const totalInt = total.floorInt();
  // fractional residue (non-integer counts) resolved deterministically by the combat stream
  let count = totalInt;
  const frac = total.sub(Big.from(totalInt)).toNumber();
  if (frac > 0 && nextFloat(state.rng.combat) < frac) count += 1n;
  if (count <= 0n) return;
  const reps = count < BigInt(MAX_REPS) ? Number(count) : MAX_REPS;
  const base = count / BigInt(reps);
  const residue = Number(count % BigInt(reps));
  const dirs = spreadDirs(reps, skill.shape.spreadDeg);
  const speed = skill.shape.speed;
  for (let i = 0; i < reps; i++) {
    const [c, s] = dirs[i];
    const dx = p.aimX * c - p.aimY * s, dy = p.aimX * s + p.aimY * c;
    const w = base + (i < residue ? 1n : 0n);
    const proj: Projectile = {
      id: newProjectileId(state), kind, owner: 'player', ownerId: p.slot,
      x: p.x + dx * 0.4, y: p.y + dy * 0.4, vx: dx * speed, vy: dy * speed,
      radius: skill.shape.radius, range: skill.shape.range, damage, weight: Big.from(w), dtype: skill.damageType,
      pierce: skill.shape.pierce, hitIds: [], skillId: skill.id, crit: false, dot: skill.dot, lobTarget: null, bornTick: state.tick,
    };
    state.projectiles.push(proj);
  }
}

// ---------------- Skills ----------------

function castSkill(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean {
  const skill = SKILL_BY_ID[skillId];
  const pd = playerDerived(state, p);
  const aimX = p.aimX, aimY = p.aimY;
  const push = (extra?: Partial<{ x: number; y: number }>) =>
    ev.push({ t: 'cast', slot: p.slot, skill: skillId, x: extra?.x ?? p.x, y: extra?.y ?? p.y, dx: aimX, dy: aimY });
  p.castAnim = 0.3;
  p.lastSkill = skillId;
  const handled = hooks.castSkill(state, ev, p, skillId);
  if (handled !== undefined) return handled;
  switch (skillId) {
    case 'v_earthbreaker':
    case 'a_astral_nova': {
      if (skill.shape.kind !== 'circle') return false;
      const dmg = hitDamage(state, p, skillId, skill.damageType);
      const R = skill.shape.radius;
      for (const e of livingEnemies(state)) {
        const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d2 > (R + e.radius) ** 2) continue;
        hitEnemy(state, ev, e, dmg, ONE, { dtype: skill.damageType, srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, coverage: areaCoverage(e, R), allowCrit: true, stagger: skillId === 'v_earthbreaker' ? 160 : 120 });
        knockback(state, e, p.x, p.y, skill.knockback ?? 0);
      }
      push();
      return true;
    }
    case 'v_guard_stance': {
      p.guardTimer = 2.0;
      p.guardMoved = false;
      p.guardAbsorbed = ZERO;
      if ((p.ranks['v_bastion'] ?? 0) > 0) {
        state.hazards.push(makeHazard(state, { kind: 'bastion', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 2.5, untilTick: state.tick + Math.round(2.0 / DT), interval: 9999, damage: ZERO, dtype: 'physical' }));
      }
      push();
      return true;
    }
    case 'v_sweeping_strike': {
      if (skill.shape.kind !== 'arc') return false;
      const dmg = hitDamage(state, p, skillId, 'physical');
      const ch = cosHalf(skill.shape.arcDeg);
      const bleedRank = p.ranks['v_deep_cut'] ?? 0;
      const fracture = (p.ranks['v_fracture'] ?? 0) > 0;
      for (const e of livingEnemies(state)) {
        if (!inCone(p.x, p.y, aimX, aimY, skill.shape.range, ch, e.x, e.y, e.radius)) continue;
        hitEnemy(state, ev, e, dmg, ONE, {
          dtype: 'physical', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, coverage: areaCoverage(e, skill.shape.range), allowCrit: true,
          dot: bleedRank > 0 ? { type: 'physical', fractionPerSec: (0.1 * bleedRank).toFixed(2), durationSec: 3 } : undefined,
          vuln: fracture ? { factor: '1.1', sec: 2 } : undefined, stagger: 40,
        });
        flinch(state, e, p.x, p.y, 0.35);
      }
      if ((p.ranks['v_sundering_path'] ?? 0) > 0) {
        const wave = SKILL_BY_ID['v_sundering_wave'];
        spawnPlayerProjectiles(state, ev, p, wave, pd.projectileCount, hitDamage(state, p, 'v_sundering_wave', 'physical'), 'wave');
      }
      p.lastSkill = skillId;
      push();
      return true;
    }
    case 'v_rally_cry': {
      const until = state.tick + Math.round(6 / DT);
      const bearer = (p.ranks['v_standard_bearer'] ?? 0) > 0;
      for (const a of state.players) {
        if (a.lifeState !== 'alive') continue;
        if ((a.x - p.x) ** 2 + (a.y - p.y) ** 2 > 16) continue;
        a.buffs = a.buffs.filter((b) => b.id !== 'rally');
        a.buffs.push({ id: 'rally', until, value: 2 });
        if (bearer) shieldPlayer(state, ev, a, a.maxHp.mul(B('0.15')));
      }
      push();
      return true;
    }
    case 'a_fireline': {
      if (skill.shape.kind !== 'line') return false;
      const len = Math.min(skill.shape.length, rayDistance(state.map!, p.x, p.y, aimX, aimY, skill.shape.length));
      state.hazards.push(makeHazard(state, {
        kind: 'fireline', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, dx: aimX, dy: aimY, length: Math.max(0.5, len), width: skill.shape.width,
        untilTick: state.tick + Math.round(skill.shape.duration / DT), interval: Math.round(skill.shape.tickInterval / DT),
        damage: hitDamage(state, p, skillId, 'ember'), dtype: 'ember', dot: skill.dot,
      }));
      push();
      return true;
    }
    case 'a_arc_bolt': {
      if (skill.shape.kind !== 'chain') return false;
      const dmg = hitDamage(state, p, skillId, 'storm');
      const tx = p.x + aimX * Math.min(p.aimDist || 4, skill.shape.range), ty = p.y + aimY * Math.min(p.aimDist || 4, skill.shape.range);
      const live = livingEnemies(state);
      let cur: EnemyState | null = null; let bd = Infinity;
      for (const e of live) {
        const dp = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (dp > skill.shape.range ** 2) continue;
        const d2 = (e.x - tx) ** 2 + (e.y - ty) ** 2;
        if (d2 < bd) { bd = d2; cur = e; }
      }
      const jumps = skill.shape.jumps + ((p.ranks['a_fork'] ?? 0) > 0 ? 1 : 0);
      const hit: number[] = [];           // source-indexed hit list: no target is hit twice per cast
      const chain: { x: number; y: number }[] = [{ x: p.x, y: p.y }];
      while (cur && hit.length <= jumps) {
        hit.push(cur.id);
        chain.push({ x: cur.x, y: cur.y });
        hitEnemy(state, ev, cur, dmg, ONE, { dtype: 'storm', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, allowCrit: true });
        const from: EnemyState = cur;
        cur = null; bd = skill.shape.jumpRange ** 2;
        for (const e of live) {
          if (hit.includes(e.id) || e.state === 'dying') continue;
          const d2 = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
          if (d2 <= bd) { bd = d2; cur = e; }
        }
      }
      ev.push({ t: 'cast', slot: p.slot, skill: skillId, x: p.x, y: p.y, dx: chain.length > 1 ? chain[chain.length - 1].x : tx, dy: chain.length > 1 ? chain[chain.length - 1].y : ty });
      stormCast(state, ev, p, tx, ty);
      return true;
    }
    case 'a_phase_step': {
      const rs = p.skills.find((s) => s.skillId === 'a_phase_step')!;
      const fx = p.x, fy = p.y;
      let nx: number, ny: number;
      if (rs.mark && rs.mark.until > state.tick) {
        nx = rs.mark.x; ny = rs.mark.y; rs.mark = null;
      } else {
        const want = Math.min(skill.shape.kind === 'teleport' ? skill.shape.range : 5, Math.max(1, p.aimDist));
        const free = rayDistance(state.map!, p.x, p.y, aimX, aimY, want);
        const d = Math.max(0, free - RULES.playerRadius - 0.05);
        [nx, ny] = nearestFloor(state.map!, p.x + aimX * d, p.y + aimY * d);
        if ((p.ranks['a_return_mark'] ?? 0) > 0) rs.mark = { x: fx, y: fy, until: state.tick + Math.round(4 / DT) };
      }
      p.x = q(nx); p.y = q(ny);
      ev.push({ t: 'teleport', slot: p.slot, fx, fy, x: p.x, y: p.y });
      if ((p.ranks['a_event_horizon'] ?? 0) > 0 && p.resource >= 15) {
        p.resource -= 15;
        state.hazards.push(makeHazard(state, {
          kind: 'horizon', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 3, untilTick: state.tick + Math.round(2 / DT),
          interval: Math.round(0.25 / DT), damage: hitDamage(state, p, 'a_event_horizon_field', 'astral'), dtype: 'astral',
        }));
      }
      push({ x: p.x, y: p.y });
      return true;
    }
  }
  return false;
}

/** Storm-cast side effects (Static Shell, Tempest); exported for evolved storm skills in classes/arcanist.ts. */
export function stormCast(state: SimState, ev: SimEvent[], p: PlayerState, tx: number, ty: number) {
  if ((p.ranks['a_static_shell'] ?? 0) > 0) shieldPlayer(state, ev, p, p.maxHp.mul(B('0.08')));
  if ((p.ranks['a_tempest'] ?? 0) > 0) {
    const window = Math.round(4 / DT);
    p.stormCasts = p.stormCasts.filter((t) => state.tick - t <= window);
    p.stormCasts.push(state.tick);
    if (p.stormCasts.length >= 3 && p.resource >= 10) {
      p.resource -= 10;
      p.stormCasts = [];
      state.hazards.push(makeHazard(state, {
        kind: 'tempest', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 2, untilTick: state.tick + Math.round(3 / DT),
        interval: Math.round(0.5 / DT), damage: hitDamage(state, p, 'a_tempest_field', 'storm'), dtype: 'storm',
      }));
    }
  }
}

export function knockback(state: SimState, e: EnemyState, fromX: number, fromY: number, dist: number) {
  if (dist <= 0 || e.boss) return;
  if (e.ccResistUntil > state.tick) dist *= 0.3;   // temporary control resistance after repeated CC (base rule)
  const [nx, ny] = norm(e.x - fromX, e.y - fromY);
  const r = moveCircle(state.map!, e.x, e.y, nx * dist, ny * dist, Math.min(e.radius, 0.6));
  e.x = r.x; e.y = r.y;
  e.ccResistUntil = state.tick + Math.round(RULES.crowdControlResistSec / DT);
  if (e.attack && e.attack.stage === 'windup') { e.attack = null; e.state = 'recovery'; e.cooldowns['_recover'] = 0.4; }
}

/** Hit reaction: a small physical recoil on melee hits (no control resistance, no interrupt — a feel rule, not CC). */
export function flinch(state: SimState, e: EnemyState, fromX: number, fromY: number, dist: number) {
  if (e.boss || e.state === 'dying' || e.cohort.count.isZero()) return;
  const [nx, ny] = norm(e.x - fromX, e.y - fromY);
  const r = moveCircle(state.map!, e.x, e.y, nx * dist, ny * dist, Math.min(e.radius, 0.6));
  e.x = r.x; e.y = r.y;
}

export function makeHazard(state: SimState, h: Partial<Hazard> & Pick<Hazard, 'kind' | 'owner' | 'ownerId' | 'x' | 'y' | 'untilTick' | 'damage' | 'dtype'>): Hazard {
  return {
    id: state.nextId++, dx: 1, dy: 0, length: 0, width: 0, radius: 0, inner: 0, outer: 0, speed: 0,
    bornTick: state.tick, nextTick: state.tick, interval: 30, generation: 0, hitSlots: [], ...h,
  } as Hazard;
}

// ---------------- Per-tick player update ----------------

export function stepPlayer(state: SimState, ev: SimEvent[], p: PlayerState, input: PlayerInput | null) {
  const pd = playerDerived(state, p);
  p.attackAnim = Math.max(0, p.attackAnim - DT);
  p.castAnim = Math.max(0, p.castAnim - DT);
  p.buffs = p.buffs.filter((b) => b.until > state.tick);

  if (p.lifeState === 'downed') {
    p.vx = 0; p.vy = 0; p.surgeTimer = 0;   // no stale momentum after a revive
    if (p.selfReviveChannel > 0) {
      p.selfReviveChannel -= DT;
      if (p.selfReviveChannel <= 0) {
        p.selfReviveChannel = 0;
        revivePlayer(state, ev, p, null);
        if ((p.ranks['v_unbroken_rhythm'] ?? 0) > 0) p.dodgeCooldown = 0;
      }
    } else if (p.reviverSlot === null) {
      p.downTimer -= DT;
      if (p.downTimer <= 0) {
        p.lifeState = 'dead';
        ev.push({ t: 'dead', slot: p.slot });
        ev.push({ t: 'domain', type: 'player_dead', payload: { slot: p.slot, round: state.round, attack: 'bled out' } });
      }
    }
    p.reviverSlot = null;
    return;
  }
  if (p.lifeState === 'dead') return;

  if (input) p.lastInputSeq = input.seq;
  const inp = input ?? { seq: p.lastInputSeq, moveX: 0, moveY: 0, aimX: p.aimX, aimY: p.aimY, buttons: 0 };
  // Aim
  const al = Math.sqrt(inp.aimX * inp.aimX + inp.aimY * inp.aimY);
  if (al > 1e-4) { p.aimX = inp.aimX / al; p.aimY = inp.aimY / al; p.aimDist = al; }
  p.facing = dir8(p.aimX, p.aimY);

  // Timers scaled by recovery rate (cooldown recovery: +100% recovery halves cooldowns)
  const rec = toFloatClamped(pd.recovery, 1e12);
  rechargeDodge(p, DT * rec);
  p.iframes = Math.max(0, p.iframes - DT);
  for (const s of p.skills) {
    if (!s.skillId) continue;
    if (s.charges >= s.maxCharges) { s.cooldown = 0; continue; }
    const base = SKILL_BY_ID[s.skillId].cooldownSec;
    s.cooldown -= DT * rec;
    while (s.cooldown <= 0 && s.charges < s.maxCharges) {
      s.charges++;
      if (s.charges < s.maxCharges) s.cooldown += base; else s.cooldown = 0;
      if (base <= 0) { s.charges = s.maxCharges; s.cooldown = 0; }
    }
  }

  // Resource regeneration (Rally doubles)
  const rally = p.buffs.some((b) => b.id === 'rally') ? 2 : 1;
  const gain = pd.resourceRegen.mul(DT_B).mul(B(rally));
  const room = pd.resourceMax - p.resource;
  if (room > 0) p.resource = gain.gte(B(Math.max(room, 1e-9))) ? pd.resourceMax : Math.min(pd.resourceMax, p.resource + gain.toNumber());
  else p.resource = Math.min(p.resource, pd.resourceMax);

  // Shield decay
  if (!p.shield.isZero()) {
    const cap = p.maxHp.mul(pd.shieldCapFrac);
    p.shield = p.shield.sub(cap.mul(B(RULES.shieldDecayPerSec)).mul(DT_B));
  }

  // Dodge: a fresh press spends a charge (shared with prediction); pressing again mid-dash chains the next dash
  const pressed = inp.buttons;
  const dodgeEdge = (pressed & ACTION.DODGE) !== 0 && (p.prevButtons & ACTION.DODGE) === 0;
  // afflictions: frozen / rooted heroes cannot dodge; a dash breaks a chain (same rules as predictMoveTick)
  const lim = moveLimitsOf(state, p);
  const frozen = hasBuff(state, p, 'frozen');
  const silenced = hasBuff(state, p, 'silenced');
  if (tryStartDodge(p, dodgeEdge && lim.lock <= 0, inp.moveX, inp.moveY, p.aimX, p.aimY)) {
    if (lim.teth) { lim.teth = null; breakChain(state, ev, p); }
    p.iframes = Math.max(p.iframes, DODGE.iframeSec);
    ev.push({ t: 'dodge', slot: p.slot });
    if ((p.ranks['v_second_wind'] ?? 0) > 0) healPlayer(state, ev, p, p.maxHp.mul(pd.dodgeHeal));
    hooks.onDodge(state, ev, p);
  }

  // Movement
  const speed = moveSpeedOf(state, p);
  const dodgeSpeed = dodgeSpeedFor(speed, p.classId);
  const before = { x: p.x, y: p.y };
  const m = movementStep(state.map, p, inp.moveX, inp.moveY, speed, dodgeSpeed, { lock: lim.lock > 0, teth: lim.teth });
  p.x = m.x; p.y = m.y; p.vx = m.vx; p.vy = m.vy;
  advanceMoveTimers(p, DT);
  const moved = Math.abs(p.x - before.x) + Math.abs(p.y - before.y) > 1e-4;

  // Guard
  if (p.guardTimer > 0) {
    if (moved && !p.guardMoved) {
      p.guardMoved = true;
      state.hazards = state.hazards.filter((h) => !(h.kind === 'bastion' && h.ownerId === p.slot));
    }
    p.guardTimer -= DT;
    if (p.guardTimer <= 0) {
      p.guardTimer = 0;
      healPlayer(state, ev, p, p.maxHp.mul(pd.guardHeal));
    }
  }

  // Basic attack: accumulate logical attack work; extreme rates fire one grouped packet per tick
  const work = Big.from(p.attackWork).add(pd.attackFreq.mul(DT_B));
  if (pressed & ACTION.ATTACK && p.guardTimer <= 0 && p.dodgeTimer <= 0 && !frozen) {
    const k = work.floorInt();
    if (k > 0n) { fireBasic(state, ev, p, Big.from(k)); hooks.onBasicAttack(state, ev, p, Big.from(k)); }
    p.attackWork = work.sub(Big.from(k)).toNumber();
  } else {
    p.attackWork = Math.min(1, work.toNumber());    // readiness when idle (not a rate cap)
  }

  // Skills: actives (SKILL1..3) and signature
  const bits = [ACTION.SKILL1, ACTION.SKILL2, ACTION.SKILL3, ACTION.SIGNATURE];
  for (let i = 0; i < p.skills.length; i++) {
    const s = p.skills[i];
    if (!s.skillId) continue;
    const bit = i === p.skills.length - 1 ? ACTION.SIGNATURE : bits[i];
    if (!(pressed & bit) || (p.prevButtons & bit && s.skillId === 'a_phase_step')) continue;
    if (p.dodgeTimer > 0 || frozen || silenced) continue;   // afflictions: frozen / silenced heroes cannot cast
    const skill = SKILL_BY_ID[s.skillId];
    const returning = s.skillId === 'a_phase_step' && s.mark && s.mark.until > state.tick;
    if (!returning && s.charges <= 0) continue;
    const cost = returning ? 0 : resourceCost(state, p, skill);
    if (p.resource < cost) continue;
    if (s.skillId === 'v_guard_stance' && p.guardTimer > 0) continue;
    if (castSkill(state, ev, p, s.skillId)) {
      p.resource -= cost;
      if (!returning) {
        s.charges--;
        if (s.cooldown <= 0) s.cooldown = skill.cooldownSec;
      }
      hooks.onCast(state, ev, p, s.skillId);
    }
  }
  p.prevButtons = pressed;

  // Revive channel: stand near a downed ally (not attacking) to revive
  if (!(pressed & ACTION.ATTACK) && p.dodgeTimer <= 0 && !frozen) {
    for (const a of state.players) {
      if (a === p || a.lifeState !== 'downed' || a.selfReviveChannel > 0) continue;
      if ((a.x - p.x) ** 2 + (a.y - p.y) ** 2 > RULES.reviveRange ** 2) continue;
      a.reviverSlot = p.slot;
      a.reviveProgress += DT * pd.reviveSpeed;
      if (a.reviveProgress >= RULES.reviveChannelSec) {
        revivePlayer(state, ev, a, p.slot);
        p.stats.revives++;
        if ((p.ranks['v_unbroken_rhythm'] ?? 0) > 0) p.dodgeCooldown = 0;
      }
      break;
    }
  }
  if (p.lifeState === 'alive') hooks.onPlayerTick(state, ev, p);
}

export function revivePlayer(state: SimState, ev: SimEvent[], p: PlayerState, by: number | null) {
  p.lifeState = 'alive';
  p.hp = p.maxHp.mul(B(RULES.reviveHealthFrac));
  p.reviveProgress = 0;
  p.downTimer = 0;
  p.iframes = 1.0;
  ev.push({ t: 'revived', slot: p.slot, by });
  ev.push({ t: 'domain', type: 'player_revived', payload: { slot: p.slot, by, round: state.round } });
}

// ---------------- Player projectiles & hazards ----------------

export function stepPlayerProjectile(state: SimState, ev: SimEvent[], pr: Projectile): boolean {
  const map = state.map!;
  const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
  let travel = sp * DT;
  if (travel > pr.range) travel = pr.range;
  const [dx, dy] = norm(pr.vx, pr.vy);
  const wallD = rayDistance(map, pr.x, pr.y, dx, dy, travel + pr.radius);
  const segLen = Math.min(travel, Math.max(0, wallD - pr.radius * 0.5));
  const x1 = pr.x + dx * segLen, y1 = pr.y + dy * segLen;
  // earliest hits along the swept segment
  const candidates: { e: EnemyState; t: number }[] = [];
  for (const e of state.enemies) {
    if (e.state === 'dying' || e.cohort.count.isZero() || pr.hitIds.includes(e.id)) continue;
    const vx = e.x - pr.x, vy = e.y - pr.y;
    const along = vx * dx + vy * dy;
    if (along < -e.radius - pr.radius || along > segLen + e.radius + pr.radius) continue;
    const perp = Math.abs(-vx * dy + vy * dx);
    if (perp > e.radius + pr.radius) continue;
    candidates.push({ e, t: along });
  }
  candidates.sort((a, b) => a.t - b.t || a.e.id - b.e.id);
  for (const c of candidates) {
    pr.hitIds.push(c.e.id);
    const pl = state.players[pr.ownerId];
    hitEnemy(state, ev, c.e, pr.damage, pr.weight, { dtype: pr.dtype, srcSlot: pr.ownerId, skillId: pr.skillId, fromX: pl ? pl.x : pr.x, fromY: pl ? pl.y : pr.y, allowCrit: true, dot: pr.dot });
    flinch(state, c.e, pr.x, pr.y, 0.08);
    if (pr.pierce <= 0) return false;
    pr.pierce--;
  }
  pr.x = x1; pr.y = y1;
  pr.range -= travel;
  if (segLen < travel - 1e-6) return false;  // hit a wall
  return pr.range > 0.01;
}

export function stepPlayerHazard(state: SimState, ev: SimEvent[], h: Hazard) {
  if (hooks.hazardTick(state, ev, h)) return;
  if (h.kind === 'bastion' || state.tick < h.nextTick) return;
  h.nextTick = state.tick + Math.max(1, h.interval);
  for (const e of state.enemies) {
    if (e.state === 'dying' || e.cohort.count.isZero()) continue;
    let inside = false;
    let coverage = 1;
    if (h.kind === 'fireline') {
      inside = inLine(h.x, h.y, h.dx, h.dy, h.length, h.width / 2, e.x, e.y, e.radius);
      coverage = areaCoverage(e, h.width);
    } else {
      inside = (e.x - h.x) ** 2 + (e.y - h.y) ** 2 <= (h.radius + e.radius) ** 2;
      coverage = areaCoverage(e, h.radius);
    }
    if (!inside) continue;
    hitEnemy(state, ev, e, h.damage, ONE, { dtype: h.dtype, srcSlot: h.ownerId, skillId: h.kind, fromX: h.x, fromY: h.y, coverage, allowCrit: false, dot: h.dot, generation: h.generation });
    if (h.kind === 'horizon' && !e.boss) {
      const [nx, ny] = norm(h.x - e.x, h.y - e.y);
      const r = moveCircle(state.map!, e.x, e.y, nx * 0.25, ny * 0.25, Math.min(0.6, e.radius));
      e.x = r.x; e.y = r.y;
    }
    if (h.kind === 'horizon' && e.boss) addStagger(state, ev, e, 8);
  }
}

/** Inferno reaction: generation-1 area burn scheduled from a direct ember hit (finite causal semantics). */
export function processReactions(state: SimState, ev: SimEvent[]) {
  if (!state.reactions.length) return;
  const due = state.reactions.filter((r) => r.tick <= state.tick);
  state.reactions = state.reactions.filter((r) => r.tick > state.tick);
  for (const r of due) {
    for (const e of state.enemies) {
      if (e.state === 'dying' || e.cohort.count.isZero()) continue;
      if ((e.x - r.x) ** 2 + (e.y - r.y) ** 2 > (1.5 + e.radius) ** 2) continue;
      // converted portion becomes a burn over 3 seconds (no further reactions: generation cap is causal, not a damage cap)
      const perSec = r.amount.div(B(3));
      const until = Math.ceil((state.tick + 3 / DT) / 15) * 15;
      const ex = e.dots.find((d) => d.src === r.slot && d.type === 'ember' && d.until === until);
      if (ex) ex.perSec = ex.perSec.add(perSec); else e.dots.push({ src: r.slot, type: 'ember', perSec, until });
      e.burning = true;
    }
  }
}

export function enemyRadiusFor(e: EnemyState, baseRadius: number) {
  e.radius = cohortRadius(baseRadius, e.cohort.count);
}

export { isWallAt };
