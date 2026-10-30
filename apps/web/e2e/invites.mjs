// Invitations from end to end: an admin invites by email from the Members page; a new person opens
// the link, creates their account and joins; someone with an account signs in from the link and joins.
// Run with DATABASE_URL (the test sets a known link token, since the real one is only in the email):
//   node e2e/invites.mjs [screenshotDir]
import { createHash } from 'node:crypto';
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
/** Give an invitation a link token we know (the real one is only in the email). */
async function knownLink(orgId, email) {
  const token = `e2e-${stamp}-${email.split('@')[0]}`.replace(/[^A-Za-z0-9_-]/g, '-');
  const r = await db.query('update invitations set token_hash = $3 where org_id = $1 and lower(email) = $2 and accepted_at is null',
    [orgId, email, createHash('sha256').update(token).digest('hex')]);
  if (!r.rowCount) throw new Error(`no invitation for ${email}`);
  return `${BASE}/invite/${token}`;
}
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };

// ---- the admin invites from the Members page ----
const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const admin = await (await adminCtx.request.post(`${API}/auth/signup`, { data: { email: `huda${stamp}@example.com`, password: 'correct horse battery', name: 'Huda', organisation: 'Acme Projects' } })).json();
const page = watch(await adminCtx.newPage());
await page.goto(BASE);
await page.getByRole('link', { name: 'Members' }).click();
await page.getByRole('heading', { name: 'Invite people' }).waitFor();
const layla = `layla${stamp}@example.com`;
await page.getByLabel('Email').fill(layla);
await page.getByRole('button', { name: 'Send invitation' }).click();
await page.getByText(`Invitation sent to ${layla}.`).waitFor();
await page.locator('.rt', { hasText: layla }).waitFor();
check(await page.getByText('2 of 3 seats in use').isVisible(), 'the invitation is waiting and holds a seat on the Free plan');
if (shots) await page.screenshot({ path: `${shots}/70-members.png`, fullPage: true });

// ---- the new person opens the link and joins ----
const newCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p = watch(await newCtx.newPage());
await p.goto(await knownLink(admin.orgId, layla));
await p.getByRole('heading', { name: 'Join Acme Projects' }).waitFor();
check(await p.getByText('Huda invited you as Member.').isVisible(), 'the link says who invited them, to what, and as what');
if (shots) await p.screenshot({ path: `${shots}/71-invite.png` });
await p.getByLabel('Your name').fill('Layla');
await p.getByLabel('Password').fill('correct horse battery');
await p.getByRole('button', { name: 'Create account and join' }).click();
await p.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
const me = await p.evaluate(async () => (await fetch('/api/me')).json());
check(me.organisations.length === 1 && me.organisations[0].id === admin.orgId && me.organisations[0].role === 'member',
  'the new person has an account and is a member of the organisation, with no workspace of their own');

// ---- someone whose account was made after the invitation signs in from the link ----
const omar = `omar${stamp}@example.com`;
await page.getByLabel('Email').fill(omar);
await page.getByLabel('Role').first().selectOption('admin');
await page.getByRole('button', { name: 'Send invitation' }).click();
await page.getByText(`Invitation sent to ${omar}.`).waitFor();
const omarLink = await knownLink(admin.orgId, omar);
const omarCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await omarCtx.request.post(`${API}/auth/signup`, { data: { email: omar, password: 'correct horse battery', name: 'Omar' } });
await omarCtx.request.post(`${API}/auth/logout`);
const q = watch(await omarCtx.newPage());
await q.goto(omarLink);
await q.getByText(`There is already an account for ${omar}. Sign in to join.`).waitFor();
await q.getByRole('link', { name: 'Sign in' }).click();
check(await q.getByLabel('Email').inputValue() === omar, 'signing in from the link fills in the invited email');
await q.getByLabel('Password').fill('correct horse battery');
await q.getByRole('button', { name: 'Sign in', exact: true }).click();
await q.getByRole('heading', { name: 'Join Acme Projects' }).waitFor();
await q.getByRole('button', { name: 'Join' }).click();
await q.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
const omarMe = await q.evaluate(async () => (await fetch('/api/me')).json());
check(omarMe.organisations.some(o => o.id === admin.orgId && o.role === 'admin'), 'they come back to the invitation after signing in, and join as administrator');

// ---- the admin sees both as members; the used link no longer works ----
await page.reload();
const rows = page.locator('.sec', { has: page.getByRole('heading', { name: 'Members', exact: true }) }).locator('tbody tr');
await rows.filter({ hasText: 'Layla' }).waitFor();
check(await page.getByRole('heading', { name: 'Invitations waiting' }).count() === 0, 'both invitations are used: none waiting');
const used = watch(await (await browser.newContext()).newPage());
await used.goto(omarLink);
await used.getByText('This invitation has already been used.').waitFor();
check(true, 'a used link says so');

// ---- the invitation page in Arabic ----
const ar = `noura${stamp}@example.com`;
await page.getByLabel('Email').fill(ar);
await page.getByRole('button', { name: 'Send invitation' }).click();
await page.getByText(/Your plan allows 3 members/).waitFor();
check(true, 'the Free plan stops a fourth member, counting the owner');
await db.query("update organisations set plan = 'team' where id = $1", [admin.orgId]);
await page.getByRole('button', { name: 'Send invitation' }).click();
await page.getByText(`Invitation sent to ${ar}.`).waitFor();
const arCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await arCtx.addInitScript(() => localStorage.setItem('wbs.locale', 'ar'));
const r = watch(await arCtx.newPage());
await r.goto(await knownLink(admin.orgId, ar));
await r.getByRole('heading', { name: 'الانضمام إلى Acme Projects' }).waitFor();
check(await r.evaluate(() => document.documentElement.dir) === 'rtl', 'the invitation page works in Arabic, right to left');
if (shots) await r.screenshot({ path: `${shots}/72-invite-ar.png` });

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await db.end();
await browser.close();
