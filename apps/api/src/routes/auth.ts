import { saudiHolidays, todayDay, toIso } from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, SESSION_COOKIE, parse, requireUser, setSessionCookie } from '../app.js';
import { createSession, deleteSession, hashPassword, verifyPassword } from '../auth.js';
import { type Tx, tx } from '../db.js';
import { ApiError } from '../errors.js';
import { requireSsoFor } from './sso.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, 'password_too_short').max(200);

/** A new organisation gets a default Saudi calendar with this year's and next year's holidays (spec 4.10). */
export async function createOrganisation(c: Tx, name: string, ownerId: string, today: Date): Promise<string> {
  const org = await c.query<{ id: string }>('insert into organisations (name) values ($1) returning id', [name]);
  const orgId = org.rows[0]!.id;
  await c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [orgId, ownerId]);
  const cal = await c.query<{ id: string }>(
    "insert into calendars (org_id, name, week_days, is_default) values ($1, 'Standard (Sun–Thu)', '{0,1,2,3,4}', true) returning id",
    [orgId],
  );
  const year = Number(toIso(todayDay(today))!.slice(0, 4));
  const holidays = [...saudiHolidays(year), ...saudiHolidays(year + 1)];
  await c.query(
    `insert into calendar_exceptions (calendar_id, date, name, is_working, estimated)
     select $1, x.date, x.name, x.working, coalesce(x.estimated, false)
       from jsonb_to_recordset($2::jsonb) as x(date date, name text, working boolean, estimated boolean)`,
    [cal.rows[0]!.id, JSON.stringify(holidays)],
  );
  return orgId;
}

export const authRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const now = () => deps.today?.() ?? new Date();

  app.post('/auth/signup', async (req, reply) => {
    const body = parse(z.object({
      email, password,
      name: z.string().trim().min(1).max(120),
      organisation: z.string().trim().min(1).max(200).optional(),
      locale: z.enum(['en', 'ar']).optional(),
    }), req.body);
    await requireSsoFor(deps.db, body.email);
    const out = await tx(deps.db, async c => {
      const exists = await c.query('select 1 from users where lower(email) = $1', [body.email]);
      if (exists.rowCount) throw new ApiError(409, 'email_taken');
      const u = await c.query<{ id: string }>(
        'insert into users (email, name, password_hash, locale) values ($1, $2, $3, $4) returning id',
        [body.email, body.name, await hashPassword(body.password), body.locale ?? 'en'],
      );
      const userId = u.rows[0]!.id;
      const orgId = await createOrganisation(c, body.organisation ?? `${body.name}'s workspace`, userId, now());
      const token = await createSession(c, userId, deps.config.sessionDays);
      return { userId, orgId, token };
    });
    setSessionCookie(reply, out.token, deps);
    return reply.status(201).send({ user: { id: out.userId, email: body.email, name: body.name }, orgId: out.orgId });
  });

  app.post('/auth/login', async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().max(200) }), req.body);
    await requireSsoFor(deps.db, body.email);
    const r = await deps.db.query<{ id: string; password_hash: string | null; name: string }>(
      'select id, password_hash, name from users where lower(email) = $1', [body.email]);
    const u = r.rows[0];
    // same answer for unknown email and wrong password
    if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new ApiError(401, 'invalid_credentials');
    setSessionCookie(reply, await createSession(deps.db, u.id, deps.config.sessionDays), deps);
    return { user: { id: u.id, email: body.email, name: u.name } };
  });

  app.post('/auth/logout', async (req, reply) => {
    await deleteSession(deps.db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async req => {
    const user = requireUser(req);
    const orgs = await deps.db.query(
      `select o.id, o.name, o.plan, m.role from memberships m join organisations o on o.id = m.org_id
        where m.user_id = $1 order by o.created_at`, [user.id]);
    return { user, organisations: orgs.rows };
  });

  app.patch('/me', async req => {
    const user = requireUser(req);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120), locale: z.enum(['en', 'ar']), theme: z.enum(['auto', 'light', 'dark']),
      notifyEmail: z.enum(['instant', 'daily', 'off']),
    }).partial(), req.body);
    const r = await deps.db.query(
      `update users set name = coalesce($2, name), locale = coalesce($3, locale), theme = coalesce($4, theme),
              notify_email = coalesce($5, notify_email), updated_at = now()
        where id = $1 returning id, email, name, locale, theme, notify_email as "notifyEmail"`,
      [user.id, body.name ?? null, body.locale ?? null, body.theme ?? null, body.notifyEmail ?? null]);
    return { user: r.rows[0] };
  });
};
