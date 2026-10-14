import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCloud } from './main';
import { startCloud } from './server';
import { openPglite } from './sql';

// Local dev server: the whole online stack with no cloud. Without DATABASE_URL it runs on PGlite (real Postgres in
// WASM) persisted under <repo>/data/cloud-pglite (CLOUD_PGLITE_DIR overrides; "memory" keeps nothing). Point the
// local authority at it with CURSEBOUND_CLOUD_URL=http://127.0.0.1:8080 npm start.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

void runCloud(async () => {
  if (process.env.DATABASE_URL) return startCloud();
  const dir = process.env.CLOUD_PGLITE_DIR ?? path.join(repo, 'data', 'cloud-pglite');
  if (dir !== 'memory') mkdirSync(dir, { recursive: true });
  const sql = await openPglite(dir === 'memory' ? undefined : dir);
  const srv = await startCloud({ sql });
  console.log(`[cursebound-cloud] dev service on http://${srv.cfg.host}:${srv.port}/api/v1 (PGlite: ${dir})`);
  return srv;
});
