// The public site: the landing page with pricing for visitors, the draft Terms and Privacy pages,
// Arabic right to left, light and dark, and no sideways scrolling on a phone. Signed in, / is still the projects page.
//   node e2e/site.mjs [screenshotDir]
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const errors = [];
const watch = p => {
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  return p;
};
/** A visitor's browser, in a language and colour scheme, with nothing remembered. */
async function visitor({ width = 1280, height = 900, locale = 'en', scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: locale === 'ar' ? 'ar-SA' : 'en-GB' });
  await ctx.addInitScript(l => { try { if (!localStorage.getItem('wbs.locale')) localStorage.setItem('wbs.locale', l); } catch { /* blocked */ } }, locale);
  return { ctx, page: watch(await ctx.newPage()) };
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page, name, fullPage = true) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage });

// ---- a visitor sees the landing page, with pricing ----
const { ctx: enCtx, page } = await visitor();
await page.goto(BASE);
await page.getByRole('heading', { level: 1, name: 'Plan every project from one work breakdown structure.' }).waitFor();
check(new URL(page.url()).pathname === '/', 'a signed-out visitor at / stays on / and sees the landing page');
check(await page.getByRole('link', { name: 'Start free' }).first().getAttribute('href') === '/signup', 'the main call to action goes to sign-up');
check(await page.title() === 'WBS Master: project planning for Saudi and GCC teams', 'the page has a descriptive title');
check(await page.locator('meta[name="description"]').count() === 1 && await page.locator('meta[property="og:title"]').count() === 1, 'the page has a description and Open Graph tags');
await page.getByRole('heading', { name: 'Simple pricing per user' }).waitFor();
const team = page.getByTestId('price-team');
const business = page.getByTestId('price-business');
check(await team.textContent() === 'SAR 45' && await business.textContent() === 'SAR 90', 'monthly prices: Team SAR 45, Business SAR 90 per user');
check(await page.getByText('Prices exclude VAT. 15% VAT is added at checkout.').isVisible(), 'prices say VAT is extra');
await shot(page, 'site-en-light-desktop');
await page.getByRole('button', { name: /^Yearly/ }).click();
check(await team.textContent() === 'SAR 36' && await business.textContent() === 'SAR 72', 'yearly prices: Team SAR 36, Business SAR 72 per user a month');
check(await page.getByText('Billed yearly: SAR 432 per user').isVisible(), 'the yearly total is shown');
await page.getByRole('button', { name: 'Monthly' }).click();
check(await team.textContent() === 'SAR 45', 'switching back to monthly restores the monthly price');
await page.getByText('How does the free trial work?').click();
check(await page.getByText(/14-day free trial for your organisation/).isVisible(), 'the FAQ answers open');
check(!(await page.getByText(/testimonial|trusted by/i).count()), 'no testimonials or invented claims');
await page.goto(`${BASE}/pricing`);
await page.getByRole('heading', { name: 'Simple pricing per user' }).waitFor();
check(await page.evaluate(() => document.getElementById('pricing').getBoundingClientRect().top < 200), '/pricing opens at the pricing section');

// ---- terms and privacy, linked from the footer ----
await page.goto(BASE);
await page.getByRole('contentinfo').getByRole('link', { name: 'Terms of Service' }).click();
await page.getByRole('heading', { level: 1, name: 'Terms of Service' }).waitFor();
check(await page.getByRole('note').textContent() === 'Draft — to be reviewed by a qualified lawyer before publication.', '/terms shows the draft notice');
check(await page.getByRole('heading', { name: /Governing law/ }).isVisible(), 'the terms cover governing law');
check(await page.getByText('Refund policy to be confirmed').isVisible(), 'placeholders are marked');
await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' }).click();
await page.getByRole('heading', { level: 1, name: 'Privacy Policy' }).waitFor();
check(await page.getByRole('note').isVisible() && page.url().endsWith('/privacy'), '/privacy loads with the draft notice');
check(await page.getByText('wbs_session').isVisible() && await page.getByText(/me-central2/).isVisible(), 'the policy names the session cookie and the Saudi region');
await shot(page, 'site-privacy-en');
await page.goto(`${BASE}/terms`);
check(await page.getByRole('note').isVisible(), '/terms loads directly');

