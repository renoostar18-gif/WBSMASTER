import { createHash, randomBytes } from 'node:crypto';
import { type IncomingMessage, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type TestApp, startApp } from './setup.js';

/** A small OpenID Connect provider, standing in for Entra ID or Google: signs ID tokens and checks PKCE. */
async function fakeProvider() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; clientId: string; redirect: string; claims: Record<string, unknown> }>();
  let next: Record<string, unknown> = {};
  const authorizeParams: URLSearchParams[] = [];
  const body = (req: IncomingMessage) => new Promise<string>(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => r(b)); });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      authorizeParams.push(url.searchParams);
      const code = randomBytes(8).toString('hex');
      codes.set(code, {
        nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!,
        clientId: url.searchParams.get('client_id')!, redirect: url.searchParams.get('redirect_uri')!, claims: next,
      });
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state')!);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req));
      // client_secret_basic or client_secret_post, as real providers accept
      const basic = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      const auth = basic.includes(':') ? basic : `${form.get('client_id')}:${form.get('client_secret')}`;
      const c = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const verifierOk = c && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === c.challenge;
      if (!c || !verifierOk || auth !== `${c.clientId}:s3cret` || form.get('redirect_uri') !== c.redirect) return json(400, { error: 'invalid_grant' });
      const idToken = await new SignJWT({ nonce: c.nonce, ...c.claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(base).setAudience(c.clientId).setSubject(String(c.claims.email ?? 'x'))
        .setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return json(200, { access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    json(404, {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, authorizeParams, as: (claims: Record<string, unknown>) => { next = claims; }, close: () => new Promise<void>(r => server.close(() => r())) };
}

let t: TestApp;
let idp: Awaited<ReturnType<typeof fakeProvider>>;
const dns = new Map<string, string[]>();

beforeAll(async () => {
  idp = await fakeProvider();
  t = await startApp({ ssoAllowHttp: true }, { resolveTxt: async name => dns.get(name) ?? [] });
});
afterAll(async () => { await idp.close(); await t.close(); });

/** Go through the provider like a browser would, and come back to the app. */
async function signInWithSso(email: string) {
  const browser = new Client(t.app);
  const start = await browser.post('/api/auth/sso/start', { email });
  if (start.status !== 200) return { start };
  const atProvider = await fetch(start.body.url, { redirect: 'manual' });
  const back = new URL(atProvider.headers.get('location')!);
  const res = await t.app.inject({ method: 'GET', url: back.pathname + back.search, headers: { cookie: browser.cookie } });
  const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0]!;
  return { start, status: res.statusCode, location: String(res.headers.location), cookie, url: start.body.url as string, callback: back, browserCookie: browser.cookie };
}

describe('single sign-on', () => {
  let owner: Client, orgId: string;

  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'SsoOwner', { organisation: 'Acme KSA' });
    owner = o.client; orgId = o.orgId;
  });
  const settings = (over: Record<string, unknown> = {}) =>
    ({ provider: 'oidc', issuer: idp.base, clientId: 'wbs-master', clientSecret: 's3cret', enforce: false, autoJoin: true, ...over });

  it('is part of the Business plan', async () => {
    await t.db.query("update organisations set plan = 'team' where id = $1", [orgId]);
    expect((await owner.get(`/api/orgs/${orgId}/sso`)).body.error).toBe('plan_sso');
    await t.db.query("update organisations set plan = 'business' where id = $1", [orgId]);
  });

  it('needs the organisation to prove it owns the email domain with a DNS record', async () => {
    expect((await owner.post(`/api/orgs/${orgId}/sso/domains`, { domain: 'gmail.com' })).body.error).toBe('sso_public_domain');
    const add = await owner.post(`/api/orgs/${orgId}/sso/domains`, { domain: 'Acme.SA' });
    expect(add.body.domain).toBe('acme.sa');
    expect(add.body.record).toMatch(/^wbs-master-verification=[0-9a-f]{32}$/);
    expect((await owner.post(`/api/orgs/${orgId}/sso/domains/acme.sa/verify`)).body.error).toBe('sso_record_not_found');
    dns.set('acme.sa', ['v=spf1 -all', add.body.record]);
    expect((await owner.post(`/api/orgs/${orgId}/sso/domains/acme.sa/verify`)).body).toEqual({ verified: true });
  });

  it('lets only one organisation own a domain', async () => {
    const other = await Client.signUp(t.app, 'Squatter', { organisation: 'Not Acme' });
    await t.db.query("update organisations set plan = 'business' where id = $1", [other.orgId]);
    const add = await other.client.post(`/api/orgs/${other.orgId}/sso/domains`, { domain: 'acme.sa' });
    dns.set('acme.sa', [...dns.get('acme.sa')!, add.body.record]);
    expect((await other.client.post(`/api/orgs/${other.orgId}/sso/domains/acme.sa/verify`)).body.error).toBe('sso_domain_taken');
  });

  it('saves the connection after checking the provider, with the client secret encrypted', async () => {
    expect((await owner.put(`/api/orgs/${orgId}/sso`, settings({ issuer: 'http://127.0.0.1:1' }))).body.error).toBe('sso_provider_unreachable');
    expect((await owner.put(`/api/orgs/${orgId}/sso`, settings())).status).toBe(200);
    const row = (await t.db.query<{ client_secret_enc: string }>('select client_secret_enc from sso_connections where org_id = $1', [orgId])).rows[0]!;
    expect(row.client_secret_enc).not.toContain('s3cret');
    const got = (await owner.get(`/api/orgs/${orgId}/sso`)).body;
    expect(got.connection).toMatchObject({ provider: 'oidc', clientId: 'wbs-master', autoJoin: true });
    expect(JSON.stringify(got)).not.toContain('s3cret');
    expect(got.callbackUrl).toBe('https://app.example/api/auth/sso/callback');
  });

  it('signs a new person in through the provider and adds them to the organisation', async () => {
    idp.as({ email: 'noura@acme.sa', email_verified: true, name: 'Noura Al-Qahtani' });
    const r = await signInWithSso('noura@acme.sa');
    const sent = idp.authorizeParams.at(-1)!;
    expect([sent.get('login_hint'), sent.get('code_challenge_method'), sent.get('scope')]).toEqual(['noura@acme.sa', 'S256', 'openid email profile']);
    expect(r.status).toBe(302);
    expect(r.location).toBe('/');
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: r.cookie } });
    const body = JSON.parse(me.body);
    expect(body.user).toMatchObject({ email: 'noura@acme.sa', name: 'Noura Al-Qahtani' });
    expect(body.organisations).toEqual([expect.objectContaining({ id: orgId, role: 'member' })]);
  });

  it('signs an existing password account in as the same person', async () => {
    // Omar confirmed his email when he signed up, so his password keeps working afterwards
    const existing = await Client.signUp(t.app, 'Omar', { email: 'omar@acme.sa' });
    idp.as({ email: 'omar@acme.sa', email_verified: true, name: 'Omar K.' });
    const r = await signInWithSso('omar@acme.sa');
    const me = JSON.parse((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: r.cookie } })).body);
    expect(me.user.id).toBe(existing.userId);
    expect(me.user.emailVerified).toBe(true);
  });

  it('takes over an account someone made with the address but never confirmed: its password and sessions stop', async () => {
    // someone signs up as Huda before she does, and never confirms the address
    const squatter = await Client.signUp(t.app, 'Not Huda', { email: 'huda@acme.sa' }, { verify: false });
    idp.as({ email: 'huda@acme.sa', email_verified: true, name: 'Huda' });
    const r = await signInWithSso('huda@acme.sa');
    expect(r.status).toBe(302);
    expect((await squatter.client.get('/api/me')).status).toBe(401);
    const login = await new Client(t.app).post('/api/auth/login', { email: 'huda@acme.sa', password: 'correct horse battery' });
    expect(login.status).not.toBe(200);
    const me = JSON.parse((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: r.cookie } })).body);
    expect(me.user).toMatchObject({ email: 'huda@acme.sa', emailVerified: true });
  });

  it('refuses answers for another domain, unverified emails, and reused sign-ins', async () => {
    idp.as({ email: 'someone@evil.example', email_verified: true });
    expect((await signInWithSso('x@acme.sa')).location).toBe('/signin?sso_error=sso_email_domain');
    idp.as({ email: 'sara@acme.sa', email_verified: false });
    expect((await signInWithSso('sara@acme.sa')).location).toBe('/signin?sso_error=sso_email_unverified');
    idp.as({ email: 'sara@acme.sa', email_verified: true });
    const ok = await signInWithSso('sara@acme.sa');
    expect(ok.location).toBe('/');
    const replay = await t.app.inject({ method: 'GET', url: ok.callback!.pathname + ok.callback!.search, headers: { cookie: ok.browserCookie! } });
    expect(replay.headers.location).toBe('/signin?sso_error=sso_expired');
  });

  it('finishes a sign-in only in the browser that started it', async () => {
    idp.as({ email: 'sara@acme.sa', email_verified: true });
    const browser = new Client(t.app);
    const start = await browser.post('/api/auth/sso/start', { email: 'sara@acme.sa' });
    expect(browser.cookie).toMatch(/^wbs_sso=/);
    const back = new URL((await fetch(start.body.url, { redirect: 'manual' })).headers.get('location')!);
    // someone else's browser, sent the link (login CSRF): refused, with no session
    for (const cookie of [undefined, 'wbs_sso=someone-elses-state']) {
      const other = await t.app.inject({ method: 'GET', url: back.pathname + back.search, headers: cookie ? { cookie } : {} });
      expect(other.headers.location).toBe('/signin?sso_error=sso_expired');
      expect(String(other.headers['set-cookie'] ?? '')).not.toMatch(/wbs_session=[^;]/);
    }
    const mine = await t.app.inject({ method: 'GET', url: back.pathname + back.search, headers: { cookie: browser.cookie } });
    expect(mine.headers.location).toBe('/');
  });

  it('can refuse people who are not members yet', async () => {
    await owner.put(`/api/orgs/${orgId}/sso`, settings({ clientSecret: undefined, autoJoin: false }));
    idp.as({ email: 'newcomer@acme.sa', email_verified: true });
    expect((await signInWithSso('newcomer@acme.sa')).location).toBe('/signin?sso_error=sso_not_member');
  });

  it('can require SSO: password sign-in and sign-up are refused for the domain', async () => {
    await owner.put(`/api/orgs/${orgId}/sso`, settings({ clientSecret: undefined, enforce: true }));
    const c = new Client(t.app);
    expect((await c.post('/api/auth/login', { email: 'omar@acme.sa', password: 'correct horse battery' })).body.error).toBe('sso_required');
    expect((await c.post('/api/auth/signup', { email: 'new@acme.sa', password: 'correct horse battery', name: 'N' })).body.error).toBe('sso_required');
    // other domains are not affected
    expect((await c.post('/api/auth/login', { email: 'ssoowner@example.com', password: 'correct horse battery' })).status).toBe(200);
  });

  it('stops requiring SSO when the last verified domain is removed, and has no route for unknown domains', async () => {
    expect((await new Client(t.app).post('/api/auth/sso/start', { email: 'a@unknown.example' })).body.error).toBe('sso_not_configured');
    await owner.del(`/api/orgs/${orgId}/sso/domains/acme.sa`);
    expect((await owner.get(`/api/orgs/${orgId}/sso`)).body.connection.enforce).toBe(false);
    expect((await new Client(t.app).post('/api/auth/login', { email: 'omar@acme.sa', password: 'correct horse battery' })).status).toBe(200);
  });
});

describe('without a SECRET_KEY', () => {
  it('turns single sign-on off with a clear error instead of failing to start', async () => {
    const s = await startApp({ secretKey: null, ssoAllowHttp: true });
    try {
      const o = await Client.signUp(s.app, 'NoKey');
      await s.db.query("update organisations set plan = 'business' where id = $1", [o.orgId]);
      const r = await o.client.put(`/api/orgs/${o.orgId}/sso`, { provider: 'google', clientId: 'x', clientSecret: 'y', enforce: false, autoJoin: true });
      expect(r.body.error).toBe('sso_unavailable');
      expect((await new Client(s.app).post('/api/auth/sso/start', { email: 'a@b.example' })).body.error).toBe('sso_unavailable');
    } finally {
      await s.close();
      t = await startApp({ ssoAllowHttp: true }, { resolveTxt: async name => dns.get(name) ?? [] });
    }
  });
});
