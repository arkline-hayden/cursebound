import { Big } from '@cursebound/numeric';
import { BOSSES, CLASS_BY_ID, TICK_RATE, type DamageType } from '@cursebound/content';
import { registerGlobalHooks } from './hooks';
import type { Hazard, PlayerState, Projectile, SimEvent, SimState } from './types';

// Post-run breakdown (Results, Records, the live "You died to…" card). Pure observation of the simulation:
//   - per hero: damage dealt and kills per skill (basic attack, each skill, signature; summons / pets / turrets /
//     fields count for the skill that made them, damage over time for the skill that applied it), damage taken by
//     source (foe / boss / hazard / curse, with each source's attacks), healing done and received, dodges, downs,
//     deaths and revives;
//   - a death recap per fall: the last RECAP_WINDOW_SEC of damage taken (source, attack, amount, damage type), the
//     killing blow and the debuffs active at that moment.
// Everything lives in a side table keyed by the SimState object (a WeakMap), never in the state itself: the
// simulation never reads it back, so it cannot change an outcome, and it is not part of stateHash / checkpoints /
// replay verification. It is deterministic all the same (only simulation values feed it), so a replay from tick 0
// rebuilds the same breakdown. The authority carries it across a checkpoint restore in the checkpoint wrapper
// (runBreakdown / restoreBreakdown).
//
// Attribution of a hit to a skill (attribution()): the hit's own skill id when it is one of the hero's equipped
// skills (basic attack, hotbar, signature) or a named proc (Fate boon `boon_*`, legendary perk `lg_*`); otherwise the
// skill of the innermost attribution context: a cast in progress, or the player hazard / projectile being stepped,
// which carries the skill of the context it was created in (tallyBegin / tallyEnd tag new hazards and projectiles).
// New class kits, summons, enemies and bosses need no registration: sources come from the existing hit fields.

/** Seconds of damage taken a death recap looks back over. */
export const RECAP_WINDOW_SEC = 5;
const RECAP_TICKS = RECAP_WINDOW_SEC * TICK_RATE;
/** recent hits kept per hero (coalesced), recap timeline length, recaps kept per run */
const RECENT_MAX = 32;
const RECAP_HITS = 8;
const MAX_RECAPS = 16;
/** rows kept per hero in the breakdown (the rest fold into one "other" row, id '') */
const MAX_SKILL_ROWS = 16;
const MAX_SOURCE_ROWS = 12;
const MAX_ATTACKS = 4;
/** Hero statuses a recap lists as debuffs (enemy afflictions, afflictions.ts). */
export const RECAP_DEBUFFS: ReadonlySet<string> = new Set(['chained', 'chill', 'frozen', 'poisoned', 'blinded', 'rooted', 'silenced', 'slowed', 'vulnerable', 'hexed', 'cursed', 'marked', 'burning', 'bleeding', 'stunned', 'weakened']);

export type TakenKind = 'foe' | 'boss' | 'hazard' | 'curse';

/** One hit of a death recap's timeline. t = seconds before the fall (<= 0); n = merged hits (absent = 1). */
export interface RecapHit { t: number; src: string; atk: string; amt: string; dt: DamageType; n?: number }
/** A fall (downed or slain): the killing blow, the hits of the window before it, debuffs, health before the blow. */
export interface RecapEntry {
  slot: number; round: number; tick: number;
  /** slain (true) or downed (false); a downed hero who bleeds out is marked final later */
  final: boolean;
  src: string; atk: string; amt: string; dt: DamageType;
  /** health fraction before the killing blow */
  hp: number;
  /** damage taken in the window (killing blow included) */
  total: string;
  hits: RecapHit[];
  debuffs: string[];
}
export interface BreakdownSkill { id: string; dmg: string; kills: string; hits: number }
export interface BreakdownSource { src: string; kind: TakenKind; dmg: string; hits: number; atk: { n: string; dmg: string }[] }
export interface BreakdownHero {
  slot: number;
  /** damage dealt (sum of the skill rows) and taken (sum of the source rows) */
  dealt: string; taken: string;
  skills: BreakdownSkill[];
  sources: BreakdownSource[];
  healDone: string; healRecv: string;
  dodges: number; downs: number; deaths: number;
  /** revives given to allies, times revived (self revives included) */
  revives: number; revived: number;
}
/** The JSON-safe breakdown (Big values as compact text): RESULTS summary, SQLite runs.breakdown_json, checkpoints. */
export interface RunBreakdown { v: 1; heroes: BreakdownHero[]; recaps: RecapEntry[] }

