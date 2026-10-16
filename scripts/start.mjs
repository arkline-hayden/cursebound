#!/usr/bin/env node
// One local start command (PRD §25.3): checks Node, creates the data directory, verifies ports, starts the
// authoritative backend (migrations run on open) and the Next.js frontend, prints the loopback URL, and shuts
// both down cleanly (pending transactions flushed) on Ctrl+C. No cloud credentials, Docker or accounts needed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const lan = args.has('--lan') || process.env.CURSEBOUND_LAN === '1';
const prod = args.has('--prod');
const API_PORT = Number(process.env.CURSEBOUND_PORT ?? 2567);
const WEB_PORT = Number(process.env.CURSEBOUND_CLIENT_PORT ?? 3000);
const dataDir = process.env.CURSEBOUND_DATA_DIR ? path.resolve(process.env.CURSEBOUND_DATA_DIR) : path.join(root, 'data');

const log = (m) => console.log(`\x1b[35m[cursebound]\x1b[0m ${m}`);
const fail = (m) => { console.error(`\x1b[31m[cursebound]\x1b[0m ${m}`); process.exit(1); };

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) fail(`Node ${process.versions.node} found; CURSEBOUND needs Node 22.13+ (built-in SQLite). Install the current Node LTS.`);
if (!fs.existsSync(path.join(root, 'node_modules', 'next'))) fail('Dependencies are missing. Run `npm install` first.');
fs.mkdirSync(dataDir, { recursive: true });
log(`data directory: ${dataDir}`);

function portInUse(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port, host);
  });
}

async function health() {
  try { const r = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`); return r.ok ? await r.json() : null; } catch { return null; }
}

const apiBusy = await portInUse(API_PORT, '127.0.0.1');
const webBusy = await portInUse(WEB_PORT, '127.0.0.1');
if (apiBusy || webBusy) {
  const h = apiBusy ? await health() : null;
  if (h?.service === 'cursebound' && webBusy) {
    log(`CURSEBOUND already appears to be running. Open http://localhost:${WEB_PORT} — or stop the other instance first (Ctrl+C in its terminal).`);
    process.exit(0);
  }
  fail(`Port ${apiBusy ? API_PORT : WEB_PORT} is already in use${h?.service === 'cursebound' ? ' by another CURSEBOUND backend' : ''}. Stop that process, or set CURSEBOUND_PORT / CURSEBOUND_CLIENT_PORT to free ports. Not launching duplicates.`);
}

const env = { ...process.env, CURSEBOUND_PORT: String(API_PORT), CURSEBOUND_CLIENT_PORT: String(WEB_PORT), CURSEBOUND_DATA_DIR: dataDir, ...(lan ? { CURSEBOUND_LAN: '1' } : {}), NEXT_TELEMETRY_DISABLED: '1' };
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
// recorded sound files dropped into apps/client/public/audio/sfx are picked up on every start
spawnSync(process.execPath, [path.join(root, 'scripts', 'audio-manifest.mjs')], { cwd: root, stdio: 'inherit' });
const clientDir = path.join(root, 'apps', 'client');
const host = lan ? '0.0.0.0' : '127.0.0.1';

if (prod) {
  log('building the production frontend (one-time per change)…');
  const b = spawnSync(process.execPath, [nextCli, 'build'], { cwd: clientDir, env: { ...env, NODE_ENV: 'production' }, stdio: 'inherit' });
  if (b.status !== 0) fail('frontend build failed');
}

log('starting authoritative backend…');
const serverMain = path.join(root, 'apps', 'server', 'src', 'main.ts');
let server = null;
let restarting = false;
function spawnServer() {
  server = spawn(process.execPath, [tsxCli, serverMain], { cwd: root, env, stdio: ['pipe', 'inherit', 'inherit'] });
  server.on('exit', (c) => {
    if (restarting || stopping) return;
    log(`backend exited (${c}); stopping frontend`);
    stopping = true;
    try { web?.kill(); } catch { /* ignore */ }
    process.exit(c ?? 1);
  });
}
async function waitHealthy() {
  let h = null;
  for (let i = 0; i < 100 && !h; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (server.exitCode !== null) return null;
    h = await health();
  }
  return h;
}
let stopping = false;
let web = null;
spawnServer();
const up = await waitHealthy();
if (!up) fail('backend did not become healthy within 20 s (see messages above).');
log(`backend healthy (content ${up.contentHash.slice(0, 10)}…, schema v${up.persistence?.schemaVersion})`);

// development: restart the authority when shared game code changes so client and server content never drift
// (open rooms end; solo runs can be resumed from their last safe checkpoint)
if (!prod) {
  let timer = null;
  const onChange = (_e, file) => {
    if (!file || !/\.(ts|tsx|mjs)$/.test(String(file))) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (stopping) return;
      restarting = true;
      log('game code changed — restarting the authority…');
      const old = server;
      try { old.stdin.write('shutdown\n'); } catch { /* ignore */ }
      await new Promise((r) => { const t = setTimeout(() => { try { old.kill(); } catch { /* ignore */ } r(); }, 6000); old.once('exit', () => { clearTimeout(t); r(); }); });
      spawnServer();
      const h = await waitHealthy();
      restarting = false;
      log(h ? `authority restarted (content ${h.contentHash.slice(0, 10)}…)` : 'authority failed to restart — fix the error above and save again');
    }, 500);
  };
  for (const dir of ['packages', path.join('apps', 'server', 'src')]) {
    try { fs.watch(path.join(root, dir), { recursive: true }, onChange); } catch { /* recursive watch unsupported */ }
  }
}

log(`starting Next.js frontend (${prod ? 'production' : 'development'})…`);
web = spawn(process.execPath, [nextCli, prod ? 'start' : 'dev', '-p', String(WEB_PORT), '-H', host], { cwd: clientDir, env, stdio: ['ignore', 'pipe', 'inherit'] });
let announced = false;
web.stdout.on('data', (d) => {
  const s = d.toString();
  if (/error/i.test(s)) process.stdout.write(s);
  if (!announced && /ready|started server|Local:/i.test(s)) {
    announced = true;
    log(`\x1b[1mPlay at http://localhost:${WEB_PORT}\x1b[0m  (Ctrl+C to stop)`);
    if (lan) {
      const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${WEB_PORT}`);
      log(`LAN sharing ON — others on your network can open: ${addrs.join(', ')}`);
      log('Your OS firewall may ask to allow Node.js on private networks. Never expose these ports to the internet.');
    }
  }
});

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  log('stopping… flushing pending saves');
  try { server.stdin.write('shutdown\n'); } catch { /* ignore */ }
  try { web.kill(); } catch { /* ignore */ }
  const t = setTimeout(() => { try { server.kill(); } catch { /* ignore */ } process.exit(code); }, 8000);
  server.once('exit', () => { clearTimeout(t); process.exit(code); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
web.on('exit', (c) => { if (!stopping) { log(`frontend exited (${c})`); stop(c ?? 1); } });
