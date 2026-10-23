import { healthRank, overallHealth } from './compute.js';
import { Tree } from './tree.js';
import type { ComputedProject, Health, ItemInfo, Project, WbsItem } from './types.js';

export interface ReportRow {
  item: WbsItem;
  info: ItemInfo;
}

export interface ReportData {
  overall: Health;
  /** Non-cancelled leaves. */
  live: ReportRow[];
  counts: Record<Health, number>;
  /** Red first, then amber, then largest variance. */
  delayed: ReportRow[];
  /** Completed in the last 30 calendar days. */
  recentlyDone: ReportRow[];
  /** Due, or not started and starting, in the next 30 calendar days. */
  upcoming: ReportRow[];
  milestones: ReportRow[];
  critical: ReportRow[];
  /** Items down to `maxLevel`, in tree order. */
  byElement: ReportRow[];
}

/** Report windows are calendar days, because people read them as dates (spec 4.10). */
export const REPORT_WINDOW_DAYS = 30;

/** Data behind the project Summary view and exported reports (spec 4.9). */
export function reportData(project: Project, c: ComputedProject, maxLevel = 1): ReportData {
  const tree = new Tree(project.items);
  const t = c.statusDate;
  const rows = (list: WbsItem[]) => list.map(item => ({ item, info: c.items.get(item.id)! })).filter(r => r.info);
  const leaves = rows(tree.leaves());
  const live = leaves.filter(r => r.info.status !== 'cancelled');
  const counts: Record<Health, number> = { green: 0, amber: 0, red: 0, done: 0, none: 0 };
  for (const r of live) counts[r.info.health]++;
  const delayed = live
    .filter(r => r.info.health === 'red' || r.info.health === 'amber')
    .sort((a, b) => healthRank(b.info.health) - healthRank(a.info.health) || (b.info.variance ?? 0) - (a.info.variance ?? 0));
  const recentlyDone = live
    .filter(r => r.info.status === 'completed' && r.info.actual.finish != null && r.info.actual.finish >= t - REPORT_WINDOW_DAYS && r.info.actual.finish <= t)
    .sort((a, b) => b.info.actual.finish! - a.info.actual.finish!);
  const upcoming = live
    .filter(({ info: i }) => i.status !== 'completed' && i.forecast.start != null && (
      (i.forecast.finish! >= t && i.forecast.finish! <= t + REPORT_WINDOW_DAYS) ||
      (i.status === 'not_started' && i.forecast.start >= t && i.forecast.start <= t + REPORT_WINDOW_DAYS)))
    .sort((a, b) => a.info.forecast.finish! - b.info.forecast.finish!);
  const milestones = live
    .filter(r => r.info.milestone || (r.info.planned.start != null && r.info.planned.start === r.info.planned.finish))
    .sort((a, b) => (a.info.forecast.finish ?? 1e9) - (b.info.forecast.finish ?? 1e9));
  const critical = live.filter(r => c.critical.has(r.item.id)).sort((a, b) => (a.info.forecast.start ?? 0) - (b.info.forecast.start ?? 0));
  const byElement: ReportRow[] = [];
  const walk = (pid: string | null) => {
    for (const n of tree.kids(pid)) {
      const info = c.items.get(n.id);
      if (!info || info.level > maxLevel) continue;
      byElement.push({ item: n, info });
      walk(n.id);
    }
  };
  walk(null);
  return {
    overall: overallHealth(c, project.settings.redThresholdDays),
    live, counts, delayed, recentlyDone, upcoming, milestones, critical, byElement,
  };
}
