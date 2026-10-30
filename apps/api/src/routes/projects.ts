import { randomUUID } from 'node:crypto';
import {
  type ComputedProject, type WbsItem, WorkCalendar, autoSchedule, computeProject, restoreBaseline, saveBaseline, toDay, todayDay,
} from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, clientOf, parse, requireUser } from '../app.js';
import { type Tx, tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { type Op, applyOps, opsBody } from '../ops.js';
import { type ProjectAccess, type ProjectRole, checkWritable, orgAccess, overPlanLimit, projectAccess } from '../permissions.js';
import { PLANS } from '../plans.js';
import { audit, by, toCsv } from '../audit.js';
import { itemNotifications, notifyNow, projectPeople } from '../notify.js';
import { saveItems } from '../save.js';
import { emitEvent } from './integrations.js';
import { loadProject, recordSnapshot, serializeComputed } from '../store.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => toDay(s) != null, 'invalid date');
const projectRole = z.enum(['admin', 'editor', 'commenter', 'viewer']);
type P = { Params: { projectId: string } };

/**
 * After a calendar changes, re-run auto-schedule on every project that uses
 * it (spec 4.10). Returns how many items moved.
 */
export async function recalcProjectsUsingCalendar(c: Tx, orgId: string, actorId: string): Promise<number> {
  const ps = await c.query<{ id: string }>('select id from projects where org_id = $1 and archived_at is null and auto_schedule', [orgId]);
  let moved = 0;
  for (const { id } of ps.rows) {
    const loaded = await loadProject(c, id, true);
    const s = autoSchedule(loaded.project, new WorkCalendar(loaded.calendar));
    if (!s.moved.length) continue;
    await saveItems(c, loaded, { ...loaded.project, items: s.items }, actorId, s.moved);
    moved += s.moved.length;
  }
  return moved;
}

/** An item as the public API and webhooks show it: stored fields plus its WBS code and health. */
export function publicItem(i: WbsItem, c: ComputedProject) {
  const info = c.items.get(i.id);
  return { ...i, code: info?.code ?? null, health: info?.health ?? null, progress: info?.progress ?? i.progress };
}

export const projectRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const today = () => todayDay(deps.today?.() ?? new Date());

  /** Tell open pages a new version was saved (bumping the version when the change did not). */
  async function announce(projectId: string, user: { id: string; name: string }, items: string[] = [], bump = false, clientId: string | null = null) {
    const r = bump
      ? await deps.db.query<{ version: number }>('update projects set version = version + 1, updated_at = now() where id = $1 returning version', [projectId])
      : await deps.db.query<{ version: number }>('select version from projects where id = $1', [projectId]);
    if (r.rows[0]) deps.live?.changed(projectId, r.rows[0].version, user, items, clientId);
  }

  /** Full project for the web app: stored data, calendar and the engine's calculations. */
  async function projectPayload(projectId: string, role: ProjectRole, acc: Pick<ProjectAccess, 'orgId' | 'plan' | 'deleteOn'>) {
    const loaded = await loadProject(deps.db, projectId);
    const computed = computeProject(loaded.project, { calendar: new WorkCalendar(loaded.calendar), today: today() });
    const summary = await deps.db.query(
      'select narrative, achievements, next_steps as "nextSteps", risks, decisions from project_summaries where project_id = $1', [projectId]);
    return {
      project: {
        id: loaded.row.id, orgId: loaded.row.org_id, name: loaded.row.name, version: loaded.row.version,
        calendarId: loaded.row.calendar_id, locale: loaded.row.locale, archived: !!loaded.row.archived_at,
        settings: loaded.project.settings,
        readOnly: acc.deleteOn ? 'deletion' : loaded.row.archived_at ? 'archived' : await overPlanLimit(deps.db, acc.orgId, projectId, acc.plan) ? 'plan' : null,
        deleteOn: acc.deleteOn,
      },
      role,
      items: loaded.project.items,
      baselines: loaded.project.baselines,
      calendar: loaded.calendar,
      summary: summary.rows[0] ?? { narrative: '', achievements: '', nextSteps: '', risks: '', decisions: '' },
      computed: serializeComputed(computed),
    };
  }

  app.get<{ Params: { orgId: string }; Querystring: { archived?: string } }>('/orgs/:orgId/projects', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId);
    const all = acc.role === 'owner' || acc.role === 'admin';
    const r = await deps.db.query(
      `select p.id, p.name, p.updated_at as "updatedAt", p.archived_at is not null as archived,
              (select count(*)::int from wbs_items i where i.project_id = p.id) as "itemCount",
              case when $3 then 'admin' else pm.role end as role
         from projects p
         left join project_members pm on pm.project_id = p.id and pm.user_id = $2
        where p.org_id = $1 and ($3 or pm.user_id is not null)
          and (p.archived_at is null) = ($4::text is null)
        order by p.updated_at desc`,
      [req.params.orgId, user.id, all, req.query.archived ?? null]);
    return { projects: r.rows };
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/projects', async (req, reply) => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId, 'member');
    const body = parse(z.object({ name: z.string().trim().min(1).max(200), locale: z.enum(['en', 'ar']).optional() }), req.body);
    const id = await tx(deps.db, async c => {
      await c.query('select id from organisations where id = $1 for update', [req.params.orgId]);
      const n = await c.query<{ n: number }>('select count(*)::int as n from projects where org_id = $1 and archived_at is null', [req.params.orgId]);
      if (n.rows[0]!.n >= PLANS[acc.plan].activeProjects) throw forbidden('plan_project_limit');
      const p = await c.query<{ id: string }>(
        'insert into projects (org_id, name, locale, updated_by) values ($1, $2, $3, $4) returning id',
        [req.params.orgId, body.name, body.locale ?? 'en', user.id]);
      const pid = p.rows[0]!.id;
      await c.query("insert into project_members (project_id, user_id, role) values ($1, $2, 'admin')", [pid, user.id]);
      await c.query("insert into activity_log (project_id, actor_id, action, new_value) values ($1, $2, 'project.create', $3)",
        [pid, user.id, JSON.stringify(body.name)]);
      await audit(c, req.params.orgId, by(req), 'project.created', body.name, { projectId: pid });
      return pid;
    });
    await emitEvent(deps, req.params.orgId, 'project.created', { project: { id, name: body.name }, actor: { id: user.id, name: user.name } });
    return reply.status(201).send({ id });
  });

  app.get<P>('/projects/:projectId', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId);
    return projectPayload(req.params.projectId, acc.role, acc);
  });

  app.patch<P>('/projects/:projectId', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'admin');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(200),
      statusDate: isoDate.nullable(),
      redThresholdDays: z.number().int().min(1).max(365),
      autoSchedule: z.boolean(),
      activeBaselineId: z.string().uuid().nullable(),
      calendarId: z.string().uuid().nullable(),
      locale: z.enum(['en', 'ar']),
      archived: z.boolean(),
    }).partial(), req.body);
    if (Object.keys(body).some(k => k !== 'archived')) await checkWritable(deps.db, acc);
    const moved = await tx(deps.db, async c => {
      if (body.calendarId) {
        const ok = await c.query('select 1 from calendars where id = $1 and org_id = $2', [body.calendarId, acc.orgId]);
        if (!ok.rowCount) throw badRequest('calendar_not_found');
      }
      if (body.activeBaselineId) {
        const ok = await c.query('select 1 from baselines where id = $1 and project_id = $2', [body.activeBaselineId, req.params.projectId]);
        if (!ok.rowCount) throw badRequest('baseline_not_found');
      }
      if (body.archived === false) {
        const n = await c.query<{ n: number }>('select count(*)::int as n from projects where org_id = $1 and archived_at is null', [acc.orgId]);
        if (n.rows[0]!.n >= PLANS[acc.plan].activeProjects) throw forbidden('plan_project_limit');
      }
      const cols: [string, unknown][] = [];
      if (body.name !== undefined) cols.push(['name', body.name]);
      if (body.statusDate !== undefined) cols.push(['status_date', body.statusDate]);
      if (body.redThresholdDays !== undefined) cols.push(['red_threshold_days', body.redThresholdDays]);
      if (body.autoSchedule !== undefined) cols.push(['auto_schedule', body.autoSchedule]);
      if (body.activeBaselineId !== undefined) cols.push(['active_baseline_id', body.activeBaselineId]);
      if (body.calendarId !== undefined) cols.push(['calendar_id', body.calendarId]);
      if (body.locale !== undefined) cols.push(['locale', body.locale]);
      if (body.archived !== undefined) cols.push(['archived_at', body.archived ? new Date() : null]);
      if (!cols.length) return 0;
      await c.query(
        `update projects set ${cols.map(([k], i) => `${k} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now(), updated_by = $${cols.length + 2}
          where id = $1`,
        [req.params.projectId, ...cols.map(([, v]) => v), user.id]);
      await c.query("insert into activity_log (project_id, actor_id, action, new_value) values ($1, $2, 'project.settings', $3)",
        [req.params.projectId, user.id, JSON.stringify(body)]);
      if (body.archived !== undefined) {
        const name = (await c.query<{ name: string }>('select name from projects where id = $1', [req.params.projectId])).rows[0]!.name;
        await audit(c, acc.orgId, by(req), body.archived ? 'project.archived' : 'project.restored', name, { projectId: req.params.projectId });
      }
      // a new calendar or switching auto-schedule on can move linked work
      if (body.calendarId !== undefined || body.autoSchedule === true) {
        const loaded = await loadProject(c, req.params.projectId, true);
        const s = autoSchedule(loaded.project, new WorkCalendar(loaded.calendar));
        if (s.moved.length) await saveItems(c, loaded, { ...loaded.project, items: s.items }, user.id, s.moved);
        return s.moved.length;
      }
      return 0;
    });
    await announce(req.params.projectId, user, [], false, clientOf(req));
    return { ok: true, itemsMoved: moved };
  });

  app.delete<P>('/projects/:projectId', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'admin');
    await tx(deps.db, async c => {
      const r = await c.query<{ name: string }>('delete from projects where id = $1 returning name', [req.params.projectId]);
      if (r.rows[0]) await audit(c, acc.orgId, by(req), 'project.deleted', r.rows[0].name, { projectId: req.params.projectId });
    });
    return { ok: true };
  });

  /** Apply a batch of edits atomically through the engine; returns the new version and calculations. */
  app.post<P>('/projects/:projectId/ops', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'editor');
    await checkWritable(deps.db, acc);
    const body = parse(opsBody, req.body);
    const result = await tx(deps.db, async c => {
      const loaded = await loadProject(c, req.params.projectId, true);
      if (loaded.row.archived_at) throw forbidden('project_archived');
      const cal = new WorkCalendar(loaded.calendar);
      const statusDate = toDay(loaded.project.settings.statusDate) ?? today();
      const r = applyOps(loaded.project, body.ops as Op[], { statusDate, calendar: cal, maxItems: PLANS[acc.plan].itemsPerProject });
      const saved = await saveItems(c, loaded, r.project, user.id, r.scheduled);
      return { r, saved, cal, before: loaded.project };
    });
    deps.live?.changed(req.params.projectId, result.saved.version, user,
      [...result.saved.added, ...result.saved.updated, ...result.saved.removed], clientOf(req));
    const computed = computeProject(result.r.project, { calendar: result.cal, today: today() });
    await recordSnapshot(deps.db, req.params.projectId, computed, today());
    const computedBefore = computeProject(result.before, { calendar: result.cal, today: today() });
    // items assigned to someone, and items that turned red (spec 7.1)
    const touched = new Set([...result.saved.added, ...result.saved.updated]);
    if (touched.size) {
      const people = await projectPeople(deps.db, req.params.projectId);
      await notifyNow(deps.db, deps.mailer, deps.config.appUrl, itemNotifications({
        projectId: req.params.projectId, projectName: result.r.project.name, actor: user, people,
        before: result.before.items, after: result.r.project.items.filter(i => touched.has(i.id)),
        computedBefore, computedAfter: computed,
      }));
    }
    // webhooks (spec 7.2): what changed, and whose health changed
    const project = { id: req.params.projectId, name: result.r.project.name };
    const actor = { id: user.id, name: user.name };
    const changed = (ids: string[]) => ids.map(id => publicItem(result.r.project.items.find(i => i.id === id)!, computed));
    if (touched.size || result.saved.removed.length) {
      await emitEvent(deps, acc.orgId, 'item.changed', {
        project, actor, version: result.saved.version,
        added: changed(result.saved.added), updated: changed(result.saved.updated), removed: result.saved.removed,
      });
    }
    const health = [...computed.items].flatMap(([id, a]) => {
      const before = computedBefore.items.get(id)?.health;
      if (!before || before === a.health) return [];
      return [{ id, code: a.code, name: result.r.project.items.find(i => i.id === id)!.name, from: before, to: a.health }];
    });
    if (health.length || computedBefore.project.health !== computed.project.health) {
      await emitEvent(deps, acc.orgId, 'health.changed', {
        project: { ...project, from: computedBefore.project.health, to: computed.project.health }, actor, items: health,
      });
    }
    return {
      version: result.saved.version,
      created: result.r.created,
      scheduled: result.r.scheduled,
      ignoredDeps: result.r.ignoredDeps,
      items: result.r.project.items,
      computed: serializeComputed(computed),
    };
  });

  // ---- members ----
  app.get<P>('/projects/:projectId/members', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId);
    const r = await deps.db.query(
      `select u.id, u.email, u.name, pm.role from project_members pm join users u on u.id = pm.user_id
        where pm.project_id = $1 order by u.name`, [req.params.projectId]);
    return { members: r.rows };
  });

  app.put<{ Params: { projectId: string; userId: string } }>('/projects/:projectId/members/:userId', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'admin');
    const body = parse(z.object({ role: projectRole }), req.body);
    await tx(deps.db, async c => {
      const m = await c.query('select 1 from memberships where org_id = $1 and user_id = $2', [acc.orgId, req.params.userId]);
      if (!m.rowCount) throw badRequest('not_org_member');
      await c.query(
        `insert into project_members (project_id, user_id, role) values ($1, $2, $3)
         on conflict (project_id, user_id) do update set role = excluded.role`,
        [req.params.projectId, req.params.userId, body.role]);
    });
    return { ok: true };
  });

  app.delete<{ Params: { projectId: string; userId: string } }>('/projects/:projectId/members/:userId', async req => {
    const user = requireUser(req);
    await projectAccess(deps.db, user, req.params.projectId, user.id === req.params.userId ? 'viewer' : 'admin');
    await tx(deps.db, async c => {
      const r = await c.query('delete from project_members where project_id = $1 and user_id = $2', [req.params.projectId, req.params.userId]);
      if (!r.rowCount) throw notFound('member_not_found');
    });
    return { ok: true };
  });

  // ---- baselines (project admins only, spec 4.8) ----
  app.post<P>('/projects/:projectId/baselines', async (req, reply) => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId, 'admin');
    await checkWritable(deps.db, acc);
    const body = parse(z.object({ name: z.string().trim().max(120).optional(), reason: z.string().trim().max(1000).optional() }), req.body ?? {});
    const out = await tx(deps.db, async c => {
      const loaded = await loadProject(c, req.params.projectId, true);
      // the automatic "Original baseline" does not count towards the plan limit
      const limit = PLANS[acc.plan].baselinesPerProject;
      const counted = (n: number) => Math.max(0, n - 1);
      if (counted(loaded.project.baselines.length) >= limit) throw forbidden('plan_baseline_limit');
      const next = saveBaseline(loaded.project, {
        name: body.name, reason: body.reason, today: today(),
        firstPlannedOn: toDay(loaded.row.created_at.toISOString().slice(0, 10)) ?? undefined,
      });
      if (typeof next === 'string') throw badRequest(next);
      if (counted(next.baselines.length) > limit) throw forbidden('plan_baseline_limit');
      await saveItems(c, loaded, next, user.id);
      const fresh = next.baselines.slice(loaded.project.baselines.length);
      for (const [k, bl] of fresh.entries()) {
        const id = randomUUID();
        await c.query(
          'insert into baselines (id, project_id, name, set_on, reason, position, created_by) values ($1, $2, $3, $4, $5, $6, $7)',
          [id, req.params.projectId, bl.name, bl.setOn, bl.reason, loaded.project.baselines.length + k, user.id]);
        await c.query(
          `insert into baseline_items (baseline_id, item_id, planned_start, planned_finish)
           select $1, x.key::uuid, (x.value->>0)::date, (x.value->>1)::date from jsonb_each($2::jsonb) as x`,
          [id, JSON.stringify(bl.items)]);
        await c.query("insert into activity_log (project_id, actor_id, action, new_value) values ($1, $2, 'baseline.save', $3)",
          [req.params.projectId, user.id, JSON.stringify({ id, name: bl.name, reason: bl.reason })]);
      }
      await c.query('update projects set active_baseline_id = null where id = $1', [req.params.projectId]);
      return fresh.map(b => b.name);
    });
    await announce(req.params.projectId, user, [], false, clientOf(req));
    const people = await projectPeople(deps.db, req.params.projectId);
    const projectName = (await deps.db.query<{ name: string }>('select name from projects where id = $1', [req.params.projectId])).rows[0]!.name;
    await emitEvent(deps, acc.orgId, 'baseline.saved', {
      project: { id: req.params.projectId, name: projectName }, actor: { id: user.id, name: user.name },
      baselines: out.map(name => ({ name, reason: name === out.at(-1) ? body.reason ?? '' : '' })),
    });
    // the automatic "Original baseline" saved alongside the first one is not news
    const named = out.at(-1);
    if (named) {
      await notifyNow(deps.db, deps.mailer, deps.config.appUrl, people.filter(p => p.id !== user.id).map(p => ({
        userId: p.id, kind: 'baseline' as const, projectId: req.params.projectId, actorId: user.id,
        data: { actorName: user.name, projectName, baselineName: named },
      })));
    }
    return reply.status(201).send({ saved: out });
  });

  app.patch<{ Params: { projectId: string; baselineId: string } }>('/projects/:projectId/baselines/:baselineId', async req => {
    const user = requireUser(req);
    await checkWritable(deps.db, await projectAccess(deps.db, user, req.params.projectId, 'admin'));
    const body = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
    const r = await deps.db.query('update baselines set name = $3 where id = $1 and project_id = $2', [req.params.baselineId, req.params.projectId, body.name]);
    if (!r.rowCount) throw notFound('baseline_not_found');
    await announce(req.params.projectId, user, [], true, clientOf(req));
    return { ok: true };
  });

  app.post<{ Params: { projectId: string; baselineId: string } }>('/projects/:projectId/baselines/:baselineId/restore', async req => {
    const user = requireUser(req);
    await checkWritable(deps.db, await projectAccess(deps.db, user, req.params.projectId, 'admin'));
    await tx(deps.db, async c => {
      const loaded = await loadProject(c, req.params.projectId, true);
      if (!loaded.project.baselines.some(b => b.id === req.params.baselineId)) throw notFound('baseline_not_found');
      await saveItems(c, loaded, restoreBaseline(loaded.project, req.params.baselineId), user.id);
      await c.query('update projects set active_baseline_id = null where id = $1', [req.params.projectId]);
    });
    await announce(req.params.projectId, user, [], false, clientOf(req));
    return { ok: true };
  });

  app.delete<{ Params: { projectId: string; baselineId: string } }>('/projects/:projectId/baselines/:baselineId', async req => {
    const user = requireUser(req);
    await checkWritable(deps.db, await projectAccess(deps.db, user, req.params.projectId, 'admin'));
    const r = await deps.db.query('delete from baselines where id = $1 and project_id = $2', [req.params.baselineId, req.params.projectId]);
    if (!r.rowCount) throw notFound('baseline_not_found');
    await announce(req.params.projectId, user, [], true, clientOf(req));
    return { ok: true };
  });

  // ---- summary text and activity ----
  app.put<P>('/projects/:projectId/summary', async req => {
    const user = requireUser(req);
    await checkWritable(deps.db, await projectAccess(deps.db, user, req.params.projectId, 'editor'));
    const t = z.string().max(10_000);
    const body = parse(z.object({ narrative: t, achievements: t, nextSteps: t, risks: t, decisions: t }).partial(), req.body);
    await deps.db.query(
      `insert into project_summaries (project_id, narrative, achievements, next_steps, risks, decisions)
       values ($1, coalesce($2, ''), coalesce($3, ''), coalesce($4, ''), coalesce($5, ''), coalesce($6, ''))
       on conflict (project_id) do update set
         narrative = coalesce($2, project_summaries.narrative), achievements = coalesce($3, project_summaries.achievements),
         next_steps = coalesce($4, project_summaries.next_steps), risks = coalesce($5, project_summaries.risks),
         decisions = coalesce($6, project_summaries.decisions), updated_at = now()`,
      [req.params.projectId, body.narrative ?? null, body.achievements ?? null, body.nextSteps ?? null, body.risks ?? null, body.decisions ?? null]);
    await announce(req.params.projectId, user, [], true, clientOf(req));
    return { ok: true };
  });

  app.get<P & { Querystring: { before?: string; itemId?: string } }>('/projects/:projectId/activity', async req => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId);
    const r = await deps.db.query(
      `select a.id, a.item_id as "itemId", a.action, a.field, a.old_value as "oldValue", a.new_value as "newValue", a.at,
              u.id as "actorId", u.name as "actorName"
         from activity_log a left join users u on u.id = a.actor_id
        where a.project_id = $1 and ($2::bigint is null or a.id < $2) and ($3::uuid is null or a.item_id = $3)
        order by a.id desc limit 100`,
      [req.params.projectId, req.query.before ?? null, req.query.itemId ?? null]);
    const plan = PLANS[acc.plan];
    // how long history is kept on this plan (spec 3.4), and whether it can be exported
    return { activity: r.rows, retentionDays: Number.isFinite(plan.historyDays) ? plan.historyDays : null, canExport: plan.historyExport };
  });

  /** The project's whole activity history as CSV (Business plan). */
  app.get<P>('/projects/:projectId/activity.csv', async (req, reply) => {
    const user = requireUser(req);
    const acc = await projectAccess(deps.db, user, req.params.projectId);
    if (!PLANS[acc.plan].historyExport) throw forbidden('plan_history_export');
    const r = await deps.db.query<{ at: Date; actor: string | null; action: string; item_id: string | null; item: string | null; field: string | null; old_value: unknown; new_value: unknown }>(
      `select a.at, u.name as actor, a.action, a.item_id, i.name as item, a.field, a.old_value, a.new_value
         from activity_log a left join users u on u.id = a.actor_id left join wbs_items i on i.id = a.item_id
        where a.project_id = $1 order by a.id desc`, [req.params.projectId]);
    const csv = toCsv(['time', 'actor', 'action', 'item id', 'item', 'field', 'old value', 'new value'],
      r.rows.map(x => [x.at, x.actor ?? '', x.action, x.item_id ?? '', x.item ?? '', x.field ?? '', x.old_value, x.new_value]));
    return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="activity.csv"')
      .header('cache-control', 'private, no-store').send(csv);
  });
};
