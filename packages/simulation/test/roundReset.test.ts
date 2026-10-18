import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CLASSES, CLASS_BY_ID, DODGE, RULES } from '@cursebound/content';
import {
  B, bindMechanic, botInput, buildSnapshot, hitPlayer, killEnemy, makeHazard, maxHpOf, refreshMaxHp, stateHash, step,
  type Command, type PlayerState, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Round-start refresh (sim.ts refreshHeroesForRound): after the door walk-through every hero enters the next floor with
// full health, ready skills and dodge, no kit stacks, statuses or leftover summons, while the build, gear, Fate and
// score carry on.

let voteSeq = 1;

/** Step the round flow (instant clears, invulnerable heroes, card 0 locked, durable acks) until `until` holds. */
function drive(s: SimState, until: (s: SimState) => boolean) {
  for (let i = 0; i < 200000 && !until(s) && s.phase !== 'RESULTS'; i++) {
    const cmds: Command[] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'VOTING' && s.offer) for (const p of s.players) if (!s.offer.votes[p.slot].locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: voteSeq++, cardSlot: 0, locked: true });
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    if (s.phase === 'COMBAT') {
      for (const p of s.players) p.iframes = 10;
      for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    }
    step(s, [], cmds);
  }
  expect(until(s)).toBe(true);
}

/** Let the bots really fight for a while in round-1 combat (casts, cooldowns, kit stacks, summons). */
function fight(s: SimState, ticks: number) {
  drive(s, (x) => x.phase === 'COMBAT');
  let seq = 1;
  for (let i = 0; i < ticks && s.phase === 'COMBAT'; i++) {
    for (const p of s.players) p.iframes = 10;
    step(s, s.players.map((p) => botInput(s, p.slot, seq++)));
  }
}

const FOREVER = 1e9;

/** Round-scoped kit state a hero of each class can be carrying when the round ends: p.vars counters and its deployables. */
const KIT: Record<string, { vars: Record<string, number>; hazards: string[] }> = {
  duelist: { vars: { combo: 15, ui_combo: 15, comboT: 5, fangChain: 3, parryForm: 1, ambushUntil: FOREVER, tcLeft: 3, rv0: 12, critT: FOREVER }, hazards: [] },
  berserker: { vars: { b_frenzy: 6, ui_frenzy: 6, b_frenzyT: 5, b_udReady: FOREVER, b_dlReady: FOREVER, b_wwUntil: FOREVER, b_wwKind: 1, mv_mode: 1 }, hazards: ['b_whirl', 'b_fissure'] },
  hexbinder: { vars: { hx_lust: 5, hx_lustUntil: FOREVER, hx_volley: 2 }, hazards: ['hx_soul', 'hx_wraith', 'hx_plague'] },
  vanguard: { vars: { vg_rmp: 3, vg_rmpU: FOREVER, vg_ret: 0.5, vg_cT: 4 }, hazards: ['v_banner'] },
  arcanist: { vars: { ar_att: 2, a_ehReady: FOREVER, ar_gateCd: FOREVER }, hazards: ['a_gate', 'a_crater'] },
  artificer: { vars: { rjLeft: 3, ui_turrets: 2, aegisT: 5 }, hazards: ['af_turret', 'af_drone', 'af_mine'] },
  warden: { vars: { w_frenzyUntil: FOREVER, w_thornUntil: FOREVER, w_barkUntil: FOREVER, w_mark: 3, w_markUntil: FOREVER, w_novaReady: FOREVER }, hazards: ['w_wolf', 'w_totem'] },
  templar: { vars: { t_combo: 2, t_ret: 0.3, ui_retribution: 30, th7: FOREVER }, hazards: ['t_consecration', 't_vow'] },
  cryomancer: { vars: { howReady: FOREVER, cryoReady: FOREVER, glT: 5 }, hazards: ['cryo_wall', 'cryo_storm'] },
  ranger: { vars: { ui_focus: 4, ffId: 7, rhythm: 2, wdN: 2, wdU: FOREVER, still: 90 }, hazards: ['ranger_trap', 'ranger_hawk'] },
};

