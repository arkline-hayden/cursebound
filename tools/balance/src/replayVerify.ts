import { deserializeState, serializeState, stateHash } from '@cursebound/simulation';
import { BOUNTY_MODIFIERS } from '@cursebound/content';
import { CLASS_IDS, arg, botTick, newRun } from './common';

// Replay verification (npm run replay:verify): the same seed and bot inputs must reproduce the same state hash, and
// a run restored from a mid-run checkpoint must continue to the identical hash. Exit code 1 on any mismatch.
// Every daily bounty modifier is verified the same way on a solo run (a quarter of the ticks each).
// Options: --ticks N (default 20000), --party a,b, --bounty all|none|<id> (default all)

const ticks = Number(arg('ticks', '20000'));
const parties = arg('party', '') ? [arg('party', '').split(',')] : [['vanguard'], ['arcanist'], CLASS_IDS.slice(2, 5), CLASS_IDS.slice(5, 10)];
const bountyArg = arg('bounty', 'all');
const bounties = bountyArg === 'none' ? [] : bountyArg === 'all' ? BOUNTY_MODIFIERS.map((m) => m.id) : [bountyArg];
const cases: { party: string[]; bounty: string | null; ticks: number }[] = [
  ...parties.map((party) => ({ party, bounty: null, ticks })),
  ...bounties.map((bounty) => ({ party: parties[0], bounty, ticks: Math.ceil(ticks / 4) })),
];
let bad = 0;
for (const { party, bounty, ticks } of cases) {
  const seed = 'REPLAY_' + party.join('_');
  const a = newRun(party, seed, bounty), b = newRun(party, seed, bounty);
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
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${(party.join('+') + (bounty ? ` [bounty ${bounty}]` : '')).padEnd(40)} round ${a.round} ${a.phase.padEnd(16)} ${ha.slice(0, 16)}${ok ? '' : ' != ' + hb.slice(0, 16)}`);
}
if (bad) { console.error(`${bad} replay mismatch(es)`); process.exit(1); }
console.log('replay verify: all runs reproduce');
