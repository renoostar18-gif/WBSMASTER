import { toIso, todayDay } from '@wbs-master/engine';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser } from '../app.js';
import {
  BillingRuleError, type BillingContext, INVOICE_CSP, type InvoiceRow, MAX_SEATS, TRIAL_DAYS, VAT_RATE, billableMembers, loadBillingState, quote,
  renderInvoice, seatPrice, settleInvoice, syncPlan,
} from '../billing.js';
import { tx } from '../db.js';
import { ApiError, badRequest, conflict, notFound } from '../errors.js';
import { Moyasar, MoyasarError, invoiceIdsIn, secretMatches } from '../moyasar.js';
import { orgAccess } from '../permissions.js';

type O = { Params: { orgId: string } };
const choice = z.object({
  plan: z.enum(['team', 'business']),
  interval: z.enum(['month', 'year']),
  seats: z.number().int().min(1).max(MAX_SEATS),
  renew: z.boolean().optional(),
});

/** Billing (spec 3.4): owners see the plan, start a trial, and pay through Moyasar's hosted page. */
export const billingRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  const m = deps.config.moyasar;
  const gateway = deps.gateway ?? (m ? new Moyasar(m.secretKey, m.apiUrl) : null);
  const ctx: BillingContext = {
    db: deps.db, gateway, seller: deps.config.seller, mailer: deps.mailer, appUrl: deps.config.appUrl, today: () => deps.today?.() ?? new Date(),
  };
  const today = () => toIso(todayDay(ctx.today()))!;
  const vatEnabled = deps.config.vatEnabled;

  /** Billing belongs to owners (spec 2); not through API keys. */
  async function owner(req: Parameters<typeof requireUser>[0], orgId: string) {
    const user = requireUser(req);
    if (user.apiKey) throw new ApiError(403, 'not_with_api_key');
    await orgAccess(deps.db, user, orgId, 'owner');
    return user;
  }

  /** The quote for a choice, checked against the organisation's members. */
  async function priced(orgId: string, body: unknown) {
    const b = parse(choice, body);
    const state = await loadBillingState(deps.db, orgId, today());
    if (state.comped) throw conflict('billing_comped');
    if (b.seats < await billableMembers(deps.db, orgId)) throw badRequest('billing_seats_below_members');
    try {
      return { state, q: quote(state, b, today(), vatEnabled) };
    } catch (e) {
      if (e instanceof BillingRuleError) throw conflict(e.code);
      throw e;
    }
  }

  app.get<O>('/orgs/:orgId/billing', async req => {
    await owner(req, req.params.orgId);
    const orgId = req.params.orgId;
    const state = await syncPlan(deps.db, orgId, today());
    const o = (await deps.db.query<{ trial_ends: string | null; billing_name: string | null; billing_address: string | null; billing_vat_number: string | null; billing_email: string | null }>(
      'select trial_ends, billing_name, billing_address, billing_vat_number, billing_email from organisations where id = $1', [orgId])).rows[0]!;
    const invoices = await deps.db.query<InvoiceRow>(
      "select * from billing_invoices where org_id = $1 and (status = 'paid' or (status = 'pending' and created_at > now() - interval '1 day')) order by created_at desc limit 100", [orgId]);
    return {
      plan: state.plan, seats: state.seats, members: await billableMembers(deps.db, orgId),
      current: state.current && { plan: state.current.plan, interval: state.current.interval, seats: state.current.seats, periodStart: state.current.period_start, periodEnd: state.current.period_end },
      paidUntil: state.paidUntil, inGrace: state.inGrace, renewed: state.renewed,
      trial: state.trial, trialAvailable: !o.trial_ends && !state.current && !state.comped, trialDays: TRIAL_DAYS, comped: !!state.comped,
      payments: !!gateway, vatRate: vatEnabled ? VAT_RATE : 0,
      prices: { team: { month: seatPrice('team', 'month'), year: seatPrice('team', 'year') }, business: { month: seatPrice('business', 'month'), year: seatPrice('business', 'year') } },
      profile: { name: o.billing_name ?? '', address: o.billing_address ?? '', vatNumber: o.billing_vat_number ?? '', email: o.billing_email ?? '' },
      invoices: invoices.rows.map(i => ({
        id: i.id, number: i.number, status: i.status, kind: i.kind, plan: i.plan, interval: i.interval, seats: i.seats,
        periodStart: i.period_start, periodEnd: i.period_end, total: i.total, createdAt: i.created_at, paidAt: i.paid_at,
        payUrl: i.status === 'pending' ? i.pay_url : null,
      })),
    };
  });

  app.put<O>('/orgs/:orgId/billing/profile', async req => {
    await owner(req, req.params.orgId);
    const b = parse(z.object({
      name: z.string().trim().max(200), address: z.string().trim().max(500),
      vatNumber: z.string().trim().max(30).regex(/^[0-9A-Za-z -]*$/), email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]),
    }), req.body);
    await deps.db.query('update organisations set billing_name = $2, billing_address = $3, billing_vat_number = $4, billing_email = $5, updated_at = now() where id = $1',
      [req.params.orgId, b.name || null, b.address || null, b.vatNumber || null, b.email || null]);
    return { ok: true };
  });

  /** One free trial per organisation (spec 3.4: Team and Business start with a 14-day trial). */
  app.post<O>('/orgs/:orgId/billing/trial', async req => {
    await owner(req, req.params.orgId);
    const { plan } = parse(z.object({ plan: z.enum(['team', 'business']) }), req.body);
    const ends = toIso(todayDay(ctx.today()) + TRIAL_DAYS)!;
    await tx(deps.db, async c => {
      const o = (await c.query<{ trial_ends: string | null }>('select trial_ends from organisations where id = $1 for update', [req.params.orgId])).rows[0]!;
      if (o.trial_ends) throw conflict('trial_used');
      if ((await loadBillingState(c, req.params.orgId, today())).current) throw conflict('trial_paid_plan');
      await c.query('update organisations set trial_plan = $2, trial_ends = $3 where id = $1', [req.params.orgId, plan, ends]);
      await syncPlan(c, req.params.orgId, today());
    });
    return { plan, ends };
  });

  app.post<O>('/orgs/:orgId/billing/quote', async req => {
    await owner(req, req.params.orgId);
    return (await priced(req.params.orgId, req.body)).q;
  });

  /** Make a Moyasar invoice for the choice and return its payment page. Other unpaid checkouts are cancelled. */
  app.post<O>('/orgs/:orgId/billing/checkout', async req => {
    const user = await owner(req, req.params.orgId);
    if (!gateway) throw new ApiError(503, 'payments_unavailable');
    const orgId = req.params.orgId;
    const { q } = await priced(orgId, req.body);
    const old = await deps.db.query<{ id: string; moyasar_id: string | null }>(
      "update billing_invoices set status = 'canceled' where org_id = $1 and status = 'pending' returning id, moyasar_id", [orgId]);
    for (const o of old.rows) if (o.moyasar_id) await gateway.cancelInvoice(o.moyasar_id).catch(() => {});
    const inv = (await deps.db.query<{ id: string }>(
      `insert into billing_invoices (org_id, kind, plan, interval, seats, period_start, period_end, subtotal, vat_rate, vat, total, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [orgId, q.kind, q.plan, q.interval, q.seats, q.periodStart, q.periodEnd, q.subtotal, q.vatRate, q.vat, q.total, user.id])).rows[0]!;
    const org = (await deps.db.query<{ name: string }>('select name from organisations where id = $1', [orgId])).rows[0]!;
    const base = deps.config.appUrl;
    try {
      const mi = await gateway.createInvoice({
        amount: q.total, currency: 'SAR',
        description: `WBS Master ${q.plan === 'team' ? 'Team' : 'Business'} — ${q.seats} × ${q.interval} — ${org.name}`.slice(0, 255),
        callbackUrl: `${base}/api/billing/moyasar/notify`,
        successUrl: `${base}/api/billing/return?invoice=${inv.id}`,
        backUrl: `${base}/billing/${orgId}`,
        expiredAt: new Date(ctx.today().getTime() + 86_400_000),
        metadata: { invoice: inv.id, org: orgId },
      });
      await deps.db.query('update billing_invoices set moyasar_id = $2, pay_url = $3 where id = $1', [inv.id, mi.id, mi.url]);
      return { id: inv.id, url: mi.url, quote: q };
    } catch (e) {
      await deps.db.query("update billing_invoices set status = 'failed' where id = $1", [inv.id]);
      if (e instanceof MoyasarError) {
        console.error(e.message);
        throw new ApiError(502, 'payments_failed');
      }
      throw e;
    }
  });

  /** Moyasar sends the customer back here after paying. Check with Moyasar, then show the billing page. */
  app.get<{ Querystring: { invoice?: string } }>('/billing/return', async (req, reply) => {
    const id = req.query.invoice ?? '';
    const row = /^[0-9a-f-]{36}$/.test(id)
      ? (await deps.db.query<{ org_id: string }>('select org_id from billing_invoices where id = $1', [id])).rows[0]
      : undefined;
    if (!row) return reply.redirect('/');
    const status = await settleInvoice(ctx, id).catch(e => { console.error('billing return: could not check', id, e); return 'pending' as const; });
    return reply.redirect(`/billing/${row.org_id}?payment=${status === 'paid' ? 'paid' : status === 'pending' ? 'pending' : 'failed'}`);
  });

  /**
   * Moyasar's notifications: the payment webhook and the invoice callback. Nothing in the body is
   * trusted: it only says which checkout to look up with Moyasar. A webhook with the wrong secret is refused.
   */
  app.post('/billing/moyasar/notify', async (req, reply) => {
    const secret = m?.webhookSecret;
    const body = req.body as Record<string, unknown> | null;
    if (secret && body && 'secret_token' in body && !secretMatches(body, secret)) throw new ApiError(401, 'invalid_secret');
    const ids = invoiceIdsIn(body);
    if (!ids.length) return reply.status(200).send({ ok: true });
    const r = await deps.db.query<{ id: string }>("select id from billing_invoices where moyasar_id = any($1::text[]) and status <> 'paid'", [ids]);
    for (const { id } of r.rows) await settleInvoice(ctx, id);
    return { ok: true };
  });

  app.get<O & { Params: { invoiceId: string } }>('/orgs/:orgId/billing/invoices/:invoiceId', async (req, reply) => {
    await owner(req, req.params.orgId);
    const inv = (await deps.db.query<InvoiceRow>("select * from billing_invoices where id = $1 and org_id = $2 and status = 'paid'",
      [req.params.invoiceId, req.params.orgId])).rows[0];
    if (!inv) throw notFound('invoice_not_found');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'private, no-store').header('content-security-policy', INVOICE_CSP)
      .send(await renderInvoice(inv));
  });
};
