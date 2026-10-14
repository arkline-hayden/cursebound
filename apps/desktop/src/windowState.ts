import fs from 'node:fs';
import { screen, type BrowserWindow, type Rectangle } from 'electron';

// Remembered window size/position (<userData>/window-state.json). A saved position that no longer lands on any
// display (monitor unplugged) is dropped so the window never opens off-screen.

export const MIN_WIDTH = 1280;
export const MIN_HEIGHT = 800;

interface Saved { x?: number; y?: number; width: number; height: number; maximized?: boolean }

export interface WindowState {
  bounds: Partial<Rectangle> & { width: number; height: number };
  minWidth: number;
  minHeight: number;
  maximized: boolean;
  track(win: BrowserWindow): void;
}

function visible(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 64 && b.x + b.width > a.x + 64 && b.y >= a.y - 8 && b.y < a.y + a.height - 64);
}

export function loadWindowState(file: string): WindowState {
  const area = screen.getPrimaryDisplay().workAreaSize;
  // the 1280x800 minimum, but never larger than the screen (small laptop panels must still fit the window)
  const minWidth = Math.min(MIN_WIDTH, area.width);
  const minHeight = Math.min(MIN_HEIGHT, area.height);
  let saved: Saved | null = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Saved; } catch { /* first launch */ }
  let bounds: WindowState['bounds'] = { width: minWidth, height: minHeight };
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    bounds = { width: Math.max(minWidth, Math.round(saved.width)), height: Math.max(minHeight, Math.round(saved.height)) };
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const b = { x: Math.round(saved.x!), y: Math.round(saved.y!), width: bounds.width, height: bounds.height };
      if (visible(b)) bounds = b;
    }
  }
  return {
    bounds, minWidth, minHeight,
    maximized: !!saved?.maximized,
    track(win) {
      let timer: NodeJS.Timeout | null = null;
      const save = () => {
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
        const b = win.getNormalBounds();
        try { fs.writeFileSync(file, JSON.stringify({ ...b, maximized: win.isMaximized() } satisfies Saved)); } catch { /* not fatal */ }
      };
      const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(save, 500); };
      win.on('resize', later);
      win.on('move', later);
      win.on('maximize', later);
      win.on('unmaximize', later);
      win.on('close', () => { if (timer) clearTimeout(timer); save(); });
    },
  };
}
