/**
 * Structured JSON-lines local logger (REQ TEL01, PRD §23.1/§23.3).
 *
 * - Writes `<dataDir>/logs/cursebound-YYYYMMDD.log` (UTC day; `-N` suffix when a day's file exceeds the per-file cap).
 * - Rolling total cap (default 100 MB): oldest log files are deleted first; the active file is never deleted.
 * - Line shape: `{ts, level, build, runId?, event, phase?, ...bounded fields}`.
 * - Redacts token/seatToken/secret/password-like keys; drops IP-address fields and scrubs IP literals.
 * - Asynchronous append stream so the room-authority thread never blocks on log I/O.
 */
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, type WriteStream } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  dataDir: string;
  build?: string;
  minLevel?: LogLevel;
  /** Rolling total cap in bytes across all log files (default 100 MB). */
  maxTotalBytes?: number;
  /** Per-file cap before rolling to a `-N` file the same day (default maxTotalBytes / 10). */
  maxFileBytes?: number;
  /** Also echo lines to stdout/stderr (default false). */
  echo?: boolean;
}

export type LogFields = Record<string, unknown> & { runId?: string; phase?: string };

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Logger with fields bound into every line (e.g. `{ runId }`). */
  child(bound: LogFields): Logger;
  /** Flush and close the file stream. */
  close(): Promise<void>;
}

const REDACT_KEY_RE = /token|secret|password|passwd|authorization|cookie|api[-_]?key/i;
const IP_KEY_RE = /^(ip|ips|ipaddress|ip_address|remoteaddress|remote_address|remoteip|x-forwarded-for|xforwardedfor|forwardedfor|clientip)$/i;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{0,4}(?::[0-9a-f]{1,4}){0,5}\b|::ffff:|(?<![\w:])::1\b/gi;
const MAX_STRING = 512;
const MAX_KEYS = 32;
const MAX_ARRAY = 20;
const MAX_DEPTH = 3;
const RESERVED = new Set(['ts', 'level', 'build', 'event']);

function scrubString(s: string): string {
  let out = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  out = out.replace(IPV4_RE, '[ip]');
  out = out.replace(IPV6_RE, '[ip]');
  return out;
}

function bound(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message), code: (value as { code?: unknown }).code ?? undefined };
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => bound(v, depth + 1));
    if (value.length > MAX_ARRAY) arr.push(`[+${value.length - MAX_ARRAY} more]`);
    return arr;
  }
  if (typeof value === 'object') return boundObject(value as Record<string, unknown>, depth + 1);
  return String(value);
}

function boundObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (IP_KEY_RE.test(k)) continue;
    if (n++ >= MAX_KEYS) {
      out['_truncatedKeys'] = true;
      break;
    }
    out[k] = REDACT_KEY_RE.test(k) ? '[redacted]' : bound(v, depth);
  }
  return out;
}

/** Exposed for tests: the sanitised object that would be written for `fields`. */
export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return boundObject(fields, 0);
}

function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

const LOG_FILE_RE = /^cursebound-(\d{8})(?:-(\d+))?\.log$/;

class FileSink {
  private stream: WriteStream | null = null;
  private currentName = '';
  private currentBytes = 0;
  private bytesSinceSweep = 0;
  private readonly sweepEvery: number;

  constructor(
    private readonly dir: string,
    private readonly maxTotal: number,
    private readonly maxFile: number,
  ) {
    mkdirSync(dir, { recursive: true });
    this.sweepEvery = Math.max(64 * 1024, Math.floor(maxFile / 4));
  }

  private listLogs(): { name: string; day: string; part: number; size: number }[] {
    const out: { name: string; day: string; part: number; size: number }[] = [];
    for (const name of readdirSync(this.dir)) {
      const m = LOG_FILE_RE.exec(name);
      if (!m) continue;
      let size = 0;
      try {
        size = statSync(path.join(this.dir, name)).size;
      } catch {
        continue;
      }
      out.push({ name, day: m[1]!, part: m[2] ? Number(m[2]) : 0, size });
    }
    out.sort((a, b) => (a.day === b.day ? a.part - b.part : a.day < b.day ? -1 : 1));
    return out;
  }