/** Leave a hero worn out at the end of the intermission: hurt, everything on cooldown, stacks, statuses, deployables. */
function dirty(s: SimState, p: PlayerState) {
  p.hp = p.maxHp.mul(B('0.1'));
  p.shield = p.maxHp.mul(B('0.3'));
  for (const sk of p.skills) if (sk.skillId) { sk.cooldown = 7; sk.charges = 0; sk.full = 9; sk.mark = { x: p.x, y: p.y, until: FOREVER }; }
  p.dodgeCharges = 0; p.dodgeCooldown = 1; p.surgeTimer = 0.2; p.guardTimer = 2; p.iframes = 3; p.lastSkill = p.skills[0].skillId;
  for (const id of ['poisoned', 'chill', 'frozen', 'af_overclock', 'rally', 'bloodlust', 'shrine_fury']) p.buffs.push({ id, until: s.tick + FOREVER, value: 1 });
  p.aff = { n: { chill: 3 }, poison: { dps: B(5), source: 'test', attack: 'test' } };
  p.stormCasts = [s.tick];
  const kit = KIT[p.classId];
  Object.assign(p.vars, kit.vars, { 'lg.cheat': 1, 'lg.streak': 4, 'lg.crit.t': FOREVER, boon_phoenix_round: s.round, boon_thunder: 2, vg_ls: s.round, t_diRound: s.round });
  for (const kind of kit.hazards) {
    s.hazards.push(makeHazard(s, { kind, owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 1, untilTick: s.tick + FOREVER, damage: Big.ZERO, dtype: 'physical' }));
  }
  s.projectiles.push({ id: s.nextId++, kind: 'spark', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, vx: 1, vy: 0, radius: 0.2, range: 99, damage: B(1), weight: B(1), dtype: 'ember', pierce: 0, hitIds: [], skillId: 'test', crit: false, lobTarget: null, bornTick: s.tick });
}

/** Progression and run state that must survive the refresh untouched. */
function persistent(s: SimState, p: PlayerState) {
  return JSON.stringify({
    ranks: p.ranks, skillPoints: p.skillPoints, spent: p.spentByBranch, mastery: p.mastery, gear: p.gear ?? {}, pacts: p.pacts ?? [], coins: p.coins ?? 0, bless: p.bless ?? 0,
    selfReviveBlock: p.selfReviveBlock, classId: p.classId, skills: p.skills.map((k) => [k.skillId, k.maxCharges]),
    stats: Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, String(v)])),
    dps: p.dpsWindow.map(String), score: s.scoreText, fate: s.fate.entries.map((e) => `${e.cardId}:${e.stat}:${e.factor}`), mechanics: Object.keys(s.fate.mechanics ?? {}),
    maxHp: p.maxHp.toString(),
  });
}

function expectFresh(s: SimState, p: PlayerState) {
  const who = `${p.classId} (slot ${p.slot})`;
  expect(p.lifeState, who).toBe('alive');
  expect(p.hp.toString(), who).toBe(p.maxHp.toString());
  expect(p.maxHp.toString(), who).toBe(maxHpOf(s, p).toString());
  expect(p.shield.isZero(), who).toBe(true);
  expect(p.downTimer + p.downsThisRound + p.selfReviveChannel + p.reviveProgress, who).toBe(0);
  expect(p.reviverSlot, who).toBeNull();
  const owned = p.skills.filter((k) => k.skillId);
  expect(owned.length, who).toBeGreaterThan(0);
  for (const k of owned) {
    expect(k.cooldown, `${who} ${k.skillId}`).toBe(0);
    expect(k.charges, `${who} ${k.skillId}`).toBe(k.maxCharges);
    expect(k.maxCharges, `${who} ${k.skillId}`).toBeGreaterThanOrEqual(1);
    expect(k.full, `${who} ${k.skillId}`).toBeUndefined();
    expect(k.mark ?? null, `${who} ${k.skillId}`).toBeNull();
  }
  expect(p.dodgeCharges, who).toBe(DODGE.charges);
  expect(p.dodgeCooldown + p.dodgeTimer + p.surgeTimer + p.guardTimer + p.iframes, who).toBe(0);
  expect(p.lastSkill, who).toBeNull();
  expect(p.buffs, who).toEqual([]);
  expect(p.aff, who).toBeUndefined();
  expect(p.stormCasts, who).toEqual([]);
  // kit, Fate and gear counters are gone; HUD counters read 0 and their maxima stay
  for (const [k, v] of Object.entries(p.vars)) {
    if (k === 'lg.dv' || /^ui_.*Max$/.test(k)) continue;
    expect(k.startsWith('ui_') ? `${k}=${v}` : k, who).toBe(k.startsWith('ui_') ? `${k}=0` : 'lg.dv');
  }
  expect(s.hazards.filter((h) => h.owner === 'player' && h.ownerId === p.slot).map((h) => h.kind), who).toEqual([]);
  expect(s.projectiles.filter((pr) => pr.owner === 'player' && pr.ownerId === p.slot).length, who).toBe(0);
}

/** Round 1 combat (real fighting), clear, intermission to the door walk-through; dirty everyone; on into round 2. */
function throughDoor(classes: string[], seed: string, extra: Parameters<typeof newRun>[2] = {}, prep?: (s: SimState) => void) {
  voteSeq = 1;
  const s = newRun(classes, seed, extra);
  fight(s, 400);
  drive(s, (x) => x.phase === 'FATE_COMMIT');
  prep?.(s);
  for (const p of s.players) dirty(s, p);
  if (s.players.length > 1) { const d = s.players[1]; d.lifeState = 'downed'; d.hp = Big.ZERO; d.downTimer = 5; d.downsThisRound = 1; d.reviveProgress = 1; d.reviverSlot = 0; }
  const before = s.players.map((p) => persistent(s, p));
  drive(s, (x) => x.phase === 'ROUND_SETUP' && x.round === 2);
  return { s, before };
}

