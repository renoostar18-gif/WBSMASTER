import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';

/** Only notifications about projects the person can still see. */
const VISIBLE = `exists (select 1 from project_members pm where pm.project_id = n.project_id and pm.user_id = n.user_id)
  or exists (select 1 from memberships m join projects p on p.org_id = m.org_id
              where p.id = n.project_id and m.user_id = n.user_id and m.role in ('owner', 'admin'))`;

/** In-app notifications (spec 7.1), newest first. */
export const notificationRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  app.get<{ Querystring: { before?: string } }>('/notifications', async req => {
    const user = requireUser(req);
    const q = parse(z.object({ before: z.string().datetime({ offset: true }).optional() }), req.query);
    const [list, unread] = await Promise.all([
      deps.db.query(
        `select n.id, n.kind, n.project_id as "projectId", n.item_id as "itemId", n.comment_id as "commentId",
                n.data, n.created_at as "createdAt", n.read_at as "readAt"
           from notifications n
          where n.user_id = $1 and ($2::timestamptz is null or n.created_at < $2) and (${VISIBLE})
          order by n.created_at desc limit 50`, [user.id, q.before ?? null]),
      deps.db.query<{ n: number }>(
        `select count(*)::int as n from notifications n where n.user_id = $1 and n.read_at is null and (${VISIBLE})`, [user.id]),
    ]);
    return { notifications: list.rows, unread: unread.rows[0]!.n };
  });

  app.get('/notifications/unread', async req => {
    const user = requireUser(req);
    const r = await deps.db.query<{ n: number }>(
      `select count(*)::int as n from notifications n where n.user_id = $1 and n.read_at is null and (${VISIBLE})`, [user.id]);
    return { unread: r.rows[0]!.n };
  });

  /** Mark some (or, without ids, all) as read. */
  app.post('/notifications/read', async req => {
    const user = requireUser(req);
    const b = parse(z.object({ ids: z.array(z.string().uuid()).max(200).optional() }), req.body ?? {});
    await deps.db.query(
      `update notifications set read_at = now() where user_id = $1 and read_at is null and ($2::uuid[] is null or id = any($2))`,
      [user.id, b.ids ?? null]);
    return { ok: true };
  });
};
