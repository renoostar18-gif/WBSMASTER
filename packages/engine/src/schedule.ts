import { WorkCalendar } from './calendar.js';
import { type Day, toDay, toIso } from './dates.js';
import { leafEdges, topoOrder } from './deps.js';
import { Tree } from './tree.js';
import type { Project, WbsItem } from './types.js';

export interface ScheduleResult {
  items: WbsItem[];
  /** Ids of items whose dates were moved. */
  moved: string[];
  cycle: boolean;
}

/** Working days given to a successor that had no dates when it was scheduled. */
export const DEFAULT_NEW_DURATION = 5;

const rawStart = (n: WbsItem) => toDay(n.forecastStart) ?? toDay(n.plannedStart) ?? toDay(n.forecastFinish) ?? toDay(n.plannedFinish);
const rawFinish = (n: WbsItem) => toDay(n.forecastFinish) ?? toDay(n.plannedFinish) ?? toDay(n.forecastStart) ?? toDay(n.plannedStart);

function predecessorFinish(p: WbsItem): Day | null {
  if (p.status === 'cancelled') return null;
  return toDay(p.actualFinish) ?? rawFinish(p);
}

/**
 * Push successors later when a predecessor finishes later (spec 4.6). Never
 * pulls work earlier. Items with an actual date, or completed or cancelled,
 * are never moved. Calculated dates always land on working days.
 */
export function autoSchedule(project: Project, cal: WorkCalendar = new WorkCalendar()): ScheduleResult {
  const items = project.items.map(i => ({ ...i }));
  if (!project.settings.autoSchedule) return { items, moved: [], cycle: false };
  const tree = new Tree(items);
  const edges = leafEdges(tree);
  if (!edges.size) return { items, moved: [], cycle: false };
  const { order, cycle } = topoOrder(edges);
  const moved: string[] = [];
  for (const id of order) {
    const n = tree.byId.get(id);
    const preds = edges.get(id);
    if (!n || !preds) continue;
    if (n.actualStart || n.actualFinish || n.status === 'completed' || n.status === 'cancelled') continue;
    let earliest: Day | null = null;
    for (const { pred, lag } of preds) {
      const p = tree.byId.get(pred);
      const pf = p ? predecessorFinish(p) : null;
      if (pf == null) continue;
      const c = cal.onOrAfter(cal.add(pf, 1 + lag));
      if (earliest == null || c > earliest) earliest = c;
    }
    if (earliest == null) continue;
    const s0 = rawStart(n), e0 = rawFinish(n);
    if (s0 == null) {
      n.forecastStart = toIso(earliest);
      n.forecastFinish = toIso(cal.add(earliest, DEFAULT_NEW_DURATION - 1));
      if (!n.plannedStart) { n.plannedStart = n.forecastStart; n.plannedFinish = n.forecastFinish; }
      moved.push(id);
    } else if (s0 < earliest) {
      const duration = cal.count(s0, e0 ?? s0);
      n.forecastStart = toIso(earliest);
      n.forecastFinish = toIso(duration >= 1 ? cal.add(earliest, duration - 1) : earliest);
      moved.push(id);
    }
  }
  return { items, moved, cycle };
}
