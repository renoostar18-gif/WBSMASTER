import { type IsoDate, dayFromParts, toIso } from './dates.js';
import type { Status } from './types.js';

/** Day-first (31/12/2026, Saudi and UK) or month-first (12/31/2026, US). Set from the user's locale. */
export type DateOrder = 'dmy' | 'mdy';

const EXCEL_EPOCH_OFFSET = 25569; // days from 1899-12-30 to 1970-01-01

function valid(y: number, m: number, d: number): IsoDate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const day = dayFromParts(y, m, d);
  const iso = toIso(day)!;
  return iso === `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` ? iso : null;
}

/** Parse a spreadsheet date cell (spec 6.1). Returns null when it is not a date. */
export function parseDate(v: unknown, order: DateOrder = 'dmy'): IsoDate | null {
  if (v === '' || v == null) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return valid(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') return v > 20000 && v < 80000 ? toIso(Math.round(v) - EXCEL_EPOCH_OFFSET) : null;
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    let y = +m[3]!;
    if (y < 100) y += 2000;
    const [d, mo] = order === 'dmy' ? [+m[1]!, +m[2]!] : [+m[2]!, +m[1]!];
    return valid(y, mo, d);
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/** 0–100 from 45, "45%", or a fraction 0.45. */
export function parseProgress(v: unknown): number {
  if (v === '' || v == null) return 0;
  let n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', ''));
  if (isNaN(n)) return 0;
  if (typeof v === 'number' && n > 0 && n <= 1) n *= 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Status words to a status; anything unknown is 'auto'. English and Arabic. */
export function parseStatus(v: unknown): Status {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s) return 'auto';
  if (/cancel|ملغ/.test(s)) return 'cancelled';
  if (/hold|suspend|معلق|متوقف/.test(s)) return 'on_hold';
  if (/not ?started|لم يبدأ/.test(s)) return 'not_started';
  if (/complete|done|closed|finish|مكتمل|منجز/.test(s)) return 'completed';
  if (/progress|ongoing|wip|started|active|جار/.test(s)) return 'in_progress';
  if (/open|planned|pending|مخطط/.test(s)) return 'not_started';
  return 'auto';
}

export type ImportField =
  | 'deps' | 'code' | 'level' | 'status' | 'plannedStart' | 'plannedFinish' | 'actualStart' | 'actualFinish'
  | 'forecastStart' | 'forecastFinish' | 'owner' | 'progress' | 'notes' | 'name';

/** Header patterns in detection order: specific date columns before generic start/finish (spec 6.1). */
const DETECT: [ImportField, RegExp][] = [
  ['deps', /predecessor|depends|dependenc|السابق/i],
  ['code', /^wbs|wbs ?(code|no|#)|^code$|outline ?num|^رمز/i],
  ['level', /^level|lvl|depth|outline ?level|المستوى/i],
  ['status', /status|state|الحالة/i],
  ['plannedStart', /(baseline|planned|plan)\W*(start|begin)|(start|begin)\W*(baseline|plan)|بداية مخطط/i],
  ['plannedFinish', /(baseline|planned|plan)\W*(end|finish|due|complet)|(end|finish)\W*(baseline|plan)|نهاية مخطط/i],
  ['actualStart', /actual\W*(start|begin)|(start|begin)\W*actual|بداية فعلي/i],
  ['actualFinish', /actual\W*(end|finish|complet)|(end|finish)\W*actual|نهاية فعلي/i],
  ['forecastStart', /start|begin|بداية|البدء/i],
  ['forecastFinish', /end|finish|due|deadline|نهاية|الانتهاء/i],
  ['owner', /owner|responsib|assignee|lead|resource|المسؤول/i],
  ['progress', /progress|complete|%|نسبة|الإنجاز/i],
  ['notes', /note|remark|comment|ملاحظ/i],
  ['name', /task|activity|item|name|deliverable|description|title|work ?package|scope|المهمة|النشاط|البند|الاسم/i],
];

/** Suggest a column index for each field from header names. Each column is used once. */
export function detectColumns(headers: string[]): Partial<Record<ImportField, number>> {
  const used = new Set<number>();
  const out: Partial<Record<ImportField, number>> = {};
  for (const [field, re] of DETECT) {
    const i = headers.findIndex((h, j) => !used.has(j) && re.test(String(h).trim()));
    if (i >= 0) { out[field] = i; used.add(i); }
  }
  return out;
}

/** Index of the header row: the first of the top 10 rows with at least 2 text cells. */
export function detectHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if ((rows[i] ?? []).filter(c => typeof c === 'string' && c.trim()).length >= 2) return i;
  }
  return 0;
}
