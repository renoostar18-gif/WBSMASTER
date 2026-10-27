import { toDay, toIso, todayDay } from '@wbs-master/engine';
import QRCode from 'qrcode';
import type { Seller } from './config.js';
import { type Db, type Queryable, tx } from './db.js';
import { ApiError } from './errors.js';
import type { Mailer } from './mailer.js';
import type { PaymentGateway } from './moyasar.js';
import { esc } from './notify.js';
import { cspWithScript } from './security.js';
import { ANNUAL_DISCOUNT, type Plan, PLANS, SAR_PER_USD } from './plans.js';

/**
 * Billing (spec 3.4): organisations pay ahead for a month or a year through Moyasar's hosted invoice
 * page; there is no stored card and no automatic charge. The plan in force is worked out from the
 * paid invoices and the trial, and organisations.plan is kept up to date from it (syncPlan).
 */
export type PaidPlan = Exclude<Plan, 'free'>;
export type Interval = 'month' | 'year';
export type CheckoutKind = 'new' | 'renew' | 'upgrade';

export const TRIAL_DAYS = 14;
/** After a paid period ends, the plan carries on this many days while the organisation renews. */
export const GRACE_DAYS = 7;
/** Saudi VAT, added to prices when VAT is switched on (VAT_ENABLED). */
export const VAT_RATE = 15;
/** Moyasar's smallest charge: SAR 1. */
export const MIN_CHARGE = 100;
export const MAX_SEATS = 5000;
const RANK: Record<Plan, number> = { free: 0, team: 1, business: 2 };

/** Price of one seat for one period, in halalas: SAR 45 / 90 a month, or 12 months less 20% a year. */
export function seatPrice(plan: PaidPlan, interval: Interval): number {
  const month = Math.round(PLANS[plan].priceMonthlyUsd * SAR_PER_USD * 100);
  return interval === 'month' ? month : Math.round(month * 12 * (1 - ANNUAL_DISCOUNT));
}

/** One month or one year later; the 31st becomes the month's last day (31 Jan → 28 Feb). */
export function addInterval(iso: string, interval: Interval): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const ty = interval === 'year' ? y + 1 : m === 12 ? y + 1 : y;
  const tm = interval === 'year' ? m : m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const days = (from: string, to: string) => toDay(to)! - toDay(from)!;
const plusDays = (iso: string, n: number) => toIso(toDay(iso)! + n)!;

export interface PaidPeriod {
  id: string;
  plan: PaidPlan;
  interval: Interval;
  seats: number;
  period_start: string;
  period_end: string;
  paid_at: Date;
}

export interface BillingState {
  plan: Plan;
  /** Paid seats, or null when the plan's own member limit applies (free, trial). */
  seats: number | null;
  /** The paid period in force (also during the grace days after it ends). */
  current: PaidPeriod | null;
  /** Last day paid for, exclusive: the plan ends (or the grace days start) on this date. */
  paidUntil: string | null;
  /** True when the paid period ended and the organisation is in its grace days. */
  inGrace: boolean;
  /** A renewal is already paid for the period after the current one. */
  renewed: boolean;
  trial: { plan: PaidPlan; ends: string } | null;
  /** Given free of charge by hand (organisations.comp_plan), e.g. for pilots. */
  comped?: boolean;
}

/** What is in force today, from the paid periods and the trial. A later payment wins over an earlier one for the same days. */
export function billingState(periods: PaidPeriod[], trial: { plan: PaidPlan | null; ends: string | null }, today: string): BillingState {
  const latest = [...periods].sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime());
  const covering = latest.find(p => p.period_start <= today && today < p.period_end);
  const paidUntil = periods.reduce<string | null>((m, p) => (!m || p.period_end > m ? p.period_end : m), null);
  if (covering) {
    return { plan: covering.plan, seats: covering.seats, current: covering, paidUntil, inGrace: false, renewed: paidUntil! > covering.period_end, trial: null };
  }
  if (paidUntil && paidUntil <= today && today < plusDays(paidUntil, GRACE_DAYS)) {
    const last = latest.find(p => p.period_end === paidUntil)!;
    return { plan: last.plan, seats: last.seats, current: last, paidUntil, inGrace: true, renewed: false, trial: null };
  }
  if (trial.plan && trial.ends && today < trial.ends) {
    return { plan: trial.plan, seats: null, current: null, paidUntil: null, inGrace: false, renewed: false, trial: { plan: trial.plan, ends: trial.ends } };
  }
  return { plan: 'free', seats: null, current: null, paidUntil: null, inGrace: false, renewed: false, trial: null };
}

