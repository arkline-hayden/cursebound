'use client';

import { useEffect } from 'react';
import { installMouseGuard } from '@/lib/mouseGuard';

// The mouse back / forward side buttons never navigate between pages and the middle button never starts the browser's
// autoscroll, on every page (menus included): they are bindable game buttons (lib/mouseGuard.ts). Renders nothing.

export function MouseGuard() {
  useEffect(() => installMouseGuard(window), []);
  return null;
}
