import { blankItem } from '../src/edits.js';
import { DEFAULT_SETTINGS, type Project, type Status, type WbsItem } from '../src/types.js';
import type { ProtoNode, ProtoProject } from './reference/prototype.js';

/** Small deterministic PRNG (mulberry32) so failures can be reproduced from the seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
  };
}

export const STATUS_TO_PROTO: Record<Status, string> = {
  auto: 'auto', not_started: 'ns', in_progress: 'wip', on_hold: 'hold', completed: 'done', cancelled: 'cx',
};

export function toProto(p: Project): ProtoProject {
  const nodes: ProtoNode[] = p.items.map(i => ({
    id: i.id, parent: i.parentId, name: i.name, owner: i.owner, status: STATUS_TO_PROTO[i.status],
    bStart: i.plannedStart ?? '', bEnd: i.plannedFinish ?? '', start: i.forecastStart ?? '', end: i.forecastFinish ?? '',
    aStart: i.actualStart ?? '', aEnd: i.actualFinish ?? '', progress: i.progress, notes: i.notes,
    deps: i.deps.map(d => ({ ...d })),
  }));
  const day = (s: string | null) => (s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5 : null);
  return {
    nodes,
    baselines: p.baselines.map(b => ({ id: b.id, d: Object.entries(b.items).map(([id, [s, f]]) => [id, day(s), day(f)] as [string, number | null, number | null]) })),
    settings: {
      redDays: p.settings.redThresholdDays,
      asOf: p.settings.statusDate ?? '',
      autoSched: p.settings.autoSchedule,
      activeBase: p.settings.activeBaselineId ?? '',
    },
  };
}

export function iso(day: number): string {
  return new Date(day * 864e5).toISOString().slice(0, 10);
}

export function project(items: WbsItem[], settings: Partial<Project['settings']> = {}): Project {
  return { id: 'p1', name: 'Test', items, baselines: [], settings: { ...DEFAULT_SETTINGS, ...settings } };
}

export function item(id: string, parentId: string | null, extra: Partial<WbsItem> = {}): WbsItem {
  return blankItem(parentId, { id, name: id, ...extra });
}
