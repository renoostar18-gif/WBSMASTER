import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import { AUDIT_ACTIONS, audit, by, toCsv } from '../audit.js';
import { checkRoomForMember } from '../billing.js';
import { tx } from '../db.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { Moyasar } from '../moyasar.js';
import {
  cancelDeletion, cancelledEmail, emailOwners, emailUser, newOwnerEmail, scheduleDeletion, scheduledEmail,
} from '../orgadmin.js';
import { orgAccess } from '../permissions.js';
import { PLANS } from '../plans.js';

type O = { Params: { orgId: string } };
const PAGE = 50;
const auditQuery = z.object({
  /** An action ("member.added") or a group ("member"). */
  action: z.string().regex(/^[a-z_]+(\.[a-z_]+)?$/).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Organisation administration (spec 2): transferring ownership, deleting the organisation, the audit log. */
export const orgAdminRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const m = deps.config.moyasar;
  const gateway = deps.gateway ?? (m ? new Moyasar(m.secretKey, m.apiUrl) : null);
  const now = () => deps.today?.() ?? new Date();

  /** Owner-only actions are for signed-in owners, not API keys. */
  async function owner(req: Parameters<typeof requireUser>[0], orgId: string) {
    const user = requireUser(req);
    if (user.apiKey) throw new ApiError(403, 'not_with_api_key');
    await orgAccess(deps.db, user, orgId, 'owner');
    return user;
  }

  /** Make another member an owner; optionally step down to administrator. */
  app.post<O>('/orgs/:orgId/transfer', async req => {
    const user = await owner(req, req.params.orgId);
    const b = parse(z.object({ userId: z.string().uuid(), stepDown: z.boolean().optional() }), req.body);
    if (b.userId === user.id) throw badRequest('transfer_to_self');
    const org = await tx(deps.db, async c => {
      const cur = await c.query<{ role: string; name: string; email: string }>(
        `select m.role, u.name, u.email from memberships m join users u on u.id = m.user_id
          where m.org_id = $1 and m.user_id = $2 for update of m`, [req.params.orgId, b.userId]);
      const target = cur.rows[0];
      if (!target) throw notFound('member_not_found');
      if (target.role === 'guest') await checkRoomForMember(c, req.params.orgId);
      await c.query("update memberships set role = 'owner' where org_id = $1 and user_id = $2", [req.params.orgId, b.userId]);
      if (b.stepDown) await c.query("update memberships set role = 'admin' where org_id = $1 and user_id = $2", [req.params.orgId, user.id]);
      await audit(c, req.params.orgId, by(req), 'org.ownership_transferred', target.email,
        { userId: b.userId, name: target.name, from: target.role, stepDown: !!b.stepDown });
      return (await c.query<{ name: string }>('select name from organisations where id = $1', [req.params.orgId])).rows[0]!.name;
    });
    await emailUser(deps.db, deps.mailer, b.userId, l => newOwnerEmail(l, org, user.name, `${deps.config.appUrl}/members/${req.params.orgId}`));
    return { ok: true };
  });

  /** Schedule the deletion. The organisation's exact name confirms it. */
  app.post<O>('/orgs/:orgId/deletion', async (req, reply) => {
    const user = await owner(req, req.params.orgId);
    const b = parse(z.object({ confirm: z.string().max(200) }), req.body);
    const org = (await deps.db.query<{ name: string }>('select name from organisations where id = $1', [req.params.orgId])).rows[0]!;
    if (b.confirm.trim() !== org.name) throw badRequest('delete_confirm_mismatch');
    const deleteOn = await scheduleDeletion(deps.db, gateway, req.params.orgId, by(req), now());
    await emailOwners(deps.db, deps.mailer, req.params.orgId, l => scheduledEmail(l, org.name, user.name, deleteOn, `${deps.config.appUrl}/members/${req.params.orgId}`));
    return reply.status(201).send({ deleteOn });
  });

  app.delete<O>('/orgs/:orgId/deletion', { config: { duringDeletion: true } }, async req => {
    const user = await owner(req, req.params.orgId);
    await cancelDeletion(deps.db, req.params.orgId, by(req));
    const org = (await deps.db.query<{ name: string }>('select name from organisations where id = $1', [req.params.orgId])).rows[0]!;
    await emailOwners(deps.db, deps.mailer, req.params.orgId, l => cancelledEmail(l, org.name, user.name, `${deps.config.appUrl}/`));
    return { ok: true };
  });

  // ---- audit log (admins) ----

  app.get<O>('/orgs/:orgId/audit', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const q = parse(auditQuery, req.query);
    const limit = q.limit ?? PAGE;
    const r = await deps.db.query(
      `select id, action, target, details, ip, created_at as "at", actor_id as "actorId", actor_name as "actorName"
         from audit_log
        where org_id = $1 and ($2::bigint is null or id < $2) and ($3::text is null or action = $3 or action like $3 || '.%')
        order by id desc limit $4`,
      [req.params.orgId, q.before ?? null, q.action ?? null, limit + 1]);
    const events = r.rows.slice(0, limit);
    const limits = PLANS[acc.plan];
    return {
      events, next: r.rows.length > limit ? events.at(-1)!.id : null, actions: AUDIT_ACTIONS,
      retentionDays: Number.isFinite(limits.historyDays) ? limits.historyDays : null, canExport: limits.historyExport,
    };
  });

  /** Everything kept, as CSV (Business plan). */
  app.get<O>('/orgs/:orgId/audit.csv', async (req, reply) => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, 'admin');
    if (!PLANS[acc.plan].historyExport) throw forbidden('plan_history_export');
    const q = parse(auditQuery.pick({ action: true }), req.query);
    const r = await deps.db.query<{ created_at: Date; actor_name: string | null; action: string; target: string | null; details: unknown; ip: string | null }>(
      `select created_at, actor_name, action, target, details, ip from audit_log
        where org_id = $1 and ($2::text is null or action = $2 or action like $2 || '.%') order by id desc`,
      [req.params.orgId, q.action ?? null]);
    const csv = toCsv(['time', 'actor', 'action', 'target', 'details', 'ip'],
      r.rows.map(x => [x.created_at, x.actor_name ?? '', x.action, x.target ?? '', x.details, x.ip ?? '']));
    return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="audit-log.csv"')
      .header('cache-control', 'private, no-store').send(csv);
  });
};
