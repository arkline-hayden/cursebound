import path from 'node:path';
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { Authority } from './authority';
import { createLog } from './log';
import { SecureStore } from './secureStore';
import { initUpdates, type Updates } from './updates';
import { loadWindowState } from './windowState';

// CURSEBOUND desktop shell (docs/contracts/ONLINE_CONTRACT.md "Desktop app"). Starts the local authority in a
// utilityProcess, loads the static client it serves from http://127.0.0.1:<port>/, keeps that window on the local
// origin, restarts the authority if it crashes, and stops it cleanly (pending saves flushed) before quitting.

/** Cloud base URL baked in at build time from env CLOUD_URL (scripts/bundle.mjs); empty = local accounts only. */
declare const __CLOUD_URL__: string;

// isolated profile for tests and side-by-side runs; unpackaged dev shells never touch the installed app's data
if (process.env.CURSEBOUND_USER_DATA) app.setPath('userData', path.resolve(process.env.CURSEBOUND_USER_DATA));
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'CURSEBOUND-dev'));

const userData = app.getPath('userData');
const { log, file: logFile } = createLog(path.join(userData, 'logs'), !app.isPackaged);
const resources = app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), 'build');
const cloudUrl = ((!app.isPackaged && process.env.CURSEBOUND_CLOUD_URL) || __CLOUD_URL__ || '').replace(/\/+$/, '');
/** log every renderer console line (CURSEBOUND_LOG_RENDERER=1), not just warnings and errors */
const logAllConsole = process.env.CURSEBOUND_LOG_RENDERER === '1';
/** longest the launch waits for the update check before showing the title menu */
const FIRST_CHECK_WAIT_MS = 4000;

let win: BrowserWindow | null = null;
let origin = '';
let quitting = false;
let updates: Updates = { pending: () => null, install: () => {}, firstCheck: Promise.resolve('none'), manual: false };
const secure = new SecureStore(path.join(userData, 'secure-store.json'));
const crashes: number[] = [];

const authority = new Authority({
  entry: path.join(resources, 'server', 'server.mjs'),
  dataDir: path.join(userData, 'data'),
  staticDir: app.isPackaged ? path.join(resources, 'client') : path.resolve(app.getAppPath(), '..', 'client', 'out'),
  cloudUrl,
  portFile: path.join(userData, 'authority-port.json'),
  log,
  onCrash: (code) => { if (!quitting) void restartAuthority(code); },
});

/** Bring the authority back after a crash and point the window at it again (its port is remembered, so usually same). */
async function restartAuthority(code: number): Promise<void> {
  const now = Date.now();
  crashes.push(now);
  while (crashes.length && now - crashes[0] > 120_000) crashes.shift();
  if (crashes.length > 5) {
    log(`[shell] authority crashed ${crashes.length} times in 2 minutes (last code ${code}); giving up`);
    dialog.showErrorBox('CURSEBOUND', `The game server keeps stopping unexpectedly.\n\nDetails are in:\n${logFile}`);
    quitting = true;
    app.quit();
    return;
  }
  log(`[shell] restarting the authority after a crash (code ${code})`);
  await new Promise((r) => setTimeout(r, 500 * crashes.length));
  try {
    const port = await authority.start();
    origin = `http://127.0.0.1:${port}`;
    if (win && !win.isDestroyed()) await win.loadURL(`${origin}/`);
  } catch (err) {
    log(`[shell] authority restart failed: ${(err as Error).message}`);
    void restartAuthority(-1);
  }
}

function isLocal(url: string): boolean {
  try { return !!origin && new URL(url).origin === origin; } catch { return false; }
}

function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') void shell.openExternal(u.href);
  } catch { /* not a URL */ }
}

/** IPC is only honoured from the local game page (never from an external page that somehow loaded). */
function fromGame(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  return isLocal(e.senderFrame?.url ?? '');
}

function registerIpc(): void {
  ipcMain.handle('cursebound:secure-get', (e, key: unknown) => {
    if (!fromGame(e) || !SecureStore.validKey(key)) return null;
    return secure.get(key);
  });
  ipcMain.handle('cursebound:secure-set', (e, key: unknown, value: unknown) => {
    if (!fromGame(e) || !SecureStore.validKey(key) || !SecureStore.validValue(value)) throw new Error('rejected');
    secure.set(key, value);
  });
  ipcMain.handle('cursebound:secure-del', (e, key: unknown) => {
    if (!fromGame(e) || !SecureStore.validKey(key)) throw new Error('rejected');
    secure.del(key);
  });
  ipcMain.handle('cursebound:update-pending', (e) => (fromGame(e) ? updates.pending() : null));
  ipcMain.on('cursebound:update-install', (e) => {
    if (!fromGame(e) || !updates.pending()) return;
    // macOS: opens the download page; the game keeps running
    if (updates.manual) { log('[shell] opening the download page for the update'); updates.install(); return; }
    log('[shell] installing update on request');
    quitting = true;
    // flush the authority first: the installer replaces its files
    void authority.stop().then(() => updates.install());
  });
}

