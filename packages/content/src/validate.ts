import { CARDS, RARITY_WEIGHTS, TUTORIAL_CARD, cardRarity } from './cards';
import { MECHANICS, MECHANIC_BY_ID, mechanicText } from './mechanics';
import { BRANCH_TIER_POINTS, CLASSES, NODES, NODE_BY_ID, SKILLS, SKILL_BY_ID } from './classes';
import { ARENA_DESIGNS, BOSSES, BOSS_ARENAS, DUNGEON_THEMES, ENEMIES, ENEMY_BY_ID, PACK_BY_ID, PACK_TEMPLATES, ROOM_KINDS, THEME_PACKS, THEME_ROOM_WEIGHTS } from './enemies';
import { STAT_BY_ID, isKnownStat } from './stats';
import { validateLegendaries } from './legendaries';
import type { CardDef, NodeDef } from './types';

// Authoring-time content validation (PRD §8.2, §15.3, §21.2). Invalid content is rejected during authoring,
// never silently removed from an active offer.

const DECIMAL = /^-?(0|[1-9]\d{0,8})(\.\d{1,12})?$/;
const POS_DECIMAL = /^(0|[1-9]\d{0,8})(\.\d{1,12})?$/;

export function validateCard(card: CardDef): string[] {
  const errs: string[] = [];
  for (const [label, eff] of [['positive', card.positive], ['negative', card.negative]] as const) {
    if (!eff) continue;
    if (!STAT_BY_ID[eff.stat]) errs.push(`${card.id}: ${label} unknown stat ${eff.stat}`);
    else if (!STAT_BY_ID[eff.stat].fateEligible) errs.push(`${card.id}: ${label} stat ${eff.stat} is tree-only`);
    if (!DECIMAL.test(eff.percent)) errs.push(`${card.id}: ${label} percent '${eff.percent}' is not a finite decimal`);
    else if (Number(eff.percent) <= -100) errs.push(`${card.id}: ${label} percent ${eff.percent} would make a factor <= 0 (needs explicit zero-state semantics)`);
  }
  for (const [label, kind, eff] of [['boon', 'boon', card.boon], ['bane', 'bane', card.bane]] as const) {
    if (!eff) continue;
    const def = MECHANIC_BY_ID[eff.id];
    if (!def) { errs.push(`${card.id}: ${label} unknown mechanic ${eff.id}`); continue; }
    if (def.kind !== kind) errs.push(`${card.id}: ${label} slot holds a ${def.kind} (${eff.id})`);
    if (!POS_DECIMAL.test(eff.magnitude) || Number(eff.magnitude) <= 0) errs.push(`${card.id}: ${label} magnitude '${eff.magnitude}' must be a positive finite decimal`);
    else if (def.stacking === 'chance' && Number(eff.magnitude) >= 1) errs.push(`${card.id}: ${label} chance magnitude ${eff.magnitude} must be below 1`);
    else if (def.stacking === 'factor' && Number(eff.magnitude) <= 1) errs.push(`${card.id}: ${label} factor magnitude ${eff.magnitude} must exceed 1`);
  }
  // every card is a real gift plus a real price (PRD pillar)
  if (!card.positive && !card.boon) errs.push(`${card.id}: needs a gift (positive stat and/or boon)`);
  if (!card.negative && !card.bane) errs.push(`${card.id}: needs a price (negative stat and/or bane)`);
  const rarity = cardRarity(card);
  if (!(rarity in RARITY_WEIGHTS)) errs.push(`${card.id}: unknown rarity ${String(card.rarity)}`);
  if (rarity === 'mythic' && (!card.boon || !card.bane)) errs.push(`${card.id}: mythic cards need both a boon and a bane`);
  return errs;
}

export function validateMechanics(): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const m of MECHANICS) {
    if (ids.has(m.id)) errs.push(`duplicate mechanic id ${m.id}`);
    ids.add(m.id);
    if (!/^#[0-9a-f]{6}$/i.test(m.color)) errs.push(`${m.id}: color must be #rrggbb`);
    for (const [label, t] of [['short', m.short], ['description', m.description]] as const) {
      if (!t.includes('{v}')) errs.push(`${m.id}: ${label} must show the magnitude {v}`);
      const filled = mechanicText(m, t, '100%');
      if (/\{[a-zA-Z]+%?\}/.test(filled)) errs.push(`${m.id}: ${label} has an unknown placeholder (${filled})`);
    }
    if (mechanicText(m, m.short, m.unit === 'percent' ? '99.9%' : '×999').length > 48) errs.push(`${m.id}: short text must stay within 48 characters`);
    for (const [k, v] of Object.entries(m.params)) if (!Number.isFinite(v) || v < 0) errs.push(`${m.id}: param ${k} must be a finite non-negative number`);
  }
  return errs;
}

