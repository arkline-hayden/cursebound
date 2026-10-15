import { performance } from 'node:perf_hooks';
import { TICK_RATE } from '@cursebound/content';
import { CLASS_IDS, arg, botTick, newRun, skipTo } from './common';

// CPU stress (npm run stress): a full party of five bots fights from a late round (default 12) onward with the densest
// populations; reports simulation milliseconds per tick (mean, p99, max) against the 60 Hz budget (16.7 ms).
// Options: --round R, --sec S (combat seconds to measure, default 60), --party a,b,c,d,e

const round = Number(arg('round', '12'));
const sec = Number(arg('sec', '60'));
const party = arg('party', CLASS_IDS.slice(0, 5).join(',')).split(',');
const st = newRun(party, 'STRESS_' + round);
const ctx = { seq: 0, voteSeq: 1 };
skipTo(st, round, ctx);
const times: number[] = [];
let peakEnemies = 0;
for (let t = 0; t < 2_000_000 && times.length < sec * TICK_RATE && st.phase !== 'RESULTS'; t++) {
  const combat = st.phase === 'COMBAT';
  for (const p of st.players) p.iframes = 1e9;   // keep the party alive: we measure the crowd, not the outcome
  const a = performance.now();
  botTick(st, ctx);
  if (combat) times.push(performance.now() - a);
  peakEnemies = Math.max(peakEnemies, st.enemies.length);
}
times.sort((x, y) => x - y);
const m = times.reduce((s, x) => s + x, 0) / Math.max(1, times.length);
const p99 = times[Math.floor(times.length * 0.99)] ?? 0;
console.log(`stress: party ${party.join('+')}, round ${round}, ${times.length} ticks, peak ${peakEnemies} enemy agents`);
console.log(`  ms/tick mean ${m.toFixed(3)}  p99 ${p99.toFixed(3)}  max ${(times[times.length - 1] ?? 0).toFixed(3)}  (budget ${(1000 / TICK_RATE).toFixed(1)})`);
