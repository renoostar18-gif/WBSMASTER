import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { type MessageKey, useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar, useToast } from '../ui.js';

type PaidPlan = 'team' | 'business';
type Interval = 'month' | 'year';
interface Invoice {
  id: string; number: number | null; status: 'pending' | 'paid'; kind: 'new' | 'renew' | 'upgrade'; plan: PaidPlan; interval: Interval; seats: number;
  periodStart: string; periodEnd: string; total: number; createdAt: string; paidAt: string | null; payUrl: string | null;
}
interface Billing {
  plan: 'free' | PaidPlan; seats: number | null; members: number;
  current: { plan: PaidPlan; interval: Interval; seats: number; periodStart: string; periodEnd: string } | null;
  paidUntil: string | null; inGrace: boolean; renewed: boolean;
  trial: { plan: PaidPlan; ends: string } | null; trialAvailable: boolean; trialDays: number;
  payments: boolean; vatRate: number; comped: boolean;
  prices: Record<PaidPlan, Record<Interval, number>>;
  profile: { name: string; address: string; vatNumber: string; email: string };
  invoices: Invoice[];
}
interface Quote { kind: 'new' | 'renew' | 'upgrade'; periodStart: string; periodEnd: string; subtotal: number; vatRate: number; vat: number; total: number }

