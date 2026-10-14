// A tiny SQL seam over two Postgres drivers: `pg` (Cloud SQL in production) and PGlite (Postgres compiled to WASM,
// used by tests and the no-cloud dev server). Both speak the same SQL, so the store is written once.

export type Row = Record<string, unknown>;

export interface Sql {
  /** one statement with $1… parameters */
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  /** several statements, no parameters (migrations) */
  exec(text: string): Promise<void>;
  /** run `fn` in one transaction (BEGIN … COMMIT, ROLLBACK on throw); nested calls join the outer transaction */
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Connect a `pg` pool. `DATABASE_URL` may point at a Cloud SQL unix socket: `postgres://u:p@/db?host=/cloudsql/P:R:I`. */
export async function connectPg(connectionString: string, opts: { max?: number } = {}): Promise<Sql> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  // an idle client erroring (e.g. Cloud SQL maintenance) must not crash the process; the pool replaces it
  pool.on('error', () => undefined);
  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }, inTx: boolean): Sql => {
    const self: Sql = {
      query: async <R extends Row>(text: string, params?: unknown[]) => {
        const r = await c.query(text, params);
        return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
      },
      exec: async (text) => { await c.query(text); },
      tx: async (fn) => {
        if (inTx) return fn(self);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(wrap(client, true));
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      },
      close: async () => { if (!inTx) await pool.end(); },
    };
    return self;
  };
  return wrap(pool, false);
}

/** Open PGlite in memory (no dir) or persisted to `dataDir`. Dev/test only; the production image never loads it. */
export async function openPglite(dataDir?: string): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>; exec: (t: string) => Promise<unknown> };
  const wrap = (c: Q, inTx: boolean): Sql => {
    const self: Sql = {
      query: async <R extends Row>(text: string, params?: unknown[]) => {
        const r = await c.query(text, params);
        return { rows: r.rows as R[], rowCount: r.affectedRows ?? r.rows.length };
      },
      exec: async (text) => { await c.exec(text); },
      tx: (fn) => (inTx ? fn(self) : db.transaction((t) => fn(wrap(t as unknown as Q, true)))),
      close: async () => { if (!inTx) await db.close(); },
    };
    return self;
  };
  return wrap(db as unknown as Q, false);
}
