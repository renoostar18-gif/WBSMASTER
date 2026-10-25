import { type Baseline, type ComputedProject, type WbsItem, EDITABLE_COLUMNS, baselineFinish, workbookRows } from '@wbs-master/engine';
import type { I18n } from '../i18n.js';
import type { Summary } from './store.js';

export interface SheetData { name: string; rows: unknown[][] }

/** ExcelJS is large, so it loads only when someone imports or exports. */
const excel = () => import('exceljs').then(m => (m.default ?? m) as typeof import('exceljs'));

/** A cell's plain value: formulas give their result, rich text its text, links their text. */
function plain(v: unknown): unknown {
  if (v == null) return '';
  if (v instanceof Date || typeof v !== 'object') return v;
  const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
  if ('result' in o) return plain(o.result);
  if (o.richText) return o.richText.map(t => t.text).join('');
  if ('text' in o) return plain(o.text);
  if ('error' in o) return '';
  return String(v);
}

/** Minimal CSV reader: quoted fields, doubled quotes, commas or semicolons, CRLF. */
export function parseCsv(text: string): unknown[][] {
  const t = text.replace(/^﻿/, '');
  const sep = (t.split('\n')[0] ?? '').split(';').length > (t.split('\n')[0] ?? '').split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(c => (c.trim() !== '' && /^-?\d+(\.\d+)?$/.test(c.trim()) ? Number(c) : c)));
}

/** Read an .xlsx/.xlsm or .csv file into sheets of rows. Old .xls files must be saved as .xlsx first. */
export async function readSpreadsheet(file: File): Promise<SheetData[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return [{ name: file.name.replace(/\.csv$/i, ''), rows: parseCsv(await file.text()) }];
  if (name.endsWith('.xls')) throw new Error('xls_unsupported');
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('unreadable_file');
  }
  return wb.worksheets.map(ws => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = (row.values as unknown[]).slice(1).map(plain);
      rows[n - 1] = values;
    });
    for (let k = 0; k < rows.length; k++) rows[k] ??= [];
    return { name: ws.name, rows };
  });
}

const DATE_COLS = new Set([8, 9, 10, 11, 12, 13]); // Planned/Forecast/Actual start and finish (0-based)
const isoToDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v);

/** The connected workbook (spec 6.2): edit it in Excel, then import it to bring the changes back. */
export async function writeWorkbook(p: {
  projectId: string; name: string; items: WbsItem[]; computed: ComputedProject; summary: Summary; baselines: Baseline[]; i18n: I18n;
}): Promise<Blob> {
  const ExcelJS = await excel();
  const { t, dir } = p.i18n;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WBS Master';
  wb.created = new Date();
  const views = [{ state: 'frozen' as const, ySplit: 1, rightToLeft: dir === 'rtl' }];

  const rows = workbookRows(p.projectId, p.name, p.items, p.computed);
  const ws = wb.addWorksheet('WBS', { views });
  rows.forEach((r, k) => ws.addRow(k === 0 ? r : r.map((v, c) => (DATE_COLS.has(c) ? isoToDate(v) : v))));
  const widths = [12, 26, 38, 9, 6, 44, 16, 14, 13, 13, 13, 13, 13, 13, 10, 16, 32, 13, 11, 14, 10, 14];
  ws.columns.forEach((col, c) => {
    col.width = widths[c] ?? 12;
    if (DATE_COLS.has(c)) col.numFmt = 'dd-mmm-yyyy';
    if (c >= EDITABLE_COLUMNS) col.font = { color: { argb: 'FF6B7A84' }, italic: true };
  });
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0]!.length } };
  // indent item names by level so the tree reads in Excel
  for (let r = 2; r <= rows.length; r++) {
    const level = Number(ws.getCell(r, 5).value) || 1;
    ws.getCell(r, 6).alignment = { indent: Math.min(level - 1, 10) };
  }

  const ss = wb.addWorksheet('Summary', { views: [{ rightToLeft: dir === 'rtl' }] });
  ss.columns = [{ width: 34 }, { width: 100 }];
  ss.addRow([p.name]).font = { bold: true, size: 14 };
  for (const [label, key] of [[t('summaryH'), 'narrative'], [t('sec_achievements'), 'achievements'], [t('sec_nextSteps'), 'nextSteps'], [t('sec_risks'), 'risks'], [t('sec_decisions'), 'decisions']] as const) {
    const row = ss.addRow([label, p.summary[key]]);
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(1).font = { bold: true };
  }

  const bs = wb.addWorksheet('Baselines', { views: [{ rightToLeft: dir === 'rtl' }] });
  bs.columns = [{ width: 30 }, { width: 14, style: { numFmt: 'dd-mmm-yyyy' } }, { width: 50 }, { width: 16, style: { numFmt: 'dd-mmm-yyyy' } }, { width: 8 }];
  bs.addRow([t('baselines'), t('setOn'), t('reason'), t('plannedFinish'), t('items')]).font = { bold: true };
  for (const b of p.baselines) bs.addRow([b.name, isoToDate(b.setOn), b.reason, isoToDate(baselineFinish(b)), Object.keys(b.items).length]);

  const rm = wb.addWorksheet(t('xlReadMe').slice(0, 31), { views: [{ rightToLeft: dir === 'rtl' }] });
  rm.columns = [{ width: 120 }];
  for (const key of ['xlReadMe1', 'xlReadMe2', 'xlReadMe3', 'xlReadMe4', 'xlReadMe5', 'xlReadMe6'] as const) rm.addRow([t(key)]);
  rm.getRow(1).font = { bold: true, size: 13 };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Save a file with the browser's download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Project';
