import { WorkCalendar } from './calendar.js';
import { type Day, clamp, toDay, todayDay } from './dates.js';
import { leafEdges, topoOrder } from './deps.js';
import { Tree } from './tree.js';
import type {
  ComputedProject, DateRange, DerivedStatus, Health, HealthReason, ItemInfo, Project, WbsItem,
} from './types.js';

export interface ComputeOptions {
  calendar?: WorkCalendar;
  /** Used when the project has no status date. Defaults to the current UTC date. */
  today?: Day;
}

type Info = Omit<ItemInfo, 'id' | 'code' | 'level' | 'childCount'>;

const HEALTH_RANK: Record<Health, number> = { none: 0, done: 0, green: 1, amber: 2, red: 3 };
export const healthRank = (h: Health): number => HEALTH_RANK[h];

/** A date pair where one missing end takes the other's value (a one-day item). */
function pair(s: string | null, e: string | null): DateRange {
  let a = toDay(s), b = toDay(e);
  if (a != null && b == null) b = a;
  if (b != null && a == null) a = b;
  return { start: a, finish: b };
}

/** Status derived for a leaf (spec 4.3). */
export function deriveStatus(n: WbsItem): DerivedStatus {
  if (n.status !== 'auto') return n.status;
  if (toDay(n.actualFinish) != null) return 'completed';
  if (toDay(n.actualStart) != null || (Number(n.progress) || 0) > 0) return 'in_progress';
  return 'not_started';
}

/** Planned % at the status date, counting working days (spec 4.4). */
function plannedPct(cal: WorkCalendar, b: DateRange, t: Day): number | null {
  if (b.start == null || b.finish == null) return null;
  const total = cal.count(b.start, b.finish);
  const raw = total > 0
    ? (100 * cal.count(b.start, t)) / total
    // an item placed entirely on non-working days: fall back to calendar days
    : (100 * (t - b.start + 1)) / (b.finish - b.start + 1);
  return clamp(Math.round(raw), 0, 100);
}

function leafInfo(n: WbsItem, ctx: Ctx): Info {
  const { cal, t, red } = ctx;
  const working = pair(n.plannedStart, n.plannedFinish);
  let planned = working;
  if (ctx.baseline) {
    const row = ctx.baseline[n.id];
    planned = row ? pair(row[0], row[1]) : { start: null, finish: null };
  }
  let forecast = pair(n.forecastStart, n.forecastFinish);
  if (forecast.start == null) forecast = { ...working };
  const actual: DateRange = { start: toDay(n.actualStart), finish: toDay(n.actualFinish) };

  const status = deriveStatus(n);
  const progress = status === 'completed' ? 100 : clamp(Math.round(Number(n.progress) || 0), 0, 100);
  const fin = status === 'completed' ? actual.finish ?? forecast.finish : forecast.finish;
  const variance = fin != null && planned.finish != null ? cal.diff(planned.finish, fin) : null;
  const pp = plannedPct(cal, planned, t);
  const overdue = status !== 'completed' && status !== 'cancelled' && forecast.finish != null && forecast.finish < t;
  const lateStart = status === 'not_started' && planned.start != null && planned.start < t;

  let health: Health, reason: HealthReason;
  if (status === 'cancelled') { health = 'none'; reason = { code: 'cancelled' }; }
  else if (status === 'completed') {
    health = 'done';
    reason = variance != null && variance > 0 ? { code: 'finished_late', days: variance } : { code: 'finished_on_plan' };
  }
  else if (forecast.finish == null) { health = 'none'; reason = { code: 'no_dates' }; }
  else if (overdue) { health = 'red'; reason = { code: 'overdue', date: forecast.finish }; }
  else if (variance != null && variance >= red) { health = 'red'; reason = { code: 'slip', days: variance }; }
  else if (variance != null && variance > 0) { health = 'amber'; reason = { code: 'slip', days: variance }; }
  else if (lateStart) { health = 'amber'; reason = { code: 'late_start', date: planned.start! }; }
  else if (status === 'on_hold') { health = 'amber'; reason = { code: 'on_hold' }; }
  else if (pp != null && pp - progress >= 25) { health = 'amber'; reason = { code: 'behind_plan', progress, planned: pp }; }
  else { health = 'green'; reason = { code: 'on_plan' }; }

  return {
    planned, forecast, actual, status, progress, plannedPct: pp, variance, overdue, lateStart, health, reason,
    milestone: forecast.start != null && forecast.start === forecast.finish,
  };
}

const mn = (x: Day | null, y: Day | null) => (x == null ? y : y == null ? x : Math.min(x, y));
const mx = (x: Day | null, y: Day | null) => (x == null ? y : y == null ? x : Math.max(x, y));

