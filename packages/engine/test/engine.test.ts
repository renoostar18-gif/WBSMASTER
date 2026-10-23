import { describe, expect, it } from 'vitest';
import { deleteBaseline, restoreBaseline, saveBaseline } from '../src/baselines.js';
import { SAUDI_WEEK, WorkCalendar } from '../src/calendar.js';
import { computeProject, overallHealth } from '../src/compute.js';
import { toDay } from '../src/dates.js';
import { formatDeps, parseDepsText, validateLink } from '../src/deps.js';
import { applyEdit } from '../src/edits.js';
import { detectColumns, detectHeaderRow, parseDate, parseProgress, parseStatus } from '../src/importing.js';
import { reportData } from '../src/report.js';
import { autoSchedule } from '../src/schedule.js';
import { Tree } from '../src/tree.js';
import type { Project } from '../src/types.js';
import { item, project } from './helpers.js';

const d = (s: string) => toDay(s)!;
const saudi = new WorkCalendar(SAUDI_WEEK);

describe('WBS codes and tree rules', () => {
  it('numbers items by position and level', () => {
    const t = new Tree([item('a', null), item('b', null), item('b1', 'b'), item('b2', 'b'), item('b21', 'b2')]);
    const codes = t.codes();
    expect(codes.get('b21')).toEqual({ code: '2.2.1', level: 3 });
    expect(t.leavesOf('b')).toEqual(expect.arrayContaining(['b1', 'b21']));
    expect(t.related('b', 'b21')).toBe(true);
    expect(t.related('a', 'b21')).toBe(false);
  });
});

describe('health with working days', () => {
  it('measures slip in working days, so slipping over a weekend is not late', () => {
    const p = project([item('a', null, { plannedStart: '2026-10-18', plannedFinish: '2026-10-22', forecastStart: '2026-10-18', forecastFinish: '2026-10-24' })],
      { statusDate: '2026-10-18' });
    const a = computeProject(p, { calendar: saudi }).items.get('a')!;
    expect(a.variance).toBe(0);
    expect(a.health).toBe('green');
  });

  it('turns red at the threshold counted in working days', () => {
    // planned finish Thu 22 Oct; forecast Thu 5 Nov = 10 working days later (14 calendar days)
    const p = project([item('a', null, { plannedStart: '2026-10-18', plannedFinish: '2026-10-22', forecastStart: '2026-10-18', forecastFinish: '2026-11-05' })],
      { statusDate: '2026-10-19', redThresholdDays: 10 });
    const a = computeProject(p, { calendar: saudi }).items.get('a')!;
    expect(a.variance).toBe(10);
    expect(a.health).toBe('red');
    expect(a.reason).toEqual({ code: 'slip', days: 10 });
  });

  it('computes planned % from working days elapsed', () => {
    // Sun 18 – Thu 29 Oct = 10 working days; status date Thu 22 Oct = 5 elapsed
    const p = project([item('a', null, { plannedStart: '2026-10-18', plannedFinish: '2026-10-29' })], { statusDate: '2026-10-22' });
    expect(computeProject(p, { calendar: saudi }).items.get('a')!.plannedPct).toBe(50);
    // over the weekend nothing more is planned
    const sat = project(p.items, { statusDate: '2026-10-24' });
    expect(computeProject(sat, { calendar: saudi }).items.get('a')!.plannedPct).toBe(50);
  });

  it('rolls up with working-day weights and softens child-only red for the overall status', () => {
    const p = project([
      item('ph', null),
      item('x', 'ph', { plannedStart: '2026-10-18', plannedFinish: '2026-10-22', forecastStart: '2026-10-18', forecastFinish: '2026-10-22', progress: 100, actualStart: '2026-10-18', actualFinish: '2026-10-22' }),
      item('y', 'ph', { plannedStart: '2026-10-25', plannedFinish: '2026-11-05', forecastStart: '2026-10-25', forecastFinish: '2026-11-05', progress: 0 }),
    ], { statusDate: '2026-10-25' });
    const c = computeProject(p, { calendar: saudi });
    const ph = c.items.get('ph')!;
    // weights 5 and 10 working days: (5×100 + 10×0) / 15 = 33
    expect(ph.progress).toBe(33);
    expect(ph.status).toBe('in_progress');
    expect(overallHealth(c, 10)).toBe(c.project.health);
  });

  it('compares against a chosen baseline', () => {
    const p: Project = {
      ...project([item('a', null, { plannedStart: '2026-10-18', plannedFinish: '2026-10-22', forecastStart: '2026-10-18', forecastFinish: '2026-10-22' })], { statusDate: '2026-10-18', activeBaselineId: 'orig' }),
      baselines: [{ id: 'orig', name: 'Original', setOn: '2026-09-01', reason: '', items: { a: ['2026-10-11', '2026-10-15'] } }],
    };
    const a = computeProject(p, { calendar: saudi }).items.get('a')!;
    expect(a.variance).toBe(5);
    expect(a.health).toBe('amber');
  });
});

