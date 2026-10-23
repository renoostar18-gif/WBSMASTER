import { type Day, type IsoDate, clamp, toDay, toIso } from './dates.js';
import type { Status, WbsItem } from './types.js';

export type EditableField =
  | 'name' | 'owner' | 'notes' | 'status' | 'progress'
  | 'plannedStart' | 'plannedFinish' | 'forecastStart' | 'forecastFinish' | 'actualStart' | 'actualFinish';

const PAIRS: Partial<Record<EditableField, [keyof WbsItem, keyof WbsItem]>> = {
  plannedStart: ['plannedStart', 'plannedFinish'], plannedFinish: ['plannedStart', 'plannedFinish'],
  forecastStart: ['forecastStart', 'forecastFinish'], forecastFinish: ['forecastStart', 'forecastFinish'],
  actualStart: ['actualStart', 'actualFinish'], actualFinish: ['actualStart', 'actualFinish'],
};

type DateKey = 'plannedStart' | 'plannedFinish' | 'forecastStart' | 'forecastFinish' | 'actualStart' | 'actualFinish';

/**
 * Apply one user edit to a leaf, with the side effects in spec 4.2 and 4.3.
 * Returns a new item; the input is not changed. `statusDate` is the project's
 * status date (or today).
 */
export function applyEdit(item: WbsItem, field: EditableField, value: string | number | null, statusDate: Day): WbsItem {
  const n: WbsItem = { ...item, deps: item.deps.map(d => ({ ...d })) };
  const today = toIso(statusDate)!;

  if (field === 'progress') n.progress = clamp(Math.round(Number(value) || 0), 0, 100);
  else if (field === 'status') n.status = (value as Status) || 'auto';
  else if (field === 'name' || field === 'owner' || field === 'notes') n[field] = String(value ?? '').trim();
  else n[field] = value ? String(value) : null;

  const v = n[field as keyof WbsItem];
  const pr = PAIRS[field];
  if (pr && v) {
    const [a, b] = pr as [DateKey, DateKey];
    if (n[a] && n[b] && n[b]! < n[a]!) {
      if (field === a) n[b] = n[a]; else n[a] = n[b];
    }
  }
  // the first plan becomes the baseline, and a baseline fills an empty forecast
  if (field === 'forecastStart' && v && !n.plannedStart) n.plannedStart = n.forecastStart;
  if (field === 'forecastFinish' && v && !n.plannedFinish) n.plannedFinish = n.forecastFinish;
  if ((field === 'plannedStart' || field === 'plannedFinish') && v) {
    if (!n.forecastStart && !n.forecastFinish) {
      n.forecastStart = n.plannedStart;
      n.forecastFinish = n.plannedFinish;
    } else if (field === 'plannedFinish' && !n.forecastFinish && n.forecastStart === n.plannedStart) {
      // the forecast is still mirroring the plan: fill its missing finish too (the prototype left a one-day forecast)
      n.forecastFinish = n.plannedFinish;
    } else if (field === 'plannedStart' && !n.forecastStart && n.forecastFinish === n.plannedFinish) {
      n.forecastStart = n.plannedStart;
    }
  }
  if (field === 'actualFinish' && v) {
    n.progress = 100;
    if (n.status !== 'auto' && n.status !== 'completed') n.status = 'auto';
    if (!n.actualStart) n.actualStart = n.forecastStart && n.forecastStart <= (v as IsoDate) ? n.forecastStart : (v as IsoDate);
  }
  if (field === 'actualStart' && v && !n.forecastStart) n.forecastStart = v as IsoDate;
  if (field === 'status' && v === 'completed' && !n.actualFinish) {
    n.actualFinish = today;
    n.progress = 100;
    if (!n.actualStart) n.actualStart = n.forecastStart || n.actualFinish;
  }
  if (field === 'progress' && n.progress > 0 && !n.actualStart && n.status === 'auto') {
    const fs = toDay(n.forecastStart);
    n.actualStart = fs != null && fs <= statusDate ? n.forecastStart : today;
  }
  return n;
}

let counter = 0;
/** Short unique id for new items. The server may replace it with a UUID. */
export function newId(prefix = 'i'): string {
  counter = (counter + 1) % 1e6;
  return prefix + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function blankItem(parentId: string | null, extra: Partial<WbsItem> = {}): WbsItem {
  return {
    id: newId(), parentId, name: 'New item', owner: '', status: 'auto',
    plannedStart: null, plannedFinish: null, forecastStart: null, forecastFinish: null,
    actualStart: null, actualFinish: null, progress: 0, notes: '', deps: [], ...extra,
  };
}
