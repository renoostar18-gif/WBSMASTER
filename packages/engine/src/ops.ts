import { applyEdit, blankItem, type EditableField } from './edits.js';
import type { Day } from './dates.js';
import { leafEdges, parseDepsText, topoOrder, validateLink, wouldCycle } from './deps.js';
import { autoSchedule } from './schedule.js';
import { Tree } from './tree.js';
import type { WorkCalendar } from './calendar.js';
import type { Project, Status, WbsItem } from './types.js';

type DateField = 'plannedStart' | 'plannedFinish' | 'forecastStart' | 'forecastFinish' | 'actualStart' | 'actualFinish';

export interface ItemValues {
  name?: string; owner?: string; notes?: string; status?: Status; progress?: number;
  plannedStart?: string | null; plannedFinish?: string | null; forecastStart?: string | null; forecastFinish?: string | null;
  actualStart?: string | null; actualFinish?: string | null;
}

/** One edit. The web app applies a batch locally for instant feedback; the API applies it again and saves. */
export type Op =
  | { op: 'add'; id?: string; parentId: string | null; afterId?: string | null; values?: ItemValues }
  | ({ op: 'set'; id: string } & (
      | { field: 'name' | 'owner' | 'notes'; value: string }
      | { field: 'status'; value: Status }
      | { field: 'progress'; value: number }
      | { field: DateField; value: string | null }))
  | { op: 'move'; id: string; parentId: string | null; index: number }
  | { op: 'delete'; id: string }
  /** Write stored values exactly, with no edit side effects; allowed on parents. Used by undo/redo and restores. */
  | { op: 'put'; id: string; values: ItemValues }
  | { op: 'link'; succ: string; pred: string; lag?: number }
  | { op: 'unlink'; succ: string; pred: string }
  | { op: 'setLag'; succ: string; pred: string; lag: number }
  | { op: 'setDeps'; id: string; text: string };

/** Random UUID (browsers and Node 19+ both provide crypto.randomUUID). */
const uuid = (): string => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

/** Fields that parents roll up from their children and cannot be edited directly (spec 4.1). */
const ROLLED_UP = new Set<EditableField>(['status', 'progress', 'plannedStart', 'plannedFinish', 'forecastStart', 'forecastFinish', 'actualStart', 'actualFinish']);

export class OpError extends Error {
  constructor(readonly code: string, readonly index: number, readonly details?: unknown) {
    super(code);
  }
}

export interface ApplyResult {
  project: Project;
  /** Items moved by auto-schedule. */
  scheduled: string[];
  /** Ids created by 'add' ops, in order. */
  created: string[];
  /** Tokens ignored in 'setDeps' text. */
  ignoredDeps: string[];
}

/**
 * Apply a batch of edits to a project in memory. Throws OpError (with the
 * index of the failing op) and changes nothing if any op is invalid. Ends with
 * auto-schedule, like every change in the prototype.
 */
