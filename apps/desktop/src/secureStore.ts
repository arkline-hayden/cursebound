import fs from 'node:fs';
import { safeStorage } from 'electron';

// `window.cursebound.secureStore` backing (docs/contracts/ONLINE_CONTRACT.md "Desktop app"): small secrets such as the
// online-mode bearer token, encrypted with the OS keychain via Electron safeStorage (DPAPI on Windows, Keychain on
// macOS, libsecret/kwallet on Linux) and kept in <userData>/secure-store.json. Without OS encryption the values live in
// memory only, so the session lasts for this launch rather than landing on disk in plain text.

const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_VALUE = 16 * 1024;

export class SecureStore {
  private memory = new Map<string, string>();

  constructor(private readonly file: string) {}

  private encrypted(): boolean {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  private read(): Record<string, string> {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { v?: number; entries?: Record<string, string> };
      return j && j.v === 1 && j.entries && typeof j.entries === 'object' ? j.entries : {};
    } catch { return {}; }
  }

  private write(entries: Record<string, string>): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  static validKey(key: unknown): key is string {
    return typeof key === 'string' && KEY_RE.test(key);
  }

  static validValue(value: unknown): value is string {
    return typeof value === 'string' && value.length <= MAX_VALUE;
  }

  get(key: string): string | null {
    if (!this.encrypted()) return this.memory.get(key) ?? null;
    const b64 = this.read()[key];
    if (!b64) return null;
    try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch { return null; }
  }

  set(key: string, value: string): void {
    if (!this.encrypted()) { this.memory.set(key, value); return; }
    const entries = this.read();
    entries[key] = safeStorage.encryptString(value).toString('base64');
    this.write(entries);
  }

  del(key: string): void {
    this.memory.delete(key);
    const entries = this.read();
    if (!(key in entries)) return;
    delete entries[key];
    this.write(entries);
  }
}
