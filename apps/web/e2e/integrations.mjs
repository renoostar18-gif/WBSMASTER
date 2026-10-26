// API keys and webhooks from Settings: create a key and use it, revoke it; add a webhook, send a test, see it delivered.
// Run with the API (with DATABASE_URL, to put the test organisation on the Team plan) and the web app running:
//   node e2e/integrations.mjs [screenshotDir]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();

const pg = createRequire(new URL('../../api/package.json', import.meta.url))('pg');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp' });
await db.connect();

// a receiver for the webhook
const received = [];
const receiver = createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.statusCode = 204; res.end(); }); });
await new Promise(r => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${receiver.address().port}/wbs`;

const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const signup = await (await ctx.request.post(`${API}/auth/signup`, { data: { email: `integrator${stamp}@example.com`, password: 'correct horse battery', name: 'Integrator' } })).json();
await db.query("update organisations set plan = 'team' where id = $1", [signup.orgId]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(BASE);
await page.getByRole('link', { name: 'Settings' }).click();
await page.getByRole('heading', { name: 'API keys' }).waitFor();

// create a key, see it once, use it
await page.getByLabel('Name').fill('Power BI report');
await page.locator('select[name="scope"]').selectOption('read');
await page.getByRole('button', { name: 'Create key' }).click();
const key = (await page.locator('.secret code').innerText()).trim();
check(/^wbsm_[0-9a-f]{12}_/.test(key), 'the new key is shown once');
const me = await (await ctx.request.get(`${API}/me`, { headers: { authorization: `Bearer ${key}` } })).json();
check(me.user.name === 'Integrator', 'the key reads the API as its owner');
const write = await ctx.request.post(`${API}/orgs/${signup.orgId}/projects`, { headers: { authorization: `Bearer ${key}` }, data: { name: 'x' } });
check(write.status() === 403, 'a read-only key cannot create a project');
await page.getByRole('button', { name: 'I have saved it' }).click();
check(await page.locator('.secret').count() === 0 && (await page.locator('table.rt').innerText()).includes('Power BI report'), 'the key is listed without its secret');

// add a webhook, send a test, see the delivery
await page.getByLabel('Address (https)').fill(hookUrl);
await page.getByRole('button', { name: 'Add webhook' }).click();
const secret = (await page.locator('.secret code').innerText()).trim();
check(secret.startsWith('whsec_'), 'the webhook signing secret is shown once');
await page.getByRole('button', { name: 'I have saved it' }).click();
await page.getByRole('button', { name: 'Send a test' }).click();
for (let k = 0; k < 40 && !received.length; k++) await page.waitForTimeout(250);
check(received.length === 1 && JSON.parse(received[0].body).event === 'ping', 'the test ping reaches the receiver');
check(/^t=\d+,v1=[0-9a-f]{64}$/.test(received[0].headers['x-wbs-signature']), 'it is signed');
await page.getByRole('button', { name: 'Deliveries' }).click();
await page.locator('.hooks table').getByText('Delivered').waitFor({ timeout: 5000 });
check(true, 'the delivery is listed as delivered');
if (shots) await page.screenshot({ path: `${shots}/40-integrations.png`, fullPage: true });

// a real event: a project created by the person
received.length = 0;
await ctx.request.post(`${API}/orgs/${signup.orgId}/projects`, { data: { name: 'Hooked project' } });
for (let k = 0; k < 40 && !received.length; k++) await page.waitForTimeout(250);
const ev = received[0] && JSON.parse(received[0].body);
check(ev?.event === 'project.created' && ev.data.project.name === 'Hooked project', 'creating a project sends project.created');

// revoke the key
await page.getByRole('button', { name: 'Revoke' }).click();
await page.getByRole('button', { name: /Revoke\? It stops working/ }).click();
await page.locator('table.rt', { hasText: 'Power BI report' }).waitFor({ state: 'detached' });
const after = await ctx.request.get(`${API}/me`, { headers: { authorization: `Bearer ${key}` } });
check(after.status() === 401, 'a revoked key stops working');

// the reference
const docs = await ctx.newPage();
await docs.goto(`${BASE}/api/docs`);
check(await docs.locator('h1').innerText() === 'WBS Master API', 'the API reference is served');

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
receiver.close();
await db.end();
await browser.close();
