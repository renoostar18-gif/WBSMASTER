import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { LiveHub, PgBus } from '../src/live.js';
import { LogMailer } from '../src/mailer.js';
import { migrate } from '../src/migrate.js';
import { Client, TEST_DB, TODAY, type TestApp, startApp } from './setup.js';

/** Two API instances on one database, as on Cloud Run with more than one instance. */
let t: TestApp;
const apps: { app: ReturnType<typeof buildApp>; live: LiveHub; ws: string }[] = [];

beforeAll(async () => {
  t = await startApp();
  for (let k = 0; k < 2; k++) {
    const bus = new PgBus(TEST_DB, t.db);
    await bus.start();
    const live = new LiveHub(bus);
    const app = buildApp({ db: t.db, config: { ...loadConfig(), databaseUrl: TEST_DB }, today: () => TODAY, mailer: new LogMailer(true), live });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    apps.push({ app, live, ws: `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` });
  }
});
afterAll(async () => {
  for (const a of apps) { await a.app.close(); await a.live.close(); }
  await t.close();
});

function connect(url: string, cookie: string) {
  const ws = new WebSocket(url, { headers: { cookie } });
  const messages: { type: string; [k: string]: unknown }[] = [];
  ws.on('message', raw => messages.push(JSON.parse(String(raw))));
  const next = async (pred: (m: (typeof messages)[number]) => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = messages.find(pred);
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('no matching message');
  };
  return { ws, next, opened: new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); }) };
}

describe('several API instances', () => {
  it('apply migrations once when they start together', async () => {
    await t.db.query('drop schema public cascade; create schema public;');
    const [a, b] = await Promise.all([migrate(t.db), migrate(t.db)]);
    expect([...a, ...b].sort()).toEqual((await t.db.query<{ name: string }>('select name from schema_migrations order by name')).rows.map(r => r.name));
    expect(a.length * b.length).toBe(0); // one instance did all the work
  });

  it('share presence and changes between people on different instances', async () => {
    const o = await Client.signUp(apps[0]!.app, 'ClusterOwner');
    const e = await Client.signUp(apps[0]!.app, 'ClusterEditor');
    const projectId = (await o.client.post(`/api/orgs/${o.orgId}/projects`, { name: 'Clustered' })).body.id;
    await o.client.post(`/api/orgs/${o.orgId}/members`, { email: 'clustereditor@example.com', role: 'member' });
    await o.client.put(`/api/projects/${projectId}/members/${e.userId}`, { role: 'editor' });

    const a = connect(`${apps[0]!.ws}/api/projects/${projectId}/live`, o.client.cookie);
    const b = connect(`${apps[1]!.ws}/api/projects/${projectId}/live`, e.client.cookie);
    await Promise.all([a.opened, b.opened]);
    const both = await a.next(m => m.type === 'presence' && (m.viewers as unknown[]).length === 2);
    expect((both.viewers as { name: string }[]).map(v => v.name).sort()).toEqual(['ClusterEditor', 'ClusterOwner']);

    // the editor saves through instance B; the owner on instance A hears about it
    const ops = await apps[1]!.app.inject({
      method: 'POST', url: `/api/projects/${projectId}/ops`, headers: { cookie: e.client.cookie },
      payload: { ops: [{ op: 'add', parentId: null, values: { name: 'Saved on B' } }] },
    });
    expect(ops.statusCode).toBe(200);
    const changed = await a.next(m => m.type === 'changed');
    expect(changed).toMatchObject({ actorName: 'ClusterEditor', version: JSON.parse(ops.body).version });

    // the editor leaves instance B: the owner sees only themselves
    b.ws.close();
    await a.next(m => m.type === 'presence' && (m.viewers as unknown[]).length === 1);
    a.ws.close();
  });
});