interface SkillTally { dmg: Big; kills: Big; hits: number }
interface TakenTally { kind: TakenKind; dmg: Big; hits: number; atk: Map<string, Big> }
interface RecentHit { tick: number; src: string; atk: string; amt: Big; dt: DamageType; n: number; dot: boolean }
interface HeroTally {
  skills: Map<string, SkillTally>;
  taken: Map<string, TakenTally>;
  healDone: Big; healRecv: Big;
  dodges: number; downs: number; deaths: number; revives: number; revived: number;
  recent: RecentHit[];
}
interface Ctx { slot: number; skill: string; mark: number }
interface Tally {
  heroes: HeroTally[];
  recaps: RecapEntry[];
  ctx: Ctx[];
  /** skill that created a player hazard / projectile */
  tags: WeakMap<object, string>;
  /** per damage-over-time entry (EnemyState.dots item): the skills that fed it, by damage per second */
  dots: WeakMap<object, Map<string, Big>>;
}

const TALLIES = new WeakMap<SimState, Tally>();
const ZERO = Big.ZERO;
const BOSS_NAMES = new Set(BOSSES.map((b) => b.name));

function hero(): HeroTally {
  return { skills: new Map(), taken: new Map(), healDone: ZERO, healRecv: ZERO, dodges: 0, downs: 0, deaths: 0, revives: 0, revived: 0, recent: [] };
}

function tallyOf(state: SimState): Tally {
  let t = TALLIES.get(state);
  if (!t) TALLIES.set(state, (t = { heroes: [], recaps: [], ctx: [], tags: new WeakMap(), dots: new WeakMap() }));
  return t;
}

function heroOf(t: Tally, slot: number): HeroTally {
  return t.heroes[slot] ?? (t.heroes[slot] = hero());
}

// ---------------------------------------------------------------- attribution

function equipped(p: PlayerState, id: string): boolean {
  if (id === CLASS_BY_ID[p.classId]?.basicSkill) return true;
  for (const s of p.skills) if (s.skillId === id) return true;
  return false;
}

/** The skill a player hit by `slot` with skill id `skillId` counts for (see the module comment). */
export function attribution(state: SimState, slot: number, skillId: string): string {
  const p = state.players[slot];
  if (!p) return skillId;
  if (skillId && (skillId.startsWith('boon_') || skillId.startsWith('lg_') || equipped(p, skillId))) return skillId;
  const t = TALLIES.get(state);
  const c = t?.ctx[t.ctx.length - 1];
  if (c && c.slot === slot && c.skill) return c.skill;
  return skillId;
}

/** Open an attribution context (a cast, a basic attack, a hero's passive tick). Returns the token for tallyEnd. */
export function tallyBegin(state: SimState, slot: number, skill: string): number {
  const t = tallyOf(state);
  const c = t.ctx[t.ctx.length - 1];
  // a context inside another one of the same hero inherits its skill when it has none of its own
  t.ctx.push({ slot, skill: skill || (c && c.slot === slot ? c.skill : ''), mark: state.nextId });
  return t.ctx.length - 1;
}

/** Close a context: player hazards / projectiles of its hero created inside it remember its skill. */
export function tallyEnd(state: SimState, token: number) {
  const t = TALLIES.get(state);
  if (!t || token < 0 || token >= t.ctx.length) return;
  const c = t.ctx[token];
  t.ctx.length = token;
  if (!c.skill || state.nextId <= c.mark) return;
  const tag = (o: { id: number; owner: string; ownerId: number }) => {
    if (o.id >= c.mark && o.owner === 'player' && o.ownerId === c.slot && !t.tags.has(o)) t.tags.set(o, c.skill);
  };
  for (const h of state.hazards) tag(h);
  for (const pr of state.projectiles) tag(pr);
}

/** Context for stepping a player hazard or projectile (its creating skill). */
export function tallyEnter(state: SimState, o: Hazard | Projectile): number {
  if (o.owner !== 'player') return -1;
  return tallyBegin(state, o.ownerId, TALLIES.get(state)?.tags.get(o) ?? '');
}

// ---------------------------------------------------------------- damage dealt

function addSkill(h: HeroTally, id: string, dmg: Big, kills: Big, hit: boolean) {
  const s = h.skills.get(id);
  if (!s) { h.skills.set(id, { dmg, kills, hits: hit ? 1 : 0 }); return; }
  if (!dmg.isZero()) s.dmg = s.dmg.add(dmg);
  if (!kills.isZero()) s.kills = s.kills.add(kills);
  if (hit) s.hits++;
}

