'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Big } from '@cursebound/numeric';
import { BRANCH_TIER_POINTS, CLASS_BY_ID, MASTERY_CHOICES, NODE_BY_ID, SKILL_BY_ID, STAT_BY_ID, type ClassDef, type NodeDef } from '@cursebound/content';
import { deadlineSeconds, netStore, type GameConnection, type PhaseData } from '@/lib/net';
import { useStore } from '@/lib/store';
import { accountApi } from '@/lib/api';
import { authStore, refreshAuth } from '@/lib/auth';
import { score } from '@/lib/format';
import { NodeIcon, ClassEmblem } from './icons';

// LOADOUT / SKILL_ALLOCATION (REQ CLASS01, PRD §6.2, §7): inspect any node before purchase with cost, prerequisites
// and before/after numbers; a click cannot spend twice (server-validated); builds export as versioned node IDs.
// Presented as a Diablo II skill tree sized for deep trees at 1280x720: three carved branch columns (10-12 sockets
// over tiers 0..4), a tier-gate gutter, bronze connectors that light once a prerequisite is owned, choice pairs
// chained with an OR plate (the rival is sealed once one is owned), gold capstone sockets (tier 3) and crowned
// keystone sockets (tier 4). Sockets also show their kind: new skill, upgrade of a named skill, or passive (see
// sortOf). The detail pane sits to the side (one line of copy, a "What changes" before → after box and a compact
// requirements row); the footer with points and the primary action is pinned. Arrow keys move between sockets,
// Enter (or double-click) spends a point.

type Player = PhaseData['players'][number];
type Kind = 'granted' | 'maxed' | 'owned' | 'ready' | 'open' | 'locked' | 'sealed';
interface Status { kind: Kind; can: boolean; short: string; reason: string }
interface Pos { x: number; y: number; s: number; label: number }
interface OrLink { a: string; b: string; x0: number; x1: number; y: number }
interface Geo { pos: Record<string, Pos>; ors: OrLink[]; ys: number[]; roomy: boolean }

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const nameOf = (id: string) => NODE_BY_ID[id]?.name ?? id;
const tierPoints = (t: number) => BRANCH_TIER_POINTS[Math.min(t, BRANCH_TIER_POINTS.length - 1)] ?? 0;
const isCap = (n: NodeDef) => n.tier >= 3;
const isKey = (n: NodeDef) => n.tier >= 4;
const owns = (p: Player, id: string) => (p.ranks[id] ?? 0) > 0;
const excl = (a: NodeDef, b: NodeDef) => !!(a.excludes?.includes(b.id) || b.excludes?.includes(a.id));
const even = (v: number) => Math.round(v / 2) * 2;
const fx = (v: number) => v.toFixed(4).replace(/\.?0+$/, '');
const tierWord = (n: NodeDef) => (isKey(n) ? 'Keystone' : isCap(n) ? 'Capstone' : '');

function branchName(cls: ClassDef, id: string) { return cls.branches.find((b) => b.id === id)?.name ?? id; }

function status(p: Player, n: NodeDef, cls: ClassDef): Status {
  const rank = p.ranks[n.id] ?? 0;
  if (n.starting) return { kind: 'granted', can: false, short: 'Starting grant', reason: 'A starting grant: always owned, never costs a point.' };
  if (rank >= n.rankLimit) return { kind: 'maxed', can: false, short: 'Fully ranked', reason: `Fully ranked (${rank}/${n.rankLimit}).` };
  const rival = n.excludes?.find((x) => owns(p, x));
  if (rival) return { kind: 'sealed', can: false, short: `Excluded by ${nameOf(rival)}`, reason: `Excluded by ${nameOf(rival)}: choice nodes lock each other. Refund all before round 1 to switch.` };
  const need = tierPoints(n.tier), spent = p.spentByBranch[n.branch] ?? 0;
  if (spent < need) return { kind: 'locked', can: false, short: `Needs ${need} pt${need === 1 ? '' : 's'} in ${branchName(cls, n.branch)}`, reason: `Tier ${ROMAN[n.tier]} opens at ${need} points spent in ${branchName(cls, n.branch)} — ${spent} spent so far.` };
  const miss = n.prereqs.find((pr) => (p.ranks[pr.node] ?? 0) < pr.rank);
  if (miss) return { kind: 'locked', can: false, short: `Requires ${nameOf(miss.node)}`, reason: `Requires ${nameOf(miss.node)}${miss.rank > 1 ? ` at rank ${miss.rank}` : ''} first.` };
  if (p.skillPoints < n.costPerRank) return { kind: rank > 0 ? 'owned' : 'open', can: false, short: 'No skill points', reason: 'No skill points left. Each cleared round grants one (two after a boss).' };
  return { kind: rank > 0 ? 'owned' : 'ready', can: true, short: rank > 0 ? 'Rank up available' : 'Available', reason: '' };
}

