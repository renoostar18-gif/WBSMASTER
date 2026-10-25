import type { ComputedProject } from './types.js';
import { toIso } from './dates.js';
import { formatDeps } from './deps.js';
import { blankItem } from './edits.js';
import { type DateOrder, type ImportField, parseDate, parseProgress, parseStatus } from './importing.js';
import { Tree } from './tree.js';
import type { Status, WbsItem } from './types.js';

/** A spreadsheet as rows of cell values (strings, numbers, Dates or empty). */
export type Sheet = unknown[][];
export type Mapping = Partial<Record<ImportField, number>>;
/** How the WBS levels are built (spec 6.1). */
export type HierarchyMode = 'code' | 'num' | '1' | '2' | '3';

export interface GroupColumn { index: number; name: string; groups: number }

const cellText = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const GROUP_WORDS = /phase|stage|category|group|work ?stream|package|area|section|discipline|module|system|epic|department|function|gate|sub ?system|مرحلة|المرحلة|القسم|الحزمة|المجموعة/i;

/** Data rows below the header that have at least one non-empty cell. */
function body(rows: Sheet, header: number): unknown[][] {
  return rows.slice(header + 1).filter(r => r.some(c => cellText(c) !== ''));
}

/** Header names, with "Column C" for empty ones. */
export function headerNames(rows: Sheet, header: number): string[] {
  const h = rows[header] ?? [];
  const width = Math.max(h.length, ...rows.slice(header + 1, header + 50).map(r => r.length));
  return Array.from({ length: width }, (_, i) => cellText(h[i]) || `Column ${columnLetter(i)}`);
}

export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Columns that group rows (Phase, Workstream…), numbering such as "1.2 Design"
 * in the names, and the suggested hierarchy mode (prototype analyzeHier).
 * Empty cells take the value above, like merged cells.
 */
export function analyzeHierarchy(rows: Sheet, header: number, mapping: Mapping) {
  const names = headerNames(rows, header);
  const data = body(rows, header);
  const used = new Set(Object.values(mapping).filter((v): v is number => v != null));
  const cands: (GroupColumn & { values: string[]; keyword: boolean })[] = [];
  names.forEach((name, j) => {
    if (used.has(j)) return;
    let last = '';
    const values = data.map(r => { const v = cellText(r[j]); if (v) last = v; return v || last; });
    const filled = values.filter(Boolean);
    if (filled.length < data.length * 0.6 || filled.some(v => v.length > 80)) return;
    if (filled.filter(v => /^[\d.,\-/: %]+$/.test(v)).length > filled.length * 0.5) return;
    const groups = new Set(filled).size;
    if (groups < 2 || groups >= data.length || groups > Math.max(4, data.length * 0.75)) return;
    cands.push({ index: j, name, groups, values, keyword: GROUP_WORDS.test(name) });
  });
  const nestedIn = (c: (typeof cands)[number], p: (typeof cands)[number]) => {
    const m = new Map<string, Set<string>>();
    c.values.forEach((v, i) => { if (!v) return; if (!m.has(v)) m.set(v, new Set()); m.get(v)!.add(p.values[i]!); });
    let ok = 0;
    m.forEach(s => { if (s.size === 1) ok++; });
    return ok >= m.size * 0.9;
  };
  const g1 = [...cands].sort((a, b) => Number(b.keyword) - Number(a.keyword) || a.groups - b.groups)[0];
  const g2 = g1 ? [...cands].sort((a, b) => a.groups - b.groups).find(c => c !== g1 && c.groups > g1.groups && nestedIn(c, g1)) : undefined;
  const nameCol = mapping.name;
  const titles = nameCol == null ? [] : data.map(r => cellText(r[nameCol])).filter(Boolean);
  const numbered = titles.length > 1
    && titles.filter(s => /^\d+(\.\d+)*[.)]?\s+\S/.test(s)).length >= titles.length * 0.6
    && titles.some(s => /^\d+\.\d+/.test(s));
  const hasCode = mapping.code != null || mapping.level != null;
  const suggested: HierarchyMode = hasCode ? 'code' : numbered ? 'num' : g2 ? '3' : g1 ? '2' : '1';
  return {
    groupColumns: [...cands].sort((a, b) => a.groups - b.groups).map(({ index, name, groups }) => ({ index, name, groups })),
    numbered, hasCode, suggested,
    group1: g1?.index ?? null, group2: g2?.index ?? null,
  };
}

