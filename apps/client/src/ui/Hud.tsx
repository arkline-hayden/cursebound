'use client';

import { useEffect, useRef, useState } from 'react';
import { BOSS_BY_ID, CARD_BY_ID, CLASS_BY_ID, SKILL_BY_ID } from '@cursebound/content';
import { netStore, type GameConnection } from '@/lib/net';
import { settingsStore, keyCap, keyLabel } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { score, whole, wholeNum } from '@/lib/format';
import { NodeIcon, CardIcon } from './icons';
import { ActorPortrait, actorFor } from './ClassPortrait';
import { Orb } from './Orb';
import { orbLabelColor, orbPalette } from './orbArt';
import { GearBar } from './GearBar';
import { SpectateBar } from './Spectate';
import { StatusIcon, sortStatuses, statusDef } from './icons/statusIcons';
import { useCinematic } from './cinematic';

// COMBAT HUD (PRD §16.1), Diablo-style: health and resource orbs in the bottom corners, a carved stone action bar
// with skill sockets, cooldowns and key labels between them, the round medallion with wave/time wings and the boss
// bar top-centre, gothic party portraits top-left, score and Fate Ledger top-right. Orbs animate in their own
// canvas loop; this component only re-renders at the throttled snapshot rate. Text status summary for assistive tech.
// All HUD text uses the --hud-* type tokens, which stay crisp at the integer HUD zooms (1x, 1.5x at 1080p, 2x).

function Combo() {
  const [n, setN] = useState(0);
  const [key, setKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const v = (e as CustomEvent).detail as number;
      setN(v); setKey((k) => k + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setN(0), 2600);
    };
    window.addEventListener('cursebound:combo', on);
    return () => { window.removeEventListener('cursebound:combo', on); if (timer.current) clearTimeout(timer.current); };
  }, []);
  if (n < 3) return null;
  const label = n >= 40 ? 'Massacre' : n >= 25 ? 'Carnage' : n >= 15 ? 'Slaughter' : n >= 8 ? 'Rampage' : 'Kills';
  return <div className="combo" aria-hidden="true"><span className="n" key={key}>{n}×</span><span className="l">{label}</span></div>;
}

/** Hover payload from the combat scene. elite: 0 normal, 1 champion (blue), 2 rare (gold); names arrive prefixed. */
interface TargetInfo { name: string; hp: number; hpText?: string; count: string | null; objective: boolean; elite?: 0 | 1 | 2; affixes?: string[] }

/** Mouse-over monster plate (D2 style): fed by the combat scene's 'cursebound:target' event, null hides it. */
function TargetPlate() {
  const [t, setT] = useState<TargetInfo | null>(null);
  useEffect(() => {
    const on = (e: Event) => setT(((e as CustomEvent).detail as TargetInfo | null) ?? null);
    window.addEventListener('cursebound:target', on);
    return () => window.removeEventListener('cursebound:target', on);
  }, []);
  if (!t) return null;
  const hp = Math.max(0, Math.min(1, Number(t.hp) || 0));
  const tier = t.elite === 2 ? 'rare' : t.elite === 1 ? 'champion' : '';
  return (
    <div className={`target-plate ${t.objective ? 'obj' : ''} ${tier}`}>
      <div className="tname"><span className="tn">{t.name}</span>{t.count && <span className="tcount">×{t.count}</span>}</div>
      {t.affixes && t.affixes.length > 0 && <div className="taffix">{t.affixes.join(' · ')}</div>}
      <div className="bar"><i style={{ width: `${hp * 100}%` }} />{t.hpText && <span className="bar-text">{t.hpText}</span>}</div>
    </div>
  );
}

