#!/usr/bin/env node
// DEV ONLY: run the real peer-to-peer co-op flow between two browser tabs on this machine, no cloud needed.
// Starts three processes on non-default ports (the normal `npm start` on 2567/3000 can keep running):
//   - dev presence/signaling hub (apps/cloud/src/devPresence.ts) on 127.0.0.2:<api port>
//   - the authority (apps/server) on 127.0.0.1:<api port>, CURSEBOUND_CLOUD_URL pointing at the hub, own data dir
//   - the Next.js client on 127.0.0.1:<web port>
// The hub shares the authority's port number on another loopback address because the web-dev CSP
// (next.config.mjs) allows WebSockets to `ws://*:<api port>`; the desktop app's CSP lists the cloud origin instead.
//
//   node scripts/p2p-demo.mjs            (CURSEBOUND_PORT=2667, CURSEBOUND_CLIENT_PORT=3100 by default)
//
// Then, in two tabs with separate storage (different origins):
//   A: http://127.0.0.1:3100   B: http://localhost:3100
// sign each into a dev account from the devtools console, then reload:
//   localStorage.setItem('cursebound.cloud.token', 'dev:alice:Alice')     (tab A)
//   localStorage.setItem('cursebound.cloud.token', 'dev:bob:Bob')         (tab B)
// Both see each other in the friends plate. A: Gather a Party → Open an invite room. B: Join on Alice's row
// (or type the code). B's room traffic now runs over an RTCDataChannel to A's bridge.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = process.env.CURSEBOUND_PORT ?? '2667';
const WEB_PORT = process.env.CURSEBOUND_CLIENT_PORT ?? '3100';
const HUB_HOST = process.env.CURSEBOUND_PRESENCE_HOST ?? '127.0.0.2';
const dataDir = process.env.CURSEBOUND_DATA_DIR ?? path.join(os.tmpdir(), `cursebound-p2p-demo-${API_PORT}`);
fs.mkdirSync(dataDir, { recursive: true });

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const base = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const kids = [];
const run = (name, args, env, cwd = root) => {
  const p = spawn(process.execPath, args, { cwd, env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${name}] ${l}\n`).join(''));
  p.stdout.on('data', out); p.stderr.on('data', out);
  p.on('exit', (c) => { console.log(`[${name}] exited (${c})`); stop(); });
  kids.push(p);
};

run('hub', [tsx, 'apps/cloud/src/devPresence.ts', '--dev'], { CURSEBOUND_PRESENCE_HOST: HUB_HOST, CURSEBOUND_PRESENCE_PORT: API_PORT });
run('authority', [tsx, 'apps/server/src/main.ts'], { CURSEBOUND_PORT: API_PORT, CURSEBOUND_CLIENT_PORT: WEB_PORT, CURSEBOUND_DATA_DIR: dataDir, CURSEBOUND_CLOUD_URL: `http://${HUB_HOST}:${API_PORT}` });
run('client', [next, 'dev', '-p', WEB_PORT, '-H', '127.0.0.1'], { CURSEBOUND_PORT: API_PORT }, path.join(root, 'apps', 'client'));
console.log(`[p2p-demo] tab A http://127.0.0.1:${WEB_PORT}  tab B http://localhost:${WEB_PORT}  (data ${dataDir})`);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const k of kids) { try { k.kill(); } catch { /* ignore */ } }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (process.platform === 'win32') process.on('SIGBREAK', stop);
