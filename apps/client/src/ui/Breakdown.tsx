'use client';

import { useState } from 'react';
import { CLASS_BY_ID } from '@cursebound/content';
import type { BreakdownHero, RunBreakdown } from '@cursebound/simulation';
import { big, whole } from '@/lib/format';
import { ClassEmblem } from './icons';
import { SkillRowIcon, attackName, share, skillName } from './breakdownText';
import { RecapView } from './DeathRecap';

// Post-run breakdown (simulation runStats.ts), one compact panel with three tabs:
//   Damage — per hero: a bar per skill (icon, name, total, share of the hero's damage); "Party" compares the heroes;
//   Taken  — damage taken by source (foe / boss / hazard / curse) with its heaviest attacks;
//   Deaths — the hero's death recaps (killing blow, the hits before it on a timeline, debuffs).
// Used by Results (this run) and Records (a past run's stored breakdown).

type Tab = 'damage' | 'taken' | 'deaths';
interface Who { slot: number; name: string; classId: string }

const KIND_LABEL: Record<string, string> = { foe: 'Foe', boss: 'Boss', hazard: 'Hazard', curse: 'Curse' };
const ROWS = 8;

function Row({ icon, name, sub, part, max, total, tone }: { icon: React.ReactNode; name: string; sub?: string; part: number; max: number; total: string; tone?: string }) {
  return (
    <li className="bd-row">
      <span className="bd-ico">{icon}</span>
      <span className="bd-name">{name}{sub && <small>{sub}</small>}</span>
      <span className="bd-bar" aria-hidden="true"><i className={tone ?? ''} style={{ width: `${max > 0 ? Math.max(2, (part / max) * 100) : 0}%` }} /></span>
      <span className="bd-val">{whole(total)}</span>
      <span className="bd-pct">{share(part)}</span>
    </li>
  );
}

function ratioOf(x: string, total: string): number {
  const t = big(total);
  return t.isZero() ? 0 : Math.max(0, Math.min(1, big(x).ratio(t)));
}

function DamageList({ h }: { h: BreakdownHero }) {
  const rows = h.skills.slice(0, ROWS);
  if (!rows.length) return <p className="faint bd-empty">No damage dealt.</p>;
  const parts = rows.map((s) => ratioOf(s.dmg, h.dealt));
  const max = Math.max(...parts);
  return <ul className="bd-list">{rows.map((s, i) => <Row key={s.id || 'other'} icon={<SkillRowIcon id={s.id} size={24} />} name={skillName(s.id)} sub={big(s.kills).isZero() ? undefined : `${whole(s.kills)} kills`} part={parts[i]} max={max} total={s.dmg} />)}</ul>;
}

function PartyList({ heroes, who }: { heroes: BreakdownHero[]; who: Who[] }) {
  let sum = big('0');
  for (const h of heroes) sum = sum.add(big(h.dealt));
  const total = sum.toCompact();
  const parts = heroes.map((h) => ratioOf(h.dealt, total));
  const max = Math.max(0, ...parts);
  return (
    <ul className="bd-list">
      {heroes.map((h, i) => {
        const w = who.find((x) => x.slot === h.slot);
        return <Row key={h.slot} icon={<ClassEmblem classId={w?.classId ?? ''} size={24} />} name={w?.name ?? `Hero ${h.slot + 1}`} sub={h.skills[0] ? `top: ${skillName(h.skills[0].id)}` : undefined} part={parts[i]} max={max} total={h.dealt} />;
      })}
    </ul>
  );
}

