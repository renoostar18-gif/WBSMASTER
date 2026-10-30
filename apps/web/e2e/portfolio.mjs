// Portfolio (worst first, Executive and Team views) and comments between two people (@mention, live update, reply, resolve).
// Run with the API and web app running:  node e2e/portfolio.mjs [screenshotDir]
// Upgrading the test organisation to the Team plan needs the database (DATABASE_URL, as for the API).
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

async function account(name) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const r = await ctx.request.post(`${API}/auth/signup`, { data: { email: `${name.split(' ')[0].toLowerCase()}${stamp}@example.com`, password: 'correct horse battery', name } });
  return { ctx, body: await r.json() };
}
const a = await account('Rayan Hamdan');
const b = await account('Sara Ahmed');
const orgId = a.body.orgId;
const post = (url, data) => a.ctx.request.post(`${API}${url}`, { data }).then(r => r.json());

// two projects: one with overdue work, one on plan
const late = await post(`/orgs/${orgId}/projects`, { name: 'Busbar redesign' });
const fine = await post(`/orgs/${orgId}/projects`, { name: 'Panel retrofit' });
const design = crypto.randomUUID(), build = crypto.randomUUID();
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
await post(`/projects/${late.id}/ops`, { ops: [
  { op: 'add', id: design, parentId: null, values: { name: 'Insulation design', owner: 'R&D', plannedStart: day(-40), plannedFinish: day(-20) } },
  { op: 'add', id: build, parentId: null, values: { name: 'Prototype build', owner: 'Plant', plannedStart: day(-10), plannedFinish: day(10) } },
] });
await post(`/projects/${late.id}/ops`, { ops: [
  { op: 'set', id: design, field: 'forecastFinish', value: day(-3) }, { op: 'set', id: design, field: 'progress', value: 60 },
  { op: 'link', succ: build, pred: design },
] });
await post(`/projects/${fine.id}/ops`, { ops: [{ op: 'add', parentId: null, values: { name: 'Site survey', owner: 'R&D', plannedStart: day(-5), plannedFinish: day(20), actualStart: day(-5), progress: 30 } }] });

const pa = await a.ctx.newPage();
const errors = [];
pa.on('pageerror', e => errors.push(e.message));

// Free plan: the portfolio explains the upgrade
await pa.goto(BASE);
await pa.getByRole('link', { name: 'Portfolio' }).click();
await pa.getByText('Portfolio is part of the Team and Business plans').waitFor();
check(true, 'the Free plan shows what the portfolio needs');

await db.query("update organisations set plan = 'team' where id = $1", [orgId]);
await pa.getByRole('button', { name: 'Refresh' }).click();
await pa.getByText('Executive portfolio summary').waitFor();
// the heading can show before the table is filled in: wait for both projects' rows
await pa.locator('table.rt tbody tr .linkish').nth(1).waitFor();
await shot(pa, '20-portfolio-exec');
const names = await pa.locator('table.rt tbody tr .linkish').allInnerTexts();
check(names[0] === 'Busbar redesign' && names[1] === 'Panel retrofit', 'projects are listed worst first');
check(await pa.locator('svg.road rect').count() >= 4, 'the roadmap draws plan and forecast bars');
check(await pa.getByText('Agree a recovery plan for Insulation design').count() === 1, 'a decision is suggested for the late critical-path item');

// leaving a project out of the summary
await pa.locator('.pf-chip', { hasText: 'Panel retrofit' }).locator('input').uncheck();
check((await pa.locator('table.rt tbody tr .linkish').allInnerTexts()).join() === 'Busbar redesign', 'a project can be left out of the summary');
await pa.locator('.pf-chip', { hasText: 'Panel retrofit' }).locator('input').check();

// Team view: overdue work, early warnings, owner filter, copy as text
await pa.getByRole('button', { name: 'Project team' }).click();
await pa.getByText('Project team summary').waitFor();
const overdue = pa.locator('.sec', { has: pa.locator('h2', { hasText: /^Overdue/ }) });
check((await overdue.innerText()).includes('Insulation design'), 'overdue work is listed');
const warnings = pa.locator('.sec', { has: pa.locator('h2', { hasText: 'Potential delays' }) });
check((await warnings.innerText()).includes('Waits for 1 Insulation design'), 'the item waiting for late work is an early warning');
await pa.locator('select').first().selectOption('Plant');
check(!(await overdue.innerText()).includes('Insulation design'), 'filtering by owner hides other owners’ work');
await shot(pa, '21-portfolio-team');
await pa.getByRole('button', { name: 'Copy as text' }).click();
const text = await pa.evaluate(() => navigator.clipboard.readText());
check(text.startsWith('PROJECT TEAM SUMMARY') && text.includes('Owner: Plant'), 'the summary copies as plain text');

