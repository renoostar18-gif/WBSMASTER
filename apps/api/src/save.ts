import type { Project, WbsItem } from '@wbs-master/engine';
import type { Tx } from './db.js';
import { type LoadedProject, assignSortKeys } from './store.js';

const FIELDS: [keyof WbsItem, string][] = [
  ['name', 'name'], ['owner', 'owner_text'], ['status', 'status'], ['progress', 'progress'], ['notes', 'notes'],
  ['plannedStart', 'planned_start'], ['plannedFinish', 'planned_finish'],
  ['forecastStart', 'forecast_start'], ['forecastFinish', 'forecast_finish'],
  ['actualStart', 'actual_start'], ['actualFinish', 'actual_finish'],
];

export interface SaveSummary {
  added: string[];
  removed: string[];
  updated: string[];
  version: number;
}

/**
 * Write the difference between the loaded project and `next`: items, sibling
 * order and links. Every change is logged in activity_log. Bumps the project
 * version. Must run in the transaction that loaded the project `for update`.
 */
export async function saveItems(c: Tx, loaded: LoadedProject, next: Project, actorId: string, scheduled: string[] = []): Promise<SaveSummary> {
  const projectId = loaded.row.id;
  const before = new Map(loaded.project.items.map(i => [i.id, i]));
  const after = new Map(next.items.map(i => [i.id, i]));
  const keys = assignSortKeys(next.items, loaded.sortKeys);
  const added: string[] = [], removed: string[] = [], updated: string[] = [];
  const log: [string | null, string, string | null, unknown, unknown][] = [];
  const auto = new Set(scheduled);

  // deletes first: children cascade with their parent
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);
  if (removed.length) {
    await c.query('delete from wbs_items where project_id = $1 and id = any($2::uuid[])', [projectId, removed]);
    for (const id of removed) log.push([id, 'item.delete', 'name', before.get(id)!.name, null]);
  }

  // inserts in array order so a parent always exists before its children
  const order = topoByParent(next.items);
  for (const n of order) {
    const old = before.get(n.id);
    const key = keys.get(n.id)!;
    if (!old) {
      await c.query(
        `insert into wbs_items (id, project_id, parent_id, sort_key, name, owner_text, status, planned_start, planned_finish,
           forecast_start, forecast_finish, actual_start, actual_finish, progress, notes, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [n.id, projectId, n.parentId, key, n.name, n.owner, n.status, n.plannedStart, n.plannedFinish,
          n.forecastStart, n.forecastFinish, n.actualStart, n.actualFinish, Math.round(n.progress), n.notes, actorId],
      );
      added.push(n.id);
      log.push([n.id, 'item.add', 'name', null, n.name]);
      continue;
    }
    const sets: string[] = [], vals: unknown[] = [];
    for (const [f, col] of FIELDS) {
      const a = old[f], b = n[f];
      if ((a ?? null) === (b ?? null)) continue;
      vals.push(f === 'progress' ? Math.round(b as number) : b);
      sets.push(`${col} = $${vals.length}`);
      log.push([n.id, auto.has(n.id) && (f === 'forecastStart' || f === 'forecastFinish' || f === 'plannedStart' || f === 'plannedFinish') ? 'item.schedule' : 'item.update', f, a ?? null, b ?? null]);
    }
    if (old.parentId !== n.parentId) {
      vals.push(n.parentId);
      sets.push(`parent_id = $${vals.length}`);
      log.push([n.id, 'item.move', 'parent', old.parentId, n.parentId]);
    }
    if (loaded.sortKeys.get(n.id) !== key) {
      vals.push(key);
      sets.push(`sort_key = $${vals.length}`);
      if (old.parentId === n.parentId) log.push([n.id, 'item.move', 'position', null, null]);
    }
    if (!sets.length) continue;
    vals.push(actorId, n.id, projectId);
    await c.query(
      `update wbs_items set ${sets.join(', ')}, updated_at = now(), updated_by = $${vals.length - 2}
        where id = $${vals.length - 1} and project_id = $${vals.length}`,
      vals,
    );
    updated.push(n.id);
  }

  // links: replace the rows that changed
  const linkKey = (s: string, p: string) => `${s}|${p}`;
  const oldLinks = new Map<string, number>(), newLinks = new Map<string, number>();
  for (const i of before.values()) for (const d of i.deps) oldLinks.set(linkKey(i.id, d.id), d.lag);
  for (const i of after.values()) for (const d of i.deps) newLinks.set(linkKey(i.id, d.id), d.lag);
  for (const [k, lag] of oldLinks) {
    if (newLinks.get(k) === lag) continue;
    const [s, p] = k.split('|');
    if (after.has(s!) && after.has(p!)) {
      await c.query('delete from dependencies where successor_id = $1 and predecessor_id = $2', [s, p]);
      if (!newLinks.has(k)) log.push([s!, 'link.remove', 'predecessor', p, null]);
    }
  }
  for (const [k, lag] of newLinks) {
    if (oldLinks.get(k) === lag) continue;
    const [s, p] = k.split('|');
    await c.query(
      'insert into dependencies (project_id, successor_id, predecessor_id, lag_days) values ($1, $2, $3, $4)',
      [projectId, s, p, lag],
    );
    log.push([s!, oldLinks.has(k) ? 'link.lag' : 'link.add', 'predecessor', oldLinks.has(k) ? { id: p, lag: oldLinks.get(k) } : null, { id: p, lag }]);
  }

  if (log.length) {
    await c.query(
      `insert into activity_log (project_id, item_id, actor_id, action, field, old_value, new_value)
       select $1, x.item_id, $2, x.action, x.field, x.old_value, x.new_value
         from jsonb_to_recordset($3::jsonb) as x(item_id uuid, action text, field text, old_value jsonb, new_value jsonb)`,
      [projectId, actorId, JSON.stringify(log.map(([item_id, action, field, o, n]) => ({
        item_id, action, field, old_value: o, new_value: n,
      })))],
    );
  }
  const v = await c.query<{ version: number }>(
    'update projects set version = version + 1, updated_at = now(), updated_by = $2 where id = $1 returning version',
    [projectId, actorId],
  );
  return { added, removed, updated, version: v.rows[0]!.version };
}

/** Items ordered so every parent comes before its children (array order otherwise kept). */
function topoByParent(items: WbsItem[]): WbsItem[] {
  const out: WbsItem[] = [];
  const done = new Set<string>();
  const byId = new Map(items.map(i => [i.id, i]));
  const visit = (i: WbsItem) => {
    if (done.has(i.id)) return;
    const p = i.parentId ? byId.get(i.parentId) : undefined;
    if (p) visit(p);
    done.add(i.id);
    out.push(i);
  };
  items.forEach(visit);
  return out;
}
