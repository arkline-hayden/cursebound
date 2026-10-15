import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { BOUNTY_MODIFIERS, CARDS, DODGE, RULES, bountyCardId, cardMechanics, cardStatEffects } from '@cursebound/content';
import {
  applyCard, botCommands, botInput, deserializeState, devSpawn, downOrKill, killEnemy, playerDerived, rechargeDodge, serializeState, stateHash, step,
  tryStartDodge,
  type SimState,
} from '@cursebound/simulation';
import { rollDrops } from '../src/pickups';
import { newRun, runBot } from './run.helpers';

// Daily bounty modifiers (content bounties.ts, simulation bounty.ts): each one is a real, deterministic change to the
// simulation, pinned by the run's creation parameters so a replay (or a checkpoint restore) reproduces it.

const TICKS = 60 * 50;   // round-1 setup + ~45 s of combat: kills, drops, hits and dodges all happen
const SEED = 'BOUNTY_TEST_SEED';

interface Ctx { seq: number; voteSeq: number }

/** One tick of the reference bot (persistent input / vote sequence numbers, as tools/balance botTick). */
function botTick(s: SimState, ctx: Ctx) {
  const cmds = s.players.flatMap((p) => botCommands(s, p.slot, ctx.voteSeq, () => 0));
  if (cmds.some((c) => c.type === 'VOTE')) ctx.voteSeq++;
  const inputs = s.phase === 'COMBAT' ? s.players.map((p) => botInput(s, p.slot, ++ctx.seq)) : [];
  step(s, inputs, cmds);
}

function botRun(bounty: string | null, ticks = TICKS, restoreAt = -1): SimState {
  let s = newRun(['vanguard'], SEED, { bounty });
  const ctx = { seq: 0, voteSeq: 1 };
  for (let t = 0; t < ticks && s.phase !== 'RESULTS'; t++) {
    botTick(s, ctx);
    if (t === restoreAt) s = deserializeState(serializeState(s));   // checkpoint round trip mid-run
  }
  return s;
}

