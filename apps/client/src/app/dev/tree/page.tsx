'use client';

import dynamic from 'next/dynamic';

// Dev-only preview of the skill tree (/dev/tree?class=arcanist): the real SkillTree over a local simulation run in its
// loadout phase. Production builds render nothing here: the preview module is behind a NODE_ENV check, so its import
// is dropped from the production bundle.
const Preview = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./TreePreview'), { ssr: false });

export default function TreeDevPage() {
  return Preview ? <Preview /> : null;
}
