'use client';

import { useEffect } from 'react';
import { cachedProfile } from '@/lib/profile';
import { initSettings } from '@/lib/settings';
import { TopBar } from '@/ui/TopBar';
import { SettingsPanel } from '@/ui/SettingsPanel';

export default function SettingsPage() {
  useEffect(() => { initSettings(cachedProfile()?.id); }, []);
  return (
    <>
      <TopBar current="/settings" />
      <main id="main" className="page">
        <div className="page-head"><span className="torch" aria-hidden="true" /><h1>Settings</h1></div>
        <p className="page-lead" style={{ marginTop: 16 }}>Nothing here changes game rules or scores. Graphics quality is kept per device.</p>
        <div className="frame ornate crest" style={{ marginTop: 16 }}><SettingsPanel /></div>
      </main>
    </>
  );
}