const humanize = (k: string) => k.replace(/^[a-z]{1,2}_/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Class kit meters from `kv` (e.g. combo/comboMax, turrets): pips for small maxima, a bar for large ones, else a count. */
function ClassMeter({ kv }: { kv: Record<string, number> | undefined }) {
  if (!kv) return null;
  const keys = Object.keys(kv).filter((k) => !/Max$/.test(k));
  if (!keys.length) return null;
  return (
    <div className="class-meter">
      {keys.map((k) => {
        const v = Math.max(0, kv[k] ?? 0);
        const max = kv[`${k}Max`];
        const hasMax = max !== undefined && max > 0;
        return (
          <span key={k} className="cm-item">
            <span className="cm-label">{humanize(k)}</span>
            {hasMax && max <= 12 && <span className="cm-pips">{Array.from({ length: Math.round(max) }, (_, i) => <i key={i} className={i < Math.floor(v) ? 'on' : ''} />)}</span>}
            {hasMax && max > 12 && <span className="cm-bar"><i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></span>}
            <span className="cm-val">{hasMax ? `${Math.floor(v)}/${Math.round(max)}` : Math.floor(v)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Status chips beside the life orb (contract 4): debuffs first (blood-red frame), then buffs (gold frame); each a
 *  pixel glyph and a short name in the status colour. */
function StatusChips({ buffs }: { buffs: string[] }) {
  const ids = sortStatuses(buffs);
  if (!ids.length) return null;
  return (
    <div className="hud-status">
      {ids.map((id) => {
        const d = statusDef(id);
        return <span key={id} className={`hchip ${d.kind === 'debuff' ? 'neg' : 'pos'}`} style={{ color: d.color }}><StatusIcon id={id} size={22} /><span className="hc-l">{d.label}</span></span>;
      })}
    </div>
  );
}

export function Hud({ net, onLedger, onPause }: { net: GameConnection; onLedger: () => void; onPause: () => void }) {
  void net;
  const snap = useStore(netStore, (s) => s.hud);
  const slot = useStore(netStore, (s) => s.slot);
  const phase = useStore(netStore, (s) => s.phase);
  const keys = useStore(settingsStore, (s) => s.s.keys);
  const cine = useCinematic();
  if (!snap || !phase) return null;
  const me = snap.players[slot];
  if (!me) return null;
  // dodge charges: ready while any charge remains; `dodge` is the remaining recharge of the next missing charge
  const dcm = Math.max(1, me.dcm ?? 1), dc = Math.max(0, Math.min(dcm, me.dc ?? (me.dodge > 0 ? 0 : 1)));
  const dodgeReady = dc > 0;
  const buffs = (me.buffs ?? []).filter((b, i, a) => a.indexOf(b) === i);
  const cls = CLASS_BY_ID[me.c];
  const resName = cls?.resource.name ?? 'Resource';
  const resPal = orbPalette(me.c, cls?.accent);
  const enc = snap.enc;
  const boss = enc?.boss && enc.bossId ? BOSS_BY_ID[enc.bossId] : null;
  const slotKeys = [keys.skill1[0], keys.skill2[0], keys.skill3[0], keys.signature[0]];
  const t = enc ? enc.activeTicks / 60 : 0;
  const ref = enc ? enc.referenceTicks / 60 : 0;
  const statusText = `Round ${snap.round}. Health ${whole(me.hpT)} of ${whole(me.mhpT)}${me.life !== 'alive' ? `, ${me.life}` : ''}. ${enc ? `Objectives ${enc.done} of ${enc.total}.` : ''} ${boss ? `${boss.name} at ${Math.round(enc!.bossHp * 100)} percent, phase ${enc!.bossPhase + 1}.` : ''}`;
  const lowHp = me.life === 'alive' && me.hp < 0.3;
  const isBossRound = !!enc?.boss;
  return (
    <div className={`hud ${cine ? 'cine-hidden' : ''}`}>
      <div className="vignette-screen soft" aria-hidden="true" />
      {lowHp && <div className="vignette-hurt" aria-hidden="true" />}
      <Combo />

      {/* top centre: round medallion, wave/time wings, kill pips, target plate, boss bar */}
      <div className="hud-top" aria-hidden="true">
        <div className="hud-round">
          <div className="hud-wing left">
            {enc ? (enc.boss ? <span>Phase <b>{enc.bossPhase + 1}</b>/3</span>
              : enc.packsLeft !== undefined ? <span>Packs <b>{enc.packsLeft}</b> left</span>
              : <span>Wave <b>{enc.wave + 1}</b>/{enc.waves} · <b>{enc.done}</b>/{enc.total}</span>) : <span>Gathering</span>}
          </div>
          <div className={`medallion ${isBossRound ? 'boss' : ''}`}>
            <span className="n">{snap.round}</span>
            <span className="tag">{isBossRound ? 'Boss' : 'Round'}</span>
          </div>
          <div className="hud-wing right">
            <span><b className={t > ref ? 'late' : 'ontime'}>{t.toFixed(0)}s</b>/{ref.toFixed(0)}s</span>
            {enc && !enc.boss && (enc.foesLeft ?? enc.logicalEnemies) !== '0' && <span>· {whole(enc.foesLeft ?? enc.logicalEnemies)} foes</span>}
          </div>
        </div>
        {enc && !enc.boss && (
          <div className="hud-pips">
            {Array.from({ length: Math.min(enc.total, 30) }).map((_, i) => <i key={i} className={i < enc.done ? 'on' : ''} />)}
          </div>
        )}
        {boss && enc ? (
          <div className="hud-boss">
            <div className="bname">{boss.name}</div>
            <div className="btitle">{boss.title}</div>
            <div className="bar boss">
              <i style={{ width: `${enc.bossHp * 100}%` }} />
              <span className="mark" style={{ left: '66%' }} />
              <span className="mark" style={{ left: '33%' }} />
            </div>
            <div className="bmeta">
              <span>{whole(enc.bossHpT)}</span>
              <span className="phase-pips">{[0, 1, 2].map((p) => <i key={p} className={p <= enc.bossPhase ? 'on' : ''} />)}</span>
            </div>
          </div>
        ) : <TargetPlate />}
      </div>

      {/* top left: party portraits */}
      <div className="hud-party" aria-hidden="true">
        {snap.players.map((p) => {
          const state = !p.con ? 'away' : p.life !== 'alive' ? p.life : '';
          return (
            <div key={p.s} className={`pplate ${p.s === slot ? 'me' : ''} ${state}`}>
              <div className="pframe">
                <div className="portrait"><ActorPortrait actor={actorFor(p.c)} size={96} animate={false} state={p.life === 'alive' ? 'idle' : 'downed'} /></div>
              </div>
              <div className="pinfo">
                <div className="pname">
                  <span className="pn">{p.n}</span>
                  {state && <span className={`pstate ${state === 'away' ? 'away' : ''}`}>{state}</span>}
                </div>
                <div className="bar"><i style={{ width: `${p.hp * 100}%` }} />{p.sh > 0 && <b style={{ width: `${Math.min(100, p.sh * 100)}%` }} />}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* top right: score, Fate Ledger, menu */}
      <div className="hud-right">
        <div className="score-plate" aria-hidden="true">
          <span className="lbl">Score</span>
          <span className="val">{score(snap.scoreText)}</span>
        </div>
        <button className="ledger-btn" onClick={onLedger} aria-label={`Open Fate Ledger. ${phase.fate.length} cards bound.`}>
          <span className="lhead"><span>Fate Ledger · {phase.fate.length}</span><span className="kbd">{keyCap(keys.ledger[0] ?? 'Tab')}</span></span>
          <span className="lcards">
            {phase.fate.slice(-5).map((c, i) => <span key={i} data-tip={CARD_BY_ID[c.cardId]?.name}><CardIcon cardId={c.cardId} size={32} /></span>)}
            {phase.fate.length === 0 && <span className="none">None bound</span>}
          </span>
        </button>
        <button className="btn small" onClick={onPause}>Menu <span className="kbd">{keyCap(keys.pause[0] ?? 'Escape')}</span></button>
      </div>

      {/* bottom: life orb, action bar, resource orb */}
      <div className="hud-orb left" aria-hidden="true">
        <div className="orb-plaque">
          <span className="oname">Life{me.sh > 0 && <span className="osh"> +{whole(me.shT)}</span>}</span>
          <span className="oval">{whole(me.hpT)} / {whole(me.mhpT)}</span>
        </div>
        <Orb kind="life" value={me.hp} shield={me.sh} />
        <StatusChips buffs={buffs} />
      </div>
      <div className="hud-orb right" aria-hidden="true">
        <div className="orb-plaque">
          <span className="oname" style={{ color: orbLabelColor(resPal) }}>{resName}</span>
          <span className="oval">{wholeNum(me.res)} / {wholeNum(me.resMax)}</span>
        </div>
        <Orb kind={me.c} accent={cls?.accent} value={me.res / Math.max(1, me.resMax)} />
      </div>

      <div className="hud-center" aria-hidden="true">
        {me.life === 'downed' && <div className="hud-msg downed">{me.self > 0 ? `Rising… ${me.self.toFixed(1)}s` : `Downed — ${me.down.toFixed(1)}s`}</div>}
        {me.life === 'dead' && <SpectateBar />}
        <ClassMeter kv={me.kv} />
        {/* the equipped-gear row (GearBar) stacks here, above the action bar */}
        <GearBar />
        <div className="actionbar">
          {me.cd.map(([id, frac, ch, max], i) => {
            const cost = id ? SKILL_BY_ID[id]?.resourceCost ?? 0 : 0;
            const ready = !!id && frac === 0 && ch > 0 && me.res >= cost;
            const sig = i === 3;
            const tip = id ? `${SKILL_BY_ID[id]?.name ?? id}${cost ? ` · ${cost} ${resName}` : ''}` : 'Empty — unlock in your skill tree';
            return (
              <div key={i} className={`slot ${sig ? 'sig' : ''} ${!id ? 'empty' : ready ? 'ready' : ''}`} data-tip={tip}>
                {id && <NodeIcon nodeId={id} size={32} />}
                {id && frac > 0 && <div className="cd" style={{ height: `calc(${frac * 100}% + 4px)` }} />}
                {id && frac > 0 && <span className="cdtext">{Math.ceil(frac * (SKILL_BY_ID[id]?.cooldownSec ?? 0))}</span>}
                {id && !ready && frac === 0 && <div className="nores" />}
                {max > 1 && <span className="charges">{ch}</span>}
                <span className="kbd key" title={keyLabel(slotKeys[i] ?? '')}>{keyCap(slotKeys[i])}</span>
              </div>
            );
          })}
          <div className={`slot dodge ${dodgeReady ? 'ready' : ''}`} data-tip={`Dodge · ${dc}/${dcm} charges`}>
            <NodeIcon nodeId="dodge" size={32} />
            {!dodgeReady && me.dodge > 0 && <div className="cd" style={{ height: `calc(${me.dodge * 100}% + 4px)` }} />}
            {dcm > 1 && (
              <span className="dpips">
                {Array.from({ length: dcm }, (_, i) => (
                  <i key={i} className={i < dc ? 'on' : ''}>{i === dc && dc < dcm && me.dodge > 0 && <b style={{ height: `${Math.round((1 - me.dodge) * 100)}%` }} />}</i>
                ))}
              </span>
            )}
            <span className="kbd key">{keyCap(keys.dodge[0])}</span>
          </div>
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="off">{statusText}</div>
    </div>
  );
}
