import {
  type CalendarDefinition, type ComputedProject, DEFAULT_SETTINGS, type ItemInfo, type Project, SAUDI_WEEK,
  type WbsItem, WorkCalendar, toIso,
} from '@wbs-master/engine';
import type { Queryable } from './db.js';
import { notFound } from './errors.js';

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  status_date: string | null;
  red_threshold_days: number;
  auto_schedule: boolean;
  active_baseline_id: string | null;
  calendar_id: string | null;
  locale: string;
  version: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface LoadedProject {
  row: ProjectRow;
  project: Project;
  /** sort_key per item id, to keep keys stable on save. */
  sortKeys: Map<string, number>;
  calendar: CalendarDefinition;
}

interface ItemRow {
  id: string; parent_id: string | null; sort_key: number; name: string; owner_text: string; status: WbsItem['status'];
  planned_start: string | null; planned_finish: string | null; forecast_start: string | null; forecast_finish: string | null;
  actual_start: string | null; actual_finish: string | null; progress: number; notes: string;
}

/** Load a project into the engine's model. `forUpdate` locks the row for the rest of the transaction. */
export async function loadProject(q: Queryable, projectId: string, forUpdate = false): Promise<LoadedProject> {
  const pr = await q.query<ProjectRow>(`select * from projects where id = $1 ${forUpdate ? 'for update' : ''}`, [projectId]);
  const row = pr.rows[0];
  if (!row) throw notFound('project_not_found');
  const [items, deps, bls, blItems] = await Promise.all([
    q.query<ItemRow>('select * from wbs_items where project_id = $1 order by sort_key, id', [projectId]),
    q.query<{ successor_id: string; predecessor_id: string; lag_days: number }>(
      'select successor_id, predecessor_id, lag_days from dependencies where project_id = $1 order by successor_id, predecessor_id', [projectId]),
    q.query<{ id: string; name: string; set_on: string; reason: string }>(
      'select id, name, set_on, reason from baselines where project_id = $1 order by position', [projectId]),
    q.query<{ baseline_id: string; item_id: string; planned_start: string | null; planned_finish: string | null }>(
      'select bi.* from baseline_items bi join baselines b on b.id = bi.baseline_id where b.project_id = $1', [projectId]),
  ]);
  const depsBy = new Map<string, { id: string; lag: number }[]>();
  for (const d of deps.rows) {
    let l = depsBy.get(d.successor_id);
    if (!l) depsBy.set(d.successor_id, (l = []));
    l.push({ id: d.predecessor_id, lag: d.lag_days });
  }
  const sortKeys = new Map<string, number>();
  const engineItems: WbsItem[] = items.rows.map(r => {
    sortKeys.set(r.id, r.sort_key);
    return {
      id: r.id, parentId: r.parent_id, name: r.name, owner: r.owner_text, status: r.status,
      plannedStart: r.planned_start, plannedFinish: r.planned_finish, forecastStart: r.forecast_start, forecastFinish: r.forecast_finish,
      actualStart: r.actual_start, actualFinish: r.actual_finish, progress: r.progress, notes: r.notes,
      deps: depsBy.get(r.id) ?? [],
    };
  });
  const blMap = new Map(bls.rows.map(b => [b.id, { id: b.id, name: b.name, setOn: b.set_on, reason: b.reason, items: {} as Record<string, [string | null, string | null]> }]));
  for (const bi of blItems.rows) blMap.get(bi.baseline_id)!.items[bi.item_id] = [bi.planned_start, bi.planned_finish];
  return {
    row,
    project: {
      id: row.id, name: row.name, items: engineItems, baselines: [...blMap.values()],
      settings: {
        ...DEFAULT_SETTINGS,
        statusDate: row.status_date, redThresholdDays: row.red_threshold_days,
        autoSchedule: row.auto_schedule, activeBaselineId: row.active_baseline_id,
      },
    },
    sortKeys,
    calendar: await loadCalendar(q, row),
  };
}