/** A resolved player hit on an enemy (combat.ts hitEnemy). Returns the skill it was attributed to. */
export function tallyEnemyHit(state: SimState, slot: number, skillId: string, dealt: Big, kills: Big): string {
  const id = attribution(state, slot, skillId);
  if (!state.players[slot] || (dealt.isZero() && kills.isZero())) return id;
  addSkill(heroOf(tallyOf(state), slot), id, dealt, kills, !dealt.isZero());
  return id;
}

/** A damage-over-time entry gained `perSec` from `skill` (combat.ts addDot). */
export function tallyDot(state: SimState, entry: object, slot: number, type: DamageType, skill: string | undefined, perSec: Big) {
  if (!state.players[slot]) return;
  const id = skill || attribution(state, slot, '') || `dot:${type}`;
  const t = tallyOf(state);
  let m = t.dots.get(entry);
  if (!m) t.dots.set(entry, (m = new Map()));
  const cur = m.get(id);
  m.set(id, cur ? cur.add(perSec) : perSec);
}

/** One damage-over-time tick on an enemy (combat.ts tickDots): `dealt` split over the entries by rate, then over the
 *  skills that fed each entry; rate nobody claimed (pre-restore entries, raw reactions) counts as "dot:<type>". */
export function tallyDotTick(state: SimState, dots: readonly { src: number; type: DamageType; perSec: Big }[], total: Big, dealt: Big, kills: Big) {
  if ((dealt.isZero() && kills.isZero()) || total.isZero() || !dots.length) return;
  const t = tallyOf(state);
  let killer: { slot: number; id: string; rate: Big } | null = null;
  const one = dots.length === 1;
  for (const d of dots) {
    if (!state.players[d.src]) continue;
    const h = heroOf(t, d.src);
    const part = one ? dealt : dealt.mulNum(d.perSec.ratio(total));
    const notes = t.dots.get(d);
    let claimed = ZERO;
    if (notes) for (const [id, rate] of notes) {
      const r = Big.min(rate, d.perSec);
      const share = one && notes.size === 1 && r.eq(d.perSec) ? part : part.mulNum(r.ratio(d.perSec));
      addSkill(h, id, share, ZERO, false);
      claimed = claimed.add(r);
      if (!killer || r.gt(killer.rate)) killer = { slot: d.src, id, rate: r };
    }
    if (claimed.lt(d.perSec)) {
      const rest = notes ? part.mulNum(d.perSec.sub(claimed).ratio(d.perSec)) : part;
      addSkill(h, `dot:${d.type}`, rest, ZERO, false);
      if (!killer) killer = { slot: d.src, id: `dot:${d.type}`, rate: d.perSec };
    }
  }
  if (killer && !kills.isZero()) addSkill(heroOf(t, killer.slot), killer.id, ZERO, kills, false);
}

// ---------------------------------------------------------------- damage taken, healing, falls

export interface TakenInfo { attack: string; source: string; dtype: DamageType; hazard?: boolean; srcId?: number }

function takenKind(state: SimState, o: TakenInfo): TakenKind {
  if (o.srcId !== undefined) {
    for (const e of state.enemies) if (e.id === o.srcId) return e.boss ? 'boss' : 'foe';
  }
  if (BOSS_NAMES.has(o.source)) return 'boss';
  if (o.srcId !== undefined) return 'foe';
  if (o.source === o.attack) return 'curse';   // Fate banes name themselves (boons.ts curseHit)
  return o.hazard ? 'hazard' : 'foe';
}

/** Damage a hero took after mitigation and shields (combat.ts hitPlayer). */
export function tallyTaken(state: SimState, p: PlayerState, amount: Big, o: TakenInfo) {
  if (amount.isZero()) return;
  const h = heroOf(tallyOf(state), p.slot);
  const key = o.source || 'Unknown';
  let row = h.taken.get(key);
  if (!row) h.taken.set(key, (row = { kind: takenKind(state, o), dmg: ZERO, hits: 0, atk: new Map() }));
  row.dmg = row.dmg.add(amount);
  row.hits++;
  const atk = o.attack || key;
  row.atk.set(atk, (row.atk.get(atk) ?? ZERO).add(amount));
  // the recap timeline: repeats of one source's attack within a short gap merge (damage over time, rapid volleys)
  const last = h.recent[h.recent.length - 1];
  const gap = o.hazard ? TICK_RATE : TICK_RATE / 4;
  if (last && last.src === key && last.atk === atk && last.dt === o.dtype && state.tick - last.tick <= gap) {
    last.amt = last.amt.add(amount); last.n++; last.tick = state.tick;
  } else {
    h.recent.push({ tick: state.tick, src: key, atk, amt: amount, dt: o.dtype, n: 1, dot: !!o.hazard });
    if (h.recent.length > RECENT_MAX) h.recent.splice(0, h.recent.length - RECENT_MAX);
  }
}

