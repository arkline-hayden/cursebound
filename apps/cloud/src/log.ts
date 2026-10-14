// Structured JSON lines on stdout, the shape Cloud Logging parses (`severity`, `message`, `time`). Token-, secret-
// and password-like fields are redacted; errors keep name/message/stack for the log only (never for responses).

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface CloudLog {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const SECRET_KEY = /token|secret|password|authorization|cookie|credential/i;
const RANK: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function clean(v: unknown, depth = 0): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message, code: (v as { code?: unknown }).code, stack: v.stack };
  if (depth > 4 || v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : clean(x, depth + 1);
  return out;
}

export function createCloudLogger(opts: { build: string; level?: string; write?: (line: string) => void }): CloudLog {
  const min = RANK[(opts.level ?? 'info').toLowerCase()] ?? RANK.info!;
  const write = opts.write ?? ((line: string) => { process.stdout.write(line + '\n'); });
  const emit = (rank: number, severity: Severity, event: string, fields?: Record<string, unknown>) => {
    if (rank < min) return;
    const body = clean(fields ?? {}) as Record<string, unknown>;
    try { write(JSON.stringify({ severity, message: event, time: new Date().toISOString(), build: opts.build, ...body })); } catch { /* never throw from logging */ }
  };
  return {
    info: (e, f) => emit(RANK.info!, 'INFO', e, f),
    warn: (e, f) => emit(RANK.warn!, 'WARNING', e, f),
    error: (e, f) => emit(RANK.error!, 'ERROR', e, f),
  };
}
