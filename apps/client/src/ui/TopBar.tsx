'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { authStore, refreshAuth } from '@/lib/auth';
import { useStore } from '@/lib/store';

export function TopBar({ current }: { current?: string }) {
  const auth = useStore(authStore, (s) => s);
  useEffect(() => { if (authStore.get().status === 'unknown') refreshAuth().catch(() => undefined); }, []);
  const link = (href: string, label: string) => (
    <Link className={`btn small ${current === href ? '' : 'ghost'}`} href={href} aria-current={current === href ? 'page' : undefined}>{label}</Link>
  );
  return (
    <>
    <div className="vignette-screen soft" aria-hidden="true" style={{ zIndex: -1 }} />
    <header className="topbar">
      <Link className="brand" href="/">Curse<span>bound</span></Link>
      <nav aria-label="Main" className="row">
        {link('/', 'Play')}
        {link('/records', 'Records')}
        {link('/howto', 'How to play')}
        {link('/settings', 'Settings')}
        {link('/account', auth.account ? auth.account.username : 'Sign in')}
      </nav>
    </header>
    </>
  );
}