function detectCycles(nodes: NodeDef[]): string[] {
  const errs: string[] = [];
  const state = new Map<string, number>();
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === 1) { errs.push(`prerequisite cycle: ${[...path, id].join(' -> ')}`); return; }
    if (s === 2) return;
    state.set(id, 1);
    const node = NODE_BY_ID[id];
    for (const p of node?.prereqs ?? []) visit(p.node, [...path, id]);
    state.set(id, 2);
  };
  for (const node of nodes) visit(node.id, []);
  return errs;
}

/** A node is reachable if, spending points greedily in its branch, all tier and prereq requirements can be met. */
function unreachable(classId: string): string[] {
  const nodes = NODES.filter((x) => x.classId === classId);
  const ranks = new Map<string, number>();
  for (const x of nodes) if (x.starting) ranks.set(x.id, x.rankLimit);
  const branchSpent = (b: string) => nodes.filter((x) => x.branch === b && !x.starting).reduce((s, x) => s + (ranks.get(x.id) ?? 0) * x.costPerRank, 0);
  let progress = true;
  while (progress) {
    progress = false;
    for (const x of nodes) {
      const r = ranks.get(x.id) ?? 0;
      if (r >= x.rankLimit) continue;
      if (branchSpent(x.branch) < BRANCH_TIER_POINTS[x.tier]) continue;
      if (!x.prereqs.every((p) => (ranks.get(p.node) ?? 0) >= p.rank)) continue;
      ranks.set(x.id, r + 1);   // exclusions are ignored here: each choice must be reachable on its own
      progress = true;
    }
  }
  return nodes.filter((x) => (ranks.get(x.id) ?? 0) < x.rankLimit).map((x) => `${x.id}: unreachable`);
}

