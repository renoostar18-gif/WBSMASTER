import { describe, expect, it } from 'vitest';
import { ALL_DAYS, SAUDI_WEEK, WorkCalendar } from '../src/calendar.js';
import { toDay, toIso, weekday } from '../src/dates.js';
import { hijriOf, saudiHolidays } from '../src/holidays.js';

const d = (s: string) => toDay(s)!;

describe('dates', () => {
  it('round-trips ISO dates and rejects impossible ones', () => {
    expect(toIso(d('2026-10-23'))).toBe('2026-10-23');
    expect(toDay('2026-02-31')).toBeNull();
    expect(toDay('23/10/2026')).toBeNull();
    expect(toDay(null)).toBeNull();
  });
  it('knows the weekday', () => {
    expect(weekday(d('2026-10-23'))).toBe(5); // Friday
    expect(weekday(d('2026-10-25'))).toBe(0); // Sunday
  });
});

describe('Saudi working week (Sunday–Thursday)', () => {
  const cal = new WorkCalendar(SAUDI_WEEK);

  it('treats Friday and Saturday as non-working', () => {
    expect(cal.isWorking(d('2026-10-22'))).toBe(true); // Thu
    expect(cal.isWorking(d('2026-10-23'))).toBe(false); // Fri
    expect(cal.isWorking(d('2026-10-24'))).toBe(false); // Sat
    expect(cal.isWorking(d('2026-10-25'))).toBe(true); // Sun
  });

  it('adds working days over the weekend', () => {
    expect(toIso(cal.add(d('2026-10-22'), 1))).toBe('2026-10-25'); // Thu + 1 = Sun
    expect(toIso(cal.add(d('2026-10-25'), -1))).toBe('2026-10-22'); // Sun − 1 = Thu
    expect(toIso(cal.add(d('2026-10-23'), 0))).toBe('2026-10-23');
    expect(toIso(cal.onOrAfter(d('2026-10-23')))).toBe('2026-10-25');
    expect(toIso(cal.onOrBefore(d('2026-10-24')))).toBe('2026-10-22');
  });

  it('counts working days inclusively, matching a day-by-day count over long ranges', () => {
    expect(cal.count(d('2026-10-18'), d('2026-10-24'))).toBe(5);
    expect(cal.count(d('2026-10-23'), d('2026-10-24'))).toBe(0);
    expect(cal.count(d('2026-10-24'), d('2026-10-18'))).toBe(0);
    const from = d('2026-01-01');
    for (let span = 0; span < 400; span += 7) {
      let n = 0;
      for (let x = from; x <= from + span; x++) if (cal.isWorking(x)) n++;
      expect(cal.count(from, from + span)).toBe(n);
    }
  });

  it('gives a signed working-day difference for variance', () => {
    expect(cal.diff(d('2026-10-22'), d('2026-10-25'))).toBe(1); // Thu → Sun: 1 working day late
    expect(cal.diff(d('2026-10-25'), d('2026-10-22'))).toBe(-1);
    expect(cal.diff(d('2026-10-22'), d('2026-10-24'))).toBe(0); // slipping into the weekend costs nothing
  });

  it('applies exceptions: holidays and extra working days', () => {
    const c = new WorkCalendar({
      weekDays: [0, 1, 2, 3, 4],
      exceptions: [
        { date: '2026-09-23', working: false, name: 'National Day' }, // Wed
        { date: '2026-09-26', working: true, name: 'Working Saturday' },
      ],
    });
    expect(c.isWorking(d('2026-09-23'))).toBe(false);
    expect(c.isWorking(d('2026-09-26'))).toBe(true);
    expect(c.count(d('2026-09-20'), d('2026-09-26'))).toBe(5); // 5 − holiday + Saturday
    expect(toIso(c.add(d('2026-09-22'), 1))).toBe('2026-09-24');
  });

  it('refuses a calendar with no working days', () => {
    expect(() => new WorkCalendar({ weekDays: [] })).toThrow();
  });

  it('behaves like plain day arithmetic when every day works', () => {
    const all = new WorkCalendar(ALL_DAYS);
    expect(all.add(100, 7)).toBe(107);
    expect(all.count(100, 106)).toBe(7);
    expect(all.diff(100, 90)).toBe(-10);
  });
});

describe('Saudi holidays', () => {
  it('reads the Umm al-Qura calendar', () => {
    expect(hijriOf(d('2026-03-20'))).toEqual({ month: 10, day: 1 }); // 1 Shawwal 1447
  });

  it('lists fixed and estimated holidays for 2026', () => {
    const h = saudiHolidays(2026);
    expect(h.find(x => x.name === 'Founding Day')?.date).toBe('2026-02-22');
    expect(h.find(x => x.name === 'National Day')?.date).toBe('2026-09-23');
    const fitr = h.filter(x => x.name === 'Eid al-Fitr');
    expect(fitr.map(x => x.date)).toEqual(['2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23']);
    expect(fitr.every(x => x.estimated)).toBe(true);
    const adha = h.filter(x => x.name === 'Arafat Day' || x.name === 'Eid al-Adha');
    expect(adha).toHaveLength(4);
    expect(adha[0]!.name).toBe('Arafat Day');
  });
});
