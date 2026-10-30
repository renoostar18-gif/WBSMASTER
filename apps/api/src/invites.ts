import { createHash, randomBytes } from 'node:crypto';
import { type AuditBy, audit } from './audit.js';
import { checkRoomForMember } from './billing.js';
import { markVerified } from './emailtokens.js';
import type { Queryable } from './db.js';
import { ApiError, conflict, forbidden } from './errors.js';
import type { Mailer } from './mailer.js';
import { esc } from './notify.js';
import { type Plan, PLANS } from './plans.js';

/** Invitations last two weeks; inviting again renews them. */
export const INVITE_DAYS = 14;
export type InviteRole = 'admin' | 'member' | 'guest';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');
export const inviteLink = (appUrl: string, token: string) => `${appUrl}/invite/${token}`;

export interface Inviter { id: string; name: string; locale?: string }
interface Org { id: string; name: string; plan: Plan }

/**
 * Add someone to an organisation by email. Someone with an account joins now and is told by email;
 * anyone else gets an invitation link. Members (not guests) need a free seat, counting open invitations.
 */
export async function inviteOrAdd(c: Queryable, mailer: Mailer | undefined, appUrl: string, org: Org, inviter: Inviter, email: string, role: InviteRole) {
  if (role === 'guest' && !PLANS[org.plan].guests) throw forbidden('plan_no_guests');
  const found = (await c.query<{ id: string; locale: string; verified: boolean }>(
    'select id, locale, email_verified_at is not null as verified from users where lower(email) = $1', [email])).rows[0];
  if (found) {
    const m = await c.query('select 1 from memberships where org_id = $1 and user_id = $2', [org.id, found.id]);
    if (m.rowCount) throw conflict('already_member');
  }
  // only an account whose owner proved this address joins at once; anyone could have signed up with it,
  // so an unconfirmed one gets the invitation link, which only reaches the real inbox
  const u = found?.verified ? found : undefined;
  if (role !== 'guest') await checkRoomForMember(c, org.id, { exceptEmail: email });
  if (u) {
    await c.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3)', [org.id, u.id, role]);
    // a pending invitation for them is now done
    await c.query('update invitations set accepted_at = now(), accepted_by = $3 where org_id = $1 and lower(email) = $2 and accepted_at is null', [org.id, email, u.id]);
    await send(mailer, addedEmail(u.locale === 'ar' ? 'ar' : 'en', email, org.name, inviter.name, role, appUrl));
    return { userId: u.id };
  }
  const token = newToken();
  const r = await c.query<{ id: string }>(
    `insert into invitations (org_id, email, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     on conflict (org_id, lower(email)) where accepted_at is null
     do update set role = excluded.role, token_hash = excluded.token_hash, invited_by = excluded.invited_by,
                   created_at = now(), expires_at = excluded.expires_at
     returning id`,
    [org.id, email, role, hashToken(token), inviter.id, INVITE_DAYS]);
  await send(mailer, invitationEmail(email, org.name, inviter.name, role, inviteLink(appUrl, token)));
  return { invitationId: r.rows[0]!.id, invited: true as const };
}

/** A new link for an open invitation (the old one stops working), sent again. */
export async function resendInvitation(c: Queryable, mailer: Mailer | undefined, appUrl: string, orgId: string, id: string, inviter: Inviter): Promise<string> {
  const token = newToken();
  const r = await c.query<{ email: string; role: InviteRole; org: string }>(
    `update invitations i set token_hash = $3, invited_by = $4, expires_at = now() + make_interval(days => $5)
       from organisations o where o.id = i.org_id and i.id = $1 and i.org_id = $2 and i.accepted_at is null
     returning i.email, i.role, o.name as org`,
    [id, orgId, hashToken(token), inviter.id, INVITE_DAYS]);
  const inv = r.rows[0];
  if (!inv) throw new ApiError(404, 'invitation_not_found');
  await send(mailer, invitationEmail(inv.email, inv.org, inviter.name, inv.role, inviteLink(appUrl, token)));
  return inv.email;
}

export interface OpenInvitation { id: string; org_id: string; email: string; role: InviteRole; expires_at: Date; accepted_at: Date | null; org_name: string; plan: Plan; inviter: string | null }

/** The invitation behind a link, whatever its state. */
export async function invitationForToken(q: Queryable, token: string): Promise<OpenInvitation | undefined> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  const r = await q.query<OpenInvitation>(
    `select i.id, i.org_id, i.email, i.role, i.expires_at, i.accepted_at, o.name as org_name, o.plan, u.name as inviter
       from invitations i join organisations o on o.id = i.org_id left join users u on u.id = i.invited_by
      where i.token_hash = $1 and o.delete_on is null`, [hashToken(token)]);
  return r.rows[0];
}

