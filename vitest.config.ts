import { defineConfig } from 'vitest/config';
import path from 'node:path';

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      '@cursebound/numeric': r('packages/numeric/src/index.ts'),
      '@cursebound/content': r('packages/content/src/index.ts'),
      '@cursebound/simulation': r('packages/simulation/src/index.ts'),
      '@cursebound/protocol': r('packages/protocol/src/index.ts'),
      '@cursebound/accounts': r('packages/accounts/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/accounts/test/**/*.test.ts', 'apps/server/test/**/*.test.ts', 'apps/cloud/test/**/*.test.ts', 'apps/client/test/**/*.test.ts', 'tests/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
