import { ALL_DAYS, WorkCalendar } from './calendar.js';
import { type Op, applyOps } from './ops.js';
import { Tree } from './tree.js';
import { DEFAULT_SETTINGS, type Project, type WbsItem } from './types.js';

const FIELDS = [
  'name', 'owner', 'notes', 'plannedStart', 'plannedFinish', 'forecastStart', 'forecastFinish',
  'actualStart', 'actualFinish', 'status', 'progress',
] as const;

const CAL = new WorkCalendar(ALL_DAYS);

/**
 * Edits that turn `current` into `target`: used for undo/redo and for
 * re-importing a workbook. Applying the result to `current` (with
 * auto-schedule off) gives the same tree, sibling order, fields and links.
 */
export function diffToOps(current: WbsItem[], target: WbsItem[]): Op[] {
  const ops: Op[] = [];
  let sim: Project = { id: '', name: '', items: current, baselines: [], settings: { ...DEFAULT_SETTINGS, autoSchedule: false } };
  const emit = (op: Op) => {
    sim = applyOps(sim, [op], { statusDate: 0, calendar: CAL, maxItems: Infinity }).project;
    ops.push(op);
  };
  const want = new Tree(target);
  const wantIds = new Set(target.map(i => i.id));

  // 1. structure: walk the target tree, adding missing items and moving the rest into place
  const walk = (parentId: string | null) => {
    want.kids(parentId).forEach((n, index) => {
      const have = sim.items.find(i => i.id === n.id);
      if (!have) emit({ op: 'add', id: n.id, parentId, afterId: undefined });
      const t = new Tree(sim.items);
      const cur = sim.items.find(i => i.id === n.id)!;
      const pos = t.kids(parentId).indexOf(cur);
      if (cur.parentId !== parentId || pos !== index) emit({ op: 'move', id: n.id, parentId, index });
      walk(n.id);
    });
  };
  walk(null);

  // 2. items that are not in the target: delete the top-most ones (sub-items go with them)
  const simTree = new Tree(sim.items);
  for (const i of sim.items) {
    if (wantIds.has(i.id)) continue;
    const p = simTree.parentOf(i.id);
    if (p == null || wantIds.has(p)) emit({ op: 'delete', id: i.id });
  }

  // 3. links: remove, then add, then fix lags
  const targetById = new Map(target.map(i => [i.id, i]));
  for (const i of [...sim.items]) {
    const tdeps = targetById.get(i.id)!.deps;
    for (const d of i.deps) if (!tdeps.some(x => x.id === d.id)) emit({ op: 'unlink', succ: i.id, pred: d.id });
  }
  for (const t of target) {
    const cur = sim.items.find(i => i.id === t.id)!;
    for (const d of t.deps) {
      const c = cur.deps.find(x => x.id === d.id);
      if (!c) emit({ op: 'link', succ: t.id, pred: d.id, lag: d.lag });
      else if (c.lag !== d.lag) emit({ op: 'setLag', succ: t.id, pred: d.id, lag: d.lag });
    }
  }

  // 4. stored values, written exactly (a parent keeps dates it had before it got sub-items)
  for (const t of target) {
    const cur = sim.items.find(i => i.id === t.id)!;
    const values: Record<string, unknown> = {};
    for (const f of FIELDS) if ((cur[f] ?? null) !== (t[f] ?? null)) values[f] = t[f] ?? null;
    if (Object.keys(values).length) emit({ op: 'put', id: t.id, values } as Op);
  }
  return ops;
}
