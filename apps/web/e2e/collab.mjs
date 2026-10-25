// Two people on one project: presence, selection badges and live updates without reloading.
// Run with the API and web app running:  node e2e/collab.mjs [screenshotDir]
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();

// set up through the API: owner with a project, and a colleague who is an editor on it
async function account(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const r = await ctx.request.post(`${API}/auth/signup`, { data: { email: `${name.toLowerCase()}${stamp}@example.com`, password: 'correct horse battery', name } });
  return { ctx, body: await r.json() };
}
const a = await account('Rayan');
const b = await account('Sara');
const p = await (await a.ctx.request.post(`${API}/orgs/${a.body.orgId}/projects`, { data: { name: 'Shared plan' } })).json();
await a.ctx.request.post(`${API}/orgs/${a.body.orgId}/members`, { data: { email: `sara${stamp}@example.com`, role: 'member' } });
await a.ctx.request.put(`${API}/projects/${p.id}/members/${b.body.user.id}`, { data: { role: 'editor' } });
const item = crypto.randomUUID();
await a.ctx.request.post(`${API}/projects/${p.id}/ops`, { data: { ops: [{ op: 'add', id: item, parentId: null, values: { name: 'Factory acceptance test', forecastStart: '2026-11-01', forecastFinish: '2026-11-05' } }] } });

const pa = await a.ctx.newPage(), pb = await b.ctx.newPage();
const errors = [];
for (const pg of [pa, pb]) pg.on('pageerror', e => errors.push(e.message));
await pa.goto(`${BASE}/p/${p.id}`);
await pb.goto(`${BASE}/p/${p.id}`);
await pa.locator('td.code').first().waitFor();
await pb.locator('td.code').first().waitFor();

await pa.locator('.viewers .av').waitFor({ timeout: 5000 });
check((await pa.locator('.viewers').getAttribute('title')).includes('Sara'), 'Rayan sees that Sara is viewing');

// Sara selects the row; Rayan sees her badge on it
await pb.locator('td.code').first().click();
await pa.locator('td.code .who').waitFor({ timeout: 5000 });
check((await pa.locator('td.code .who').getAttribute('title')).includes('Sara'), 'Rayan sees which item Sara selected');

// Rayan also selects it; Sara renames it and slips the finish: Rayan's page updates without a reload
await pa.locator('td.code').first().click();
const name = pb.locator('input[data-name]').first();
await name.fill('Factory acceptance test (FAT)');
await name.press('Tab');
const fin = pb.locator('tr').nth(2).locator('input[type=date]').nth(3);
await fin.fill('2026-11-12');
await fin.press('Enter');
await pa.locator('input[value="Factory acceptance test (FAT)"]').first().waitFor({ timeout: 5000 });
check(true, 'Sara’s rename appears on Rayan’s page without reloading');
await pa.waitForFunction(() => [...document.querySelectorAll('input[type=date]')].some(i => i.value === '2026-11-12'), null, { timeout: 5000 });
check(true, 'Sara’s new finish date appears on Rayan’s page');
await pa.getByText('just changed this item').waitFor({ timeout: 5000 });
check(true, 'Rayan is told that Sara changed the item Rayan has selected');
if (shots) await pa.screenshot({ path: `${shots}/6-collab.png` });

// Sara leaves; Rayan's viewer list empties
await pb.close();
await pa.locator('.viewers').waitFor({ state: 'detached', timeout: 5000 });
check(true, 'when Sara leaves, she is no longer shown');
check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