/** One row of the import preview: the item it becomes and its level. */
export interface ImportRow {
  level: number;
  /** A group created from a grouping column, not a row of the sheet. */
  group: boolean;
  name: string; owner: string; status: Status; notes: string; progress: number;
  plannedStart: string | null; plannedFinish: string | null;
  forecastStart: string | null; forecastFinish: string | null;
  actualStart: string | null; actualFinish: string | null;
  code: string;
  depsRaw: string;
}

export interface ImportOptions {
  header: number;
  mapping: Mapping;
  mode: HierarchyMode;
  group1?: number | null;
  group2?: number | null;
  dateOrder?: DateOrder;
}

/** Turn sheet rows into WBS rows with levels (prototype parseRows), applying the import defaults in spec 6.1. */
export function buildImportRows(rows: Sheet, o: ImportOptions): ImportRow[] {
  const c = o.mapping;
  const get = (r: unknown[], f: ImportField) => (c[f] != null ? r[c[f]!] : '');
  const order = o.dateOrder ?? 'dmy';
  const g1 = o.group1 ?? null, g2 = o.group2 ?? null;
  let last1 = '', last2 = '';
  const out: (ImportRow & { g1: string; g2: string })[] = [];
  for (const r of rows.slice(o.header + 1)) {
    if (g1 != null) { const v = cellText(r[g1]); if (v) { if (v !== last1) last2 = ''; last1 = v; } }
    if (g2 != null) { const v = cellText(r[g2]); if (v) last2 = v; }
    let name = cellText(get(r, 'name'));
    if (!name) continue;
    let code = c.code != null ? cellText(get(r, 'code')).replace(/\.0+$/, '').replace(/\.$/, '') : '';
    let level = 1;
    if (o.mode === 'code') {
      if (code) level = code.split('.').filter(Boolean).length;
      else if (c.level != null) level = Math.max(1, parseInt(cellText(get(r, 'level')), 10) || 1);
    } else if (o.mode === 'num') {
      const m = /^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(name);
      if (m) { code = m[1]!; level = m[1]!.split('.').length; name = m[2]!.trim(); }
    }
    const row: ImportRow & { g1: string; g2: string } = {
      level, group: false, name: name.slice(0, 300), owner: cellText(get(r, 'owner')).slice(0, 120),
      status: parseStatus(get(r, 'status')), notes: cellText(get(r, 'notes')).slice(0, 4000), progress: parseProgress(get(r, 'progress')),
      plannedStart: parseDate(get(r, 'plannedStart'), order), plannedFinish: parseDate(get(r, 'plannedFinish'), order),
      forecastStart: parseDate(get(r, 'forecastStart'), order), forecastFinish: parseDate(get(r, 'forecastFinish'), order),
      actualStart: parseDate(get(r, 'actualStart'), order), actualFinish: parseDate(get(r, 'actualFinish'), order),
      code, depsRaw: cellText(get(r, 'deps')), g1: last1 || '(No group)', g2: last2 || '(No group)',
    };
    // no planned dates: the imported dates become the baseline; no forecast: use the plan
    if (!row.plannedStart && !row.plannedFinish) { row.plannedStart = row.forecastStart; row.plannedFinish = row.forecastFinish; }
    if (!row.forecastStart && !row.forecastFinish) { row.forecastStart = row.plannedStart; row.forecastFinish = row.plannedFinish; }
    for (const [a, b] of [['plannedStart', 'plannedFinish'], ['forecastStart', 'forecastFinish'], ['actualStart', 'actualFinish']] as const) {
      if (row[a] && row[b] && row[b]! < row[a]!) [row[a], row[b]] = [row[b], row[a]];
    }
    if (row.status === 'completed' && !row.actualFinish) row.actualFinish = row.forecastFinish ?? row.plannedFinish;
    out.push(row);
  }
  let res: ImportRow[] = out;
  const groupRow = (name: string, level: number, rs: ImportRow[]): ImportRow => {
    const owners = [...new Set(rs.map(x => x.owner).filter(Boolean))];
    return {
      name, level, group: true, owner: owners.length === 1 ? owners[0]! : '', status: 'auto', notes: '', progress: 0,
      plannedStart: null, plannedFinish: null, forecastStart: null, forecastFinish: null, actualStart: null, actualFinish: null, code: '', depsRaw: '',
    };
  };
  if ((o.mode === '2' && g1 != null) || (o.mode === '3' && g1 != null && g2 != null)) {
    const tree = new Map<string, Map<string, typeof out>>();
    for (const x of out) {
      const k2 = o.mode === '3' ? x.g2 : '';
      if (!tree.has(x.g1)) tree.set(x.g1, new Map());
      const m = tree.get(x.g1)!;
      if (!m.has(k2)) m.set(k2, []);
      m.get(k2)!.push(x);
    }
    res = [];
    for (const [a, m] of tree) {
      res.push(groupRow(a, 1, [...m.values()].flat()));
      for (const [b, rs] of m) {
        if (o.mode === '3') res.push(groupRow(b, 2, rs));
        for (const x of rs) res.push({ ...x, level: o.mode === '3' ? 3 : 2 });
      }
    }
  } else if (o.mode === '1' || o.mode === '2' || o.mode === '3') {
    for (const x of res) x.level = 1;
  }
  // a level can never be more than one below the row above
  let prev = 0;
  res = res.map(x => { const level = Math.min(x.level, prev + 1); prev = level; return { ...x, level }; });
  // drop the grouping keys used above
  return res.map(x => { const { g1: _a, g2: _b, ...rest } = x as ImportRow & { g1?: string; g2?: string }; return rest; });
}

