import { saudiHolidays } from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import { tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { orgAccess } from '../permissions.js';
import { PLANS } from '../plans.js';
import { recalcProjectsUsingCalendar } from './projects.js';

const weekDays = z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(a => [...new Set(a)].sort());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const exception = z.object({
  date: isoDate, name: z.string().trim().max(120).default(''), working: z.boolean(), estimated: z.boolean().default(false),
});

export const calendarRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  /** A calendar edit changes shading and possibly dates in every project of the organisation: tell open pages. */
  async function announceOrg(orgId: string, user: { id: string; name: string }) {
    const r = await deps.db.query<{ id: string; version: number }>(
      'update projects set version = version + 1 where org_id = $1 and archived_at is null returning id, version', [orgId]);
    for (const p of r.rows) deps.live?.changed(p.id, p.version, user);
  }

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/calendars', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId);
    const cals = await deps.db.query(
      'select id, name, week_days as "weekDays", is_default as "isDefault" from calendars where org_id = $1 order by is_default desc, name',
      [req.params.orgId]);
    const ex = await deps.db.query(
      `select e.id, e.calendar_id as "calendarId", e.date, e.name, e.is_working as working, e.estimated
         from calendar_exceptions e join calendars c on c.id = e.calendar_id where c.org_id = $1 order by e.date`,
      [req.params.orgId]);
    return { calendars: cals.rows.map(c => ({ ...c, exceptions: ex.rows.filter(e => e.calendarId === c.id) })) };
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/calendars', async (req, reply) => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, 'admin');
    if (!PLANS[acc.plan].multipleCalendars) throw forbidden('plan_single_calendar');
    const body = parse(z.object({ name: z.string().trim().min(1).max(120), weekDays }), req.body);
    const r = await deps.db.query<{ id: string }>(
      'insert into calendars (org_id, name, week_days) values ($1, $2, $3) returning id', [req.params.orgId, body.name, body.weekDays]);
    return reply.status(201).send({ id: r.rows[0]!.id });
  });

  app.patch<{ Params: { orgId: string; calendarId: string } }>('/orgs/:orgId/calendars/:calendarId', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const body = parse(z.object({ name: z.string().trim().min(1).max(120), weekDays, isDefault: z.literal(true) }).partial(), req.body);
    const moved = await tx(deps.db, async c => {
      const cur = await c.query('select 1 from calendars where id = $1 and org_id = $2 for update', [req.params.calendarId, req.params.orgId]);
      if (!cur.rowCount) throw notFound('calendar_not_found');
      if (body.isDefault) await c.query('update calendars set is_default = false where org_id = $1 and id <> $2', [req.params.orgId, req.params.calendarId]);
      await c.query(
        `update calendars set name = coalesce($2, name), week_days = coalesce($3, week_days),
           is_default = coalesce($4, is_default), updated_at = now() where id = $1`,
        [req.params.calendarId, body.name ?? null, body.weekDays ?? null, body.isDefault ?? null]);
      return body.weekDays || body.isDefault ? recalcProjectsUsingCalendar(c, req.params.orgId, user.id) : 0;
    });
    if (body.weekDays || body.isDefault) await announceOrg(req.params.orgId, user);
    return { ok: true, itemsMoved: moved };
  });

  /** Add or replace exceptions (holidays, extra working days). `saudiYear` adds that year's Saudi holidays. */
  app.post<{ Params: { orgId: string; calendarId: string } }>('/orgs/:orgId/calendars/:calendarId/exceptions', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const body = parse(z.object({
      exceptions: z.array(exception).max(400).default([]),
      saudiYear: z.number().int().min(2000).max(2100).optional(),
    }), req.body);
    const rows = [...body.exceptions, ...(body.saudiYear ? saudiHolidays(body.saudiYear) : [])];
    if (!rows.length) throw badRequest('nothing_to_add');
    const moved = await tx(deps.db, async c => {
      const cur = await c.query('select 1 from calendars where id = $1 and org_id = $2', [req.params.calendarId, req.params.orgId]);
      if (!cur.rowCount) throw notFound('calendar_not_found');
      await c.query(
        `insert into calendar_exceptions (calendar_id, date, name, is_working, estimated)
         select $1, x.date, coalesce(x.name, ''), x.working, coalesce(x.estimated, false)
           from jsonb_to_recordset($2::jsonb) as x(date date, name text, working boolean, estimated boolean)
         on conflict (calendar_id, date) where calendar_id is not null
         do update set name = excluded.name, is_working = excluded.is_working, estimated = excluded.estimated`,
        [req.params.calendarId, JSON.stringify(rows)]);
      return recalcProjectsUsingCalendar(c, req.params.orgId, user.id);
    });
    await announceOrg(req.params.orgId, user);
    return { ok: true, added: rows.length, itemsMoved: moved };
  });

  app.delete<{ Params: { orgId: string; calendarId: string; date: string } }>('/orgs/:orgId/calendars/:calendarId/exceptions/:date', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const moved = await tx(deps.db, async c => {
      const r = await c.query(
        `delete from calendar_exceptions e using calendars c
          where e.calendar_id = c.id and c.id = $1 and c.org_id = $2 and e.date = $3`,
        [req.params.calendarId, req.params.orgId, req.params.date]);
      if (!r.rowCount) throw notFound('exception_not_found');
      return recalcProjectsUsingCalendar(c, req.params.orgId, user.id);
    });
    await announceOrg(req.params.orgId, user);
    return { ok: true, itemsMoved: moved };
  });
};
