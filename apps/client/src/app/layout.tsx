import type { Metadata, Viewport } from 'next';
// Self-hosted faces (no Google Fonts requests; the desktop app works offline). Jersey 20: UI text and labels ·
// Jersey 10: headings, titles, numbers · Jersey 15: small in-world labels · Cinzel 900: the menu logo wordmark only
// (readable carved capitals) (see the type notes at the top of globals.css)
import '@fontsource/jersey-10';
import '@fontsource/jersey-15';
import '@fontsource/jersey-20';
import '@fontsource/cinzel/900.css';
import './globals.css';
import { SkinInstaller } from '@/ui/SkinInstaller';
import { GamepadRoot } from '@/ui/GamepadRoot';
import { UpdateToast } from '@/ui/UpdateToast';
import { NoTextSelect } from '@/ui/NoTextSelect';

export const metadata: Metadata = {
  title: 'CURSEBOUND',
  description: 'An endless cooperative roguelike where every Fate Card compounds. Local-first browser game.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050404' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SkinInstaller />
        <GamepadRoot />
        <NoTextSelect />
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
        <UpdateToast />
      </body>
    </html>
  );
}