/** The day before an exclusive end date, for "until" wording. */
const lastDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Plans and billing for an organisation's owners (spec 3.4): trial, checkout through Moyasar, invoices. */
export function BillingPage() {
  const { orgId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const { t, error, locale } = useI18n();
  const { me, refresh } = useSession();
  const toast = useToast();
  const org = me?.organisations.find(o => o.id === orgId);
  const [b, setB] = useState<Billing | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [plan, setPlan] = useState<PaidPlan>('team');
  const [interval, setInterval_] = useState<Interval>('year');
  const [seats, setSeats] = useState(1);
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState('');
  const [busy, setBusy] = useState(false);
  const payment = search.get('payment');

  const money = useCallback((halalas: number) => {
    const n = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(halalas / 100);
    return locale === 'ar' ? `${n} ر.س` : `SAR ${n}`;
  }, [locale]);
  const long = useCallback((iso: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`)), [locale]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Billing>(`/orgs/${orgId}/billing`);
      setB(r);
      return r;
    } catch (x) {
      setLoadErr(error(x instanceof ApiError ? x.code : 'server_error'));
      return null;
    }
  }, [orgId, error]);

  useEffect(() => {
    load().then(r => {
      if (!r) return;
      const c = r.current ?? (r.trial ? { plan: r.trial.plan, interval: 'year' as const, seats: r.members } : null);
      if (c) { setPlan(c.plan); setInterval_(c.interval); }
      setSeats(Math.max(r.members, r.current?.seats ?? 0, 1));
    });
  }, [load]);
  // the plan may have changed (paid, trial): refresh the session's copy for badges and limits
  useEffect(() => { if (payment) refresh(); }, [payment, refresh]);

  // price the current choice as it changes
  useEffect(() => {
    if (!b) return;
    let stale = false;
    setQErr('');
    const id = setTimeout(() => {
      api.post<Quote>(`/orgs/${orgId}/billing/quote`, { plan, interval, seats }).then(
        r => { if (!stale) setQ(r); },
        x => { if (!stale) { setQ(null); setQErr(error(x instanceof ApiError ? x.code : 'server_error')); } });
    }, 200);
    return () => { stale = true; clearTimeout(id); };
  }, [b, orgId, plan, interval, seats, error]);

  async function checkout(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/orgs/${orgId}/billing/checkout`, body);
      window.location.assign(r.url);
    } catch (x) {
      toast(error(x instanceof ApiError ? x.code : 'server_error'));
      setBusy(false);
    }
  }

  async function startTrial(p: PaidPlan) {
    try {
      await api.post(`/orgs/${orgId}/billing/trial`, { plan: p });
      await Promise.all([load(), refresh()]);
      toast(t('trialStarted'));
    } catch (x) { toast(error(x instanceof ApiError ? x.code : 'server_error')); }
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.put(`/orgs/${orgId}/billing/profile`, {
        name: String(f.get('name') ?? ''), address: String(f.get('address') ?? ''), vatNumber: String(f.get('vatNumber') ?? ''), email: String(f.get('email') ?? ''),
      });
      toast(t('billingDetailsSaved'));
    } catch (x) { toast(error(x instanceof ApiError ? x.code : 'server_error')); }
  }

  const top = <TopBar><Link className="btn" to="/">{t('projects')}</Link><Link className="btn" to="/settings">{t('accountSettings')}</Link></TopBar>;
  if (!b) return <div className="shell">{top}<div className="view"><div className="rep">{loadErr ? <p className="err" role="alert">{loadErr}</p> : <p className="hint">{t('loading')}</p>}</div></div></div>;

  const pending = b.invoices.find(i => i.status === 'pending' && i.payUrl);
  const paid = b.invoices.filter(i => i.status === 'paid');
  const status = b.comped ? t('billingComped', { plan: t(`plan_${b.plan}` as MessageKey) }) : b.current
    ? b.inGrace
      ? t('billingGrace', { plan: t(`plan_${b.current.plan}`), date: long(lastDay(b.paidUntil!)) })
      : t('billingPaid', { plan: t(`plan_${b.current.plan}`), n: b.current.seats, date: long(lastDay(b.paidUntil!)) })
    : b.trial ? t('billingTrial', { plan: t(`plan_${b.trial.plan}`), date: long(lastDay(b.trial.ends)) }) : t('billingFree');
  const perMonth = (p: PaidPlan, i: Interval) => (i === 'month' ? b.prices[p].month : Math.round(b.prices[p].year / 12));

  return (
    <div className="shell">
      {top}
      <div className="view">
        <div className="rep billing">
          <div className="rep-head"><div><h1>{t('billing')}</h1><div className="crumb" dir="auto">{org?.name}</div></div>
            <span className="badge">{t(`plan_${b.plan}` as MessageKey)}</span></div>

          {payment && (
            <div className={`notice ${payment === 'paid' ? 'ok' : payment === 'failed' ? 'bad' : ''}`} role="status">
              <span>{t(payment === 'paid' ? 'paymentPaid' : payment === 'failed' ? 'paymentFailed' : 'paymentPending')}</span>
              <button className="btn sm" onClick={() => { search.delete('payment'); setSearch(search, { replace: true }); }}>{t('close')}</button>
            </div>
          )}

          <div className={`sec plan-status${b.inGrace ? ' warn' : ''}`}>
            <h2>{t('currentPlan')}</h2>
            <p>{status}</p>
            {b.current && !b.renewed && !b.comped && (
              <div className="row-form">
                <button className="btn primary" disabled={!b.payments || busy}
                  onClick={() => checkout({ plan: b.current!.plan, interval: b.current!.interval, seats: Math.max(b.current!.seats, b.members), renew: true })}>
                  {t('renewNow')}
                </button>
                <span className="hint">{t('noAutoRenew')}</span>
              </div>
            )}
            {b.renewed && <p className="hint">{t('alreadyRenewed', { date: long(lastDay(b.paidUntil!)) })}</p>}
            {pending && <p><a className="btn" href={pending.payUrl!}>{t('continuePayment', { amount: money(pending.total) })}</a></p>}
          </div>

          {b.trialAvailable && (
            <div className="sec">
              <h2>{t('freeTrial')}</h2>
              <p className="hint">{t('freeTrialHint', { n: b.trialDays })}</p>
              <div className="row-form">
                <button className="btn" onClick={() => startTrial('team')}>{t('tryPlan', { plan: t('plan_team'), n: b.trialDays })}</button>
                <button className="btn" onClick={() => startTrial('business')}>{t('tryPlan', { plan: t('plan_business'), n: b.trialDays })}</button>
              </div>
            </div>
          )}

          {!b.comped && <div className="sec">
            <div className="sec-head">
              <h2>{b.current ? t('changePlan') : t('choosePlan')}</h2>
              <div className="seg" role="group" aria-label={t('billingInterval')}>
                <button aria-pressed={interval === 'month'} onClick={() => setInterval_('month')}>{t('monthly')}</button>
                <button aria-pressed={interval === 'year'} onClick={() => setInterval_('year')}>{t('annual')}</button>
              </div>
            </div>
            <div className="plans" role="radiogroup" aria-label={t('plan')}>
              {(['team', 'business'] as const).map(p => (
                <label key={p} className={`plan-card${plan === p ? ' on' : ''}`}>
                  <input type="radio" name="plan" value={p} checked={plan === p} onChange={() => setPlan(p)} />
                  <b>{t(`plan_${p}`)}</b>
                  <span className="price">{money(perMonth(p, interval))} <small>{t('perSeatMonth')}{b.vatRate > 0 ? ` ${t('plusVat', { rate: b.vatRate })}` : ''}</small></span>
                  <span className="hint">{interval === 'year' ? t('billedYearly', { amount: money(b.prices[p].year) }) : t('billedMonthly')}</span>
                  <span className="hint">{t(`planPitch_${p}`)}</span>
                </label>
              ))}
            </div>
            <div className="row-form">
              <label className="fld"><span>{t('seats')}</span>
                <input type="number" min={Math.max(1, b.members)} max={5000} value={seats} onChange={e => setSeats(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
              <span className="hint">{t('seatsHint', { n: b.members })}</span>
            </div>
            {qErr && <p className="err" role="alert">{qErr}</p>}
            {q && (
              <div className="quote">
                <div>{t(`quote_${q.kind}`, { start: long(q.periodStart), end: long(lastDay(q.periodEnd)) })}</div>
                {q.vatRate > 0 && <div className="hint">{t('quoteVat', { subtotal: money(q.subtotal), rate: q.vatRate, vat: money(q.vat) })}</div>}
                <div className="row-form">
                  <button className="btn primary" disabled={!b.payments || busy} onClick={() => checkout({ plan, interval, seats })}>{t('payWithMoyasar', { amount: money(q.total) })}</button>
                  <span className="hint">{t('paymentMethods')}</span>
                </div>
              </div>
            )}
            {!b.payments && <p className="hint" role="note">{t('paymentsOff')}</p>}
          </div>}

          <div className="sec">
            <h2>{t('billingDetails')}</h2>
            <p className="hint">{t('billingDetailsHint')}</p>
            <form className="row-form" onSubmit={saveProfile}>
              <label className="fld grow"><span>{t('billingName')}</span><input name="name" defaultValue={b.profile.name} maxLength={200} dir="auto" placeholder={org?.name} /></label>
              <label className="fld grow"><span>{t('billingAddress')}</span><input name="address" defaultValue={b.profile.address} maxLength={500} dir="auto" /></label>
              <label className="fld"><span>{t('customerVat')}</span><input name="vatNumber" defaultValue={b.profile.vatNumber} maxLength={30} dir="ltr" /></label>
              <label className="fld"><span>{t('billingEmail')}</span><input name="email" type="email" defaultValue={b.profile.email} maxLength={254} dir="ltr" /></label>
              <button className="btn" type="submit">{t('save')}</button>
            </form>
          </div>

          <div className="sec">
            <h2>{t('invoices')}</h2>
            {paid.length ? (
              <div className="rt-wrap"><table className="rt">
                <thead><tr><th>{t('invoiceNumber')}</th><th>{t('invoiceDate')}</th><th>{t('description')}</th><th>{t('amount')}</th><th /></tr></thead>
                <tbody>{paid.map(i => (
                  <tr key={i.id}>
                    <td dir="ltr" className="nw">INV-{String(i.number).padStart(6, '0')}</td>
                    <td className="nw">{long(i.paidAt!.slice(0, 10))}</td>
                    <td>{t(`kind_${i.kind}`, { plan: t(`plan_${i.plan}`), n: i.seats })} · {long(i.periodStart)} – {long(lastDay(i.periodEnd))}</td>
                    <td className="nw">{money(i.total)}</td>
                    <td><a className="btn sm" href={`/api/orgs/${orgId}/billing/invoices/${i.id}`} target="_blank" rel="noreferrer">{t('openInvoice')}</a></td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="hint">{t('noInvoices')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
