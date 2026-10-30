import type { FastifyPluginAsync } from 'fastify';
import { type AppDeps, requireUser } from '../app.js';
import { billableMembers, memberLimit, pendingSeatInvites } from '../billing.js';
import { tx } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { acceptInvitation, invitationForToken, resendInvitation } from '../invites.js';
import { orgAccess } from '../permissions.js';
import { audit, by } from '../audit.js';

type O = { Params: { orgId: string } };
type I = { Params: { orgId: string; id: string } };

/** Invitations (spec 2): open ones for admins to see, resend or withdraw; the link's page and accepting it. */
export const invitationRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  app.get<O>('/orgs/:orgId/invitations', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const r = await deps.db.query(
      `select i.id, i.email, i.role, i.created_at as "createdAt", i.expires_at as "expiresAt", i.expires_at < now() as expired, u.name as "invitedBy"
         from invitations i left join users u on u.id = i.invited_by
        where i.org_id = $1 and i.accepted_at is null order by i.created_at desc`, [req.params.orgId]);
    const limit = await memberLimit(deps.db, req.params.orgId);
    const used = await billableMembers(deps.db, req.params.orgId) + await pendingSeatInvites(deps.db, req.params.orgId);
    return { invitations: r.rows, seats: { used, limit: Number.isFinite(limit) ? limit : null } };
  });

  app.post<I>('/orgs/:orgId/invitations/:id/resend', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const email = await resendInvitation(deps.db, deps.mailer, deps.config.appUrl, req.params.orgId, req.params.id, user);
    await audit(deps.db, req.params.orgId, by(req), 'invitation.resent', email);
    return { ok: true };
  });

  app.delete<I>('/orgs/:orgId/invitations/:id', async req => {
    const user = requireUser(req);
    await orgAccess(deps.db, user, req.params.orgId, 'admin');
    const r = await deps.db.query<{ email: string; role: string }>(
      'delete from invitations where id = $1 and org_id = $2 and accepted_at is null returning email, role', [req.params.id, req.params.orgId]);
    if (!r.rows[0]) throw notFound('invitation_not_found');
    await audit(deps.db, req.params.orgId, by(req), 'invitation.withdrawn', r.rows[0].email, { role: r.rows[0].role });
    return { ok: true };
  });

  /** What the invitation page shows. Public: the token in the link is the secret. */
  app.get<{ Params: { token: string } }>('/invitations/:token', async req => {
    const inv = await invitationForToken(deps.db, req.params.token);
    if (!inv) throw notFound('invitation_not_found');
    const account = await deps.db.query('select 1 from users where lower(email) = lower($1)', [inv.email]);
    const status = inv.accepted_at ? 'used' : inv.expires_at.getTime() < Date.now() ? 'expired' : 'open';
    return { organisation: inv.org_name, invitedBy: inv.inviter, email: inv.email, role: inv.role, status, hasAccount: !!account.rowCount };
  });

  app.post<{ Params: { token: string } }>('/invitations/:token/accept', async req => {
    const user = requireUser(req);
    if (user.apiKey) throw new ApiError(403, 'not_with_api_key');
    const orgId = await tx(deps.db, c => acceptInvitation(c, req.params.token, user, by(req)));
    return { orgId };
  });
};
