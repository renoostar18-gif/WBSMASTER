import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { INVOICE_CSP, type InvoiceRow, renderInvoice } from '../src/billing.js';
import { privateAddress, publicFetch } from '../src/netguard.js';
import { RateLimiter } from '../src/ratelimit.js';
import { Sealer } from '../src/secrets.js';
import { SsoClients } from '../src/sso.js';
import { checkWebhookUrl } from '../src/webhooks.js';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp({ loginFailureLimit: 3 }); });
afterAll(async () => { await t.close(); });

describe('security headers', () => {
  it('sends a content security policy and the usual headers, without HSTS over plain http', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['content-security-policy']).toContain("script-src 'self';");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(r.headers['strict-transport-security']).toBeUndefined();
    const docs = await t.app.inject({ method: 'GET', url: '/api/docs' });
    expect(docs.headers['content-security-policy']).toContain('https://fonts.googleapis.com');
    expect(docs.body).not.toMatch(/<script|\son[a-z]+=/i);
  });

  it('sends HSTS when the site is served over HTTPS', async () => {
    const s = await startApp({ secureCookies: true });
    try {
      expect((await s.app.inject({ method: 'GET', url: '/api/health' })).headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    } finally { await s.close(); }
  });

  it('prints invoices with no inline event handlers; their one script is allowed by its hash', async () => {
    const inv = {
      id: 'i', org_id: 'o', number: 1, kind: 'new', plan: 'team', interval: 'month', seats: 1, period_start: '2026-10-22', period_end: '2026-11-22',
      subtotal: 4500, vat_rate: '0', vat: 0, total: 4500, currency: 'SAR', status: 'paid', moyasar_id: 'm', pay_url: null,
      seller: { name: 'Acme', nameAr: 'أكمي', address: '', cr: null, vatNumber: null },
      buyer: { organisation: '<img src=x onerror=alert(1)>', name: null, address: null, vatNumber: null, email: null },
      created_at: new Date(), paid_at: new Date(),
    } as InvoiceRow;
    const html = await renderInvoice(inv);
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const script = /<script>([^<]*)<\/script>/.exec(html)![1]!;
    expect(INVOICE_CSP).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  });
});