/** Healing a hero received (combat.ts healPlayer); the healer is the current context's hero, else the recipient. */
export function tallyHeal(state: SimState, p: PlayerState, gained: Big) {
  if (gained.isZero()) return;
  const t = tallyOf(state);
  heroOf(t, p.slot).healRecv = heroOf(t, p.slot).healRecv.add(gained);
  const c = t.ctx[t.ctx.length - 1];
  const by = c && state.players[c.slot] ? c.slot : p.slot;
  heroOf(t, by).healDone = heroOf(t, by).healDone.add(gained);
}

/**
 * A hero fell (combat.ts recordRecap): downed or slain by the hit `amount` of `o`. Records the recap and returns its
 * presentation event (the live "You died to…" card).
 */
export function tallyFall(state: SimState, p: PlayerState, amount: Big, o: TakenInfo, final: boolean): SimEvent {
  const t = tallyOf(state);
  const h = heroOf(t, p.slot);
  if (final) h.deaths++; else h.downs++;
  const from = state.tick - RECAP_TICKS;
  const window = h.recent.filter((x) => x.tick >= from);
  let total = ZERO;
  for (const x of window) total = total.add(x.amt);
  if (window.length === 0) total = amount;   // a hit that never landed (a self revive interrupted) still names the killer
  const hits: RecapHit[] = window.slice(-RECAP_HITS).map((x) => {
    const r: RecapHit = { t: Math.round(((x.tick - state.tick) / TICK_RATE) * 10) / 10, src: x.src, atk: x.atk, amt: x.amt.toCompact(), dt: x.dt };
    if (x.n > 1) r.n = x.n;
    return r;
  });
  const debuffs: string[] = [];
  for (const b of p.buffs) if (b.until > state.tick && RECAP_DEBUFFS.has(b.id) && !debuffs.includes(b.id)) debuffs.push(b.id);
  const recap: RecapEntry = {
    slot: p.slot, round: state.round, tick: state.tick, final,
    src: o.source || 'Unknown', atk: o.attack || o.source || 'Unknown', amt: amount.toCompact(), dt: o.dtype,
    hp: Math.round(Math.max(0, Math.min(1, p.lastHitHpFrac)) * 1000) / 1000,
    total: total.toCompact(), hits, debuffs,
  };
  t.recaps.push(recap);
  if (t.recaps.length > MAX_RECAPS) t.recaps.splice(0, t.recaps.length - MAX_RECAPS);
  h.recent = [];
  return { t: 'recap', slot: p.slot, recap };
}

/** A downed hero bled out (players.ts): the fall becomes a death. Returns the updated recap's event, if any. */
export function tallyBleedOut(state: SimState, p: PlayerState): SimEvent | null {
  const t = tallyOf(state);
  heroOf(t, p.slot).deaths++;
  for (let i = t.recaps.length - 1; i >= 0; i--) {
    const r = t.recaps[i];
    if (r.slot !== p.slot) continue;
    if (r.final) return null;
    r.final = true;
    return { t: 'recap', slot: p.slot, recap: r };
  }
  return null;
}

/** A hero stood back up (players.ts revivePlayer); `by` = the ally who channelled it (null: self revive, respawn). */
export function tallyRevive(state: SimState, p: PlayerState, by: number | null) {
  const t = tallyOf(state);
  heroOf(t, p.slot).revived++;
  if (by !== null && state.players[by]) heroOf(t, by).revives++;
}

// dodges come from the dodge hook (combat dashes only; the door vote's dashes are not combat)
registerGlobalHooks({ onDodge(state, _ev, p) { heroOf(tallyOf(state), p.slot).dodges++; } });

// ---------------------------------------------------------------- the breakdown