describe('round-start refresh', () => {
  const ids = CLASSES.map((c) => c.id);
  const parties: string[][] = [];
  for (let i = 0; i < ids.length; i += RULES.maxPartySize) parties.push(ids.slice(i, i + RULES.maxPartySize));

  it('covers every class kit', () => {
    expect(Object.keys(KIT).sort()).toEqual(ids.slice().sort());
  });

  for (const party of parties) {
    it(`every hero starts round 2 fresh: ${party.join(', ')}`, () => {
      const { s, before } = throughDoor(party, `RESET_${party.join('_').toUpperCase()}`.slice(0, 40));
      for (const p of s.players) {
        expectFresh(s, p);
        expect(persistent(s, p), p.classId).toBe(before[p.slot]);
      }
      expect(s.hazards.some((h) => h.owner === 'player')).toBe(false);
      // the HUD sees it on the very first snapshot of the round-intro: full health orb, ready sockets, empty meters
      const snap = buildSnapshot(s);
      for (const sp of snap.players) {
        expect(sp.hp).toBe(1);
        expect(sp.sh).toBe(0);
        expect(sp.life).toBe('alive');
        expect(sp.dc).toBe(DODGE.charges);
        expect(sp.buffs).toEqual([]);
        for (const [id, frac, ch, max] of sp.cd) if (id) { expect(frac).toBe(0); expect(ch).toBe(max); }
        for (const [k, v] of Object.entries(sp.kv ?? {})) if (!k.endsWith('Max')) expect(v, `${sp.c} ${k}`).toBe(0);
      }
    });
  }

  it('keeps Fate max health modifiers: full health is the reduced maximum', () => {
    const { s } = throughDoor(['vanguard'], 'RESET_FATE_MAXHP', {}, (x) => {
      const p = x.players[0];
      const before = p.maxHp;
      x.fate.factors['player.maxHealth'] = (x.fate.factors['player.maxHealth'] ?? Big.ONE).mul(B('0.6'));   // a -40% max health card
      x.stateVersion++;
      refreshMaxHp(p, before, maxHpOf(x, p));
    });
    const p = s.players[0];
    expect(p.maxHp.lt(B(CLASS_BY_ID.vanguard.base.maxHealth))).toBe(true);
    expect(p.maxHp.toString()).toBe(maxHpOf(s, p).toString());
    expect(p.hp.toString()).toBe(p.maxHp.toString());
  });

  it('"No Respite" bounty: health carries over, everything else refreshes', () => {
    const s = newRun(['duelist'], 'RESET_NO_RESPITE', { bounty: 'no_respite' });
    drive(s, (x) => x.phase === 'FATE_COMMIT');
    const p = s.players[0];
    dirty(s, p);
    const hp = p.maxHp.mul(B('0.35'));
    p.hp = hp;
    drive(s, (x) => x.phase === 'ROUND_SETUP' && x.round === 2);
    expect(p.hp.toString()).toBe(hp.toString());
    for (const k of p.skills) if (k.skillId) { expect(k.cooldown).toBe(0); expect(k.charges).toBe(k.maxCharges); }
    expect(p.vars.combo).toBeUndefined();
    expect(p.vars.ui_combo).toBe(0);
    expect(p.buffs).toEqual([]);
  });

  it('Phoenix (once a round) re-arms for the new round', () => {
    const s = newRun(['vanguard'], 'RESET_PHOENIX');
    bindMechanic(s, 'phoenix', '0.5', { offerId: 'test', cardId: 'test', seq: 0 });
    drive(s, (x) => x.phase === 'FATE_COMMIT');
    const p = s.players[0];
    p.vars.boon_phoenix_round = s.round;   // spent this round
    drive(s, (x) => x.phase === 'ROUND_SETUP' && x.round === 2);
    expect(p.vars.boon_phoenix_round).toBeUndefined();
    drive(s, (x) => x.phase === 'COMBAT');
    const ev: SimEvent[] = [];
    p.iframes = 0;
    hitPlayer(s, ev, p, p.maxHp.mul(B(1000)), { attack: 'test', source: 'test', fromX: p.x, fromY: p.y, dtype: 'physical' });
    expect(p.lifeState).toBe('alive');
    expect(ev.some((e) => e.t === 'cast' && e.skill === 'boon_phoenix')).toBe(true);
    expect(p.vars.boon_phoenix_round).toBe(2);
  });

  it('is deterministic', () => {
    const a = throughDoor(['duelist', 'artificer'], 'RESET_DET').s;
    const b = throughDoor(['duelist', 'artificer'], 'RESET_DET').s;
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
