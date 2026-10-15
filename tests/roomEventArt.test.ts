import { describe, expect, it } from 'vitest';
import { SHRINES } from '@cursebound/content';
import { SFX_IDS, SFX_CAPTIONS } from '../apps/client/src/game/audio/sfx';
import { buildRoomEventSheets } from '../apps/client/src/game/art/roomEventArt';

// Room event art (game/art/roomEventArt.ts) is procedural pixel art: every shrine type has a lit and a spent sheet,
// every frame carries pixels, the imp's animations exist, and the audio cues the renderer plays are registered.

describe('room event art', () => {
  const sheets = buildRoomEventSheets();
  const byKey = new Map(sheets.map((s) => [s.key, s]));

  it('builds a lit and a dark sheet per shrine, the altar, merchant, imp, coins and portal, deterministically', () => {
    expect(new Set(sheets.map((s) => s.key)).size).toBe(sheets.length);
    for (const s of SHRINES) {
      expect(byKey.get(`rev:shrine:${s.id}`)?.frames).toBe(4);
      expect(byKey.get(`rev:shrine:${s.id}:dark`)?.frames).toBe(1);
    }
    for (const k of ['rev:altar', 'rev:altar:dark', 'rev:merchant', 'rev:imp:run', 'rev:imp:idle', 'rev:imp:portal', 'rev:coin', 'rev:portal']) expect(byKey.has(k)).toBe(true);
    const again = buildRoomEventSheets();
    expect(again.map((s) => Buffer.from(s.rgba).toString('base64').slice(0, 64))).toEqual(sheets.map((s) => Buffer.from(s.rgba).toString('base64').slice(0, 64)));
  });

  it('paints every frame (no blank frames) and lit shrines glow brighter than spent ones', () => {
    const lum = (s: (typeof sheets)[number], f: number) => {
      const cols = Math.floor(s.width / s.frameW);
      const fx = (f % cols) * s.frameW, fy = Math.floor(f / cols) * s.frameH;
      let opaque = 0, sum = 0;
      for (let y = 0; y < s.frameH; y++) for (let x = 0; x < s.frameW; x++) {
        const i = ((fy + y) * s.width + fx + x) * 4;
        if (s.rgba[i + 3] < 128) continue;
        opaque++;
        sum += s.rgba[i] + s.rgba[i + 1] + s.rgba[i + 2];
      }
      return { opaque, mean: opaque ? sum / opaque : 0 };
    };
    for (const s of sheets) for (let f = 0; f < s.frames; f++) expect(lum(s, f).opaque, `${s.key}#${f}`).toBeGreaterThan(20);
    for (const s of SHRINES) expect(lum(byKey.get(`rev:shrine:${s.id}`)!, 0).mean).toBeGreaterThan(lum(byKey.get(`rev:shrine:${s.id}:dark`)!, 0).mean);
  });

  it('registers the room event sound cues', () => {
    for (const id of ['coin_pickup', 'shrine_activate', 'altar_pact', 'merchant_buy', 'imp_jingle', 'imp_portal'] as const) expect(SFX_IDS).toContain(id);
    expect(SFX_CAPTIONS.altar_pact).toBeTruthy();
  });
});
