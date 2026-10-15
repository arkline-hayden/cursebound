import { writeFileSync } from 'node:fs';
import { CLASS_BY_ID, TICK_RATE, isBossRound } from '@cursebound/content';
import type { SimState } from '@cursebound/simulation';
import { CLASS_IDS, arg, botTick, f1, mean, newRun, pct, skipTo } from './common';

// Balance harness (npm run balance). Seeded bot runs, three benches:
//  - early: solo, every class, natural rounds 1..4 (clear time, damage taken, downs, wipes)
//  - late:  solo, every class, skip to round 8 and play rounds 8..9
//  - boss:  skip to a boss round (5 and 10) and fight it, solo per class and as mixed parties of three
// Options: --seeds N (default 3), --classes a,b, --bench early,late,boss, --out file.json

/** outcome: clear, wipe (party down), stall (bot found no path to the last foes before the time cap) */
interface RoundStat { round: number; cleared: boolean; outcome: 'clear' | 'wipe' | 'stall'; sec: number; dmgTakenFrac: number; downs: number }

function playRounds(state: SimState, lastRound: number, ctx: { seq: number; voteSeq: number }, capSec = 240): RoundStat[] {
  const out: RoundStat[] = [];
  let cur: RoundStat | null = null;
  let ticks = 0;
  const taken0: number[] = [];
  const maxHp = () => state.players.reduce((s, p) => s + p.maxHp.toNumber(), 0);
  const takenNow = () => state.players.reduce((s, p, i) => s + p.stats.damageTaken.toNumber() - (taken0[i] ?? 0), 0);
  for (let i = 0; i < 3_000_000; i++) {
    if (state.phase === 'RESULTS' || state.phase === 'FINALIZE') break;
    if (state.phase === 'COMBAT' && !cur) {
      if (state.round > lastRound) break;
      cur = { round: state.round, cleared: false, outcome: 'stall', sec: 0, dmgTakenFrac: 0, downs: 0 };
      ticks = 0;
      state.players.forEach((p, k) => { taken0[k] = p.stats.damageTaken.toNumber(); });
    }
    const ev = botTick(state, ctx);
    if (cur) {
      ticks++;
      for (const e of ev) {
        if (e.t === 'downed') cur.downs++;
      }
      const ended = state.phase !== 'COMBAT';
      if (ended || ticks > capSec * TICK_RATE) {
        cur.cleared = state.phase === 'ROUND_CLEAR';
        cur.outcome = cur.cleared ? 'clear' : ended ? 'wipe' : 'stall';
        cur.sec = ticks / TICK_RATE;
        cur.dmgTakenFrac = takenNow() / Math.max(1, maxHp());
        out.push(cur);
        cur = null;
        if (!ended) break;   // timed out: stop this run
      }
    }
  }
  return out;
}

function benchSolo(cls: string, seeds: number, from: number, to: number) {
  const rows: RoundStat[] = [];
  let wipes = 0, stalls = 0;
  for (let s = 0; s < seeds; s++) {
    const st = newRun([cls], `BAL_${cls}_${from}_${s}`);
    const ctx = { seq: 0, voteSeq: 1 };
    if (from > 1) skipTo(st, from, ctx);
    const r = playRounds(st, to, ctx);
    rows.push(...r);
    if (r.some((x) => x.outcome === 'wipe')) wipes++;
    if (r.some((x) => x.outcome === 'stall')) stalls++;
  }
  const ord = rows.filter((r) => !isBossRound(r.round) && r.outcome !== 'stall');
  const cl = ord.filter((r) => r.cleared);
  return {
    cls, melee: !!CLASS_BY_ID[cls].melee, rounds: ord.length, wipes, stalls, wipeRate: wipes / seeds,
    clearSec: mean(cl.map((r) => r.sec)),
    dmgTakenPerMin: mean(ord.map((r) => r.dmgTakenFrac / Math.max(1e-9, r.sec / 60))),
    downsPerRound: mean(ord.map((r) => r.downs)),
  };
}

