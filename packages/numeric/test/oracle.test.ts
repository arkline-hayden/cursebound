import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Big } from '../src/index';

interface OracleCase {
  op: 'from' | 'mul' | 'div' | 'add' | 'sub' | 'pow' | 'cmp';
  a: string;
  b?: string;
  n?: string;
  r: string | number;
}
interface OracleFile {
  precision: number;
  count: number;
  cases: OracleCase[];
}

const fixturePath = fileURLToPath(new URL('../../../tests/fixtures/numeric_oracle.json', import.meta.url));
const raw = readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(raw) as OracleFile;

function run(c: OracleCase): string | number {
  const a = Big.from(c.a);
  switch (c.op) {
    case 'from':
      return a.toString();
    case 'mul':
      return a.mul(Big.from(c.b!)).toString();
    case 'div':
      return a.div(Big.from(c.b!)).toString();
    case 'add':
      return a.add(Big.from(c.b!)).toString();
    case 'sub':
      return a.sub(Big.from(c.b!)).toString();
    case 'pow':
      return a.powInt(BigInt(c.n!)).toString();
    case 'cmp':
      return a.cmp(Big.from(c.b!));
  }
}

describe('Python Decimal oracle (tests/fixtures/numeric_oracle.json)', () => {
  it('fixture is UTF-8 JSON without BOM and well formed', () => {
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(fixture.precision).toBe(34);
    expect(fixture.cases.length).toBe(fixture.count);
    expect(fixture.count).toBeGreaterThan(1000);
  });

  for (const op of ['from', 'mul', 'div', 'add', 'sub', 'pow', 'cmp'] as const) {
    it(`${op}: matches Decimal exactly (canonical string form)`, () => {
      const cases = fixture.cases.filter((c) => c.op === op);
      expect(cases.length).toBeGreaterThan(10);
      const mismatches: string[] = [];
      for (const c of cases) {
        const got = run(c);
        if (got !== c.r) mismatches.push(`${op}(${c.a}, ${c.b ?? c.n ?? ''}) expected ${c.r} got ${got}`);
      }
      expect(mismatches.slice(0, 10)).toEqual([]);
    });
  }

  it('inputs given in canonical form roundtrip through toString', () => {
    for (const c of fixture.cases) {
      if (c.op === 'from') continue;
      expect(Big.from(c.a).toString()).toBe(c.a);
      if (c.b !== undefined) expect(Big.from(c.b).toString()).toBe(c.b);
    }
  });

  it('1.18^9999 is deterministic and matches the oracle', () => {
    const c = fixture.cases.find((x) => x.op === 'pow' && x.a === '1.18e0' && x.n === '9999')!;
    const r1 = Big.from('1.18').powInt(9999);
    const r2 = Big.from(1.18).powInt(9999n);
    expect(r1.toString()).toBe(c.r);
    expect(r2.eq(r1)).toBe(true);
    expect(r1.e).toBe(718n);
  });
});
