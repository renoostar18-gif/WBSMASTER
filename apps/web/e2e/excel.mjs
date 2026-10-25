// Excel round trip: import a plain sheet as a new project, export the connected workbook,
// edit it like a person would, re-import with a change preview, apply, undo.
// Run with the API and web app running:  node e2e/excel.mjs [screenshotDir]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const shots = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'wbs-excel-'));
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

// a plain plan as people keep it in Excel: a title row, phases as merged-looking cells, real dates, % as fractions
const plain = new ExcelJS.Workbook();
const ws = plain.addWorksheet('Plan');
ws.addRow(['RMU development plan']);
ws.addRow([]);
ws.addRow(['Phase', 'Task', 'Owner', 'Start', 'Finish', '% Complete', 'Predecessors']);
const d = s => new Date(`${s}T00:00:00Z`);
ws.addRow(['Design', 'Single-line diagram', 'R&D', d('2026-07-26'), d('2026-08-20'), 1, '']);
ws.addRow(['', 'Busbar design', 'R&D', d('2026-08-16'), d('2026-09-24'), 0.85, '1.1']);
ws.addRow(['Testing', 'Prototype build', 'Industrialization', d('2026-10-25'), d('2026-11-26'), 0, '1.2']);
ws.addRow(['', 'Type tests', 'R&D', d('2026-11-29'), d('2027-01-14'), 0, '2.1']);
const plainPath = join(dir, 'RMU plan.xlsx');
await plain.xlsx.writeFile(plainPath);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const r = await ctx.request.post(`${BASE}/api/auth/signup`, { data: { email: `xl${Date.now()}@example.com`, password: 'correct horse battery', name: 'Rayan' } });
check(r.ok(), 'signed up');
await page.goto(BASE);
await page.getByRole('heading', { name: 'Projects' }).waitFor();

// 1. new project from a plain sheet
await page.getByRole('button', { name: 'New project from Excel' }).click();
await page.locator('input[type=file]').setInputFiles(plainPath);
await page.getByText('How should the levels be built?').waitFor();
check(await page.locator('.seg.wrap-seg button[aria-pressed="true"]').innerText().then(x => x.startsWith('2 levels')), 'it suggests 2 levels from the Phase column');
check(await page.getByText('4 rows · 2 groups · 2 levels').count() === 1, 'the preview counts 4 rows in 2 groups');
await shot(page, '10-import-mapping');
await page.getByRole('button', { name: 'Import', exact: true }).click();
await page.locator('td.code').first().waitFor();
const codes = (await page.locator('td.code').allInnerTexts()).map(c => c.trim().replace(/\s*CP$/, ''));
check(codes.join(',') === '1,1.1,1.2,2,2.1,2.2', `the new project has the phases as Level 1 (got ${codes.join(',')})`);
const row = n => page.locator('tr', { has: page.locator(`input[value="${n}"]`) });
check(await row('Busbar design').locator('input.pct').inputValue() === '85', '85% read from the fraction 0.85');
check(await row('Prototype build').locator('input[aria-label="Depends on"]').inputValue() === '1.2', 'links are read from WBS codes');

// 2. export the connected workbook
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
const exported = join(dir, 'exported.xlsx');
await download.saveAs(exported);
check(download.suggestedFilename().endsWith('.xlsx'), `the workbook downloads (${download.suggestedFilename()})`);

// 3. edit it like a person would: rename, change a date, add a row, delete a row
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(exported);
const sheet = wb.getWorksheet('WBS');
check(!!sheet && ['Summary', 'Baselines'].every(n => wb.getWorksheet(n)), 'it has the WBS, Summary and Baselines sheets');
const header = sheet.getRow(1).values;
const col = name => header.indexOf(name);
let typeTests = 0, busbar = 0;
sheet.eachRow((r, n) => { if (r.getCell(col('Item Name')).value === 'Type tests') typeTests = n; if (r.getCell(col('Item Name')).value === 'Busbar design') busbar = n; });
sheet.getRow(busbar).getCell(col('Item Name')).value = 'Busbar & insulation design';
sheet.getRow(busbar).getCell(col('Forecast Finish')).value = d('2026-10-08');
sheet.spliceRows(typeTests, 1);
const added = sheet.addRow([]);
added.getCell(col('Level')).value = 2;
added.getCell(col('Item Name')).value = 'Type test certificate';
added.getCell(col('Forecast Start')).value = d('2027-01-17');
added.getCell(col('Forecast Finish')).value = d('2027-01-17');
const edited = join(dir, 'edited.xlsx');
await wb.xlsx.writeFile(edited);

// 4. re-import: preview, apply, undo
await page.getByRole('button', { name: 'Import Excel' }).click();
await page.locator('input[type=file]').setInputFiles(edited);
await page.getByText('These are the changes').waitFor();
const summary = await page.locator('.diff b').innerText();
check(summary === '1 changed · 1 added · 1 removed', `the preview shows the changes (${summary})`);
await shot(page, '11-import-preview');
await page.getByRole('button', { name: 'Apply changes' }).click();
await row('Busbar & insulation design').waitFor();
check(await row('Busbar & insulation design').locator('input[type=date]').nth(3).inputValue() === '2026-10-08', 'the new name and finish date are applied');
check(await row('Type test certificate').count() === 1 && await row('Type tests').count() === 0, 'the added row is in and the deleted row is gone');
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.getByRole('button', { name: 'Undo' }).click();
await row('Busbar design').waitFor();
check(await row('Type tests').count() === 1 && await row('Type test certificate').count() === 0, 'one Undo reverses the whole import');
await page.waitForSelector('.status[data-s="saved"]');
await page.reload();
await row('Busbar design').waitFor();
check(await row('Type tests').count() === 1, 'the undo is saved on the server');
check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