  /** Delete oldest files until the total is within the cap (never the active file). */
  sweep(): void {
    this.bytesSinceSweep = 0;
    const files = this.listLogs();
    let total = files.reduce((s, f) => s + (f.name === this.currentName ? Math.max(f.size, this.currentBytes) : f.size), 0);
    for (const f of files) {
      if (total <= this.maxTotal) break;
      if (f.name === this.currentName) continue;
      try {
        rmSync(path.join(this.dir, f.name), { force: true });
        total -= f.size;
      } catch {
        // ignore; retry next sweep
      }
    }
  }

  private open(nowMs: number): void {
    const day = utcDay(nowMs);
    const existing = this.listLogs().filter((f) => f.day === day);
    let part = existing.length ? existing[existing.length - 1]!.part : 0;
    let size = existing.length ? existing[existing.length - 1]!.size : 0;
    if (size >= this.maxFile) {
      part += 1;
      size = 0;
    }
    const name = part === 0 ? `cursebound-${day}.log` : `cursebound-${day}-${part}.log`;
    this.stream?.end();
    this.stream = createWriteStream(path.join(this.dir, name), { flags: 'a' });
    this.stream.on('error', () => {
      // logging must never crash the server
    });
    this.currentName = name;
    this.currentBytes = size;
    this.sweep();
  }

  write(line: string, nowMs: number): void {
    const day = utcDay(nowMs);
    if (!this.stream || !this.currentName.startsWith(`cursebound-${day}`) || this.currentBytes >= this.maxFile) this.open(nowMs);
    const bytes = Buffer.byteLength(line);
    this.stream!.write(line);
    this.currentBytes += bytes;
    this.bytesSinceSweep += bytes;
    if (this.bytesSinceSweep >= this.sweepEvery) this.sweep();
  }

  close(): Promise<void> {
    const s = this.stream;
    this.stream = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => s.end(() => resolve()));
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  const maxTotal = opts.maxTotalBytes ?? 100 * 1024 * 1024;
  const maxFile = opts.maxFileBytes ?? Math.max(1024, Math.floor(maxTotal / 10));
  const sink = new FileSink(path.join(path.resolve(opts.dataDir), 'logs'), maxTotal, maxFile);
  const build = opts.build ?? process.env.CURSEBOUND_BUILD_ID ?? 'dev';
  const min = LEVELS[opts.minLevel ?? 'info'];

  const make = (bound0: LogFields): Logger => {
    const emit = (level: LogLevel, event: string, fields?: LogFields) => {
      if (LEVELS[level] < min) return;
      const nowMs = Date.now();
      const merged = sanitizeLogFields({ ...bound0, ...(fields ?? {}) });
      const line: Record<string, unknown> = { ts: new Date(nowMs).toISOString(), level, build, event: scrubString(String(event)).slice(0, 96) };
      if (merged.runId !== undefined) line.runId = merged.runId;
      if (merged.phase !== undefined) line.phase = merged.phase;
      for (const [k, v] of Object.entries(merged)) if (!RESERVED.has(k) && !(k in line)) line[k] = v;
      let text: string;
      try {
        text = JSON.stringify(line) + '\n';
      } catch {
        text = JSON.stringify({ ts: line.ts, level, build, event: line.event, _unserializable: true }) + '\n';
      }
      sink.write(text, nowMs);
      if (opts.echo) (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(text);
    };
    return {
      debug: (e, f) => emit('debug', e, f),
      info: (e, f) => emit('info', e, f),
      warn: (e, f) => emit('warn', e, f),
      error: (e, f) => emit('error', e, f),
      child: (b) => make({ ...bound0, ...b }),
      close: () => sink.close(),
    };
  };
  return make({});
}
