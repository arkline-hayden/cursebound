#!/usr/bin/env node
// Bundles everything the desktop app runs, so the packaged app ships no node_modules:
//   build/server/server.mjs      the local authority (apps/server + the .ts workspace packages + ws), ESM
//   build/server/worker.js       the persistence worker thread (store.ts loads the sibling worker.js when compiled)
//   build/server/worker-entry.mjs its plain-JS bootstrap, copied as is
//   dist/main.cjs, dist/preload.cjs  the Electron main process (with electron-updater) and the sandboxed preload
// CLOUD_URL (env, may be empty) is baked into the main process as the cloud base URL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const serverSrc = path.join(repoRoot, 'apps', 'server', 'src');
const serverOut = path.join(desktopDir, 'build', 'server');
const distOut = path.join(desktopDir, 'dist');

const cloudUrl = (process.env.CLOUD_URL ?? '').trim().replace(/\/+$/, '');
if (cloudUrl && !/^https?:\/\/[^\s/]+/.test(cloudUrl)) throw new Error(`CLOUD_URL must be an http(s) URL, got "${cloudUrl}"`);

fs.rmSync(serverOut, { recursive: true, force: true });
fs.rmSync(distOut, { recursive: true, force: true });
fs.mkdirSync(serverOut, { recursive: true });

// ESM bundles that pull in CommonJS deps (ws) need a real `require` for Node built-ins
const esmRequireBanner = "import { createRequire as __cbCreateRequire } from 'node:module'; const require = __cbCreateRequire(import.meta.url);";
const nodeCommon = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  tsconfig: path.join(repoRoot, 'tsconfig.json'),
  banner: { js: esmRequireBanner },
  // optional native speedups of ws; it falls back to JS when they are absent
  external: ['bufferutil', 'utf-8-validate'],
};

await build({ ...nodeCommon, entryPoints: [path.join(desktopDir, 'src', 'server-entry.ts')], outfile: path.join(serverOut, 'server.mjs') });
await build({ ...nodeCommon, entryPoints: [path.join(serverSrc, 'persistence', 'worker.ts')], outfile: path.join(serverOut, 'worker.js') });
fs.copyFileSync(path.join(serverSrc, 'persistence', 'worker-entry.mjs'), path.join(serverOut, 'worker-entry.mjs'));
// worker.js is ESM; this marks the directory so Node does not read it as CommonJS
fs.writeFileSync(path.join(serverOut, 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2) + '\n');

const electronCommon = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  external: ['electron'],
};
await build({
  ...electronCommon,
  entryPoints: [path.join(desktopDir, 'src', 'main.ts')],
  outfile: path.join(distOut, 'main.cjs'),
  define: { __CLOUD_URL__: JSON.stringify(cloudUrl) },
});
// sandboxed preloads may only require('electron'); everything else is inlined
await build({ ...electronCommon, entryPoints: [path.join(desktopDir, 'src', 'preload.ts')], outfile: path.join(distOut, 'preload.cjs') });

const kb = (f) => `${Math.round(fs.statSync(f).size / 1024)} KB`;
console.log(`[desktop] bundled server.mjs ${kb(path.join(serverOut, 'server.mjs'))}, worker.js ${kb(path.join(serverOut, 'worker.js'))}, main.cjs ${kb(path.join(distOut, 'main.cjs'))}, preload.cjs ${kb(path.join(distOut, 'preload.cjs'))}; cloud ${cloudUrl || '(none: local accounts)'}`);
