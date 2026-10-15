import { deserializeState, serializeState, stateHash } from '@cursebound/simulation';
import { CLASS_IDS, arg, botTick, newRun } from './common';

// Replay verification (npm run replay:verify): the same seed and bot inputs must reproduce the same state hash, and
// a run restored from a mid-run checkpoint must continue to the identical hash. Exit code 1 on any mismatch.
// Options: --ticks N (default 20000), --party a,b

const ticks = Number(arg('ticks', '20000'));
const parties = arg('party', '') ? [arg('party', '').split(',')] : [['vanguard'], ['arcanist'], CLASS_IDS.slice(2, 5), CLASS_IDS.slice(5, 10)];
let bad = 0;
for (const party of parties) {
  const seed = 'REPLAY_' + party.join('_');
  const a = newRun(party, seed), b = newRun(party, seed);
  const ca = { seq: 0, voteSeq: 1 }, cb = { seq: 0, voteSeq: 1 };
  let restored = b;
  for (let t = 0; t < ticks; t++) {
    botTick(a, ca);
    botTick(restored, cb);
    if (t === Math.floor(ticks / 2)) restored = deserializeState(serializeState(restored));   // checkpoint round trip mid-run
  }
  const ha = stateHash(a), hb = stateHash(restored);
  const ok = ha === hb;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${party.join('+').padEnd(40)} round ${a.round} ${a.phase.padEnd(16)} ${ha.slice(0, 16)}${ok ? '' : ' != ' + hb.slice(0, 16)}`);
}
if (bad) { console.error(`${bad} replay mismatch(es)`); process.exit(1); }
console.log('replay verify: all runs reproduce');
