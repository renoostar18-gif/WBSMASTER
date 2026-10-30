import type { Queryable } from './db.js';
import { forbidden, notFound } from './errors.js';
import { type Plan, PLANS } from './plans.js';

export type OrgRole = 'owner' | 'admin' | 'member' | 'guest';
export type ProjectRole = 'admin' | 'editor' | 'commenter' | 'viewer';

const PROJECT_RANK: Record<ProjectRole, number> = { viewer: 1, commenter: 2, editor: 3, admin: 4 };
const ORG_RANK: Record<OrgRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

export interface OrgAccess {
  orgId: string;
  plan: Plan;
  role: OrgRole;
  /** Set while the organisation waits to be deleted: only its owners still reach it, read-only. */
  deleteOn: string | null;
}

export interface ProjectAccess {
  projectId: string;
  orgId: string;
  plan: Plan;
  orgRole: OrgRole | null;
  role: ProjectRole;
  /** Set while the organisation waits to be deleted (only owners get this far). */
  deleteOn: string | null;
}

/** Who is asking: a signed-in person, or a person's API key (which only reaches its own organisation). */
export interface Caller {
  id: string;
  apiKey?: { id: string; orgId: string; scope: 'read' | 'write' } | null;
}

/** An API key reaches only its organisation, and only while the plan includes the API. */
function checkKey(who: Caller, orgId: string, plan: Plan, missing: string) {
  if (!who.apiKey) return;
  if (who.apiKey.orgId !== orgId) throw notFound(missing);
  if (!PLANS[plan].api) throw forbidden('plan_api');
}

/**
 * An organisation waiting to be deleted is hidden from everyone but its owners, and from API keys.
 * (Owners can only read it: app.ts refuses changes, except cancelling the deletion.)
 */
const hiddenWhileDeleting = (deleteOn: string | null, role: OrgRole | null, who: Caller) => !!deleteOn && (role !== 'owner' || !!who.apiKey);

/** The user's role in an organisation. 404 when they are not a member (existence is not revealed). */
export async function orgAccess(db: Queryable, who: Caller, orgId: string, min: OrgRole = 'guest'): Promise<OrgAccess> {
  const userId = who.id;
  const r = await db.query<{ role: OrgRole; plan: Plan; delete_on: string | null }>(
    'select m.role, o.plan, o.delete_on from memberships m join organisations o on o.id = m.org_id where m.org_id = $1 and m.user_id = $2',
    [orgId, userId],
  );
  const row = r.rows[0];
  if (!row || hiddenWhileDeleting(row.delete_on, row.role, who)) throw notFound('org_not_found');
  checkKey(who, orgId, row.plan, 'org_not_found');
  if (ORG_RANK[row.role] < ORG_RANK[min]) throw forbidden();
  return { orgId, plan: row.plan, role: row.role, deleteOn: row.delete_on };
}

/** Whether a change to this organisation (or the organisation of this project) must wait: it is being deleted. */
export async function lockedForDeletion(db: Queryable, userId: string, ids: { orgId?: string; projectId?: string }): Promise<boolean> {
  const r = await db.query(
    `select 1 from organisations o join memberships m on m.org_id = o.id and m.user_id = $3
      where o.delete_on is not null and (o.id = $1::uuid or o.id = (select org_id from projects where id = $2::uuid))`,
    [ids.orgId ?? null, ids.projectId ?? null, userId]);
  return !!r.rowCount;
}

/**
 * Effective project role (spec section 2): organisation owners and admins are
 * project admins everywhere; everyone else needs a project membership.
 * 404 when the user cannot see the project at all.
 */
export async function projectAccess(db: Queryable, who: Caller, projectId: string, min: ProjectRole = 'viewer'): Promise<ProjectAccess> {
  const userId = who.id;
  const r = await db.query<{ org_id: string; plan: Plan; delete_on: string | null; org_role: OrgRole | null; project_role: ProjectRole | null }>(
    `select p.org_id, o.plan, o.delete_on, m.role as org_role, pm.role as project_role
       from projects p
       join organisations o on o.id = p.org_id
       left join memberships m on m.org_id = p.org_id and m.user_id = $2
       left join project_members pm on pm.project_id = p.id and pm.user_id = $2
      where p.id = $1`,
    [projectId, userId],
  );
  const row = r.rows[0];
  if (!row || !row.org_role || hiddenWhileDeleting(row.delete_on, row.org_role, who)) throw notFound('project_not_found');
  checkKey(who, row.org_id, row.plan, 'project_not_found');
  const role: ProjectRole | null = row.org_role === 'owner' || row.org_role === 'admin' ? 'admin' : row.project_role;
  if (!role) throw notFound('project_not_found');
  if (PROJECT_RANK[role] < PROJECT_RANK[min]) throw forbidden();
  return { projectId, orgId: row.org_id, plan: row.plan, orgRole: row.org_role, role, deleteOn: row.delete_on };
}

/**
 * After a downgrade, an organisation can have more active projects than its plan allows. Nothing is
 * deleted: the oldest ones up to the limit stay editable and the rest become read-only (spec 3.4).
 */
export async function overPlanLimit(db: Queryable, orgId: string, projectId: string, plan: Plan): Promise<boolean> {
  const limit = PLANS[plan].activeProjects;
  if (!Number.isFinite(limit)) return false;
  const r = await db.query<{ id: string }>(
    'select id from projects where org_id = $1 and archived_at is null order by created_at, id limit $2', [orgId, limit]);
  return !r.rows.some(x => x.id === projectId);
}

export async function checkWritable(db: Queryable, acc: ProjectAccess): Promise<void> {
  if (await overPlanLimit(db, acc.orgId, acc.projectId, acc.plan)) throw forbidden('plan_project_read_only');
}

export const atLeast = (role: ProjectRole, min: ProjectRole) => PROJECT_RANK[role] >= PROJECT_RANK[min];
