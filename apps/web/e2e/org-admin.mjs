// Organisation administration from end to end: an owner transfers ownership from the Members page,
// the new owner reads the audit log, schedules the organisation's deletion (members stop seeing it)
// and cancels it; then a deletion runs through the daily job and the owner, left with no organisation,
// creates a new one. Run with DATABASE_URL, after `pnpm build` (the daily job is run from apps/api/dist):
//   node e2e/org-admin.mjs [screenshotDir]
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { confirmEmail } from './confirm-email.mjs';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();
const pg = createRequire(new URL('../../api/package.json', import.meta.url))('pg');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp' });
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };
const orgsOf = async ctx => (await (await ctx.request.get(`${API}/me`)).json()).organisations;

// ---- two people: Huda owns "Delta Build", Rami is a member ----
const hudaCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const orgName = `Delta Build ${stamp}`;
const huda = await (await hudaCtx.request.post(`${API}/auth/signup`, { data: { email: `huda${stamp}@example.com`, password: 'correct horse battery', name: 'Huda', organisation: orgName } })).json();
const ramiCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const rami = await (await ramiCtx.request.post(`${API}/auth/signup`, { data: { email: `rami${stamp}@example.com`, password: 'correct horse battery', name: 'Rami' } })).json();
await confirmEmail(API, `rami${stamp}@example.com`);
await hudaCtx.request.post(`${API}/orgs/${huda.orgId}/members`, { data: { email: `rami${stamp}@example.com`, role: 'member' } });
await hudaCtx.request.post(`${API}/orgs/${huda.orgId}/projects`, { data: { name: 'Warehouse' } });

// ---- Huda transfers ownership to Rami and steps down ----
const page = watch(await hudaCtx.newPage());
await page.goto(`${BASE}/members/${huda.orgId}`);
await page.getByRole('heading', { name: 'Transfer ownership' }).waitFor();
await page.getByLabel('New owner').selectOption(rami.user.id);
check(await page.getByLabel('I become an administrator').isChecked(), 'stepping down is offered, ticked by default');
await page.getByRole('button', { name: 'Transfer', exact: true }).click();
await page.getByRole('button', { name: 'Make Rami an owner?' }).click();
await page.getByText('Rami is now an owner.').waitFor();
const roles = Object.fromEntries((await (await hudaCtx.request.get(`${API}/orgs/${huda.orgId}/members`)).json()).members.map(m => [m.name, m.role]));
check(roles.Huda === 'admin' && roles.Rami === 'owner', 'Rami is an owner and Huda an administrator');
check(await page.getByRole('heading', { name: 'Transfer ownership' }).count() === 0, 'Huda no longer sees the owner-only sections');

// ---- Rami reads the audit log ----
const r = watch(await ramiCtx.newPage());
await r.goto(`${BASE}/members/${huda.orgId}`);
await r.getByRole('link', { name: 'Audit log' }).click();
await r.getByRole('heading', { name: 'Audit log' }).waitFor();
const transfer = r.locator('tr[data-action="org.ownership_transferred"]');
await transfer.waitFor();
check((await transfer.innerText()).includes('Huda') && (await transfer.innerText()).includes(`rami${stamp}@example.com`), 'the transfer is in the log, with who did it and to whom');
check(await r.locator('tr[data-action="project.created"]', { hasText: 'Warehouse' }).count() === 1, 'project creation is in the log');
await r.getByLabel('Show').selectOption('member');
await transfer.waitFor({ state: 'detached' });
await r.locator('tr[data-action="member.added"]').waitFor();
check(await r.locator('tbody tr').count() === 1, 'the log filters by kind of event');
check(await r.getByText('History is kept for 30 days on this plan.').isVisible(), 'the page says how long the Free plan keeps history');
if (shots) await r.screenshot({ path: `${shots}/80-audit.png`, fullPage: true });

