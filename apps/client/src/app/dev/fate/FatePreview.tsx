'use client';

import { useEffect, useRef, useState } from 'react';
import { TICK_RATE, contentHash } from '@cursebound/content';
import { buildSnapshot, computeForecast, createRun, killEnemy, step, type OfferForecast, type SimState } from '@cursebound/simulation';
import { netStore, type GameConnection, type PhaseData } from '@/lib/net';
import { DoorPanel } from '@/ui/DoorPanel';

// Dev preview of the Fate card spread (/dev/fate; never in production, see page.tsx). A mock room: the real
// simulation is driven to its first door vote (real map, doors and Forecast), then its offer is re-dressed with the
// themes and cards picked here and published into netStore exactly as the authority would. The mock connection
// answers votes like the authority (solo: a sealed vote commits; co-op: when every hero has sealed), plays the
// walk-through gate for 2.6 s and deals again.
// Query: ?set=0..3 (theme triples) or ?themes=a,b,c · ?mix=mixed|common|rare|mythic|longest · ?coop=1 · ?timer=1 ·
// ?tools=1 opens the dev controls (the "dev" button in the top-left corner toggles them)

const SETS: string[][] = [
  ['catacombs', 'flooded', 'ossuary'],
  ['sanctum', 'fungal', 'forge'],
  ['frost', 'sky', 'moon'],
  ['server', 'catacombs', 'sanctum'],
];
const MIXES: Record<string, string[]> = {
  mixed: ['vampiric_rite', 'phoenix_heart', 'blood_pact'],
  common: ['blood_pact', 'wild_transit', 'thorn_covenant'],
  rare: ['static_trail', 'crimson_wager', 'executioner'],
  mythic: ['stormcaller', 'sanguine_crown', 'the_wild_hunt'],
  /** the longest real texts: two mechanics, two stat lines, a party warning and a quote */
  longest: ['prismatic_storm', 'aegis_of_ruin', 'berserkers_requiem'],
};
const ROSTER = [
  { slot: 0, profileId: 'p0', name: 'Hayden', classId: 'vanguard' },
  { slot: 1, profileId: 'p1', name: 'Morrow', classId: 'arcanist' },
  { slot: 2, profileId: 'p2', name: 'Vex', classId: 'ranger' },
];

function toVoting(coop: boolean): SimState {
  const s = createRun({ runId: 'run_fate_preview', seed: 'FATE_PREVIEW', mode: coop ? 'coop' : 'solo', trust: 'local', contentHash: contentHash(), roster: coop ? ROSTER : ROSTER.slice(0, 1) });
  for (let n = 0; n < 200000 && s.phase !== 'VOTING'; n++) {
    const cmds: Parameters<typeof step>[2] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'COMBAT') { for (const p of s.players) p.iframes = 10; for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0); }
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    step(s, [], cmds);
  }
  return s;
}

function phaseOf(s: SimState, phase: string): PhaseData {
  return {
    runId: s.runId, mode: s.mode, trust: s.trust, n: s.n, seed: s.seed, challengeId: null, tutorial: false, round: s.round, phase, deadlineTick: s.offer?.deadlineTick ?? null, tick: s.tick,
    scoreText: s.scoreText, retire: [], lastClear: null, rounds: [], endReason: null, incident: null, resumed: false, storagePending: false, practice: true, boardKey: '',
    nextRound: s.round + 1, nextIsBoss: (s.round + 1) % 5 === 0, bossId: null, map: s.map ? ({ theme: s.map.theme } as PhaseData['map']) : null, fate: [], deathRecaps: [],
    players: s.players.map((p) => ({ slot: p.slot, name: p.name, classId: p.classId, ranks: {}, skillPoints: 0, spentByBranch: {}, mastery: { damage: 0, health: 0, recovery: 0 }, ready: true, hpT: '1', mhpT: '1', connected: true, life: 'alive', canMastery: false })),
  } as unknown as PhaseData;
}

