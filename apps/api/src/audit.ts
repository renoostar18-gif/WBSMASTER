import type { FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.js';
import { type Plan, PLANS } from './plans.js';

/** What the audit log records (spec 2: admins see organisation-level events). */
export const AUDIT_ACTIONS = [
  'member.added', 'member.removed', 'member.left', 'member.role_changed',
  'invitation.sent', 'invitation.resent', 'invitation.withdrawn', 'invitation.accepted',
  'org.created', 'org.renamed', 'org.ownership_transferred', 'org.deletion_scheduled', 'org.deletion_cancelled',
  'sso.updated', 'sso.removed', 'sso.domain_added', 'sso.domain_verified', 'sso.domain_removed',
  'api_key.created', 'api_key.revoked',
  'webhook.created', 'webhook.updated', 'webhook.deleted',
  'billing.trial_started', 'billing.payment_received', 'billing.plan_changed',
  'project.created', 'project.archived', 'project.restored', 'project.deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Who did something: a person (or their API key) and the address the request came from. Null actor: the system. */
export interface AuditBy {
  actor: { id: string; name: string } | null;
  ip?: string | null;
  apiKey?: string | null;
}

/** The person making a request, for the audit log. */
export function by(req: FastifyRequest): AuditBy {
  const u = req.user;
  return { actor: u ? { id: u.id, name: u.name } : null, ip: req.ip, apiKey: u?.apiKey?.id ?? null };
}

export const SYSTEM: AuditBy = { actor: null };

/** Record an organisation-level event. Runs in the caller's transaction when given one. */
export async function audit(q: Queryable, orgId: string, who: AuditBy, action: AuditAction, target: string | null = null, details: Record<string, unknown> = {}) {
  await q.query(
    'insert into audit_log (org_id, actor_id, actor_name, action, target, details, ip) values ($1, $2, $3, $4, $5, $6, $7)',
    [orgId, who.actor?.id ?? null, who.actor?.name ?? null, action, target, JSON.stringify(who.apiKey ? { ...details, apiKey: who.apiKey } : details), who.ip ?? null]);
}

/**
 * Plan retention (spec 3.4): project activity and the audit log are kept 30 days on Free and one year
 * on Team; Business keeps everything. Uses each organisation's plan in force today, so nothing within
 * the current plan's window is ever deleted. Run by the daily job after billing has brought plans up to date.
 */
export async function pruneHistory(db: Db, today: string): Promise<{ activity: number; audit: number }> {
  let activity = 0;
  let auditN = 0;
  for (const [plan, limits] of Object.entries(PLANS) as [Plan, (typeof PLANS)[Plan]][]) {
    if (!Number.isFinite(limits.historyDays)) continue;
    // older than the window: before the start of the day `historyDays` days ago
    const a = await db.query(
      `delete from activity_log a using projects p, organisations o
        where p.id = a.project_id and o.id = p.org_id and o.plan = $1 and a.at < ($2::date - $3::int)::timestamptz`,
      [plan, today, limits.historyDays]);
    const l = await db.query(
      `delete from audit_log l using organisations o
        where o.id = l.org_id and o.plan = $1 and l.created_at < ($2::date - $3::int)::timestamptz`,
      [plan, today, limits.historyDays]);
    activity += a.rowCount ?? 0;
    auditN += l.rowCount ?? 0;
  }
  return { activity, audit: auditN };
}

/** One CSV field: quoted, and a leading = + - @ made harmless so spreadsheets do not run it as a formula. */
function csvField(v: unknown): string {
  let s = v == null ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

/** A CSV file that Excel opens as UTF-8 (Arabic included). */
export function toCsv(header: string[], rows: unknown[][]): string {
  return `﻿${[header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}
