import { randomUUID } from 'node:crypto';
import {
  type Day, type EditableField, type Project, Tree, type WbsItem, type WorkCalendar,
  applyEdit, autoSchedule, blankItem, leafEdges, parseDepsText, topoOrder, toDay, validateLink, wouldCycle,
} from '@wbs-master/engine';
import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => toDay(s) != null, 'invalid date');
const lag = z.number().int().min(-365).max(365);

const itemValues = z.object({
  name: z.string().max(300),
  owner: z.string().max(120),
  notes: z.string().max(4000),
  status: z.enum(['auto', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']),
  progress: z.number().min(0).max(100),
  plannedStart: isoDate.nullable(), plannedFinish: isoDate.nullable(),
  forecastStart: isoDate.nullable(), forecastFinish: isoDate.nullable(),
  actualStart: isoDate.nullable(), actualFinish: isoDate.nullable(),
}).partial();

const setValue = z.discriminatedUnion('field', [
  z.object({ field: z.enum(['name', 'owner', 'notes']), value: z.string().max(4000) }),
  z.object({ field: z.literal('status'), value: z.enum(['auto', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled']) }),
  z.object({ field: z.literal('progress'), value: z.number().min(0).max(100) }),
  z.object({
    field: z.enum(['plannedStart', 'plannedFinish', 'forecastStart', 'forecastFinish', 'actualStart', 'actualFinish']),
    value: isoDate.nullable(),
  }),
]);

/** One edit sent by the web app. A batch is applied atomically. */
export const opSchema = z.union([
  z.object({ op: z.literal('add'), id: uuid.optional(), parentId: uuid.nullable(), afterId: uuid.nullable().optional(), values: itemValues.optional() }),
  z.object({ op: z.literal('set'), id: uuid }).and(setValue),
  z.object({ op: z.literal('move'), id: uuid, parentId: uuid.nullable(), index: z.number().int().min(0) }),
  z.object({ op: z.literal('delete'), id: uuid }),
  z.object({ op: z.literal('link'), succ: uuid, pred: uuid, lag: lag.optional() }),
  z.object({ op: z.literal('unlink'), succ: uuid, pred: uuid }),
  z.object({ op: z.literal('setLag'), succ: uuid, pred: uuid, lag }),
  z.object({ op: z.literal('setDeps'), id: uuid, text: z.string().max(1000) }),
]);
export type Op = z.infer<typeof opSchema>;
export const opsBody = z.object({ ops: z.array(opSchema).min(1).max(500) });

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
        const id = op.id ?? randomUUID();
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
