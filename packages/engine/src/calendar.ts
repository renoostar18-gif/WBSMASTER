import { type Day, type IsoDate, toDay, weekday } from './dates.js';

export interface CalendarException {
  date: IsoDate;
  /** true = an extra working day (e.g. a working Saturday); false = a holiday or shutdown. */
  working: boolean;
  name?: string;
  /** Set for dates that follow the moon sighting and must be confirmed (Eid). */
  estimated?: boolean;
}

export interface CalendarDefinition {
  /** Working days of the week, 0 = Sunday … 6 = Saturday. */
  weekDays: number[];
  exceptions?: CalendarException[];
}

/** Saudi working week: Sunday–Thursday, Friday–Saturday weekend. */
export const SAUDI_WEEK: CalendarDefinition = { weekDays: [0, 1, 2, 3, 4] };
/** Every day is a working day. Matches the WBS Builder prototype's calendar-day arithmetic. */
export const ALL_DAYS: CalendarDefinition = { weekDays: [0, 1, 2, 3, 4, 5, 6] };

/**
 * A working-day calendar. Durations, lags, variance and the red threshold are
 * counted in working days using one of these (spec 4.10).
 */
export class WorkCalendar {
  private readonly week: boolean[];
  private readonly perWeek: number;
  private readonly overrides = new Map<Day, boolean>();
  /** Overrides that differ from the weekly pattern, sorted, for fast range counts. */
  private readonly deltas: { day: Day; delta: 1 | -1 }[] = [];

  constructor(def: CalendarDefinition = SAUDI_WEEK) {
    this.week = Array.from({ length: 7 }, (_, i) => def.weekDays.includes(i));
    this.perWeek = this.week.filter(Boolean).length;
    if (!this.perWeek) throw new Error('A calendar needs at least one working day in the week.');
    for (const ex of def.exceptions ?? []) {
      const d = toDay(ex.date);
      if (d == null) continue;
      this.overrides.set(d, ex.working);
    }
    for (const [day, working] of this.overrides) {
      const base = this.week[weekday(day)]!;
      if (working !== base) this.deltas.push({ day, delta: working ? 1 : -1 });
    }
    this.deltas.sort((a, b) => a.day - b.day);
  }

  isWorking(day: Day): boolean {
    const o = this.overrides.get(day);
    return o !== undefined ? o : this.week[weekday(day)]!;
  }

  /** The first working day on or after `day`. */
  onOrAfter(day: Day): Day {
    let d = day;
    while (!this.isWorking(d)) d++;
    return d;
  }

  /** The last working day on or before `day`. */
  onOrBefore(day: Day): Day {
    let d = day;
    while (!this.isWorking(d)) d--;
    return d;
  }

  /**
   * Move `n` working days from `day`. n > 0 counts working days strictly after
   * `day`; n < 0 strictly before; n = 0 returns `day` unchanged.
   */
  add(day: Day, n: number): Day {
    let d = day;
    let left = Math.abs(Math.trunc(n));
    const step = n > 0 ? 1 : -1;
    while (left > 0) {
      d += step;
      if (this.isWorking(d)) left--;
    }
    return d;
  }

  /** Number of working days in [from, to], inclusive. 0 when to < from. */
  count(from: Day, to: Day): number {
    if (to < from) return 0;
    const span = to - from + 1;
    const weeks = Math.floor(span / 7);
    let n = weeks * this.perWeek;
    for (let d = from + weeks * 7; d <= to; d++) if (this.week[weekday(d)]) n++;
    for (const x of this.deltas) {
      if (x.day > to) break;
      if (x.day >= from) n += x.delta;
    }
    return n;
  }

  /**
   * Signed working-day difference used for finish variance: working days in
   * (from, to] when to is later, minus working days in (to, from] when earlier.
   */
  diff(from: Day, to: Day): number {
    if (to === from) return 0;
    return to > from ? this.count(from + 1, to) : -this.count(to + 1, from);
  }
}
