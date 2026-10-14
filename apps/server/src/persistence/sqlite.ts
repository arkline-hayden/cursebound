/**
 * Loads Node's built-in `node:sqlite` module (no native npm dependency).
 *
 * `node:sqlite` emits a one-time `ExperimentalWarning` when first loaded. We filter ONLY that
 * specific warning (every other warning still flows through the normal handler) and then load
 * the module dynamically so the filter is installed before the module initialises.
 */
import { rmSync } from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

export type DatabaseSync = DatabaseSyncType;

export interface SqliteModule {
  DatabaseSync: typeof import('node:sqlite').DatabaseSync;
  /** Online backup API (Node >= 22.16). Missing in older builds; callers fall back to VACUUM INTO. */
  backup?: (sourceDb: DatabaseSyncType, destination: string, options?: { rate?: number }) => Promise<number>;
}

let filterInstalled = false;

function installSqliteWarningFilter(): void {
  if (filterInstalled) return;
  filterInstalled = true;
  const original = process.emitWarning.bind(process) as (...args: unknown[]) => void;
  const patched = (warning: unknown, ...rest: unknown[]): void => {
    const message = typeof warning === 'string' ? warning : warning instanceof Error ? warning.message : '';
    const first = rest[0];
    const type =
      typeof first === 'string'
        ? first
        : first && typeof first === 'object' && 'type' in first
          ? String((first as { type?: unknown }).type)
          : warning instanceof Error
            ? warning.name
            : '';
    if (type === 'ExperimentalWarning' && /SQLite is an experimental feature/i.test(message)) return;
    original(warning, ...rest);
  };
  process.emitWarning = patched as typeof process.emitWarning;
}

let cached: SqliteModule | null = null;

export async function loadSqlite(): Promise<SqliteModule> {
  if (cached) return cached;
  installSqliteWarningFilter();
  const mod = (await import('node:sqlite')) as unknown as SqliteModule;
  cached = { DatabaseSync: mod.DatabaseSync, backup: typeof mod.backup === 'function' ? mod.backup : undefined };
  return cached;
}

/**
 * Consistent online copy of `db` to `destPath` using the SQLite backup API, falling back to
 * `VACUUM INTO`. Both read through the connection, so committed WAL content is included —
 * never copy the raw database file while ignoring the WAL.
 */
export async function backupDatabase(sqlite: SqliteModule, db: DatabaseSyncType, destPath: string): Promise<void> {
  if (sqlite.backup) {
    try {
      await sqlite.backup(db, destPath);
      return;
    } catch {
      // fall through to VACUUM INTO (which requires the destination to not exist)
      rmSync(destPath, { force: true });
    }
  }
  db.prepare('VACUUM INTO ?').run(destPath);
}
