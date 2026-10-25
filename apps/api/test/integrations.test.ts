import { createHmac, randomUUID } from 'node:crypto';
import { type IncomingHttpHeaders, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkWebhookUrl, deliverDue } from '../src/webhooks.js';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp({ apiRateLimit: 5, authRateLimit: 1000, webhookAllowPrivate: true }); });
afterAll(async () => { await t.close(); });

/** Requests with an API key instead of a cookie. */
const withKey = (key: string) => async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
  const r = await t.app.inject({ method, url, payload: body as object | undefined, headers: { authorization: `Bearer ${key}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
};

describe('API keys', () => {
  let owner: Client, orgId: string, otherOrg: string, projectId: string;
  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'KeyOwner');
    owner = o.client; orgId = o.orgId;
    otherOrg = (await owner.post('/api/orgs', { name: 'Second org' })).body.id;
    for (const id of [orgId, otherOrg]) await t.db.query("update organisations set plan = 'team' where id = $1", [id]);
    projectId = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Keyed' })).body.id;
  });

  it('needs a plan with the API', async () => {
    const free = (await owner.post('/api/orgs', { name: 'Free org' })).body.id;
    expect((await owner.post('/api/me/api-keys', { name: 'x', orgId: free, scope: 'read' })).body.error).toBe('plan_api');
  });

  it('acts as its owner, in its organisation only, and shows the full key once', async () => {
    const r = await owner.post('/api/me/api-keys', { name: 'Portfolio Command Center', orgId, scope: 'write' });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^wbsm_[0-9a-f]{12}_[A-Za-z0-9_-]{32}$/);
    const list = (await owner.get('/api/me/api-keys')).body.keys;
    expect(list[0]).toMatchObject({ name: 'Portfolio Command Center', prefix: r.body.prefix, scope: 'write', orgName: 'KeyOwner\'s workspace' });
    expect(JSON.stringify(list)).not.toContain(r.body.key);
    const api = withKey(r.body.key);
    expect((await api('GET', `/api/projects/${projectId}`)).status).toBe(200);
    expect((await api('POST', `/api/projects/${projectId}/ops`, { ops: [{ op: 'add', parentId: null, values: { name: 'From the API' } }] })).status).toBe(200);
    expect((await api('GET', `/api/orgs/${otherOrg}/projects`)).status).toBe(404);
    expect((await api('GET', '/api/me')).body.user.name).toBe('KeyOwner');
  });

  it('cannot make keys, sign in, or change the account', async () => {
    const { key } = (await owner.post('/api/me/api-keys', { name: 'k', orgId, scope: 'write' })).body;
    const api = withKey(key);
    expect((await api('GET', '/api/me/api-keys')).body.error).toBe('not_with_api_key');
    expect((await api('POST', '/api/me/api-keys', { name: 'k2', orgId, scope: 'write' })).body.error).toBe('not_with_api_key');
    expect((await api('PATCH', '/api/me', { name: 'Hacker' })).body.error).toBe('not_with_api_key');
    expect((await api('POST', '/api/orgs', { name: 'x' })).body.error).toBe('not_with_api_key');
  });

  it('read-only keys can only read', async () => {
    const { key } = (await owner.post('/api/me/api-keys', { name: 'reader', orgId, scope: 'read' })).body;
    const api = withKey(key);
    expect((await api('GET', `/api/projects/${projectId}`)).status).toBe(200);
    expect((await api('POST', `/api/projects/${projectId}/ops`, { ops: [] })).body.error).toBe('key_read_only');
  });

  it('rejects wrong and revoked keys, and stops working when the plan no longer includes the API', async () => {
    expect((await withKey('wbsm_000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')('GET', '/api/me')).body.error).toBe('invalid_api_key');
    const made = (await owner.post('/api/me/api-keys', { name: 'temp', orgId, scope: 'read' })).body;
    // same prefix, different secret
    expect((await withKey(made.key.slice(0, -1) + (made.key.endsWith('A') ? 'B' : 'A'))('GET', '/api/me')).status).toBe(401);
    expect((await owner.del(`/api/me/api-keys/${made.id}`)).status).toBe(200);
    expect((await withKey(made.key)('GET', '/api/me')).status).toBe(401);
    const live = (await owner.post('/api/me/api-keys', { name: 'downgrade', orgId, scope: 'read' })).body.key;
    await t.db.query("update organisations set plan = 'free' where id = $1", [orgId]);
    expect((await withKey(live)('GET', `/api/projects/${projectId}`)).body.error).toBe('plan_api');
    await t.db.query("update organisations set plan = 'team' where id = $1", [orgId]);
  });

  it('limits requests per key', async () => {
    const api = withKey((await owner.post('/api/me/api-keys', { name: 'busy', orgId, scope: 'read' })).body.key);
    const codes: number[] = [];
    for (let k = 0; k < 6; k++) codes.push((await api('GET', '/api/me')).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const r = await api('GET', '/api/me');
    expect(r.body.error).toBe('rate_limited');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('describes itself with OpenAPI', async () => {
    const r = await new Client(t.app).get('/api/openapi.json');
    expect(r.body.openapi).toBe('3.1.0');
    expect(Object.keys(r.body.paths)).toContain('/projects/{projectId}/ops');
  });
});

describe('sign-in rate limit', () => {
  it('slows down password guessing from one address', async () => {
    const s = await startApp({ authRateLimit: 3 });
    try {
      const c = new Client(s.app);
      const codes: number[] = [];
      for (let k = 0; k < 4; k++) codes.push((await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong password' })).status);
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await s.close();
      t = await startApp({ apiRateLimit: 5, authRateLimit: 1000, webhookAllowPrivate: true });
    }
  });
});

describe('webhooks', () => {
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  let failNext = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = failNext-- > 0 ? 500 : 204;
      res.end();
    });
  });
  let url = '', owner: Client, member: Client, orgId: string;

  beforeAll(async () => {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    const o = await Client.signUp(t.app, 'HookOwner');
    owner = o.client; orgId = o.orgId;
    await t.db.query("update organisations set plan = 'team' where id = $1", [orgId]);
    const m = await Client.signUp(t.app, 'HookMember');
    member = m.client;
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'hookmember@example.com', role: 'member' });
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  const deliver = () => deliverDue(t.db, { allowPrivate: true });
  const events = () => received.map(r => JSON.parse(r.body).event as string);

  it('only organisation admins manage webhooks', async () => {
    expect((await member.get(`/api/orgs/${orgId}/webhooks`)).status).toBe(403);
  });

  it('signs and delivers subscribed events', async () => {
    const r = await owner.post(`/api/orgs/${orgId}/webhooks`, { url, events: ['project.created', 'item.changed', 'health.changed', 'baseline.saved'] });
    expect(r.status).toBe(201);
    const secret: string = r.body.secret;
    const projectId = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Hooked' })).body.id;
    const item = randomUUID();
    // today is Thu 22 Oct 2026: planned 25 Oct–5 Nov, then the forecast slips 3 weeks
    await owner.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'add', id: item, parentId: null, values: { name: 'Busbar', plannedStart: '2026-10-25', plannedFinish: '2026-11-05' } }] });
    await owner.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'set', id: item, field: 'forecastFinish', value: '2026-11-26' }] });
    await owner.post(`/api/projects/${projectId}/baselines`, { name: 'Re-plan', reason: 'CR-7' });
    expect(await deliver()).toBeGreaterThan(0);
    expect(events()).toEqual(expect.arrayContaining(['project.created', 'item.changed', 'health.changed', 'baseline.saved']));

    const first = received[0]!;
    const sig = String(first.headers['x-wbs-signature']);
    const [, ts, mac] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(createHmac('sha256', secret).update(`${ts}.${first.body}`).digest('hex')).toBe(mac);
    expect(first.headers['x-wbs-event']).toBe('project.created');

    const added = received.map(x => JSON.parse(x.body)).find(x => x.event === 'item.changed' && x.data.added.length);
    expect(added.data.added[0]).toMatchObject({ id: item, name: 'Busbar', code: '1', health: 'green' });
    const health = received.map(x => JSON.parse(x.body)).find(x => x.event === 'health.changed' && x.data.items.some((i: { to: string }) => i.to === 'red'));
    expect(health.data.items).toEqual([{ id: item, code: '1', name: 'Busbar', from: 'green', to: 'red' }]);
    expect(health.data.project).toMatchObject({ name: 'Hooked', to: 'red' });
  });

  it('sends only the events a webhook subscribes to', async () => {
    received.length = 0;
    await owner.post(`/api/orgs/${orgId}/webhooks`, { url: `${url}?only=projects`, events: ['project.created'] });
    const before = (await owner.get(`/api/orgs/${orgId}/webhooks`)).body.webhooks.length;
    expect(before).toBe(2);
    await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Second' });
    await deliver();
    expect(events()).toEqual(['project.created', 'project.created']); // one per webhook
  });

  it('retries a failed delivery later, and records what happened', async () => {
    received.length = 0;
    const hooks = (await owner.get(`/api/orgs/${orgId}/webhooks`)).body.webhooks;
    const hook = hooks.find((h: { url: string }) => h.url === url);
    failNext = 1;
    await owner.post(`/api/orgs/${orgId}/webhooks/${hook.id}/test`);
    await deliver();
    let d = (await owner.get(`/api/orgs/${orgId}/webhooks/${hook.id}/deliveries`)).body.deliveries[0];
    expect(d).toMatchObject({ event: 'ping', status: 'pending', attempts: 1, responseCode: 500, error: 'HTTP 500' });
    // not due yet: nothing is sent
    expect(await deliver()).toBe(0);
    await t.db.query("update webhook_deliveries set next_attempt_at = now() where id = $1", [d.id]);
    await deliver();
    d = (await owner.get(`/api/orgs/${orgId}/webhooks/${hook.id}/deliveries`)).body.deliveries[0];
    expect(d).toMatchObject({ status: 'delivered', attempts: 2, responseCode: 204 });
    expect(received).toHaveLength(2);
  });

  it('pauses and removes webhooks', async () => {
    const hook = (await owner.get(`/api/orgs/${orgId}/webhooks`)).body.webhooks[0];
    await owner.patch(`/api/orgs/${orgId}/webhooks/${hook.id}`, { active: false });
    received.length = 0;
    await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Third' });
    await deliver();
    expect(received).toHaveLength(1); // only the other webhook
    expect((await owner.del(`/api/orgs/${orgId}/webhooks/${hook.id}`)).status).toBe(200);
  });

  it('refuses addresses inside private networks when not in development', async () => {
    expect(await checkWebhookUrl('http://example.com/hook', false)).toBe('webhook_https_only');
    expect(await checkWebhookUrl('https://127.0.0.1/hook', false)).toBe('webhook_private_address');
    expect(await checkWebhookUrl('https://10.1.2.3/hook', false)).toBe('webhook_private_address');
    expect(await checkWebhookUrl('https://[::1]/hook', false)).toBe('webhook_private_address');
    expect(await checkWebhookUrl('https://169.254.169.254/latest/meta-data', false)).toBe('webhook_private_address');
    expect(await checkWebhookUrl('https://user:pw@example.com/', false)).toBe('webhook_bad_url');
    expect(await checkWebhookUrl('not a url', false)).toBe('webhook_bad_url');
    expect(await checkWebhookUrl('https://8.8.8.8/hook', false)).toBeNull();
  });
});