describe('daily bounty modifiers', () => {
  const baseline = botRun(null);
  const baseHash = stateHash(baseline);

  it('ships about twenty modifiers with unique ids', () => {
    expect(BOUNTY_MODIFIERS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BOUNTY_MODIFIERS.map((m) => m.id)).size).toBe(BOUNTY_MODIFIERS.length);
  });

  it('a run without a bounty carries no bounty state (old replays keep their hashes)', () => {
    const s = newRun(['vanguard'], SEED);
    expect(s.bounty).toBeUndefined();
    expect(s.players[0].dodgeMax).toBeUndefined();
    expect(s.fate.entries).toHaveLength(0);
  });

  it('rejects unknown modifiers', () => {
    expect(() => newRun(['vanguard'], SEED, { bounty: 'no_such_bounty' })).toThrow(/unknown bounty/);
  });

  for (const m of BOUNTY_MODIFIERS) {
    it(`${m.id}: changes the simulation and replays deterministically`, () => {
      const a = botRun(m.id);
      const b = botRun(m.id, TICKS, Math.floor(TICKS / 2));
      expect(a.bounty).toBe(m.id);
      expect(stateHash(a)).toBe(stateHash(b));      // same seed + bounty (+ a mid-run checkpoint restore) = same run
      expect(stateHash(a)).not.toBe(baseHash);      // and not the run without the modifier
      for (const st of m.stats ?? []) {
        expect(a.fate.factors[st.stat]?.toString()).toBeDefined();
        expect(a.fate.entries.some((e) => e.cardId === bountyCardId(m.id) && e.stat === st.stat && e.round === 0)).toBe(true);
      }
      for (const x of m.mechanics ?? []) expect(a.fate.mechanics?.[x.id]?.stacks).toBe(1);
    });
  }

  it('stat modifiers move the derived numbers the way they say', () => {
    const base = newRun(['vanguard'], SEED);
    const withered = newRun(['vanguard'], SEED, { bounty: 'withered' });
    expect(withered.players[0].maxHp.ratio(base.players[0].maxHp)).toBeCloseTo(0.8, 6);
    expect(withered.players[0].hp.eq(withered.players[0].maxHp)).toBe(true);
    const sluggish = newRun(['vanguard'], SEED, { bounty: 'sluggish' });
    expect(playerDerived(sluggish, sluggish.players[0]).recovery.ratio(playerDerived(base, base.players[0]).recovery)).toBeCloseTo(0.8, 6);
    // foes spawned under Ironhide carry +30% health
    const iron = newRun(['vanguard'], SEED, { bounty: 'ironhide' });
    runBot(iron, { maxTicks: 60 * 4 }); runBot(base, { maxTicks: 60 * 4 });
    const e1 = iron.enemies.find((e) => !e.boss)!, e0 = base.enemies.find((e) => e.kind === e1.kind && !e.boss)!;
    expect(e1.cohort.unitHp.ratio(e0.cohort.unitHp)).toBeCloseTo(1.3, 6);
  });

  it('Barren Halls: foes drop nothing, even rares', () => {
    const s = newRun(['vanguard'], SEED, { bounty: 'barren' });
    runBot(s, { maxTicks: 60 * 4 });
    const e = devSpawn(s, 'pursuer', s.players[0].x + 2, s.players[0].y);
    e.elite = 2;
    const before = s.pickups.length;
    rollDrops(s, e);
    expect(s.pickups.length).toBe(before);
    const open = newRun(['vanguard'], SEED);
    runBot(open, { maxTicks: 60 * 4 });
    const e2 = devSpawn(open, 'pursuer', open.players[0].x + 2, open.players[0].y);
    e2.elite = 2;
    const b2 = open.pickups.length;
    rollDrops(open, e2);
    expect(open.pickups.length).toBeGreaterThan(b2);
  });

  it('Hobbled: one dodge charge that recharges to one', () => {
    const s = newRun(['vanguard'], SEED, { bounty: 'hobbled' });
    const p = s.players[0];
    expect(p.dodgeMax).toBe(1);
    expect(p.dodgeCharges).toBe(1);
    expect(tryStartDodge(p, true, 1, 0, 1, 0)).toBe(true);
    expect(tryStartDodge(p, true, 1, 0, 1, 0)).toBe(false);   // no second charge to chain
    rechargeDodge(p, DODGE.cooldownSec * 5);
    expect(p.dodgeCharges).toBe(1);
  });

  it("Fate's Spite: a card's price is paid twice, its gift once", () => {
    const card = CARDS.find((c) => c.positive && c.negative && c.bane) ?? CARDS.find((c) => c.positive && c.negative)!;
    const s = newRun(['vanguard'], SEED, { bounty: 'spite' });
    const o = newRun(['vanguard'], SEED);
    applyCard(s, card.id, 'o1', []);
    applyCard(o, card.id, 'o1', []);
    const count = (st: SimState, stat: string) => st.fate.entries.filter((e) => e.cardId === card.id && e.stat === stat).length;
    for (const { side, effect } of cardStatEffects(card)) expect(count(s, effect.stat)).toBe(side === 'price' ? 2 * count(o, effect.stat) : count(o, effect.stat));
    for (const { side, effect } of cardMechanics(card)) {
      expect(s.fate.mechanics?.[effect.id]?.stacks).toBe((o.fate.mechanics?.[effect.id]?.stacks ?? 0) * (side === 'price' ? 2 : 1));
    }
  });

  it('Swift Death: downed heroes bleed out in half the time', () => {
    const s = newRun(['vanguard', 'arcanist'], SEED, { bounty: 'swift_death' });
    runBot(s, { maxTicks: 60 * 4 });
    downOrKill(s, [], s.players[0], Big.ONE, { attack: 'test', source: 'test', fromX: 0, fromY: 0, dtype: 'physical' });
    expect(s.players[0].lifeState).toBe('downed');
    expect(s.players[0].downTimer).toBeCloseTo(RULES.downedSec / 2, 9);
  });

  it('No Respite: clearing a floor heals nobody', () => {
    // drive to the first ROUND_CLEAR with instant kills, the hero held at half health, then read health after the clear
    const until = (bounty: string | null) => {
      const s = newRun(['vanguard'], SEED, { bounty });
      const ctx = { seq: 0, voteSeq: 1 };
      for (let i = 0; i < 60 * 60 * 6 && s.phase !== 'ROUND_CLEAR'; i++) {
        if (s.phase === 'COMBAT') {
          for (const p of s.players) { p.iframes = 10; p.hp = p.maxHp.mulNum(0.5); }
          for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
        }
        botTick(s, ctx);
      }
      return s;
    };
    const harsh = until('no_respite'), soft = until(null);
    expect(harsh.phase).toBe('ROUND_CLEAR');
    expect(soft.phase).toBe('ROUND_CLEAR');
    expect(harsh.players[0].hp.ratio(harsh.players[0].maxHp)).toBeCloseTo(0.5, 6);
    expect(soft.players[0].hp.ratio(soft.players[0].maxHp)).toBeCloseTo(0.5 + Number(RULES.intermissionHealFrac), 6);
  });
});
