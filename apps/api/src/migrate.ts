import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { type Db, createDb, tx } from './db.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Lock key for migrations: several API instances may start at once, and only one may migrate. */
const LOCK = 7_031_120_261;

/** Apply every migrations/*.sql file not applied yet, in name order. Returns the names applied. */
export async function migrate(db: Db): Promise<string[]> {
  const lock = await db.connect();
  try {
    // waits while another instance migrates, then sees what it applied
    await lock.query('select pg_advisory_lock($1)', [LOCK]);
    await lock.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await lock.query<{ name: string }>('select name from schema_migrations')).rows.map(r => r.name));
    const files = (await readdir(DIR)).filter(f => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(DIR, f), 'utf8');
      await tx(db, async c => {
        await c.query(sql);
        await c.query('insert into schema_migrations (name) values ($1)', [f]);
      });
      applied.push(f);
    }
    return applied;
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    lock.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDb(loadConfig().databaseUrl);
  migrate(db)
    .then(a => console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database is up to date.'))
    .finally(() => db.end());
}
