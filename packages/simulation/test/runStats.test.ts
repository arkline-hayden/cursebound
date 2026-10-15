import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { BOSSES, CLASS_BY_ID, TICK_RATE } from '@cursebound/content';
import {
  RECAP_WINDOW_SEC, addDot, botCommands, botInput, deserializeState, devSpawn, hitEnemy, hitPlayer, resetBreakdown, restoreBreakdown, runBreakdown,
  serializeState, stateHash, step, tallyBegin, tallyEnd, tickDots, type RunBreakdown, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { ACTION, aimAt, arena, run, spawnAt } from './classkit.helpers';
import { newRun, runBot } from './run.helpers';

// Post-run breakdown (runStats.ts): per-skill attribution (summons and damage over time count for the skill that made
// them), damage taken by source, the death-recap window, and the guarantee that none of it reaches the hashed state.

const heroOf = (b: RunBreakdown | null, slot = 0) => b!.heroes.find((h) => h.slot === slot)!;
const skillDmg = (b: RunBreakdown | null, id: string, slot = 0) => Big.fromCompact(heroOf(b, slot).skills.find((s) => s.id === id)?.dmg ?? '0');

describe('breakdown: damage dealt by skill', () => {
  it('summoned wolves count for Call of the Pack, not for their own bite ids', () => {
    const a = arena('warden', ['w_call_pack'], 'STATS_WOLVES');
    const e = spawnAt(a, 'guardian', 4, 0, 8);
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    run(a, 240);
    const b = runBreakdown(a.s);
    const ids = heroOf(b).skills.map((s) => s.id);
    expect(skillDmg(b, 'w_call_pack').gt(Big.ZERO)).toBe(true);
    for (const raw of ['w_wolf_bite', 'w_wolf_pounce', 'w_wolf']) expect(ids).not.toContain(raw);
    // every row belongs to an equipped skill, a named proc or a damage-over-time fallback
    const p = a.s.players[0];
    const equipped = new Set([CLASS_BY_ID[p.classId].basicSkill, ...p.skills.map((s) => s.skillId)]);
    for (const id of ids) expect(equipped.has(id) || /^(boon_|lg_|dot:)/.test(id) || id === '').toBe(true);
  });

  it('damage over time counts for the skill that applied it; unclaimed rates fall back to dot:<type>', () => {
    const a = arena('vanguard', [], 'STATS_DOT');
    const s = a.s;
    const e = spawnAt(a, 'guardian', 3, 0, 40);
    const ev: SimEvent[] = [];
    // a cast context (as players.ts opens around castSkill): the hit's own id is a sub-effect, its bleed is the cast's
    const tk = tallyBegin(s, 0, 'v_sweeping_strike');
    hitEnemy(s, ev, e, Big.from(10), Big.ONE, { dtype: 'physical', srcSlot: 0, skillId: 'v_sub_effect', fromX: s.players[0].x, fromY: s.players[0].y, allowCrit: false, dot: { type: 'physical', fractionPerSec: '5', durationSec: 2 } });
    tallyEnd(s, tk);
    const direct = skillDmg(runBreakdown(s), 'v_sweeping_strike');
    expect(direct.gt(Big.ZERO)).toBe(true);
    for (let i = 0; i < 30; i++) { tickDots(s, ev, e); s.tick++; }
    const after = runBreakdown(s);
    expect(skillDmg(after, 'v_sweeping_strike').gt(direct)).toBe(true);
    expect(heroOf(after).skills.some((x) => x.id === 'v_sub_effect')).toBe(false);
    // a rate pushed outside any context (e.g. a restored checkpoint's old entry) is still counted, as dot:<type>
    e.dots.push({ src: 0, type: 'ember', perSec: Big.from(100), until: s.tick + 120 });
    for (let i = 0; i < 30; i++) { tickDots(s, ev, e); s.tick++; }
    expect(skillDmg(runBreakdown(s), 'dot:ember').gt(Big.ZERO)).toBe(true);
    // and a direct addDot from a kit inside a cast counts for that cast
    const tk2 = tallyBegin(s, 0, 'v_rally_cry');
    addDot(s, e, 0, 'decay', Big.from(50), 1);
    tallyEnd(s, tk2);
    for (let i = 0; i < 30; i++) { tickDots(s, ev, e); s.tick++; }
    expect(skillDmg(runBreakdown(s), 'v_rally_cry').gt(Big.ZERO)).toBe(true);
  });

  it('basic attacks and casts land on their own rows with kills and shares that add up', () => {
    const s = newRun(['vanguard'], 'STATS_BOT');
    runBot(s, { maxTicks: 60 * 60 });
    const h = heroOf(runBreakdown(s));
    const basic = h.skills.find((x) => x.id === CLASS_BY_ID.vanguard.basicSkill);
    expect(basic && Big.fromCompact(basic.dmg).gt(Big.ZERO)).toBe(true);
    expect(h.skills.some((x) => Big.fromCompact(x.kills).gt(Big.ZERO))).toBe(true);
    let sum = Big.ZERO;
    for (const x of h.skills) sum = sum.add(Big.fromCompact(x.dmg));
    expect(sum.eq(Big.fromCompact(h.dealt))).toBe(true);
    expect(h.dodges).toBeGreaterThanOrEqual(0);
  });
});

describe('breakdown: damage taken by source', () => {
  it('groups by source with their attacks and tells foes, bosses, hazards and curses apart', () => {
    const a = arena('vanguard', [], 'STATS_TAKEN');
    const s = a.s;
    const p = s.players[0];
    p.iframes = 0;
    p.hp = p.maxHp.mul(Big.from(1000)); p.maxHp = p.hp;   // never falls in this test
    const ev: SimEvent[] = [];
    const foe = devSpawn(s, 'gloomshade', p.x + 3, p.y, Big.ONE);
    const boss = BOSSES[0].name;
    hitPlayer(s, ev, p, Big.from(100), { attack: 'Shade Bolt', source: 'Gloom Shade', fromX: foe.x, fromY: foe.y, dtype: 'astral', srcId: foe.id });
    hitPlayer(s, ev, p, Big.from(50), { attack: 'Shadow Burst', source: 'Gloom Shade', fromX: foe.x, fromY: foe.y, dtype: 'astral', srcId: foe.id });
    hitPlayer(s, ev, p, Big.from(70), { attack: 'Bell Slam', source: boss, fromX: p.x, fromY: p.y, dtype: 'physical' });
    hitPlayer(s, ev, p, Big.from(30), { attack: 'Hexed Ground', source: 'Hexed Ground', fromX: p.x, fromY: p.y, dtype: 'astral', hazard: true });
    hitPlayer(s, ev, p, Big.from(20), { attack: 'Spikes', source: 'Spike Trap', fromX: p.x, fromY: p.y, dtype: 'physical', hazard: true });
    const h = heroOf(runBreakdown(s));
    const row = (src: string) => h.sources.find((x) => x.src === src)!;
    expect(h.sources[0].src).toBe('Gloom Shade');   // sorted by damage
    expect(row('Gloom Shade').kind).toBe('foe');
    expect(row('Gloom Shade').hits).toBe(2);
    expect(row('Gloom Shade').atk.map((x) => x.n)).toEqual(['Shade Bolt', 'Shadow Burst']);
    expect(row(boss).kind).toBe('boss');
    expect(row('Hexed Ground').kind).toBe('curse');
    expect(row('Spike Trap').kind).toBe('hazard');
    const mitigated = Big.fromCompact(h.taken);
    expect(mitigated.gt(Big.ZERO)).toBe(true);
    let sum = Big.ZERO;
    for (const x of h.sources) sum = sum.add(Big.fromCompact(x.dmg));
    expect(sum.eq(mitigated)).toBe(true);
  });
});

describe('breakdown: death recap', () => {
  it('keeps the last few seconds before a fall, names the killing blow and the active debuffs', () => {
    const a = arena('vanguard', [], 'STATS_RECAP');
    const s = a.s;
    const p = s.players[0];
    p.iframes = 0;
    const ev: SimEvent[] = [];
    const hit = (amt: number, attack: string) => hitPlayer(s, ev, p, Big.from(amt), { attack, source: 'Gloom Shade', fromX: p.x + 1, fromY: p.y, dtype: 'astral' });
    p.hp = p.maxHp;
    hit(1, 'Ancient Bolt');                      // outside the window by the time of the fall
    s.tick += (RECAP_WINDOW_SEC + 1) * TICK_RATE;
    hit(2, 'Shade Bolt');
    s.tick += TICK_RATE;                         // a second later: a separate timeline entry
    hit(3, 'Shadow Burst');
    p.buffs.push({ id: 'blinded', until: s.tick + 60, value: 0 }, { id: 'rally', until: s.tick + 60, value: 0 });
    s.tick += TICK_RATE / 2;
    const lethal = p.hp.mul(Big.from(10));
    hitPlayer(s, ev, p, lethal, { attack: 'Void Bolt', source: 'Gloom Shade', fromX: p.x + 1, fromY: p.y, dtype: 'frost' });
    expect(p.lifeState).not.toBe('alive');
    const recapEv = ev.find((x) => x.t === 'recap');
    expect(recapEv).toBeTruthy();
    const r = (recapEv as Extract<SimEvent, { t: 'recap' }>).recap;
    expect(r.src).toBe('Gloom Shade');
    expect(r.atk).toBe('Void Bolt');
    expect(r.dt).toBe('frost');
    expect(r.hits.map((x) => x.atk)).toEqual(['Shade Bolt', 'Shadow Burst', 'Void Bolt']);   // 'Ancient Bolt' fell out of the window
    expect(r.hits[0].t).toBeCloseTo(-1.5, 5);
    expect(r.hits[r.hits.length - 1].t).toBe(0);
    for (const x of r.hits) expect(x.t).toBeGreaterThanOrEqual(-RECAP_WINDOW_SEC);
    expect(r.debuffs).toEqual(['blinded']);       // buffs are not debuffs
    expect(r.final).toBe(p.lifeState === 'dead');
    expect(runBreakdown(s)!.recaps).toHaveLength(1);
    expect(heroOf(runBreakdown(s)).downs + heroOf(runBreakdown(s)).deaths).toBe(1);
  });

  it('merges repeats of one attack (damage over time) and marks a bleed-out as a death', () => {
    const s = newRun(['vanguard', 'arcanist'], 'STATS_BLEED');
    runBot(s, { maxTicks: 60 * 20, untilRound: 1 });
    const p = s.players[0];
    p.iframes = 0;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 6; i++) { hitPlayer(s, ev, p, Big.from(1), { attack: 'Poison', source: 'Bile Toad', fromX: p.x, fromY: p.y, dtype: 'decay', hazard: true }); s.tick += 10; }
    hitPlayer(s, ev, p, p.hp.mul(Big.from(5)), { attack: 'Bile Glob', source: 'Bile Toad', fromX: p.x, fromY: p.y, dtype: 'decay' });
    expect(p.lifeState).toBe('downed');
    const down = (ev.find((x) => x.t === 'recap') as Extract<SimEvent, { t: 'recap' }>).recap;
    expect(down.final).toBe(false);
    expect(down.hits[0]).toMatchObject({ atk: 'Poison', n: 6 });
    // nobody revives: the downed timer runs out
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60 * 40 && p.lifeState === 'downed'; i++) evs.push(...stepIdle(s));
    expect(p.lifeState).toBe('dead');
    const bled = evs.find((x) => x.t === 'recap') as Extract<SimEvent, { t: 'recap' }> | undefined;
    expect(bled?.recap.final).toBe(true);
    expect(heroOf(runBreakdown(s)).deaths).toBe(1);
  });
});

