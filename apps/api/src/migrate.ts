import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { type Db, createDb, tx } from './db.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Apply every migrations/*.sql file not applied yet, in name order. Returns the names applied. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map(r => r.name));
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDb(loadConfig().databaseUrl);
  migrate(db)
    .then(a => console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database is up to date.'))
    .finally(() => db.end());
}
