// Public read-only links: a project admin creates a link from the Share dialog; someone signed out opens
// it and sees the plan read-only (English and Arabic); revoking the link makes it stop working.
// Run with DATABASE_URL (the test puts its organisation on the Team plan):  node e2e/share.mjs [screenshotDir]
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); };
const stamp = Date.now();
const pg = createRequire(new URL('../../api/package.json', import.meta.url))('pg');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp' });
await db.connect();
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };

// ---- an admin with a project ----
const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
await adminCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const admin = await (await adminCtx.request.post(`${API}/auth/signup`, { data: { email: `hala${stamp}@example.com`, password: 'correct horse battery', name: 'Hala', organisation: 'Gulf Switchgear' } })).json();
const post = (url, data) => adminCtx.request.post(`${API}${url}`, { data }).then(r => r.json());
const project = await post(`/orgs/${admin.orgId}/projects`, { name: 'RMU retrofit for Client X' });
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const phase = crypto.randomUUID(), design = crypto.randomUUID(), build = crypto.randomUUID();
await post(`/projects/${project.id}/ops`, { ops: [
  { op: 'add', id: phase, parentId: null, values: { name: 'Engineering' } },
  { op: 'add', id: design, parentId: phase, values: { name: 'Panel design', owner: 'Nora Q', notes: 'internal note: margin is thin', plannedStart: day(-30), plannedFinish: day(-5) } },
  { op: 'add', id: build, parentId: phase, values: { name: 'Factory build', owner: 'Faisal K', plannedStart: day(-2), plannedFinish: day(25) } },
] });
await post(`/projects/${project.id}/ops`, { ops: [
  { op: 'set', id: design, field: 'forecastFinish', value: day(3) }, { op: 'set', id: design, field: 'progress', value: 70 },
  { op: 'link', succ: build, pred: design },
] });
await post(`/projects/${project.id}/comments`, { body: 'private comment about the client' });

const page = watch(await adminCtx.newPage());
await page.goto(`${BASE}/p/${project.id}`);
await page.getByRole('button', { name: 'Share' }).click();
await page.getByRole('dialog', { name: 'Public read-only links' }).waitFor();
await page.getByText('Public links are part of the Team and Business plans.').waitFor();
check(await page.getByRole('button', { name: 'Create link' }).count() === 0, 'on the Free plan the Share dialog explains that links need Team or Business');
await page.getByRole('button', { name: 'Close' }).click();

// ---- on Team: create a link without the Chart view ----
await db.query("update organisations set plan = 'team' where id = $1", [admin.orgId]);
await page.getByRole('button', { name: 'Share' }).click();
const dialog = page.getByRole('dialog', { name: 'Public read-only links' });
await dialog.getByLabel('Chart').uncheck();
await dialog.getByRole('button', { name: 'Create link' }).click();
const urlBox = dialog.locator('[data-share-url]');
await urlBox.waitFor();
const url = (await urlBox.textContent()).trim();
check(new RegExp(`^${BASE}/share/[A-Za-z0-9_-]{32}$`).test(url), 'the admin gets a link to copy, shown once');
await dialog.getByRole('button', { name: 'Copy' }).click();
check(await page.evaluate(() => navigator.clipboard.readText()) === url, 'Copy puts the link on the clipboard');
check(await dialog.locator('tbody tr').count() === 1 && await dialog.locator('tbody tr').getByText('Table, Gantt, Summary').isVisible(), 'the link is listed with the views it shows');
await shot(page, '80-share-dialog');
await dialog.getByRole('button', { name: 'I have saved it' }).click();
await dialog.getByRole('button', { name: 'Close' }).click();

// ---- someone signed out opens it ----
const guestCtx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const g = watch(await guestCtx.newPage());
const res = await g.goto(url);
check(res.headers()['x-robots-tag']?.includes('noindex'), 'the shared page is marked noindex for search engines');
await g.locator('input[value="Panel design"]').waitFor();
check(await g.getByText('Shared with WBS Master — read-only').isVisible(), 'the page says it is shared read-only');
check(await g.locator('h1', { hasText: 'RMU retrofit for Client X' }).isVisible(), 'the project name is shown');
check(await g.locator('meta[name="robots"][content*="noindex"]').count() === 1, 'the page sets a robots noindex meta tag');
const enabled = await g.locator('.view input:not([disabled]), .view select:not([disabled]), .view textarea:not([disabled])').count();
check(enabled === 0 && await g.locator('.rowadd').count() === 0, 'the table has no edit controls');
for (const name of ['Comments', 'Activity', 'Project settings', 'Share', 'Baselines', 'Import Excel', 'Sign out']) {
  check(await g.getByRole('button', { name }).count() === 0, `no ${name} button`);
}
check(await g.locator('.pill.red, .pill.amber, .pill.green').count() > 0, 'health colours are shown');
check(await g.locator('input[value="Nora Q"]').count() === 1, 'owners are shown (the admin chose to)');
const html = await g.content();
check(!html.includes('internal note') && !html.includes('private comment') && !html.includes(`hala${stamp}`), 'no notes, comments or emails on the page');
check(await g.getByRole('button', { name: 'Chart' }).count() === 0 && await g.getByRole('button', { name: 'Gantt' }).count() === 1, 'only the chosen views are offered');
check((await g.evaluate(async id => (await fetch(`/api/projects/${id}`)).status, project.id)) === 401, 'the link gives no access to the normal project routes');
await shot(g, '81-share-table');
await g.getByRole('button', { name: 'Gantt' }).click();
await g.locator('.gantt').waitFor();
check(await g.locator('.h.s, .h.e, .lk').count() === 0, 'the Gantt has no drag handles or link handles');
await shot(g, '82-share-gantt');
await g.getByRole('button', { name: 'Summary' }).click();
await g.getByText('Executive summary').first().waitFor();
check(await g.locator('textarea:not([disabled])').count() === 0 && await g.getByRole('button', { name: 'Write from WBS data' }).count() === 0, 'the summary is read-only');

// ---- in Arabic ----
await g.getByRole('button', { name: 'العربية' }).click();
await g.getByText('مشارَك عبر WBS Master — للقراءة فقط').waitFor();
check(await g.evaluate(() => document.documentElement.dir) === 'rtl', 'the shared page works in Arabic, right to left');
await g.getByRole('button', { name: 'جدول' }).click();
await g.locator('input[value="Panel design"]').waitFor();
await shot(g, '83-share-ar');
await g.getByRole('button', { name: 'English' }).click();

// ---- revoke: the link stops working ----
await page.getByRole('button', { name: 'Share' }).click();
const row = dialog.locator('tbody tr').first();
await row.getByRole('button', { name: 'Revoke' }).click();
await row.getByRole('button', { name: /Revoke\?/ }).click();
await dialog.getByText('No public links yet.').waitFor();
check(true, 'the admin revokes the link');
await g.reload();
await g.getByText('This link is not valid. It may have been revoked; ask whoever shared it for a new one.').waitFor();
check(await g.locator('input[value="Panel design"]').count() === 0, 'the revoked link no longer shows the plan');
await shot(g, '84-share-revoked');

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await db.end();
await browser.close();
