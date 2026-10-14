import { contentHash } from '@cursebound/content';
import { createRun, stateHash, step, type Command, type CreateRunParams, type PlayerInput, type SimState } from '@cursebound/simulation';

// Reference replay (PRD §2.2 "technical trust", §27.2): the same seed and accepted inputs reproduce the score exactly.

interface JournalTick { t: number; i?: [number, number, number, number, number, number, number][]; c?: Command[] }
interface Journal { v: 1; runId: string; header?: CreateRunParams; resumeFrom?: { tick: number }; ticks: JournalTick[] }

export interface ReplayResult {
  ok: boolean;
  reason: string;
  scoreText: string | null;
  expectedScore: string | null;
  stateHash: string | null;
  expectedHash: string | null;
  ticks: number;
  ms: number;
}

export function replayJournals(chunks: string[], expected: { scoreText?: string; finalStateHash?: string } = {}): ReplayResult {
  const t0 = Date.now();
  const journals = chunks.map((c) => JSON.parse(c) as Journal);
  if (!journals.length || !journals[0].header) return { ok: false, reason: 'missing replay header (chunk 0)', scoreText: null, expectedScore: expected.scoreText ?? null, stateHash: null, expectedHash: expected.finalStateHash ?? null, ticks: 0, ms: 0 };
  const header = journals[0].header;
  if (header.contentHash !== contentHash()) return { ok: false, reason: `content hash mismatch (run ${header.contentHash}, build ${contentHash()}); archived simulation version required`, scoreText: null, expectedScore: expected.scoreText ?? null, stateHash: null, expectedHash: expected.finalStateHash ?? null, ticks: 0, ms: 0 };
  const state: SimState = createRun(header);
  const byTick = new Map<number, JournalTick>();
  const resumeTicks = new Set<number>();
  let lastTick = 0;
  for (const j of journals) {
    if (j.resumeFrom) resumeTicks.add(j.resumeFrom.tick);
    for (const t of j.ticks) { byTick.set(t.t, t); if (t.t > lastTick) lastTick = t.t; }
  }
  // the recorded final hash is taken when the run enters FINALIZE (before the durable acknowledgement)
  for (let tick = 0; tick <= lastTick + 2 && state.phase !== 'FINALIZE' && state.phase !== 'RESULTS'; tick++) {
    if (state.tick !== tick) return fail(`tick drift at ${tick} (state ${state.tick})`);
    if (resumeTicks.has(tick)) { state.resumed = true; for (const p of state.players) { p.connected = false; p.disconnectedAtTick = tick; } }
    const jt = byTick.get(tick);
    const inputs: (PlayerInput | null)[] = new Array(state.n).fill(null);
    for (const [slot, seq, mx, my, ax, ay, b] of jt?.i ?? []) inputs[slot] = { seq, moveX: mx, moveY: my, aimX: ax, aimY: ay, buttons: b };
    step(state, inputs, jt?.c ?? []);
  }
  const hash = stateHash(state);
  const scoreOk = expected.scoreText === undefined || expected.scoreText === state.scoreText;
  const hashOk = expected.finalStateHash === undefined || expected.finalStateHash === hash;
  return {
    ok: scoreOk && hashOk, reason: scoreOk ? (hashOk ? 'replay reproduced the recorded score and state' : 'score matched but final state hash differs') : 'score mismatch',
    scoreText: state.scoreText, expectedScore: expected.scoreText ?? null, stateHash: hash, expectedHash: expected.finalStateHash ?? null, ticks: state.tick, ms: Date.now() - t0,
  };
  function fail(reason: string): ReplayResult {
    return { ok: false, reason, scoreText: state.scoreText, expectedScore: expected.scoreText ?? null, stateHash: null, expectedHash: expected.finalStateHash ?? null, ticks: state.tick, ms: Date.now() - t0 };
  }
}