function stepIdle(s: SimState): SimEvent[] {
  s.players[1].iframes = 1e9;   // the ally holds the attack button (no revive) and is never downed
  return step(s, s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: p.slot === 1 ? ACTION.ATTACK : 0 })), []).events;
}

/** runBot with counters that survive a checkpoint round trip (input sequence numbers are part of the state). */
function drive(s: SimState, ticks: number, ctr: { seq: number; vote: number }, after?: (s: SimState) => void) {
  for (let i = 0; i < ticks && s.phase !== 'RESULTS'; i++) {
    const cmds = s.players.flatMap((p) => botCommands(s, p.slot, ctr.vote));
    if (cmds.some((c) => c.type === 'VOTE')) ctr.vote++;
    step(s, s.phase === 'COMBAT' ? s.players.map((p) => botInput(s, p.slot, ++ctr.seq)) : [], cmds);
    after?.(s);
  }
}

describe('breakdown: never part of the replayed state', () => {
  it('state hashes do not depend on the breakdown, and replays rebuild the same breakdown', () => {
    const ticks = 60 * 50;
    const run3 = () => newRun(['berserker', 'warden'], 'STATS_HASH');
    const a = run3(), b = run3(), c = run3();
    drive(a, ticks, { seq: 0, vote: 1 });
    // b forgets its breakdown every tick (as if it had never been recorded)
    drive(b, ticks, { seq: 0, vote: 1 }, (s) => resetBreakdown(s));
    // c is restored from a checkpoint mid-run, carrying its breakdown the way the authority's checkpoint wrapper does
    const cc = { seq: 0, vote: 1 };
    drive(c, ticks / 2, cc);
    const tally = JSON.parse(JSON.stringify(runBreakdown(c)));
    const c2 = deserializeState(serializeState(c));
    restoreBreakdown(c2, tally);
    drive(c2, ticks / 2, cc);
    expect(stateHash(b)).toBe(stateHash(a));
    expect(stateHash(c2)).toBe(stateHash(a));
    expect(serializeState(a)).not.toContain('healDone');   // never inside the checkpointed state
    const ba = runBreakdown(a)!, bc = runBreakdown(c2)!;
    expect(Big.fromCompact(heroOf(ba).dealt).gt(Big.ZERO)).toBe(true);
    expect(Big.fromCompact(heroOf(bc).dealt).gte(Big.fromCompact(tally.heroes[0].dealt))).toBe(true);   // continued, not restarted
    // determinism: an identical run records an identical breakdown
    const d = run3();
    drive(d, ticks, { seq: 0, vote: 1 });
    expect(JSON.stringify(runBreakdown(d))).toBe(JSON.stringify(ba));
  });
});
