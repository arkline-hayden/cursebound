import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-first configuration (PRD §25.3, REQ SEC01). Loopback by default; LAN sharing is an explicit opt-in.

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

export interface ServerConfig {
  port: number;
  clientPort: number;
  host: string;
  lan: boolean;
  dataDir: string;
  devTools: boolean;
  /** dev tools only: every new run's first floor uses this dungeon theme (CURSEBOUND_DEV_THEME, art checks) */
  devTheme?: string | null;
  allowedOrigins: string[];
  allowedHosts: string[];
  /** New accounts allowed per client address per hour (anti-spam when LAN sharing is on). */
  registerPerHour: number;
  /** cloud service base URL for online mode (docs/contracts/ONLINE_CONTRACT.md); null = local accounts only */
  cloudUrl: string | null;
  /** set when the authority also serves the static client (desktop app) */
  staticDir: string | null;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/**
 * Allow the authority's own origin once its port is known: `CURSEBOUND_PORT=0` picks a random free port at listen
 * time, and the desktop app loads the static client from the authority itself (same-origin API and room socket).
 */
export function allowListeningPort(cfg: ServerConfig, port: number): void {
  cfg.port = port;
  for (const h of ['127.0.0.1', 'localhost']) {
    if (!cfg.allowedHosts.includes(`${h}:${port}`)) cfg.allowedHosts.push(`${h}:${port}`);
    if (!cfg.allowedOrigins.includes(`http://${h}:${port}`)) cfg.allowedOrigins.push(`http://${h}:${port}`);
  }
}

export function loadConfig(env = process.env): ServerConfig {
  const port = Number(env.CURSEBOUND_PORT ?? 2567);
  const clientPort = Number(env.CURSEBOUND_CLIENT_PORT ?? 3000);
  const lan = env.CURSEBOUND_LAN === '1';
  const dataDir = env.CURSEBOUND_DATA_DIR ? path.resolve(env.CURSEBOUND_DATA_DIR) : path.join(REPO_ROOT, 'data');
  const loopHosts = ['localhost', '127.0.0.1', '[::1]'];
  const lanHosts = lan ? lanAddresses() : [];
  const hosts = [...loopHosts, ...lanHosts];
  const staticDir = env.CURSEBOUND_STATIC_DIR ? path.resolve(env.CURSEBOUND_STATIC_DIR) : null;
  const cfg: ServerConfig = {
    port, clientPort, lan,
    host: lan ? '0.0.0.0' : '127.0.0.1',
    dataDir,
    devTools: env.CURSEBOUND_DEV_TOOLS === '1',
    devTheme: env.CURSEBOUND_DEV_TOOLS === '1' ? env.CURSEBOUND_DEV_THEME || null : null,
    // serving the client itself (desktop), the only page origin is the authority's own; no separate Next.js port
    allowedOrigins: staticDir ? [] : hosts.flatMap((h) => [`http://${h}:${clientPort}`]),
    allowedHosts: hosts.flatMap((h) => [`${h}:${port}`, `${h}:${clientPort}`, h]),
    registerPerHour: Math.max(1, Number(env.CURSEBOUND_REGISTER_PER_HOUR ?? 20) || 20),
    cloudUrl: env.CURSEBOUND_CLOUD_URL ? env.CURSEBOUND_CLOUD_URL.replace(/\/+$/, '') : null,
    staticDir,
  };
  if (staticDir && port !== 0) allowListeningPort(cfg, port);
  return cfg;
}
