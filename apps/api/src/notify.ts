import type { ComputedProject, WbsItem } from '@wbs-master/engine';
import type { Queryable } from './db.js';
import type { Mailer } from './mailer.js';

export type NotificationKind = 'mention' | 'reply' | 'assigned' | 'turned_red' | 'baseline';

/** What a notification shows, as it was when it happened. */
export interface NotificationData {
  actorName?: string;
  projectName: string;
  itemName?: string;
  /** Start of the comment, for mentions and replies. */
  excerpt?: string;
  baselineName?: string;
  /** Turned red: working days late, or null when the forecast finish has passed. */
  daysLate?: number | null;
}

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  projectId: string;
  itemId?: string | null;
  commentId?: string | null;
  actorId: string | null;
  data: NotificationData;
}

export interface Person { id: string; name: string; email: string }

/** People who can see a project: its members and the organisation's owners and admins. */
export async function projectPeople(q: Queryable, projectId: string): Promise<Person[]> {
  const r = await q.query<Person>(
    `select distinct u.id, u.name, u.email from users u
      where u.id in (select user_id from project_members where project_id = $1)
         or u.id in (select m.user_id from memberships m join projects p on p.org_id = m.org_id
                      where p.id = $1 and m.role in ('owner', 'admin'))
      order by u.name`, [projectId]);
  return r.rows;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The people an item's owner text names: by full name or email, ignoring case (the owner field is free text, spec 5.2). */
export function peopleNamed(people: Person[], owner: string): Person[] {
  const o = norm(owner);
  return o ? people.filter(p => norm(p.name) === o || norm(p.email) === o) : [];
}

export const excerpt = (body: string) => (body.length > 140 ? `${body.slice(0, 139).trimEnd()}…` : body);

/**
 * Items newly assigned to someone (owner changed to their name or email), and
 * open leaves that turned red (spec 7.1: "items assigned to me", "my items turning red").
 * The person who made the change is not told about their own change.
 */
export function itemNotifications(p: {
  projectId: string; projectName: string; actor: { id: string; name: string }; people: Person[];
  before: WbsItem[]; after: WbsItem[]; computedBefore: ComputedProject; computedAfter: ComputedProject;
}): NewNotification[] {
  const out: NewNotification[] = [];
  const old = new Map(p.before.map(i => [i.id, i]));
  for (const n of p.after) {
    const o = old.get(n.id);
    const base = { projectId: p.projectId, itemId: n.id, actorId: p.actor.id };
    if (n.owner && (!o || norm(o.owner) !== norm(n.owner))) {
      for (const person of peopleNamed(p.people, n.owner)) {
        if (person.id === p.actor.id) continue;
        out.push({ ...base, userId: person.id, kind: 'assigned', data: { actorName: p.actor.name, projectName: p.projectName, itemName: n.name } });
      }
    }
    const a = p.computedAfter.items.get(n.id), b = p.computedBefore.items.get(n.id);
    if (a && !a.childCount && a.health === 'red' && b?.health !== 'red') {
      for (const person of peopleNamed(p.people, n.owner)) {
        if (person.id === p.actor.id) continue;
        out.push({ ...base, userId: person.id, kind: 'turned_red', data: { projectName: p.projectName, itemName: n.name, daysLate: a.overdue ? null : a.variance } });
      }
    }
  }
  return out;
}

/** Save notifications; returns their ids. */
export async function createNotifications(q: Queryable, list: NewNotification[]): Promise<string[]> {
  const ids: string[] = [];
  for (const n of list) {
    const r = await q.query<{ id: string }>(
      `insert into notifications (user_id, kind, project_id, item_id, comment_id, actor_id, data)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [n.userId, n.kind, n.projectId, n.itemId ?? null, n.commentId ?? null, n.actorId, JSON.stringify(n.data)]);
    ids.push(r.rows[0]!.id);
  }
  return ids;
}

// ---- email ----

type Locale = 'en' | 'ar';
interface Row {
  id: string; kind: NotificationKind; project_id: string; item_id: string | null; comment_id: string | null; data: NotificationData;
  email: string; locale: Locale;
}

const T = {
  en: {
    mention: (d: NotificationData) => `${d.actorName} mentioned you on ${d.itemName ?? 'the project'} in ${d.projectName}`,
    reply: (d: NotificationData) => `${d.actorName} replied on ${d.itemName ?? 'the project'} in ${d.projectName}`,
    assigned: (d: NotificationData) => `${d.actorName} assigned ${d.itemName} in ${d.projectName} to you`,
    turned_red: (d: NotificationData) => `${d.itemName} in ${d.projectName} is now delayed${d.daysLate ? ` (${d.daysLate} working days late)` : ': its forecast finish has passed'}`,
    baseline: (d: NotificationData) => `${d.actorName} saved the baseline “${d.baselineName}” in ${d.projectName}`,
    open: 'Open in WBS Master', digest: (n: number) => `Your WBS Master updates: ${n} new`,
    footer: 'You get these emails because of your notification settings in WBS Master (bell menu).',
  },
  ar: {
    mention: (d: NotificationData) => `أشار إليك ${d.actorName} في ${d.itemName ?? 'المشروع'} ضمن ${d.projectName}`,
    reply: (d: NotificationData) => `ردّ ${d.actorName} على ${d.itemName ?? 'المشروع'} ضمن ${d.projectName}`,
    assigned: (d: NotificationData) => `أسند إليك ${d.actorName} البند ${d.itemName} في ${d.projectName}`,
    turned_red: (d: NotificationData) => `أصبح ${d.itemName} في ${d.projectName} متأخرًا${d.daysLate ? ` (${d.daysLate} أيام عمل)` : ': تجاوز تاريخ النهاية المتوقع'}`,
    baseline: (d: NotificationData) => `حفظ ${d.actorName} خط الأساس «${d.baselineName}» في ${d.projectName}`,
    open: 'فتح في WBS Master', digest: (n: number) => `تحديثات WBS Master: ${n} جديدة`,
    footer: 'تصلك هذه الرسائل حسب إعدادات الإشعارات في WBS Master (قائمة الجرس).',
  },
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The link a notification opens: the project, on the item, with its comments for mentions and replies. */
export function linkFor(appUrl: string, n: { kind: NotificationKind; project_id: string; item_id: string | null }) {
  const q = new URLSearchParams();
  if (n.item_id) q.set('item', n.item_id);
  if (n.kind === 'mention' || n.kind === 'reply') q.set('panel', 'comments');
  const s = q.toString();
  return `${appUrl}/p/${n.project_id}${s ? `?${s}` : ''}`;
}

export function line(n: { kind: NotificationKind; data: NotificationData }, locale: Locale) {
  return T[locale][n.kind](n.data);
}

/** One email for one or more notifications, in the person's language and direction. */
export function emailFor(rows: Row[], appUrl: string) {
  const locale: Locale = rows[0]!.locale === 'ar' ? 'ar' : 'en';
  const t = T[locale];
  const subject = rows.length === 1 ? line(rows[0]!, locale) : t.digest(rows.length);
  const text = [
    ...rows.map(r => `• ${line(r, locale)}${r.data.excerpt ? `\n  “${r.data.excerpt}”` : ''}\n  ${linkFor(appUrl, r)}`),
    '', t.footer,
  ].join('\n');
  const items = rows.map(r => `<li style="margin:0 0 14px"><a href="${esc(linkFor(appUrl, r))}" style="color:#08776C;font-weight:600">${esc(line(r, locale))}</a>${
    r.data.excerpt ? `<div style="color:#46535E;margin-top:4px">“${esc(r.data.excerpt)}”</div>` : ''}</li>`).join('');
  const html = `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body style="font:14px/1.5 Arial,sans-serif;color:#0D1821">
<p style="font-weight:700">WBS Master</p><ul style="padding-inline-start:18px">${items}</ul>
<p style="color:#46535E;font-size:12px">${esc(t.footer)}</p></body></html>`;
  return { to: rows[0]!.email, subject, text, html };
}

const SELECT = `select n.id, n.kind, n.project_id, n.item_id, n.comment_id, n.data, u.email, u.locale
                  from notifications n join users u on u.id = n.user_id`;

/** Email the given notifications to people who chose instant email. A failure leaves them for the next try. */
export async function deliverInstant(db: Queryable, mailer: Mailer, appUrl: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const r = await db.query<Row>(`${SELECT} where n.id = any($1::uuid[]) and n.emailed_at is null and u.notify_email = 'instant'`, [ids]);
  let sent = 0;
  for (const row of r.rows) {
    try {
      await mailer.send(emailFor([row], appUrl));
      await db.query('update notifications set emailed_at = now() where id = $1', [row.id]);
      sent++;
    } catch (e) {
      console.error('notification email failed', row.id, e);
    }
  }
  return sent;
}

/**
 * The daily digest: one email per person who chose it, with everything not
 * emailed yet. Run once a day by a scheduler (`node dist/digest.js`).
 */
export async function sendDigests(db: Queryable, mailer: Mailer, appUrl: string): Promise<number> {
  const r = await db.query<Row & { user_id: string }>(
    `${SELECT} where n.emailed_at is null and u.notify_email = 'daily' order by n.user_id, n.created_at`);
  const byUser = new Map<string, (Row & { user_id: string })[]>();
  for (const row of r.rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  let sent = 0;
  for (const rows of byUser.values()) {
    try {
      await mailer.send(emailFor(rows, appUrl));
      await db.query('update notifications set emailed_at = now() where id = any($1::uuid[])', [rows.map(x => x.id)]);
      sent++;
    } catch (e) {
      console.error('digest email failed', rows[0]!.user_id, e);
    }
  }
  return sent;
}

/** Save notifications and email the instant ones. Never fails the request that caused them. */
export async function notifyNow(db: Queryable, mailer: Mailer | undefined, appUrl: string, list: NewNotification[]): Promise<void> {
  if (!list.length) return;
  try {
    const ids = await createNotifications(db, list);
    if (mailer) await deliverInstant(db, mailer, appUrl, ids);
  } catch (e) {
    console.error('notifications failed', e);
  }
}
