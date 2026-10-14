// Identifier checks and player-text sanitising for account stores. Mirrors the local persistence rules
// (apps/server/src/persistence/paths.ts) so names and notes come out the same in SQLite and Postgres.

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type AccountStoreErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export class AccountStoreError extends Error {
  constructor(readonly code: AccountStoreErrorCode, message: string) {
    super(message);
    this.name = 'AccountStoreError';
  }
}

export function assertStoreId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new AccountStoreError('INVALID_INPUT', `${what} must match ${ID_RE.source}`);
  return value;
}

const INVISIBLE = /[\p{Cc}​-‏‪-‮⁠-⁩﻿]/gu;

/**
 * Player-written text (build names, notes, mottos): strip control/bidi-format chars, collapse runs of spaces,
 * trim, cap at `max` code points. `multiline` keeps single newlines. May return ''.
 */
export function sanitizeFreeText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== 'string') throw new AccountStoreError('INVALID_INPUT', 'text must be a string');
  let s = raw.normalize('NFC').replace(/\r\n?/g, '\n');
  s = multiline
    ? s.replace(INVISIBLE, (c) => (c === '\n' ? '\n' : ' ')).replace(/[^\S\n]+/gu, ' ').replace(/\n{3,}/g, '\n\n')
    : s.replace(INVISIBLE, ' ').replace(/\s+/gu, ' ');
  return Array.from(s.trim()).slice(0, max).join('').trim();
}

/** Trim, strip control/bidi-format chars, collapse whitespace, max 24 code points. */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') throw new AccountStoreError('INVALID_INPUT', 'displayName must be a string');
  const cleaned = raw.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/gu, ' ').trim();
  const limited = Array.from(cleaned).slice(0, 24).join('').trim();
  if (limited.length === 0) throw new AccountStoreError('INVALID_INPUT', 'displayName is empty after sanitizing');
  return limited;
}

/** Bigger canonical decimal string wins (digit length first, then lexicographic). */
export function maxScore(a: string, b: string): string {
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return a >= b ? a : b;
}
