import { RULES } from '@cursebound/content';
import { bountyRules, dodgeMaxOf } from './bountyRules';
import { healPlayer } from './combat';
import { registerGlobalHooks } from './hooks';
import { nearestFloor } from './map';
import { nextFloat } from './rng';
import { cutCooldowns } from './players';
import { B } from './stats';
import type { EnemyState, PlayerState, Pickup, SimEvent, SimState } from './types';

// Ground pickups (generic `state.pickups`, `kind` string). Built-in kinds:
//   'potion' — a healing potion: heals the member who walks over it by a solid fraction of max health and nearby
//              allies a little. Dropped occasionally by ordinary foes, more often by champions, always by rares.
//   'orb'    — a haste orb: cuts the remaining cooldown of every recharging skill (RULES.orbCooldownSec), allies a little.
// Only members who need the effect attract or collect a pickup (a full-health hero leaves the potion for an ally).
// The authority decides collection; clients only render and react to the 'pickup' event. Other modules may store
// their own kinds here; this module ignores kinds it does not know except for expiry (untilTick > 0).

export const PICKUP_KINDS = { potion: 'potion', orb: 'orb' } as const;

const DT = 1 / 60;

/** Spawn a pickup near (x, y), scattered a little by the combat stream so several drops do not stack. */
export function dropPickup(state: SimState, kind: string, x: number, y: number, tier = 0): Pickup | null {
  if (!state.map) return null;
  if (!state.pickups) state.pickups = [];
  const ang = nextFloat(state.rng.combat) * Math.PI * 2;
  const r = 0.25 + nextFloat(state.rng.combat) * 0.55;
  const [px, py] = nearestFloor(state.map, x + Math.cos(ang) * r, y + Math.sin(ang) * r);
  const pk: Pickup = {
    id: state.nextId++, kind, x: px, y: py, bornTick: state.tick,
    untilTick: state.tick + Math.round(RULES.pickupLifeSec * 60), tier,
  };
  state.pickups.push(pk);
  if (state.pickups.length > RULES.maxPickups) state.pickups.splice(0, state.pickups.length - RULES.maxPickups);
  return pk;
}

function needs(state: SimState, p: PlayerState, kind: string): boolean {
  if (p.lifeState !== 'alive') return false;
  if (kind === PICKUP_KINDS.potion) return p.hp.lt(p.maxHp);
  if (kind === PICKUP_KINDS.orb) return p.skills.some((s) => s.skillId && s.charges < s.maxCharges);
  return false;
}

function collect(state: SimState, ev: SimEvent[], pk: Pickup, p: PlayerState) {
  ev.push({ t: 'pickup', id: pk.id, kind: pk.kind, slot: p.slot, x: pk.x, y: pk.y });   // before the heal events it causes
  if (pk.kind === PICKUP_KINDS.potion) {
    healPlayer(state, ev, p, p.maxHp.mul(B(pk.tier > 0 ? RULES.potionHealFracElite : RULES.potionHealFrac)));
    for (const a of state.players) {
      if (a === p || a.lifeState !== 'alive') continue;
      if ((a.x - pk.x) ** 2 + (a.y - pk.y) ** 2 > RULES.potionAllyRange ** 2) continue;
      healPlayer(state, ev, a, a.maxHp.mul(B(RULES.potionAllyHealFrac)));
    }
  } else if (pk.kind === PICKUP_KINDS.orb) {
    const give = (who: PlayerState, sec: number) => cutCooldowns(who, sec);
    give(p, RULES.orbCooldownSec * (pk.tier > 0 ? 1.5 : 1));
    for (const a of state.players) {
      if (a === p || a.lifeState !== 'alive') continue;
      if ((a.x - pk.x) ** 2 + (a.y - pk.y) ** 2 > RULES.potionAllyRange ** 2) continue;
      give(a, RULES.orbAllyCooldownSec);
    }
  }
}

/** Per-tick pickup update: expiry, magnet pull toward the nearest member who needs it, collection on touch. */
export function stepPickups(state: SimState, ev: SimEvent[]) {
  if (!state.pickups?.length) return;
  const keep: Pickup[] = [];
  for (const pk of state.pickups) {
    if (pk.untilTick > 0 && state.tick >= pk.untilTick) continue;
    if (pk.kind !== PICKUP_KINDS.potion && pk.kind !== PICKUP_KINDS.orb) { keep.push(pk); continue; }
    if (state.tick - pk.bornTick < 12) { keep.push(pk); continue; }   // a short drop "pop" before it can be grabbed
    let best: PlayerState | null = null;
    let bd = RULES.pickupMagnetRange ** 2;
    for (const p of state.players) {
      if (!needs(state, p, pk.kind)) continue;
      const d2 = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2;
      if (d2 <= bd) { bd = d2; best = p; }
    }
    if (best) {
      const d = Math.sqrt(bd);
      if (d <= RULES.pickupTouchRange) { collect(state, ev, pk, best); continue; }
      const step = Math.min(d, RULES.pickupMagnetSpeed * DT);
      pk.x += ((best.x - pk.x) / d) * step;
      pk.y += ((best.y - pk.y) / d) * step;
      if (d - step <= RULES.pickupTouchRange) { collect(state, ev, pk, best); continue; }
    }
    keep.push(pk);
  }
  state.pickups = keep;
}

/** Drop table on an enemy death (combat stream rolls). */
export function rollDrops(state: SimState, e: EnemyState) {
  if (e.boss || bountyRules(state).noPickups) return;   // "Barren Halls" bounty: nothing drops
  const tier = e.elite ?? 0;
  const roll = () => nextFloat(state.rng.combat);
  if (tier >= 2) {
    dropPickup(state, PICKUP_KINDS.potion, e.x, e.y, 2);
    dropPickup(state, PICKUP_KINDS.orb, e.x, e.y, 2);
    if (roll() < 0.5) dropPickup(state, PICKUP_KINDS.potion, e.x, e.y, 2);
    return;
  }
  if (tier === 1) {
    dropPickup(state, PICKUP_KINDS.potion, e.x, e.y, 1);
    if (roll() < 0.35) dropPickup(state, PICKUP_KINDS.orb, e.x, e.y, 1);
    return;
  }
  if (!e.objective) {
    if (roll() < RULES.minionDropChance) dropPickup(state, PICKUP_KINDS.potion, e.x, e.y, 0);
    return;
  }
  const r = roll();
  if (r < RULES.potionDropChance) dropPickup(state, PICKUP_KINDS.potion, e.x, e.y, 0);
  else if (r < RULES.potionDropChance + RULES.orbDropChance) dropPickup(state, PICKUP_KINDS.orb, e.x, e.y, 0);
}

registerGlobalHooks({
  onRoundStart(state) {
    state.pickups = [];
    for (const p of state.players) {
      p.dodgeCharges = dodgeMaxOf(p); p.dodgeCooldown = 0; p.surgeTimer = 0; p.vx = 0; p.vy = 0;
    }
  },
  onKill(state, _ev, e) {
    if (state.phase !== 'COMBAT') return;
    rollDrops(state, e);
  },
  onTick(state, ev) {
    stepPickups(state, ev);
  },
});

