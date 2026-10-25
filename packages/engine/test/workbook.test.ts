import { describe, expect, it } from 'vitest';
import { ALL_DAYS, WorkCalendar } from '../src/calendar.js';
import { computeProject } from '../src/compute.js';
import { diffToOps } from '../src/diff.js';
import { detectColumns, guessDateOrder } from '../src/importing.js';
import { Tree } from '../src/tree.js';
import type { WbsItem } from '../src/types.js';
import {
  analyzeHierarchy, buildImportRows, describeChanges, isConnectedSheet, mergeWorkbookItems, readConnectedSheet, rowsToItems, workbookRows,
} from '../src/workbook.js';
import { TODAY, randomProject } from './random.js';

const codesOf = (items: WbsItem[]) => [...new Tree(items).codes()].map(([id, c]) => `${c.code} ${items.find(i => i.id === id)!.name}`);

describe('generic import', () => {
  const sheet = [
    ['Project plan — RMU'],
    [],
    ['Phase', 'Task', 'Owner', 'Start', 'Finish', '% Complete', 'Predecessors', 'Status'],
    ['Design', 'Single-line diagram', 'R&D', '26/07/2026', '20/08/2026', 1, '', 'Completed'],
    ['', 'Busbar design', 'R&D', '16/08/2026', '24/09/2026', 0.85, '1.1', 'In progress'],
    ['Testing', 'Prototype build', 'Industrialization', 46320, 46352, '', '1.2+3', 'Not started'],
    ['', 'Type tests', 'R&D', '29/11/2026', '14/01/2027', '', '2.1, 9.9', ''],
  ];
  const header = 2;
  const mapping = detectColumns(sheet[header] as string[]);

  it('suggests grouping by the Phase column', () => {
    const a = analyzeHierarchy(sheet, header, mapping);
    expect(a.suggested).toBe('2');
    expect(a.groupColumns.map(g => g.name)).toEqual(['Phase']);
  });

  it('builds two levels from the Phase column, with links by code and the import defaults', () => {
    const a = analyzeHierarchy(sheet, header, mapping);
    const rows = buildImportRows(sheet, { header, mapping, mode: '2', group1: a.group1 });
    expect(rows.map(r => `${r.level} ${r.name}`)).toEqual(['1 Design', '2 Single-line diagram', '2 Busbar design', '1 Testing', '2 Prototype build', '2 Type tests']);
    const sld = rows[1]!;
    // no planned columns: the dates become the baseline as well as the forecast
    expect([sld.plannedStart, sld.forecastFinish, sld.status, sld.progress, sld.actualFinish]).toEqual(['2026-07-26', '2026-08-20', 'completed', 100, '2026-08-20']);
    expect(rows[2]!.progress).toBe(85);
    expect(rows[4]!.plannedStart).toBe('2026-10-25'); // Excel serial date
    const { items, ignoredLinks } = rowsToItems(rows);
    const byName = (n: string) => items.find(i => i.name === n)!;
    expect(byName('Busbar design').deps).toEqual([{ id: byName('Single-line diagram').id, lag: 0 }]);
    expect(byName('Prototype build').deps).toEqual([{ id: byName('Busbar design').id, lag: 3 }]);
    expect(ignoredLinks).toEqual(['9.9']);
    expect(codesOf(items)).toContain('2.2 Type tests');
  });

  it('reads levels from numbering in the names', () => {
    const s = [['Task', 'Due'], ['1 Design', ''], ['1.1 Electrical', '2026-09-01'], ['1.2 Mechanical', ''], ['2 Testing', '']];
    const m = detectColumns(s[0] as string[]);
    const a = analyzeHierarchy(s, 0, m);
    expect(a.suggested).toBe('num');
    const rows = buildImportRows(s, { header: 0, mapping: m, mode: 'num' });
    expect(rows.map(r => `${r.level} ${r.name}`)).toEqual(['1 Design', '2 Electrical', '2 Mechanical', '1 Testing']);
  });

  it('reads levels from a WBS code column and never jumps more than one level', () => {
    const s = [['WBS', 'Name'], ['1', 'A'], ['1.1.1', 'Too deep'], ['2', 'B']];
    const m = detectColumns(s[0] as string[]);
    const rows = buildImportRows(s, { header: 0, mapping: m, mode: 'code' });
    expect(rows.map(r => r.level)).toEqual([1, 2, 1]);
  });

  it('tells day-first from month-first dates by any part above 12', () => {
    expect(guessDateOrder([['Start', 'Finish'], ['01/11/2026', '15/11/2026']])).toBe('dmy');
    expect(guessDateOrder([['Start'], ['11/15/2026'], ['12/01/2026']])).toBe('mdy');
    expect(guessDateOrder([['Start'], ['01/11/2026'], [46320]])).toBeNull();
  });

  it('reads month-first dates when asked', () => {
    const s = [['Task', 'Start'], ['A', '10/23/2026']];
    const m = detectColumns(s[0] as string[]);
    expect(buildImportRows(s, { header: 0, mapping: m, mode: '1', dateOrder: 'mdy' })[0]!.forecastStart).toBe('2026-10-23');
  });
});

describe('connected workbook', () => {
  it('recognises its own format', () => {
    expect(isConnectedSheet([['Project ID', 'Project', 'Item ID']])).toBe(true);
    expect(isConnectedSheet([['Task', 'Start']])).toBe(false);
  });

  it('round-trips any project with no changes (500 random projects)', () => {
    const cal = new WorkCalendar(ALL_DAYS);
    for (let seed = 1; seed <= 500; seed++) {
      const p = randomProject(seed);
      const rows = workbookRows(p.id, p.name, p.items, computeProject(p, { calendar: cal, today: TODAY }));
      const [back] = readConnectedSheet(rows);
      if (!p.items.length) { expect(back).toBeUndefined(); continue; }
      const merged = mergeWorkbookItems(p.items, back!.items);
      expect(diffToOps(p.items, merged), `seed ${seed}`).toEqual([]);
      expect(back!.ignoredLinks, `seed ${seed}`).toEqual([]);
    }
  });

  it('reads edits, new rows and removed rows from the sheet', () => {
    const p = randomProject(42);
    const c = computeProject(p, { calendar: new WorkCalendar(ALL_DAYS), today: TODAY });
    const rows = workbookRows(p.id, p.name, p.items, c);
    const leafRow = rows.findIndex((r, k) => k > 0 && new Tree(p.items).isLeaf(String(r[2])));
    rows[leafRow]![5] = 'Renamed in Excel';
    rows[leafRow]![10] = '2026-12-01';
    rows.push([p.id, p.name, '', '', 1, 'Added in Excel', 'PMO', '', '', '', '2027-01-03', '2027-01-07', '', '', 0, '', '']);
    const removedName = String(rows[rows.length - 2]![5]);
    rows.splice(rows.length - 2, 1);
    const [back] = readConnectedSheet(rows);
    const merged = mergeWorkbookItems(p.items, back!.items);
    const ch = describeChanges(p.items, merged);
    expect(ch.added).toEqual(['Added in Excel']);
    expect(ch.removed).toContain(removedName);
    expect(ch.changed.find(x => x.name === 'Renamed in Excel')!.fields).toEqual(expect.arrayContaining(['name', 'forecastStart']));
  });
});
