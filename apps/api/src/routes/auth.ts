import { saudiHolidays, todayDay, toIso } from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, SESSION_COOKIE, parse, requireUser, setSessionCookie } from '../app.js';
import { createSession, deleteSession, hashPassword, verifyPassword } from '../auth.js';
import { type Tx, tx } from '../db.js';
import { ApiError } from '../errors.js';
import { RateLimiter } from '../ratelimit.js';
import { requireSsoFor } from './sso.js';
import { acceptInvitation } from '../invites.js';
import { audit } from '../audit.js';
import { consumeToken, issueToken, markVerified, sendTokenEmail } from '../emailtokens.js';

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

/** Checked against when the email is unknown, so a wrong email takes as long as a wrong password. */
const NO_USER_HASH = hashPassword('no such user, no such password');

export const authRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const now = () => deps.today?.() ?? new Date();
  // guessing one account's password from many addresses: a pause after too many wrong ones
  const failures = new RateLimiter(deps.config.loginFailureLimit, 15 * 60_000);
  // emails sent on request (confirmation again, password reset): a few per address or account each 15 minutes
  const mailLimit = new RateLimiter(3, 15 * 60_000);
  const link = (kind: 'verify' | 'reset', token: string) => `${deps.config.appUrl}/${kind}/${token}`;

  app.post('/auth/signup', async (req, reply) => {
    const body = parse(z.object({
      email, password,
      name: z.string().trim().min(1).max(120),
      organisation: z.string().trim().min(1).max(200).optional(),
      locale: z.enum(['en', 'ar']).optional(),
      /** The token from an invitation link: join that organisation instead of creating one. */
      invite: z.string().max(100).optional(),
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
      const who = { actor: { id: userId, name: body.name }, ip: req.ip };
      let orgId: string;
      // an invitation link proves the address (acceptInvitation marks it confirmed)
      if (body.invite) orgId = await acceptInvitation(c, body.invite, { id: userId, email: body.email }, who);
      else {
        orgId = await createOrganisation(c, body.organisation ?? `${body.name}'s workspace`, userId, now());
        await audit(c, orgId, who, 'org.created', body.organisation ?? `${body.name}'s workspace`);
      }
      const token = await createSession(c, userId, deps.config.sessionDays);
      const verify = body.invite ? null : await issueToken(c, userId, 'verify');
      return { userId, orgId, token, verify };
    });
    // anyone else confirms the address by the emailed link; until then they can work, but are invited, not added
    if (out.verify) await sendTokenEmail(deps.mailer, 'verify', { email: body.email, name: body.name, locale: body.locale ?? 'en' }, link('verify', out.verify));
    setSessionCookie(reply, out.token, deps);
    return reply.status(201).send({ user: { id: out.userId, email: body.email, name: body.name }, orgId: out.orgId });
  });

  app.post('/auth/login', async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().max(200) }), req.body);
    await requireSsoFor(deps.db, body.email);
    const r = await deps.db.query<{ id: string; password_hash: string | null; name: string }>(
      'select id, password_hash, name from users where lower(email) = $1', [body.email]);
    const u = r.rows[0];
    const key = `email:${body.email}`;
    const wait = failures.over(key);
    if (wait) { reply.header('retry-after', wait); throw new ApiError(429, 'rate_limited'); }
    // same answer, and about the same time, for an unknown email and a wrong password
    const ok = await verifyPassword(body.password, u?.password_hash ?? await NO_USER_HASH);
    if (!u || !u.password_hash || !ok) {
      failures.hit(key);
      throw new ApiError(401, 'invalid_credentials');
    }
    setSessionCookie(reply, await createSession(deps.db, u.id, deps.config.sessionDays), deps);
    return { user: { id: u.id, email: body.email, name: u.name } };
  });

  /** The link in the confirmation email. Works without being signed in. */
  app.post('/auth/verify', async req => {
    const { token } = parse(z.object({ token: z.string().max(100) }), req.body);
    const userId = await consumeToken(deps.db, token, 'verify');
    if (!userId) throw new ApiError(410, 'link_invalid');
    await markVerified(deps.db, userId);
    return { ok: true };
  });

  app.post('/auth/verify/resend', async req => {
    const user = requireUser(req);
    if (user.apiKey) throw new ApiError(403, 'not_with_api_key');
    if (user.emailVerified) return { ok: true, alreadyVerified: true };
    if (!mailLimit.hit(`verify:${user.id}`).ok) throw new ApiError(429, 'rate_limited');
    await sendTokenEmail(deps.mailer, 'verify', user, link('verify', await issueToken(deps.db, user.id, 'verify')));
    return { ok: true };
  });

  /** Forgotten password: the same answer whether or not the email has an account, so accounts cannot be discovered. */
  app.post('/auth/password/forgot', async req => {
    const body = parse(z.object({ email }), req.body);
    const u = (await deps.db.query<{ id: string; email: string; name: string; locale: string }>(
      'select id, email, name, locale from users where lower(email) = $1', [body.email])).rows[0];
    // people whose organisation requires SSO sign in with their company account, not a password
    const sso = await requireSsoFor(deps.db, body.email).then(() => false, () => true);
    if (u && !sso && mailLimit.hit(`reset:${body.email}`).ok) {
      await sendTokenEmail(deps.mailer, 'reset', u, link('reset', await issueToken(deps.db, u.id, 'reset')));
    }
    return { ok: true };
  });

  /** The link in the reset email: a new password, every other session signed out, and this browser signed in. */
  app.post('/auth/password/reset', async (req, reply) => {
    const body = parse(z.object({ token: z.string().max(100), password }), req.body);
    const out = await tx(deps.db, async c => {
      const userId = await consumeToken(c, body.token, 'reset');
      if (!userId) throw new ApiError(410, 'link_invalid');
      const u = (await c.query<{ id: string; email: string; name: string }>(
        'update users set password_hash = $2, updated_at = now() where id = $1 returning id, email, name', [userId, await hashPassword(body.password)])).rows[0]!;
      await markVerified(c, userId);
      await c.query('delete from sessions where user_id = $1', [userId]);
      return { u, token: await createSession(c, userId, deps.config.sessionDays) };
    });
    failures.clear(`email:${out.u.email.toLowerCase()}`);
    setSessionCookie(reply, out.token, deps);
    return { user: out.u };
  });

  app.post('/auth/logout', async (req, reply) => {
    await deleteSession(deps.db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async req => {
    const user = requireUser(req);
    // an API key only sees its own organisation; one waiting to be deleted is shown only to its owners
    // (with the date, to cancel it), and never to keys
    const orgs = await deps.db.query(
      `select o.id, o.name, o.plan, m.role, o.delete_on as "deleteOn" from memberships m join organisations o on o.id = m.org_id
        where m.user_id = $1 and ($2::uuid is null or o.id = $2) and (o.delete_on is null or (m.role = 'owner' and $3))
        order by o.created_at`, [user.id, user.apiKey?.orgId ?? null, !user.apiKey]);
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