/** For skill-granting nodes above the base: the grant it evolves (nearest granting ancestor, else the branch base). */
function evolvesFrom(n: NodeDef, cls: ClassDef): NodeDef | null {
  if (!n.grantsSkill) return null;
  const seen = new Set<string>();
  const queue = n.prereqs.map((pr) => pr.node);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const x = NODE_BY_ID[id];
    if (!x) continue;
    if (x.grantsSkill && x.branch === n.branch) return x;
    queue.push(...x.prereqs.map((pr) => pr.node));
  }
  return cls.nodes.map((id) => NODE_BY_ID[id]).filter((x): x is NodeDef => !!x && x.branch === n.branch && !!x.grantsSkill && x.tier < n.tier)
    .sort((a, b) => a.tier - b.tier)[0] ?? null;
}
const skillName = (n: NodeDef | null) => (n?.grantsSkill ? SKILL_BY_ID[n.grantsSkill]?.name ?? n.name : n?.name ?? '');

// Three node kinds, told apart at a glance: a socket that grants a new skill (arcane gems, "New skill" plate), one
// that upgrades a skill granted elsewhere (ember badge with that skill's icon and an up-chevron, "Upgrade" plate)
// and a plain passive (bronze, no ornament). `NodeDef.upgrades` is the content's display tag for the second kind.
type NodeSort = 'grant' | 'upgrade' | 'passive';
const sortOf = (n: NodeDef): NodeSort => (n.grantsSkill || n.starting ? 'grant' : n.upgrades ? 'upgrade' : 'passive');
const SORT_WORD: Record<NodeSort, string> = { grant: 'New skill', upgrade: 'Upgrade', passive: 'Passive' };
const upgradedName = (n: NodeDef) => (n.upgrades ? SKILL_BY_ID[n.upgrades]?.name ?? n.upgrades : '');