describe('auto-schedule with working days', () => {
  it('starts a successor on the next working day after the predecessor, plus lag', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-22', plannedStart: '2026-10-18', plannedFinish: '2026-10-22' }),
      item('b', null, { forecastStart: '2026-10-19', forecastFinish: '2026-10-20', plannedStart: '2026-10-19', plannedFinish: '2026-10-20', deps: [{ id: 'a', lag: 0 }] }),
      item('c', null, { forecastStart: '2026-10-19', forecastFinish: '2026-10-19', plannedStart: '2026-10-19', plannedFinish: '2026-10-19', deps: [{ id: 'a', lag: 2 }] }),
    ]);
    const r = autoSchedule(p, saudi);
    const b = r.items.find(i => i.id === 'b')!, c = r.items.find(i => i.id === 'c')!;
    expect([b.forecastStart, b.forecastFinish]).toEqual(['2026-10-25', '2026-10-26']); // Sun–Mon, 2 working days kept
    expect([c.forecastStart, c.forecastFinish]).toEqual(['2026-10-27', '2026-10-27']);
    expect(r.moved.sort()).toEqual(['b', 'c']);
  });

  it('keeps working-day duration across a weekend', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-21' }),
      item('b', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-22', deps: [{ id: 'a', lag: 0 }] }), // 5 working days
    ]);
    const b = autoSchedule(p, saudi).items.find(i => i.id === 'b')!;
    expect([b.forecastStart, b.forecastFinish]).toEqual(['2026-10-22', '2026-10-28']); // Thu + 4 working days = Wed
  });

  it('gives an undated successor a 5-working-day block and a baseline', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-22' }),
      item('b', null, { deps: [{ id: 'a', lag: 0 }] }),
    ]);
    const b = autoSchedule(p, saudi).items.find(i => i.id === 'b')!;
    expect([b.forecastStart, b.forecastFinish, b.plannedStart, b.plannedFinish]).toEqual(['2026-10-25', '2026-10-29', '2026-10-25', '2026-10-29']);
  });

  it('never moves started, completed or cancelled work, and never pulls work earlier', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-29' }),
      item('s', null, { forecastStart: '2026-10-19', forecastFinish: '2026-10-20', actualStart: '2026-10-19', deps: [{ id: 'a', lag: 0 }] }),
      item('later', null, { forecastStart: '2026-12-01', forecastFinish: '2026-12-03', deps: [{ id: 'a', lag: 0 }] }),
    ]);
    const r = autoSchedule(p, saudi);
    expect(r.moved).toEqual([]);
  });

  it('keeps finish on or after start when only a forecast start was given (fix of a prototype bug)', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-29' }),
      item('b', null, { forecastStart: '2026-10-19', plannedFinish: '2026-10-01', deps: [{ id: 'a', lag: 0 }] }),
    ]);
    const b = autoSchedule(p, saudi).items.find(i => i.id === 'b')!;
    expect(b.forecastStart).toBe('2026-11-01');
    expect(b.forecastFinish! >= b.forecastStart!).toBe(true);
  });

  it('does nothing when auto-schedule is off', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-29' }),
      item('b', null, { forecastStart: '2026-10-19', forecastFinish: '2026-10-20', deps: [{ id: 'a', lag: 0 }] }),
    ], { autoSchedule: false });
    expect(autoSchedule(p, saudi).moved).toEqual([]);
  });
});

