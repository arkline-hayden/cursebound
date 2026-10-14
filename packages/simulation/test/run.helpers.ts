import { contentHash } from '@cursebound/content';
import { botCommands, botInput, createRun, step, type SimEvent, type SimState } from '@cursebound/simulation';

export function newRun(classes: string[], seed = 'CURSEBOUND_TEST_001', extra: Partial<Parameters<typeof createRun>[0]> = {}) {
  return createRun({
    runId: 'run_' + seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 20), seed, mode: classes.length > 1 ? 'coop' : 'solo', trust: 'local', contentHash: contentHash(),
    roster: classes.map((c, i) => ({ slot: i, profileId: 'p' + i, name: 'P' + i, classId: c })), ...extra,
  });
}

export function runBot(state: SimState, opts: { maxTicks: number; untilRound?: number; pick?: (cards: string[]) => number; onEvents?: (ev: SimEvent[], s: SimState) => void }) {
  let seq = 0;
  let voteSeq = 1;
  for (let i = 0; i < opts.maxTicks; i++) {
    if (state.phase === 'RESULTS') break;
    if (opts.untilRound && state.round >= opts.untilRound && state.phase === 'COMBAT') break;
    const cmds = state.players.flatMap((p) => botCommands(state, p.slot, voteSeq, opts.pick));
    if (cmds.some((c) => c.type === 'VOTE')) voteSeq++;
    const inputs = state.phase === 'COMBAT' ? state.players.map((p) => botInput(state, p.slot, ++seq)) : [];
    const r = step(state, inputs, cmds);
    opts.onEvents?.(r.events, state);
  }
  return state;
}
