import type { FastifyInstance } from 'fastify';
import { type AppDeps, buildApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import { type Db, createDb } from '../src/db.js';
import { LogMailer } from '../src/mailer.js';
import { migrate } from '../src/migrate.js';

/** Each app's captured emails, so sign-up can follow the confirmation link. */
const mailboxes = new WeakMap<FastifyInstance, LogMailer>();

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_test?host=/tmp';
/** Fixed "today" so dates in tests are stable: Thursday 22 Oct 2026. */
export const TODAY = new Date(Date.UTC(2026, 9, 22));

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  /** Emails the app sent. */
  mail: LogMailer;
  close: () => Promise<void>;
}

/** A fresh, empty, migrated database and an app bound to it. */
export async function startApp(config: Partial<Config> = {}, deps: Partial<AppDeps> = {}): Promise<TestApp> {
  const db = createDb(TEST_DB);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
  const mail = new LogMailer(true);
  const app = buildApp({ db, config: { ...loadConfig(), databaseUrl: TEST_DB, appUrl: 'https://app.example', authRateLimit: 1000, ...config }, today: () => TODAY, mailer: mail, ...deps });
  await app.ready();
  mailboxes.set(app, mail);
  return { app, db, mail, close: async () => { await app.close(); await db.end(); } };
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

  /**
   * Sign up, then confirm the email by following the link in the confirmation email, as a person would.
   * `{ verify: false }` leaves the address unconfirmed.
   */
  static async signUp(app: FastifyInstance, name: string, extra: Record<string, unknown> = {}, opts: { verify?: boolean } = {}) {
    const c = new Client(app);
    const email = String(extra.email ?? `${name.toLowerCase()}@example.com`);
    const r = await c.post('/api/auth/signup', { email, password: 'correct horse battery', name, ...extra });
    if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
    if (opts.verify !== false && !extra.invite) await c.post('/api/auth/verify', { token: linkToken(app, email, 'verify') });
    return { client: c, userId: r.body.user.id as string, orgId: r.body.orgId as string };
  }
}

/** Let Client.signUp read this app's emails (for apps built without startApp). */
export function trackMail(app: FastifyInstance, mail: LogMailer) {
  mailboxes.set(app, mail);
}

/** The token in the newest confirmation or reset email sent to this address. */
export function linkToken(app: FastifyInstance, email: string, kind: 'verify' | 'reset'): string {
  const mail = mailboxes.get(app);
  const m = [...(mail?.sent ?? [])].reverse().find(x => x.to.toLowerCase() === email.toLowerCase() && x.text.includes(`/${kind}/`));
  const token = m && new RegExp(`/${kind}/([A-Za-z0-9_-]+)`).exec(m.text)?.[1];
  if (!token) throw new Error(`no ${kind} email for ${email}`);
  return token;
}
