import { z } from 'zod';
import { toDay } from '@wbs-master/engine';

export { OpError, applyOps, type Op } from '@wbs-master/engine';

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
  z.object({ op: z.literal('put'), id: uuid, values: itemValues }),
  z.object({ op: z.literal('link'), succ: uuid, pred: uuid, lag: lag.optional() }),
  z.object({ op: z.literal('unlink'), succ: uuid, pred: uuid }),
  z.object({ op: z.literal('setLag'), succ: uuid, pred: uuid, lag }),
  z.object({ op: z.literal('setDeps'), id: uuid, text: z.string().max(1000) }),
]);
export const opsBody = z.object({ ops: z.array(opSchema).min(1).max(500) });
