// Notifications: a mention and an assignment reach the other person's bell, open the right item, and the email setting sticks.
// Run with the API and web app running:  node e2e/notifications.mjs [screenshotDir]
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const API = `${BASE}/api`;
const shots = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const stamp = Date.now();

async function account(name) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const r = await ctx.request.post(`${API}/auth/signup`, { data: { email: `${name.split(' ')[0].toLowerCase()}${stamp}@example.com`, password: 'correct horse battery', name } });
  return { ctx, body: await r.json() };
}
const a = await account('Rayan Hamdan');
const b = await account(`Sara Ahmed ${stamp}`);
const sara = b.body.user;
const orgId = a.body.orgId;
const post = (url, data) => a.ctx.request.post(`${API}${url}`, { data }).then(r => r.json());
const project = await post(`/orgs/${orgId}/projects`, { name: 'Substation upgrade' });
await post(`/orgs/${orgId}/members`, { email: sara.email, role: 'member' });
await a.ctx.request.put(`${API}/projects/${project.id}/members/${sara.id}`, { data: { role: 'editor' } });
const fat = crypto.randomUUID(), site = crypto.randomUUID();
await post(`/projects/${project.id}/ops`, { ops: [
  { op: 'add', id: fat, parentId: null, values: { name: 'Factory acceptance test' } },
  { op: 'add', id: site, parentId: null, values: { name: 'Site commissioning' } },
] });

const pa = await a.ctx.newPage(), pb = await b.ctx.newPage();
const errors = [];
for (const p of [pa, pb]) p.on('pageerror', e => errors.push(e.message));
await pb.goto(BASE);
await pb.locator('.bell > .btn').waitFor();
check(await pb.locator('.bell .count').count() === 0, 'Sara starts with no unread notifications');

// Rayan mentions Sara on the second item, and assigns her the first by typing her name as owner
await pa.goto(`${BASE}/p/${project.id}`);
await pa.locator('td.code').nth(1).click();
await pa.locator('.insp').getByRole('button', { name: 'Comments' }).click();
const box = pa.locator('.comments textarea').first();
await box.fill('Can you book the commissioning team @Sara');
await pa.locator('.mentions button').first().click();
await box.press('Control+Enter');
await pa.locator('.thread .mention').waitFor();
await pa.locator('td.code').first().click();
await pa.getByRole('button', { name: 'Close' }).click();
const owner = pa.locator('.insp input').nth(1);
await owner.fill(sara.name);
await owner.press('Enter');
await pa.getByText('Saved').waitFor();

// Sara's bell counts both when she comes back to the page
await pb.reload();
await pb.locator('.bell .count', { hasText: '2' }).waitFor({ timeout: 5000 });
check(true, 'Sara’s bell shows 2 unread');
await pb.locator('.bell > .btn').click();
const items = pb.locator('.nlist li');
await items.first().waitFor();
const texts = await items.allInnerTexts();
check(texts[0].includes('Rayan Hamdan assigned Factory acceptance test in Substation upgrade to you'), 'the assignment is listed first');
check(texts[1].includes('Rayan Hamdan mentioned you on Site commissioning in Substation upgrade'), 'the mention is listed with the comment');
if (shots) await pb.screenshot({ path: `${shots}/30-bell.png` });

// the mention opens the project on the item, with its comments
await items.nth(1).locator('button').click();
await pb.waitForURL(`**/p/${project.id}?item=${site}&panel=comments`);
await pb.locator('.comments .thread').getByText('Can you book the commissioning team').waitFor();
check(await pb.locator('.comments .seg button[aria-pressed="true"]').innerText() === 'Selected item', 'it opens the item’s comments');
check(await pb.locator(`tr[data-id="${site}"].sel`).count() === 1, 'and selects the item');
await pb.locator('.bell .count', { hasText: '1' }).waitFor();
check(true, 'opening one marks it read');

// mark all read, and choose a daily digest
await pb.locator('.bell > .btn').click();
await pb.getByRole('button', { name: 'Mark all as read' }).click();
await pb.locator('.bell .count').waitFor({ state: 'detached' });
check(true, 'mark all as read clears the count');
await pb.locator('.bell-menu select').selectOption('daily');
await pb.reload();
await pb.locator('.bell > .btn').click();
check(await pb.locator('.bell-menu select').inputValue() === 'daily', 'the email setting is saved');

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