// ---- Rami schedules the deletion ----
await r.goto(`${BASE}/members/${huda.orgId}`);
await r.getByRole('heading', { name: 'Delete organisation' }).waitFor();
const del = r.getByRole('button', { name: 'Delete organisation' });
check(await del.isDisabled(), 'deleting needs the organisation name typed first');
await r.getByLabel(`Type “${orgName}” to confirm`).fill(orgName);
await del.click();
await r.getByText(/This organisation will be deleted on/).first().waitFor();
check(await r.getByRole('heading', { name: 'Invite people' }).count() === 0, 'while waiting, the organisation cannot be changed');
check(!(await orgsOf(hudaCtx)).some(o => o.id === huda.orgId), 'members (Huda) no longer see the organisation');
const owners = await orgsOf(ramiCtx);
check(owners.find(o => o.id === huda.orgId)?.deleteOn, 'the owner still sees it, with the deletion date');
if (shots) await r.screenshot({ path: `${shots}/81-deletion-scheduled.png`, fullPage: true });

// the projects page is read-only for the owner, with a way to cancel
await r.goto(BASE);
await r.getByRole('combobox', { name: 'Organisation' }).selectOption(huda.orgId);
await r.getByText(/This organisation will be deleted on/).waitFor();
check(await r.getByRole('button', { name: 'New project', exact: true }).count() === 0, 'no new projects in an organisation being deleted');
await r.getByRole('button', { name: 'Cancel deletion' }).click();
await r.getByText('Deletion cancelled. The organisation is back to normal.').waitFor();
await r.getByRole('button', { name: 'New project', exact: true }).waitFor();
check((await orgsOf(hudaCtx)).some(o => o.id === huda.orgId), 'after cancelling, members see the organisation again');
const log = await (await ramiCtx.request.get(`${API}/orgs/${huda.orgId}/audit?action=org`)).json();
check(log.events[0].action === 'org.deletion_cancelled' && log.events[1].action === 'org.deletion_scheduled', 'scheduling and cancelling are in the audit log');

// ---- a deletion that runs: Huda's own workspace, through the daily job ----
const solo = watch(await hudaCtx.newPage());
const hudaOwn = await (await hudaCtx.request.post(`${API}/orgs`, { data: { name: `Huda Solo ${stamp}` } })).json();
check((await hudaCtx.request.post(`${API}/orgs/${hudaOwn.id}/deletion`, { data: { confirm: `Huda Solo ${stamp}` } })).status() === 201, 'an owner schedules a deletion');
// leave Delta Build too, so Huda belongs to nothing once her workspace is gone
await hudaCtx.request.delete(`${API}/orgs/${huda.orgId}/members/${huda.user.id}`);
await db.query("update organisations set delete_on = current_date - 1 where id = $1", [hudaOwn.id]);
const { runDailyDeletions } = await import(new URL('../../api/dist/orgadmin.js', import.meta.url).href);
check(await runDailyDeletions({ db, appUrl: BASE, today: () => new Date() }) >= 1, 'the daily job deletes organisations whose waiting period is over');
check((await db.query('select 1 from organisations where id = $1', [hudaOwn.id])).rowCount === 0, 'the organisation and its data are gone');

await solo.goto(BASE);
await solo.getByRole('heading', { name: 'You are not in an organisation' }).waitFor();
check(true, 'someone with no organisation can still sign in and is offered to create one');
if (shots) await solo.screenshot({ path: `${shots}/82-no-organisation.png` });
await solo.getByLabel('Organisation name').fill(`Huda Again ${stamp}`);
await solo.getByRole('button', { name: 'Create organisation' }).click();
await solo.getByRole('button', { name: 'New project', exact: true }).waitFor();
check((await orgsOf(hudaCtx)).some(o => o.name === `Huda Again ${stamp}` && o.role === 'owner'), 'they create a new organisation and own it');

// ---- the audit log in Arabic ----
const arCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: await ramiCtx.storageState() });
await arCtx.addInitScript(() => localStorage.setItem('wbs.locale', 'ar'));
const a = watch(await arCtx.newPage());
await a.goto(`${BASE}/audit/${huda.orgId}`);
await a.getByRole('heading', { name: 'سجل التدقيق' }).waitFor();
await a.locator('tr[data-action="org.ownership_transferred"]', { hasText: 'نقل الملكية' }).waitFor();
check(true, 'the audit log reads in Arabic');
check(await a.evaluate(() => document.documentElement.dir) === 'rtl', 'right to left');
if (shots) await a.screenshot({ path: `${shots}/83-audit-ar.png`, fullPage: true });

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await db.end();
await browser.close();
