import { describe, expect, it } from 'vitest';
import { ALL_DAYS, WorkCalendar } from '../src/calendar.js';
import { computeProject } from '../src/compute.js';
import { autoSchedule } from '../src/schedule.js';
import { STATUS_TO_PROTO, toProto } from './helpers.js';
import { TODAY, randomProject } from './random.js';
import { protoCompute, protoSchedule } from './reference/prototype.js';

describe('engine matches the WBS Builder prototype when every day is a working day', () => {
  const cal = new WorkCalendar(ALL_DAYS);

  it('computes identical status, progress, health, variance, roll-ups and critical path (3,000 random projects)', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const p = randomProject(seed);
      const ours = computeProject(p, { calendar: cal, today: TODAY });
      const ref = protoCompute(toProto(p), TODAY);
      for (const it of p.items) {
        const a = ours.items.get(it.id)!, b = ref.info.get(it.id);
        const ctx = `seed ${seed}, item ${it.id}`;
        expect(a, ctx).toBeDefined();
        expect([a.code, a.level, a.childCount], ctx).toEqual([b.code, b.level, b.kids]);
        expect(STATUS_TO_PROTO[a.status], ctx).toBe(b.st);
        expect(a.progress, ctx).toBe(Math.round(b.p));
        expect(a.plannedPct, ctx).toBe(b.pp);
        expect(a.variance, ctx).toBe(b.vr);
        expect(a.health, ctx).toBe(b.h);
        expect(a.overdue, ctx).toBe(b.late);
        expect(a.milestone, ctx).toBe(b.ms);
        expect([a.planned.start, a.planned.finish, a.forecast.start, a.forecast.finish, a.actual.start, a.actual.finish], ctx)
          .toEqual([b.b.s, b.b.e, b.f.s, b.f.e, b.a.s, b.a.e]);
      }
      const ctx = `seed ${seed}, project`;
      expect([ours.project.health, ours.project.progress, ours.project.plannedPct, ours.project.variance], ctx)
        .toEqual([ref.proj.h, ref.proj.p, ref.proj.pp, ref.proj.vr]);
      expect([...ours.critical].sort(), ctx).toEqual([...ref.crit].sort());
    }
  });

  it('auto-schedules dated items to the same dates (2,000 random projects)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const p = randomProject(seed + 50_000, true);
      const ours = autoSchedule(p, cal);
      const proto = toProto(p);
      const moved = protoSchedule(proto);
      expect(ours.moved.length, `seed ${seed}`).toBe(moved);
      for (const n of proto.nodes) {
        const o = ours.items.find(i => i.id === n.id)!;
        expect([o.forecastStart ?? '', o.forecastFinish ?? ''], `seed ${seed}, ${n.id}`).toEqual([n.start, n.end]);
      }
    }
  });
});
