import { randomBytes } from 'node:crypto';
import { type IncomingMessage, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BillingState, type InvoiceRow, type PaidPeriod, addInterval, billingState, quote, renderInvoice, seatPrice, zatcaTlv,
} from '../src/billing.js';
import { Client, TODAY, type TestApp, startApp } from './setup.js';

/** A stand-in for Moyasar's invoice API: checks the key, keeps invoices, and "pays" them on request. */
async function fakeMoyasar() {
  const invoices = new Map<string, Record<string, unknown>>();
  const auth = `Basic ${Buffer.from('sk_test_123:').toString('base64')}`;
  const body = (req: IncomingMessage) => new Promise<string>(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => r(b)); });
  const server = createServer(async (req, res) => {
    const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.headers.authorization !== auth) return json(401, { type: 'authentication_error' });
    const [, , id, action] = req.url!.split('/');
    if (req.method === 'POST' && req.url === '/invoices') {
      const b = JSON.parse(await body(req));
      if (!Number.isInteger(b.amount) || b.amount < 100 || !b.description) return json(400, { type: 'invalid_request_error' });
      const inv = { ...b, id: randomBytes(8).toString('hex'), status: 'initiated', url: `https://checkout.moyasar.test/invoices/${invoices.size}` };
      invoices.set(inv.id, inv);
      return json(201, inv);
    }
    const inv = id ? invoices.get(id) : undefined;
    if (!inv) return json(404, { type: 'not_found' });
    if (req.method === 'GET') return json(200, inv);
    if (req.method === 'PUT' && action === 'cancel') { inv.status = 'canceled'; return json(200, inv); }
    json(404, {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    invoices,
    latest: () => [...invoices.values()].at(-1)!,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}

const day = (iso: string) => new Date(`${iso}T09:00:00Z`);
const period = (p: Partial<PaidPeriod>): PaidPeriod => ({
  id: 'x', plan: 'team', interval: 'month', seats: 2, period_start: '2026-10-01', period_end: '2026-11-01', paid_at: day('2026-10-01'), ...p,
});

describe('prices and periods', () => {
  it('prices seats in halalas: SAR 45 and 90 a month, 20% off a year', () => {
    expect(seatPrice('team', 'month')).toBe(4500);
    expect(seatPrice('business', 'month')).toBe(9000);
    expect(seatPrice('team', 'year')).toBe(43_200);
    expect(seatPrice('business', 'year')).toBe(86_400);
  });

  it('adds months and years, keeping to the end of short months', () => {
    expect(addInterval('2026-10-22', 'month')).toBe('2026-11-22');
    expect(addInterval('2026-12-15', 'month')).toBe('2027-01-15');
    expect(addInterval('2027-01-31', 'month')).toBe('2027-02-28');
    expect(addInterval('2028-02-29', 'year')).toBe('2029-02-28');
  });

  it('works out the plan in force: trial, paid period, grace days, then Free', () => {
    const trial = { plan: 'business' as const, ends: '2026-10-25' };
    expect(billingState([], trial, '2026-10-22')).toMatchObject({ plan: 'business', seats: null, trial });
    expect(billingState([], trial, '2026-10-25').plan).toBe('free');
    const p = period({});
    expect(billingState([p], trial, '2026-10-22')).toMatchObject({ plan: 'team', seats: 2, paidUntil: '2026-11-01', inGrace: false, trial: null });
    expect(billingState([p], { plan: null, ends: null }, '2026-11-03')).toMatchObject({ plan: 'team', inGrace: true });
    expect(billingState([p], { plan: null, ends: null }, '2026-11-08').plan).toBe('free');
    // a later payment for the same days (an upgrade) wins
    const up = period({ plan: 'business', seats: 5, period_start: '2026-10-15', paid_at: day('2026-10-15') });
    expect(billingState([p, up], { plan: null, ends: null }, '2026-10-22')).toMatchObject({ plan: 'business', seats: 5 });
    expect(billingState([p, up], { plan: null, ends: null }, '2026-10-10')).toMatchObject({ plan: 'team', seats: 2 });
    const next = period({ period_start: '2026-11-01', period_end: '2026-12-01', paid_at: day('2026-10-20') });
    expect(billingState([p, next], { plan: null, ends: null }, '2026-10-22')).toMatchObject({ renewed: true, paidUntil: '2026-12-01' });
  });

  it('quotes a new period, an upgrade for the days left, and a renewal', () => {
    const free = billingState([], { plan: null, ends: null }, '2026-10-22');
    expect(quote(free, { plan: 'team', interval: 'year', seats: 3 }, '2026-10-22', false)).toMatchObject({
      kind: 'new', periodStart: '2026-10-22', periodEnd: '2027-10-22', subtotal: 129_600, vat: 0, total: 129_600,
    });
    const paid = billingState([period({})], { plan: null, ends: null }, '2026-10-22');
    // 10 of 31 days left; (2 × 90 − 2 × 45) × 10 / 31 = SAR 29.03
    expect(quote(paid, { plan: 'business', interval: 'month', seats: 2 }, '2026-10-22', false)).toMatchObject({
      kind: 'upgrade', periodStart: '2026-10-22', periodEnd: '2026-11-01', subtotal: 2903,
    });
    expect(quote(paid, { plan: 'team', interval: 'month', seats: 1 }, '2026-10-22', false)).toMatchObject({
      kind: 'renew', periodStart: '2026-11-01', periodEnd: '2026-12-01', subtotal: 4500,
    });
    expect(quote(paid, { plan: 'team', interval: 'month', seats: 4, renew: true }, '2026-10-22', false).kind).toBe('renew');
    expect(quote(paid, { plan: 'team', interval: 'year', seats: 2 }, '2026-10-22', true)).toMatchObject({
      kind: 'renew', periodEnd: '2027-11-01', subtotal: 86_400, vatRate: 15, vat: 12_960, total: 99_360,
    });
    const renewed = { ...paid, renewed: true } as BillingState;
    expect(() => quote(renewed, { plan: 'team', interval: 'month', seats: 2 }, '2026-10-22', false)).toThrow('billing_already_renewed');
  });

  it('encodes the ZATCA QR fields as TLV', () => {
    const raw = Buffer.from(zatcaTlv({ seller: 'Acme', vatNumber: '300000000000003', time: new Date('2026-10-22T09:00:00Z'), total: 5175, vat: 675 }), 'base64');
    const fields: string[] = [];
    for (let i = 0; i < raw.length;) { const len = raw[i + 1]!; fields.push(raw.subarray(i + 2, i + 2 + len).toString()); i += 2 + len; }
    expect(fields).toEqual(['Acme', '300000000000003', '2026-10-22T09:00:00Z', '51.75', '6.75']);
    expect(raw[0]).toBe(1);
  });

  it('prints a tax invoice with VAT and the QR code only when the seller is VAT registered', async () => {
    const inv = {
      id: 'i', org_id: 'o', number: 7, kind: 'new', plan: 'team', interval: 'month', seats: 1, period_start: '2026-10-22', period_end: '2026-11-22',
      subtotal: 4500, vat_rate: '15.00', vat: 675, total: 5175, currency: 'SAR', status: 'paid', moyasar_id: 'm', pay_url: null,
      seller: { name: 'Acme', nameAr: 'أكمي', address: 'Riyadh', cr: '1010', vatNumber: '300000000000003' },
      buyer: { organisation: 'Client Co', name: null, address: null, vatNumber: null, email: null },
      created_at: day('2026-10-22'), paid_at: day('2026-10-22'),
    } as InvoiceRow;
    const taxed = await renderInvoice(inv);
    expect(taxed).toContain('Tax invoice');
    expect(taxed).toContain('<svg');
    expect(taxed).toContain('INV-000007');
    const plain = await renderInvoice({ ...inv, vat_rate: '0', vat: 0, total: 4500, seller: { ...inv.seller!, vatNumber: null } });
    expect(plain).not.toContain('Tax invoice');
    expect(plain).not.toContain('<svg');
    expect(plain).toContain('not registered for VAT');
  });
});

describe('billing routes', () => {
  let t: TestApp;
  let moyasar: Awaited<ReturnType<typeof fakeMoyasar>>;
  let now = TODAY;
  let owner: Client;
  let orgId: string;

  beforeAll(async () => {
    moyasar = await fakeMoyasar();
    t = await startApp(
      { moyasar: { secretKey: 'sk_test_123', webhookSecret: 'whsec', apiUrl: moyasar.url }, seller: { name: 'WBS Master Co', nameAr: 'دبليو بي إس ماستر', address: 'Riyadh', cr: '1010101010', vatNumber: null } },
      { today: () => now },
    );
    ({ client: owner, orgId } = await Client.signUp(t.app, 'Owner'));
  });
  afterAll(async () => { await t.close(); await moyasar.close(); });

  const notify = (b: unknown) => t.app.inject({ method: 'POST', url: '/api/billing/moyasar/notify', payload: b as object });
  /** The customer pays on Moyasar's page; Moyasar sends its webhook. */
  async function pay(secret = 'whsec') {
    const inv = moyasar.latest();
    inv.status = 'paid';
    return notify({ id: 'evt', type: 'payment_paid', secret_token: secret, data: { id: 'pay_1', status: 'paid', amount: inv.amount, invoice_id: inv.id } });
  }

  it('shows owners the plan and prices; others cannot see billing', async () => {
    const r = await owner.get(`/api/orgs/${orgId}/billing`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ plan: 'free', members: 1, trialAvailable: true, payments: true, vatRegistered: false, prices: { team: { month: 4500 } } });
    const admin = await Client.signUp(t.app, 'Admin');
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'admin@example.com', role: 'admin' });
    expect((await admin.client.get(`/api/orgs/${orgId}/billing`)).status).toBe(403);
    expect((await admin.client.post(`/api/orgs/${orgId}/billing/checkout`, { plan: 'team', interval: 'month', seats: 2 })).status).toBe(403);
  });

  it('starts one 14-day trial', async () => {
    const r = await owner.post(`/api/orgs/${orgId}/billing/trial`, { plan: 'business' });
    expect(r.body).toEqual({ plan: 'business', ends: '2026-11-05' });
    expect((await owner.get('/api/me')).body.organisations[0].plan).toBe('business');
    expect((await owner.post(`/api/orgs/${orgId}/billing/trial`, { plan: 'team' })).body.error).toBe('trial_used');
  });

  it('sends the owner to Moyasar and turns the plan on only once Moyasar says it is paid', async () => {
    expect((await owner.post(`/api/orgs/${orgId}/billing/checkout`, { plan: 'team', interval: 'month', seats: 1 })).body.error).toBe('billing_seats_below_members');
    const c = await owner.post(`/api/orgs/${orgId}/billing/checkout`, { plan: 'team', interval: 'month', seats: 2 });
    expect(c.status).toBe(200);
    expect(c.body.url).toMatch(/^https:\/\/checkout\.moyasar\.test\//);
    const sent = moyasar.latest();
    expect(sent).toMatchObject({ amount: 9000, currency: 'SAR', callback_url: 'https://app.example/api/billing/moyasar/notify', metadata: { invoice: c.body.id, org: orgId } });
    expect(sent.success_url).toBe(`https://app.example/api/billing/return?invoice=${c.body.id}`);

    // coming back before paying, or a notification while unpaid, changes nothing
    const back = await t.app.inject({ method: 'GET', url: `/api/billing/return?invoice=${c.body.id}` });
    expect(back.headers.location).toBe(`/billing/${orgId}?payment=pending`);
    await notify({ id: sent.id, status: 'paid' });
    expect((await owner.get(`/api/orgs/${orgId}/billing`)).body.plan).toBe('business'); // still the trial

    expect((await pay('wrong')).statusCode).toBe(401);
    expect((await pay()).statusCode).toBe(200);
    const b = (await owner.get(`/api/orgs/${orgId}/billing`)).body;
    expect(b).toMatchObject({ plan: 'team', seats: 2, paidUntil: '2026-11-22', trial: null, trialAvailable: false });
    expect(b.invoices[0]).toMatchObject({ number: 1, status: 'paid', total: 9000, periodStart: '2026-10-22', periodEnd: '2026-11-22' });
    expect(t.mail.sent.at(-1)!.subject).toBe('Payment received: Owner\'s workspace');

    // the browser coming back afterwards, and Moyasar repeating itself, do nothing more
    const again = await t.app.inject({ method: 'GET', url: `/api/billing/return?invoice=${c.body.id}` });
    expect(again.headers.location).toBe(`/billing/${orgId}?payment=paid`);
    await pay();
    expect((await owner.get(`/api/orgs/${orgId}/billing`)).body.invoices.filter((i: { status: string }) => i.status === 'paid')).toHaveLength(1);

    const doc = await t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/billing/invoices/${c.body.id}`, headers: { cookie: owner.cookie } });
    expect(doc.headers['content-type']).toContain('text/html');
    expect(doc.body).toContain('INV-000001');
    expect(doc.body).toContain('WBS Master Co');
    expect(doc.body).not.toContain('Tax invoice');
  });

  it('holds members to the paid seats; guests are free', async () => {
    await Client.signUp(t.app, 'Third');
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'third@example.com', role: 'member' })).body.error).toBe('plan_seat_limit');
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'third@example.com', role: 'guest' })).status).toBe(201);
    const third = (await owner.get(`/api/orgs/${orgId}/members`)).body.members.find((m: { email: string }) => m.email === 'third@example.com');
    expect((await owner.patch(`/api/orgs/${orgId}/members/${third.id}`, { role: 'member' })).body.error).toBe('plan_seat_limit');
  });

  it('charges a move up for the days left, and ignores a payment for the wrong amount', async () => {
    const q = await owner.post(`/api/orgs/${orgId}/billing/quote`, { plan: 'team', interval: 'month', seats: 3 });
    // one more seat for 31 of 31 days
    expect(q.body).toMatchObject({ kind: 'upgrade', periodStart: '2026-10-22', periodEnd: '2026-11-22', subtotal: 4500 });
    const first = await owner.post(`/api/orgs/${orgId}/billing/checkout`, { plan: 'team', interval: 'month', seats: 3 });
    const firstAtMoyasar = moyasar.latest();
    // a second checkout cancels the first, here and at Moyasar
    await owner.post(`/api/orgs/${orgId}/billing/checkout`, { plan: 'business', interval: 'month', seats: 3 });
    expect(firstAtMoyasar.status).toBe('canceled');
    expect((await owner.get(`/api/orgs/${orgId}/billing`)).body.invoices.some((i: { id: string }) => i.id === first.body.id)).toBe(false);

    const inv = moyasar.latest();
    expect(inv.amount).toBe(3 * 9000 - 2 * 4500);
    inv.status = 'paid';
    inv.amount = 100;
    await notify({ secret_token: 'whsec', data: { invoice_id: inv.id } });
    expect((await owner.get(`/api/orgs/${orgId}/billing`)).body.plan).toBe('team');
    inv.amount = 3 * 9000 - 2 * 4500;
    await notify({ secret_token: 'whsec', data: { invoice_id: inv.id } });
    expect((await owner.get(`/api/orgs/${orgId}/billing`)).body).toMatchObject({ plan: 'business', seats: 3, paidUntil: '2026-11-22' });
  });

  it('renews from the end of the period, once', async () => {
    const q = await owner.post(`/api/orgs/${orgId}/billing/quote`, { plan: 'business', interval: 'year', seats: 3 });
    expect(q.body).toMatchObject({ kind: 'renew', periodStart: '2026-11-22', periodEnd: '2027-11-22', total: 3 * 86_400 });
  });

  it('keeps a plan given free of charge (pilots), whatever the payments', async () => {
    const pilot = await Client.signUp(t.app, 'Pilot');
    await t.db.query("update organisations set comp_plan = 'business' where id = $1", [pilot.orgId]);
    const b = (await pilot.client.get(`/api/orgs/${pilot.orgId}/billing`)).body;
    expect(b).toMatchObject({ plan: 'business', comped: true, trialAvailable: false });
    expect((await pilot.client.post(`/api/orgs/${pilot.orgId}/billing/quote`, { plan: 'team', interval: 'month', seats: 1 })).body.error).toBe('billing_comped');
  });

  it('ends a lapsed plan after the grace days, with reminders on the way, and keeps extra projects read-only', async () => {
    const { runDailyBilling } = await import('../src/billing.js');
    const seller = { name: 'WBS Master Co', nameAr: 'دبليو بي إس ماستر', address: 'Riyadh', cr: null, vatNumber: null };
    const ctx = { db: t.db, gateway: null, seller, mailer: t.mail, appUrl: 'https://app.example', today: () => now };
    // four projects while on a paid plan
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C', 'D']) ids.push((await owner.post(`/api/orgs/${orgId}/projects`, { name: n })).body.id);

    const mails = () => t.mail.sent.map(m => m.subject);
    now = new Date('2026-11-16T05:00:00Z');
    await runDailyBilling(ctx);
    expect(mails().filter(s => s.startsWith('Time to renew'))).toHaveLength(1);
    await runDailyBilling(ctx);
    expect(mails().filter(s => s.startsWith('Time to renew'))).toHaveLength(1); // once

    now = new Date('2026-11-23T05:00:00Z');
    await runDailyBilling(ctx);
    expect(mails().filter(s => s.startsWith('Your subscription has ended'))).toHaveLength(1);
    expect((await owner.get('/api/me')).body.organisations[0].plan).toBe('business'); // grace days

    now = new Date('2026-11-29T05:00:00Z');
    expect((await runDailyBilling(ctx)).changed).toBe(1);
    expect((await owner.get('/api/me')).body.organisations[0].plan).toBe('free');

    // the oldest three projects stay editable; the fourth is read-only but can be archived
    const p4 = await owner.get(`/api/projects/${ids[3]}`);
    expect(p4.body.project.readOnly).toBe('plan');
    expect((await owner.get(`/api/projects/${ids[0]}`)).body.project.readOnly).toBeNull();
    expect((await owner.post(`/api/projects/${ids[3]}/ops`, { ops: [{ op: 'add', parentId: null, values: { name: 'x' } }] })).body.error).toBe('plan_project_read_only');
    expect((await owner.patch(`/api/projects/${ids[3]}`, { name: 'renamed' })).body.error).toBe('plan_project_read_only');
    expect((await owner.patch(`/api/projects/${ids[3]}`, { archived: true })).status).toBe(200);
  });
});