function TakenList({ h }: { h: BreakdownHero }) {
  const rows = h.sources.slice(0, ROWS);
  if (!rows.length) return <p className="faint bd-empty">Untouched.</p>;
  const parts = rows.map((s) => ratioOf(s.dmg, h.taken));
  const max = Math.max(...parts);
  return (
    <ul className="bd-list">
      {rows.map((s, i) => (
        <Row key={s.src || 'other'} icon={<span className={`bd-kind ${s.kind}`}>{(KIND_LABEL[s.kind] ?? '?')[0]}</span>} name={s.src || 'Other'}
          sub={s.atk.slice(0, 2).map((a) => attackName(a.n)).filter((n) => n !== s.src).join(' · ') || KIND_LABEL[s.kind]} part={parts[i]} max={max} total={s.dmg} tone="blood" />
      ))}
    </ul>
  );
}

export function Breakdown({ breakdown, players, mySlot }: { breakdown: RunBreakdown; players: Who[]; mySlot: number }) {
  const [tab, setTab] = useState<Tab>('damage');
  const party = breakdown.heroes.length > 1;
  const [sel, setSel] = useState<number | 'party'>(() => (breakdown.heroes.some((h) => h.slot === mySlot) ? mySlot : breakdown.heroes[0]?.slot ?? 0));
  // the hero shown by the per-hero views ("Party" keeps the last hero for the Taken / Deaths tabs)
  const view = breakdown.heroes.find((h) => h.slot === sel) ?? breakdown.heroes.find((h) => h.slot === mySlot) ?? breakdown.heroes[0];
  if (!view) return null;
  const hero = view;
  const recaps = breakdown.recaps.filter((r) => r.slot === view.slot).slice(-3).reverse();
  const whoName = (slot: number) => players.find((p) => p.slot === slot)?.name ?? `Hero ${slot + 1}`;
  return (
    <div className="bd">
      <div className="bd-tabs" role="tablist" aria-label="Breakdown">
        {(['damage', 'taken', 'deaths'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="btn small ghost" onClick={() => { setTab(t); if (t !== 'damage' && sel === 'party') setSel(hero.slot); }}>
            {t === 'damage' ? 'Damage' : t === 'taken' ? 'Taken' : `Deaths${breakdown.recaps.length ? ` · ${breakdown.recaps.filter((r) => r.slot === view.slot).length}` : ''}`}
          </button>
        ))}
      </div>
      {party && (
        <div className="bd-who" role="radiogroup" aria-label="Hero">
          {breakdown.heroes.map((h) => {
            const w = players.find((p) => p.slot === h.slot);
            return <button key={h.slot} role="radio" aria-checked={sel === h.slot} className="bd-hero" onClick={() => setSel(h.slot)}><ClassEmblem classId={w?.classId ?? ''} size={16} />{w?.name ?? `Hero ${h.slot + 1}`}{h.slot === mySlot ? <small> you</small> : null}</button>;
          })}
          {tab === 'damage' && <button role="radio" aria-checked={sel === 'party'} className="bd-hero" onClick={() => setSel('party')}>Party</button>}
        </div>
      )}
      {tab === 'damage' && (sel === 'party' ? <PartyList heroes={breakdown.heroes} who={players} /> : <DamageList h={view} />)}
      {tab === 'taken' && <TakenList h={view} />}
      {tab === 'deaths' && (recaps.length
        ? <div className="bd-recaps">{recaps.map((r, i) => <RecapView key={`${r.tick}-${i}`} recap={r} you={r.slot === mySlot} />)}</div>
        : <p className="faint bd-empty">{whoName(view.slot)} never fell.</p>)}
      {sel !== 'party' && (
        <div className="bd-foot faint">
          {tab === 'taken'
            ? <>{whole(view.taken)} taken · {view.downs} {view.downs === 1 ? 'down' : 'downs'} · {view.deaths} {view.deaths === 1 ? 'death' : 'deaths'} · revived {view.revived}×</>
            : <>{whole(view.dealt)} dealt · {CLASS_BY_ID[players.find((p) => p.slot === view.slot)?.classId ?? '']?.name ?? ''} · healed {whole(view.healDone)} · {view.dodges} dodges{view.revives ? ` · ${view.revives} revives` : ''}</>}
        </div>
      )}
    </div>
  );
}
