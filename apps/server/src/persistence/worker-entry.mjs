// Bootstrap for the persistence worker thread (plain ESM JavaScript so it loads under any runner).
// When the facade runs from TypeScript source (tsx / vitest), the worker module is `worker.ts`, so the
// tsx ESM hooks are registered inside this thread first. `--import tsx` in Worker execArgv is not
// reliable here (Node's built-in type stripping loads the entry before the hooks apply, and
// extensionless relative imports then fail), so registration is done programmatically.
// Compiled builds (the desktop app's esbuild bundle, apps/desktop/scripts/bundle.mjs) pass the sibling
// `worker.js` and never load tsx.
import { workerData } from 'node:worker_threads';

const entry = workerData && typeof workerData.entry === 'string' ? workerData.entry : null;
if (!entry) throw new Error('persistence worker-entry: missing workerData.entry');
if (entry.endsWith('.ts')) {
  const { register } = await import('tsx/esm/api');
  register();
}
await import(entry);