/** Node copy with templates filled; upgrade copy loses its "Upgrades <Skill>: " lead (the plate names the skill). */
function nodeText(n: NodeDef, rank: number) {
  const d = n.description.replace(/\{rank\}/g, String(rank)).replace(/\{value\}/g, n.modifiers[0]?.factorPerRank ?? '');
  const lead = `Upgrades ${upgradedName(n)}: `;
  if (!n.upgrades || !d.startsWith(lead)) return d;
  const rest = d.slice(lead.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function statName(stat: string, n?: NodeDef) {
  if (STAT_BY_ID[stat]) return STAT_BY_ID[stat].name.replace(/^Player /, '').replace(/^\w/, (c) => c.toUpperCase());
  if (stat.startsWith('skill.')) {
    const [, id, what = 'damage'] = stat.split('.');
    return id === n?.upgrades ? what.charAt(0).toUpperCase() + what.slice(1) : `${SKILL_BY_ID[id]?.name ?? 'Skill'} ${what}`;
  }
  return stat;
}

const cooldownMeta = (skillId: string) => {
  const s = SKILL_BY_ID[skillId];
  return s ? [s.cooldownSec ? `${s.cooldownSec}s cooldown` : '', s.charges > 1 ? `${s.charges} charges` : ''].filter(Boolean).join(' · ') : '';
};

/** "What changes": compact before → after lines for the next rank (or the current state once fully ranked). */
type Change = { label?: string; from?: ReactNode; to: ReactNode; meta?: string };
function changes(p: Player, n: NodeDef, cls: ClassDef): Change[] {
  const rank = p.ranks[n.id] ?? 0, maxed = rank >= n.rankLimit, next = Math.min(n.rankLimit, rank + 1);
  const out: Change[] = [];
  if (n.grantsSkill) {
    const evo = evolvesFrom(n, cls);
    const to = <><NodeIcon nodeId={n.grantsSkill} size={16} /> {SKILL_BY_ID[n.grantsSkill]?.name ?? n.name}</>;
    out.push(evo?.grantsSkill
      ? { from: <><NodeIcon nodeId={evo.grantsSkill} size={16} /> {skillName(evo)}</>, to, meta: cooldownMeta(n.grantsSkill) }
      : { label: 'New', to, meta: cooldownMeta(n.grantsSkill) });
  }
  if (n.upgrades && !n.modifiers.length) out.push({ to: nodeText(n, rank) });
  for (const m of n.modifiers) {
    const f = Big.from(m.factorPerRank);
    const cur = `×${fx(f.powInt(rank).toNumber())}`, nxt = `×${fx(f.powInt(next).toNumber())}`;
    out.push(maxed ? { label: statName(m.stat, n), to: cur, meta: 'max' } : { label: statName(m.stat, n), from: cur, to: nxt });
  }
  if (!n.grantsSkill && !n.modifiers.length && n.rankLimit > 1) out.push(maxed ? { label: 'Rank', to: `${rank}`, meta: 'max' } : { label: 'Rank', from: `${rank}`, to: `${next}` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------------------------------------------

const SIZES = {
  compact: { n: 48, cap: 56, key: 72, under: 0, label: 0 },   // rank pips overlap the socket's bottom rim
  roomy: { n: 56, cap: 64, key: 88, under: 10, label: 44 },
};
const OR_GAP = 32, MIN_GAP = 8;

function rowCenters(rows: number, h: number, roomy: boolean) {
  const z = roomy ? SIZES.roomy : SIZES.compact;
  const rowH = h / rows;
  return Array.from({ length: rows }, (_, t) => even(t * rowH + (rowH - z.under - z.label) / 2));
}

function layoutBranch(nodes: NodeDef[], rows: number, w: number, h: number, roomy: boolean): Geo {
  const z = roomy ? SIZES.roomy : SIZES.compact;
  const ys = rowCenters(rows, h, roomy);
  const pos: Record<string, Pos> = {};
  const ors: OrLink[] = [];
  const sizeOf = (n: NodeDef) => (isKey(n) ? z.key : isCap(n) ? z.cap : z.n);
  for (let t = 0; t < rows; t++) {
    const inTier = nodes.filter((n) => n.tier === t);
    if (!inTier.length) continue;
    // order by the barycentre of placed prerequisites so connectors stay short; content order breaks ties
    const key = new Map(inTier.map((n, i) => {
      const xs = n.prereqs.map((pr) => pos[pr.node]?.x).filter((v): v is number => v !== undefined);
      return [n.id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length / w : (i + 0.5) / inTier.length] as const;
    }));
    // choice groups (mutually exclusive nodes) stay adjacent so they can be chained with OR plates
    const groups: NodeDef[][] = [];
    for (const n of inTier) {
      const g = groups.find((gr) => gr.some((m) => excl(m, n)));
      if (g) g.push(n); else groups.push([n]);
    }
    const mean = (g: NodeDef[]) => g.reduce((a, n) => a + key.get(n.id)!, 0) / g.length;
    groups.sort((a, b) => mean(a) - mean(b));
    for (const g of groups) g.sort((a, b) => key.get(a.id)! - key.get(b.id)!);
    const seq = groups.flat();
    const sizes = seq.map(sizeOf);
    const orAt = seq.map((n, i) => i > 0 && excl(seq[i - 1], n));
    const minGap: number[] = orAt.map((o, i) => (i === 0 ? 0 : o ? OR_GAP : MIN_GAP));
    const sumS = sizes.reduce((a, b) => a + b, 0), sumG = minGap.reduce((a, b) => a + b, 0);
    const free = w - sumS - sumG;
    const slot = free > 0 ? free / (seq.length + 1) : 0;
    const squeeze = free >= 0 ? 1 : Math.max(0, w - sumS) / Math.max(1, sumG);
    let x = slot;
    const centers: number[] = [];
    seq.forEach((n, i) => {
      if (i > 0) x += minGap[i] * squeeze + slot;
      centers.push(x + sizes[i] / 2);
      x += sizes[i];
    });
    seq.forEach((n, i) => {
      const cx = even(centers[i]);
      const left = i > 0 ? cx - even(centers[i - 1]) : Infinity, right = i < seq.length - 1 ? even(centers[i + 1]) - cx : Infinity;
      pos[n.id] = { x: cx, y: ys[t], s: sizes[i], label: Math.max(48, Math.min(128, Math.min(left, right) - 8)) };
    });
    seq.forEach((n, i) => {
      if (!orAt[i]) return;
      const a = pos[seq[i - 1].id], b = pos[n.id];
      ors.push({ a: seq[i - 1].id, b: n.id, x0: a.x + a.s / 2, x1: b.x - b.s / 2, y: ys[t] });
    });
  }
  return { pos, ors, ys, roomy };
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ---------------------------------------------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------------------------------------------

function Links({ nodes, geo, me, w, h }: { nodes: NodeDef[]; geo: Geo; me: Player; w: number; h: number }) {
  const segs: { x: number; y: number; w: number; h: number; tone: 'dim' | 'lit' | 'hot' }[] = [];
  const vert = (x: number, y0: number, y1: number, tone: 'dim' | 'lit' | 'hot') => segs.push({ x: x - 3, y: Math.min(y0, y1), w: 6, h: Math.abs(y1 - y0) + 2, tone });
  const horz = (y: number, x0: number, x1: number, tone: 'dim' | 'lit' | 'hot') => segs.push({ x: Math.min(x0, x1) - 3, y: y - 3, w: Math.abs(x1 - x0) + 6, h: 6, tone });
  for (const n of nodes) for (const pr of n.prereqs) {
    const a = geo.pos[pr.node], b = geo.pos[n.id];
    if (!a || !b) continue;
    const met = (me.ranks[pr.node] ?? 0) >= pr.rank;
    const tone = met ? (owns(me, n.id) ? 'hot' : 'lit') : 'dim';
    const y0 = a.y + a.s / 2, y1 = b.y - b.s / 2;
    if (y1 <= y0) { horz(b.y, a.x, b.x, tone); continue; }
    if (a.x === b.x) { vert(a.x, y0, y1, tone); continue; }
    const mid = even(y1 - Math.min(16, (y1 - y0) / 2));
    vert(a.x, y0, mid, tone); horz(mid, a.x, b.x, tone); vert(b.x, mid, y1, tone);
  }
  const core = { dim: '#4c2c0c', lit: '#bc600e', hot: '#ec941e' };
  return (
    <svg className="links" width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
      {segs.map((s, i) => <rect key={`o${i}`} x={s.x} y={s.y} width={s.w} height={s.h} fill="#050404" />)}
      {segs.map((s, i) => <rect key={`i${i}`} x={s.x + 2} y={s.y + 2} width={Math.max(2, s.w - 4)} height={Math.max(2, s.h - 4)} fill={core[s.tone]} />)}
      {segs.filter((s) => s.tone === 'hot').map((s, i) => <rect key={`h${i}`} x={s.x + 2} y={s.y + 2} width={s.w > 6 ? s.w - 4 : 2} height={s.w > 6 ? 2 : Math.max(2, s.h - 4)} fill="#ffc94a" />)}
      {geo.ors.map((o, i) => {
        const sealed = owns(me, o.a) || owns(me, o.b);
        const links = [];
        for (let x = o.x0; x < o.x1; x += 8) links.push(<rect key={x} x={x} y={o.y - 2} width={Math.min(6, o.x1 - x)} height={4} fill={sealed ? '#dc3f3b' : '#7d746d'} />);
        return <g key={`c${i}`}><rect x={o.x0} y={o.y - 4} width={Math.max(0, o.x1 - o.x0)} height={8} fill="#050404" />{links}</g>;
      })}
    </svg>
  );
}

function Pips({ rank, max }: { rank: number; max: number }) {
  if (max > 6) return <span className="tpips num">{rank}/{max}</span>;
  return <span className="tpips">{Array.from({ length: max }, (_, i) => <i key={i} className={i < rank ? 'on' : ''} />)}</span>;
}

/** Node-kind plate: "New skill" (naming the skill it replaces, for evolutions), "Upgrade" + the upgraded skill, or "Passive". */
function KindPlate({ node, evo }: { node: NodeDef; evo: NodeDef | null }) {
  const sort = sortOf(node);
  return (
    <span className={`kind-plate ${sort}`}>
      {sort === 'upgrade' && <i className="up" aria-hidden="true" />}
      <span>{SORT_WORD[sort]}</span>
      {node.upgrades && <b><NodeIcon nodeId={node.upgrades} size={16} />{upgradedName(node)}</b>}
      {sort === 'grant' && evo && <b>replaces {skillName(evo)}</b>}
    </span>
  );
}

function Branch({ cls, branch, nodes, rows, me, focus, hover, onSelect, onHover, onSpend, onKey, onRoomy }: {
  cls: ClassDef; branch: ClassDef['branches'][number]; nodes: NodeDef[]; rows: number; me: Player; focus: string | null; hover: string | null;
  onSelect: (id: string) => void; onHover: (id: string | null) => void; onSpend: (id: string) => void; onKey: (e: KeyboardEvent<HTMLButtonElement>, n: NodeDef, st: Status) => void;
  onRoomy?: (roomy: boolean) => void;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const W = w || 240, H = h || 420;
  const roomy = W >= 340 && H / rows >= 120;
  const geo = useMemo(() => layoutBranch(nodes, rows, W, H, roomy), [nodes, rows, W, H, roomy]);
  useEffect(() => { if (w > 0) onRoomy?.(roomy); }, [roomy, w, onRoomy]);
  const tipNode = hover && geo.pos[hover] ? NODE_BY_ID[hover] : null;
  return (
    <section className="well branch" aria-labelledby={`br-${branch.id}`}>
      <header className="branch-head">
        <h3 id={`br-${branch.id}`}>{branch.name}</h3>
        <span className="spent">{me.spentByBranch[branch.id] ?? 0} spent</span>
        <p className="theme">{branch.theme}</p>
      </header>
      <div className={`tree-grid ${roomy ? 'roomy' : ''}`} ref={ref} onMouseLeave={() => onHover(null)}>
        {w > 0 && <Links nodes={nodes} geo={geo} me={me} w={W} h={H} />}
        {w > 0 && geo.ors.map((o) => <span key={`or-${o.a}-${o.b}`} className={`or-plate ${owns(me, o.a) || owns(me, o.b) ? 'sealed' : ''}`} style={{ left: even((o.x0 + o.x1) / 2), top: o.y }} aria-hidden="true">or</span>)}
        <ul className="tree-nodes">
          {w > 0 && nodes.map((n) => {
            const p = geo.pos[n.id];
            if (!p) return null;
            const rank = me.ranks[n.id] ?? 0;
            const st = status(me, n, cls);
            const evo = evolvesFrom(n, cls);
            const word = tierWord(n);
            const sort = sortOf(n);
            const kindText = sort === 'upgrade' ? `Upgrades ${upgradedName(n)}` : evo ? `New skill, evolves ${skillName(evo)}` : SORT_WORD[sort];
            return (
              <li key={n.id}>
                <button type="button" data-node={n.id}
                  className={`tnode n-${sort} k-${st.kind} ${st.can ? 'can' : ''} ${isKey(n) ? 'key' : isCap(n) ? 'cap' : ''} ${roomy ? 'lg' : ''} ${focus === n.id ? 'sel' : ''}`}
                  style={{ left: p.x - p.s / 2, top: p.y - p.s / 2, width: p.s, height: p.s }}
                  aria-label={`${n.name}, ${kindText}, ${branch.name} tier ${ROMAN[n.tier]}${word ? `, ${word.toLowerCase()}` : ''}, rank ${rank} of ${n.rankLimit}. ${st.can ? 'Available: press Enter to spend a point.' : st.short}.`}
                  aria-describedby="node-detail" aria-pressed={focus === n.id}
                  onClick={() => onSelect(n.id)} onFocus={() => onSelect(n.id)} onDoubleClick={() => st.can && onSpend(n.id)}
                  onMouseEnter={() => onHover(n.id)} onKeyDown={(e) => onKey(e, n, st)}>
                  <span className="tframe" aria-hidden="true" />
                  {sort === 'grant' && !isKey(n) && <span className="tgems" aria-hidden="true" />}
                  <NodeIcon nodeId={n.id} size={32} className="ticon" />
                  {n.upgrades && <span className="tupg" aria-hidden="true"><NodeIcon nodeId={n.upgrades} size={16} /></span>}
                  {st.kind === 'sealed' && <span className="tseal" aria-hidden="true" />}
                  {st.kind === 'locked' && <span className="tlock" aria-hidden="true" />}
                </button>
                <span className="tunder" style={{ left: p.x, top: p.y + p.s / 2 + (roomy ? 2 : -8) } as CSSProperties} aria-hidden="true">
                  <Pips rank={rank} max={n.rankLimit} />
                  {roomy && <span className={`tlabel k-${st.kind}`} style={{ width: p.label }}>{n.name}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {tipNode && (() => {
          const p = geo.pos[tipNode.id];
          const st = status(me, tipNode, cls);
          const evo = evolvesFrom(tipNode, cls);
          const below = tipNode.tier === 0;
          const half = Math.min(128, W / 2);
          const left = Math.max(half, Math.min(W - half, p.x));
          return (
            <div className={`ttip ${below ? 'below' : ''}`} role="tooltip" style={{ left, top: below ? p.y + p.s / 2 + (roomy ? 58 : 16) : p.y - p.s / 2 - 8, maxWidth: half * 2 }}>
              <b className="ttip-name">{tipNode.name}</b>
              <KindPlate node={tipNode} evo={evo} />
              <span className="ttip-meta">Rank {me.ranks[tipNode.id] ?? 0}/{tipNode.rankLimit} · Tier {ROMAN[tipNode.tier]}{tierWord(tipNode) ? ` · ${tierWord(tipNode)}` : ''}</span>
              <span className={`ttip-state k-${st.kind} ${st.can ? 'can' : ''}`}>{st.short}</span>
            </div>
          );
        })()}
      </div>
    </section>
  );
}

function Gutter({ rows, roomy }: { rows: number; roomy: boolean }) {
  const [ref, { h }] = useSize<HTMLDivElement>();
  const ys = rowCenters(rows, h || 420, roomy);
  return (
    <div className="well branch gutter" aria-hidden="true">
      <header className="branch-head"><span className="gut-h">Pts</span></header>
      <div className="tree-grid" ref={ref}>
        {h > 0 && ys.map((y, t) => <span key={t} className="gut-cell" style={{ top: y }} title={`Tier ${ROMAN[t]}: ${tierPoints(t)} points in the branch`}>{tierPoints(t)}</span>)}
      </div>
    </div>
  );
}

function Detail({ me, cls, node, pending, onSpend, mastery }: { me: Player; cls: ClassDef; node: NodeDef | null; pending: boolean; onSpend: (id: string) => void; mastery: ReactNode }) {
  if (!node) {
    return (
      <aside id="node-detail" className="well tree-side" aria-live="polite">
        {mastery}
        <p className="muted">Select a socket to inspect it. Arrow keys move between sockets; Enter or double-click spends a point.</p>
      </aside>
    );
  }
  const rank = me.ranks[node.id] ?? 0;
  const st = status(me, node, cls);
  const evo = evolvesFrom(node, cls);
  const word = tierWord(node);
  const sort = sortOf(node);
  const need = tierPoints(node.tier), spent = me.spentByBranch[node.branch] ?? 0;
  const rivals = (node.excludes ?? []).filter((id) => NODE_BY_ID[id]);
  // requirements in one compact row: branch points, prerequisites, the rival choice and the point cost
  const reqs: { ok: boolean; text: string }[] = [];
  if (need > 0) reqs.push({ ok: spent >= need, text: `${spent}/${need} pts ${branchName(cls, node.branch)}` });
  for (const pr of node.prereqs) reqs.push({ ok: (me.ranks[pr.node] ?? 0) >= pr.rank, text: `${nameOf(pr.node)}${pr.rank > 1 ? ` ${pr.rank}` : ''}` });
  if (rivals.length) reqs.push({ ok: !rivals.some((id) => owns(me, id)), text: `Not ${rivals.map(nameOf).join(' / ')}` });
  if (!node.starting && rank < node.rankLimit) reqs.push({ ok: me.skillPoints >= node.costPerRank, text: `${node.costPerRank} pt` });
  const delta = changes(me, node, cls);
  // upgrades with no stat factor state their change in the "What changes" box, so the description is not repeated
  const desc = sort === 'upgrade' && !node.modifiers.length ? null : nodeText(node, rank);
  return (
    <aside id="node-detail" className="well tree-side" aria-live="polite">
      <div className="td-scroll">
        {mastery}
        <div className="td-head">
          <span className={`tnode static n-${sort} k-${st.kind} ${st.can ? 'can' : ''} ${isKey(node) ? 'key' : isCap(node) ? 'cap' : ''}`} style={{ width: isKey(node) ? 72 : 56, height: isKey(node) ? 72 : 56 }}>
            <span className="tframe" aria-hidden="true" />
            {sort === 'grant' && !isKey(node) && <span className="tgems" aria-hidden="true" />}
            <NodeIcon nodeId={node.id} size={32} className="ticon" />
          </span>
          <div className="grow">
            <h3 className="td-name">{node.name}</h3>
            <div className="td-tags">Tier {ROMAN[node.tier]}{word ? ` · ${word}` : ''} · Rank {rank}/{node.rankLimit}{rivals.length ? ' · Choice' : ''}</div>
          </div>
        </div>
        <KindPlate node={node} evo={evo} />
        {desc && <p className="td-desc">{desc}</p>}
        {delta.length > 0 && (
          <div className="td-change">
            <span className="lbl">What changes</span>
            {delta.map((c, i) => (
              <span key={i} className="ln">
                {c.label && <span className="k">{c.label}</span>}
                {c.from !== undefined && <><span className="from">{c.from}</span><span className="arr" aria-label="becomes">→</span></>}
                <span className="to">{c.to}</span>
                {c.meta && <span className="meta">{c.meta}</span>}
              </span>
            ))}
          </div>
        )}
        {reqs.length > 0 && (
          <ul className="td-reqs inline" aria-label="Requires">{reqs.map((r, i) => <li key={i} className={r.ok ? 'ok' : 'no'}><span className="sr-only">{r.ok ? 'Met: ' : 'Not met: '}</span>{r.text}</li>)}</ul>
        )}
      </div>
      <button className="btn primary td-spend" disabled={!st.can || pending} onClick={() => onSpend(node.id)}>
        {pending ? 'Spending…' : st.can ? `Spend ${node.costPerRank} point${node.costPerRank === 1 ? '' : 's'}` : st.short}
      </button>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// screen
// ---------------------------------------------------------------------------------------------------------------

/** `onClose`: shown as a closable sheet over the training grounds (free ranks and refunds; simulation training.ts). */
export function SkillTree({ net, onClose }: { net: GameConnection; onClose?: () => void }) {
  const phase = useStore(netStore, (s) => s.phase);
  const slot = useStore(netStore, (s) => s.slot);
  const serverTick = useStore(netStore, (s) => s.serverTick);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [roomy, setRoomy] = useState(false);
  const [pending, setPending] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');
  const [myBuilds, setMyBuilds] = useState<{ id: string; name: string; classId: string; ranks: Record<string, number> }[] | null>(null);
  const signedIn = useStore(authStore, (s) => s.status === 'signedIn');
  useEffect(() => { if (authStore.get().status === 'unknown') refreshAuth().catch(() => undefined); }, []);
  const treeRef = useRef<HTMLDivElement>(null);
  const me = phase?.players[slot];
  useEffect(() => { setPending(false); }, [me?.skillPoints, me?.ranks]);
  const cls = me ? CLASS_BY_ID[me.classId] : null;
  const nodesByBranch = useMemo(() => {
    const out: Record<string, NodeDef[]> = {};
    if (!cls) return out;
    for (const b of cls.branches) out[b.id] = cls.nodes.map((id) => NODE_BY_ID[id]).filter((n): n is NodeDef => !!n && n.branch === b.id).sort((a, b2) => a.tier - b2.tier);
    return out;
  }, [cls]);
  const rows = useMemo(() => Math.max(4, ...Object.values(nodesByBranch).flat().map((n) => n.tier + 1)), [nodesByBranch]);
  // default selection: the first socket you can buy, else the first socket of the first branch
  useEffect(() => {
    if (!cls || !me) return;
    if (focus && NODE_BY_ID[focus]?.classId === cls.id) return;
    const all = cls.branches.flatMap((b) => nodesByBranch[b.id] ?? []);
    setFocus((all.find((n) => status(me, n, cls).can) ?? all[0])?.id ?? null);
  }, [cls, me, focus, nodesByBranch]);
  useEffect(() => { if (copied === 'idle') return; const t = setTimeout(() => setCopied('idle'), 1600); return () => clearTimeout(t); }, [copied]);
  useEffect(() => { if (savedState === 'idle' || savedState === 'saving') return; const t = setTimeout(() => setSavedState('idle'), 2000); return () => clearTimeout(t); }, [savedState]);
  // saved account builds for this vessel, offered in the import popover
  useEffect(() => {
    if (!importOpen || !signedIn || myBuilds) return;
    accountApi<{ builds: { id: string; name: string; classId: string; ranks: Record<string, number> }[] }>('GET', '/builds').then((r) => setMyBuilds(r.builds)).catch(() => setMyBuilds([]));
  }, [importOpen, signedIn, myBuilds]);
  if (!phase || !me || !cls) return null;
  const loadout = phase.phase === 'LOADOUT_LOCK';
  const training = !!onClose && !!phase.training;
  const focused = focus ? NODE_BY_ID[focus] ?? null : null;
  const spend = (id: string) => { if (pending) return; setPending(true); net.allocate(id); setTimeout(() => setPending(false), 1500); };
  const secs = deadlineSeconds(phase.deadlineTick, serverTick);
  const exportBuild = () => {
    const data = JSON.stringify({ format: 'cursebound-build-1', classId: me.classId, ranks: Object.fromEntries(Object.entries(me.ranks).filter(([id]) => !NODE_BY_ID[id]?.starting)) });
    if (!navigator.clipboard) { setCopied('fail'); return; }
    navigator.clipboard.writeText(data).then(() => setCopied('ok'), () => setCopied('fail'));
  };
  const saveToAccount = () => {
    setSavedState('saving');
    const ranks = Object.fromEntries(Object.entries(me.ranks).filter(([id]) => !NODE_BY_ID[id]?.starting));
    accountApi('POST', '/builds', { name: loadout ? `${cls.name} plan` : `${cls.name} · round ${phase.round}`, classId: me.classId, ranks, mastery: me.mastery })
      .then(() => { setSavedState('ok'); setMyBuilds(null); }, () => setSavedState('fail'));
  };
  const applyRanks = (ranks: Record<string, number>) => {
    // data only: node IDs and ranks are validated by the authority one point at a time
    const order = Object.entries(ranks).filter(([id, r]) => NODE_BY_ID[id] && Number.isInteger(r) && r > 0 && r <= NODE_BY_ID[id].rankLimit)
      .sort((x, y) => NODE_BY_ID[x[0]].tier - NODE_BY_ID[y[0]].tier);
    let delay = 0;
    for (const [id, r] of order) for (let i = 0; i < r; i++) { setTimeout(() => net.allocate(id), delay); delay += 60; }
    setImportText(''); setImportErr(null); setImportOpen(false);
  };
  const importBuild = () => {
    try {
      const b = JSON.parse(importText) as { format: string; classId: string; ranks: Record<string, number> };
      if (b.format !== 'cursebound-build-1' || typeof b.ranks !== 'object') throw new Error('That is not a CURSEBOUND build.');
      if (b.classId !== me.classId) throw new Error(`That build is for the ${CLASS_BY_ID[b.classId]?.name ?? b.classId}, not the ${cls.name}.`);
      applyRanks(b.ranks);
    } catch (e) { setImportErr(e instanceof SyntaxError ? 'That is not valid build text.' : (e as Error).message); }
  };
  // spatial arrow-key navigation across all three branches; Enter spends, Space/click selects
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, n: NodeDef, st: Status) => {
    if (e.key === 'Enter') { e.preventDefault(); setFocus(n.id); if (st.can) spend(n.id); return; }
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!dir || !treeRef.current) return;
    e.preventDefault();
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const cur = rect(e.currentTarget);
    let best: HTMLButtonElement | null = null, bestScore = Infinity;
    treeRef.current.querySelectorAll<HTMLButtonElement>('button.tnode').forEach((el) => {
      if (el === e.currentTarget) return;
      const c = rect(el), dx = c.x - cur.x, dy = c.y - cur.y;
      const along = dir[0] ? dx * dir[0] : dy * dir[1], across = dir[0] ? Math.abs(dy) : Math.abs(dx);
      if (along <= 4) return;
      const sc = along + across * 2.5;
      if (sc < bestScore) { bestScore = sc; best = el; }
    });
    (best as HTMLButtonElement | null)?.focus();
  };
  const mastery = me.canMastery ? (
    <section className="td-mastery" aria-labelledby="mastery-h">
      <h4 id="mastery-h" className="engraved">Mastery · tree complete</h4>
      <p className="muted">Each choice compounds independently (×1.05). Mastery is not a Fate Card.</p>
      <div className="td-mastery-row">{MASTERY_CHOICES.map((m) => {
        const k = m.id.replace('mastery_', '') as 'damage' | 'health' | 'recovery';
        return <button key={m.id} className="btn small" onClick={() => net.mastery(k)}><NodeIcon nodeId={m.id} size={16} /> {m.name} · {me.mastery[k]}</button>;
      })}</div>
    </section>
  ) : null;
  const readyCount = phase.players.filter((p) => p.ready).length, present = phase.players.filter((p) => p.connected).length;
  return (
    <div className="overlay tree-overlay">
      <div className="frame sheet fit ornate crest tree-sheet" role="region" aria-labelledby="tree-h">
        <header className="panel-head tree-head">
          <div className="tree-title">
            <ClassEmblem classId={me.classId as Parameters<typeof ClassEmblem>[0]['classId']} size={48} />
            <div>
              <h2 id="tree-h" className="panel-title sm">{training ? 'Training Grounds' : loadout ? 'Loadout' : `Round ${phase.round} cleared`}</h2>
              <div className="panel-sub">{cls.name} · {cls.role}</div>
            </div>
          </div>
          <div className="row">
            {phase.lastClear && !loadout && <span className="chip good">+{score(phase.lastClear.points)} banked</span>}
            {secs !== null && <span className="chip warn" role="timer">{Math.ceil(secs)}s left</span>}
            {training ? <span className="chip good">Free ranks · free refunds</span> : <span className="chip gold">Score {score(phase.scoreText)}</span>}
          </div>
        </header>

        <div className="sheet-body tree-layout">
          <div className="tree-branches" ref={treeRef} style={{ '--rows': rows } as CSSProperties}>
            <Gutter rows={rows} roomy={roomy} />
            {cls.branches.map((b) => (
              <Branch key={b.id} cls={cls} branch={b} nodes={nodesByBranch[b.id] ?? []} rows={rows} me={me} focus={focus} hover={hover}
                onSelect={setFocus} onHover={setHover} onSpend={spend} onKey={onKey} onRoomy={b.id === cls.branches[0].id ? setRoomy : undefined} />
            ))}
          </div>
          <Detail me={me} cls={cls} node={focused} pending={pending} onSpend={spend} mastery={mastery} />
        </div>

        <footer className="sheet-foot tree-foot">
          <div className="tree-points" aria-label={`${me.skillPoints} skill point${me.skillPoints === 1 ? '' : 's'} to spend`}>
            <span className={`pts ${me.skillPoints === 0 ? 'zero' : ''}`} aria-hidden="true">{training ? '∞' : me.skillPoints}</span>
            <span className="lbl" aria-hidden="true">Skill<br />points</span>
          </div>
          <div className="tree-tools">
            {(loadout || training) && <button className="btn small ghost" onClick={() => net.refund()} data-tip={training ? 'Free while training' : 'Before round 1 only'}>Refund all</button>}
            <button className="btn small ghost" onClick={exportBuild} aria-live="polite">{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy build'}</button>
            {signedIn && <button className="btn small ghost" disabled={savedState === 'saving'} onClick={saveToAccount} aria-live="polite" data-tip="Keep this build in your account">{savedState === 'ok' ? 'Saved' : savedState === 'fail' ? 'Save failed' : savedState === 'saving' ? 'Saving…' : 'Save build'}</button>}
            {(loadout || training) && <button className="btn small ghost" aria-expanded={importOpen} aria-controls="import-pop" onClick={() => { setImportOpen((v) => !v); setImportErr(null); }}>Import…</button>}
          </div>
          <span className="grow" />
          {phase.players.length > 1 && <span className="foot-note">{readyCount}/{present} ready</span>}
          {training ? <button className="btn big primary" onClick={onClose}>Back to the yard <span className="kbd">K</span></button> : (
            <button className={`btn big ${me.ready ? '' : 'primary'}`} onClick={() => net.ready(!me.ready)}>
              {me.ready ? 'Waiting… (undo)' : loadout ? 'Begin round 1' : 'Continue to Fate'}
            </button>
          )}
          {importOpen && (loadout || training) && (
            <div id="import-pop" className="frame import-pop" role="dialog" aria-label="Import build">
              <label className="engraved" htmlFor="imp">Paste build text</label>
              <div className="row">
                <input id="imp" className="grow" value={importText} autoFocus onChange={(e) => setImportText(e.target.value)} placeholder='{"format":"cursebound-build-1",…}'
                  onKeyDown={(e) => { if (e.key === 'Escape') setImportOpen(false); if (e.key === 'Enter' && importText) importBuild(); }} />
                <button className="btn small primary" disabled={!importText} onClick={importBuild}>Apply</button>
                <button className="btn small ghost" onClick={() => setImportOpen(false)}>Cancel</button>
              </div>
              {importErr && <p className="neg" role="alert">{importErr}</p>}
              {signedIn && (() => {
                const mine = (myBuilds ?? []).filter((b) => b.classId === me.classId);
                return (
                  <div className="import-saved">
                    <span className="engraved">Your saved {cls.name} builds</span>
                    {myBuilds === null ? <p className="muted">Loading…</p> : mine.length === 0 ? <p className="muted">None yet — use “Save build” after a run.</p> : (
                      <ul className="friend-list">{mine.slice(0, 8).map((b) => (
                        <li key={b.id}><span className="grow">{b.name} <span className="faint">· {Object.values(b.ranks).reduce((x, y) => x + y, 0)} ranks</span></span><button className="btn small" onClick={() => applyRanks(b.ranks)}>Apply</button></li>
                      ))}</ul>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
