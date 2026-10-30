// Email confirmation and forgotten passwords from end to end: the banner until the address is confirmed,
// the link that confirms it, and choosing a new password from a reset link.
// Run with DATABASE_URL (the real links are only in the emails, so the test swaps in tokens it knows):
//   node e2e/account.mjs [screenshotDir]
import { createHash, randomBytes } from 'node:crypto';
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
/** A link of this kind for this person, with a token the test knows. */
async function linkFor(email, purpose) {
  const token = `e2e-${randomBytes(12).toString('hex')}`;
  const r = await db.query('update email_tokens set token_hash = $3 where purpose = $2 and user_id = (select id from users where lower(email) = lower($1))',
    [email, purpose, createHash('sha256').update(token).digest('hex')]);
  if (!r.rowCount) throw new Error(`no ${purpose} link for ${email}`);
  return `${BASE}/${purpose}/${token}`;
}
const errors = [];
/** Wait for a message; if it never comes, say what the page shows instead (an error, usually). */
async function see(p, text) {
  try {
    await p.getByText(text).first().waitFor({ timeout: 20_000 });
  } catch {
    const alerts = await p.locator('[role=alert]').allInnerTexts().catch(() => []);
    const body = (await p.textContent('body').catch(() => '') ?? '').replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(`"${text}" did not appear at ${p.url()}; alerts: ${alerts.join(' | ') || 'none'}; page: ${body}; api: ${calls.slice(-12).join(', ')}`);
  }
}
// the page's API calls, to explain a message that never appears
const calls = [];
const watch = p => {
  p.on('pageerror', e => errors.push(e.message));
  p.on('request', r => { if (r.url().includes('/api/')) calls.push(`-> ${r.method()} ${new URL(r.url()).pathname}`); });
  p.on('response', r => { if (r.url().includes('/api/')) calls.push(`<- ${r.status()} ${new URL(r.url()).pathname}`); });
  p.on('requestfailed', r => { if (r.url().includes('/api/')) calls.push(`xx ${new URL(r.url()).pathname} ${r.failure()?.errorText}`); });
  return p;
};

// ---- signing up: a banner until the address is confirmed ----
const email = `leen${stamp}@example.com`;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = watch(await ctx.newPage());
await page.goto(`${BASE}/signup`);
await page.getByLabel('Your name').fill('Leen');
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill('correct horse battery');
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
const banner = page.getByText(`we sent a link to ${email}`);
await banner.waitFor();
check(true, 'after signing up, a banner asks to confirm the email');
if (shots) await page.screenshot({ path: `${shots}/80-confirm-banner.png` });
await page.getByRole('button', { name: 'Send the link again' }).click();
await see(page, 'Sent. Check your inbox.');
check(true, 'the link can be sent again');

const confirmLink = await linkFor(email, 'verify');
await page.goto(confirmLink);
await see(page, 'Thank you, your email address is confirmed.');
await page.getByRole('link', { name: 'Projects' }).last().click();
await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
check(await banner.count() === 0, 'the link confirms the address and the banner goes away');
await page.goto(confirmLink);
await see(page, 'This link has expired or was already used.');
check(true, 'a used confirmation link says so');

// ---- forgotten password ----
const other = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const p = watch(await other.newPage());
await p.goto(`${BASE}/signin`);
await p.getByRole('link', { name: 'Forgot your password?' }).click();
await p.getByLabel('Email').fill(email.toUpperCase());
await p.getByRole('button', { name: 'Send the link' }).click();
await see(p, 'If there is an account for that email');
check(true, 'asking for a reset link gives the same answer whether or not the account exists');
await p.goto(await linkFor(email, 'reset'));
await p.getByRole('heading', { name: 'Choose a new password' }).waitFor();
if (shots) await p.screenshot({ path: `${shots}/81-reset.png` });
await p.getByLabel('New password').fill('a brand new passphrase');
await p.getByRole('button', { name: 'Save and sign in' }).click();
await p.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
check(true, 'a new password from the link signs the person straight in');
await page.goto(`${BASE}/settings`); // a private page: signed out, it sends the browser to sign in
await page.waitForURL(/\/signin$/);
check(true, 'the other browser is signed out after the reset');
const old = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery' }) })).status;
check(old === 401, 'the old password no longer works');

// ---- in Arabic ----
const ar = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ar.addInitScript(() => localStorage.setItem('wbs.locale', 'ar'));
const q = watch(await ar.newPage());
await q.goto(`${BASE}/forgot`);
await q.getByRole('heading', { name: 'نسيت كلمة المرور؟' }).waitFor();
check(await q.evaluate(() => document.documentElement.dir) === 'rtl', 'the forgotten password page works in Arabic, right to left');

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await db.end();
await browser.close();
