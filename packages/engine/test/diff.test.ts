import { describe, expect, it } from 'vitest';
import { ALL_DAYS, WorkCalendar } from '../src/calendar.js';
import { diffToOps } from '../src/diff.js';
import { type Op, applyOps } from '../src/ops.js';
import { Tree } from '../src/tree.js';
import type { Project, WbsItem } from '../src/types.js';
import { rng } from './helpers.js';
import { randomProject } from './random.js';

const CAL = new WorkCalendar(ALL_DAYS);
const apply = (p: Project, ops: Op[]) => applyOps(p, ops, { statusDate: 0, calendar: CAL, maxItems: Infinity }).project;

/** Items in tree order with sorted links, so two equal projects compare equal. */
function canonical(items: WbsItem[]) {
  const t = new Tree(items);
  const out: unknown[] = [];
  const walk = (pid: string | null) => {
    for (const n of t.kids(pid)) {
      out.push({ ...n, progress: Math.round(n.progress), deps: [...n.deps].sort((a, b) => a.id.localeCompare(b.id)) });
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

/** Random valid edits: some fail validation and are skipped, like a user's refused edits. */
function mutate(p: Project, seed: number): Project {
  const r = rng(seed);
  let cur = p;
  for (let k = 0; k < r.int(1, 12); k++) {
    const ids = cur.items.map(i => i.id);
    const pick = () => r.pick(ids);
    const candidates: Op[] = [
      { op: 'add', id: `new-${seed}-${k}`, parentId: ids.length && r.chance(0.6) ? pick() : null, values: { name: `N${k}`, forecastStart: '2026-03-01', forecastFinish: '2026-03-09' } },
      ...(ids.length ? [
        { op: 'delete', id: pick() } as Op,
        { op: 'move', id: pick(), parentId: r.chance(0.3) ? null : pick(), index: r.int(0, 3) } as Op,
        { op: 'set', id: pick(), field: 'name', value: `Renamed ${k}` } as Op,
        { op: 'set', id: pick(), field: 'progress', value: r.int(0, 100) } as Op,
        { op: 'set', id: pick(), field: 'forecastFinish', value: `2026-0${r.int(4, 9)}-1${r.int(0, 9)}` } as Op,
        { op: 'set', id: pick(), field: 'status', value: r.pick(['auto', 'on_hold', 'completed', 'cancelled'] as const) } as Op,
        { op: 'link', succ: pick(), pred: pick(), lag: r.int(-2, 4) } as Op,
        { op: 'unlink', succ: pick(), pred: pick() } as Op,
      ] : []),
    ];
    try { cur = apply(cur, [r.pick(candidates)]); } catch { /* refused edit */ }
  }
  return cur;
}

describe('diffToOps (undo / redo)', () => {
  it('turns any edited project back into the original, and forward again (1,000 random cases)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const a = randomProject(seed);
      a.settings.autoSchedule = false;
      const b = mutate(a, seed + 9000);
      const undo = diffToOps(b.items, a.items);
      expect(canonical(apply(b, undo).items), `undo, seed ${seed}`).toEqual(canonical(a.items));
      const redo = diffToOps(a.items, b.items);
      expect(canonical(apply(a, redo).items), `redo, seed ${seed}`).toEqual(canonical(b.items));
    }
  });

  it('produces nothing when there is no difference', () => {
    const a = randomProject(7);
    expect(diffToOps(a.items, a.items)).toEqual([]);
  });
});