/** A whole-percent cell: 45, "45%" or 45.4 → 45. */
function parsePercent(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

const DEP_TOKEN = /^(\d+(?:\.\d+)*)(?:\s*([+-])\s*(\d+)\s*d?)?$/i;
const newId = () => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

/**
 * WBS items from import rows: parents from levels, links from WBS codes
 * (the code given in the sheet, or the position the row ends up in).
 * Unknown link codes are returned in `ignoredLinks`.
 */
export function rowsToItems(rows: ImportRow[], parentId: string | null = null, ids?: (string | null)[]): { items: WbsItem[]; ignoredLinks: string[] } {
  const items: WbsItem[] = [];
  const stack: string[] = [];
  const count: number[] = [];
  const byCode = new Map<string, string>();
  const pending: [WbsItem, string][] = [];
  rows.forEach((r, k) => {
    const id = ids?.[k] || newId();
    stack.length = r.level - 1;
    count.length = r.level;
    count[r.level - 1] = (count[r.level - 1] ?? 0) + 1;
    const parent = r.level > 1 ? stack[r.level - 2] ?? parentId : parentId;
    stack[r.level - 1] = id;
    const pos = count.map(x => x || 1).join('.');
    if (!byCode.has(pos)) byCode.set(pos, id);
    if (r.code && !byCode.has(r.code)) byCode.set(r.code, id);
    const item = blankItem(parent, {
      id, name: r.name, owner: r.owner, status: r.status, notes: r.notes, progress: r.progress,
      plannedStart: r.plannedStart, plannedFinish: r.plannedFinish, forecastStart: r.forecastStart, forecastFinish: r.forecastFinish,
      actualStart: r.actualStart, actualFinish: r.actualFinish,
    });
    items.push(item);
    if (r.depsRaw) pending.push([item, r.depsRaw]);
  });
  const ignoredLinks: string[] = [];
  // links between an item and its own parent or sub-items are not allowed
  const tree = new Tree(items);
  for (const [n, raw] of pending) {
    for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
      const m = DEP_TOKEN.exec(part);
      const pid = m ? byCode.get(m[1]!) : undefined;
      if (!pid || tree.related(n.id, pid)) { ignoredLinks.push(part); continue; }
      if (!n.deps.some(d => d.id === pid)) n.deps.push({ id: pid, lag: m![2] ? (m![2] === '-' ? -1 : 1) * Number(m![3]) : 0 });
    }
  }
  return { items, ignoredLinks };
}

/* ---------------- connected workbook (spec 6.2, 6.3) ---------------- */

