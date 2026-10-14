import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { authenticateToken } from '@cursebound/accounts';
import { loadCloudConfig, type CloudConfig } from './config';
import { createCloudApi } from './http';
import { createCloudLogger, type CloudLog } from './log';
import { migrate } from './migrations';
import { attachPresence, type PresenceHandle } from './presence';
import { connectPg, type Sql } from './sql';
import { PgAccountStore } from './store';

// Wires the cloud service together: Postgres (migrated on boot) → account store → HTTP API + presence WebSocket.
// Used by main.ts (Cloud Run), dev.ts (PGlite, no cloud) and the tests.

export interface CloudServer {
  cfg: CloudConfig;
  server: http.Server;
  port: number;
  store: PgAccountStore;
  sql: Sql;
  presence: PresenceHandle;
  log: CloudLog;
  /** stop accepting, finish in-flight requests, close presence sockets and the database */
  close(): Promise<void>;
}

export async function startCloud(opts: { env?: NodeJS.ProcessEnv; sql?: Sql; log?: CloudLog; presence?: typeof attachPresence } = {}): Promise<CloudServer> {
  const env = opts.env ?? process.env;
  const cfg = loadCloudConfig(env);
  const log = opts.log ?? createCloudLogger({ build: cfg.build, level: env.LOG_LEVEL });
  let sql = opts.sql;
  if (!sql) {
    if (!cfg.databaseUrl) throw new Error('DATABASE_URL is not set (use `npm run dev -w @cursebound/cloud` for a local PGlite database)');
    sql = await connectPg(cfg.databaseUrl, { max: Number(env.PG_POOL_MAX ?? 10) || 10 });
  }
  await migrate(sql, log);
  const store = new PgAccountStore(sql);

  // presence registers one subscriber; every friendship change on the HTTP side is forwarded to it
  const friendSubscribers = new Set<(accountId: string) => void>();
  const friendsChanged = (ids: string[]) => {
    for (const id of new Set(ids)) for (const fn of friendSubscribers) {
      try { fn(id); } catch (err) { log.warn('presence_friends_push_failed', { err: err as Error }); }
    }
  };

  let presence: PresenceHandle | null = null;
  const api = createCloudApi({ cfg, store, log, friendsChanged, connections: () => presence?.connections() ?? 0 });
  const server = http.createServer((req, res) => { void api(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 20_000;
  // longer than the front end's idle timeout so Cloud Run never reuses a connection we just closed
  server.keepAliveTimeout = 65_000;

  presence = (opts.presence ?? attachPresence)(server, {
    authenticate: async (token) => {
      const a = await authenticateToken(store, typeof token === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : null);
      return a ? { accountId: a.account.id, username: a.account.username, displayName: a.account.displayName, favoriteClass: a.account.favoriteClass } : null;
    },
    friendIds: (accountId) => store.friendProfileIds(accountId),
    onFriendsChanged: (subscribe) => { friendSubscribers.add(subscribe); },
    log,
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;
  log.info('cloud_started', { port, host: cfg.host, turn: !!(cfg.turnSecret && cfg.turnHost), corsOrigins: cfg.corsOrigins.length });

  let closing: Promise<void> | null = null;
  const close = () => (closing ??= (async () => {
    log.info('cloud_stopping', {});
    const stopped = new Promise<void>((r) => server.close(() => r()));
    server.closeIdleConnections();
    await presence!.close().catch((err) => log.warn('presence_close_failed', { err: err as Error }));
    // in-flight requests get a few seconds; Cloud Run sends SIGKILL 10 s after SIGTERM
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 7000).unref())]);
    server.closeAllConnections();
    await sql!.close();
    log.info('cloud_stopped', {});
  })());

  return { cfg, server, port, store, sql, presence, log, close };
}