export interface Quote {
  kind: CheckoutKind;
  plan: PaidPlan;
  interval: Interval;
  seats: number;
  seatPrice: number;
  periodStart: string;
  periodEnd: string;
  subtotal: number;
  vatRate: number;
  vat: number;
  total: number;
}

export class BillingRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * What a checkout would charge. Without a paid plan in force: a new period from today. With one:
 * moving up (a higher plan or more seats, same billing interval) is charged now for the days left;
 * anything else is a renewal that starts when the current period ends. Moving down happens at renewal.
 */
export function quote(state: BillingState, req: { plan: PaidPlan; interval: Interval; seats: number; renew?: boolean }, today: string, vatEnabled: boolean): Quote {
  const price = seatPrice(req.plan, req.interval);
  const vatRate = vatEnabled ? VAT_RATE : 0;
  const done = (kind: CheckoutKind, periodStart: string, periodEnd: string, subtotal: number): Quote => {
    const vat = Math.round((subtotal * vatRate) / 100);
    return { kind, plan: req.plan, interval: req.interval, seats: req.seats, seatPrice: price, periodStart, periodEnd, subtotal, vatRate, vat, total: subtotal + vat };
  };
  const cur = state.current;
  if (!cur) {
    const end = addInterval(today, req.interval);
    return done('new', today, end, price * req.seats);
  }
  const up = RANK[req.plan] >= RANK[cur.plan] && req.seats >= cur.seats && (RANK[req.plan] > RANK[cur.plan] || req.seats > cur.seats);
  if (up && !req.renew && !state.inGrace && req.interval === cur.interval) {
    const left = days(today, cur.period_end);
    const full = days(cur.period_start, cur.period_end);
    const diff = price * req.seats - seatPrice(cur.plan, cur.interval) * cur.seats;
    return done('upgrade', today, cur.period_end, Math.max(MIN_CHARGE, Math.round((diff * left) / full)));
  }
  if (state.renewed) throw new BillingRuleError('billing_already_renewed');
  const start = state.paidUntil!;
  return done('renew', start, addInterval(start, req.interval), price * req.seats);
}

// ---- the database ----

/** Members who need a seat: everyone but guests (guests are free, spec 3.4). */
export async function billableMembers(q: Queryable, orgId: string): Promise<number> {
  const r = await q.query<{ n: number }>("select count(*)::int as n from memberships where org_id = $1 and role <> 'guest'", [orgId]);
  return r.rows[0]!.n;
}

/** How many members (not guests) the organisation may have: its paid seats, or the plan's limit. */
export async function memberLimit(q: Queryable, orgId: string): Promise<number> {
  const r = await q.query<{ plan: Plan; seats: number | null }>('select plan, seats from organisations where id = $1', [orgId]);
  return r.rows[0]?.seats ?? PLANS[r.rows[0]?.plan ?? 'free'].members;
}

