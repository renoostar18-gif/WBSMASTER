import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import { tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { orgAccess } from '../permissions.js';
import { PLANS } from '../plans.js';
import { createOrganisation } from './auth.js';

const orgRole = z.enum(['owner', 'admin', 'member', 'guest']);

export const orgRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  app.post('/orgs', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(200) }), req.body);
    const id = await tx(deps.db, c => createOrganisation(c, body.name, user.id, deps.today?.() ?? new Date()));
    return reply.status(201).send({ id });
  });

  app.patch<{ Params: { orgId: string } }>('/orgs/:orgId', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user.id, req.params.orgId, 'admin');
    const body = parse(z.object({ name: z.string().trim().min(1).max(200) }), req.body);
    await deps.db.query('update organisations set name = $2, updated_at = now() where id = $1', [req.params.orgId, body.name]);
    return { ok: true };
  });

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/members', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user.id, req.params.orgId, 'member');
    const r = await deps.db.query(
      `select u.id, u.email, u.name, m.role from memberships m join users u on u.id = m.user_id
        where m.org_id = $1 order by u.name`, [req.params.orgId]);
    return { members: r.rows };
  });

  // Phase 1 adds people who already have an account; email invitations come with notifications (Phase 3).
  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/members', async (req, reply) => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user.id, req.params.orgId, 'admin');
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: orgRole.exclude(['owner']) }), req.body);
    if (body.role === 'guest' && !PLANS[acc.plan].guests) throw forbidden('plan_no_guests');
    const count = await deps.db.query<{ n: number }>(
      "select count(*)::int as n from memberships where org_id = $1 and role <> 'guest'", [req.params.orgId]);
    if (body.role !== 'guest' && count.rows[0]!.n >= PLANS[acc.plan].members) throw forbidden('plan_member_limit');
    const u = await deps.db.query<{ id: string }>('select id from users where lower(email) = $1', [body.email]);
    if (!u.rows[0]) throw notFound('user_not_found');
    await deps.db.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3)', [req.params.orgId, u.rows[0].id, body.role]);
    return reply.status(201).send({ userId: u.rows[0].id });
  });

  app.patch<{ Params: { orgId: string; userId: string } }>('/orgs/:orgId/members/:userId', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user.id, req.params.orgId, 'admin');
    const body = parse(z.object({ role: orgRole }), req.body);
    if (body.role === 'owner' && acc.role !== 'owner') throw forbidden('owner_only');
    await tx(deps.db, async c => {
      const cur = await c.query<{ role: string }>('select role from memberships where org_id = $1 and user_id = $2 for update', [req.params.orgId, req.params.userId]);
      if (!cur.rows[0]) throw notFound('member_not_found');
      if (cur.rows[0].role === 'owner' && acc.role !== 'owner') throw forbidden('owner_only');
      await c.query('update memberships set role = $3 where org_id = $1 and user_id = $2', [req.params.orgId, req.params.userId, body.role]);
      await ensureOwner(c, req.params.orgId);
    });
    return { ok: true };
  });

  app.delete<{ Params: { orgId: string; userId: string } }>('/orgs/:orgId/members/:userId', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user.id, req.params.orgId, user.id === req.params.userId ? 'guest' : 'admin');
    await tx(deps.db, async c => {
      const cur = await c.query<{ role: string }>('select role from memberships where org_id = $1 and user_id = $2 for update', [req.params.orgId, req.params.userId]);
      if (!cur.rows[0]) throw notFound('member_not_found');
      if (cur.rows[0].role === 'owner' && acc.role !== 'owner') throw forbidden('owner_only');
      await c.query('delete from memberships where org_id = $1 and user_id = $2', [req.params.orgId, req.params.userId]);
      await c.query('delete from project_members pm using projects p where p.id = pm.project_id and p.org_id = $1 and pm.user_id = $2',
        [req.params.orgId, req.params.userId]);
      await ensureOwner(c, req.params.orgId);
    });
    return { ok: true };
  });
};

/** An organisation must always keep at least one owner. */
async function ensureOwner(c: { query: (q: string, v: unknown[]) => Promise<{ rowCount: number | null }> }, orgId: string) {
  const r = await c.query("select 1 from memberships where org_id = $1 and role = 'owner'", [orgId]);
  if (!r.rowCount) throw badRequest('last_owner');
}

