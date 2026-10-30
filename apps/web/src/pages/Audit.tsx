import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { type MessageKey, useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar } from '../ui.js';

interface AuditEvent {
  id: number; action: string; target: string | null; details: Record<string, unknown>; ip: string | null;
  at: string; actorId: string | null; actorName: string | null;
}
interface AuditPage { events: AuditEvent[]; next: number | null; retentionDays: number | null; canExport: boolean }

const GROUPS = ['member', 'invitation', 'org', 'sso', 'api_key', 'webhook', 'billing', 'project'] as const;
const ROLES = new Set(['owner', 'admin', 'member', 'guest']);
const PLAN_NAMES = new Set(['free', 'team', 'business']);

/** The organisation's audit log for its admins (spec 2): who changed people, access, billing and projects. */
export function AuditPage() {
  const { orgId = '' } = useParams();
  const { t, error, date, locale } = useI18n();
  const { me } = useSession();
  const org = me?.organisations.find(o => o.id === orgId);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState<AuditPage | null>(null);
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async (before?: number) => {
    try {
      const q = new URLSearchParams({ ...(filter ? { action: filter } : {}), ...(before ? { before: String(before) } : {}) });
      const r = await api.get<AuditPage>(`/orgs/${orgId}/audit?${q}`);
      setPage(r);
      setRows(prev => (before ? [...prev, ...r.events] : r.events));
      setErr('');
    } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); }
  }, [orgId, filter, error]);
  useEffect(() => { load(); }, [load]);

  const when = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const role = (r: unknown) => (typeof r === 'string' && ROLES.has(r) ? t(`role_${r}` as MessageKey) : String(r ?? ''));
  const plan = (p: unknown) => (typeof p === 'string' && PLAN_NAMES.has(p) ? t(`plan_${p}` as MessageKey) : String(p ?? ''));
  const label = (a: string) => {
    const k = `au_${a.replace('.', '_')}`;
    const s = t(k as MessageKey);
    return s === k ? a : s;
  };
  /** A short reading of the event's details. */
  const details = (e: AuditEvent) => {
    const d = e.details ?? {};
    switch (e.action) {
      case 'member.role_changed': return `${role(d.from)} → ${role(d.to)}`;
      case 'member.added': case 'invitation.sent': case 'invitation.accepted': case 'invitation.withdrawn': return role(d.role);
      case 'org.ownership_transferred': return d.stepDown ? t('auSteppedDown') : '';
      case 'org.renamed': return `${String(d.from ?? '')} →`;
      case 'org.deletion_scheduled': return t('auDeleteOn', { date: date(String(d.deleteOn ?? '')) });
      case 'billing.plan_changed': return `${plan(d.from)} → ${plan(d.to)}`;
      case 'billing.trial_started': return t('auUntil', { date: date(String(d.ends ?? '')) });
      case 'billing.payment_received': return typeof d.total === 'number' ? `${(d.total / 100).toFixed(2)} ${String(d.currency ?? 'SAR')}` : '';
      default: return '';
    }
  };
  const target = (e: AuditEvent) => (e.action === 'billing.plan_changed' || e.action === 'billing.trial_started' ? plan(e.target) : e.target ?? '');

  return (
    <div className="shell">
      <TopBar><Link className="btn" to="/">{t('projects')}</Link><Link className="btn" to={`/members/${orgId}`}>{t('members')}</Link></TopBar>
      <div className="view">
        <div className="rep">
          <div className="rep-head"><div><h1>{t('auditLog')}</h1><div className="crumb" dir="auto">{org?.name}</div></div>
            {page && <span className="hint">{page.retentionDays == null ? t('historyKeptAll') : t('historyKeptN', { n: page.retentionDays })}</span>}
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          <div className="sec">
            <p className="hint">{t('auditHint')}</p>
            <div className="row-form">
              <label className="fld"><span>{t('auditShow')}</span>
                <select value={filter} onChange={e => setFilter(e.target.value)} aria-label={t('auditShow')}>
                  <option value="">{t('ag_all')}</option>
                  {GROUPS.map(g => <option key={g} value={g}>{t(`ag_${g}` as MessageKey)}</option>)}
                </select>
              </label>
              {page?.canExport
                ? <a className="btn" href={`/api/orgs/${orgId}/audit.csv${filter ? `?action=${filter}` : ''}`} download>{t('exportCsv')}</a>
                : page && <span className="hint">{t('exportNeedsBusiness')}</span>}
            </div>
            {page && !rows.length && <p className="hint">{t('noEvents')}</p>}
            {rows.length > 0 && (
              <div className="rt-wrap"><table className="rt audit">
                <thead><tr><th>{t('auWhen')}</th><th>{t('auWho')}</th><th>{t('auEvent')}</th><th>{t('auTarget')}</th><th>{t('auDetails')}</th><th>{t('auIp')}</th></tr></thead>
                <tbody>{rows.map(e => (
                  <tr key={e.id} data-action={e.action}>
                    <td className="nw">{when.format(new Date(e.at))}</td>
                    <td dir="auto">{e.actorName ?? t('auSystem')}</td>
                    <td>{label(e.action)}</td>
                    <td dir="auto">{target(e)}</td>
                    <td dir="auto">{details(e)}</td>
                    <td dir="ltr" className="hint">{e.ip ?? ''}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {page?.next && <button className="btn sm" onClick={() => load(page.next!)}>{t('loadMore')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