export const WORKBOOK_COLUMNS = [
  'Project ID', 'Project', 'Item ID', 'WBS Code', 'Level', 'Item Name', 'Owner', 'Status override',
  'Planned Start', 'Planned Finish', 'Forecast Start', 'Forecast Finish', 'Actual Start', 'Actual Finish',
  'Progress %', 'Predecessors', 'Notes',
  '(calc) Status', '(calc) Health', '(calc) Finish variance (working days)', '(calc) Critical path', '(calc) Planned % at status date',
] as const;
/** Columns people edit; the (calc) columns are written by WBS Master and ignored on re-import. */
export const EDITABLE_COLUMNS = 17;

const STATUS_LABEL: Record<Status, string> = {
  auto: '', not_started: 'Not started', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
};
const HEALTH_LABEL = { green: 'On track', amber: 'At risk', red: 'Delayed', done: 'Completed', none: 'No dates' } as const;

/**
 * The WBS sheet of a connected workbook, one row per item in tree order.
 * Dates are ISO strings; the caller writes them as Excel dates. Parents show
 * their rolled-up dates and progress (they are ignored when re-imported).
 */
export function workbookRows(projectId: string, projectName: string, items: WbsItem[], c: ComputedProject): unknown[][] {
  const tree = new Tree(items);
  const codes = new Map([...c.items].map(([id, i]) => [id, i.code]));
  const rows: unknown[][] = [[...WORKBOOK_COLUMNS]];
  const walk = (pid: string | null) => {
    for (const n of tree.kids(pid)) {
      const i = c.items.get(n.id);
      if (!i) continue;
      const parent = i.childCount > 0;
      const d = (own: string | null, rolled: number | null) => (parent ? toIso(rolled) : own);
      rows.push([
        projectId, projectName, n.id, i.code, i.level, n.name, n.owner, parent ? '' : STATUS_LABEL[n.status],
        d(n.plannedStart, i.planned.start), d(n.plannedFinish, i.planned.finish),
        d(n.forecastStart, i.forecast.start), d(n.forecastFinish, i.forecast.finish),
        d(n.actualStart, i.actual.start), d(n.actualFinish, i.actual.finish),
        parent ? i.progress : Math.round(n.progress), formatDeps(n.deps, codes), n.notes,
        STATUS_LABEL[i.status] || 'Not started', HEALTH_LABEL[i.health], i.variance ?? '', c.critical.has(n.id) ? 'Yes' : '', i.plannedPct ?? '',
      ]);
      walk(n.id);
    }
  };
  walk(null);
  return rows;
}

/** True when the sheet is a WBS Master workbook (it has Project ID and Item ID columns). */
export function isConnectedSheet(rows: Sheet): boolean {
  const h = (rows[0] ?? []).map(cellText);
  return h.includes('Item ID') && h.includes('Project ID');
}

export interface ConnectedProject { projectId: string; name: string; items: WbsItem[]; ignoredLinks: string[] }

/**
 * Read a connected workbook's WBS sheet back into items, per project. Rows
 * keep their Item ID; a row without one (or with a duplicate) is a new item.
 * Levels come from the Level column (or the WBS code). Parents' dates,
 * status and progress are rolled up, so those cells are ignored for them.
 */
