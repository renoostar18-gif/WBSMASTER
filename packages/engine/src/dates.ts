/**
 * Dates are whole days. Inside the engine a date is a day number: days since
 * 1970-01-01 (UTC). Outside the engine (storage, API, UI) a date is an ISO
 * string "YYYY-MM-DD". No times, no time zones.
 */
export type Day = number;
export type IsoDate = string;

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO "YYYY-MM-DD" to a day number; null for empty or malformed input. */
export function toDay(iso: IsoDate | null | undefined): Day | null {
  if (!iso) return null;
  const m = ISO.exec(iso);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // reject 2026-02-31 and similar
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / DAY_MS;
}

/** Day number to ISO "YYYY-MM-DD"; null stays null. */
export function toIso(day: Day | null | undefined): IsoDate | null {
  if (day == null) return null;
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Day of the week, 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** Today's date in UTC as a day number. */
export function todayDay(now: Date = new Date()): Day {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS;
}

export function dayFromParts(year: number, month: number, date: number): Day {
  return Date.UTC(year, month - 1, date) / DAY_MS;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
