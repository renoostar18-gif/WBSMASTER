import { validateLink } from '../src/deps.js';
import { Tree } from '../src/tree.js';
import type { Project, Status, WbsItem } from '../src/types.js';
import { iso, item, project, rng } from './helpers.js';

export const BASE = Date.UTC(2026, 0, 1) / 864e5;
export const TODAY = BASE + 120;
const STATUSES: Status[] = ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'];

/** A random but valid project. `allDated` gives every leaf dates (for schedule comparisons). */
export function randomProject(seed: number, allDated = false): Project {
  const r = rng(seed);
  const n = r.int(1, 28);
  const items: WbsItem[] = [];
  for (let k = 0; k < n; k++) {
    const parentId = k > 0 && r.chance(0.6) ? items[r.int(0, k - 1)]!.id : null;
    const it = item(`n${k}`, parentId, { progress: r.chance(0.5) ? r.int(0, 100) : 0 });
    if (allDated || r.chance(0.8)) {
      const s = BASE + r.int(-60, 220), d = r.int(0, 45);
      it.plannedStart = r.chance(0.92) ? iso(s) : null;
      it.plannedFinish = r.chance(0.92) || !it.plannedStart ? iso(s + d) : null;
    }
    if (r.chance(0.6) || (allDated && !it.plannedStart)) {
      const s = BASE + r.int(-60, 230), d = r.int(0, 50);
      it.forecastStart = iso(s);
      it.forecastFinish = allDated || r.chance(0.9) ? iso(s + d) : null;
    }
    if (r.chance(0.3)) it.actualStart = iso(BASE + r.int(-60, 150));
    if (r.chance(0.2)) it.actualFinish = iso(BASE + r.int(-30, 170));
    if (it.actualStart && it.actualFinish && it.actualFinish < it.actualStart) it.actualFinish = it.actualStart;
    if (r.chance(0.35)) it.status = r.pick(STATUSES);
    items.push(it);
  }
  const p = project(items, {
    redThresholdDays: r.int(1, 15),
    statusDate: r.chance(0.5) ? iso(BASE + r.int(0, 200)) : null,
  });
  // links, added only when valid
  const links = r.int(0, Math.min(14, n));
  for (let k = 0; k < links; k++) {
    const s = r.pick(p.items).id, pr = r.pick(p.items).id;
    if (validateLink(new Tree(p.items), s, pr) === null) {
      p.items = p.items.map(i => (i.id === s ? { ...i, deps: [...i.deps, { id: pr, lag: r.int(-3, 6) }] } : i));
    }
  }
  if (r.chance(0.3)) {
    const rows: Record<string, [string | null, string | null]> = {};
    for (const i of p.items) if (r.chance(0.7)) { const s = BASE + r.int(-40, 200); rows[i.id] = [iso(s), iso(s + r.int(0, 30))]; }
    p.baselines = [{ id: 'b1', name: 'B1', setOn: iso(BASE), reason: '', items: rows }];
    if (r.chance(0.7)) p.settings.activeBaselineId = 'b1';
  }
  return p;
}