export function readConnectedSheet(rows: Sheet, dateOrder: DateOrder = 'dmy'): ConnectedProject[] {
  const h = (rows[0] ?? []).map(cellText);
  const col = (name: string) => h.indexOf(name);
  const C = {
    pid: col('Project ID'), pname: col('Project'), id: col('Item ID'), code: col('WBS Code'), level: col('Level'), name: col('Item Name'),
    owner: col('Owner'), status: col('Status override'), bs: col('Planned Start'), be: col('Planned Finish'), fs: col('Forecast Start'),
    fe: col('Forecast Finish'), as: col('Actual Start'), ae: col('Actual Finish'), progress: col('Progress %'), deps: col('Predecessors'), notes: col('Notes'),
  };
  const g = (r: unknown[], i: number) => (i >= 0 ? r[i] : '');
  const projects = new Map<string, { name: string; rows: unknown[][] }>();
  let lastPid = '';
  for (const r of rows.slice(1)) {
    if (!cellText(g(r, C.name))) continue;
    const pid = cellText(g(r, C.pid)) || lastPid;
    lastPid = pid;
    if (!projects.has(pid)) projects.set(pid, { name: cellText(g(r, C.pname)) || 'Imported project', rows: [] });
    projects.get(pid)!.rows.push(r);
  }
  const out: ConnectedProject[] = [];
  for (const [projectId, p] of projects) {
    const seen = new Set<string>();
    const ids: (string | null)[] = [];
    const importRows: ImportRow[] = p.rows.map(r => {
      const code = cellText(g(r, C.code)).replace(/\.$/, '');
      const lv = parseInt(cellText(g(r, C.level)), 10);
      let id: string | null = cellText(g(r, C.id)) || null;
      if (id && seen.has(id)) id = null;
      if (id) seen.add(id);
      ids.push(id);
      const status = cellText(g(r, C.status));
      return {
        level: lv >= 1 ? lv : code ? code.split('.').filter(Boolean).length : 1, group: false,
        name: cellText(g(r, C.name)).slice(0, 300), owner: cellText(g(r, C.owner)).slice(0, 120),
        // this column is written as whole percents, so 1 means 1% here (generic imports read 0–1 as a fraction)
        status: status ? parseStatus(status) : 'auto', notes: cellText(g(r, C.notes)).slice(0, 4000), progress: parsePercent(g(r, C.progress)),
        plannedStart: parseDate(g(r, C.bs), dateOrder), plannedFinish: parseDate(g(r, C.be), dateOrder),
        forecastStart: parseDate(g(r, C.fs), dateOrder), forecastFinish: parseDate(g(r, C.fe), dateOrder),
        actualStart: parseDate(g(r, C.as), dateOrder), actualFinish: parseDate(g(r, C.ae), dateOrder),
        code, depsRaw: cellText(g(r, C.deps)),
      };
    });
    let prev = 0;
    for (const r of importRows) { if (r.level > prev + 1) r.level = prev + 1; prev = r.level; }
    const { items, ignoredLinks } = rowsToItems(importRows, null, ids);
    out.push({ projectId, name: p.name, items, ignoredLinks });
  }
  return out;
}

/**
 * Bring a re-imported workbook in line with the project as stored: rows that
 * are parents keep their stored dates, status and progress (the sheet shows
 * rolled-up values there).
 */
export function mergeWorkbookItems(current: WbsItem[], imported: WbsItem[]): WbsItem[] {
  const tree = new Tree(imported);
  const before = new Map(current.map(i => [i.id, i]));
  return imported.map(n => {
    const old = before.get(n.id);
    if (!old || tree.isLeaf(n.id)) return n;
    return {
      ...n, status: old.status, progress: old.progress,
      plannedStart: old.plannedStart, plannedFinish: old.plannedFinish, forecastStart: old.forecastStart, forecastFinish: old.forecastFinish,
      actualStart: old.actualStart, actualFinish: old.actualFinish,
    };
  });
}

export interface WorkbookChange { added: string[]; removed: string[]; changed: { name: string; fields: string[] }[]; renamed: boolean }

/** What a re-import would change, for the preview (spec 6.3). */
export function describeChanges(current: WbsItem[], target: WbsItem[]): WorkbookChange {
  const FIELDS: (keyof WbsItem)[] = ['name', 'owner', 'status', 'plannedStart', 'plannedFinish', 'forecastStart', 'forecastFinish', 'actualStart', 'actualFinish', 'progress', 'notes', 'parentId'];
  const a = new Map(current.map(i => [i.id, i]));
  const b = new Map(target.map(i => [i.id, i]));
  const changed: WorkbookChange['changed'] = [];
  const added: string[] = [];
  for (const n of target) {
    const o = a.get(n.id);
    if (!o) { added.push(n.name); continue; }
    const fields: string[] = FIELDS.filter(f => (f === 'progress' ? Math.round(o.progress) !== Math.round(n.progress) : (o[f] ?? '') !== (n[f] ?? ''))).map(String);
    const deps = (x: WbsItem) => x.deps.map(d => `${d.id}:${d.lag}`).sort().join();
    if (deps(o) !== deps(n)) fields.push('deps');
    if (fields.length) changed.push({ name: n.name, fields });
  }
  const removed = current.filter(i => !b.has(i.id)).map(i => i.name);
  return { added, removed, changed, renamed: false };
}
