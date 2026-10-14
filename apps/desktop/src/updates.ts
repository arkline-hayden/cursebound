import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { Log } from './log';

// Automatic updates from GitHub Releases (arkline-hayden/cursebound; the feed comes from electron-builder's `publish`
// config, baked into app-update.yml). Checks on launch and every 30 minutes, downloads in the background, and tells the
// renderer when an update is ready; it installs on "Restart to update" or on the next normal quit.
// Co-op needs matching builds, so the launch check runs before the page loads (main.ts waits briefly for `firstCheck`):
// a newer build starts downloading at once and the "Restart to update" toast appears as soon as it is ready.
// Packaged builds only: an unpackaged dev shell has no app-update.yml and nothing to update.
// macOS: Squirrel.Mac only installs updates into a Developer-ID-signed app, and our Mac build is ad-hoc signed, so
// there the shell runs in MANUAL mode: it checks and announces a newer build, and "Download update" opens the public
// download page in the browser (the player installs the new .dmg over the old app; progress lives in userData).

const CHECK_EVERY_MS = 30 * 60 * 1000;

export type CheckResult = 'none' | 'available' | 'error';

export interface Updates {
  /** version downloaded and ready to install, if any */
  pending(): string | null;
  /** quit and run the installer (the caller stops the authority first) */
  install(): void;
  /** settles once the launch check knows whether a newer build exists (or failed) */
  firstCheck: Promise<CheckResult>;
  /** true where updates are downloaded by the player from the download page (macOS, ad-hoc signed) */
  manual: boolean;
}

export function initUpdates(log: Log, onReady: (version: string) => void, downloadPage: string): Updates {
  let ready: string | null = null;
  const manual = process.platform === 'darwin';
  const disabled = !app.isPackaged || process.env.CURSEBOUND_NO_UPDATES === '1';
  if (disabled) {
    log('[updates] skipped (unpackaged or disabled)');
    // dev only: CURSEBOUND_FAKE_UPDATE=<version> announces a pretend update so the toast can be tried in desktop:dev
    const fake = !app.isPackaged ? process.env.CURSEBOUND_FAKE_UPDATE : undefined;
    if (fake) setTimeout(() => { ready = fake; onReady(fake); }, 3000);
    return { pending: () => ready, install: () => { log(`[updates] (fake) would install ${ready}`); app.quit(); }, firstCheck: Promise.resolve('none'), manual };
  }
  autoUpdater.autoDownload = !manual;
  autoUpdater.autoInstallOnAppQuit = !manual;
  // first line only: HTTP errors carry the whole response (headers, cookies) in their message
  const brief = (m: unknown) => String(m instanceof Error ? m.message : m).split('\n')[0].slice(0, 300);
  autoUpdater.logger = {
    info: (m: unknown) => log(`[updates] ${brief(m)}`),
    warn: (m: unknown) => log(`[updates] warn ${brief(m)}`),
    error: () => {},   // reported once by the 'error' event below
    debug: () => {},
  };
  let settle: (r: CheckResult) => void = () => {};
  const firstCheck = new Promise<CheckResult>((resolve) => { settle = resolve; });
  autoUpdater.on('update-available', (info) => {
    settle('available');
    if (!manual) { log(`[updates] ${info.version} available; downloading`); return; }
    // manual mode: announce right away; the player fetches the new build from the download page
    ready = info.version;
    log(`[updates] ${info.version} available; manual download (macOS)`);
    onReady(info.version);
  });
  autoUpdater.on('update-not-available', () => settle('none'));
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version;
    log(`[updates] ${info.version} downloaded; ready to install`);
    onReady(info.version);
  });
  // network failures, rate limits and (on macOS) unsigned builds land here; the game keeps running either way
  autoUpdater.on('error', (err) => { log(`[updates] error ${brief(err)}`); settle('error'); });
  const check = () => { autoUpdater.checkForUpdates().catch(() => { /* already reported via 'error' */ }); };
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
  return {
    pending: () => ready,
    install: () => {
      if (!ready) return;
      if (manual) { if (downloadPage) void shell.openExternal(downloadPage); return; }
      autoUpdater.quitAndInstall(false, true);
    },
    firstCheck,
    manual,
  };
}
