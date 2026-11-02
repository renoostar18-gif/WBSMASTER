// Colour themes from end to end: pick one from the top bar, see the colours change, keep it after a reload, and
// find it again when signing in from another browser. Run with the API serving the built web app:
//   node e2e/themes.mjs [screenshotDir]
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();
const email = `lina${stamp}@example.com`;
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };
const accent = p => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase());
const palette = p => p.evaluate(() => document.documentElement.dataset.palette);

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.request.post(`${API}/auth/signup`, { data: { email, password: 'correct horse battery', name: 'Lina' } });
const page = watch(await ctx.newPage());
await page.goto(BASE);
await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
check(await palette(page) === 'teal' && await accent(page) === '#08776C', 'a new account opens in the original teal');

await page.locator('#palette-button').click();
const options = page.getByRole('radio');
check(await options.count() === 10, 'the colour menu offers ten themes');
if (shots) await page.screenshot({ path: `${shots}/90-palette-menu.png` });
await page.getByRole('radio', { name: 'Ocean' }).click();
check(await palette(page) === 'ocean' && await accent(page) === '#1661B6', 'choosing Ocean changes the colours at once');
check(await page.locator('#palette-button').innerText().then(t => t.includes('Ocean')), 'the button names the active theme');

// the browser-tab icon is the feather, in the theme's colour
const icon = p => p.evaluate(() => decodeURIComponent(document.querySelector('link[rel="icon"]').getAttribute('href')).toUpperCase());
check((await icon(page)).includes('FILL="#1661B6"') && (await icon(page)).includes('ROTATE(24'), 'the tab icon is the feather in the theme colour');
check(await page.locator('.top .mark svg.logo').count() === 1, 'the top bar shows the feather logo');

// the other colours that depend on it: the level colours stay clear of the accent
const levels = await page.evaluate(() => ['--l1', '--l2', '--l3'].map(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim().toUpperCase()));
check(new Set(levels).size === 3 && levels[0] === '#1661B6', 'level 1 follows the accent and the other levels stay different from it');

// Escape closes the menu; dark mode keeps the theme and uses its dark colours
await page.locator('#palette-button').click();
await page.keyboard.press('Escape');
check(await page.getByRole('radiogroup').count() === 0, 'Escape closes the menu');
const modeButton = page.getByRole('button', { name: /^(Auto|Light|Night)$/ });
for (let i = 0; i < 3 && !(await modeButton.innerText()).includes('Night'); i++) await modeButton.click();
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
check(await palette(page) === 'ocean' && await accent(page) === '#6CA7EA', 'in dark mode the same theme uses its dark colours');
check((await icon(page)).includes('FILL="#6CA7EA"'), 'and the tab icon follows it');
while (!(await modeButton.innerText()).includes('Auto')) await modeButton.click();

// kept in this browser...
await page.reload();
await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
check(await palette(page) === 'ocean', 'the theme is still Ocean after a reload');

// ...and on the account: a browser that has never seen it gets it after signing in
const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const q = watch(await other.newPage());
await q.goto(`${BASE}/signin`);
check(await palette(q) === 'teal', 'a fresh browser starts in teal');
await q.getByLabel('Email').fill(email);
await q.getByLabel('Password').fill('correct horse battery');
await q.getByRole('button', { name: 'Sign in', exact: true }).click();
await q.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
await q.waitForFunction(() => document.documentElement.dataset.palette === 'ocean');
check(true, 'signing in from another browser brings the saved theme');

// names in Arabic, right to left
await q.evaluate(() => localStorage.setItem('wbs.locale', 'ar'));
await q.reload();
await q.getByRole('heading', { name: 'المشاريع', exact: true }).waitFor();
await q.locator('#palette-button').click();
check(await q.getByRole('radio', { name: 'محيط' }).count() === 1, 'the theme names are in Arabic when the app is');
if (shots) await q.screenshot({ path: `${shots}/91-palette-menu-ar.png` });
const box = await q.locator('.palette-menu').boundingBox();
check(box && box.x >= 0 && box.x + box.width <= 1280, 'the menu stays inside the window in right-to-left');

// phone width
await page.setViewportSize({ width: 390, height: 800 });
await page.locator('#palette-button').click();
const pb = await page.locator('.palette-menu').boundingBox();
check(pb && pb.x >= 0 && pb.x + pb.width <= 390, 'the menu fits on a phone');
if (shots) await page.screenshot({ path: `${shots}/92-palette-menu-phone.png` });

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
