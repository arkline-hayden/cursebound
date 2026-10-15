'use client';

import { useEffect, useRef, useState } from 'react';
import { CARD_BY_ID, TUTORIAL_CARD } from '@cursebound/content';
import { netStore } from '@/lib/net';
import { useStore } from '@/lib/store';

// Screen reader announcements for phase and vote changes (REQ ACCESS01) and captions for critical audio cues.

const PHASE_TEXT: Record<string, string> = {
  LOADOUT_LOCK: 'Loadout. Your skills are ready. Spend your point, then begin round 1.',
  ROUND_SETUP: 'Round starting.',
  COMBAT: 'Combat.',
  ROUND_CLEAR: 'Round cleared.',
  SKILL_ALLOCATION: 'Intermission: spend skill points.',
  VOTING: 'Fate offer: choose one of three cards.',
  FATE_COMMIT: 'Fate choice recorded.',
  PARTY_WIPE: 'Party wiped.',
  FINALIZE: 'Run ending.',
  RESULTS: 'Results.',
  RECOVERY: 'Technical recovery.',
};

export function Announcer() {
  const phase = useStore(netStore, (s) => s.phase);
  const votes = useStore(netStore, (s) => s.votes);
  const commit = useStore(netStore, (s) => s.commit);
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const [caption, setCaption] = useState<string | null>(null);
  const last = useRef('');
  useEffect(() => {
    if (!phase) return;
    const key = `${phase.phase}:${phase.round}`;
    if (key === last.current) return;
    last.current = key;
    setPolite(`Round ${phase.round}. ${PHASE_TEXT[phase.phase] ?? phase.phase}`);
  }, [phase]);
  useEffect(() => {
    if (!votes) return;
    setPolite(`Votes: ${votes.counts.map((c, i) => `card ${i + 1}: ${c}`).join(', ')}. ${votes.votes.filter((v) => v.locked).length} locked.`);
  }, [votes]);
  useEffect(() => {
    if (!commit) return;
    const name = commit.cardId === TUTORIAL_CARD.id ? TUTORIAL_CARD.name : CARD_BY_ID[commit.cardId]?.name ?? commit.cardId;
    setAssertive(`The party chose ${name}.`);
  }, [commit]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      setCaption(text);
      setAssertive(text);
      if (t) clearTimeout(t);
      t = setTimeout(() => setCaption(null), 1600);
    };
    window.addEventListener('cursebound:caption', on);
    return () => window.removeEventListener('cursebound:caption', on);
  }, []);
  return (
    <>
      <div className="sr-only" aria-live="polite" role="status">{polite}</div>
      <div className="sr-only" aria-live="assertive" role="alert">{assertive}</div>
      {caption && <div aria-hidden="true" className="caption">[{caption}]</div>}
    </>
  );
}
