import { WorkCalendar, computeProject, toDay, todayDay } from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { hashToken, newToken } from '../invites.js';
import { projectAccess } from '../permissions.js';
import { type Plan, PLANS } from '../plans.js';
import { loadProject, serializeComputed } from '../store.js';

export const SHARE_VIEWS = ['table', 'chart', 'gantt', 'summary'] as const;
export type ShareView = (typeof SHARE_VIEWS)[number];
/** Open links per project; plenty for one per client. */
export const MAX_LINKS = 20;

export const shareLink = (appUrl: string, token: string) => `${appUrl}/share/${token}`;

type P = { Params: { projectId: string } };

interface LinkRow {
  id: string; project_id: string; views: ShareView[]; show_owners: boolean; expires_at: Date | null; plan: Plan;
}

/**
 * Public read-only links (spec 3.4, Team and Business). Project admins make and revoke them; anyone with
 * the link sees the plan without signing in. The token is stored only as its sha-256.
 */
export const linkRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const today = () => todayDay(deps.today?.() ?? new Date());

  app.get<P>('/projects/:projectId/links', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'admin');
    const r = await deps.db.query(
      `select l.id, l.views, l.show_owners as "showOwners", l.created_at as "createdAt", l.expires_at as "expiresAt",
              l.expires_at is not null and l.expires_at < now() as expired, l.last_used_at as "lastUsedAt", u.name as "createdBy"
         from public_links l left join users u on u.id = l.created_by
        where l.project_id = $1 order by l.created_at desc`, [req.params.projectId]);
    return { links: r.rows, available: PLANS[acc.plan].publicLinks };
  });

  app.post<P>('/projects/:projectId/links', async (req, reply) => {
    const user = requireUser(req);
    // a key could publish a project without anyone seeing it happen
    if (user.apiKey) throw new ApiError(403, 'not_with_api_key');
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'admin');
    if (!PLANS[acc.plan].publicLinks) throw forbidden('plan_public_links');
    const body = parse(z.object({
      views: z.array(z.enum(SHARE_VIEWS)).min(1).max(SHARE_VIEWS.length).default([...SHARE_VIEWS]),
      showOwners: z.boolean().default(true),
      // the link works until the end of this day (UTC)
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    }), req.body ?? {});
    if (body.expiresOn != null) {
      const day = toDay(body.expiresOn);
      if (day == null || day < today()) throw badRequest('share_expiry_past');
    }
    const n = await deps.db.query<{ n: number }>('select count(*)::int as n from public_links where project_id = $1', [req.params.projectId]);
    if (n.rows[0]!.n >= MAX_LINKS) throw badRequest('share_link_limit');
    const views = SHARE_VIEWS.filter(v => body.views.includes(v)); // fixed order, no repeats
    const token = newToken();
    const r = await deps.db.query<{ id: string; expires_at: Date | null; created_at: Date }>(
      `insert into public_links (project_id, token_hash, views, show_owners, created_by, expires_at)
       values ($1, $2, $3, $4, $5, (($6::date + 1)::timestamp at time zone 'UTC')) returning id, expires_at, created_at`,
      [req.params.projectId, hashToken(token), views, body.showOwners, user.id, body.expiresOn]);
    const row = r.rows[0]!;
    await deps.db.query("insert into activity_log (project_id, actor_id, action, new_value) values ($1, $2, 'share.create', $3)",
      [req.params.projectId, user.id, JSON.stringify({ id: row.id, views, showOwners: body.showOwners, expiresOn: body.expiresOn })]);
    return reply.status(201).send({
      id: row.id, token, url: shareLink(deps.config.appUrl, token), views, showOwners: body.showOwners,
      createdAt: row.created_at, expiresAt: row.expires_at,
    });
  });

  /** Revoke: the link stops working at once. To change a link, revoke it and make a new one. */
  app.delete<{ Params: { projectId: string; linkId: string } }>('/projects/:projectId/links/:linkId', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId, 'admin');
    const r = await deps.db.query('delete from public_links where id = $1 and project_id = $2', [req.params.linkId, req.params.projectId]);
    if (!r.rowCount) throw notFound('share_not_found');
    await deps.db.query("insert into activity_log (project_id, actor_id, action, new_value) values ($1, $2, 'share.revoke', $3)",
      [req.params.projectId, user.id, JSON.stringify({ id: req.params.linkId })]);
    return { ok: true };
  });

  /**
   * What a public link shows. No sign-in: the token is the secret. Only what the chosen views need:
   * no notes, comments, activity, people or baseline reasons, and owners only when the link shows them.
   * A link stops working when it is revoked or expires, when the project is deleted, or when the
   * organisation is no longer on a plan with public links. Archived projects stay visible (read-only anyway).
   */
  app.get<{ Params: { token: string } }>('/share/:token', async (req, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow');
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('share_not_found');
    const r = await deps.db.query<LinkRow>(
      `select l.id, l.project_id, l.views, l.show_owners, l.expires_at, o.plan
         from public_links l join projects p on p.id = l.project_id join organisations o on o.id = p.org_id
        where l.token_hash = $1`, [hashToken(token)]);
    const link = r.rows[0];
    if (!link || !PLANS[link.plan].publicLinks) throw notFound('share_not_found');
    if (link.expires_at && link.expires_at.getTime() < Date.now()) throw new ApiError(410, 'share_expired');
    await deps.db.query(
      "update public_links set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 hour')", [link.id]);

    const loaded = await loadProject(deps.db, link.project_id);
    const computed = computeProject(loaded.project, { calendar: new WorkCalendar(loaded.calendar), today: today() });
    const views = new Set(link.views);
    const summary = views.has('summary')
      ? (await deps.db.query(
        'select narrative, achievements, next_steps as "nextSteps", risks, decisions from project_summaries where project_id = $1', [link.project_id])).rows[0]
        ?? { narrative: '', achievements: '', nextSteps: '', risks: '', decisions: '' }
      : null;
    return {
      project: {
        name: loaded.row.name, locale: loaded.row.locale, archived: !!loaded.row.archived_at, settings: loaded.project.settings,
      },
      views: link.views,
      showOwners: link.show_owners,
      expiresAt: link.expires_at,
      items: loaded.project.items.map(i => ({ ...i, owner: link.show_owners ? i.owner : '', notes: '' })),
      baselines: loaded.project.baselines.map(b => ({ ...b, reason: '' })),
      calendar: loaded.calendar,
      summary,
      computed: serializeComputed(computed),
    };
  });
};
