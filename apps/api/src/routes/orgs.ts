import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import { audit, by } from '../audit.js';
import { checkRoomForMember } from '../billing.js';
import { inviteOrAdd } from '../invites.js';
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
    const id = await tx(deps.db, async c => {
      const orgId = await createOrganisation(c, body.name, user.id, deps.today?.() ?? new Date());
      await audit(c, orgId, by(req), 'org.created', body.name);
      return orgId;
    });
    return reply.status(201).send({ id });
  });

  app.patch<{ Params: { orgId: string } }>('/orgs/:orgId', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const body = parse(z.object({ name: z.string().trim().min(1).max(200) }), req.body);
    await tx(deps.db, async c => {
      const old = (await c.query<{ name: string }>('select name from organisations where id = $1 for update', [req.params.orgId])).rows[0]!.name;
      if (old === body.name) return;
      await c.query('update organisations set name = $2, updated_at = now() where id = $1', [req.params.orgId, body.name]);
      await audit(c, req.params.orgId, by(req), 'org.renamed', body.name, { from: old });
    });
    return { ok: true };
  });

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/members', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'member');
    const r = await deps.db.query(
      `select u.id, u.email, u.name, m.role from memberships m join users u on u.id = m.user_id
        where m.org_id = $1 order by u.name`, [req.params.orgId]);
    return { members: r.rows };
  });

  /** Add someone by email: people with an account join now; anyone else gets an invitation link. */
  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/members', async (req, reply) => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), role: orgRole.exclude(['owner']) }), req.body);
    const out = await tx(deps.db, async c => {
      const o = (await c.query<{ name: string }>('select name from organisations where id = $1', [req.params.orgId])).rows[0]!;
      const r = await inviteOrAdd(c, deps.mailer, deps.config.appUrl, { id: req.params.orgId, name: o.name, plan: acc.plan }, user, body.email, body.role);
      await audit(c, req.params.orgId, by(req), 'userId' in r ? 'member.added' : 'invitation.sent', body.email, { role: body.role });
      return r;
    });
    return reply.status(201).send(out);
  });

  app.patch<{ Params: { orgId: string; userId: string } }>('/orgs/:orgId/members/:userId', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const body = parse(z.object({ role: orgRole }), req.body);
    if (body.role === 'owner' && acc.role !== 'owner') throw forbidden('owner_only');
    await tx(deps.db, async c => {
      const cur = await memberFor(c, req.params.orgId, req.params.userId);
      if (cur.role === 'owner' && acc.role !== 'owner') throw forbidden('owner_only');
      if (cur.role === body.role) return;
      if (cur.role === 'guest' && body.role !== 'guest') await checkRoomForMember(c, req.params.orgId);
      await c.query('update memberships set role = $3 where org_id = $1 and user_id = $2', [req.params.orgId, req.params.userId, body.role]);
      await ensureOwner(c, req.params.orgId);
      await audit(c, req.params.orgId, by(req), 'member.role_changed', cur.email, { userId: req.params.userId, name: cur.name, from: cur.role, to: body.role });
    });
    return { ok: true };
  });

  app.delete<{ Params: { orgId: string; userId: string } }>('/orgs/:orgId/members/:userId', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, user.id === req.params.userId ? 'guest' : 'admin');
    await tx(deps.db, async c => {
      const cur = await memberFor(c, req.params.orgId, req.params.userId);
      if (cur.role === 'owner' && acc.role !== 'owner') throw forbidden('owner_only');
      await c.query('delete from memberships where org_id = $1 and user_id = $2', [req.params.orgId, req.params.userId]);
      await c.query('delete from project_members pm using projects p where p.id = pm.project_id and p.org_id = $1 and pm.user_id = $2',
        [req.params.orgId, req.params.userId]);
      await ensureOwner(c, req.params.orgId);
      await audit(c, req.params.orgId, by(req), user.id === req.params.userId ? 'member.left' : 'member.removed', cur.email,
        { userId: req.params.userId, name: cur.name, role: cur.role });
    });
    return { ok: true };
  });
};

type Q = { query: (q: string, v: unknown[]) => Promise<{ rowCount: number | null; rows: unknown[] }> };

/** A member's role, name and email, locked for the change. */
async function memberFor(c: Q, orgId: string, userId: string) {
  const r = await c.query(
    'select m.role, u.name, u.email from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2 for update of m', [orgId, userId]);
  const row = r.rows[0] as { role: string; name: string; email: string } | undefined;
  if (!row) throw notFound('member_not_found');
  return row;
}

/** An organisation must always keep at least one owner. */
async function ensureOwner(c: { query: (q: string, v: unknown[]) => Promise<{ rowCount: number | null }> }, orgId: string) {
  const r = await c.query("select 1 from memberships where org_id = $1 and role = 'owner'", [orgId]);
  if (!r.rowCount) throw badRequest('last_owner');
}

