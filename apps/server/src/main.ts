import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { CONTENT_VERSION, RULES_VERSION, contentHash, validateContent } from '@cursebound/content';
import { BUILD_ID } from '@cursebound/protocol';
import { allowListeningPort, loadConfig } from './config';
import { createApi } from './http';
import { createLogger } from './persistence/logger';
import { openStore } from './persistence/store';
import { RoomManager } from './rooms';
import { BountyService } from './bounty';
import { hostAllowed, originAllowed } from './security';

// CURSEBOUND authoritative backend: HTTP API + WebSocket rooms + isolated SQLite writer (PRD §17.2).

export async function startServer(env = process.env) {
  const cfg = loadConfig(env);
  const problems = validateContent();
  if (problems.length) throw new Error('content validation failed:\n' + problems.join('\n'));
  const log = createLogger({ dataDir: cfg.dataDir, build: BUILD_ID, echo: env.CURSEBOUND_LOG_ECHO === '1' });
  const store = await openStore({ dataDir: cfg.dataDir, logger: log } as Parameters<typeof openStore>[0]);
  await store.ensureContentVersion({ hash: contentHash(), rulesVersion: RULES_VERSION, manifestPath: `packages/content@${CONTENT_VERSION}` });
  const rooms = new RoomManager(cfg, store, log);
  const bounties = new BountyService(store, log);   // the local daily bounty: polled job + lazy check on read
  const api = createApi(cfg, store, rooms, log, bounties);
  const server = http.createServer((req, res) => { void api(req, res); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/rooms' || !hostAllowed(cfg, req) || !originAllowed(cfg, req, true)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => rooms.accept(ws));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  // port 0 = a random free port (desktop app); the desktop client is served by, and talks to, this same origin
  if (cfg.port === 0 || cfg.staticDir) allowListeningPort(cfg, (server.address() as AddressInfo).port);
  rooms.start();
  bounties.start();
  log.info('server_started', { port: cfg.port, lan: cfg.lan, static: !!cfg.staticDir });
  const shutdown = async () => {
    log.info('server_stopping', {});
    bounties.stop();
    await rooms.shutdown();
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
    await store.close();
    await log.close();
  };
  return { cfg, server, store, rooms, bounties, shutdown };
}

/** Electron's utilityProcess exposes `process.parentPort` (a MessagePort-like emitter) instead of stdin. */
interface ParentPort { on(ev: 'message', fn: (e: { data: unknown }) => void): void }

/** Run as a process: start, announce the port, and shut down cleanly on request. */
export function runMain(env = process.env): void {
  startServer(env).then(({ cfg, shutdown }) => {
    console.log(`[cursebound] authority listening on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port} (LAN ${cfg.lan ? 'ON' : 'off'})`);
    // machine-readable port report for the desktop shell (one JSON line on stdout)
    if (env.CURSEBOUND_PORT === '0' || cfg.staticDir) console.log(JSON.stringify({ event: 'listening', port: cfg.port }));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      console.log('[cursebound] flushing pending transactions and shutting down...');
      shutdown().then(() => process.exit(0), () => process.exit(1));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
    if (parentPort) {
      // desktop app: the same `shutdown` request arrives as a utilityProcess message (it has no stdin)
      parentPort.on('message', (e) => { if (e.data === 'shutdown') stop(); });
    } else if (!process.stdin.isTTY) {
      // the start script requests a clean shutdown over stdin (portable on Windows, where signals are abrupt)
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d: string) => { if (d.includes('shutdown')) stop(); });
    }
    if (process.platform === 'win32') process.on('SIGBREAK', stop);
  }).catch((err) => {
    if ((err as { code?: string }).code === 'EADDRINUSE') {
      console.error(`[cursebound] port is already in use. Another CURSEBOUND server may be running — reuse it or stop it first.`);
    } else console.error('[cursebound] failed to start:', err);
    process.exit(1);
  });
}

const isMain = process.argv[1] && /main\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) runMain();