const sortRows = <T extends { dmg: Big; key: string }>(rows: T[]) => rows.sort((a, b) => b.dmg.cmp(a.dmg) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** The run's breakdown so far (null when nothing was recorded for this state). */
export function runBreakdown(state: SimState): RunBreakdown | null {
  const t = TALLIES.get(state);
  if (!t) return null;
  const heroes: BreakdownHero[] = state.players.map((p) => {
    const h = t.heroes[p.slot] ?? hero();
    const skills = sortRows([...h.skills].map(([key, s]) => ({ key, ...s })));
    let dealt = ZERO;
    for (const s of skills) dealt = dealt.add(s.dmg);
    const keepS = skills.slice(0, MAX_SKILL_ROWS);
    const restS = skills.slice(MAX_SKILL_ROWS);
    if (restS.length) keepS.push(restS.reduce((a, s) => ({ key: '', dmg: a.dmg.add(s.dmg), kills: a.kills.add(s.kills), hits: a.hits + s.hits }), { key: '', dmg: ZERO, kills: ZERO, hits: 0 }));
    const sources = sortRows([...h.taken].map(([key, s]) => ({ key, ...s })));
    let taken = ZERO;
    for (const s of sources) taken = taken.add(s.dmg);
    const keepT = sources.slice(0, MAX_SOURCE_ROWS);
    const restT = sources.slice(MAX_SOURCE_ROWS);
    if (restT.length) keepT.push(restT.reduce((a, s) => ({ ...a, dmg: a.dmg.add(s.dmg), hits: a.hits + s.hits }), { key: '', kind: 'foe' as TakenKind, dmg: ZERO, hits: 0, atk: new Map<string, Big>() }));
    return {
      slot: p.slot, dealt: dealt.toCompact(), taken: taken.toCompact(),
      skills: keepS.map((s) => ({ id: s.key, dmg: s.dmg.toCompact(), kills: s.kills.toCompact(), hits: s.hits })),
      sources: keepT.map((s) => ({
        src: s.key, kind: s.kind, dmg: s.dmg.toCompact(), hits: s.hits,
        atk: sortRows([...s.atk].map(([key, dmg]) => ({ key, dmg }))).slice(0, MAX_ATTACKS).map((a) => ({ n: a.key, dmg: a.dmg.toCompact() })),
      })),
      healDone: h.healDone.toCompact(), healRecv: h.healRecv.toCompact(),
      dodges: h.dodges, downs: h.downs, deaths: h.deaths, revives: h.revives, revived: h.revived,
    };
  });
  return { v: 1, heroes, recaps: t.recaps.map((r) => ({ ...r, hits: r.hits.slice(), debuffs: r.debuffs.slice() })) };
}

const big = (s: unknown): Big => {
  try { return typeof s === 'string' && s ? Big.fromCompact(s) : ZERO; } catch { return ZERO; }
};
const int = (n: unknown): number => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);

/** Continue a breakdown restored from a checkpoint wrapper (the authority's resume path). Malformed input is ignored. */
export function restoreBreakdown(state: SimState, b: unknown) {
  const r = b as Partial<RunBreakdown> | null;
  if (!r || r.v !== 1 || !Array.isArray(r.heroes)) return;
  const t = tallyOf(state);
  t.heroes = [];
  for (const x of r.heroes) {
    if (!x || typeof x.slot !== 'number' || !state.players[x.slot]) continue;
    const h = heroOf(t, x.slot);
    for (const s of Array.isArray(x.skills) ? x.skills : []) if (s && typeof s.id === 'string') h.skills.set(s.id, { dmg: big(s.dmg), kills: big(s.kills), hits: int(s.hits) });
    for (const s of Array.isArray(x.sources) ? x.sources : []) {
      if (!s || typeof s.src !== 'string') continue;
      const kind: TakenKind = (['foe', 'boss', 'hazard', 'curse'] as const).includes(s.kind) ? s.kind : 'foe';
      h.taken.set(s.src, { kind, dmg: big(s.dmg), hits: int(s.hits), atk: new Map((Array.isArray(s.atk) ? s.atk : []).filter((a) => a && typeof a.n === 'string').map((a) => [a.n, big(a.dmg)])) });
    }
    h.healDone = big(x.healDone); h.healRecv = big(x.healRecv);
    h.dodges = int(x.dodges); h.downs = int(x.downs); h.deaths = int(x.deaths); h.revives = int(x.revives); h.revived = int(x.revived);
  }
  t.recaps = (Array.isArray(r.recaps) ? r.recaps : []).filter((x) => x && typeof x.slot === 'number').slice(-MAX_RECAPS);
}

/** Forget a state's breakdown (tests, tools). */
export function resetBreakdown(state: SimState) {
  TALLIES.delete(state);
}
