'use client';

import { useEffect, useRef, useState } from 'react';
import { CLASS_BY_ID, DUNGEON_THEMES } from '@cursebound/content';
import { netStore, type GameConnection, type PhaseData } from '@/lib/net';
import { useStore } from '@/lib/store';
import { settingsStore, keyCap } from '@/lib/settings';
import { useCinematic } from './cinematic';
import { doorColors } from '@/game/art/doors';
import type { AudioEngine } from '@/game/audio/AudioEngine';

// MINIMAP (Diablo automap): the floor drawn in the iso camera's diamond orientation (world north = screen up-right),
// floor in muted stone, wall edges as bright 1px lines, tinted by the floor's theme. Heroes are class-accent dots
// (the local hero pulses and shows its facing), enemies red, champions blue, rares violet, bosses a skull; potions,
// resource orbs, legendary loot beams and (during VOTING) the three doors are small glyphs. Fog of exploration: tiles
// within ~7 tiles of anywhere a hero has stood are revealed; the rest stay dim, but enemies show everywhere (dimmer
// in the fog). Click walks there (`cursebound:moveto`, world tile coords); the minimap key (default M) toggles the large
// overlay. During VOTING the panel moves top-left (DoorPanel owns the right edge and the bottom strip).
// Everything is rasterised in "art pixels" (2 CSS px at HUD zoom 1, so 3/4 device px at 1.5x/2x): crisp squares
// that match the pixel skin. The floor + fog layer is cached offscreen and rebuilt only when the fog grows; the
// view redraws at 10 Hz.

type MapInfo = NonNullable<PhaseData['map']>;
/** SnapDoor (simulation doors.ts): theme, standing slots, commit hold 0..1, boss lair, committed door. */
interface Door { i: number; x: number; y: number; nx?: number; ny?: number; th: string; c?: string; v?: number[]; hold?: number; b?: 1; sel?: 1 }
const doorHex = (th: string) => `#${doorColors(th).glow.toString(16).padStart(6, '0')}`;

const REVEAL = 7;
const COMPACT = { w: 128, h: 72, k: 2 };
const TICK_MS = 100;

/** Theme tints: floor (two parities) and wall edge (fogged variants are mixed toward black). */
const THEME_TINT: Record<string, { f0: string; f1: string; edge: string }> = {
  catacombs: { f0: '#54443a', f1: '#4e4036', edge: '#f0c060' },
  flooded: { f0: '#30455a', f1: '#2d4155', edge: '#9cbcff' },
  ossuary: { f0: '#5a5040', f1: '#554b3c', edge: '#fff4dc' },
  sanctum: { f0: '#4a2a2e', f1: '#46272b', edge: '#ffb0a0' },
  fungal: { f0: '#2c4a3e', f1: '#29453a', edge: '#9ff6dc' },
  forge: { f0: '#4e3428', f1: '#4a3125', edge: '#ffb060' },
  frost: { f0: '#3a4c5e', f1: '#364859', edge: '#e0f4ff' },
};
const tintOf = (theme: string | undefined) => THEME_TINT[theme ?? ''] ?? THEME_TINT.catacombs;

const ENEMY = { normal: '#ff4436', champion: '#5fb0ff', rare: '#b47aff', boss: '#d58cff' };

const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mixRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

/** Content key of a floor: every PHASE message re-sends the map as a fresh array, so identity is not enough. */
const keyCache = new WeakMap<number[], string>();
function mapKey(map: MapInfo): string {
  let k = keyCache.get(map.tiles);
  if (!k) {
    let h = 2166136261;
    for (let i = 0; i < map.tiles.length; i++) h = Math.imul(h ^ map.tiles[i], 16777619);
    k = `${map.w}x${map.h}:${map.theme}:${map.layout}:${map.decorSeed}:${(h >>> 0).toString(36)}`;
    keyCache.set(map.tiles, k);
  }
  return k;
}

