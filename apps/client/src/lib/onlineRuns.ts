import { accountApi } from './api';

// Online mode (docs/contracts/ONLINE_CONTRACT.md "Run summaries"): every signed-in participant reports a finished run
// to the cloud once; the cloud dedupes reports of the same run and lets each reporter claim only their own slot.

interface ResultsPlayer { slot: number; name: string; classId: string; ranks: Record<string, number>; mastery?: unknown }
export interface RunResults {
  runId: string; boardKey: string; scoreText: string; depth: number; round: number; activeTicks: number; mode: string; n: number;
  challengeId: string | null; practice: boolean; endReason: string | null; players: ResultsPlayer[];
}

const UNFINISHED = new Set(['aborted_infrastructure', 'invalidated']);
const submitted = new Map<string, Promise<{ rank: number | null } | null>>();

/** The final builds, with the caller's own player marked, as `/builds/from-run` and `/runs` expect them. */
export function cloudSummary(r: RunResults, mySlot: number, accountId: string) {
  return {
    runId: r.runId, round: r.round, endReason: r.endReason,
    players: r.players.map((p) => ({ slot: p.slot, name: p.name, classId: p.classId, ranks: p.ranks, mastery: p.mastery ?? null, ...(p.slot === mySlot ? { accountId } : {}) })),
  };
}

/** Report the run once per page session (re-renders and remounts reuse the first report). */
export function submitRunOnce(r: RunResults, mySlot: number, accountId: string): Promise<{ rank: number | null } | null> {
  if (UNFINISHED.has(r.endReason ?? '')) return Promise.resolve(null);
  const key = `${accountId}:${r.runId}`;
  let p = submitted.get(key);
  if (!p) {
    p = accountApi<{ rank: number | null }>('POST', '/runs', {
      runId: r.runId, boardKey: r.boardKey, scoreText: r.scoreText, depth: r.depth, activeTicks: r.activeTicks, mode: r.mode, n: r.n,
      challengeId: r.challengeId, practice: r.practice,
      participants: r.players.map((x) => ({ accountId: x.slot === mySlot ? accountId : null, name: x.name, classId: x.classId })),
      summary: cloudSummary(r, mySlot, accountId),
    }).then((x) => ({ rank: x.rank }), () => {
      submitted.delete(key); // allow a retry on the next visit
      return null;
    });
    submitted.set(key, p);
  }
  return p;
}
