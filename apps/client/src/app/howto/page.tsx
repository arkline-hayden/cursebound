'use client';

import type { CSSProperties } from 'react';
import { CARDS, CLASSES, ENEMIES, BOSSES, MECHANIC_BY_ID, STAT_BY_ID, RULES, type CardDef } from '@cursebound/content';
import { TopBar } from '@/ui/TopBar';
import { CardIcon, ClassEmblem } from '@/ui/icons';
import { readableAccent } from '@/ui/classTheme';
import { wholeNum } from '@/lib/format';

// Advanced help (PRD §16.3): percentage semantics, expected damage, scientific notation, predicted vs exact values.

function cardLines(c: CardDef) {
  const gift = [c.positive && `+${c.positive.percent}% ${STAT_BY_ID[c.positive.stat]?.name ?? c.positive.stat}`, c.boon && (MECHANIC_BY_ID[c.boon.id]?.name ?? c.boon.id)].filter(Boolean).join(' · ');
  const price = [c.negative && `${c.negative.percent}% ${STAT_BY_ID[c.negative.stat]?.name ?? c.negative.stat}`, c.bane && (MECHANIC_BY_ID[c.bane.id]?.name ?? c.bane.id)].filter(Boolean).join(' · ');
  return { gift, price };
}

export default function HowTo() {
  return (
    <>
      <TopBar current="/howto" />
      <main id="main" className="page col">
        <div className="page-head"><span className="torch" aria-hidden="true" /><h1>How to play</h1></div>
        <section className="frame ornate crest prose">
          <h2>The loop</h2>
          <ol>
            <li>Fight a finite encounter: defeat every budgeted enemy group. Every fifth round is a boss. Fallen foes sometimes drop healing potions.</li>
            <li>Spend skill points (1 per round, 2 after a boss) in your class tree. Gem-set sockets grant a <b>new skill</b>, sockets with an ember badge <b>upgrade</b> the skill shown on the badge, and plain sockets are <b>passives</b>.</li>
            <li>Three Fate Cards appear. Each has a gift and a price. The party votes; plurality wins and ties use a recorded seeded draw.</li>
            <li>The chosen card applies from the next round and stays forever. There is no final round — the run ends when the party wipes or retires.</li>
          </ol>
        </section>
        <section className="frame prose">
          <h2>Controls</h2>
          <p><b>Click to move</b> (default, like Diablo): left click the ground to walk there; hold the button to keep walking after the cursor. Left click a foe to attack it: your hero closes to striking range (archers and casters stop at bow or spell range with a clear shot) and keeps attacking until it falls; keep holding to move on to the next foe under the cursor. Hold <b>Shift</b> and click to attack in place without moving. Click a potion, a legendary beam or a door to walk onto it.</p>
          <p><b>Q</b> <b>W</b> <b>E</b> cast your skills and <b>R</b> or <b>right click</b> your signature, all aimed at the cursor; casting never cancels a walk except for movement skills and stances. <b>Space</b> dodges toward the cursor, <b>G</b> swaps a legendary, <b>I</b> opens your gear, <b>Tab</b> the Fate Ledger, <b>M</b> the minimap, <b>Esc</b> the menu. The arrow keys still step your hero directly.</p>
          <p><b>Keyboard (WASD)</b> is available in Settings › Controls: WASD moves, the mouse aims, hold left click to attack, Q E R and right click (or F) cast. A gamepad always works: left stick moves, right stick aims. Every binding can be remapped.</p>
          <p><b>Camera</b> (like League of Legends): it stays where you leave it. Push the pointer to a screen edge or drag with the <b>middle mouse button</b> to look around, hold <b>C</b> to centre on your hero, <b>Y</b> locks it to your hero, <b>F1</b> looks at you and <b>F2</b>–<b>F5</b> at your teammates. With a controller it always follows you.</p>
        </section>
        <section className="frame prose">
          <h2>Percentages multiply</h2>
          <p><b>+75%</b> means ×1.75 of your <i>current</i> value. <b>+300%</b> is ×4. <b>−30%</b> is ×0.7. Two +100% cards make ×4 (not ×3). Three −50% cards leave 12.5%.</p>
          <p>Critical tendency is an intensity <i>C</i>; your chance is C/(1+C). Doubling C from 0.25 raises chance from 20% to 33.3% — it never exceeds 100%. Expected hit = damage × ((1−q) + q × crit multiplier).</p>
          <p>Armor A reduces damage by K/(K+A) with K = {RULES.armorK}. Doubling armor never grants immunity.</p>
          <p>Numbers can grow without limit. Below 100,000 they are shown whole; above that they compact (1.23M) and eventually switch to scientific notation (1.54e450); exact values are available in the Ledger detail. No card is ever filtered because it looks too dangerous — you judge whether a reality is survivable.</p>
        </section>
        <section className="frame prose">
          <h2>Forecast and Ledger</h2>
          <p>Each offered card shows old → new values for every player. <b>Static</b> values are exact calculations from the frozen pre-choice snapshot and will match the Ledger after commit. <b>Estimates</b> (kill time, survival time, net DPS) use a reference target and say what they assume. If enemy regeneration beats your modelled damage the forecast says “model predicts no net progress” — you may still choose it.</p>
        </section>
        <section className="frame prose">
          <h2>Score</h2>
          <p>Points come only from cleared objectives: round r is worth 100×r (+500 on boss rounds), multiplied by prospective score pressure and up to +25% for clearing faster than the published reference time. A wipe banks partial credit for finished objectives on the final round. No points for damage, healing, time alive, summons or revives.</p>
        </section>
        <section className="frame">
          <h2>Classes ({CLASSES.length})</h2>
          <div className="howto-classes">
            {CLASSES.map((c) => (
              <div key={c.id} className="well howto-class" style={{ '--accent': readableAccent(c.accent) } as CSSProperties}>
                <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}><ClassEmblem classId={c.id as Parameters<typeof ClassEmblem>[0]['classId']} size={32} /><h3 style={{ margin: 0 }}>{c.name}</h3></div>
                <p className="howto-role">{c.role}</p>
                <p className="muted">{c.tagline}</p>
                <p>Life {wholeNum(c.base.maxHealth)} · armor {c.base.armor}</p>
                <p className="faint">Branches: {c.branches.map((b) => b.name).join(', ')}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="frame prose">
          <h2>Enemies of the depths</h2>
          <ul>{ENEMIES.map((e) => <li key={e.id}><b>{e.name}</b> ({e.role}) — {e.description}</li>)}</ul>
          <h3 style={{ marginTop: 24 }}>Bosses</h3>
          <ul>{BOSSES.map((b) => <li key={b.id}><b>{b.name}</b>, {b.title} — {b.description}</li>)}</ul>
        </section>
        <section className="frame">
          <h2>All Fate Cards ({CARDS.length})</h2>
          <div className="howto-cards">
            {CARDS.map((c) => {
              const { gift, price } = cardLines(c);
              return (
                <div key={c.id} className="howto-card">
                  <CardIcon cardId={c.id} size={32} />
                  <div><b>{c.name}</b>{gift && <span className="pos">{gift}</span>}{price && <span className="neg">{price}</span>}</div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
