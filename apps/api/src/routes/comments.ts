import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, clientOf, parse, requireUser } from '../app.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { type NewNotification, excerpt, notifyNow, projectPeople } from '../notify.js';
import { projectAccess } from '../permissions.js';

type P = { Params: { projectId: string } };
type C = { Params: { projectId: string; commentId: string } };

const body = z.string().trim().min(1).max(5000);

/** Comments (spec 7.1): threads on an item or the project, @mentions, resolve and reopen. Commenters need no edit rights. */
export const commentRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  /** People who can see the project, so they can be @mentioned. */
  const people = (projectId: string) => projectPeople(deps.db, projectId);

  async function comment(projectId: string, commentId: string) {
    const r = await deps.db.query<{ id: string; parent_id: string | null; author_id: string | null }>(
      'select id, parent_id, author_id from comments where id = $1 and project_id = $2', [commentId, projectId]);
    if (!r.rows[0]) throw notFound('comment_not_found');
    return r.rows[0];
  }

  const announce = (projectId: string, user: { id: string }, req: { headers: Record<string, unknown> }) =>
    deps.live?.comments(projectId, user, clientOf(req));

  app.get<P>('/projects/:projectId/people', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId);
    return { people: await people(req.params.projectId) };
  });

  app.get<P>('/projects/:projectId/comments', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId);
    const r = await deps.db.query(
      `select c.id, c.item_id as "itemId", c.parent_id as "parentId", c.body, c.mentions, c.created_at as "createdAt",
              c.edited_at as "editedAt", c.resolved_at as "resolvedAt", c.author_id as "authorId", u.name as "authorName",
              r.name as "resolvedByName"
         from comments c left join users u on u.id = c.author_id left join users r on r.id = c.resolved_by
        where c.project_id = $1 order by c.created_at, c.id`, [req.params.projectId]);
    return { comments: r.rows };
  });

  app.post<P>('/projects/:projectId/comments', async (req, reply) => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId, 'commenter');
    const b = parse(z.object({
      body, itemId: z.string().uuid().nullable().optional(), parentId: z.string().uuid().nullable().optional(),
      mentions: z.array(z.string().uuid()).max(50).optional(),
    }), req.body);
    let itemId = b.itemId ?? null;
    if (b.parentId) {
      // a reply belongs to the thread's root, on the root's item
      const root = await comment(req.params.projectId, b.parentId);
      if (root.parent_id) throw badRequest('reply_to_reply');
      const r = await deps.db.query<{ item_id: string | null }>('select item_id from comments where id = $1', [root.id]);
      itemId = r.rows[0]!.item_id;
    } else if (itemId) {
      const ok = await deps.db.query('select 1 from wbs_items where id = $1 and project_id = $2', [itemId, req.params.projectId]);
      if (!ok.rowCount) throw badRequest('item_not_found');
    }
    // only people who can see the project can be mentioned
    const allowed = new Set((await people(req.params.projectId)).map(p => p.id));
    const mentions = [...new Set(b.mentions ?? [])].filter(id => allowed.has(id) && id !== user.id);
    const r = await deps.db.query<{ id: string }>(
      `insert into comments (project_id, item_id, parent_id, author_id, body, mentions) values ($1, $2, $3, $4, $5, $6) returning id`,
      [req.params.projectId, itemId, b.parentId ?? null, user.id, b.body, mentions]);
    const commentId = r.rows[0]!.id;
    // a reply reopens a resolved thread, so it is not missed
    if (b.parentId) await deps.db.query('update comments set resolved_at = null, resolved_by = null where id = $1', [b.parentId]);
    announce(req.params.projectId, user, req);

    // notify the people mentioned, and everyone else already in the thread (spec 7.1)
    const meta = await deps.db.query<{ project: string; item: string | null }>(
      'select p.name as project, i.name as item from projects p left join wbs_items i on i.id = $2 and i.project_id = p.id where p.id = $1',
      [req.params.projectId, itemId]);
    const data = { actorName: user.name, projectName: meta.rows[0]!.project, itemName: meta.rows[0]!.item ?? undefined, excerpt: excerpt(b.body) };
    const base = { projectId: req.params.projectId, itemId, commentId, actorId: user.id, data };
    const list: NewNotification[] = mentions.map(userId => ({ ...base, userId, kind: 'mention' }));
    if (b.parentId) {
      const others = await deps.db.query<{ author_id: string }>(
        'select distinct author_id from comments where (id = $1 or parent_id = $1) and author_id is not null', [b.parentId]);
      for (const { author_id } of others.rows) {
        if (author_id !== user.id && !mentions.includes(author_id) && allowed.has(author_id)) list.push({ ...base, userId: author_id, kind: 'reply' });
      }
    }
    await notifyNow(deps.db, deps.mailer, deps.config.appUrl, list);
    return reply.status(201).send({ id: commentId, mentions });
  });

  app.patch<C>('/projects/:projectId/comments/:commentId', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId, 'commenter');
    const c = await comment(req.params.projectId, req.params.commentId);
    if (c.author_id !== user.id) throw forbidden('not_author');
    const b = parse(z.object({ body }), req.body);
    await deps.db.query('update comments set body = $2, edited_at = now() where id = $1', [c.id, b.body]);
    announce(req.params.projectId, user, req);
    return { ok: true };
  });

  app.post<C>('/projects/:projectId/comments/:commentId/resolve', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId, 'commenter');
    const c = await comment(req.params.projectId, req.params.commentId);
    if (c.parent_id) throw badRequest('not_thread');
    const b = parse(z.object({ resolved: z.boolean() }), req.body);
    await deps.db.query(
      'update comments set resolved_at = case when $2 then now() end, resolved_by = case when $2 then $3::uuid end where id = $1',
      [c.id, b.resolved, user.id]);
    announce(req.params.projectId, user, req);
    return { ok: true };
  });

  /** Authors delete their own comments; project admins can delete any. Deleting a thread's first comment deletes the thread. */
  app.delete<C>('/projects/:projectId/comments/:commentId', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'commenter');
    const c = await comment(req.params.projectId, req.params.commentId);
    if (c.author_id !== user.id && acc.role !== 'admin') throw forbidden('not_author');
    await deps.db.query('delete from comments where id = $1', [c.id]);
    announce(req.params.projectId, user, req);
    return { ok: true };
  });
};