/** Open invitations that will need a seat (not guests), except the one for `exceptEmail`. */
export async function pendingSeatInvites(q: Queryable, orgId: string, exceptEmail = ''): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select count(*)::int as n from invitations
      where org_id = $1 and role <> 'guest' and accepted_at is null and expires_at > now() and lower(email) <> $2`, [orgId, exceptEmail.toLowerCase()]);
  return r.rows[0]!.n;
}

/**
 * Refuse another member beyond the paid seats (403 plan_seat_limit) or the Free plan's 3 (403 plan_member_limit).
 * With `invites`, open invitations hold their seats too (inviting and adding people); without, they do not
 * (accepting an invitation, which uses the seat it held).
 */
export async function checkRoomForMember(q: Queryable, orgId: string, invites?: { exceptEmail: string }): Promise<void> {
  const r = await q.query<{ seats: number | null }>('select seats from organisations where id = $1 for update', [orgId]);
  const held = invites ? await pendingSeatInvites(q, orgId, invites.exceptEmail) : 0;
  if ((await billableMembers(q, orgId)) + held >= (await memberLimit(q, orgId))) {
    throw new ApiError(403, r.rows[0]?.seats != null ? 'plan_seat_limit' : 'plan_member_limit');
  }
}

export async function loadBillingState(q: Queryable, orgId: string, today: string): Promise<BillingState> {
  const o = await q.query<{ trial_plan: PaidPlan | null; trial_ends: string | null; comp_plan: PaidPlan | null }>(
    'select trial_plan, trial_ends, comp_plan from organisations where id = $1', [orgId]);
  const p = await q.query<PaidPeriod>(
    "select id, plan, interval, seats, period_start, period_end, paid_at from billing_invoices where org_id = $1 and status = 'paid'", [orgId]);
  const s = billingState(p.rows, { plan: o.rows[0]?.trial_plan ?? null, ends: o.rows[0]?.trial_ends ?? null }, today);
  const comp = o.rows[0]?.comp_plan;
  return comp ? { ...s, plan: comp, seats: null, trial: null, comped: true } : s;
}

/** Bring organisations.plan and seats in line with what is paid for today. */
export async function syncPlan(q: Queryable, orgId: string, today: string): Promise<BillingState> {
  const s = await loadBillingState(q, orgId, today);
  await q.query('update organisations set plan = $2, seats = $3, updated_at = now() where id = $1 and (plan <> $2 or seats is distinct from $3)',
    [orgId, s.plan, s.seats]);
  return s;
}

export interface InvoiceRow {
  id: string; org_id: string; number: number | null; kind: CheckoutKind; plan: PaidPlan; interval: Interval; seats: number;
  period_start: string; period_end: string; subtotal: number; vat_rate: string; vat: number; total: number; currency: string;
  status: 'pending' | 'paid' | 'canceled' | 'expired' | 'failed'; moyasar_id: string | null; pay_url: string | null;
  seller: SellerSnapshot | null; buyer: BuyerSnapshot | null; created_at: Date; paid_at: Date | null;
}
export interface SellerSnapshot { name: string; nameAr: string; address: string; cr: string | null; vatNumber: string | null }
export interface BuyerSnapshot { organisation: string; name: string | null; address: string | null; vatNumber: string | null; email: string | null }

const LOCAL_STATUS: Record<string, InvoiceRow['status']> = { failed: 'failed', canceled: 'canceled', expired: 'expired' };

export interface BillingContext {
  db: Db;
  gateway: PaymentGateway | null;
  seller: Seller;
  mailer?: Mailer;
  appUrl: string;
  today: () => Date;
}

/**
 * Ask Moyasar about a checkout and record the outcome. The only way an invoice becomes paid: never
 * from what a browser or a notification says, only from Moyasar's own answer, for the right amount.
 */
export async function settleInvoice(ctx: BillingContext, invoiceId: string): Promise<InvoiceRow['status']> {
  const pending = (await ctx.db.query<InvoiceRow>('select * from billing_invoices where id = $1', [invoiceId])).rows[0];
  if (!pending?.moyasar_id || !ctx.gateway) return pending?.status ?? 'failed';
  if (pending.status === 'paid') return 'paid';
  const m = await ctx.gateway.getInvoice(pending.moyasar_id);
  const today = toIso(todayDay(ctx.today()))!;
  const paid = m.status === 'paid' && m.amount === pending.total && m.currency?.toUpperCase() === pending.currency;
  if (!paid) {
    const next = LOCAL_STATUS[m.status];
    if (next && pending.status === 'pending') await ctx.db.query("update billing_invoices set status = $2 where id = $1 and status = 'pending'", [invoiceId, next]);
    if (m.status === 'paid') console.error('moyasar invoice paid with a different amount or currency', invoiceId, m.amount, m.currency);
    return next ?? pending.status;
  }
  const newlyPaid = await tx(ctx.db, async c => {
    const row = (await c.query<InvoiceRow>('select * from billing_invoices where id = $1 for update', [invoiceId])).rows[0]!;
    // paid even when canceled here meanwhile: the customer's money arrived, so they get what they paid for
    if (row.status === 'paid') return false;
    const n = (await c.query<{ value: number }>("update billing_counters set value = value + 1 where name = 'invoice' returning value")).rows[0]!.value;
    const o = (await c.query<{ name: string; billing_name: string | null; billing_address: string | null; billing_vat_number: string | null; billing_email: string | null }>(
      'select name, billing_name, billing_address, billing_vat_number, billing_email from organisations where id = $1', [row.org_id])).rows[0]!;
    const seller: SellerSnapshot = { ...ctx.seller };
    const buyer: BuyerSnapshot = { organisation: o.name, name: o.billing_name, address: o.billing_address, vatNumber: o.billing_vat_number, email: o.billing_email };
    await c.query("update billing_invoices set status = 'paid', number = $2, paid_at = now(), seller = $3, buyer = $4 where id = $1",
      [invoiceId, n, JSON.stringify(seller), JSON.stringify(buyer)]);
    await c.query('update organisations set trial_ends = least(trial_ends, $2::date) where id = $1 and trial_ends is not null', [row.org_id, today]);
    await syncPlan(c, row.org_id, today);
    return true;
  });
  if (newlyPaid) await emailOwners(ctx, pending.org_id, (l, org) => receiptEmail(l, org, pending, ctx.appUrl));
  return 'paid';
}

/**
 * The daily job: settle checkouts whose notification never came, expire old ones, bring every
 * organisation's plan in line with today (ending trials and lapsed periods), and send reminders.
 */
export async function runDailyBilling(ctx: BillingContext): Promise<{ settled: number; changed: number; reminders: number }> {
  const today = toIso(todayDay(ctx.today()))!;
  let settled = 0;
  const pending = await ctx.db.query<{ id: string; old: boolean }>(
    "select id, created_at < now() - interval '3 days' as old from billing_invoices where status = 'pending' order by created_at");
  for (const p of pending.rows) {
    try {
      if ((await settleInvoice(ctx, p.id)) === 'paid') settled++;
      else if (p.old) await ctx.db.query("update billing_invoices set status = 'expired' where id = $1 and status = 'pending'", [p.id]);
    } catch (e) {
      console.error('billing: could not check checkout', p.id, e);
    }
  }
  let changed = 0;
  const orgs = await ctx.db.query<{ id: string; plan: Plan }>(
    "select id, plan from organisations o where plan <> 'free' or trial_ends is not null or comp_plan is not null or exists (select 1 from billing_invoices b where b.org_id = o.id and b.status = 'paid')");
  let reminders = 0;
  for (const o of orgs.rows) {
    const s = await syncPlan(ctx.db, o.id, today);
    if (s.plan !== o.plan) changed++;
    reminders += await remind(ctx, o.id, s, today);
  }
  return { settled, changed, reminders };
}

/** Reminders, each sent once: renew 7 days and 1 day before the end, at the start of the grace days, and 3 days before a trial ends. */
async function remind(ctx: BillingContext, orgId: string, s: BillingState, today: string): Promise<number> {
  if (s.comped) return 0;
  let kind: ReminderKind | null = null;
  let date = '';
  if (s.current && !s.renewed && s.paidUntil) {
    const left = days(today, s.paidUntil);
    date = s.paidUntil;
    if (s.inGrace) kind = 'lapsed';
    else if (left <= 1) kind = 'renew1';
    else if (left <= 7) kind = 'renew7';
  } else if (s.trial && days(today, s.trial.ends) <= 3) {
    kind = 'trial';
    date = s.trial.ends;
  }
  if (!kind) return 0;
  const r = await ctx.db.query('insert into billing_reminders (org_id, kind, for_date) values ($1, $2, $3) on conflict do nothing', [orgId, kind, date]);
  if (!r.rowCount) return 0;
  const k = kind;
  await emailOwners(ctx, orgId, (l, org) => reminderEmail(l, org, k, date, s, ctx.appUrl, orgId));
  return 1;
}

// ---- emails ----

type Locale = 'en' | 'ar';
type ReminderKind = 'renew7' | 'renew1' | 'lapsed' | 'trial';
const PLAN_NAME = { en: { team: 'Team', business: 'Business' }, ar: { team: 'الفريق', business: 'الأعمال' } } as const;

export function sar(halalas: number, locale: Locale = 'en'): string {
  const n = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(halalas / 100);
  return locale === 'ar' ? `${n} ر.س` : `SAR ${n}`;
}

const longDate = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

async function emailOwners(ctx: BillingContext, orgId: string, build: (locale: Locale, orgName: string) => { subject: string; lines: string[]; link: string; cta: string }) {
  if (!ctx.mailer) return;
  const r = await ctx.db.query<{ email: string; locale: string; org: string }>(
    "select u.email, u.locale, o.name as org from memberships m join users u on u.id = m.user_id join organisations o on o.id = m.org_id where m.org_id = $1 and m.role = 'owner'",
    [orgId]);
  for (const u of r.rows) {
    const locale: Locale = u.locale === 'ar' ? 'ar' : 'en';
    const e = build(locale, u.org);
    const html = `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><body style="font:14px/1.5 Arial,sans-serif;color:#0D1821">
