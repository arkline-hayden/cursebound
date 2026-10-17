import { CARDS, RARITY_WEIGHTS, TUTORIAL_CARD, cardRarity } from './cards';
import { MECHANICS, MECHANIC_BY_ID, mechanicText } from './mechanics';
import { BRANCH_TIER_POINTS, CLASSES, NODES, NODE_BY_ID, SKILLS, SKILL_BY_ID } from './classes';
import { ARENA_DESIGNS, BOSSES, BOSS_ARENAS, DUNGEON_THEMES, ENEMIES, ENEMY_BY_ID, PACK_BY_ID, PACK_TEMPLATES, ROOM_KINDS, THEME_BOSSES, THEME_FOES, THEME_PACKS, THEME_ROOM_WEIGHTS } from './enemies';
import { MINIBOSS_EXCLUDED_ROLES, MINIBOSS_MECHANICS, MINIBOSS_NAMES } from './minibosses';
import { STAT_BY_ID, isKnownStat } from './stats';
import { LEGENDARY_BY_ID, validateLegendaries } from './legendaries';
import { validateRoomEvents } from './roomEvents';
import { BOUNTY_MODIFIERS } from './bounties';
import { CLASS_UNLOCKS, STARTER_CLASSES } from './progression';
import { KNOCKBACK_RULES } from './rules';
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

/**
 * Prerequisites that deliberately cross branches (node id -> prerequisite ids). The skill tree draws connectors only
 * inside a branch column, so a cross-branch link must be listed here (and shown some other way) to be allowed. None yet.
 */
export const CROSS_BRANCH_PREREQS: Record<string, string[]> = {};

/**
 * Skills that no node grants but a node provides (a summon's attack): an upgrade of one must require its provider.
 * Class basic and signature skills are always owned and need no provider.
 */
export const SKILL_PROVIDERS: Record<string, string> = { af_drone_zap: 'af_drone' };

/**
 * Skill-tree structure (PRD §6.2, SkillTree.tsx): the rules that keep prerequisites meaningful and the drawn tree
 * truthful. Takes any node list so tests can feed malformed trees.
 *  - no prerequisite cycles; every prerequisite sits at a lower tier, in the same class and (unless listed in
 *    CROSS_BRANCH_PREREQS) the same branch, so each connector runs down its own column;
 *  - choices (excludes) are declared on both nodes, pair nodes of one tier and branch (or two transformations of the
 *    same skill, such as two Astral Nova keystones), and never sit on a node's own prerequisite chain;
 *  - an upgrade requires (directly or through its chain) the node that grants or provides the skill it upgrades, and
 *    an evolution requires its branch's base skill;
 *  - every node is reachable by spending points greedily in its branch (each choice on its own).
 */
