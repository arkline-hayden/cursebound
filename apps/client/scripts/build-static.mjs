#!/usr/bin/env node
// Static export of the client for the desktop app (`output: 'export'` → apps/client/out). Cross-platform wrapper so the
// env flag works under cmd.exe too. The export lands in its own distDir, so a running `npm start` is unaffected.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = (await import('node:module')).createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const outDir = path.join(clientDir, 'out');

fs.rmSync(outDir, { recursive: true, force: true });
const r = spawnSync(process.execPath, [nextCli, 'build'], {
  cwd: clientDir,
  stdio: 'inherit',
  env: { ...process.env, CURSEBOUND_STATIC_EXPORT: '1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
});
if (r.status !== 0) process.exit(r.status ?? 1);
if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  console.error('[cursebound] static export finished without out/index.html');
  process.exit(1);
}
console.log(`[cursebound] static client exported to ${outDir}`);
