import { Big } from '@cursebound/numeric';
import { canonicalJson, sha256Hex } from '@cursebound/content';
import type { SimState } from './types';

// Checkpoint serialization (PRD §20.3). Big values are tagged {$b: compact}; key insertion order is preserved
// so a restored state iterates identically to the live one. Hashes use canonical (sorted) JSON.

export const STATE_SCHEMA = 1;

export function serializeState(state: SimState): string {
  return JSON.stringify(state, function (this: Record<string, unknown>, key: string, value: unknown) {
    const orig = this[key];
    if (orig instanceof Big) return { $b: orig.toCompact() };
    return value;
  });
}

export function deserializeState(json: string): SimState {
  const s = JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $b?: unknown }).$b === 'string' && Object.keys(v).length === 1) {
      return Big.fromCompact((v as { $b: string }).$b);
    }
    return v;
  }) as SimState;
  if (s.schema !== STATE_SCHEMA) throw new Error(`unsupported state schema ${s.schema}`);
  return s;
}

export function stateHash(state: SimState): string {
  return sha256Hex(canonicalJson(state));
}

export function checksum(blob: string): string {
  return sha256Hex(blob);
}
