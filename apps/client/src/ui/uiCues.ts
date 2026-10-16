'use client';

import { useEffect, useRef } from 'react';
import { sharedAudio } from '@/game/audio/shared';
import type { SfxId } from '@/game/audio/sfx';
import { countdownSecond } from '@/game/audio/fileCues';

// Menu-screen recorded cues (tools/audio/sounds.mjs tier 3; see game/audio/fileCues.ts): the file when it exists, else
// `fallback` or nothing, mixed on the interface bus.

/** Play a recorded interface cue by file name (fallback: a shared cue, or null for silence without the file). */
export function playUiFile(key: string, fallback: SfxId | null = null, opts: { volume?: number; priority?: number } = {}) {
  void sharedAudio().then((a) => a?.playFile(key, fallback, { priority: 4, ...opts, ui: true }));
}

/** A clock tick for each of a countdown's last five seconds (door vote, Fate vote, loadout timer). */
export function useCountdownTick(secs: number | null) {
  const shown = countdownSecond(secs);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (shown !== null && shown !== last.current) playUiFile('countdown_tick', null, { volume: 0.7 });
    last.current = shown;
  }, [shown]);
}
