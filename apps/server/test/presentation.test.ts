import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESENTATION } from '../src/authority';

// The authority only forwards sim events listed in PRESENTATION. A client handler for any other sim event type never
// fires in real play (tests that drive the sim directly don't notice), so every sim event type the client switches on
// must be forwarded.

const root = join(__dirname, '..', '..', '..');
const simTypes = new Set([...readFileSync(join(root, 'packages/simulation/src/types.ts'), 'utf8').matchAll(/\| \{ t: '([a-z_]+)'/g)].map((m) => m[1]!));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('forwarded sim events', () => {
  it('forwards every sim event type the client reacts to', () => {
    const handled = new Set<string>();
    for (const f of sources(join(root, 'apps/client/src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:case |\.t === )'([a-z_]+)'/g)) if (simTypes.has(m[1]!)) handled.add(m[1]!);
    }
    expect(handled.size).toBeGreaterThan(10);
    const missing = [...handled].filter((t) => !PRESENTATION.has(t)).sort();
    expect(missing).toEqual([]);
  });
});