export default function FatePreview() {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [setIdx, setSetIdx] = useState(Number(q.get('set') ?? 0) % SETS.length);
  const [custom] = useState<string[] | null>(() => q.get('themes')?.split(',').slice(0, 3) ?? null);
  const [mix, setMix] = useState(q.get('mix') && MIXES[q.get('mix')!] ? q.get('mix')! : 'mixed');
  const [coop, setCoop] = useState(q.get('coop') === '1');
  const [timer, setTimer] = useState(q.get('timer') === '1');
  const [deal, setDeal] = useState(0);
  const [blessings, setBlessings] = useState(1);
  const [ready, setReady] = useState(false);
  const [tools, setTools] = useState(q.get('tools') === '1');
  const sim = useRef<SimState | null>(null);
  const tick = useRef(0);
  const offerN = useRef(0);
  const themes = custom ?? SETS[setIdx]!;

  const publish = (patch: Partial<ReturnType<typeof netStore.get>> = {}) => {
    const s = sim.current!;
    const snap = buildSnapshot(s);
    snap.players.forEach((p) => { if (p.s === 0) p.bl = blessings; });
    const o = s.offer!;
    netStore.set({
      status: 'open', slot: 0, serverTick: tick.current,
      phase: phaseOf(s, 'VOTING'),
      offer: { offerId: o.id, round: o.round, cardIds: o.cards, snapshotHash: o.snapshotHash, deadlineTick: o.deadlineTick, forecast: computeForecast(s) as OfferForecast, themes: o.themes },
      votes: { offerId: o.id, votes: o.votes.map((v) => ({ slot: v.slot, cardSlot: v.cardSlot, locked: v.locked })), counts: [0, 0, 0], deadlineTick: o.deadlineTick, tick: tick.current },
      hud: { ...snap, phase: 'VOTING' },
      ...patch,
    });
  };

  // a fresh room / offer whenever the knobs change
  useEffect(() => {
    if (!sim.current || (sim.current.mode === 'coop') !== coop) sim.current = toVoting(coop);
    const s = sim.current;
    const o = s.offer!;
    offerN.current++;
    o.id = `preview_${offerN.current}`;
    o.cards = MIXES[mix]!.slice();
    o.themes = themes.slice();
    o.blessed = [];
    o.votes = s.players.map((p) => ({ slot: p.slot, seq: 0, cardSlot: null, locked: false }));
    o.deadlineTick = timer ? tick.current + 45 * TICK_RATE : null;
    if (s.doors) s.doors.list.forEach((d, i) => { d.th = themes[i]!; d.c = o.cards[i]!; });
    if (s.doors) s.doors.chosen = null;
    netStore.set({ commit: null, myVote: { cardSlot: null, locked: false, pending: false, seq: 0 } });
    publish();
    setReady(true);
  }, [setIdx, mix, coop, timer, deal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?scrub=<ms>: show the deal exactly <ms> in, frozen (CSS animations seeked, the landing dust stepped by hand), for
  // frame captures. Deterministic: no dependence on timers or frame pacing.
  useEffect(() => {
    if (q.get('scrub') === null) return;
    const ms = Number(q.get('scrub')) || 0;
    const w = window as unknown as { __fateHold?: boolean; __fateFx?: { freeze(): void; advance(s: number): void; dust(t: string, r: DOMRect): void } };
    w.__fateHold = true;
    let t = 0;
    // ?vw=<px>: headless captures resize the window after load; wait for the final viewport before freezing
    const vw = Number(q.get('vw')) || 0;
    const settle = (fn: () => void, tries = 0) => {
      if (window.innerWidth >= vw || tries > 60) { window.dispatchEvent(new Event('resize')); t = window.setTimeout(fn, 80); }
      else t = window.setTimeout(() => settle(fn, tries + 1), 50);
    };
    const mo = new MutationObserver(() => {
      if (!document.querySelector('[aria-label="Choose your Fate"] [data-fate-card]')) return;
      mo.disconnect();
      settle(() => {
        for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
        const fx = w.__fateFx;
        const slots = Array.from(document.querySelectorAll('[aria-label="Choose your Fate"] [data-state]'));
        // replay the landings in order (each card's dust aged by its own time since impact)
        let cursor = -1;
        slots.forEach((s, k) => {
          const land = 120 + k * 360 + 380;   // FateCards TOSS + k * STAGGER + LAND
          if (!fx || ms < land || ms - land > 1200) return;
          if (cursor >= 0) fx.advance((land - cursor) / 1000);
          fx.dust(themes[k]!, s.getBoundingClientRect());
          cursor = land;
        });
        fx?.freeze();
        if (fx && cursor >= 0) fx.advance((ms - cursor) / 1000);
        // headless captures can miss canvas commits: pin each particle canvas's frame as an image in its place
        for (const c of Array.from(document.querySelectorAll('[aria-label="Choose your Fate"] canvas')) as HTMLCanvasElement[]) {
          const img = document.createElement('img');
          img.src = c.toDataURL();
          const cs = getComputedStyle(c);
          img.style.cssText = `position:${cs.position};left:0;top:0;width:${c.getBoundingClientRect().width}px;height:${c.getBoundingClientRect().height}px;z-index:${cs.zIndex};image-rendering:pixelated;pointer-events:none`;
          c.after(img);
        }
        document.documentElement.dataset.scrubbed = '1';   // capture scripts wait for this
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); window.clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the authority's clock (the countdown)
  useEffect(() => {
    const t = window.setInterval(() => { tick.current += 1; netStore.set({ serverTick: tick.current }); }, 1000 / TICK_RATE);
    return () => window.clearInterval(t);
  }, []);

  const commitTo = (i: number) => {
    const s = sim.current!, o = s.offer!;
    const st = netStore.get();
    window.setTimeout(() => {
      netStore.set({
        commit: { t: 'COMMIT', eventId: 1, offerId: o.id, cardId: o.cards[i]!, cardSlot: i, tieEvidence: null, newStateHash: '', durable: true },
        phase: { ...st.phase!, phase: 'FATE_COMMIT' },
        hud: { ...st.hud!, phase: 'FATE_COMMIT', doors: st.hud!.doors?.map((d) => (d.i === i ? { ...d, sel: 1 as const, hold: 1 } : d)) },
      });
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('cursebound:cinematic', { detail: { active: true, kind: 'door' } })), 40);
      window.setTimeout(() => { window.dispatchEvent(new CustomEvent('cursebound:cinematic', { detail: { active: false, kind: 'door' } })); setDeal((d) => d + 1); }, 3200);
    }, 60);
  };

  const net = {
    vote(cardSlot: number | null, locked: boolean) {
      const s = sim.current!, o = s.offer!;
      netStore.set((st) => ({ myVote: { cardSlot, locked, pending: false, seq: st.myVote.seq + 1 } }));
      const v = o.votes.find((x) => x.slot === 0)!;
      v.cardSlot = cardSlot; v.locked = locked;
      publish({ myVote: netStore.get().myVote });
      if (locked && cardSlot !== null && o.votes.every((x) => x.locked)) commitTo(cardSlot);
    },
    bless(cardSlot: number) {
      const o = sim.current!.offer!;
      o.blessed = [...(o.blessed ?? []), { card: cardSlot, slot: 0 }];
      setBlessings((b) => Math.max(0, b - 1));
      publish({ myVote: netStore.get().myVote });
    },
  } as unknown as GameConnection;

  /** co-op mock: teammate `slot` leans to / seals / stands in card `i` */
  const mate = (slot: number, i: number, how: 'lean' | 'seal' | 'stand') => {
    const s = sim.current!, o = s.offer!;
    const v = o.votes.find((x) => x.slot === slot);
    if (!v) return;
    if (how === 'stand') {
      const p = s.players.find((x) => x.slot === slot), d = s.doors?.list[i];
      if (p && d) { p.x = d.x; p.y = d.y; }
    } else { v.cardSlot = i; v.locked = how === 'seal'; }
    publish({ myVote: netStore.get().myVote });
    if (o.votes.every((x) => x.locked)) commitTo(o.votes[0]!.cardSlot ?? i);
  };

  return (
    <div className="game-root" style={{ position: 'fixed', inset: 0, background: 'var(--px-stone-dark) 0 0 / 64px 64px repeat, #0a0707', backgroundBlendMode: 'multiply' }}>
      {ready && <DoorPanel net={net} onLedger={() => undefined} />}
      {/* dev controls: a corner toggle (collapsed by default) so the cards stay clear for screenshots */}
      <button className="btn small ghost" style={{ position: 'fixed', left: 4, top: 4, zIndex: 81, opacity: 0.55 }} onClick={() => setTools((v) => !v)}>dev</button>
      {tools && <div style={{ position: 'fixed', left: 4, top: 52, zIndex: 80, display: 'flex', flexDirection: 'column', gap: 4, width: 220 }} data-dev-controls>
        {SETS.map((t, k) => <button key={k} className="btn small" aria-pressed={setIdx === k} onClick={() => setSetIdx(k)}>{t.map((x) => x.slice(0, 4)).join('/')}</button>)}
        {Object.keys(MIXES).map((m) => <button key={m} className="btn small" aria-pressed={mix === m} onClick={() => setMix(m)}>{m}</button>)}
        <button className="btn small" onClick={() => setCoop((c) => !c)}>{coop ? 'co-op' : 'solo'}</button>
        <button className="btn small" onClick={() => setTimer((c) => !c)}>timer {timer ? 'on' : 'off'}</button>
        <button className="btn small" onClick={() => setDeal((d) => d + 1)}>re-deal</button>
        {coop && [0, 1, 2].map((i) => <button key={`l${i}`} className="btn small" onClick={() => mate(1, i, 'lean')}>Morrow → {i + 1}</button>)}
        {coop && [0, 1, 2].map((i) => <button key={`s${i}`} className="btn small" onClick={() => { mate(1, i, 'seal'); mate(2, i, 'seal'); }}>mates seal {i + 1}</button>)}
        {coop && <button className="btn small" onClick={() => mate(2, 1, 'stand')}>Vex stands in 2</button>}
      </div>}
    </div>
  );
}
