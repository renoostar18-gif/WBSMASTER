import { toDay, toIso, todayDay } from '@wbs-master/engine';
import { type AuditBy, audit } from './audit.js';
import { type Db, type Queryable, tx } from './db.js';
import { conflict } from './errors.js';
import type { Mailer } from './mailer.js';
import type { PaymentGateway } from './moyasar.js';
import { esc } from './notify.js';

/**
 * Deleting an organisation (spec 2, owners): after a typed confirmation the organisation is locked for
 * DELETION_DAYS, during which an owner can cancel. Then the daily job deletes it with all its data.
 */
export const DELETION_DAYS = 30;

type Locale = 'en' | 'ar';
interface Owner { email: string; name: string; locale: Locale }

export async function ownersOf(q: Queryable, orgId: string): Promise<Owner[]> {
  const r = await q.query<{ email: string; name: string; locale: string }>(
    "select u.email, u.name, u.locale from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.role = 'owner' order by u.name",
    [orgId]);
  return r.rows.map(o => ({ ...o, locale: o.locale === 'ar' ? 'ar' : 'en' }));
}

/** Lock the organisation and set the deletion date. Open checkouts are cancelled, here and at Moyasar. */
export async function scheduleDeletion(db: Db, gateway: PaymentGateway | null, orgId: string, who: AuditBy, today: Date): Promise<string> {
  const deleteOn = toIso(todayDay(today) + DELETION_DAYS)!;
  const canceled = await tx(db, async c => {
    const o = (await c.query<{ delete_on: string | null }>('select delete_on from organisations where id = $1 for update', [orgId])).rows[0]!;
    if (o.delete_on) throw conflict('deletion_already_scheduled');
    await c.query('update organisations set deletion_requested_at = now(), deletion_requested_by = $2, delete_on = $3, updated_at = now() where id = $1',
      [orgId, who.actor?.id ?? null, deleteOn]);
    const inv = await c.query<{ moyasar_id: string | null }>(
      "update billing_invoices set status = 'canceled' where org_id = $1 and status = 'pending' returning moyasar_id", [orgId]);
    await audit(c, orgId, who, 'org.deletion_scheduled', null, { deleteOn, checkoutsCancelled: inv.rowCount ?? 0 });
    return inv.rows;
  });
  for (const i of canceled) if (i.moyasar_id && gateway) await gateway.cancelInvoice(i.moyasar_id).catch(() => {});
  return deleteOn;
}

export async function cancelDeletion(db: Db, orgId: string, who: AuditBy): Promise<void> {
  await tx(db, async c => {
    const r = await c.query('update organisations set deletion_requested_at = null, deletion_requested_by = null, delete_on = null, updated_at = now() where id = $1 and delete_on is not null', [orgId]);
    if (!r.rowCount) throw conflict('deletion_not_scheduled');
    await audit(c, orgId, who, 'org.deletion_cancelled');
  });
}

/**
 * The daily job: delete organisations whose waiting period is over, with all their data (projects,
 * items, comments, invoices, keys, webhooks… through the foreign keys), then tell the owners.
 * The people stay: they can still sign in, join other organisations or create a new one.
 */
export async function runDailyDeletions(ctx: { db: Db; mailer?: Mailer; appUrl: string; today: () => Date }): Promise<number> {
  const today = toIso(todayDay(ctx.today()))!;
  const due = await ctx.db.query<{ id: string }>('select id from organisations where delete_on <= $1 order by delete_on', [today]);
  let n = 0;
  for (const { id } of due.rows) {
    try {
      const done = await tx(ctx.db, async c => {
        const o = (await c.query<{ name: string; delete_on: string | null }>('select name, delete_on from organisations where id = $1 for update', [id])).rows[0];
        if (!o?.delete_on || o.delete_on > today) return null; // cancelled meanwhile
        const owners = await ownersOf(c, id);
        await c.query('delete from organisations where id = $1', [id]);
        return { name: o.name, owners };
      });
      if (!done) continue;
      n++;
      for (const u of done.owners) await send(ctx.mailer, u, deletedEmail(u.locale, done.name, ctx.appUrl));
    } catch (e) {
      console.error('deletion: could not delete organisation', id, e);
    }
  }
  return n;
}

// ---- emails ----

interface Email { subject: string; lines: string[]; link: string; cta: string }

