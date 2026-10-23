import { type Day, toIso } from './dates.js';
import { newId } from './edits.js';
import { Tree } from './tree.js';
import type { Baseline, Project } from './types.js';

export type BaselineError = 'no_forecast_dates';

/** Planned dates of every dated leaf. */
function snapshot(project: Project): Baseline['items'] {
  const tree = new Tree(project.items);
  const out: Baseline['items'] = {};
  for (const n of tree.leaves()) {
    if (n.plannedStart || n.plannedFinish) out[n.id] = [n.plannedStart || n.plannedFinish, n.plannedFinish || n.plannedStart];
  }
  return out;
}

/**
 * Save a new baseline (spec 4.8). If none exists yet but planned dates do,
 * they are first kept as "Original baseline". Then every leaf's forecast
 * becomes its planned dates and the new baseline is added and compared against.
 */
export function saveBaseline(
  project: Project,
  opts: { name?: string; reason?: string; today: Day; firstPlannedOn?: Day },
): Project | BaselineError {
  const tree = new Tree(project.items);
  const leafIds = new Set(tree.leaves().filter(n => n.forecastStart || n.forecastFinish).map(n => n.id));
  if (!leafIds.size) return 'no_forecast_dates';
  const baselines = project.baselines.map(b => ({ ...b }));
  const setOn = toIso(opts.today)!;
  if (!baselines.length && project.items.some(n => n.plannedStart || n.plannedFinish)) {
    baselines.push({
      id: newId('b'), name: 'Original baseline', setOn: toIso(opts.firstPlannedOn ?? opts.today)!,
      reason: 'Plan before the first re-baseline', items: snapshot(project),
    });
  }
  const items = project.items.map(n => leafIds.has(n.id)
    ? { ...n, plannedStart: n.forecastStart || n.forecastFinish, plannedFinish: n.forecastFinish || n.forecastStart }
    : n);
  const next: Project = { ...project, items };
  baselines.push({
    id: newId('b'),
    name: opts.name?.trim() || (baselines.length ? `Re-baseline ${baselines.length}` : 'Original baseline'),
    setOn, reason: opts.reason?.trim() ?? '', items: snapshot(next),
  });
  return { ...next, baselines, settings: { ...project.settings, activeBaselineId: null } };
}

/** Copy a baseline's dates back into the planned dates. */
export function restoreBaseline(project: Project, baselineId: string): Project {
  const bl = project.baselines.find(b => b.id === baselineId);
  if (!bl) return project;
  const items = project.items.map(n => {
    const row = bl.items[n.id];
    return row ? { ...n, plannedStart: row[0] ?? row[1], plannedFinish: row[1] ?? row[0] } : n;
  });
  return { ...project, items, settings: { ...project.settings, activeBaselineId: null } };
}

export function deleteBaseline(project: Project, baselineId: string): Project {
  const baselines = project.baselines.filter(b => b.id !== baselineId);
  const activeBaselineId = project.settings.activeBaselineId === baselineId ? null : project.settings.activeBaselineId;
  return { ...project, baselines, settings: { ...project.settings, activeBaselineId } };
}

export function renameBaseline(project: Project, baselineId: string, name: string): Project {
  const n = name.trim();
  if (!n) return project;
  return { ...project, baselines: project.baselines.map(b => (b.id === baselineId ? { ...b, name: n } : b)) };
}

/** Latest planned finish stored in a baseline. */
export function baselineFinish(bl: Baseline): string | null {
  let e: string | null = null;
  for (const [s, f] of Object.values(bl.items)) {
    const v = f ?? s;
    if (v && (e == null || v > e)) e = v;
  }
  return e;
}