function hardenContents(contents: WebContents): void {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url)) openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (isLocal(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  contents.on('will-redirect', (e, url) => { if (!isLocal(url)) e.preventDefault(); });
  // a game has no back / forward: the mouse side buttons (Mouse 4 / 5) are bindable game buttons and must never step
  // the window's history out of a menu or a run. The page cancels them (client lib/mouseGuard.ts); the history is
  // also kept empty so nothing that slips past (a gesture, a missed event) has anywhere to go.
  const forget = () => { if (!contents.isDestroyed()) contents.navigationHistory.clear(); };
  contents.on('did-navigate', forget);
  contents.on('did-navigate-in-page', forget);
}

function createWindow(): BrowserWindow {
  const state = loadWindowState(path.join(userData, 'window-state.json'));
  const w = new BrowserWindow({
    ...state.bounds,
    minWidth: state.minWidth,
    minHeight: state.minHeight,
    show: false,
    title: 'CURSEBOUND',
    backgroundColor: '#050404',
    autoHideMenuBar: true,
    icon: app.isPackaged ? undefined : path.join(resources, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // a game: keep simulating and rendering while another window has focus
      backgroundThrottling: false,
      additionalArguments: [`--cursebound-version=${app.getVersion()}`],
    },
  });
  w.setMenuBarVisibility(false);
  // Windows / Linux send the mouse back / forward buttons as app commands too: swallowed (game buttons, not navigation)
  w.on('app-command', (e, cmd) => { if (cmd === 'browser-backward' || cmd === 'browser-forward') e.preventDefault(); });
  if (state.maximized) w.maximize();
  state.track(w);
  w.once('ready-to-show', () => w.show());
  w.webContents.on('console-message', (details) => {
    const { level, message, lineNumber, sourceId } = details;
    if (logAllConsole || level === 'warning' || level === 'error') log(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`);
  });
  w.webContents.on('did-fail-load', (_e, code, desc, url) => log(`[shell] page failed to load ${url}: ${code} ${desc}`));
  w.webContents.on('render-process-gone', (_e, d) => {
    log(`[shell] renderer gone: ${d.reason} (${d.exitCode})`);
    if (!quitting && d.reason !== 'clean-exit' && !w.isDestroyed()) void w.loadURL(`${origin}/`);
  });
  w.on('closed', () => { win = null; });
  return w;
}

async function boot(): Promise<void> {
  // no menu bar on Windows/Linux; macOS keeps the standard app + edit menus (Quit, copy/paste shortcuts)
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null);
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission) && isLocal(wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed.has(permission) && requestingOrigin === origin);
  registerIpc();
  log(`[shell] CURSEBOUND ${app.getVersion()} (electron ${process.versions.electron}, node ${process.versions.node}) userData=${userData}`);
  let port: number;
  try {
    port = await authority.start();
  } catch (err) {
    log(`[shell] authority failed to start: ${(err as Error).message}`);
    dialog.showErrorBox('CURSEBOUND', `The game server could not start.\n\nDetails are in:\n${logFile}`);
    quitting = true;
    app.quit();
    return;
  }
  origin = `http://127.0.0.1:${port}`;
  log(`[shell] authority ready at ${origin}`);
  // co-op needs matching builds: learn about a newer build before the title menu loads (bounded, so an offline
  // launch is not held up); its download then runs in the background and the page shows "Restart to update"
  updates = initUpdates(log, (version) => {
    for (const w of BrowserWindow.getAllWindows()) if (isLocal(w.webContents.getURL())) w.webContents.send('cursebound:update-ready', version);
  }, cloudUrl ? `${cloudUrl}/` : '');
  const first = await Promise.race([updates.firstCheck, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), FIRST_CHECK_WAIT_MS))]);
  if (first !== 'none') log(`[shell] launch update check: ${first}`);
  win = createWindow();
  await win.loadURL(`${origin}/`);
}

if (!app.requestSingleInstanceLock()) {
  // a second launch just focuses the running game (one authority per data directory)
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('web-contents-created', (_e, contents) => hardenContents(contents));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (e) => {
    quitting = true;
    if (!authority.running) return;
    // hold the quit until the authority has flushed its pending transactions
    e.preventDefault();
    log('[shell] stopping the authority');
    void authority.stop().then(() => app.quit());
  });
  app.whenReady().then(boot, (err: Error) => log(`[shell] startup failed: ${err.message}`));
}
