import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type Db, createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_test?host=/tmp';
/** Fixed "today" so dates in tests are stable: Thursday 22 Oct 2026. */
export const TODAY = new Date(Date.UTC(2026, 9, 22));

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close: () => Promise<void>;
}

/** A fresh, empty, migrated database and an app bound to it. */
export async function startApp(): Promise<TestApp> {
  const db = createDb(TEST_DB);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
  const app = buildApp({ db, config: { ...loadConfig(), databaseUrl: TEST_DB }, today: () => TODAY });
  await app.ready();
  return { app, db, close: async () => { await app.close(); await db.end(); } };
}

/** A signed-in user: makes requests with their session cookie. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async req(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) {
    const res = await this.app.inject({
      method, url, payload: body as object | undefined, headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const set = res.headers['set-cookie'];
    const c = Array.isArray(set) ? set[0] : set;
    if (c) this.cookie = c.split(';')[0]!;
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url);

  static async signUp(app: FastifyInstance, name: string, extra: Record<string, unknown> = {}) {
    const c = new Client(app);
    const r = await c.post('/api/auth/signup', { email: `${name.toLowerCase()}@example.com`, password: 'correct horse battery', name, ...extra });
    if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
    return { client: c, userId: r.body.user.id as string, orgId: r.body.orgId as string };
  }
}
