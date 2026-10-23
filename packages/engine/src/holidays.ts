import type { CalendarException } from './calendar.js';
import { type Day, dayFromParts, toIso } from './dates.js';

const hijri = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
  day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
});

/** Hijri (Umm al-Qura) month and day for a Gregorian day number. */
export function hijriOf(day: Day): { month: number; day: number } {
  const parts = hijri.formatToParts(new Date(day * 86_400_000));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { month: get('month'), day: get('day') };
}

/**
 * Saudi public holidays for a Gregorian year, as calendar exceptions.
 * Founding Day (22 Feb) and National Day (23 Sep) are fixed. Eid al-Fitr
 * (1–4 Shawwal) and Eid al-Adha (Arafat day 9 Dhu al-Hijjah to 12 Dhu al-Hijjah)
 * come from the Umm al-Qura calendar and are marked estimated: the official
 * dates follow the moon sighting and the yearly announcement, so an admin
 * should confirm them.
 */
export function saudiHolidays(year: number): CalendarException[] {
  const out: CalendarException[] = [
    { date: toIso(dayFromParts(year, 2, 22))!, working: false, name: 'Founding Day' },
    { date: toIso(dayFromParts(year, 9, 23))!, working: false, name: 'National Day' },
  ];
  const start = dayFromParts(year, 1, 1), end = dayFromParts(year, 12, 31);
  for (let d = start; d <= end; d++) {
    const h = hijriOf(d);
    if (h.month === 10 && h.day >= 1 && h.day <= 4) out.push({ date: toIso(d)!, working: false, name: 'Eid al-Fitr', estimated: true });
    if (h.month === 12 && h.day >= 9 && h.day <= 12) out.push({ date: toIso(d)!, working: false, name: h.day === 9 ? 'Arafat Day' : 'Eid al-Adha', estimated: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