/** Join the organisation through an invitation: the person signed in must be the one invited. */
export async function acceptInvitation(c: Queryable, token: string, user: { id: string; email: string }, who: AuditBy): Promise<string> {
  const inv = await invitationForToken(c, token);
  if (!inv) throw new ApiError(404, 'invitation_not_found');
  if (inv.accepted_at) throw new ApiError(410, 'invitation_used');
  if (inv.expires_at.getTime() < Date.now()) throw new ApiError(410, 'invitation_expired');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('invitation_other_email');
  const locked = await c.query('select 1 from invitations where id = $1 and accepted_at is null for update', [inv.id]);
  if (!locked.rowCount) throw new ApiError(410, 'invitation_used');
  if (inv.role === 'guest' && !PLANS[inv.plan].guests) throw forbidden('plan_no_guests');
  const member = await c.query('select 1 from memberships where org_id = $1 and user_id = $2', [inv.org_id, user.id]);
  if (!member.rowCount) {
    if (inv.role !== 'guest') await checkRoomForMember(c, inv.org_id);
    await c.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3)', [inv.org_id, user.id, inv.role]);
  }
  // the link reached this inbox, so the address is confirmed
  await markVerified(c, user.id);
  await c.query('update invitations set accepted_at = now(), accepted_by = $2 where id = $1', [inv.id, user.id]);
  await audit(c, inv.org_id, who, 'invitation.accepted', inv.email, { role: inv.role });
  return inv.org_id;
}

// ---- emails ----

const ROLE = {
  en: { admin: 'an administrator', member: 'a member', guest: 'a guest' },
  ar: { admin: 'مسؤولًا', member: 'عضوًا', guest: 'ضيفًا' },
} as const;

async function send(mailer: Mailer | undefined, msg: { to: string; subject: string; text: string; html: string }) {
  if (!mailer) return;
  try {
    await mailer.send(msg);
  } catch (e) {
    console.error('invitation email failed', msg.to, e);
  }
}

const page = (dir: 'ltr' | 'rtl', lang: string, body: string) =>
  `<div lang="${lang}" dir="${dir}" style="font:14px/1.6 Arial,sans-serif;color:#0D1821">${body}</div>`;
const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#08776C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;

/** The invitation goes to someone without an account, whose language is unknown: English and Arabic. */
export function invitationEmail(to: string, org: string, inviter: string, role: InviteRole, link: string) {
  const en = `${inviter} invited you to join ${org} on WBS Master as ${ROLE.en[role]}.`;
  const ar = `دعاك ${inviter} للانضمام إلى ${org} على WBS Master بصفتك ${ROLE.ar[role]}.`;
  const html = `<!doctype html><html><body style="margin:0;padding:16px">
<p style="font:700 16px Arial,sans-serif">WBS Master</p>
${page('ltr', 'en', `<p>${esc(en)}</p>${button(link, 'Accept the invitation')}<p style="color:#46535E;font-size:12px">The link works for ${INVITE_DAYS} days. If you did not expect this, you can ignore it.</p>`)}
<hr style="border:0;border-top:1px solid #D9E1DF;margin:20px 0">
${page('rtl', 'ar', `<p>${esc(ar)}</p>${button(link, 'قبول الدعوة')}<p style="color:#46535E;font-size:12px">يعمل الرابط لمدة ${INVITE_DAYS} يومًا. إن لم تكن تتوقع هذه الدعوة، يمكنك تجاهلها.</p>`)}
</body></html>`;
  const text = `${en}\n${link}\n\n${ar}\n${link}`;
  return { to, subject: `${inviter} invited you to ${org} · دعوة للانضمام إلى ${org}`, text, html };
}

/** Someone with an account was added straight away: tell them, in their language. */
export function addedEmail(locale: 'en' | 'ar', to: string, org: string, inviter: string, role: InviteRole, appUrl: string) {
  const line = locale === 'ar'
    ? `أضافك ${inviter} إلى ${org} على WBS Master بصفتك ${ROLE.ar[role]}.`
    : `${inviter} added you to ${org} on WBS Master as ${ROLE.en[role]}.`;
  const cta = locale === 'ar' ? 'فتح WBS Master' : 'Open WBS Master';
  const html = `<!doctype html><html><body style="margin:0;padding:16px"><p style="font:700 16px Arial,sans-serif">WBS Master</p>
${page(locale === 'ar' ? 'rtl' : 'ltr', locale, `<p>${esc(line)}</p>${button(appUrl, cta)}`)}</body></html>`;
  return { to, subject: line, text: `${line}\n${appUrl}`, html };
}