export function applyOps(
  input: Project,
  ops: Op[],
  ctx: { statusDate: Day; calendar: WorkCalendar; maxItems: number },
): ApplyResult {
  let items: WbsItem[] = input.items.map(i => ({ ...i, deps: i.deps.map(d => ({ ...d })) }));
  const created: string[] = [], ignoredDeps: string[] = [];
  const tree = () => new Tree(items);
  const find = (id: string, k: number) => {
    const n = items.find(i => i.id === id);
    if (!n) throw new OpError('item_not_found', k, { id });
    return n;
  };
  const replace = (n: WbsItem) => { items = items.map(i => (i.id === n.id ? n : i)); };

  ops.forEach((op, k) => {
    switch (op.op) {
      case 'add': {
        if (items.length >= ctx.maxItems) throw new OpError('plan_item_limit', k, { limit: ctx.maxItems });
        const id = op.id ?? uuid();
        if (items.some(i => i.id === id)) throw new OpError('duplicate_id', k, { id });
        if (op.parentId) find(op.parentId, k);
        const parent = op.parentId ? items.find(i => i.id === op.parentId) : undefined;
        let n = blankItem(op.parentId, { id, owner: parent?.owner ?? '' });
        for (const [field, value] of Object.entries(op.values ?? {})) {
          n = applyEdit(n, field as EditableField, value as string | number | null, ctx.statusDate);
        }
        const siblings = items.filter(i => i.parentId === op.parentId);
        let at: number;
        if (op.afterId === undefined) at = siblings.length ? items.indexOf(siblings[siblings.length - 1]!) + 1 : items.length;
        else if (op.afterId === null) at = siblings.length ? items.indexOf(siblings[0]!) : items.length;
        else {
          const after = find(op.afterId, k);
          if (after.parentId !== op.parentId) throw new OpError('after_not_sibling', k);
          at = items.indexOf(after) + 1;
        }
        items.splice(at, 0, n);
        created.push(id);
        break;
      }
      case 'set': {
        const n = find(op.id, k);
        if (ROLLED_UP.has(op.field) && !tree().isLeaf(n.id)) throw new OpError('parent_rolled_up', k, { field: op.field });
        replace(applyEdit(n, op.field, op.value, ctx.statusDate));
        break;
      }
      case 'move': {
        const n = find(op.id, k);
        const t = tree();
        if (op.parentId && (op.parentId === n.id || t.descendants(n.id).includes(op.parentId))) throw new OpError('move_into_self', k);
        if (op.parentId) find(op.parentId, k);
        items = items.filter(i => i.id !== n.id);
        const moved = { ...n, parentId: op.parentId };
        const siblings = items.filter(i => i.parentId === op.parentId);
        const at = op.index < siblings.length
          ? items.indexOf(siblings[op.index]!)
          : siblings.length ? items.indexOf(siblings[siblings.length - 1]!) + 1 : items.length;
        items.splice(at, 0, moved);
        // a move can make a link point inside its own family, or close a loop
        const t2 = tree();
        items = items.map(i => {
          const deps = i.deps.filter(d => t2.byId.has(d.id) && !t2.related(i.id, d.id));
          return deps.length === i.deps.length ? i : { ...i, deps };
        });
        if (topoOrder(leafEdges(tree())).cycle) throw new OpError('cycle', k);
        break;
      }
      case 'put': {
        const n = find(op.id, k);
        const v = { ...op.values };
        if (v.progress !== undefined) v.progress = Math.max(0, Math.min(100, Math.round(Number(v.progress) || 0)));
        replace({ ...n, ...v });
        break;
      }
      case 'delete': {
        find(op.id, k);
        const gone = new Set([op.id, ...tree().descendants(op.id)]);
        items = items
          .filter(i => !gone.has(i.id))
          .map(i => (i.deps.some(d => gone.has(d.id)) ? { ...i, deps: i.deps.filter(d => !gone.has(d.id)) } : i));
        break;
      }
      case 'link': {
        const err = validateLink(tree(), op.succ, op.pred);
        if (err) throw new OpError(err === 'not_found' ? 'item_not_found' : `link_${err}`, k);
        const n = find(op.succ, k);
        replace({ ...n, deps: [...n.deps, { id: op.pred, lag: op.lag ?? 0 }] });
        break;
      }
      case 'unlink': {
        const n = find(op.succ, k);
        replace({ ...n, deps: n.deps.filter(d => d.id !== op.pred) });
        break;
      }
      case 'setLag': {
        const n = find(op.succ, k);
        if (!n.deps.some(d => d.id === op.pred)) throw new OpError('link_not_found', k);
        replace({ ...n, deps: n.deps.map(d => (d.id === op.pred ? { ...d, lag: op.lag } : d)) });
        break;
      }
      case 'setDeps': {
        const n = find(op.id, k);
        const t = tree();
        const idByCode = new Map([...t.codes()].map(([id, c]) => [c.code, id]));
        const { deps, invalid } = parseDepsText(op.text, n.id, idByCode, t);
        if (wouldCycle(t, n.id, deps)) throw new OpError('link_cycle', k);
        ignoredDeps.push(...invalid);
        replace({ ...n, deps });
        break;
      }
    }
  });

  const next: Project = { ...input, items };
  const s = autoSchedule(next, ctx.calendar);
  return { project: { ...next, items: s.items }, scheduled: s.moved, created, ignoredDeps };
}