// fog of exploration survives remounts and PHASE re-sends within a floor (keyed by the floor's content)
let fog: { key: string; seen: Uint8Array; count: number } | null = null;
function fogFor(map: MapInfo) {
  const key = mapKey(map);
  if (!fog || fog.key !== key || fog.seen.length !== map.w * map.h) fog = { key, seen: new Uint8Array(map.w * map.h), count: 0 };
  return fog;
}
function reveal(map: MapInfo, x: number, y: number): void {
  const f = fogFor(map);
  const r2 = REVEAL * REVEAL;
  for (let ty = Math.max(0, Math.floor(y - REVEAL)); ty <= Math.min(map.h - 1, Math.ceil(y + REVEAL)); ty++) {
    for (let tx = Math.max(0, Math.floor(x - REVEAL)); tx <= Math.min(map.w - 1, Math.ceil(x + REVEAL)); tx++) {
      const dx = tx + 0.5 - x, dy = ty + 0.5 - y;
      if (dx * dx + dy * dy > r2) continue;
      const i = ty * map.w + tx;
      if (!f.seen[i]) { f.seen[i] = 1; f.count++; }
    }
  }
}

/** Floor + wall-edge raster of the whole map at k art px per iso unit, with fog applied. */
function rasterise(map: MapInfo, k: number): HTMLCanvasElement {
  const W = (map.w + map.h) * k, H = Math.ceil((map.w + map.h) * k / 2) + 1;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return cv;
  const img = g.createImageData(W, H);
  const d = img.data;
  const seen = fogFor(map).seen;
  const t = tintOf(map.theme);
  const f0 = hexRgb(t.f0), f1 = hexRgb(t.f1), edge = hexRgb(t.edge), black: [number, number, number] = [8, 6, 5];
  const fogF0 = mixRgb(f0, black, 0.55), fogF1 = mixRgb(f1, black, 0.55), fogEdge = mixRgb(edge, black, 0.6);
  // pass 1: tile index under each pixel (-1 = wall / outside)
  const tileAt = new Int32Array(W * H);
  const kh = k / 2;
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / kh;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / k - map.h;
      const x = Math.floor((u + v) / 2), y = Math.floor((v - u) / 2);
      tileAt[py * W + px] = x >= 0 && y >= 0 && x < map.w && y < map.h && map.tiles[y * map.w + x] !== 1 ? y * map.w + x : -1;
    }
  }
  // pass 2: floor fill (parity shade), wall pixels touching floor become edges; fog dims unexplored
  const put = (o: number, c: [number, number, number], a: number) => { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a; };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px, o = i * 4, ti = tileAt[i];
      if (ti >= 0) {
        const odd = ((ti % map.w) + ((ti / map.w) | 0)) & 1;
        if (seen[ti]) put(o, odd ? f1 : f0, 255); else put(o, odd ? fogF1 : fogF0, 255);
        continue;
      }
      let nb = -1;
      if (px > 0 && tileAt[i - 1] >= 0) nb = tileAt[i - 1];
      else if (px < W - 1 && tileAt[i + 1] >= 0) nb = tileAt[i + 1];
      else if (py > 0 && tileAt[i - W] >= 0) nb = tileAt[i - W];
      else if (py < H - 1 && tileAt[i + W] >= 0) nb = tileAt[i + W];
      if (nb >= 0) put(o, seen[nb] ? edge : fogEdge, 255);
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Tiny pixel sprites: each character is a palette key, '.' transparent. */
const SKULL = ['..ppppp..', '.pooooop.', 'po#####op', 'po#o#o#op', 'po#####op', '.po###op.', '.po#h#op.', '..poooo..', '...ppp...'];
const DOOR = ['.ooooo.', 'o#####o', 'o##h##o', 'o#ooo#o', 'o#o.o#o', 'o#o.o#o', 'ooooooo'];
function sprite(g: CanvasRenderingContext2D, rows: string[], cx: number, bottom: number, pal: Record<string, string>, sc = 1) {
  const x = Math.round(cx) - Math.floor((rows[0].length * sc) / 2), y = Math.round(bottom) - rows.length * sc;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const col = pal[rows[r][c]];
    if (!col) continue;
    g.fillStyle = col;
    g.fillRect(x + c * sc, y + r * sc, sc, sc);
  }
}
/** Square dot with a 1px black outline, centred on (x, y). */
function dot(g: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  const x0 = Math.round(x - s / 2), y0 = Math.round(y - s / 2);
  g.fillStyle = '#000';
  g.fillRect(x0 - 1, y0 - 1, s + 2, s + 2);
  g.fillStyle = col;
  g.fillRect(x0, y0, s, s);
}

/** Parse a compact Big text ("12", "1.2K", "3.4e7") to an approximate number. */
function approxCount(t: string | null | undefined): number {
  if (!t) return 1;
  const m = /^([\d.]+)\s*([KMBTkmbt]|e\d+)?/.exec(t);
  if (!m) return 1;
  const n = parseFloat(m[1]);
  const s = m[2];
  if (!s) return n;
  if (s[0] === 'e') return n * 10 ** Number(s.slice(1));
  return n * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[s.toLowerCase() as 'k'] ?? 1);
}