// Arabic mirrors the page
await pa.getByRole('button', { name: 'العربية' }).click();
await pa.getByText('ملخص فريق المشروع').waitFor();
check(await pa.evaluate(() => document.documentElement.dir) === 'rtl', 'the portfolio switches to Arabic, right to left');
await pa.getByRole('button', { name: 'الإدارة التنفيذية' }).click();
await shot(pa, '22-portfolio-ar');
await pa.getByRole('button', { name: 'English' }).click();
await pa.getByRole('button', { name: 'Executives' }).click();

// opening a project from the portfolio shows its summary
await pa.getByRole('button', { name: 'Busbar redesign' }).click();
await pa.waitForURL(`**/p/${late.id}`);
await pa.locator('.seg button[aria-pressed="true"]', { hasText: 'Summary' }).waitFor();
check(true, 'a project opens on its Summary view');

// ---- comments ----
await post(`/orgs/${orgId}/members`, { email: `sara${stamp}@example.com`, role: 'member' });
await a.ctx.request.put(`${API}/projects/${late.id}/members/${b.body.user.id}`, { data: { role: 'commenter' } });
const pb = await b.ctx.newPage();
pb.on('pageerror', e => errors.push(e.message));
await pa.getByRole('button', { name: 'Table' }).click();
await pb.goto(`${BASE}/p/${late.id}`);
await pb.locator('td.code').first().waitFor();
check(await pb.locator('input[data-name]').first().isDisabled(), 'a commenter cannot edit items');

// Rayan comments on the item and mentions Sara
await pa.locator('td.code').first().click();
await pa.locator('.insp').getByRole('button', { name: 'Comments' }).click();
const box = pa.locator('.comments textarea').first();
await box.fill('Can you confirm the new test date @Sa');
await pa.locator('.mentions').getByText('Sara Ahmed').waitFor();
await box.press('Enter');
check((await box.inputValue()) === 'Can you confirm the new test date @Sara Ahmed ', 'typing @ suggests people and inserts the name');
await box.press('Control+Enter');
await pa.locator('.thread .mention', { hasText: '@Sara Ahmed' }).waitFor();
check(true, 'the comment is posted with the mention highlighted');
await shot(pa, '23-comments');

// Sara sees it without reloading, replies and resolves
await pb.locator('.ib .count', { hasText: '1' }).waitFor({ timeout: 5000 });
check(true, 'Sara sees the open comment count arrive live');
await pb.getByRole('button', { name: /Comments/ }).first().click();
await pb.locator('.thread').getByText('Can you confirm the new test date').waitFor();
await pb.locator('.thread').getByRole('button', { name: 'Reply' }).click();
await pb.locator('.thread textarea').fill('Yes, 12 November. Lab is booked.');
await pb.locator('.thread').getByRole('button', { name: 'Reply' }).last().click();
await pa.locator('.thread').getByText('Lab is booked').waitFor({ timeout: 5000 });
check(true, 'Rayan sees Sara’s reply without reloading');
await pb.locator('.thread').getByRole('button', { name: 'Resolve' }).click();
await pa.locator('.thread.resolved').getByText('Resolved by Sara Ahmed').waitFor({ timeout: 5000 });
check(true, 'resolving the thread shows on Rayan’s page');
await pa.getByLabel('Open threads only').check();
check(await pa.locator('.thread').count() === 0, 'the open-only filter hides resolved threads');
await pa.getByLabel('Open threads only').uncheck();

// a viewer can read but not comment
await a.ctx.request.put(`${API}/projects/${late.id}/members/${b.body.user.id}`, { data: { role: 'viewer' } });
await pb.reload();
await pb.locator('td.code').first().waitFor();
await pb.getByRole('button', { name: /Comments/ }).first().click();
await pb.getByText('Viewers can read comments but not add them.').waitFor();
check(await pb.locator('.comments textarea').count() === 0 && await pb.locator('.thread').count() === 1, 'a viewer reads the thread but has no comment box');

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await db.end();
await browser.close();
