import { randomBytes } from 'node:crypto';
import { hashToken } from './auth.js';
import type { Queryable } from './db.js';
import type { Mailer } from './mailer.js';
import { esc } from './notify.js';

/** One-time links sent by email: confirming the address (3 days) or choosing a new password (1 hour). */
export type TokenPurpose = 'verify' | 'reset';
const TTL_MINUTES: Record<TokenPurpose, number> = { verify: 3 * 24 * 60, reset: 60 };

/** A new link for this purpose; earlier ones for the same purpose stop working. */
export async function issueToken(q: Queryable, userId: string, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await q.query('delete from email_tokens where user_id = $1 and purpose = $2', [userId, purpose]);
  await q.query(
    'insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))',
    [hashToken(token), userId, purpose, TTL_MINUTES[purpose]]);
  return token;
}

/** Use a link once: the user it belongs to, or null when it is unknown, used or expired. */
export async function consumeToken(q: Queryable, token: string, purpose: TokenPurpose): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await q.query<{ user_id: string; live: boolean }>(
    'delete from email_tokens where token_hash = $1 and purpose = $2 returning user_id, expires_at > now() as live',
    [hashToken(token), purpose]);
  const row = r.rows[0];
  return row?.live ? row.user_id : null;
}

/** The person proved they read this address: by a confirmation link, a reset link, an invitation or SSO. */
export async function markVerified(q: Queryable, userId: string): Promise<void> {
  await q.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [userId]);
}

type Locale = 'en' | 'ar';
const T = {
  en: {
    verifySubject: 'Confirm your email for WBS Master',
    verify: (name: string) => `Hello ${name}, please confirm this is your email address. Until you do, people who add you to their organisation send you an invitation instead.`,
    verifyCta: 'Confirm my email', verifyNote: 'The link works for 3 days.',
    resetSubject: 'Choose a new WBS Master password',
    reset: (name: string) => `Hello ${name}, someone asked to reset the password for this account. If it was you, choose a new password.`,
    resetCta: 'Choose a new password', resetNote: 'The link works for 1 hour. If you did not ask for this, ignore this email; your password stays the same.',
  },
  ar: {
    verifySubject: 'أكّد بريدك الإلكتروني في WBS Master',
    verify: (name: string) => `مرحبًا ${name}، يرجى تأكيد أن هذا بريدك الإلكتروني. إلى أن تؤكده، يُرسل إليك من يضيفك إلى مؤسسته دعوةً بدلًا من الإضافة المباشرة.`,
    verifyCta: 'تأكيد بريدي', verifyNote: 'يعمل الرابط لمدة 3 أيام.',
    resetSubject: 'اختر كلمة مرور جديدة لـ WBS Master',
    reset: (name: string) => `مرحبًا ${name}، طلب أحدهم إعادة تعيين كلمة مرور هذا الحساب. إن كنت أنت، فاختر كلمة مرور جديدة.`,
    resetCta: 'اختيار كلمة مرور جديدة', resetNote: 'يعمل الرابط لمدة ساعة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة؛ ستبقى كلمة مرورك كما هي.',
  },
} as const;

/** The confirmation or reset email, in the person's language. A failure is logged, never thrown. */
export async function sendTokenEmail(mailer: Mailer | undefined, purpose: TokenPurpose, to: { email: string; name: string; locale: string }, link: string) {
  if (!mailer) return;
  const l: Locale = to.locale === 'ar' ? 'ar' : 'en';
  const t = T[l];
  const [subject, line, cta, note] = purpose === 'verify'
    ? [t.verifySubject, t.verify(to.name), t.verifyCta, t.verifyNote]
    : [t.resetSubject, t.reset(to.name), t.resetCta, t.resetNote];
  const html = `<!doctype html><html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"><body style="font:14px/1.6 Arial,sans-serif;color:#0D1821">
<p style="font-weight:700">WBS Master</p><p>${esc(line)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#08776C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(cta)}</a></p>
<p style="color:#46535E;font-size:12px">${esc(note)}</p></body></html>`;
  try {
    await mailer.send({ to: to.email, subject, text: `${line}\n\n${cta}: ${link}\n\n${note}`, html });
  } catch (e) {
    console.error('email link failed', to.email, e);
  }
}
