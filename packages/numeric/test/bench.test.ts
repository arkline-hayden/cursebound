import { describe, expect, it } from 'vitest';
import { Big } from '../src/index';

describe('micro benchmark (catches pathological slowness only)', () => {
  it('100k mul + add + cmp complete in under 1.5 s', () => {
    const factor = Big.from('1.0000001');
    const step = Big.from('123.456');
    const cap = Big.from('1e300');
    let acc = Big.from('1000');
    let hp = Big.from('1e50');
    let hits = 0;
    // warm-up
    for (let i = 0; i < 5000; i++) acc = acc.mul(factor).add(step);
    acc = Big.from('1000');
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      acc = acc.mul(factor);
      hp = hp.add(acc);
      if (hp.cmp(cap) > 0) hits++;
    }
    const ms = performance.now() - t0;
    console.log(`[numeric bench] 100k mul+add+cmp: ${ms.toFixed(1)} ms (${((ms * 1000) / 100_000).toFixed(2)} µs/iter)`);
    expect(hits).toBe(0);
    expect(acc.gt(Big.from(1000))).toBe(true);
    expect(ms).toBeLessThan(1500);
  });

  it('100k sub + div are also fast', () => {
    const a = Big.from('9.87654321e40');
    let x = Big.from('1e60');
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      x = x.sub(a);
      if (i % 10 === 0) x = x.div(Big.from('1.0000001'));
    }
    const ms = performance.now() - t0;
    console.log(`[numeric bench] 100k sub (+10k div): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});
