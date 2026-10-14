import { contextBridge, ipcRenderer } from 'electron';

// Sandboxed preload (contextIsolation on, sandbox on, nodeIntegration off). Exposes exactly the contract's bridge
// (docs/contracts/ONLINE_CONTRACT.md "Desktop app"):
//   window.cursebound = { desktop: true, version, secureStore: { get, set, del }, updates: { onReady(cb), install(), manual } }
// `updates.manual` (macOS): the update is downloaded from the download page instead of installed in place.
// Everything goes through narrow IPC channels that the main process validates (sender origin, key and value shape).

const versionArg = process.argv.find((a) => a.startsWith('--cursebound-version='));
const version = versionArg ? versionArg.slice('--cursebound-version='.length) : '';

let readyVersion: string | null = null;
const readyCallbacks = new Set<(version: string) => void>();
const announce = (v: unknown) => {
  if (typeof v !== 'string' || !v || readyVersion === v) return;
  readyVersion = v;
  readyCallbacks.forEach((cb) => { try { cb(v); } catch { /* a page callback must not break the bridge */ } });
};
ipcRenderer.on('cursebound:update-ready', (_e, v: unknown) => announce(v));
// an update may have finished downloading before this page loaded
void ipcRenderer.invoke('cursebound:update-pending').then(announce, () => {});

contextBridge.exposeInMainWorld('cursebound', {
  desktop: true,
  version,
  secureStore: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('cursebound:secure-get', String(key)),
    set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('cursebound:secure-set', String(key), String(value)),
    del: (key: string): Promise<void> => ipcRenderer.invoke('cursebound:secure-del', String(key)),
  },
  updates: {
    onReady(cb: (version: string) => void): void {
      if (typeof cb !== 'function') return;
      readyCallbacks.add(cb);
      if (readyVersion) cb(readyVersion);
    },
    install(): void { ipcRenderer.send('cursebound:update-install'); },
    manual: process.platform === 'darwin',
  },
});
