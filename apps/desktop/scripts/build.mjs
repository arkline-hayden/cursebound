#!/usr/bin/env node
// Desktop build pipeline (docs/RELEASING.md):
//   npm run desktop:build   static client export → bundles → icon → electron-builder for the current OS
//                           (installer + unpacked app in apps/desktop/release)
//   npm run desktop:dev     same build steps, then runs Electron on the unpackaged app (reuses an existing client export
//                           unless --fresh)
// Flags: --dev, --fresh, --skip-client, --dir (unpacked app only, no installer), --publish <never|always|onTag>.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const require = createRequire(path.join(desktopDir, 'package.json'));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dev = has('--dev');

const log = (m) => console.log(`\x1b[35m[desktop]\x1b[0m ${m}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`\x1b[31m[desktop]\x1b[0m failed: ${path.basename(cmd)} ${args.join(' ')}`); process.exit(r.status ?? 1); }
}

const clientOut = path.join(repoRoot, 'apps', 'client', 'out');
const needClient = !has('--skip-client') && (!dev || has('--fresh') || !fs.existsSync(path.join(clientOut, 'index.html')));
if (needClient) {
  log('exporting the static client…');
  run(process.execPath, [path.join(repoRoot, 'apps', 'client', 'scripts', 'build-static.mjs')]);
} else if (!fs.existsSync(path.join(clientOut, 'index.html'))) {
  console.error('\x1b[31m[desktop]\x1b[0m no client export in apps/client/out; run without --skip-client');
  process.exit(1);
} else log('reusing the existing client export (apps/client/out)');

log('bundling the authority, main process and preload…');
run(process.execPath, [path.join(desktopDir, 'scripts', 'bundle.mjs')]);
run(process.execPath, [path.join(desktopDir, 'scripts', 'make-icon.mjs')]);

if (dev) {
  const electron = require('electron');
  log('starting Electron (unpackaged; updates disabled)…');
  run(electron, [desktopDir], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
  process.exit(0);
}

const publish = opt('--publish', 'never');
const builderArgs = [require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.yml', '--publish', publish];
if (has('--dir')) builderArgs.push('--dir');
log(`packaging with electron-builder (publish: ${publish})…`);
// unsigned builds: never pick up a random signing identity from the keychain
run(process.execPath, builderArgs, { cwd: desktopDir, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...process.env } });

const releaseDir = path.join(desktopDir, 'release');
if (fs.existsSync(releaseDir)) {
  for (const f of fs.readdirSync(releaseDir)) {
    const st = fs.statSync(path.join(releaseDir, f));
    if (st.isFile()) log(`  ${f}  ${(st.size / 1024 / 1024).toFixed(1)} MB`);
  }
}
log(`done: ${releaseDir}`);
