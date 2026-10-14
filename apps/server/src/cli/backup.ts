/**
 * `npm run db:backup -- [dest]`
 *
 * Consistent online backup of data/cursebound.sqlite using SQLite's backup API (falls back to
 * VACUUM INTO). Safe while the server is running: it reads through a separate connection, so WAL
 * content is included, and it never copies the raw database file. It does NOT run migrations or
 * replay garbage collection (those belong to the server's own writer).
 *
 * Default destination: data/backups/manual-<timestamp>.sqlite. A relative [dest] resolves against cwd.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileTimestamp, readSchemaVersion } from '../persistence/migrate';
import { dataPaths, defaultDataDir } from '../persistence/paths';
import { backupDatabase, loadSqlite } from '../persistence/sqlite';

async function main(): Promise<number> {
  const paths = dataPaths(defaultDataDir());
  if (!existsSync(paths.dbFile)) {
    console.error(`db:backup: no database at ${paths.dbFile}`);
    return 1;
  }
  const arg = process.argv[2];
  const dest = arg ? path.resolve(arg) : path.join(paths.backupsDir, `manual-${fileTimestamp()}.sqlite`);
  if (existsSync(dest)) {
    console.error(`db:backup: destination already exists: ${dest}`);
    return 1;
  }
  const lower = dest.toLowerCase();
  const live = paths.dbFile.toLowerCase();
  if (lower === live || lower === `${live}-wal` || lower === `${live}-shm`) {
    console.error('db:backup: refusing to overwrite the live database');
    return 1;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const sqlite = await loadSqlite();
  const db = new sqlite.DatabaseSync(paths.dbFile);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const version = readSchemaVersion(db);
    await backupDatabase(sqlite, db, dest);
    console.log(JSON.stringify({ ok: true, path: dest, bytes: statSync(dest).size, schemaVersion: version }));
    return 0;
  } finally {
    db.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`db:backup failed: ${(err as Error).message}`);
    process.exitCode = 1;
  },
);
