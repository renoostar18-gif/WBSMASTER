// End-to-end smoke test: sign up, build a small WBS, link, undo/redo, reload, Arabic.
// Run with the API on :3000 and `vite` on :5173:  node e2e/smoke.mjs [screenshotDir]
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// failed requests are judged by URL below; other console errors fail the test
page.on('console', m => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
page.on('response', r => {
  const expected = r.status() === 401 && r.url().endsWith('/api/me'); // signed-out check on first load
  if (r.status() >= 400 && !expected) errors.push(`${r.status()} ${r.url()}`);
});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const shot = async name => shots && page.screenshot({ path: `${shots}/${name}.png` });

await page.goto(`${BASE}/signup`);
const email = `e2e${Date.now()}@example.com`;
await page.getByLabel('Your name').fill('Rayan');
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill('correct horse battery');
await page.getByLabel('Organisation name (optional)').fill('Acme Switchgear');
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Projects' }).waitFor();
check(true, 'sign-up lands on the projects page');

await page.getByLabel('Project name').fill('24 kV RMU development');
await page.getByRole('button', { name: 'New project' }).click();
await page.getByText('No items yet').waitFor();
check(true, 'new project opens empty');

// Level 1 "Design", child "Electrical design", Enter → sibling "Mechanical design"
await page.getByRole('button', { name: '+ Add Level 1 item' }).click();
let name = page.locator('input[data-name]:focus');
await name.fill('Design');
await name.press('Tab'); // leaves the field (commits)
const design = page.locator('tr', { has: page.locator('input[value="Design"]') });
await design.locator('button.rowadd').click();
name = page.locator('input[data-name]:focus');
await name.fill('Electrical design');
await name.press('Enter'); // commits and adds a sibling
name = page.locator('input[data-name]:focus');
await name.fill('Mechanical design');
await name.press('Enter');
name = page.locator('input[data-name]:focus');
await name.fill('Type test certificate');
await name.press('Tab');
await page.locator('body').click({ position: { x: 5, y: 5 } });
const codes = await page.locator('td.code').allInnerTexts();
check(codes.map(c => c.trim()).join(',') === '1,1.1,1.2,1.3', `WBS codes are 1, 1.1, 1.2, 1.3 (got ${codes.join(',')})`);

// planned dates (Sun–Thu weeks) for the two design items
const row = n => page.locator('tr', { has: page.locator(`input[value="${n}"]`) });
async function setDate(n, idx, value) {
  const input = row(n).locator('input[type=date]').nth(idx);
  await input.fill(value);
  await input.press('Enter');
}
await setDate('Electrical design', 0, '2026-10-18');
await setDate('Electrical design', 1, '2026-10-22');
await setDate('Mechanical design', 0, '2026-10-25');
await setDate('Mechanical design', 1, '2026-10-29');
await page.waitForTimeout(300);
check(await row('Mechanical design').locator('input[type=date]').nth(3).inputValue() === '2026-10-29', 'planned finish fills the forecast');

// link mechanical to wait for electrical (1.1), then slip electrical by one working day over the weekend
const deps = row('Mechanical design').locator('input[aria-label="Depends on"]');
await deps.fill('1.1');
await deps.press('Enter');
const elecForecastFinish = row('Electrical design').locator('input[type=date]').nth(3);
await elecForecastFinish.fill('2026-10-25');
await elecForecastFinish.press('Enter');
await page.getByText('linked items moved').waitFor();
check(await row('Mechanical design').locator('input[type=date]').nth(2).inputValue() === '2026-10-26', 'auto-schedule moves the successor to Monday 26 Oct');
check(await row('Mechanical design').locator('input[type=date]').nth(3).inputValue() === '2026-11-01', '…keeping 5 working days (finish Sunday 1 Nov)');
check((await row('Electrical design').locator('.var').innerText()).trim() === '+1d', 'variance is +1 working day');
check(await page.locator('.cp').count() >= 2, 'critical path is marked');
await shot('1-table');

// undo the slip: both items go back
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(400);
check(await elecForecastFinish.inputValue() === '2026-10-22', 'undo restores the electrical finish');
check(await row('Mechanical design').locator('input[type=date]').nth(2).inputValue() === '2026-10-25', 'undo restores the mechanical start');
await page.getByRole('button', { name: 'Redo' }).click();
await page.waitForTimeout(400);
check(await row('Mechanical design').locator('input[type=date]').nth(2).inputValue() === '2026-10-26', 'redo moves it again');

// keyboard: select the certificate and outdent it to Level 1
await row('Type test certificate').locator('td.code').click();
await page.keyboard.press('Alt+Shift+ArrowLeft');
await page.waitForTimeout(300);
const codes2 = (await page.locator('td.code').allInnerTexts()).map(c => c.trim().replace(/\s*CP$/, ''));
check(codes2.join(',') === '1,1.1,1.2,2', `Alt+Shift+← outdents to Level 1 (got ${codes2.join(',')})`);

// everything was saved: reload and compare
await page.waitForSelector('.status[data-s="saved"]');
await page.reload();
await page.locator('td.code').first().waitFor();
check(await row('Mechanical design').locator('input[type=date]').nth(2).inputValue() === '2026-10-26', 'after reload the server has the same schedule');

// Arabic, right to left
await page.getByRole('button', { name: 'العربية' }).click();
check(await page.evaluate(() => document.documentElement.dir) === 'rtl', 'Arabic switches the page to right-to-left');
await page.getByText('المستويات').waitFor();
await row('Electrical design').locator('td.code').click();
await shot('2-arabic');
await page.getByRole('button', { name: 'English' }).click();

check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
