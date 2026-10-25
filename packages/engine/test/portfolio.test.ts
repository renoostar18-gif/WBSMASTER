import { describe, expect, it } from 'vitest';
import { SAUDI_WEEK, WorkCalendar } from '../src/calendar.js';
import { computeProject } from '../src/compute.js';
import { portfolioEntry, portfolioTotals, sortPortfolio, teamView } from '../src/portfolio.js';
import type { Project } from '../src/types.js';
import { item, project } from './helpers.js';

const cal = new WorkCalendar(SAUDI_WEEK);
const STATUS = '2026-11-01';
const entry = (p: Project, summary = {}) => portfolioEntry(p, computeProject(p, { calendar: cal }), summary);
const named = (id: string, name: string, items: Project['items']): Project => ({ ...project(items, { statusDate: STATUS }), id, name });

const late = named('late', 'Late project', [
  item('a1', null, { name: 'Design', owner: 'R&D', plannedStart: '2026-10-01', plannedFinish: '2026-10-15', forecastStart: '2026-10-01', forecastFinish: '2026-10-25', progress: 50 }),
  item('a2', null, { name: 'Build', owner: 'Plant', plannedStart: '2026-10-26', plannedFinish: '2026-11-10', forecastStart: '2026-11-05', forecastFinish: '2026-11-20', deps: [{ id: 'a1', lag: 0 }] }),
  item('a3', null, { name: 'Gate review', owner: 'PMO', plannedStart: '2026-11-15', plannedFinish: '2026-11-15', forecastStart: '2026-11-15', forecastFinish: '2026-11-15' }),
  item('a4', null, { name: 'Charter', owner: 'PMO', plannedStart: '2026-09-01', plannedFinish: '2026-09-10', forecastStart: '2026-09-01', forecastFinish: '2026-09-10', actualStart: '2026-09-01', actualFinish: '2026-09-10', status: 'completed', progress: 100 }),
  item('a5', null, { name: 'Launch', owner: 'Sales', plannedStart: '2027-06-01', plannedFinish: '2027-06-10', forecastStart: '2027-06-06', forecastFinish: '2027-06-15' }),
]);
const onTrack = named('ok', 'On-track project', [
  item('b1', null, { name: 'Survey', owner: 'R&D', plannedStart: '2026-10-25', plannedFinish: '2026-11-12', forecastStart: '2026-10-25', forecastFinish: '2026-11-12', actualStart: '2026-10-25', progress: 30 }),
]);
const empty = named('empty', 'No dates yet', [item('c1', null, { name: 'Idea' })]);

describe('portfolio', () => {
  it('orders projects worst first: delayed, at risk, on track, then the largest slip', () => {
    const order = sortPortfolio([entry(empty), entry(onTrack), entry(late)]).map(e => e.id);
    expect(order).toEqual(['late', 'ok', 'empty']);
    const a = { overall: 'amber' as const, variance: 3 }, b = { overall: 'amber' as const, variance: 9 };
    expect(sortPortfolio([a, b])).toEqual([b, a]);
  });

  it('keeps only open work that matters to the team, with early warnings', () => {
    const e = entry(late);
    const byName = Object.fromEntries(e.tasks.map(x => [x.name, x]));
    expect(Object.keys(byName).sort()).toEqual(['Build', 'Design', 'Gate review', 'Launch']);
    expect(byName.Design!.overdue).toBe(true);
    expect(byName.Design!.warning).toBeNull();
    expect(byName.Build!.warning).toEqual({ code: 'waits', predCode: '1', predName: 'Design', health: 'red' });
    expect(byName['Gate review']!.finishIn).toBe(14);
    expect(byName.Launch!.warning).toEqual({ code: 'health', reason: { code: 'slip', days: 3 } });
    expect(e.milestones.map(m => m.name)).toEqual(['Gate review']);
    expect(e.statusDate).toBe(STATUS);
  });

  it('suggests decisions and risks until people type their own', () => {
    const auto = entry(late);
    expect(auto.decisionsSuggested).toBe(true);
    expect(auto.risksSuggested).toBe(true);
    expect(auto.risks[0]).toEqual({ item: { name: 'Design', reason: expect.objectContaining({ code: 'overdue' }) } });
    const typed = entry(late, { decisions: '• Approve overtime\n\n- Extend the gate', risks: 'Supplier delay' });
    expect(typed.decisions).toEqual([{ text: 'Approve overtime' }, { text: 'Extend the gate' }]);
    expect(typed.decisionsSuggested).toBe(false);
    expect(typed.risks).toEqual([{ text: 'Supplier delay' }]);
  });

  it('builds the team view for a look-ahead window and one owner', () => {
    const E = [entry(late), entry(onTrack)];
    const all = teamView(E, { horizon: 14 });
    expect(all.owners).toEqual(['Plant', 'PMO', 'R&D', 'Sales']);
    expect(all.overdue.map(x => x.name)).toEqual(['Design']);
    expect(all.upcoming.map(x => x.name)).toEqual(['Build', 'Survey', 'Gate review']);
    expect(all.warnings.map(x => x.name)).toContain('Build');
    expect(Object.fromEntries(all.workload)).toEqual({ 'R&D': 2, Plant: 1, PMO: 1 });
    const plant = teamView(E, { horizon: 30, owner: 'Plant' });
    expect(plant.upcoming.map(x => `${x.projectName}: ${x.name}`)).toEqual(['Late project: Build']);
    expect(plant.overdue).toEqual([]);
  });

  it('adds up the headline figures', () => {
    const T = portfolioTotals([entry(late), entry(onTrack), entry(empty)]);
    expect(T.projects).toBe(3);
    expect(T.counts.red + T.counts.amber).toBe(1);
    expect(T.slipping).toBe(1);
    expect(T.largestSlip).toBeGreaterThan(0);
  });
});