function benchBoss(party: string[], round: number, seed: string) {
  const st = newRun(party, seed);
  const ctx = { seq: 0, voteSeq: 1 };
  skipTo(st, round, ctx);
  const bossId = st.encounter?.bossId ?? '?';
  const r = playRounds(st, round, ctx, 240)[0];
  return { party: party.join('+'), round, bossId, win: !!r?.cleared, sec: r?.sec ?? 0, dmgTakenFrac: r?.dmgTakenFrac ?? 0, downs: r?.downs ?? 0 };
}

const seeds = Number(arg('seeds', '3'));
const classes = arg('classes', CLASS_IDS.join(',')).split(',');
const benches = arg('bench', 'early,late,boss').split(',');
const result: Record<string, unknown> = {};
const t0 = Date.now();

for (const [name, from, to] of [['early', 1, 4], ['late', 8, 9]] as const) {
  if (!benches.includes(name)) continue;
  const rows = classes.map((c) => benchSolo(c, seeds, from, to));
  result[name] = rows;
  console.log(`\n== ${name}: solo rounds ${from}..${to}, ${seeds} seeds ==`);
  console.log('class        melee  wipes  stalls  clear(s)  dmgTaken/min(xMaxHP)  downs/round');
  for (const r of rows) console.log(`${r.cls.padEnd(12)} ${(r.melee ? 'yes' : 'no').padEnd(6)} ${pct(r.wipeRate).padStart(5)}  ${String(r.stalls).padStart(6)}  ${f1(r.clearSec).padStart(8)}  ${f1(r.dmgTakenPerMin).padStart(20)}  ${r.downsPerRound.toFixed(2).padStart(11)}`);
  for (const m of [true, false]) {
    const g = rows.filter((r) => r.melee === m);
    console.log(`  ${m ? 'MELEE ' : 'RANGED'} avg: wipes ${pct(mean(g.map((r) => r.wipeRate)))}, clear ${f1(mean(g.map((r) => r.clearSec)))}s, dmgTaken/min ${f1(mean(g.map((r) => r.dmgTakenPerMin)))}`);
  }
}

if (benches.includes('boss')) {
  const rows: ReturnType<typeof benchBoss>[] = [];
  for (const round of [5, 10]) {
    for (const c of classes) for (let s = 0; s < seeds; s++) rows.push(benchBoss([c], round, `BOSS_${c}_${round}_${s}`));
    for (let s = 0; s < seeds * 2; s++) {
      const party = [0, 1, 2].map((k) => classes[(s * 3 + k) % classes.length]);
      rows.push(benchBoss(party, round, `BOSSP_${round}_${s}`));
    }
  }
  result.boss = rows;
  console.log(`\n== boss: rounds 5 and 10, solo per class x ${seeds} seeds + ${seeds * 2} parties of 3 ==`);
  for (const round of [5, 10]) for (const kind of ['solo', 'party']) {
    const g = rows.filter((r) => r.round === round && (kind === 'solo' ? !r.party.includes('+') : r.party.includes('+')));
    const w = g.filter((r) => r.win);
    console.log(`round ${String(round).padStart(2)} ${kind.padEnd(5)}: win ${pct(g.length ? w.length / g.length : 0).padStart(4)} (${w.length}/${g.length}), kill time ${f1(mean(w.map((r) => r.sec)))}s, dmgTaken ${f1(mean(g.map((r) => r.dmgTakenFrac)))}x maxHP, downs ${mean(g.map((r) => r.downs)).toFixed(2)}`);
    for (const b of ['prismstag', 'bellroot']) {
      const gb = g.filter((r) => r.bossId === b);
      if (!gb.length) continue;
      const wb = gb.filter((r) => r.win);
      console.log(`    ${b.padEnd(10)} win ${pct(wb.length / gb.length).padStart(4)} (${wb.length}/${gb.length}), kill ${f1(mean(wb.map((r) => r.sec)))}s, dmgTaken/sec ${(mean(gb.map((r) => r.dmgTakenFrac / Math.max(1, r.sec)))).toFixed(3)}x maxHP`);
    }
  }
  for (const m of [true, false]) {
    const g = rows.filter((r) => !r.party.includes('+') && !!CLASS_BY_ID[r.party].melee === m);
    console.log(`  ${m ? 'MELEE ' : 'RANGED'} solo boss win ${pct(mean(g.map((r) => (r.win ? 1 : 0))))}`);
  }
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const out = arg('out', '');
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
