import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SkinInstaller } from '@/ui/SkinInstaller';

export const metadata: Metadata = {
  title: 'CURSEBOUND',
  description: 'An endless cooperative roguelike where every Fate Card compounds. Local-first browser game.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050404' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Jersey 20: UI text and labels · Jersey 10: headings, titles, numbers · Jersey 15: small in-world labels ·
            Cinzel 900: the menu logo wordmark only (readable carved capitals) (see the type notes at the top of globals.css) */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Jersey+10&family=Jersey+15&family=Jersey+20&family=Cinzel:wght@900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <SkinInstaller />
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