describe('cross-site requests (CSRF)', () => {
  let c: Client;
  beforeAll(async () => { c = (await Client.signUp(t.app, 'Csrf')).client; });
  const post = (url: string, headers: Record<string, string>, payload = '{}', type = 'application/json') =>
    t.app.inject({ method: 'POST', url, payload, headers: { cookie: c.cookie, 'content-type': type, ...headers } });

  it('refuses changes sent by a page of another site', async () => {
    for (const h of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'null' }] as Record<string, string>[]) {
      const r = await post('/api/orgs', h, '{"name":"x"}');
      expect(r.statusCode, JSON.stringify(h)).toBe(403);
      expect(JSON.parse(r.body).error).toBe('cross_site_request');
    }
    // a form posting text/plain: refused before anything happens, and the session still works
    expect((await post('/api/auth/logout', { origin: 'https://evil.example' }, 'x=1', 'text/plain')).statusCode).toBe(403);
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('accepts the app\'s own pages, programs without browser headers, and Moyasar\'s notices', async () => {
    expect((await post('/api/orgs', { origin: 'https://app.example', 'sec-fetch-site': 'same-origin' }, '{"name":"Mine"}')).statusCode).toBe(201);
    expect((await post('/api/orgs', { origin: 'http://localhost:3301', host: 'localhost:3301' }, '{"name":"Same host"}')).statusCode).toBe(201);
    expect((await post('/api/orgs', {}, '{"name":"Script"}')).statusCode).toBe(201);
    const notice = await t.app.inject({ method: 'POST', url: '/api/billing/moyasar/notify', payload: {}, headers: { origin: 'https://moyasar.example' } });
    expect(notice.statusCode).toBe(200);
  });

  it('does not open live connections for pages of another site', async () => {
    const { client, orgId } = await Client.signUp(t.app, 'LiveCsrf');
    const p = (await client.post(`/api/orgs/${orgId}/projects`, { name: 'P' })).body.id;
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as AddressInfo).port;
    const code = (origin: string) => new Promise<number>(res => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/projects/${p}/live`, { headers: { cookie: client.cookie, origin } });
      ws.on('message', () => ws.close(1000));
      ws.on('close', c => res(c));
    });
    expect(await code('https://evil.example')).toBe(4403);
    expect(await code('https://app.example')).toBe(1000);
  });
});

describe('sign-in', () => {
  it('pauses an account after repeated wrong passwords, whatever the address', async () => {
    await Client.signUp(t.app, 'Guessed');
    const login = (password: string, ip: string) => t.app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'guessed@example.com', password }, remoteAddress: ip,
    });
    for (let i = 0; i < 3; i++) expect((await login('wrong password', `10.0.0.${i}`)).statusCode).toBe(401);
    const paused = await login('correct horse battery', '10.0.0.9');
    expect(paused.statusCode).toBe(429);
    expect(Number(paused.headers['retry-after'])).toBeGreaterThan(0);
    // other accounts are not affected
    await Client.signUp(t.app, 'Other');
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'other@example.com', password: 'correct horse battery' } })).statusCode).toBe(200);
  });

  it('answers an unknown email like a wrong password', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com', password: 'whatever it is' } });
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).error).toBe('invalid_credentials');
  });

  it('counts limits without using them up when asked', () => {
    const l = new RateLimiter(2, 60_000);
    expect(l.over('k', 0)).toBeNull();
    l.hit('k', 0); l.hit('k', 0);
    expect(l.over('k', 1000)).toBe(59);
    expect(l.over('k', 60_000)).toBeNull();
  });
});

describe('API keys', () => {
  it('see only their own organisation in /me and in notifications', async () => {
    const { client: owner, orgId } = await Client.signUp(t.app, 'KeyOwner', { organisation: 'Keyed' });
    await t.db.query("update organisations set plan = 'team' where id = $1", [orgId]);
    const other = (await owner.post('/api/orgs', { name: 'Private org' })).body.id as string;
    const { client: mate } = await Client.signUp(t.app, 'KeyMate');
    await owner.post(`/api/orgs/${other}/members`, { email: 'keymate@example.com', role: 'member' });
    const secret = (await owner.post(`/api/orgs/${other}/projects`, { name: 'Secret project' })).body.id as string;
    const meId = (await owner.get('/api/me')).body.user.id as string;
    await owner.put(`/api/projects/${secret}/members/${(await mate.get('/api/me')).body.user.id}`, { role: 'commenter' });
    await mate.post(`/api/projects/${secret}/comments`, { body: 'confidential', mentions: [meId] });
    expect((await owner.get('/api/notifications')).body.notifications.length).toBeGreaterThan(0);

    const { key } = (await owner.post('/api/me/api-keys', { name: 'k', orgId, scope: 'write' })).body;
    const asKey = async (method: 'GET' | 'POST', url: string, payload?: object) =>
      JSON.parse((await t.app.inject({ method, url, payload, headers: { authorization: `Bearer ${key}` } })).body);
    const me = await asKey('GET', '/api/me');
    expect(me.organisations.map((o: { id: string }) => o.id)).toEqual([orgId]);
    const n = await asKey('GET', '/api/notifications');
    expect(n.notifications).toEqual([]);
    expect(n.unread).toBe(0);
    expect((await asKey('GET', '/api/notifications/unread')).unread).toBe(0);
    await asKey('POST', '/api/notifications/read', {});
    expect((await owner.get('/api/notifications/unread')).body.unread).toBeGreaterThan(0);
  });
});

describe('outgoing requests only reach public addresses (SSRF)', () => {
  it('knows private addresses, IPv4 hidden in IPv6 included', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.16.0.1', '100.64.0.1', '0.0.0.0', '192.0.2.1', '224.0.0.1',
      '::', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::', '2001::1', '2001:db8::1', 'not-an-address']) {
      expect(privateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::']) {
      expect(privateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses webhook addresses that are private written as IPv6', async () => {
    for (const url of ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:169.254.169.254]/x', 'https://[::1]/', 'https://localhost/', 'https://2130706433/']) {
      expect(await checkWebhookUrl(url, false), url).toBe('webhook_private_address');
    }
  });

  it('refuses to connect to a private address, even when the name resolves there only at connection time', async () => {
    const server = createServer((_req, res) => res.end('{}'));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(publicFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/non-public/);
      await expect(publicFetch(`http://localhost:${port}/`)).rejects.toThrow(/non-public/);
      // allowed to private addresses (development): the same server answers
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
      // SSO discovery outside development cannot reach the hosting network either
      const sealer = new Sealer('x'.repeat(32));
      const clients = new SsoClients(sealer, true, false);
      await expect(clients.check(`http://127.0.0.1:${port}`, 'id', sealer.seal('s'))).rejects.toMatchObject({ code: 'sso_provider_unreachable' });
    } finally {
      server.close();
    }
  });
});
