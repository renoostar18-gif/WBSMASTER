import pg from 'pg';

// DATE columns come back as "YYYY-MM-DD" strings, never as JS Dates shifted by a time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, v => v);
// BIGINT (project version, activity ids) fits safely in a JS number for our ranges.
pg.types.setTypeParser(pg.types.builtins.INT8, v => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = Db | Tx;

export function createDb(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

/** Run `fn` in a transaction; rolls back on any error. */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
