import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Log } from './log';

// The local authority (apps/server, bundled) in an Electron utilityProcess (docs/contracts/ONLINE_CONTRACT.md
// "Desktop app"). It reports its port as one JSON line on stdout and shuts down cleanly on a `shutdown` message.
//
// Port choice: the first launch asks for a random free port (CURSEBOUND_PORT=0) and remembers it; later launches ask
// for the same port again and fall back to a fresh random one only when it is taken. The page origin is
// http://127.0.0.1:<port>, and localStorage (local profile ids, settings) is scoped to that origin, so a stable port
// keeps a player's local data across launches.

const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 8_000;

export interface AuthorityOptions {
  /** bundled server entry (build/server/server.mjs) */
  entry: string;
  dataDir: string;
  staticDir: string;
  cloudUrl: string;
  /** remembered port file (<userData>/authority-port.json) */
  portFile: string;
  log: Log;
  /** the authority died after it was up (not during a requested stop) */
  onCrash: (code: number) => void;
}

export class Authority {
  private child: UtilityProcess | null = null;
  private stopping: Promise<void> | null = null;
  port = 0;

  constructor(private readonly opts: AuthorityOptions) {}

  get running(): boolean { return this.child !== null; }

  private rememberedPort(): number {
    try {
      const p = Number((JSON.parse(fs.readFileSync(this.opts.portFile, 'utf8')) as { port?: unknown }).port);
      return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 0;
    } catch { return 0; }
  }

  private rememberPort(port: number): void {
    try { fs.writeFileSync(this.opts.portFile, JSON.stringify({ port })); } catch { /* next launch picks a new port */ }
  }

  /** Start (or restart) the authority; resolves with the port it listens on. */
  async start(): Promise<number> {
    const preferred = this.rememberedPort();
    if (preferred) {
      try { return await this.spawn(preferred); } catch (err) {
        this.opts.log(`[shell] authority could not use port ${preferred} (${(err as Error).message}); picking a new one`);
      }
    }
    const port = await this.spawn(0);
    this.rememberPort(port);
    return port;
  }

  private spawn(port: number): Promise<number> {
    const { entry, dataDir, staticDir, cloudUrl, log } = this.opts;
    fs.mkdirSync(dataDir, { recursive: true });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ELECTRON_')) env[k] = v;
    Object.assign(env, {
      CURSEBOUND_PORT: String(port),
      CURSEBOUND_DATA_DIR: dataDir,
      CURSEBOUND_STATIC_DIR: staticDir,
      CURSEBOUND_CLOUD_URL: cloudUrl,
      NODE_ENV: 'production',
    });
    const child = utilityProcess.fork(entry, [], { env, stdio: ['ignore', 'pipe', 'pipe'], serviceName: 'CURSEBOUND authority', cwd: path.dirname(entry) });
    this.child = child;
    return new Promise<number>((resolve, reject) => {
      let ready = false;
      let buf = '';
      const timer = setTimeout(() => {
        if (ready) return;
        log('[shell] authority did not report a port in time; killing it');
        child.kill();
        reject(new Error('timed out waiting for the authority'));
      }, READY_TIMEOUT_MS);
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (d: string) => {
        buf += d;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          log(`[authority] ${line}`);
          if (!ready && line.startsWith('{')) {
            try {
              const j = JSON.parse(line) as { event?: string; port?: number };
              if (j.event === 'listening' && typeof j.port === 'number') {
                ready = true;
                clearTimeout(timer);
                this.port = j.port;
                resolve(j.port);
              }
            } catch { /* not the port line */ }
          }
        }
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (d: string) => { for (const l of d.split('\n')) if (l.trim()) log(`[authority:err] ${l.trimEnd()}`); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        log(`[shell] authority exited (code ${code})`);
        if (!ready) reject(new Error(`exited with code ${code} before listening`));
        else if (!this.stopping) this.opts.onCrash(code);
      });
    });
  }

  /** Request a clean shutdown (pending saves flushed), escalating to kill after a grace period. Idempotent. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t); this.stopping = null; resolve(); };
      const t = setTimeout(() => {
        this.opts.log('[shell] authority did not stop in time; killing it');
        child.kill();
      }, STOP_TIMEOUT_MS);
      child.once('exit', done);
      try { child.postMessage('shutdown'); } catch { child.kill(); }
    });
    return this.stopping;
  }
}
