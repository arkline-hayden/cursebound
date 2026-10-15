'use client';

import { useEffect } from 'react';
import { startGamepad } from '@/lib/gamepad';

// Starts the app-wide controller layer once (menus, glyph family, rumble; lib/gamepad.ts). Renders nothing.
export function GamepadRoot() {
  useEffect(() => { startGamepad(); }, []);
  return null;
}
