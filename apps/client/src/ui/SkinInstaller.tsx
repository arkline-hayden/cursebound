'use client';

import { useEffect } from 'react';
import { installPixelSkin } from './pixelSkin';
import { applyDocumentSettings, settingsStore } from '@/lib/settings';

/** Generates the pixel UI skin once per page load and applies document-level accessibility settings. */
export function SkinInstaller() {
  useEffect(() => {
    installPixelSkin();
    applyDocumentSettings(settingsStore.get().s);
  }, []);
  return null;
}
