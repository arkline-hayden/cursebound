/**
 * `npm run db:restore -- <file>`
 *
 * Restores data/cursebound.sqlite from a backup file (e.g. a pre-migration backup) while the server
 * is STOPPED. Steps:
 *   1. refuse if the server port (2567, override CURSEBOUND_PORT) is in use;
 *   2. validate the source (opens read-only, PRAGMA integrity_check, schema version <= this build);
 *   3. back up the current database to data/backups/pre-restore-<timestamp>.sqlite (backup API;
 *      if the current DB cannot be opened, its db/-wal/-shm files are copied as a set — safe only
 *      because nothing has it open);
 *   4. remove the current db/-wal/-shm and write a fresh copy of the source via the backup API.
 * Replay chunk files are not touched; chunks the restored DB does not reference are garbage
 * collected the next time the server opens the store.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileTimestamp, readSchemaVersion } from '../persistence/migrate';
import { LATEST_SCHEMA_VERSION } from '../persistence/migrations';
import { dataPaths, defaultDataDir } from '../persistence/paths';
import { backupDatabase, loadSqlite } from '../persistence/sqlite';

const PORT = Number(process.env.CURSEBOUND_PORT ?? 2567);

function portAcceptsConnections(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(750, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function portBindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

async function serverRunning(port: number): Promise<boolean> {
  if (await portAcceptsConnections(port, '127.0.0.1')) return true;
  return !(await portBindable(port, '127.0.0.1'));
}

async function main(): Promise<number> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npm run db:restore -- <backup-file.sqlite>');
    return 2;
  }
  const source = path.resolve(arg);
  if (!existsSync(source) || !statSync(source).isFile()) {
    console.error(`db:restore: backup file not found: ${source}`);
    return 1;
  }
  if (await serverRunning(PORT)) {
    console.error(`db:restore: port ${PORT} is in use — stop the CURSEBOUND server before restoring.`);
    return 1;
  }
  const paths = dataPaths(defaultDataDir());
  if (path.resolve(source).toLowerCase() === paths.dbFile.toLowerCase()) {
    console.error('db:restore: source is the live database');
    return 1;
  }
  const sqlite = await loadSqlite();

  // 2. validate the source
  const src = new sqlite.DatabaseSync(source, { readOnly: true });
  try {
    const check = src.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
    const verdict = check ? String(Object.values(check)[0]) : 'no result';
    if (verdict !== 'ok') {
      console.error(`db:restore: source failed integrity_check: ${verdict}`);
      return 1;
    }
    const version = readSchemaVersion(src);
    if (version === 0) {
      console.error('db:restore: source has no schema_meta; not a CURSEBOUND database');
      return 1;
    }
    if (version > LATEST_SCHEMA_VERSION) {
      console.error(`db:restore: source schema v${version} is newer than this build (v${LATEST_SCHEMA_VERSION})`);
      return 1;
    }

    // 3. preserve the current database
    mkdirSync(paths.backupsDir, { recursive: true });
    const stamp = fileTimestamp();
    let preserved: string | null = null;
    if (existsSync(paths.dbFile)) {
      preserved = path.join(paths.backupsDir, `pre-restore-${stamp}.sqlite`);
      try {
        const cur = new sqlite.DatabaseSync(paths.dbFile);
        try {
          await backupDatabase(sqlite, cur, preserved);
        } finally {
          cur.close();
        }
      } catch (err) {
        // Current DB unreadable: copy the complete file set (db + wal + shm) — the server is stopped.
        rmSync(preserved, { force: true });
        const folder = path.join(paths.backupsDir, `pre-restore-${stamp}-raw`);
        mkdirSync(folder, { recursive: true });
        for (const suffix of ['', '-wal', '-shm']) {
          const f = paths.dbFile + suffix;
          if (existsSync(f)) copyFileSync(f, path.join(folder, path.basename(f)));
        }
        preserved = folder;
        console.warn(`db:restore: current DB could not be backed up via SQLite (${(err as Error).message}); raw file set copied`);
      }
    }

    // 4. replace
    for (const suffix of ['', '-wal', '-shm']) rmSync(paths.dbFile + suffix, { force: true });
    mkdirSync(paths.dataDir, { recursive: true });
    await backupDatabase(sqlite, src, paths.dbFile);
    const restored = new sqlite.DatabaseSync(paths.dbFile);
    try {
      restored.exec('PRAGMA journal_mode=WAL');
      const ok = restored.prepare('PRAGMA quick_check').get() as Record<string, unknown>;
      console.log(
        JSON.stringify({
          ok: String(Object.values(ok)[0]) === 'ok',
          restoredFrom: source,
          schemaVersion: readSchemaVersion(restored),
          previousDatabaseSavedTo: preserved,
        }),
      );
    } finally {
      restored.close();
    }
    return 0;
  } finally {
    src.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`db:restore failed: ${(err as Error).message}`);
    process.exitCode = 1;
  },
);
