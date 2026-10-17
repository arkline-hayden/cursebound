'use client';

import { useEffect, useRef, useState } from 'react';
import { CLASSES, CLASS_BY_ID, contentHash } from '@cursebound/content';
import { createRun, step, type Command, type SimState } from '@cursebound/simulation';
import { netStore, type GameConnection, type PhaseData } from '@/lib/net';
import { SkillTree } from '@/ui/SkillTree';

// Dev preview of the skill tree (/dev/tree; never in production, see page.tsx). A local simulation run sits in its
// loadout phase with a deep purse of points; spending, refunds and mastery go through the real ALLOCATE / REFUND_ALL /
// MASTERY commands (tiers, prerequisites and choices enforced by the simulation) and the result is published into
// netStore as the authority would. Query: ?class=<id> (default vanguard) · ?points=<n> (default 40) ·
// ?spend=<node,node,...> pre-spends ranks in order.

function phaseOf(s: SimState): PhaseData {
  return {
    runId: s.runId, mode: s.mode, trust: s.trust, n: s.n, seed: s.seed, challengeId: null, tutorial: false, round: s.round, phase: 'LOADOUT_LOCK', deadlineTick: null, tick: s.tick,
    scoreText: s.scoreText, retire: [], lastClear: null, rounds: [], endReason: null, incident: null, resumed: false, storagePending: false, practice: true, boardKey: '',
    nextRound: 1, nextIsBoss: false, bossId: null, map: null, fate: [], deathRecaps: [],
    players: s.players.map((p) => ({
      slot: p.slot, name: p.name, classId: p.classId, ranks: { ...p.ranks }, skillPoints: p.skillPoints, spentByBranch: { ...p.spentByBranch }, mastery: { ...p.mastery },
      ready: false, hpT: '1', mhpT: '1', connected: true, life: 'alive', canMastery: false,
    })),
  };
}

export default function TreePreview() {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [classId, setClassId] = useState(() => (CLASS_BY_ID[q.get('class') ?? ''] ? q.get('class')! : 'vanguard'));
  const sim = useRef<SimState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const points = Math.max(0, Number(q.get('points') ?? 40) || 0);
    const s = createRun({ runId: 'run_tree_preview', seed: 'TREE_PREVIEW', mode: 'solo', trust: 'local', contentHash: contentHash(), roster: [{ slot: 0, profileId: 'p0', name: 'Hayden', classId }] });
    s.players[0].skillPoints = points;
    const spend = (q.get('spend') ?? '').split(',').filter(Boolean);
    if (spend.length) step(s, [], spend.map((nodeId): Command => ({ type: 'ALLOCATE', slot: 0, nodeId })));
    sim.current = s;
    netStore.set({ status: 'open', slot: 0, phase: phaseOf(s) });
    setReady(true);
  }, [classId]);   // the query is read once per class switch

  const run = (cmd: Command) => {
    const s = sim.current;
    if (!s) return;
    step(s, [], [cmd]);
    netStore.set({ phase: phaseOf(s) });
  };
  const net = {
    allocate: (nodeId: string) => run({ type: 'ALLOCATE', slot: 0, nodeId }),
    refund: () => run({ type: 'REFUND_ALL', slot: 0 }),
    mastery: (choice: 'damage' | 'health' | 'recovery') => run({ type: 'MASTERY', slot: 0, choice }),
    ready: () => undefined,
  } as unknown as GameConnection;

  return (
    <>
      <div style={{ position: 'fixed', top: 4, left: 4, zIndex: 50, display: 'flex', gap: 4 }}>
        {CLASSES.map((c) => <button key={c.id} className={`btn small ${c.id === classId ? 'primary' : 'ghost'}`} onClick={() => setClassId(c.id)}>{c.name}</button>)}
      </div>
      {ready && <SkillTree key={classId} net={net} />}
    </>
  );
}
