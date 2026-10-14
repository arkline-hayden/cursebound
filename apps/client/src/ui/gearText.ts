import { CLASS_BY_ID, GEAR_SLOTS, LEGENDARY_BY_ID, SKILL_BY_ID, STAT_BY_ID, type GearSlot, type LegendaryDef } from '@cursebound/content';
import type { Snapshot } from '@cursebound/simulation';

// Shared text helpers for the legendary gear UI (GearPanel, GearBar, GearLayer, Results).

export function statLabel(stat: string): string {
  const s = STAT_BY_ID[stat];
  if (s) return s.name;
  const m = /^skill\.([a-z0-9_]+)\.(damage|cost|cooldown|radius)$/.exec(stat);
  if (m) return `${SKILL_BY_ID[m[1]]?.name ?? m[1]} ${m[2]}`;
  return stat;
}

export function modifierLines(def: LegendaryDef): string[] {
  return def.modifiers.map((m) => `${statLabel(m.stat)} ×${m.factorPerRank}`);
}

export function classTag(def: LegendaryDef): string | null {
  return def.classId ? `${CLASS_BY_ID[def.classId]?.name ?? def.classId} only` : null;
}

/** A player's equipped items from a snapshot entry (gr = ids in GEAR_SLOTS order). */
export function gearFromSnap(p: Snapshot['players'][number] | undefined): Partial<Record<GearSlot, LegendaryDef>> {
  const out: Partial<Record<GearSlot, LegendaryDef>> = {};
  const gr = p?.gr;
  if (!gr) return out;
  GEAR_SLOTS.forEach((slot, i) => { const def = gr[i] ? LEGENDARY_BY_ID[gr[i]] : undefined; if (def) out[slot] = def; });
  return out;
}

export const ORANGE = '#ff8a1e';
