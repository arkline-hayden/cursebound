/** Data-directory layout, identifier validation and the shared error type for persistence. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<repo>/data` unless `CURSEBOUND_DATA_DIR` is set. This file lives at apps/server/src/persistence/. */
export function defaultDataDir(): string {
  const fromEnv = process.env.CURSEBOUND_DATA_DIR;
  if (fromEnv && fromEnv.trim() !== '') return path.resolve(fromEnv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..', 'data');
}

export interface DataPaths {
  dataDir: string;
  dbFile: string;
  replaysDir: string;
  backupsDir: string;
  logsDir: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const root = path.resolve(dataDir);
  return {
    dataDir: root,
    dbFile: path.join(root, 'cursebound.sqlite'),
    replaysDir: path.join(root, 'replays'),
    backupsDir: path.join(root, 'backups'),
    logsDir: path.join(root, 'logs'),
  };
}

export type StoreErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CONSTRAINT'
  | 'RUN_FINALIZED'
  | 'CHECKSUM_MISMATCH'
  | 'SCHEMA_TOO_NEW'
  | 'STORE_CLOSED'
  | 'WORKER_FAILED'
  | 'INTERNAL';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/** Server-issued identifiers (run, offer, profile). Never used raw from a client as a path. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const CANONICAL_SCORE_RE = /^(0|[1-9][0-9]*)$/;
export const CONTENT_HASH_RE = /^[A-Za-z0-9:_.-]{1,128}$/;

export function assertId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new StoreError('INVALID_INPUT', `${what} must match ${ID_RE.source}`);
  }
  return value;
}

export function assertScore(value: unknown, what = 'scoreText'): string {
  if (typeof value !== 'string' || !CANONICAL_SCORE_RE.test(value)) {
    throw new StoreError('INVALID_INPUT', `${what} must be a canonical decimal digit string`);
  }
  return value;
}

export function assertInt(value: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new StoreError('INVALID_INPUT', `${what} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

/** Bounded single-line text without control characters (board keys, modes, trust tiers, actors). */
export function assertText(value: unknown, what: string, maxLen = 256, minLen = 1): string {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.length < minLen || value.length > maxLen || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new StoreError('INVALID_INPUT', `${what} must be ${minLen}..${maxLen} chars without control characters`);
  }
  return value;
}

/** Arbitrary JSON text payload with a size bound; must parse. */
export function assertJsonText(value: unknown, what: string, maxLen = 1_048_576): string {
  if (typeof value !== 'string' || value.length > maxLen) {
    throw new StoreError('INVALID_INPUT', `${what} must be a JSON string of at most ${maxLen} chars`);
  }
  try {
    JSON.parse(value);
  } catch {
    throw new StoreError('INVALID_INPUT', `${what} is not valid JSON`);
  }
  return value;
}

/**
 * Player-written text (build names, notes, mottos): strip control/bidi-format chars, collapse runs of spaces,
 * trim, cap at `max` code points. `multiline` keeps single newlines. May return ''.
 */
export function sanitizeFreeText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== 'string') throw new StoreError('INVALID_INPUT', 'text must be a string');
  let s = raw.normalize('NFC').replace(/\r\n?/g, '\n');
  s = multiline
    ? s.replace(/[\p{Cc}​-‏‪-‮⁠-⁩﻿]/gu, (c) => (c === '\n' ? '\n' : ' ')).replace(/[^\S\n]+/gu, ' ').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\p{Cc}​-‏‪-‮⁠-⁩﻿]/gu, ' ').replace(/\s+/gu, ' ');
  return Array.from(s.trim()).slice(0, max).join('').trim();
}

/** Trim, strip control/bidi-format chars, collapse whitespace, max 24 code points. */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') throw new StoreError('INVALID_INPUT', 'displayName must be a string');
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\p{Cc}​-‏‪-‮⁠-⁩﻿]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const limited = Array.from(cleaned).slice(0, 24).join('').trim();
  if (limited.length === 0) throw new StoreError('INVALID_INPUT', 'displayName is empty after sanitizing');
  return limited;
}
