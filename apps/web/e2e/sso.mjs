// Single sign-on from end to end: an admin sets it up in Settings, a colleague signs in with the company
// account, and password sign-in is refused once SSO is required.
// Run with the API started with SSO_ALLOW_HTTP=1 and APP_URL set to WEB_URL, and with DATABASE_URL
// (to put the test organisation on the Business plan and mark its domain as proved):
//   node e2e/sso.mjs [screenshotDir]
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();
const domain = `acme${stamp}.example`;

const pg = createRequire(new URL('../../api/package.json', import.meta.url))('pg');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp' });
await db.connect();

// ---- a fake identity provider (OpenID Connect, RS256, PKCE) ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const jwt = claims => {
  const head = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
};
const codes = new Map();
let person = { email: `layla@${domain}`, name: 'Layla Al-Harbi' };
const idp = createServer((req, res) => {
  const url = new URL(req.url, idpBase);
  const json = v => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (url.pathname === '/.well-known/openid-configuration') {
    return json({ issuer: idpBase, authorization_endpoint: `${idpBase}/authorize`, token_endpoint: `${idpBase}/token`, jwks_uri: `${idpBase}/jwks`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'] });
  }
  if (url.pathname === '/jwks') return json({ keys: [jwk] });
  if (url.pathname === '/authorize') {
    // a real provider would ask for the password here; this one signs the person straight in
    const code = randomBytes(8).toString('hex');
    codes.set(code, { nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), client: url.searchParams.get('client_id'), who: person });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: back.href });
    return res.end();
  }
  if (url.pathname === '/token') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const c = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      const pkce = c && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === c.challenge;
      if (!pkce) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_grant"}'); }
      const now = Math.floor(Date.now() / 1000);
      json({ access_token: 'at', token_type: 'Bearer', expires_in: 300,
        id_token: jwt({ iss: idpBase, aud: c.client, sub: c.who.email, nonce: c.nonce, iat: now, exp: now + 300, email: c.who.email, email_verified: true, name: c.who.name }) });
    });
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise(r => idp.listen(0, '127.0.0.1', r));
const idpBase = `http://127.0.0.1:${idp.address().port}`;

// ---- the admin sets up SSO ----
const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const admin = await (await adminCtx.request.post(`${API}/auth/signup`, { data: { email: `admin${stamp}@example.com`, password: 'correct horse battery', name: 'Admin', organisation: 'Acme' } })).json();
await db.query("update organisations set plan = 'business' where id = $1", [admin.orgId]);
const page = await adminCtx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE);
await page.getByRole('link', { name: 'Settings' }).click();
await page.getByRole('heading', { name: 'Single sign-on' }).waitFor();
await page.getByLabel('Email domain').fill(domain);
await page.getByRole('button', { name: 'Add domain' }).click();
await page.locator('.domains code.record').waitFor();
check((await page.locator('.domains code.record').innerText()).startsWith('wbs-master-verification='), 'adding a domain shows the DNS record to add');
// the DNS record cannot be published from a test: mark the domain as proved directly
await db.query('update sso_domains set verified_at = now() where org_id = $1 and domain = $2', [admin.orgId, domain]);
await page.reload();
await page.locator('.domains .pill', { hasText: 'Verified' }).waitFor();
await page.getByLabel('Provider').selectOption('oidc');
await page.getByLabel('Issuer address').fill(idpBase);
await page.getByLabel('Application (client) ID').fill('wbs-master-e2e');
await page.getByLabel('Client secret').fill('e2e-secret');
await page.getByLabel(/Require single sign-on/).check();
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Single sign-on saved.').waitFor();
check(true, 'the admin connects the identity provider and requires SSO');
check((await page.locator('code.record', { hasText: '/api/auth/sso/callback' }).innerText()).startsWith(BASE), 'the redirect address to register is shown');
if (shots) await page.screenshot({ path: `${shots}/50-sso-settings.png`, fullPage: true });

// ---- a colleague signs in with the company account ----
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.goto(`${BASE}/signin`);
await p.getByLabel('Email').fill(person.email);
await p.getByLabel('Password').fill('whatever password');
await p.getByRole('button', { name: 'Sign in', exact: true }).click();
await p.getByText('Your organisation signs in with its company account').waitFor();
check(true, 'password sign-in is refused for the domain and points to SSO');
await p.getByRole('button', { name: 'Continue' }).click();
await p.waitForURL(`${BASE}/`);
await p.getByRole('heading', { name: 'Projects' }).waitFor();
const me = await (await ctx.request.get(`${API}/me`)).json();
check(me.user.name === 'Layla Al-Harbi' && me.organisations.some(o => o.id === admin.orgId && o.role === 'member'), 'the colleague is signed in and joins the organisation');
if (shots) await p.screenshot({ path: `${shots}/51-sso-signed-in.png` });

// someone from another domain cannot use this organisation's sign-in
const other = await browser.newContext();
const q = await other.newPage();
q.on('pageerror', e => errors.push(e.message));
await q.goto(`${BASE}/signin`);
await q.getByRole('button', { name: 'Sign in with your company account' }).click();
await q.getByLabel('Work email').fill(`someone${stamp}@elsewhere.example`);
await q.getByRole('button', { name: 'Continue' }).click();
await q.getByText('Single sign-on is not set up for this email domain').waitFor();
check(true, 'other domains are told SSO is not set up for them');

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
idp.close();
await db.end();
await browser.close();
