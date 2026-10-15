import { CLASS_BY_ID, GEAR_SLOT_NAMES, SKILL_BY_ID, STAT_BY_ID, type GearSlot, type LegendaryDef } from '@cursebound/content';

// Legendary quick-compare (pure, DOM-free): a candidate piece against what is worn in its slot, as stat deltas
// (green ▲ / red ▼) and the two perks side by side. Used by the ground-loot tooltip (GearLayer) and the gear panel
// (GearPanel); unit-tested in tests/gearCompare.test.ts. Item modifiers are ×factors applied once, so the delta of a
// stat is (candidate factor / worn factor) − 1, with an absent modifier counting as ×1.

export type DeltaDir = 'up' | 'down' | 'same';

export interface CompareRow {
  stat: string;
  label: string;
  /** product of the worn piece's factors for this stat (1 when it has none) */
  cur: number;
  /** product of the candidate's factors for this stat (1 when it has none) */
  next: number;
  /** relative change: next / cur − 1 */
  delta: number;
  /** better (up), worse (down) or unchanged for the hero, after the stat's direction */
  dir: DeltaDir;
  /** "▲ +3.7%" / "▼ −8%" / "=" */
  text: string;
}

export interface GearCompare {
  slot: GearSlot;
  slotName: string;
  item: LegendaryDef;
  equipped: LegendaryDef | null;
  rows: CompareRow[];
  perk: { next: string; cur: string | null; same: boolean };
  /** the candidate is exactly what is worn */
  identical: boolean;
  /** the hero's class can wear it */
  wearable: boolean;
  note: string | null;
}

/** Stats where a smaller factor is better (shorter cooldowns, cheaper costs, less damage taken). */
export function lowerIsBetter(stat: string): boolean {
  return /\.(cooldown|cost)$|incoming|damageTaken/.test(stat);
}

export function statName(stat: string): string {
  const s = STAT_BY_ID[stat];
  if (s) { const n = s.name.replace(/^Player /, ''); return n.charAt(0).toUpperCase() + n.slice(1); }
  const m = /^skill\.([a-z0-9_]+)\.(damage|cost|cooldown|radius)$/.exec(stat);
  if (m) return `${SKILL_BY_ID[m[1]]?.name ?? m[1]} ${m[2]}`;
  return stat;
}

/** "×1.12" for a factor, "—" for none (×1). */
export function formatFactor(f: number): string {
  if (Math.abs(f - 1) < 1e-9) return '—';
  return `×${Number(f.toFixed(3))}`;
}

/** Signed percent delta with an arrow: "▲ +3.7%" (one decimal under 10%), "▼ −12%", "=" when unchanged. */
export function formatDelta(delta: number, lowerBetter = false): { text: string; dir: DeltaDir } {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) return { text: '=', dir: 'same' };
  const pct = delta * 100;
  const mag = Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1).replace(/\.0$/, '') : String(Math.round(Math.abs(pct)));
  const better = lowerBetter ? delta < 0 : delta > 0;
  return { text: `${better ? '▲' : '▼'} ${delta > 0 ? '+' : '−'}${mag}%`, dir: better ? 'up' : 'down' };
}

function factors(def: LegendaryDef | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const mod of def?.modifiers ?? []) m.set(mod.stat, (m.get(mod.stat) ?? 1) * Number(mod.factorPerRank));
  return m;
}

/** Compare a candidate legendary with the piece worn in its slot (null = empty slot) for a hero of `classId`. */
export function compareLegendary(item: LegendaryDef, equipped: LegendaryDef | null | undefined, classId?: string): GearCompare {
  const worn = equipped && equipped.slot === item.slot ? equipped : null;
  const a = factors(item), b = factors(worn);
  const stats = [...a.keys(), ...[...b.keys()].filter((k) => !a.has(k))];
  const rows: CompareRow[] = stats.map((stat) => {
    const next = a.get(stat) ?? 1, cur = b.get(stat) ?? 1;
    const delta = next / cur - 1;
    const { text, dir } = formatDelta(delta, lowerIsBetter(stat));
    return { stat, label: statName(stat), cur, next, delta, dir, text };
  });
  const wearable = !item.classId || !classId || item.classId === classId;
  const note = !wearable ? `Only a ${CLASS_BY_ID[item.classId!]?.name ?? item.classId} can wear this`
    : !worn ? 'Empty slot: walking over it equips it'
    : worn.id === item.id ? 'Already worn' : null;
  return {
    slot: item.slot, slotName: GEAR_SLOT_NAMES[item.slot], item, equipped: worn, rows,
    perk: { next: item.perk.description, cur: worn?.perk.description ?? null, same: !!worn && worn.perk.id === item.perk.id && worn.perk.magnitude === item.perk.magnitude },
    identical: !!worn && worn.id === item.id, wearable, note,
  };
}

/** One-line verdict for screen readers and the compact prompt: "+2 better, 1 worse stat". */
export function compareSummary(c: GearCompare): string {
  if (c.identical) return 'identical to what you wear';
  const up = c.rows.filter((r) => r.dir === 'up').length, down = c.rows.filter((r) => r.dir === 'down').length;
  if (!up && !down) return 'same stats, different perk';
  return [up ? `${up} better` : '', down ? `${down} worse` : ''].filter(Boolean).join(', ') + ` stat${up + down === 1 ? '' : 's'}`;
}