export function validateContent(): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const card of CARDS) {
    if (ids.has(card.id)) errs.push(`duplicate card id ${card.id}`);
    ids.add(card.id);
    errs.push(...validateCard(card));
  }
  if (CARDS.length < 24) errs.push(`MVP requires at least 24 cards (have ${CARDS.length})`);
  errs.push(...validateCard(TUTORIAL_CARD));
  errs.push(...validateMechanics());
  for (const r of Object.keys(RARITY_WEIGHTS)) if (!CARDS.some((c) => cardRarity(c) === r)) errs.push(`deck has no ${r} card (every rarity must stay possible)`);
  for (const m of MECHANICS) if (!CARDS.some((c) => c.boon?.id === m.id || c.bane?.id === m.id)) errs.push(`${m.id}: no card carries this mechanic`);

  for (const node of NODES) {
    for (const m of node.modifiers) {
      if (!isKnownStat(m.stat)) errs.push(`${node.id}: unknown modifier stat ${m.stat}`);
      if (!POS_DECIMAL.test(m.factorPerRank) || Number(m.factorPerRank) <= 0) errs.push(`${node.id}: invalid factor ${m.factorPerRank}`);
    }
    if (node.grantsSkill && !SKILL_BY_ID[node.grantsSkill]) errs.push(`${node.id}: unresolvable skill ${node.grantsSkill}`);
    for (const p of node.prereqs) {
      if (!NODE_BY_ID[p.node]) errs.push(`${node.id}: unknown prerequisite ${p.node}`);
      else if (NODE_BY_ID[p.node].classId !== node.classId) errs.push(`${node.id}: cross-class prerequisite`);
    }
    if (node.rankLimit < 1) errs.push(`${node.id}: rankLimit < 1`);
  }
  errs.push(...detectCycles(NODES));
  for (const node of NODES) {
    for (const x of node.excludes ?? []) {
      const other = NODE_BY_ID[x];
      if (!other) errs.push(`${node.id}: excludes unknown node ${x}`);
      else if (other.classId !== node.classId) errs.push(`${node.id}: excludes a node of another class`);
      else if (!(other.excludes ?? []).includes(node.id)) errs.push(`${node.id}: exclusion with ${x} must be declared on both nodes`);
      if (node.prereqs.some((p) => p.node === x)) errs.push(`${node.id}: cannot require a node it excludes (${x})`);
    }
  }
  for (const cls of CLASSES) {
    const nodes = NODES.filter((x) => x.classId === cls.id);
    if (cls.branches.length !== 3) errs.push(`${cls.id}: classes have exactly 3 branches (one active skill slot each)`);
    if (nodes.length < 18) errs.push(`${cls.id}: classes need at least 18 nodes (have ${nodes.length})`);
    if (!/^#[0-9a-f]{6}$/i.test(cls.accent)) errs.push(`${cls.id}: accent must be a #rrggbb colour`);
    for (const b of cls.branches) {
      const bn = nodes.filter((x) => x.branch === b.id);
      if (bn.length < 6) errs.push(`${cls.id}/${b.id}: needs at least 6 nodes`);
      if (!bn.some((x) => x.tier >= 3)) errs.push(`${cls.id}/${b.id}: needs a capstone`);
      const grants = bn.filter((x) => x.grantsSkill).sort((a, c) => a.tier - c.tier);
      if (grants.length < 1 || grants.length > 3) errs.push(`${cls.id}/${b.id}: a branch grants 1 to 3 active skills (base + evolutions)`);
      else if (grants[0].tier !== 0) errs.push(`${cls.id}/${b.id}: the branch's base active skill is granted at tier 0`);
      for (const g of grants.slice(1)) if (g.tier < 2) errs.push(`${cls.id}/${b.id}: evolved skill ${g.id} must sit at tier 2 or higher`);
      // with one pick per choice group, the branch must still hold enough ranks to open its highest tier
      const maxTier = Math.max(...bn.map((x) => x.tier));
      const seen = new Set<string>();
      let capacity = 0;
      for (const x of bn) {
        if (x.starting || seen.has(x.id)) continue;
        const group = [x.id, ...(x.excludes ?? [])].filter((id) => NODE_BY_ID[id]?.branch === b.id);
        group.forEach((id) => seen.add(id));
        capacity += Math.max(...group.map((id) => NODE_BY_ID[id].rankLimit * NODE_BY_ID[id].costPerRank));
      }
      const needAbove = bn.filter((x) => x.tier === maxTier && !x.starting).reduce((m, x) => Math.min(m, x.rankLimit * x.costPerRank), Infinity);
      if (capacity - needAbove < BRANCH_TIER_POINTS[maxTier]) errs.push(`${cls.id}/${b.id}: not enough non-exclusive ranks to open tier ${maxTier}`);
    }
    if (!SKILL_BY_ID[cls.basicSkill]) errs.push(`${cls.id}: missing basic skill`);
    if (!SKILL_BY_ID[cls.signatureSkill]) errs.push(`${cls.id}: missing signature skill`);
    errs.push(...unreachable(cls.id));
  }
  for (const s of SKILLS) {
    if (!POS_DECIMAL.test(s.damageCoef)) errs.push(`${s.id}: invalid damageCoef`);
    if (!s.compressionSupport) errs.push(`${s.id}: not supported by the extreme compressor; cannot enter release content`);
  }
  for (const e of [...ENEMIES, ...BOSSES]) {
    for (const a of e.attacks) {
      if (!POS_DECIMAL.test(a.damageCoef)) errs.push(`${e.id}/${a.id}: invalid damageCoef`);
      if (a.windupSec <= 0) errs.push(`${e.id}/${a.id}: base windup must be positive (readable baseline)`);
    }
  }
  for (const b of BOSSES) {
    const ids2 = new Set(b.attacks.map((a) => a.id));
    for (const ph of b.phases) for (const pat of ph.patterns) for (const a of pat) if (!ids2.has(a)) errs.push(`${b.id}: pattern references unknown attack ${a}`);
  }
  // packs (director.ts population): known archetypes, every theme has at least one round-1 pack
  for (const pk of PACK_TEMPLATES) {
    for (const k of [pk.lead, ...pk.fodder]) if (!ENEMY_BY_ID[k] || ENEMY_BY_ID[k].tags.includes('summon')) errs.push(`pack ${pk.id}: unknown or summon archetype ${k}`);
  }
  for (const t of DUNGEON_THEMES) {
    const w = THEME_PACKS[t.id];
    if (!w) { errs.push(`theme ${t.id}: no pack weights`); continue; }
    for (const id of Object.keys(w)) if (!PACK_BY_ID[id]) errs.push(`theme ${t.id}: unknown pack ${id}`);
    if (!Object.keys(w).some((id) => (PACK_BY_ID[id]?.minRound ?? 99) <= 1)) errs.push(`theme ${t.id}: no round-1 pack`);
  }
  // dungeon structure (mapgen tiers): every theme weighs known room kinds, every boss has a known arena design
  const kinds = new Set(ROOM_KINDS.map((k) => k.id));
  for (const t of DUNGEON_THEMES) {
    const w = THEME_ROOM_WEIGHTS[t.id];
    if (!w) { errs.push(`theme ${t.id}: no room kind weights`); continue; }
    for (const id of Object.keys(w)) if (!kinds.has(id)) errs.push(`theme ${t.id}: unknown room kind ${id}`);
  }
  const arenas = new Set(ARENA_DESIGNS.map((a) => a.id));
  for (const b of BOSSES) {
    const list = BOSS_ARENAS[b.id];
    if (!list?.length) errs.push(`${b.id}: no arena design`);
    for (const a of list ?? []) if (!arenas.has(a)) errs.push(`${b.id}: unknown arena design ${a}`);
  }
  for (const e of [...ENEMIES, ...BOSSES]) for (const a of e.attacks) {
    if (a.inflict && !(a.inflict.sec > 0 && a.inflict.sec <= 4)) errs.push(`${e.id}/${a.id}: affliction durations must be short (0..4 s)`);
  }
  errs.push(...validateLegendaries());
  return errs;
}
