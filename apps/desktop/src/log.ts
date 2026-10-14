import fs from 'node:fs';
import path from 'node:path';

// Desktop shell log (<userData>/logs/desktop.log): shell events, the authority's stdout/stderr and renderer console
// warnings. Plain appends with one rollover at 5 MB; this is what friends send when something breaks.

const MAX_BYTES = 5 * 1024 * 1024;

export type Log = (msg: string) => void;

export function createLog(dir: string, echo: boolean): { log: Log; file: string } {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'desktop.log');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
  } catch { /* no log yet */ }
  const log: Log = (msg) => {
    const line = `${new Date().toISOString()} ${msg.replace(/\s+$/, '')}\n`;
    try { fs.appendFileSync(file, line); } catch { /* disk full or locked: logging must never crash the shell */ }
    if (echo) try { process.stdout.write(line); } catch { /* no console attached */ }
  };
  return { log, file };
}
