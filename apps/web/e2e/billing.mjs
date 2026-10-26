// Billing from end to end: an owner starts a free trial, then buys Business through the (fake)
// Moyasar payment page, comes back to an active plan and opens the invoice.
// Run with e2e/fake-moyasar.mjs running and the API started with its MOYASAR_* settings:
//   node e2e/billing.mjs [screenshotDir]
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const owner = await (await ctx.request.post(`${API}/auth/signup`, { data: { email: `owner${stamp}@example.com`, password: 'correct horse battery', name: 'Noura', organisation: 'Acme Billing' } })).json();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(BASE);
await page.getByRole('link', { name: 'Billing' }).click();
await page.getByRole('heading', { name: 'Billing', exact: true }).waitFor();
await page.getByText('Free plan: up to 3 members').waitFor();
check(true, 'the owner opens Billing and sees the Free plan');

await page.getByRole('button', { name: 'Try Team free for 14 days' }).click();
await page.getByText('Your free trial has started.').waitFor();
await page.getByText(/Free trial of the Team plan until/).waitFor();
check(await page.getByRole('button', { name: /^Try .* free/ }).count() === 0, 'a free trial starts, once');

await page.getByRole('radio', { name: /Business/ }).check();
await page.getByRole('button', { name: 'Monthly' }).click();
await page.getByLabel('Seats').fill('2');
const pay = page.getByRole('button', { name: 'Pay SAR 180.00' });
await pay.waitFor();
check(await page.getByText(/^From .* to /).isVisible(), 'two Business seats for a month are priced at SAR 180.00');
if (shots) await page.screenshot({ path: `${shots}/60-billing-choose.png`, fullPage: true });

await pay.click();
await page.getByRole('heading', { name: 'Moyasar test checkout' }).waitFor();
check((await page.textContent('body')).includes('SAR 180.00'), 'the owner is sent to the Moyasar payment page for the right amount');
await page.getByRole('button', { name: 'Pay' }).click();
await page.waitForURL(/\/billing\/[0-9a-f-]+\?payment=paid/);
await page.getByText('Payment received. Thank you; your plan is active.').waitFor();
await page.getByText(/Business plan, 2 seats, paid until/).waitFor();
check(true, 'after paying, the owner comes back to an active Business plan');
const me = await (await ctx.request.get(`${API}/me`)).json();
check(me.organisations.find(o => o.id === owner.orgId).plan === 'business', 'the organisation is on the Business plan');

const row = page.locator('.rt tbody tr').first();
check(/^INV-\d{6}$/.test((await row.locator('td').first().innerText()).trim()), 'the invoice is listed with its number');
check((await row.innerText()).includes('SAR 180.00'), 'the invoice shows the amount paid');
const [doc] = await Promise.all([ctx.waitForEvent('page'), row.getByRole('link', { name: 'Open' }).click()]);
await doc.waitForLoadState();
const text = await doc.textContent('body');
check(text.includes('Invoice') && !text.includes('Tax invoice') && text.includes('not registered for VAT') && text.includes('Acme Billing'),
  'the invoice opens: a plain invoice without VAT, made out to the organisation');
if (shots) await doc.screenshot({ path: `${shots}/62-invoice.png`, fullPage: true });
await doc.close();
if (shots) await page.screenshot({ path: `${shots}/61-billing-paid.png`, fullPage: true });

// renewing is a separate period that starts when this one ends
const quote = await (await ctx.request.post(`${API}/orgs/${owner.orgId}/billing/quote`, { data: { plan: 'business', interval: 'month', seats: 2, renew: true } })).json();
check(quote.kind === 'renew' && quote.total === 18000, 'a renewal is quoted from the end of the period');

// the page in Arabic, right to left
await page.evaluate(() => localStorage.setItem('wbs.locale', 'ar'));
await page.goto(`${BASE}/billing/${owner.orgId}`);
await page.getByRole('heading', { name: 'الفوترة', exact: true }).waitFor();
check(await page.evaluate(() => document.documentElement.dir) === 'rtl', 'the billing page works in Arabic, right to left');
if (shots) await page.screenshot({ path: `${shots}/63-billing-ar.png`, fullPage: true });

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