<p style="font-weight:700">WBS Master</p>${e.lines.map(l => `<p>${esc(l)}</p>`).join('')}
<p><a href="${esc(e.link)}" style="color:#08776C;font-weight:600">${esc(e.cta)}</a></p></body></html>`;
    try {
      await ctx.mailer.send({ to: u.email, subject: e.subject, text: [...e.lines, '', `${e.cta}: ${e.link}`].join('\n'), html });
    } catch (err) {
      console.error('billing email failed', orgId, err);
    }
  }
}

function receiptEmail(l: Locale, org: string, inv: InvoiceRow, appUrl: string) {
  const plan = PLAN_NAME[l][inv.plan];
  const link = `${appUrl}/billing/${inv.org_id}`;
  return l === 'ar'
    ? { subject: `تم استلام الدفعة: ${org}`, cta: 'عرض الفواتير', link,
        lines: [`شكرًا لك. استلمنا ${sar(inv.total, 'ar')} لباقة ${plan} (${inv.seats} مستخدمين) حتى ${longDate(inv.period_end, 'ar')}.`] }
    : { subject: `Payment received: ${org}`, cta: 'See your invoices', link,
        lines: [`Thank you. We received ${sar(inv.total)} for the ${plan} plan (${inv.seats} seats) until ${longDate(inv.period_end, 'en')}.`] };
}

function reminderEmail(l: Locale, org: string, kind: ReminderKind, date: string, s: BillingState, appUrl: string, orgId: string) {
  const link = `${appUrl}/billing/${orgId}`;
  const plan = PLAN_NAME[l][(s.current?.plan ?? s.trial?.plan)!];
  const grace = longDate(plusDays(date, GRACE_DAYS), l);
  const d = longDate(date, l);
  if (l === 'ar') {
    const cta = kind === 'trial' ? 'اختيار باقة' : 'تجديد الاشتراك';
    if (kind === 'trial') return { subject: `تنتهي الفترة التجريبية قريبًا: ${org}`, cta, link, lines: [`تنتهي الفترة التجريبية لباقة ${plan} في ${d}. اختر باقة للاستمرار، وإلا تنتقل المؤسسة إلى الباقة المجانية دون حذف أي بيانات.`] };
    if (kind === 'lapsed') return { subject: `انتهى الاشتراك: ${org}`, cta, link, lines: [`انتهى اشتراك ${plan} في ${d}. جدّد قبل ${grace} للاحتفاظ بالباقة، وإلا تنتقل المؤسسة إلى الباقة المجانية دون حذف أي بيانات.`] };
    return { subject: `جدّد اشتراكك: ${org}`, cta, link, lines: [`ينتهي اشتراك ${plan} في ${d}. لا يوجد تجديد تلقائي، لذا جدّد من صفحة الفوترة.`] };
  }
  const cta = kind === 'trial' ? 'Choose a plan' : 'Renew now';
  if (kind === 'trial') return { subject: `Your trial ends soon: ${org}`, cta, link, lines: [`Your ${plan} trial ends on ${d}. Choose a plan to keep it; otherwise the organisation moves to Free. No data is deleted.`] };
  if (kind === 'lapsed') return { subject: `Your subscription has ended: ${org}`, cta, link, lines: [`Your ${plan} subscription ended on ${d}. Renew by ${grace} to keep the plan; after that the organisation moves to Free. No data is deleted.`] };
  return { subject: `Time to renew: ${org}`, cta, link, lines: [`Your ${plan} subscription ends on ${d}. Nothing renews automatically, so renew from the billing page.`] };
}

// ---- the invoice document ----

/** ZATCA's QR code for e-invoices (phase 1): seller, VAT number, time, total and VAT as TLV, base64. */
export function zatcaTlv(f: { seller: string; vatNumber: string; time: Date; total: number; vat: number }): string {
  const parts = [f.seller, f.vatNumber, f.time.toISOString().replace(/\.\d{3}Z$/, 'Z'), (f.total / 100).toFixed(2), (f.vat / 100).toFixed(2)];
  return Buffer.concat(parts.flatMap((v, i) => {
    const b = Buffer.from(v, 'utf8');
    return [Buffer.from([i + 1, b.length]), b];
  })).toString('base64');
}

const KIND = {
  en: { new: 'Subscription', renew: 'Renewal', upgrade: 'Plan change (remaining days)' },
  ar: { new: 'اشتراك', renew: 'تجديد', upgrade: 'تغيير الباقة (الأيام المتبقية)' },
} as const;

/**
 * A paid invoice as a printable page, in English and Arabic side by side. A "Tax invoice" with VAT and
 * the QR code when the seller was VAT registered at the time; a plain invoice without VAT otherwise.
 */
export async function renderInvoice(inv: InvoiceRow): Promise<string> {
  const s = inv.seller!;
  const b = inv.buyer!;
  // a tax invoice (title, VAT number, QR code) needs the seller's VAT number; VAT itself is shown whenever it was charged
  const taxed = !!s.vatNumber;
  const vatCharged = Number(inv.vat_rate) > 0;
  const issued = inv.paid_at!;
  const qr = taxed ? await QRCode.toString(zatcaTlv({ seller: s.name, vatNumber: s.vatNumber!, time: issued, total: inv.total, vat: inv.vat }), { type: 'svg', margin: 0, width: 132 }) : '';
  const num = `INV-${String(inv.number).padStart(6, '0')}`;
  const row = (en: string, ar: string, v: string) => `<tr><th>${esc(en)}</th><td dir="auto">${v}</td><th class="ar" lang="ar">${esc(ar)}</th></tr>`;
  const description = `${PLAN_NAME.en[inv.plan]} plan — ${KIND.en[inv.kind]}, ${inv.seats} × ${inv.interval === 'month' ? 'month' : 'year'}`;
  const descriptionAr = `باقة ${PLAN_NAME.ar[inv.plan]} — ${KIND.ar[inv.kind]}، ${inv.seats} × ${inv.interval === 'month' ? 'شهر' : 'سنة'}`;
  const vatPct = Number(inv.vat_rate);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${num}</title><style>
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color:#0D1821;background:#F3F5F6;margin:0;padding:24px}
.doc{max-width:820px;margin:0 auto;background:#fff;border:1px solid #DCE2E6;border-radius:8px;padding:32px}
h1{font-size:22px;margin:0}.hd{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #08776C;padding-bottom:16px;margin-bottom:16px}
.ar{direction:rtl;text-align:right;font-family:Tahoma,"Segoe UI",Arial,sans-serif}.ar.l{text-align:left}table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:6px 8px;border-bottom:1px solid #E7ECEF;text-align:left;vertical-align:top}th{color:#46535E;font-weight:600;width:28%}th.ar{text-align:right}
.lines td,.lines th{width:auto}.num{text-align:right;white-space:nowrap}.tot td{font-weight:700;font-size:16px}.muted{color:#46535E;font-size:12px}
.qr svg{display:block}.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}.print{margin:16px auto;max-width:820px;text-align:right}
button{font:inherit;padding:6px 14px;border:1px solid #08776C;background:#08776C;color:#fff;border-radius:6px;cursor:pointer}
@media print{body{background:#fff;padding:0}.doc{border:0}.print{display:none}}@media (max-width:640px){.cols{grid-template-columns:1fr}.doc{padding:16px}}
</style></head><body>
<div class="print"><button type="button">Print / Save as PDF · طباعة</button></div>
<div class="doc">
<div class="hd"><div><h1>${taxed ? 'Tax invoice' : 'Invoice'}</h1><div class="ar l" lang="ar" style="font-size:20px;font-weight:700">${taxed ? 'فاتورة ضريبية' : 'فاتورة'}</div></div>
${taxed ? `<div class="qr">${qr}</div>` : ''}</div>
<table>
${row('Invoice number', 'رقم الفاتورة', `<span dir="ltr">${num}</span>`)}
${row('Date of issue', 'تاريخ الإصدار', `<span dir="ltr">${issued.toISOString().slice(0, 10)}</span>`)}
${row('Service period', 'فترة الخدمة', `<span dir="ltr">${inv.period_start} → ${toIso(toDay(inv.period_end)! - 1)}</span>`)}
${row('Payment', 'الدفع', 'Moyasar')}
</table>
<div class="cols">
<div><b>Seller · البائع</b><div>${esc(s.name)}</div><div class="ar l" lang="ar">${esc(s.nameAr)}</div>${s.address ? `<div>${esc(s.address)}</div>` : ''}
${s.cr ? `<div>CR · السجل التجاري: <span dir="ltr">${esc(s.cr)}</span></div>` : ''}${taxed ? `<div>VAT · الرقم الضريبي: <span dir="ltr">${esc(s.vatNumber!)}</span></div>` : ''}</div>
<div><b>Customer · العميل</b><div dir="auto">${esc(b.name || b.organisation)}</div>${b.name ? `<div dir="auto">${esc(b.organisation)}</div>` : ''}
${b.address ? `<div dir="auto">${esc(b.address)}</div>` : ''}${b.vatNumber ? `<div>VAT · الرقم الضريبي: <span dir="ltr">${esc(b.vatNumber)}</span></div>` : ''}</div>
</div>
<table class="lines"><thead><tr><th>Description · الوصف</th><th class="num">Amount · المبلغ</th></tr></thead><tbody>
<tr><td>${esc(description)}<div class="ar l" lang="ar">${esc(descriptionAr)}</div></td><td class="num">${sar(inv.subtotal)}</td></tr>
${vatCharged ? `<tr><td>VAT ${vatPct}% · ضريبة القيمة المضافة ${vatPct}٪</td><td class="num">${sar(inv.vat)}</td></tr>` : ''}
<tr class="tot"><td>Total · الإجمالي</td><td class="num">${sar(inv.total)}</td></tr></tbody></table>
${vatCharged ? '' : '<p class="muted">The seller is not registered for VAT; no VAT is charged. · البائع غير مسجل في ضريبة القيمة المضافة، ولا تُحتسب ضريبة.</p>'}
</div><script>${INVOICE_SCRIPT}</script></body></html>`;
}

/** The invoice page's only script, allowed by its hash in the page's content security policy. */
const INVOICE_SCRIPT = "document.querySelector('.print button').addEventListener('click', function () { print(); });";
export const INVOICE_CSP = cspWithScript(INVOICE_SCRIPT);
