// Class accent helpers. Accents come from content data (ClassDef.accent, #rrggbb) and can be any colour, so text and
// rules drawn in an accent are lifted toward bone until they read at >= 4.5:1 on the near-black stone panels.

const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const STONE_L = lum(0x16, 0x12, 0x10);
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const cache = new Map<string, string>();

/** The accent, mixed toward warm bone just enough to reach 4.5:1 contrast on dark stone. */
export function readableAccent(hex: string | undefined): string {
  const key = hex ?? '';
  const hit = cache.get(key);
  if (hit) return hit;
  const v = parseInt((hex ?? '').replace('#', ''), 16);
  let r = Number.isFinite(v) ? (v >> 16) & 255 : 0xc6, g = Number.isFinite(v) ? (v >> 8) & 255 : 0xb6, b = Number.isFinite(v) ? v & 255 : 0x98;
  for (let i = 0; i < 12 && (lum(r, g, b) + 0.05) / (STONE_L + 0.05) < 4.5; i++) {
    r += (0xeb - r) * 0.2; g += (0xe0 - g) * 0.2; b += (0xc8 - b) * 0.2;
  }
  const out = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  cache.set(key, out);
  return out;
}
