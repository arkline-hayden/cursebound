'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { BOSSES, CLASSES, ENEMY_BY_ID, PACK_TEMPLATES } from '@cursebound/content';
import { netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import { ClassEmblem } from './icons';
import { SkillTree } from './SkillTree';

// Training grounds tool drawer (training rooms only; simulation training.ts validates every tool). A slim carved tab
// on the left edge opens a compact pixel-art drawer: spawn any pack (ordinary / champion / rare), either boss, the foe
// level that scales new spawns, clear the yard, switch foe AI off, reset cooldowns, heal, swap class, and open the
// skill tree (free ranks and refunds while training). Keys: T toggles the drawer, K the skill tree.

const ORANGE = '#ff8a1e';
const TIERS = [{ id: 0, name: 'Normal', color: 'var(--text-2)' }, { id: 1, name: 'Champion', color: '#6ab4ff' }, { id: 2, name: 'Rare', color: '#ffd23f' }] as const;
const lab: CSSProperties = { fontFamily: 'var(--font-label)', fontSize: 'var(--fs-small)', lineHeight: 'var(--lh-small)', textTransform: 'uppercase', color: 'var(--text-3)' };
const grid = (cols: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 4 });
/** A boss button label that fits half the drawer: "The Corrupted Core" -> "Core" (the full name is the tooltip). */
const bossLabel = (name: string): string => { const n = name.replace(/^The /, ''); return n.length > 12 ? n.split(' ').pop()! : n; };
const tight: CSSProperties ={ padding: '2px 6px', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/** Short pack label: the lead foe's name ("Ghoul Hound" pack). */
function packName(lead: string): string {
  return ENEMY_BY_ID[lead]?.name ?? lead;
}

export function TrainingPanel({ net }: { net: GameConnection }) {
  const [open, setOpen] = useState(true);
  const [tree, setTree] = useState(false);
  const [tier, setTier] = useState<0 | 1 | 2>(0);
  const phase = useStore(netStore, (s) => s.phase);
  const slot = useStore(netStore, (s) => s.slot);
  const aiOn = useStore(netStore, (s) => (s.hud?.tr?.ai ?? 1) === 1);
  const foes = useStore(netStore, (s) => s.hud?.enemies.filter((e) => e.st !== 'dying').length ?? 0);
  const me = phase?.players[slot];
  const level = phase?.round ?? 1;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) || e.repeat) return;
      if (e.code === 'KeyT') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.code === 'KeyK') { e.preventDefault(); setTree((v) => !v); }
      else if (e.code === 'Escape' && tree) { e.preventDefault(); e.stopPropagation(); setTree(false); }
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [tree]);

  if (!phase?.training) return null;
  return (
    <>
      <aside aria-label="Training tools" style={{
        position: 'fixed', left: 0, top: 'calc(140px * var(--hud-zoom, 1))', zIndex: 'var(--z-hint)' as unknown as number, display: 'flex', alignItems: 'flex-start',
        transform: open ? 'none' : 'translateX(calc(-100% + 34px))', transition: 'transform 0.12s steps(3)',
      }}>
        <div className="frame" style={{ width: 'min(330px, 80vw)', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderLeft: 'none' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--font-gothic)', fontSize: 'var(--fs-goth-sm)', color: ORANGE, textShadow: '2px 2px 0 #000' }}>Training Grounds</span>
            <span style={lab}>{foes} foe{foes === 1 ? '' : 's'}</span>
          </div>

          <span style={lab}>Spawn a pack</span>
          <div role="radiogroup" aria-label="Pack tier" style={grid(3)}>
            {TIERS.map((t) => (
              <button key={t.id} role="radio" aria-checked={tier === t.id} className={`btn small ${tier === t.id ? 'primary' : 'ghost'}`} style={{ ...tight, color: tier === t.id ? undefined : t.color }} onClick={() => setTier(t.id)}>{t.name}</button>
            ))}
          </div>
          <div style={grid(2)}>
            {PACK_TEMPLATES.map((p) => (
              <button key={p.id} className="btn small" style={tight} title={`${packName(p.lead)} pack`} onClick={() => net.train('spawn', p.id, tier)}>{packName(p.lead)}</button>
            ))}
          </div>

          <span style={lab}>Bosses</span>
          <div style={grid(2)}>
            {BOSSES.map((b) => <button key={b.id} className="btn small danger" style={tight} title={`${b.name}: ${b.title}`} aria-label={`Spawn ${b.name}`} onClick={() => net.train('boss', b.id)}>{bossLabel(b.name)}</button>)}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={lab}>Foe level</span>
            <div className="row" style={{ gap: 4, alignItems: 'center' }}>
              <button className="btn small" style={tight} aria-label="Lower foe level" disabled={level <= 1} onClick={() => net.train('level', String(Math.max(1, level - (level > 10 ? 5 : 1))))}>−</button>
              <b style={{ fontFamily: 'var(--font-num)', fontSize: 'var(--fs-label)', minWidth: 32, textAlign: 'center' }} aria-live="polite">{level}</b>
              <button className="btn small" style={tight} aria-label="Raise foe level" disabled={level >= 99} onClick={() => net.train('level', String(Math.min(99, level + (level >= 10 ? 5 : 1))))}>+</button>
            </div>
          </div>

          <span style={lab}>Tools</span>
          <div style={grid(2)}>
            <button className="btn small" style={tight} onClick={() => net.train('clear')}>Clear yard</button>
            <button className={`btn small ${aiOn ? '' : 'primary'}`} style={tight} aria-pressed={!aiOn} onClick={() => net.train('ai', aiOn ? 'off' : 'on')}>{aiOn ? 'Freeze foes' : 'Foes frozen'}</button>
            <button className="btn small" style={tight} aria-label="Reset cooldowns" onClick={() => net.train('cooldowns')}>Cooldowns</button>
            <button className="btn small" style={tight} onClick={() => net.train('heal')}>Heal</button>
          </div>

          <span style={lab}>Class</span>
          <div role="radiogroup" aria-label="Class" style={grid(5)}>
            {CLASSES.map((c) => (
              <button key={c.id} role="radio" aria-checked={me?.classId === c.id} title={c.name} aria-label={c.name}
                className={`btn small ${me?.classId === c.id ? 'primary' : 'ghost'}`} style={{ padding: 2, display: 'grid', placeItems: 'center' }}
                onClick={() => { if (me?.classId !== c.id) net.train('class', c.id); }}>
                <ClassEmblem classId={c.id} size={24} />
              </button>
            ))}
          </div>

          <div style={grid(2)}>
            <button className="btn small primary" style={tight} aria-expanded={tree} onClick={() => setTree((v) => !v)}>Skill tree <span className="kbd">K</span></button>
            <Link className="btn small ghost" style={tight} href="/">Leave</Link>
          </div>
        </div>
        <button className="btn small" aria-expanded={open} aria-label={open ? 'Hide training tools' : 'Show training tools'} onClick={() => setOpen((v) => !v)}
          style={{ writingMode: 'vertical-rl', padding: '10px 4px', marginTop: 8, color: ORANGE, borderLeft: 'none' }}>
          Tools <span className="kbd" style={{ writingMode: 'horizontal-tb' }}>T</span>
        </button>
      </aside>
      {tree && <SkillTree net={net} onClose={() => setTree(false)} />}
    </>
  );
}
