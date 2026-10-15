import { describe, expect, it } from 'vitest';
import { padFamily, padGlyph, spatialNext } from '../apps/client/src/lib/gamepad';

// Controllers: the family is read from the Gamepad API id (prompts show ✕ / L1 on PlayStation, A / LB on Xbox), and
// menu focus moves spatially to the nearest control in the pressed direction.

describe('controller family and glyphs', () => {
  it('recognises Xbox and PlayStation pads from their ids', () => {
    expect(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padFamily('054c-0ce6-DualSense Wireless Controller')).toBe('playstation');
    expect(padFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padFamily('8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8)')).toBe('generic');
  });

  it('labels buttons in each family', () => {
    expect([0, 1, 2, 3, 4, 7, 9].map((i) => padGlyph(i, 'xbox'))).toEqual(['A', 'B', 'X', 'Y', 'LB', 'RT', 'Menu']);
    expect([0, 1, 2, 3, 4, 7, 9].map((i) => padGlyph(i, 'playstation'))).toEqual(['✕', '○', '□', '△', 'L1', 'R2', 'Options']);
    expect(padGlyph(undefined, 'xbox')).toBe('');
    expect(padGlyph(42, 'xbox')).toBe('B42');
  });
});

describe('spatial menu navigation', () => {
  const box = (name: string, left: number, top: number, width = 100, height = 40) => ({ name, getBoundingClientRect: () => ({ left, top, width, height }) });
  // a vertical menu with a row of small buttons under it
  const descend = box('descend', 100, 100), daily = box('daily', 100, 150), party = box('party', 100, 200);
  const records = box('records', 40, 260, 60), rules = box('rules', 110, 260, 60), settings = box('settings', 180, 260, 60);
  const all = [descend, daily, party, records, rules, settings];

  it('moves down and up a column', () => {
    expect(spatialNext(descend, all, 'down')?.name).toBe('daily');
    expect(spatialNext(party, all, 'up')?.name).toBe('daily');
  });

  it('drops from a column onto the nearest control of the row below and walks along it', () => {
    expect(spatialNext(party, all, 'down')?.name).toBe('rules');
    expect(spatialNext(rules, all, 'right')?.name).toBe('settings');
    expect(spatialNext(rules, all, 'left')?.name).toBe('records');
  });

  it('stays put at an edge', () => {
    expect(spatialNext(descend, all, 'up')).toBeUndefined();
    expect(spatialNext(settings, all, 'right')).toBeUndefined();
  });
});
