'use client';

import dynamic from 'next/dynamic';

// Dev-only preview of the Fate card spread (/dev/fate): the real DoorPanel over a mock room driven by the real
// simulation, with every dungeon theme one click away. Production builds render nothing here: the preview module is
// behind a NODE_ENV check, so its import is dropped from the production bundle.
const Preview = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./FatePreview'), { ssr: false });

export default function FateDevPage() {
  return Preview ? <Preview /> : null;
}