interface View { k: number; ox: number; oy: number; w: number; h: number }

/** Door name tags for the large map: centred above each door, nudged up/down so neighbouring tags never overlap. */
function layoutTags(tags: { x: number; y: number; name: string; col: string; votes: number }[], px: number) {
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const H = 30;
  return [...tags].sort((a, b) => a.y - b.y).map((d) => {
    const text = `${d.name.replace(/^The /, '')}${d.votes > 0 ? ` · ${d.votes} vote${d.votes > 1 ? 's' : ''}` : ''}`;
    const w = text.length * 9 + 16, cx = Math.round(d.x * px);
    const base = Math.round((d.y - 11) * px);
    const hits = (t: number) => placed.some((p) => cx - w / 2 < p.r && cx + w / 2 > p.l && t - H < p.b && t > p.t);
    let top = base;
    for (let i = 1; i <= 6 && hits(top); i++) top = i % 2 ? base - H * Math.ceil(i / 2) : base + H * Math.ceil(i / 2) + Math.round(14 * px);
    placed.push({ l: cx - w / 2, r: cx + w / 2, t: top - H, b: top });
    return { left: cx, top, col: d.col, text };
  });
}

function artPx(): number {
  if (typeof window === 'undefined') return 2;
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-zoom')) || 1;
  return Math.max(2, Math.round(2 * z));
}