async function send(mailer: Mailer | undefined, to: Owner, e: Email) {
  if (!mailer) return;
  const html = `<!doctype html><html lang="${to.locale}" dir="${to.locale === 'ar' ? 'rtl' : 'ltr'}"><body style="font:14px/1.5 Arial,sans-serif;color:#0D1821">
<p style="font-weight:700">WBS Master</p>${e.lines.map(l => `<p>${esc(l)}</p>`).join('')}
<p><a href="${esc(e.link)}" style="color:#08776C;font-weight:600">${esc(e.cta)}</a></p></body></html>`;
  try {
    await mailer.send({ to: to.email, subject: e.subject, text: [...e.lines, '', `${e.cta}: ${e.link}`].join('\n'), html });
  } catch (err) {
    console.error('organisation email failed', to.email, err);
  }
}

/** Email every owner of the organisation, each in their language. */
export async function emailOwners(q: Queryable, mailer: Mailer | undefined, orgId: string, build: (l: Locale) => Email) {
  for (const u of await ownersOf(q, orgId)) await send(mailer, u, build(u.locale));
}

const longDate = (iso: string, l: Locale) =>
  new Intl.DateTimeFormat(l === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

export function scheduledEmail(l: Locale, org: string, by: string, deleteOn: string, link: string): Email {
  const d = longDate(deleteOn, l);
  const last = longDate(toIso(toDay(deleteOn)! - 1)!, l);
  return l === 'ar'
    ? { subject: `جدولة حذف المؤسسة: ${org}`, cta: 'إلغاء الحذف', link,
        lines: [`طلب ${by} حذف المؤسسة «${org}» وكل مشاريعها وبياناتها. ستُحذف نهائيًا في ${d}.`,
          `حتى ذلك الحين المؤسسة مقفلة: لا يراها الأعضاء، ويمكن للمالكين عرضها فقط. يمكن لأي مالك إلغاء الحذف حتى ${last}.`] }
    : { subject: `Organisation scheduled for deletion: ${org}`, cta: 'Cancel the deletion', link,
        lines: [`${by} asked to delete the organisation “${org}” with all its projects and data. It will be deleted for good on ${d}.`,
          `Until then the organisation is locked: members cannot see it and owners can only view it. Any owner can cancel the deletion until ${last}.`] };
}

export function cancelledEmail(l: Locale, org: string, by: string, link: string): Email {
  return l === 'ar'
    ? { subject: `أُلغي حذف المؤسسة: ${org}`, cta: 'فتح WBS Master', link, lines: [`ألغى ${by} حذف المؤسسة «${org}». عادت المؤسسة كما كانت لجميع أعضائها.`] }
    : { subject: `Deletion cancelled: ${org}`, cta: 'Open WBS Master', link, lines: [`${by} cancelled the deletion of “${org}”. The organisation is back to normal for all its members.`] };
}

export function deletedEmail(l: Locale, org: string, appUrl: string): Email {
  return l === 'ar'
    ? { subject: `حُذفت المؤسسة: ${org}`, cta: 'فتح WBS Master', link: appUrl,
        lines: [`حُذفت المؤسسة «${org}» وكل مشاريعها وبياناتها نهائيًا كما طُلب قبل ${DELETION_DAYS} يومًا.`, 'ما زال حسابك قائمًا، ويمكنك تسجيل الدخول وإنشاء مؤسسة جديدة في أي وقت.'] }
    : { subject: `Organisation deleted: ${org}`, cta: 'Open WBS Master', link: appUrl,
        lines: [`The organisation “${org}” and all its projects and data have been deleted, as requested ${DELETION_DAYS} days ago.`, 'Your account remains: you can sign in and create a new organisation at any time.'] };
}

export function newOwnerEmail(l: Locale, org: string, by: string, link: string): Email {
  return l === 'ar'
    ? { subject: `أصبحت مالكًا للمؤسسة: ${org}`, cta: 'فتح المؤسسة', link, lines: [`نقل ${by} ملكية المؤسسة «${org}» إليك. يمكنك الآن إدارة الفوترة والأعضاء وحذف المؤسسة.`] }
    : { subject: `You are now an owner of ${org}`, cta: 'Open the organisation', link, lines: [`${by} made you an owner of “${org}”. You can now manage billing and members, and delete the organisation.`] };
}

/** One email to one person (by user id), in their language. */
export async function emailUser(q: Queryable, mailer: Mailer | undefined, userId: string, build: (l: Locale) => Email) {
  const u = (await q.query<{ email: string; name: string; locale: string }>('select email, name, locale from users where id = $1', [userId])).rows[0];
  if (u) await send(mailer, { ...u, locale: u.locale === 'ar' ? 'ar' : 'en' }, build(u.locale === 'ar' ? 'ar' : 'en'));
}