export function validateTree(nodes: NodeDef[]): string[] {
  const errs: string[] = [];
  const byId: Record<string, NodeDef> = Object.fromEntries(nodes.map((x) => [x.id, x]));
  // cycles
  const state = new Map<string, number>();
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === 1) { errs.push(`prerequisite cycle: ${[...path, id].join(' -> ')}`); return; }
    if (s === 2) return;
    state.set(id, 1);
    for (const p of byId[id]?.prereqs ?? []) visit(p.node, [...path, id]);
    state.set(id, 2);
  };
  for (const x of nodes) visit(x.id, []);
  if (errs.length) return errs;   // the chain walks below assume an acyclic graph
  const chain = (id: string, out = new Set<string>()): Set<string> => {
    for (const p of byId[id]?.prereqs ?? []) if (!out.has(p.node)) { out.add(p.node); chain(p.node, out); }
    return out;
  };
  const grantOf: Record<string, NodeDef> = {};
  for (const x of nodes) if (x.grantsSkill) grantOf[`${x.classId}/${x.grantsSkill}`] = x;
  for (const x of nodes) {
    for (const p of x.prereqs) {
      const pre = byId[p.node];
      if (!pre) { errs.push(`${x.id}: unknown prerequisite ${p.node}`); continue; }
      if (pre.classId !== x.classId) errs.push(`${x.id}: cross-class prerequisite ${p.node}`);
      if (pre.tier >= x.tier) errs.push(`${x.id}: prerequisite ${p.node} must sit at a lower tier (${pre.tier} >= ${x.tier})`);
      if (pre.branch !== x.branch && !CROSS_BRANCH_PREREQS[x.id]?.includes(p.node)) errs.push(`${x.id}: prerequisite ${p.node} is in another branch (${pre.branch}); list it in CROSS_BRANCH_PREREQS if deliberate`);
      if (p.rank < 1 || p.rank > pre.rankLimit) errs.push(`${x.id}: prerequisite ${p.node} rank ${p.rank} is outside 1..${pre.rankLimit}`);
    }
    const ancestors = chain(x.id);
    for (const id of (x.excludes ?? [])) {
      const other = byId[id];
      if (!other) { errs.push(`${x.id}: excludes unknown node ${id}`); continue; }
      if (other.classId !== x.classId) errs.push(`${x.id}: excludes a node of another class`);
      if (!(other.excludes ?? []).includes(x.id)) errs.push(`${x.id}: exclusion with ${id} must be declared on both nodes`);
      if (other.tier !== x.tier) errs.push(`${x.id}: a choice pairs nodes of one tier (${id} is tier ${other.tier})`);
      if (other.branch !== x.branch && !(x.upgrades && x.upgrades === other.upgrades)) errs.push(`${x.id}: choice with ${id} crosses branches without transforming the same skill`);
      if (ancestors.has(id)) errs.push(`${x.id}: cannot require a node it excludes (${id})`);
    }
    // a prerequisite chain that contains both sides of a choice can never be completed
    const line = [x.id, ...ancestors];
    for (const a of line) for (const b of byId[a]?.excludes ?? []) if (a < b && line.includes(b)) errs.push(`${x.id}: its prerequisites include both ${a} and ${b}, which exclude each other`);
    if (x.upgrades) {
      const skill = SKILL_BY_ID[x.upgrades];
      const giver = grantOf[`${x.classId}/${x.upgrades}`] ?? (SKILL_PROVIDERS[x.upgrades] ? byId[SKILL_PROVIDERS[x.upgrades]] : undefined);
      const cls = CLASSES.find((c) => c.id === x.classId);
      if (giver) { if (!ancestors.has(giver.id)) errs.push(`${x.id}: upgrades ${x.upgrades} but does not require ${giver.id}, the node that grants it`); }
      else if (skill && cls && x.upgrades !== cls.basicSkill && x.upgrades !== cls.signatureSkill) errs.push(`${x.id}: upgrades ${x.upgrades}, which no node grants (add it to SKILL_PROVIDERS)`);
    }
    if (x.grantsSkill && x.tier > 0) {
      const base = nodes.find((b) => b.classId === x.classId && b.branch === x.branch && b.tier === 0 && b.grantsSkill);
      if (base && !ancestors.has(base.id)) errs.push(`${x.id}: an evolution must require its branch's base skill ${base.id}`);
    }
  }
  // reachability: spend greedily per branch, each choice on its own (exclusions ignored)
  for (const classId of new Set(nodes.map((x) => x.classId))) {
    const own = nodes.filter((x) => x.classId === classId);
    const ranks = new Map<string, number>();
    for (const x of own) if (x.starting) ranks.set(x.id, x.rankLimit);
    const branchSpent = (b: string) => own.filter((x) => x.branch === b && !x.starting).reduce((s, x) => s + (ranks.get(x.id) ?? 0) * x.costPerRank, 0);
    let progress = true;
    while (progress) {
      progress = false;
      for (const x of own) {
        const r = ranks.get(x.id) ?? 0;
        if (r >= x.rankLimit) continue;
        if (branchSpent(x.branch) < BRANCH_TIER_POINTS[x.tier]) continue;
        if (!x.prereqs.every((p) => (ranks.get(p.node) ?? 0) >= p.rank)) continue;
        ranks.set(x.id, r + 1);
        progress = true;
      }
    }
    for (const x of own) if ((ranks.get(x.id) ?? 0) < x.rankLimit) errs.push(`${x.id}: unreachable`);
  }
  return errs;
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
    if (node.upgrades) {
      const up = SKILL_BY_ID[node.upgrades];
      if (!up) errs.push(`${node.id}: upgrades unknown skill ${node.upgrades}`);
      else if (up.classId !== node.classId) errs.push(`${node.id}: upgrades a skill of another class`);
      else if (!node.description.startsWith(`Upgrades ${up.name}: `)) errs.push(`${node.id}: upgrade copy must start "Upgrades ${up.name}: "`);
      if (node.grantsSkill) errs.push(`${node.id}: a node either grants or upgrades a skill, not both`);
    }
    if (node.rankLimit < 1) errs.push(`${node.id}: rankLimit < 1`);
  }
  errs.push(...validateTree(NODES));
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
  // theme foes (content 1.5): every native foe leads or fills one of its own theme's packs; mini-boss pools exist
  for (const [theme, foes] of Object.entries(THEME_FOES)) {
    if (!DUNGEON_THEMES.some((t) => t.id === theme)) errs.push(`theme foes: unknown theme ${theme}`);
    const packs = Object.keys(THEME_PACKS[theme] ?? {}).map((id) => PACK_BY_ID[id]).filter(Boolean);
    for (const f of foes) if (!packs.some((pk) => pk.lead === f || pk.fodder.includes(f))) errs.push(`theme ${theme}: native foe ${f} is in none of its packs`);
  }
  for (const pk of PACK_TEMPLATES) if (pk.extra !== undefined && !(Number.isInteger(pk.extra) && pk.extra >= 0 && pk.extra <= 4)) errs.push(`pack ${pk.id}: extra must be an integer 0..4`);
  for (const t of DUNGEON_THEMES) {
    const n = MINIBOSS_NAMES[t.id];
    if (!n || !n.first.length || !n.second.length || !n.epithet.length) errs.push(`theme ${t.id}: no mini-boss name parts`);
    const leads = Object.keys(THEME_PACKS[t.id] ?? {}).map((id) => ENEMY_BY_ID[PACK_BY_ID[id]?.lead ?? '']).filter((d) => d && !MINIBOSS_EXCLUDED_ROLES.includes(d.role));
    if (!leads.length) errs.push(`theme ${t.id}: no pack lead can become a mini-boss`);
  }
  if (new Set(MINIBOSS_MECHANICS.map((m) => m.id)).size !== MINIBOSS_MECHANICS.length || MINIBOSS_MECHANICS.length < 2) errs.push('mini-boss mechanics: need at least two distinct ids');
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
  // knockback (rules.ts KNOCKBACK_RULES): per-skill pushes name real skills and stay short; elites never push further
  for (const [id, d] of Object.entries(KNOCKBACK_RULES.bySkill)) {
    if (!SKILL_BY_ID[id]) errs.push(`knockback: unknown skill ${id}`);
    if (!(d >= 0 && d <= KNOCKBACK_RULES.maxPush)) errs.push(`knockback: ${id} push ${d} outside 0..${KNOCKBACK_RULES.maxPush}`);
  }
  if (KNOCKBACK_RULES.eliteFactor.some((f, i) => f < 0 || f > 1 || (i > 0 && f > KNOCKBACK_RULES.eliteFactor[i - 1]!))) errs.push('knockback: elite factors must fall from 1 by tier');
  // unique ids: two foes (or bosses) sharing an id would silently shadow each other in ENEMY_BY_ID / BOSS_BY_ID
  for (const [what, list] of [['enemy', ENEMIES], ['boss', BOSSES]] as const) {
    const seen = new Set<string>();
    for (const x of list) { if (seen.has(x.id)) errs.push(`${what} ${x.id}: duplicate id`); seen.add(x.id); }
  }
  // themed lairs: known themes and bosses, one lair per theme
  for (const [t, list] of Object.entries(THEME_BOSSES)) {
    if (!DUNGEON_THEMES.some((d) => d.id === t)) errs.push(`theme bosses: unknown theme ${t}`);
    if (!list.length) errs.push(`theme bosses ${t}: empty pool`);
    for (const id of list) if (!BOSSES.some((b) => b.id === id)) errs.push(`theme bosses ${t}: unknown boss ${id}`);
  }
  // boss reinforcement rosters name real foes; signature loot names shared (not class-only) legendaries
  for (const b of BOSSES) {
    if (b.adds && !b.adds.length) errs.push(`${b.id}: empty reinforcement roster`);
    for (const k of b.adds ?? []) if (!ENEMY_BY_ID[k]) errs.push(`${b.id}: reinforcement roster names unknown foe ${k}`);
    for (const id of b.loot ?? []) if (!LEGENDARY_BY_ID[id] || LEGENDARY_BY_ID[id].classId) errs.push(`${b.id}: unknown or class-only signature loot ${id}`);
  }
  errs.push(...validateLegendaries());
  errs.push(...validateRoomEvents(isKnownStat));   // shrines, altar pacts, merchant wares
  errs.push(...validateProgression());
  return errs;
}

