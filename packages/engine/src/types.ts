import type { Day, IsoDate } from './dates.js';

/** Status a user can set on a leaf. 'auto' derives it from dates and progress. */
export type Status = 'auto' | 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type DerivedStatus = Exclude<Status, 'auto'>;
export type Health = 'green' | 'amber' | 'red' | 'done' | 'none';

/** Finish-to-start link: this item waits for `id`, plus `lag` working days (negative = lead). */
export interface Dependency {
  id: string;
  lag: number;
}

/** One node of the WBS tree as stored. Siblings are ordered by their position in the items array. */
export interface WbsItem {
  id: string;
  parentId: string | null;
  name: string;
  owner: string;
  status: Status;
  plannedStart: IsoDate | null;
  plannedFinish: IsoDate | null;
  forecastStart: IsoDate | null;
  forecastFinish: IsoDate | null;
  actualStart: IsoDate | null;
  actualFinish: IsoDate | null;
  /** 0–100. Ignored on parents, which roll up. */
  progress: number;
  notes: string;
  deps: Dependency[];
}

/** A saved plan: planned dates of every dated leaf at the time it was saved. */
export interface Baseline {
  id: string;
  name: string;
  setOn: IsoDate;
  reason: string;
  /** itemId → [planned start, planned finish] */
  items: Record<string, [IsoDate | null, IsoDate | null]>;
}

export interface ProjectSettings {
  /** Status date; null = today. */
  statusDate: IsoDate | null;
  /** Finish slip, in working days, that turns an item red. Minimum 1, default 10. */
  redThresholdDays: number;
  /** Move linked successors automatically when a predecessor slips. Default true. */
  autoSchedule: boolean;
  /** Baseline that variance is measured against; null = latest plan (the planned dates). */
  activeBaselineId: string | null;
}

export interface Project {
  id: string;
  name: string;
  items: WbsItem[];
  baselines: Baseline[];
  settings: ProjectSettings;
}

export interface DateRange {
  start: Day | null;
  finish: Day | null;
}

/**
 * Why an item has its health. Structured (not text) so the UI can translate it.
 * `days` = working days, `date` = day number, `progress`/`planned` = percent.
 */
export type HealthReason =
  | { code: 'cancelled' }
  | { code: 'finished_on_plan' }
  | { code: 'finished_late'; days: number }
  | { code: 'no_dates' }
  | { code: 'overdue'; date: Day | null }
  | { code: 'slip'; days: number }
  | { code: 'late_start'; date: Day }
  | { code: 'on_hold' }
  | { code: 'behind_plan'; progress: number; planned: number }
  | { code: 'children_need_attention' }
  | { code: 'on_plan' };

/** Calculated values for one item (leaf or parent). Never stored. */
export interface ItemInfo {
  id: string;
  /** WBS code such as "2.1.3". */
  code: string;
  level: number;
  childCount: number;
  planned: DateRange;
  forecast: DateRange;
  actual: DateRange;
  status: DerivedStatus;
  /** 0–100, rounded. */
  progress: number;
  /** Planned % complete at the status date, or null with no planned dates. */
  plannedPct: number | null;
  /** Finish variance in working days; positive = late. */
  variance: number | null;
  overdue: boolean;
  lateStart: boolean;
  health: Health;
  reason: HealthReason;
  milestone: boolean;
}

export interface ComputedProject {
  /** Status date used for the calculation. */
  statusDate: Day;
  items: Map<string, ItemInfo>;
  /** Roll-up of the whole project (the root). */
  project: Omit<ItemInfo, 'id' | 'code' | 'level' | 'childCount'>;
  /** Leaf ids on the critical path (empty when fewer than 2). */
  critical: Set<string>;
  /** True when the links contain a loop (should never happen; links are validated). */
  hasCycle: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  statusDate: null,
  redThresholdDays: 10,
  autoSchedule: true,
  activeBaselineId: null,
};