describe('critical path', () => {
  it('follows the driving chain back from the latest finish, across the weekend', () => {
    const p = project([
      item('a', null, { forecastStart: '2026-10-18', forecastFinish: '2026-10-22' }),
      item('b', null, { forecastStart: '2026-10-25', forecastFinish: '2026-10-29', deps: [{ id: 'a', lag: 0 }] }),
      item('side', null, { forecastStart: '2026-10-11', forecastFinish: '2026-10-12' }),
      item('c', null, { forecastStart: '2026-11-01', forecastFinish: '2026-11-05', deps: [{ id: 'b', lag: 0 }, { id: 'side', lag: 0 }] }),
    ], { statusDate: '2026-10-01' });
    const c = computeProject(p, { calendar: saudi });
    expect([...c.critical].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('links', () => {
  const t = new Tree([item('a', null), item('a1', 'a'), item('b', null, { deps: [{ id: 'a', lag: 0 }] })]);
  it('refuses family links, duplicates and loops', () => {
    expect(validateLink(t, 'a1', 'a')).toBe('same_family');
    expect(validateLink(t, 'b', 'a')).toBe('duplicate');
    expect(validateLink(t, 'a1', 'b')).toBe('cycle');
    expect(validateLink(t, 'zz', 'a')).toBe('not_found');
  });
  it('parses and formats link text', () => {
    const codes = t.codes();
    const idByCode = new Map([...codes].map(([id, c]) => [c.code, id]));
    const r = parseDepsText('1.1+3, 9, 2-1d', 'b', idByCode, t);
    expect(r.deps).toEqual([{ id: 'a1', lag: 3 }]);
    expect(r.invalid).toEqual(['9', '2-1d']);
    expect(formatDeps([{ id: 'a1', lag: 3 }, { id: 'a', lag: -2 }], new Map([...codes].map(([id, c]) => [id, c.code])))).toBe('1.1+3, 1-2');
  });
});

describe('edit side effects', () => {
  const T = d('2026-10-22');
  it('makes the first forecast the baseline and vice versa', () => {
    expect(applyEdit(item('a', null), 'forecastStart', '2026-10-18', T).plannedStart).toBe('2026-10-18');
    const b = applyEdit(item('a', null), 'plannedFinish', '2026-10-30', T);
    expect([b.forecastStart, b.forecastFinish]).toEqual([null, '2026-10-30']);
  });
  it('keeps finish ≥ start by moving the other date of the pair', () => {
    const a = item('a', null, { forecastStart: '2026-10-20', forecastFinish: '2026-10-25' });
    expect(applyEdit(a, 'forecastStart', '2026-10-28', T).forecastFinish).toBe('2026-10-28');
    expect(applyEdit(a, 'forecastFinish', '2026-10-10', T).forecastStart).toBe('2026-10-10');
  });
  it('completing an item fills actual dates and progress', () => {
    const a = applyEdit(item('a', null, { forecastStart: '2026-10-18' }), 'status', 'completed', T);
    expect([a.actualStart, a.actualFinish, a.progress]).toEqual(['2026-10-18', '2026-10-22', 100]);
  });
  it('an actual finish resets a manual status to auto', () => {
    const a = applyEdit(item('a', null, { status: 'on_hold' }), 'actualFinish', '2026-10-21', T);
    expect([a.status, a.progress, a.actualStart]).toEqual(['auto', 100, '2026-10-21']);
  });
  it('progress above zero starts the item', () => {
    expect(applyEdit(item('a', null, { forecastStart: '2026-10-19' }), 'progress', 30, T).actualStart).toBe('2026-10-19');
    expect(applyEdit(item('a', null, { forecastStart: '2026-11-19' }), 'progress', 30, T).actualStart).toBe('2026-10-22');
  });
});

describe('baselines', () => {
  const base = project([
    item('a', null, { plannedStart: '2026-10-18', plannedFinish: '2026-10-22', forecastStart: '2026-10-25', forecastFinish: '2026-10-29' }),
  ]);
  it('keeps the original, then makes the forecast the new plan', () => {
    const p = saveBaseline(base, { today: d('2026-10-23'), reason: 'Scope change' });
    if (typeof p === 'string') throw new Error(p);
    expect(p.baselines.map(b => b.name)).toEqual(['Original baseline', 'Re-baseline 1']);
    expect(p.baselines[0]!.items.a).toEqual(['2026-10-18', '2026-10-22']);
    expect(p.items[0]!.plannedStart).toBe('2026-10-25');
    expect(p.baselines[1]!.reason).toBe('Scope change');
    const back = restoreBaseline(p, p.baselines[0]!.id);
    expect(back.items[0]!.plannedFinish).toBe('2026-10-22');
    const del = deleteBaseline({ ...p, settings: { ...p.settings, activeBaselineId: p.baselines[0]!.id } }, p.baselines[0]!.id);
    expect(del.settings.activeBaselineId).toBeNull();
  });
  it('refuses when nothing has forecast dates', () => {
    expect(saveBaseline(project([item('a', null)]), { today: 0 })).toBe('no_forecast_dates');
  });
});

describe('report data', () => {
  it('lists delayed items worst first and upcoming work', () => {
    const p = project([
      item('late', null, { plannedStart: '2026-10-01', plannedFinish: '2026-10-08', forecastStart: '2026-10-01', forecastFinish: '2026-10-15' }),
      item('risk', null, { plannedStart: '2026-10-18', plannedFinish: '2026-10-29', forecastStart: '2026-10-18', forecastFinish: '2026-11-01' }),
      item('ms', null, { plannedStart: '2026-11-05', plannedFinish: '2026-11-05' }),
    ], { statusDate: '2026-10-22' });
    const r = reportData(p, computeProject(p, { calendar: saudi }));
    expect(r.delayed.map(x => x.item.id)).toEqual(['late', 'risk']);
    expect(r.upcoming.map(x => x.item.id)).toEqual(['risk', 'ms']);
    expect(r.milestones.map(x => x.item.id)).toEqual(['ms']);
  });
});

describe('import parsing', () => {
  it('reads dates in many formats, day-first by default', () => {
    expect(parseDate(46318)).toBe('2026-10-23'); // Excel serial
    expect(parseDate('2026-10-23')).toBe('2026-10-23');
    expect(parseDate('23/10/2026')).toBe('2026-10-23');
    expect(parseDate('10/23/2026', 'mdy')).toBe('2026-10-23');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
  it('reads progress and status words, English and Arabic', () => {
    expect([parseProgress(0.45), parseProgress('45%'), parseProgress(120), parseProgress('x')]).toEqual([45, 45, 100, 0]);
    expect(parseStatus('Not started')).toBe('not_started'); // the prototype read this as "in progress"
    expect(parseStatus('In Progress')).toBe('in_progress');
    expect(parseStatus('مكتمل')).toBe('completed');
    expect(parseStatus('ملغي')).toBe('cancelled');
    expect(parseStatus('whatever')).toBe('auto');
  });
  it('detects columns and the header row', () => {
    const cols = detectColumns(['WBS', 'Task Name', 'Owner', 'Baseline Start', 'Baseline Finish', 'Start', 'Finish', '% Complete', 'Predecessors']);
    expect(cols).toEqual({ code: 0, name: 1, owner: 2, plannedStart: 3, plannedFinish: 4, forecastStart: 5, forecastFinish: 6, progress: 7, deps: 8 });
    expect(detectHeaderRow([['Project plan'], [], ['ID', 'Task', 'Start']])).toBe(2);
  });
});