export function Minimap({ net, audio = null }: { net: GameConnection; audio?: AudioEngine | null }) {
  const map = useStore(netStore, (s) => s.phase?.map ?? null);
  const phaseName = useStore(netStore, (s) => s.phase?.phase ?? '');
  const cine = useCinematic();
  const toggleKey = useStore(settingsStore, (s) => keyCap(s.s.keys.minimap?.[0] ?? 'KeyM'));
  const [large, setLarge] = useState(false);
  const [blind, setBlind] = useState(false);
  const [doorTags, setDoorTags] = useState<{ x: number; y: number; name: string; col: string; votes: number }[]>([]);
  const smallRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<{ small: View | null; big: View | null }>({ small: null, big: null });
  const rasterRef = useRef<Record<'small' | 'big', { key: string; cv: HTMLCanvasElement; fogCount: number } | null>>({ small: null, big: null });
  const [bigSize, setBigSize] = useState({ w: 320, h: 200, px: 2 });
  const audioRef = useRef<AudioEngine | null>(audio);
  audioRef.current = audio;
  // elites / bosses already announced with a ping on this floor (throttled to one ping per 4 s)
  const sighted = useRef<{ key: string; ids: Set<number>; at: number }>({ key: '', ids: new Set(), at: 0 });

  // the minimap binding (default M) toggles the large overlay (never while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const bound = settingsStore.get().s.keys.minimap ?? ['KeyM'];
      if (bound.includes(e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setLarge((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (cine) setLarge(false); }, [cine]);

  // large overlay size: the biggest integer k that fits ~70% of the viewport
  useEffect(() => {
    if (!large || !map) return;
    const fit = () => {
      const px = artPx();
      const availW = Math.floor(Math.min(window.innerWidth * 0.66, 1400) / px) - 8;
      const availH = Math.floor((window.innerHeight * 0.6) / px) - 8;
      const span = map.w + map.h;
      const k = Math.max(2, Math.min(10, Math.floor(availW / span), Math.floor((availH * 2) / span)));
      setBigSize({ w: span * k + 8, h: Math.ceil((span * k) / 2) + 9, px });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [large, map]);

  // 10 Hz draw loop
  useEffect(() => {
    if (!map) return;
    let alive = true;
    let pulse = 0;
    const draw = () => {
      if (!alive) return;
      pulse++;
      const snap = netStore.get().hud;
      const slot = netStore.get().slot;
      const players = snap?.players ?? [];
      for (const p of players) if (p.life !== 'dead') reveal(map, p.x, p.y);
      const me = players[slot];
      const pred = net.pred.valid ? net.pred : null;
      const meX = pred ? pred.x : me?.x ?? map.w / 2, meY = pred ? pred.y : me?.y ?? map.h / 2;
      if (pred) reveal(map, meX, meY);
      const blinded = !!me?.buffs?.includes('blinded');
      setBlind((b) => (b === blinded ? b : blinded));
      const sg = sighted.current;
      if (sg.key !== mapKey(map)) { sg.key = mapKey(map); sg.ids.clear(); }
      if (!blinded && snap?.phase === 'COMBAT') {
        let fresh = false;
        for (const e of snap.enemies) if ((e.boss || (e.el ?? 0) > 0) && e.st !== 'dying' && !sg.ids.has(e.i)) { sg.ids.add(e.i); fresh = true; }
        const now = performance.now();
        if (fresh && now - sg.at > 4000) { sg.at = now; audioRef.current?.play('minimap_ping', { volume: 0.35, priority: 1 }); }
      }
      const f = fogFor(map);
      const targets: [HTMLCanvasElement | null, 'small' | 'big'][] = [[smallRef.current, 'small'], [bigRef.current, 'big']];
      let tags: typeof doorTags | null = null;
      for (const [cv, which] of targets) {
        if (!cv) continue;
        const g = cv.getContext('2d');
        if (!g) continue;
        const W = cv.width, H = cv.height;
        const span = map.w + map.h;
        const k = which === 'small' ? COMPACT.k : Math.max(2, Math.min(10, Math.floor((W - 8) / span), Math.floor(((H - 9) * 2) / span)));
        const key = `${which}:${k}:${mapKey(map)}`;
        let raster = rasterRef.current[which];
        if (!raster || raster.key !== key || raster.fogCount !== f.count) {
          raster = { key, cv: rasterise(map, k), fogCount: f.count };
          rasterRef.current[which] = raster;
        }
        const RW = raster.cv.width, RH = raster.cv.height;
        // view origin: fitted when the whole floor fits, else centred on the hero and clamped to the map
        const hx = (meX - meY + map.h) * k, hy = (meX + meY) * k / 2;
        const ox = RW <= W ? -Math.floor((W - RW) / 2) : Math.round(Math.max(0, Math.min(RW - W, hx - W / 2)));
        const oy = RH <= H ? -Math.floor((H - RH) / 2) : Math.round(Math.max(0, Math.min(RH - H, hy - H / 2)));
        const view: View = { k, ox, oy, w: W, h: H };
        viewRef.current[which] = view;
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, W, H);
        g.drawImage(raster.cv, -ox, -oy);
        const S = (x: number, y: number) => ({ x: (x - y + map.h) * k - ox, y: (x + y) * k / 2 - oy });
        const seenAt = (x: number, y: number) => {
          const tx = Math.floor(x), ty = Math.floor(y);
          return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h ? f.seen[ty * map.w + tx] === 1 : false;
        };
        const big = which === 'big';
        // doors (VOTING)
        const doors = ((snap as unknown as { doors?: Door[] } | null)?.doors ?? []);
        if (big) tags = [];
        for (const dr of doors) {
          const q = S(dr.x, dr.y);
          const col = doorHex(dr.th);
          const sc = big ? 2 : 1, x0 = Math.round(q.x), y0 = Math.round(q.y);
          // the committed door gets a pulsing white rim; boss lairs a blood-red outline
          if (dr.sel && pulse % 4 < 2) { g.fillStyle = '#ffffff'; g.fillRect(x0 - 4 * sc - 1, y0 + 1 - 7 * sc - 1, 7 * sc + 2 + sc, 7 * sc + 2); }
          sprite(g, DOOR, q.x, q.y + 1, { o: dr.b ? '#c01828' : '#000', '#': col, h: '#ffffff' }, sc);
          if (dr.b) sprite(g, SKULL, q.x, q.y - 7 * sc - 1, { p: '#c01828', o: '#000', '#': '#ebe0c8', h: '#ff3b2f' }, 1);
          // commit hold: a small bar under the door
          if ((dr.hold ?? 0) > 0) {
            const w = 7 * sc;
            g.fillStyle = '#000'; g.fillRect(x0 - Math.floor(w / 2) - 1, y0 + 2, w + 2, 3);
            g.fillStyle = '#ffd36a'; g.fillRect(x0 - Math.floor(w / 2), y0 + 3, Math.max(1, Math.round(w * Math.min(1, dr.hold ?? 0))), 1);
          }
          const votes = dr.v?.length ?? 0;
          const vy = y0 - (dr.b ? 9 : 0) - (big ? 18 : 10);
          for (let i = 0; i < votes; i++) { g.fillStyle = '#000'; g.fillRect(x0 - 4 + i * 4, vy, 4, 4); g.fillStyle = '#ffd36a'; g.fillRect(x0 - 3 + i * 4, vy + 1, 2, 2); }
          if (big && tags) tags.push({ x: q.x, y: q.y - (dr.b ? 9 : 0), name: `${DUNGEON_THEMES.find((t) => t.id === dr.th)?.name ?? dr.th}${dr.b ? ' (boss lair)' : ''}`, col, votes });
        }
        // pickups and loot
        for (const pk of snap?.pickups ?? []) {
          const q = S(pk.x, pk.y);
          const col = pk.k === 'potion' ? '#ff5a7a' : pk.k === 'orb' ? '#6a8cff' : '#ffd36a';
          const x0 = Math.round(q.x), y0 = Math.round(q.y);
          g.fillStyle = '#000'; g.fillRect(x0 - 2, y0 - 1, 5, 3); g.fillRect(x0 - 1, y0 - 2, 3, 5);
          g.fillStyle = col; g.fillRect(x0 - 1, y0, 3, 1); g.fillRect(x0, y0 - 1, 1, 3);
        }
        for (const lt of snap?.lt ?? []) {
          const q = S(lt.x, lt.y);
          const x0 = Math.round(q.x), y0 = Math.round(q.y);
          const hgt = big ? 7 : 5;
          g.fillStyle = '#000'; g.fillRect(x0 - 1, y0 - hgt - 1, 3, hgt + 2);
          g.fillStyle = '#ff8a1e'; g.fillRect(x0, y0 - hgt, 1, hgt);
          g.fillStyle = '#fff0a6'; g.fillRect(x0, y0 - hgt, 1, 1);
        }
        // enemies (hidden while the local hero is blinded)
        if (!blinded) {
          for (const e of snap?.enemies ?? []) {
            if (e.st === 'dying') continue;
            const q = S(e.x, e.y);
            g.globalAlpha = seenAt(e.x, e.y) ? 1 : 0.6;
            if (e.boss) sprite(g, SKULL, q.x, q.y + (big ? 9 : 4), { p: ENEMY.boss, o: '#000', '#': '#ebe0c8', h: '#ff3b2f' }, big ? 2 : 1);
            else {
              const tier = e.el === 2 ? 'rare' : e.el === 1 ? 'champion' : 'normal';
              const n = approxCount(e.cnt);
              const s = (tier === 'normal' ? 3 : 4) + (n >= 8 ? 1 : 0) + (big ? 1 : 0);
              dot(g, q.x, q.y, s, ENEMY[tier]);
            }
            g.globalAlpha = 1;
          }
        }
        // heroes: allies first, the local hero on top
        for (const p of players) {
          if (p.s === slot) continue;
          const q = S(p.x, p.y);
          const col = p.life === 'alive' ? CLASS_BY_ID[p.c]?.accent ?? '#ebe0c8' : '#7d746d';
          dot(g, q.x, q.y, big ? 4 : 3, col);
        }
        if (me) {
          const q = S(meX, meY);
          const col = CLASS_BY_ID[me.c]?.accent ?? '#ebe0c8';
          const x0 = Math.round(q.x), y0 = Math.round(q.y);
          const r = big ? 5 : 3;
          // facing tick (screen-space direction of the aim vector)
          const sx = (me.ax - me.ay), sy = (me.ax + me.ay) / 2, l = Math.hypot(sx, sy) || 1;
          const fx = x0 + Math.round((sx / l) * (r + 2)), fy = y0 + Math.round((sy / l) * (r + 2));
          g.fillStyle = '#000'; g.fillRect(fx - 1, fy - 1, 3, 3);
          g.fillStyle = '#ffffff'; g.fillRect(fx, fy, 1, 1);
          // diamond marker: black, pulsing white/gold rim, accent core
          const ring = pulse % 6 < 3 ? '#ffffff' : '#ffd36a';
          for (let dy = -r - 1; dy <= r + 1; dy++) {
            const span2 = r + 1 - Math.abs(dy);
            g.fillStyle = '#000'; g.fillRect(x0 - span2, y0 + dy, span2 * 2 + 1, 1);
          }
          for (let dy = -r; dy <= r; dy++) {
            const span2 = r - Math.abs(dy);
            g.fillStyle = ring; g.fillRect(x0 - span2, y0 + dy, span2 * 2 + 1, 1);
          }
          for (let dy = -r + 1; dy <= r - 1; dy++) {
            const span2 = r - 1 - Math.abs(dy);
            g.fillStyle = col; g.fillRect(x0 - span2, y0 + dy, span2 * 2 + 1, 1);
          }
        }
      }
      if (tags) setDoorTags((old) => (JSON.stringify(old) === JSON.stringify(tags) ? old : tags!));
    };
    draw();
    const id = window.setInterval(draw, TICK_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [map, net, large, bigSize]);

  if (!map) return null;
  const theme = DUNGEON_THEMES.find((t) => t.id === map.theme)?.name ?? 'The Depths';

  /** Click on a canvas: art px under the cursor → world tile → nearest floor tile → move-to. */
  const onClick = (which: 'small' | 'big') => (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const cv = e.currentTarget, view = viewRef.current[which];
    if (!view) return;
    const r = cv.getBoundingClientRect();
    const ax = ((e.clientX - r.left) / r.width) * cv.width + view.ox;
    const ay = ((e.clientY - r.top) / r.height) * cv.height + view.oy;
    const u = ax / view.k - map.h, v = ay / (view.k / 2);
    const wx = (u + v) / 2, wy = (v - u) / 2;
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const tx = Math.floor(wx) + dx, ty = Math.floor(wy) + dy;
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.tiles[ty * map.w + tx] === 1) continue;
      const dd = (tx + 0.5 - wx) ** 2 + (ty + 0.5 - wy) ** 2;
      if (dd < bd) { bd = dd; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
    if (!best) return;
    window.dispatchEvent(new CustomEvent('cursebound:moveto', { detail: best }));
    audio?.play('minimap_ping', { volume: 0.4, priority: 2 });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const voting = phaseName === 'VOTING' || phaseName === 'FATE_COMMIT' || phaseName === 'FATE_OFFER';

  return (
    <>
      <div className={`minimap ${voting ? 'at-left' : ''} ${cine ? 'cine-hidden' : ''}`} onPointerDown={stop} onMouseDown={stop}>
        <div className="mm-frame">
          <canvas ref={smallRef} width={COMPACT.w} height={COMPACT.h} className="mm-canvas" style={{ width: COMPACT.w * 2, height: COMPACT.h * 2 }}
            onClick={onClick('small')} aria-label={`Minimap of ${theme}. Click to walk there.`} role="img" />
          {blind && <span className="mm-blind">Blinded</span>}
        </div>
        <div className="mm-cap">
          <span className="mm-name">{voting ? 'Choose a door' : theme}</span>
          <button className="mm-key" onClick={() => setLarge((v) => !v)} aria-label={large ? 'Close the large map' : 'Open the large map'} aria-pressed={large}>
            <span className="kbd">{toggleKey}</span>
          </button>
        </div>
      </div>
      {large && !cine && (
        <div className="mm-large" role="dialog" aria-label={`Map of ${theme}`} onPointerDown={stop} onMouseDown={stop}>
          <div className="frame ornate mm-large-panel">
            <div className="mm-large-head">
              <h2 className="panel-title sm">{theme}</h2>
              <span className="mm-hint">Click to walk there · <span className="kbd">{toggleKey}</span> close</span>
            </div>
            <div className="mm-large-body well"><div className="mm-stage">
              <canvas ref={bigRef} width={bigSize.w} height={bigSize.h} className="mm-canvas" style={{ width: bigSize.w * bigSize.px, height: bigSize.h * bigSize.px }} onClick={onClick('big')} aria-hidden="true" />
              {layoutTags(doorTags, bigSize.px).map((d, i) => (
                <span key={i} className="mm-door-tag" style={{ left: d.left, top: d.top, color: d.col }}>{d.text}</span>
              ))}
              {blind && <span className="mm-blind lg">Blinded — foes hidden</span>}
            </div></div>
            <ul className="mm-legend" aria-label="Legend">
              <li><i className="lg-me" />You</li>
              <li><i className="lg-ally" />Ally</li>
              <li><i style={{ background: ENEMY.normal }} />Foe</li>
              <li><i style={{ background: ENEMY.champion }} />Champion</li>
              <li><i style={{ background: ENEMY.rare }} />Rare</li>
              <li><i className="lg-boss" />Boss</li>
              <li><i style={{ background: '#ff5a7a' }} />Potion</li>
              <li><i style={{ background: '#ff8a1e' }} />Loot</li>
              {voting && <li><i style={{ background: '#e8c66a' }} />Door</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
