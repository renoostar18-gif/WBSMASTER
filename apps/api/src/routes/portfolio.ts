import { WorkCalendar, computeProject, portfolioEntry, sortPortfolio, toDay, toIso, todayDay } from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import { forbidden } from '../errors.js';
import { orgAccess } from '../permissions.js';
import { PLANS } from '../plans.js';
import { loadProject, recordSnapshot } from '../store.js';

/** Trend window (spec 4.9). */
const TREND_DAYS = 180;

export const portfolioRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const today = () => todayDay(deps.today?.() ?? new Date());

  /**
   * Every active project the user can see in the organisation, worst first (spec 4.9, FR-15).
   * `asOf` measures all of them at one status date; without it each project uses its own.
   */
  app.get<{ Params: { orgId: string }; Querystring: { asOf?: string } }>('/orgs/:orgId/portfolio', async req => {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, req.params.orgId);
    if (!PLANS[acc.plan].portfolio) throw forbidden('plan_portfolio');
    const q = parse(z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => toDay(s) != null).optional() }), req.query);
    const all = acc.role === 'owner' || acc.role === 'admin';
    const ids = await deps.db.query<{ id: string }>(
      `select p.id from projects p
         left join project_members pm on pm.project_id = p.id and pm.user_id = $2
        where p.org_id = $1 and p.archived_at is null and ($3 or pm.user_id is not null)
        order by p.name`,
      [req.params.orgId, user.id, all]);
    const t = today();
    const entries = [];
    for (const { id } of ids.rows) {
      const loaded = await loadProject(deps.db, id);
      const project = q.asOf ? { ...loaded.project, settings: { ...loaded.project.settings, statusDate: q.asOf } } : loaded.project;
      const computed = computeProject(project, { calendar: new WorkCalendar(loaded.calendar), today: t });
      // a live project measured today is today's trend point
      if (!q.asOf && !loaded.project.settings.statusDate) await recordSnapshot(deps.db, id, computed, t);
      const [summary, trend] = await Promise.all([
        deps.db.query<{ risks: string; decisions: string }>('select risks, decisions from project_summaries where project_id = $1', [id]),
        deps.db.query<{ date: string; variance: number | null }>(
          `select date, variance_days as variance from project_snapshots
            where project_id = $1 and date > $2::date - $3::int order by date`, [id, toIso(t), TREND_DAYS]),
      ]);
      entries.push({ ...portfolioEntry(project, computed, summary.rows[0]), trend: trend.rows });
    }
    return { statusDate: q.asOf ?? toIso(t), projects: sortPortfolio(entries) };
  });
};
