# CURSEBOUND local operations: persistence

This covers the local SQLite store (REQ DATA01, PRD §20), backups, restore, migration rollback,
retention (PRD §23.3) and logs (REQ TEL01). Implementation: `apps/server/src/persistence/`.

## Data directory

The default is `<repo>/data`. Set the `CURSEBOUND_DATA_DIR` environment variable to use another
directory; the server and both CLIs read it.

| Path | Contents |
| --- | --- |
| `data/cursebound.sqlite` (+ `-wal`, `-shm`) | The database. It runs in WAL mode, so the `-wal` and `-shm` files belong to it. |
| `data/replays/<runId>/<chunkNo>.json.gz` | Gzipped replay chunks. The `replay_chunks` table stores each file's sha256 checksum. |
| `data/backups/` | Pre-migration, pre-restore and manual backups. |
| `data/logs/cursebound-YYYYMMDD.log` | Structured JSON-lines logs. The day is in UTC. |

Never copy only `cursebound.sqlite` while the server is running. The WAL can hold committed data
that has not reached the main file yet. Use `npm run db:backup`, which goes through the SQLite
backup API (or `VACUUM INTO` as a fallback), or stop the server first.

## Runtime model

- One dedicated `worker_threads` worker owns the only SQLite connection (the "isolated writer").
  The room authority calls the async `Store` facade. Requests have IDs and run strictly FIFO.
  Queue depth and queue age are tracked (`store.health()`, `store.queueStats()`).
- Pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL`.
  A `Store` promise resolves only after the worker's `COMMIT` returns. Durability comes from the
  `synchronous=FULL` commit, not from the queue.
- A Fate commit is one transaction. It covers the hash-chained event, the `fate_commits` row, the
  run progress update and the checkpoint. A retry with the same offer ID returns the stored commit
  (`existing: true`) and writes nothing.
- Each replay chunk is written in this order: `.tmp` file, then fsync, then a re-read to verify the
  checksum, then an atomic rename, then the database row. On every open, the store deletes leftover
  `*.tmp` files and any chunk file that no database row references.

## Backup

```sh
npm run db:backup                    # -> data/backups/manual-<timestamp>.sqlite
npm run db:backup -- D:/safe/cb.sqlite
```

You can run this while the server is running. It uses a separate read connection, prints JSON with
the path, size and schema version, and refuses to overwrite an existing file. Replay files are not
part of the database backup. To keep replays too, copy `data/replays/` as well. That is safe at
any time, because chunk files never change after they are published.

## Restore

1. Stop the server. The restore refuses to run while port 2567 is in use. Set `CURSEBOUND_PORT` if
   the server uses another port.
2. Run:
   ```sh
   npm run db:restore -- data/backups/<file>.sqlite
   ```
3. The restore then does the following:
   - It checks the source with `PRAGMA integrity_check` and confirms its schema version is not newer
     than this build.
   - It saves the current database to `data/backups/pre-restore-<timestamp>.sqlite`. If the
     current DB is unreadable, it copies the raw `db`/`-wal`/`-shm` files as a set into
     `pre-restore-<timestamp>-raw/` instead.
   - It removes the current `cursebound.sqlite`, `-wal` and `-shm`, then writes a fresh copy of
     the source with the backup API.
4. Start the server. If the restored file has an older schema version, the normal migrations run
   on open. They take another pre-migration backup first.

Replay chunk files that the restored DB does not reference are deleted on the next open. To keep
them, copy `data/replays/` away before restoring.

## Migrations and rollback

- `apps/server/src/persistence/migrations.ts` holds an ordered list of
  `{version, name, sql}` entries. The current version is stored in `schema_meta(version)`. Only
  ever add new entries; never edit a migration that has shipped.
- On open, if migrations are pending and the database is not empty, the store first writes
  `data/backups/pre-migration-v<from>-to-v<to>-<timestamp>.sqlite` with the backup API. It then
  applies each migration in its own transaction. If a migration fails, its transaction rolls back
  and the server does not start.
- If the database schema is newer than the running build, the store refuses to open it
  (`SCHEMA_TOO_NEW`). This protects against accidentally running an older build.

**To roll back a migration:**

1. Stop the server.
2. Deploy or check out the previous build, the one whose latest migration matches `<from>`.
3. Run `npm run db:restore -- data/backups/pre-migration-v<from>-to-v<to>-<timestamp>.sqlite`.
4. Start the server.

Anything written after the migration is lost by this rollback. The database you replaced is kept
as `pre-restore-<timestamp>.sqlite` if you need to recover rows from it by hand.

## Retention

- **Replays:** `store.enforceRetention({ replayBytes })` caps replays at 1 GiB by default. When the
  total is over the cap, it evicts replay chunks of the oldest runs first. It only evicts runs that
  are finalized, aborted or invalidated. Runs marked favorite, active runs and `pending_storage`
  runs are never evicted. Eviction deletes the database rows and then the run's replay directory.
  The run, its board entry, events and checkpoints are kept.
- **Checkpoints:** kept until the user deletes the run. They are never evicted automatically.
- **Logs:** rolling total cap of 100 MB. The oldest `cursebound-*.log` files are deleted first, and
  the active file is never deleted. A day's file rolls to `-1`, `-2`, … once it exceeds the
  per-file cap (10% of the total cap by default).
- **Favorites:** a user must confirm before a favorite record is deleted. Automatic eviction never
  touches favorites.

## Logs

The logger is `createLogger({ dataDir, build })` from `apps/server/src/persistence/logger.ts`.
Each line contains `ts, level, build, runId?, event, phase?` plus bounded fields: strings are cut
at 512 characters, objects at 32 keys, arrays at 20 items, and nesting at depth 3.

The logger also protects sensitive data:

- It replaces the value of any key matching token, seatToken, secret, password, authorization,
  cookie or api-key with `[redacted]`.
- It drops IP-address fields entirely.
- It replaces IP literals inside strings with `[ip]`.

Logs stay on the local machine. Nothing is exported unless the user opts in.

## Health

`store.health()` returns `{ ok, schemaVersion, walBytes, queueDepth, lastQueueAgeMs }`.
A `walBytes` value that keeps growing means checkpoints are falling behind. SQLite
auto-checkpoints, and a graceful `close()` runs `wal_checkpoint(TRUNCATE)`. A large `queueDepth`
or `lastQueueAgeMs` means the writer is the bottleneck. When a request waits more than 250 ms in
the queue, the logger writes a `persistence_queue_slow` warning.