// ---- sign-up links to them ----
await page.goto(`${BASE}/signup`);
const agree = page.locator('.agree');
check(await agree.getByRole('link', { name: 'Terms of Service' }).getAttribute('href') === '/terms'
  && await agree.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href') === '/privacy', 'sign-up says you agree to the Terms and Privacy Policy, with links');
check(await page.getByRole('contentinfo').isVisible(), 'sign-up has the site footer');
await enCtx.close();

// ---- Arabic, right to left, dark ----
const { ctx: arCtx, page: ar } = await visitor({ locale: 'ar', scheme: 'dark' });
await ar.goto(BASE);
await ar.getByRole('heading', { level: 1, name: 'خطِّط كل مشروع من هيكل تجزئة عمل واحد.' }).waitFor();
check(await ar.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'), 'Arabic is right to left');
check(await ar.getByTestId('price-team').textContent() === '45 ر.س', 'Arabic prices in riyals');
await ar.getByRole('button', { name: /^سنوي/ }).click();
check(await ar.getByTestId('price-team').textContent() === '36 ر.س', 'the Arabic yearly toggle works');
const bg = await ar.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(bg === 'rgb(9, 14, 19)', 'the dark theme applies');
await shot(ar, 'site-ar-dark-desktop');
await ar.goto(`${BASE}/terms`);
await ar.getByRole('heading', { level: 1, name: 'شروط الخدمة' }).waitFor();
check(await ar.getByRole('note').textContent() === 'مسودة — تجب مراجعتها من محامٍ مؤهل قبل النشر.', 'the Arabic terms show the Arabic draft notice');
await shot(ar, 'site-terms-ar-dark');
await ar.getByRole('button', { name: 'Read in English' }).click();
await ar.getByRole('heading', { level: 1, name: 'Terms of Service' }).waitFor();
check(true, 'the terms switch to English in place');
// the language toggle in the top bar works on the landing page too (the page above left it in English)
await ar.goto(BASE);
await ar.getByRole('heading', { level: 1, name: 'Plan every project from one work breakdown structure.' }).waitFor();
await ar.getByRole('button', { name: 'العربية' }).click();
await ar.getByRole('heading', { level: 1, name: 'خطِّط كل مشروع من هيكل تجزئة عمل واحد.' }).waitFor();
check(await ar.evaluate(() => document.documentElement.dir === 'rtl'), 'the top-bar language button switches the landing page');
await arCtx.close();

// ---- phones: nothing scrolls sideways ----
for (const [locale, scheme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
  const { ctx, page: m } = await visitor({ width: 375, height: 812, locale, scheme });
  for (const path of ['/', '/terms', '/privacy', '/signup']) {
    await m.goto(`${BASE}${path}`);
    await m.locator('h1').first().waitFor();
    check(await noSideScroll(m), `no sideways scroll at 375px: ${path} (${locale}, ${scheme})`);
    if (path === '/') await shot(m, `site-${locale}-${scheme}-375`);
  }
  await ctx.close();
}

// ---- signed in, / is still the projects page ----
const userCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await userCtx.request.post(`${API}/auth/signup`, { data: { email: `site${Date.now()}@example.com`, password: 'correct horse battery', name: 'Sara' } });
const u = watch(await userCtx.newPage());
await u.goto(BASE);
await u.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
check(!(await u.getByText('Simple pricing per user').count()), 'signed in, / shows the projects page, not the landing page');
await u.goto(`${BASE}/terms`);
await u.getByRole('heading', { level: 1, name: 'Terms of Service' }).waitFor();
check(await u.getByRole('link', { name: 'Your projects' }).isVisible(), 'signed in, the terms page offers the way back to projects');
await u.getByRole('button', { name: 'Sign out' }).click();
await u.goto(BASE);
await u.getByRole('heading', { level: 1, name: 'Plan every project from one work breakdown structure.' }).waitFor();
check(true, 'after signing out, / shows the landing page again');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