/** Roll children up into a parent, or all Level 1 items into the project (spec 4.5). */
function rollUp(list: Info[], ctx: Ctx): Info {
  const { cal, t, red } = ctx;
  const planned: DateRange = { start: null, finish: null };
  const forecast: DateRange = { start: null, finish: null };
  const actual: DateRange = { start: null, finish: null };
  let wsum = 0, psum = 0, ppw = 0, ppsum = 0, live = 0;
  let allDone = true, anyStarted = false, allHold = list.length > 0;
  let worst: Health = 'none';
  for (const c of list) {
    if (c.status === 'cancelled') continue;
    live++;
    planned.start = mn(planned.start, c.planned.start); planned.finish = mx(planned.finish, c.planned.finish);
    forecast.start = mn(forecast.start, c.forecast.start); forecast.finish = mx(forecast.finish, c.forecast.finish);
    actual.start = mn(actual.start, c.actual.start); actual.finish = mx(actual.finish, c.actual.finish);
    const span = c.planned.start != null ? c.planned : c.forecast.start != null ? c.forecast : null;
    const w = span ? Math.max(1, cal.count(span.start!, span.finish!)) : 1;
    wsum += w; psum += w * c.progress;
    if (c.plannedPct != null) { ppw += w; ppsum += w * c.plannedPct; }
    if (c.status !== 'completed') allDone = false;
    if (c.status === 'in_progress' || c.status === 'completed') anyStarted = true;
    if (c.status !== 'on_hold') allHold = false;
    if (HEALTH_RANK[c.health] > HEALTH_RANK[worst]) worst = c.health;
  }
  const status: DerivedStatus = !live ? 'cancelled' : allDone ? 'completed' : anyStarted ? 'in_progress' : allHold ? 'on_hold' : 'not_started';
  if (status !== 'completed') actual.finish = null;
  const progress = wsum ? Math.round(psum / wsum) : 0;
  const pp = ppw ? Math.round(ppsum / ppw) : null;
  const fin = status === 'completed' ? actual.finish ?? forecast.finish : forecast.finish;
  const variance = fin != null && planned.finish != null ? cal.diff(planned.finish, fin) : null;
  const overdue = status !== 'completed' && forecast.finish != null && forecast.finish < t;

  let health: Health, reason: HealthReason;
  if (status === 'completed') {
    health = 'done';
    reason = variance != null && variance > 0 ? { code: 'finished_late', days: variance } : { code: 'finished_on_plan' };
  }
  else if (forecast.finish == null) { health = 'none'; reason = { code: 'no_dates' }; }
  else if (overdue) { health = 'red'; reason = { code: 'overdue', date: forecast.finish }; }
  else if (variance != null && variance >= red) { health = 'red'; reason = { code: 'slip', days: variance }; }
  else if ((variance != null && variance > 0) || worst === 'red' || worst === 'amber') {
    health = 'amber';
    reason = variance != null && variance > 0 ? { code: 'slip', days: variance } : { code: 'children_need_attention' };
  }
  else { health = 'green'; reason = { code: 'on_plan' }; }

  return { planned, forecast, actual, status, progress, plannedPct: pp, variance, overdue, lateStart: false, health, reason, milestone: false };
}

interface Ctx {
  cal: WorkCalendar;
  t: Day;
  red: number;
  baseline: Record<string, [string | null, string | null]> | null;
}

/** Calculate every item, the project roll-up and the critical path. Pure: the project is not changed. */
export function computeProject(project: Project, opts: ComputeOptions = {}): ComputedProject {
  const cal = opts.calendar ?? new WorkCalendar();
  const t = toDay(project.settings.statusDate) ?? opts.today ?? todayDay();
  const red = Math.max(1, Math.round(Number(project.settings.redThresholdDays) || 10));
  const active = project.settings.activeBaselineId
    ? project.baselines.find(b => b.id === project.settings.activeBaselineId) ?? null
    : null;
  const ctx: Ctx = { cal, t, red, baseline: active ? active.items : null };
  const tree = new Tree(project.items);
  const items = new Map<string, ItemInfo>();

  const walk = (pid: string | null, prefix: string, level: number): Info[] => {
    const out: Info[] = [];
    tree.kids(pid).forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const kids = tree.kids(n.id);
      const info = kids.length ? rollUp(walk(n.id, code, level + 1), ctx) : leafInfo(n, ctx);
      const full: ItemInfo = { id: n.id, code, level, childCount: kids.length, ...info };
      items.set(n.id, full);
      out.push(full);
    });
    return out;
  };
  const project_ = rollUp(walk(null, '', 1), ctx);
  const edges = leafEdges(tree);
  const { cycle } = topoOrder(edges);
  const critical = criticalPath(tree, items, edges, cal);
  return { statusDate: t, items, project: project_, critical, hasCycle: cycle };
}

/** Finish used for driving successors: actual finish for completed items, else forecast. */
const effFinish = (i: ItemInfo) => (i.status === 'completed' ? i.actual.finish ?? i.forecast.finish : i.forecast.finish);
const effStart = (i: ItemInfo) => (i.status === 'completed' ? i.actual.start ?? i.forecast.start : i.forecast.start);

/** Spec 4.7: walk back from the latest-finishing leaf through driving predecessors. */
function criticalPath(
  tree: Tree,
  items: Map<string, ItemInfo>,
  edges: Map<string, { pred: string; lag: number }[]>,
  cal: WorkCalendar,
): Set<string> {
  const set = new Set<string>();
  if (!edges.size) return set;
  let end: Day | null = null, endId: string | null = null;
  for (const n of tree.items) {
    const i = items.get(n.id);
    if (!i || i.childCount || i.status === 'cancelled' || i.forecast.finish == null) continue;
    const fe = effFinish(i)!;
    if (end == null || fe > end) { end = fe; endId = n.id; }
  }
  const stack = endId ? [endId] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (set.has(id)) continue;
    set.add(id);
    const st = effStart(items.get(id)!);
    for (const { pred, lag } of edges.get(id) ?? []) {
      const pi = items.get(pred);
      if (!pi) continue;
      const pf = effFinish(pi);
      if (pf != null && st != null && cal.onOrAfter(cal.add(pf, 1 + lag)) >= st) stack.push(pred);
    }
  }
  return set.size > 1 ? set : new Set();
}

/** Overall project status for reports: red caused only by a child is softened to amber (spec 4.5). */
export function overallHealth(c: ComputedProject, redThresholdDays: number): Health {
  const p = c.project;
  if (p.health === 'red' && p.variance != null && p.variance < Math.max(1, redThresholdDays) && !p.overdue) return 'amber';
  return p.health;
}
