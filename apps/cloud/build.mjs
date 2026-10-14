// Bundles the cloud service (and the workspace packages it imports) into one ESM file, dist/main.mjs, so the
// runtime image needs no node_modules. PGlite is dev-only and stays external; pg's optional native binding and
// ws's optional accelerators are never installed.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'src', 'main.ts')],
  outfile: path.join(here, 'dist', 'main.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
  external: ['@electric-sql/pglite', 'pg-native', 'bufferutil', 'utf-8-validate'],
  // CommonJS dependencies (pg, ws) call require() for Node built-ins; give the ESM bundle one
  banner: { js: "import { createRequire as __cbRequire } from 'node:module'; const require = __cbRequire(import.meta.url);" },
});