/** The project's calendar: its chosen calendar (or the organisation default), plus project-only exceptions. */
export async function loadCalendar(q: Queryable, row: Pick<ProjectRow, 'id' | 'org_id' | 'calendar_id'>): Promise<CalendarDefinition> {
  const cal = await q.query<{ id: string; week_days: number[] }>(
    `select id, week_days from calendars where org_id = $1 and (id = $2 or ($2::uuid is null and is_default)) limit 1`,
    [row.org_id, row.calendar_id],
  );
  const c = cal.rows[0];
  const ex = await q.query<{ date: string; is_working: boolean; name: string; estimated: boolean; project_id: string | null }>(
    `select date, is_working, name, estimated, project_id from calendar_exceptions
      where calendar_id = $1 or project_id = $2 order by (project_id is not null), date`,
    [c?.id ?? null, row.id],
  );
  // project rows come last, so they override calendar rows for the same date
  const byDate = new Map(ex.rows.map(e => [e.date, { date: e.date, working: e.is_working, name: e.name, estimated: e.estimated }]));
  return { weekDays: c?.week_days ?? SAUDI_WEEK.weekDays, exceptions: [...byDate.values()] };
}

export const calendarOf = (def: CalendarDefinition) => new WorkCalendar(def);

/** Item calculations with day numbers turned into ISO dates, for JSON. */
export function serializeComputed(c: ComputedProject) {
  const range = (r: { start: number | null; finish: number | null }) => ({ start: toIso(r.start), finish: toIso(r.finish) });
  const info = (i: Omit<ItemInfo, 'id' | 'code' | 'level' | 'childCount'>) => ({
    ...i,
    planned: range(i.planned), forecast: range(i.forecast), actual: range(i.actual),
    reason: 'date' in i.reason ? { ...i.reason, date: toIso(i.reason.date) } : i.reason,
  });
  const items: Record<string, unknown> = {};
  for (const [id, i] of c.items) items[id] = { ...info(i), id, code: i.code, level: i.level, childCount: i.childCount };
  return { statusDate: toIso(c.statusDate), items, project: info(c.project), critical: [...c.critical], hasCycle: c.hasCycle };
}

/**
 * Sibling order is stored as a fractional sort_key. Keep existing keys where
 * they are already in order, and give new or moved items keys between their
 * neighbours, so a reorder touches few rows.
 */
export function assignSortKeys(items: WbsItem[], old: Map<string, number>): Map<string, number> {
  const groups = new Map<string | null, WbsItem[]>();
  for (const i of items) {
    let g = groups.get(i.parentId);
    if (!g) groups.set(i.parentId, (g = []));
    g.push(i);
  }
  const out = new Map<string, number>();
  for (const g of groups.values()) {
    const keep = longestIncreasing(g.map(i => old.get(i.id)));
    let ok = true;
    for (let a = 0; a < g.length;) {
      if (keep[a]) { out.set(g[a]!.id, old.get(g[a]!.id)!); a++; continue; }
      let b = a;
      while (b < g.length && !keep[b]) b++;
      const lo = a > 0 ? out.get(g[a - 1]!.id)! : (b < g.length ? old.get(g[b]!.id)! - (b - a + 1) : 0);
      const hi = b < g.length ? old.get(g[b]!.id)! : lo + (b - a + 1);
      const step = (hi - lo) / (b - a + 1);
      if (!(step > 1e-9)) { ok = false; break; }
      for (let k = a; k < b; k++) out.set(g[k]!.id, lo + step * (k - a + 1));
      a = b;
    }
    if (!ok) g.forEach((i, k) => out.set(i.id, k + 1)); // gaps exhausted: renumber this group
  }
  return out;
}

/** Marks the longest strictly increasing run of existing keys (undefined = new item), so as few items as possible get new keys. */
function longestIncreasing(keys: (number | undefined)[]): boolean[] {
  const tails: number[] = [], prev: number[] = new Array(keys.length).fill(-1);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === undefined) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (keys[tails[m]!]! < k) lo = m + 1; else hi = m; }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Array(keys.length).fill(false);
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) keep[i] = true;
  return keep;
}