/** Daily bounty modifiers (bounties.ts) and the class unlock table (progression.ts). */
export function validateProgression(): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const m of BOUNTY_MODIFIERS) {
    if (seen.has(m.id)) errs.push(`duplicate bounty ${m.id}`);
    seen.add(m.id);
    if (!/^[a-z0-9_]{1,32}$/.test(m.id)) errs.push(`bounty ${m.id}: id must be [a-z0-9_]{1,32}`);
    if (!/^#[0-9a-f]{6}$/i.test(m.color)) errs.push(`bounty ${m.id}: color must be #rrggbb`);
    if (!m.short || m.short.length > 48) errs.push(`bounty ${m.id}: short copy must be 1..48 chars (one line on the plaque)`);
    const effects = (m.stats?.length ?? 0) + (m.mechanics?.length ?? 0) + Object.keys(m.rules ?? {}).length;
    if (!effects) errs.push(`bounty ${m.id}: changes nothing`);
    for (const s of m.stats ?? []) {
      if (!STAT_BY_ID[s.stat]?.fateEligible) errs.push(`bounty ${m.id}: unknown or tree-only stat ${s.stat}`);
      if (!DECIMAL.test(s.percent) || Number(s.percent) <= -100) errs.push(`bounty ${m.id}: invalid percent ${s.percent}`);
    }
    for (const x of m.mechanics ?? []) {
      const def = MECHANIC_BY_ID[x.id];
      if (!def) errs.push(`bounty ${m.id}: unknown mechanic ${x.id}`);
      else if (def.kind !== 'bane') errs.push(`bounty ${m.id}: bounties only bind banes (${x.id} is a ${def.kind})`);
      if (!POS_DECIMAL.test(x.magnitude) || Number(x.magnitude) <= 0) errs.push(`bounty ${m.id}: invalid magnitude ${x.magnitude}`);
    }
    const r = m.rules ?? {};
    if (r.dodgeCharges !== undefined && !(Number.isInteger(r.dodgeCharges) && r.dodgeCharges >= 1)) errs.push(`bounty ${m.id}: dodgeCharges must be an integer >= 1`);
    for (const k of ['downedSecFactor', 'reviveChannelFactor'] as const) if (r[k] !== undefined && !((r[k] as number) > 0)) errs.push(`bounty ${m.id}: ${k} must be positive`);
    if (r.intermissionHealFactor !== undefined && !(r.intermissionHealFactor >= 0)) errs.push(`bounty ${m.id}: intermissionHealFactor must be >= 0`);
    if (r.fatePriceCopies !== undefined && !(Number.isInteger(r.fatePriceCopies) && r.fatePriceCopies >= 1 && r.fatePriceCopies <= 4)) errs.push(`bounty ${m.id}: fatePriceCopies must be 1..4`);
  }
  if (BOUNTY_MODIFIERS.length < 2) errs.push('the daily bounty needs at least two modifiers (it never repeats)');
  const unlockIds = new Set<string>([...STARTER_CLASSES, ...CLASS_UNLOCKS.map((u) => u.classId)]);
  for (const cls of CLASSES) if (!unlockIds.has(cls.id)) errs.push(`${cls.id}: not in STARTER_CLASSES or CLASS_UNLOCKS`);
  for (const id of unlockIds) if (!CLASSES.some((c) => c.id === id)) errs.push(`unlock table names unknown class ${id}`);
  if (unlockIds.size !== STARTER_CLASSES.length + CLASS_UNLOCKS.length) errs.push('a class is listed twice in the unlock table');
  for (let i = 1; i < CLASS_UNLOCKS.length; i++) if (CLASS_UNLOCKS[i].level <= CLASS_UNLOCKS[i - 1].level) errs.push('CLASS_UNLOCKS must ascend by level');
  return errs;
}
