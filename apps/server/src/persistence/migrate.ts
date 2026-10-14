/** Migration runner: monotonic schema_meta version, automatic pre-migration backup, one transaction per step. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Migration } from './migrations';
import { StoreError } from './paths';
import { backupDatabase, type DatabaseSync, type SqliteModule } from './sqlite';

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
  backupPath: string | null;
}

export function fileTimestamp(ms = Date.now()): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace('.', '');
}

export function readSchemaVersion(db: DatabaseSync): number {
  const t = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
  if (!t) return 0;
  const row = db.prepare('SELECT max(version) AS v FROM schema_meta').get() as { v: number | null } | undefined;
  return row && typeof row.v === 'number' ? row.v : 0;
}

function hasUserTables(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .get() as { c: number };
  return row.c > 0;
}

export function applyPragmas(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA synchronous=FULL');
}

export async function runMigrations(
  sqlite: SqliteModule,
  db: DatabaseSync,
  migrations: readonly Migration[],
  backupsDir: string,
): Promise<MigrationResult> {
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.version <= migrations[i - 1]!.version) throw new Error('migrations must be strictly increasing');
  }
  const latest = migrations.length ? migrations[migrations.length - 1]!.version : 0;
  const from = readSchemaVersion(db);
  if (from > latest) {
    throw new StoreError('SCHEMA_TOO_NEW', `database schema v${from} is newer than this build (v${latest}); refusing to open`);
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { fromVersion: from, toVersion: from, applied: [], backupPath: null };

  let backupPath: string | null = null;
  if (hasUserTables(db)) {
    mkdirSync(backupsDir, { recursive: true });
    backupPath = path.join(backupsDir, `pre-migration-v${from}-to-v${latest}-${fileTimestamp()}.sqlite`);
    await backupDatabase(sqlite, db, backupPath);
  }

  const applied: number[] = [];
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.exec('CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL)');
      db.exec('DELETE FROM schema_meta');
      db.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration v${m.version} (${m.name}) failed: ${(err as Error).message}`);
    }
    applied.push(m.version);
  }
  return { fromVersion: from, toVersion: latest, applied, backupPath };
}
