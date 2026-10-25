import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { type MessageKey, useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar, useToast } from '../ui.js';
import { SsoSettings } from './SsoSettings.js';

interface ApiKey { id: string; name: string; prefix: string; scope: 'read' | 'write'; orgId: string; orgName: string; createdAt: string; lastUsedAt: string | null }
interface Webhook {
  id: string; url: string; events: string[]; active: boolean; createdAt: string;
  lastDelivery: { status: string; responseCode: number | null; error: string | null; at: string } | null;
}
interface Delivery { id: string; event: string; status: string; attempts: number; responseCode: number | null; error: string | null; createdAt: string }

const EVENTS = ['item.changed', 'health.changed', 'baseline.saved', 'project.created'] as const;

/** A secret shown once, with a copy button. */
function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <div className="secret" role="status">
      <b>{label}</b>
      <code dir="ltr">{value}</code>
      <div className="mfoot">
        <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(value); toast(t('copiedPlain')); } catch { toast(t('copyFailed')); } }}>{t('copy')}</button>
        <button className="btn sm primary" onClick={onDone}>{t('savedIt')}</button>
      </div>
    </div>
  );
}

function ApiKeys({ orgs }: { orgs: { id: string; name: string; plan: string }[] }) {
  const { t, error } = useI18n();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const load = useCallback(() => api.get<{ keys: ApiKey[] }>('/me/api-keys').then(r => setKeys(r.keys), () => setKeys([])), []);
  useEffect(() => { load(); }, [load]);
  const paid = orgs.filter(o => o.plan !== 'free');

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErr('');
    try {
      const r = await api.post<{ key: string }>('/me/api-keys', { name: String(f.get('name') ?? '').trim(), orgId: f.get('org'), scope: f.get('scope') });
      setFresh(r.key);
      form.reset();
      load();
    } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); }
  }

  return (
    <div className="sec">
      <h2>{t('apiKeys')}</h2>
      <p className="hint">{t('apiKeysHint')} <a href="/api/docs" target="_blank" rel="noreferrer">{t('apiDocs')}</a></p>
      {fresh && <Secret label={t('newKeyOnce')} value={fresh} onDone={() => setFresh(null)} />}
      {paid.length ? (
        <form className="row-form" onSubmit={create}>
          <label className="fld"><span>{t('keyName')}</span><input name="name" required maxLength={120} placeholder={t('keyNamePh')} /></label>
          <label className="fld"><span>{t('orgLabel')}</span><select name="org">{paid.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className="fld"><span>{t('access')}</span><select name="scope"><option value="read">{t('scope_read')}</option><option value="write">{t('scope_write')}</option></select></label>
          <button className="btn primary" type="submit">{t('createKey')}</button>
        </form>
      ) : <p className="hint">{t('apiNeedsPlan')}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {keys && keys.length > 0 && (
        <div className="rt-wrap"><table className="rt">
          <thead><tr><th>{t('keyName')}</th><th>{t('orgLabel')}</th><th>{t('access')}</th><th>{t('created')}</th><th>{t('lastUsed')}</th><th /></tr></thead>
          <tbody>{keys.map(k => (
            <tr key={k.id}>
              <td dir="auto">{k.name}<div className="hint" dir="ltr">wbsm_{k.prefix}_…</div></td><td dir="auto">{k.orgName}</td>
              <td>{t(`scope_${k.scope}`)}</td><td className="nw">{when.format(new Date(k.createdAt))}</td>
              <td className="nw">{k.lastUsedAt ? when.format(new Date(k.lastUsedAt)) : t('never')}</td>
              <td><button className={`btn sm${armed === k.id ? ' armed' : ''}`} onClick={async () => {
                if (armed !== k.id) { setArmed(k.id); setTimeout(() => setArmed(a => (a === k.id ? null : a)), 3500); return; }
                await api.del(`/me/api-keys/${k.id}`); setArmed(null); load();
              }}>{armed === k.id ? t('confirmRevoke') : t('revoke')}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Webhooks({ orgId }: { orgId: string }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const load = useCallback(() => api.get<{ webhooks: Webhook[] }>(`/orgs/${orgId}/webhooks`).then(r => setHooks(r.webhooks), () => setHooks(null)), [orgId]);
  useEffect(() => { load(); }, [load]);
  const showDeliveries = useCallback(async (id: string) => {
    setOpen(id);
    setDeliveries((await api.get<{ deliveries: Delivery[] }>(`/orgs/${orgId}/webhooks/${id}/deliveries`)).deliveries);
  }, [orgId]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErr('');
    try {
      const r = await api.post<{ secret: string }>(`/orgs/${orgId}/webhooks`, { url: String(f.get('url') ?? '').trim(), events: f.getAll('events') });
      setFresh(r.secret);
      form.reset();
      load();
    } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); }
  }
  if (!hooks) return null; // not an admin of this organisation, or the plan has no API

  return (
    <div className="sec">
      <h2>{t('webhooks')}</h2>
      <p className="hint">{t('webhooksHint')}</p>
      {fresh && <Secret label={t('newSecretOnce')} value={fresh} onDone={() => setFresh(null)} />}
      <form className="row-form" onSubmit={create}>
        <label className="fld grow"><span>{t('webhookUrl')}</span><input name="url" type="url" required placeholder="https://example.com/wbs-master" dir="ltr" /></label>
        <button className="btn primary" type="submit">{t('addWebhook')}</button>
        <fieldset className="events"><legend>{t('events')}</legend>
          {EVENTS.map(ev => <label key={ev} className="chk sm"><input type="checkbox" name="events" value={ev} defaultChecked /> {t(`ev_${ev.replace('.', '_')}` as MessageKey)}</label>)}
        </fieldset>
      </form>
      {err && <p className="err" role="alert">{err}</p>}
      {hooks.length > 0 && (
        <ul className="hooks">
          {hooks.map(h => (
            <li key={h.id} className={h.active ? '' : 'paused'}>
              <div className="hook-head">
                <code dir="ltr">{h.url}</code>
                {!h.active && <span className="badge">{t('paused')}</span>}
                <span className="hint">{h.events.map(ev => t(`ev_${ev.replace('.', '_')}` as MessageKey)).join(' · ')}</span>
              </div>
              {h.lastDelivery && (
                <div className="hint">{t('lastDelivery')}: {t(`dl_${h.lastDelivery.status}` as MessageKey)}{h.lastDelivery.responseCode ? ` (${h.lastDelivery.responseCode})` : ''} · {when.format(new Date(h.lastDelivery.at))}</div>
              )}
              <div className="tactions">
                <button className="btn sm" onClick={async () => { await api.post(`/orgs/${orgId}/webhooks/${h.id}/test`); toast(t('pingSent')); setTimeout(() => { load(); if (open === h.id) showDeliveries(h.id); }, 1500); }}>{t('sendTest')}</button>
                <button className="btn sm" onClick={async () => { await api.patch(`/orgs/${orgId}/webhooks/${h.id}`, { active: !h.active }); load(); }}>{h.active ? t('pause') : t('resume')}</button>
                <button className="btn sm" onClick={() => (open === h.id ? setOpen(null) : showDeliveries(h.id))}>{t('deliveries')}</button>
                <button className="btn sm danger" onClick={async () => { await api.del(`/orgs/${orgId}/webhooks/${h.id}`); load(); }}>{t('delete')}</button>
              </div>
              {open === h.id && (
                deliveries.length ? (
                  <div className="rt-wrap"><table className="rt"><tbody>{deliveries.map(d => (
                    <tr key={d.id}><td className="nw">{when.format(new Date(d.createdAt))}</td><td dir="ltr">{d.event}</td>
                      <td>{t(`dl_${d.status}` as MessageKey)}</td><td className="nw">{d.responseCode ?? d.error ?? ''}</td><td className="hint">{t('attemptsN', { n: d.attempts })}</td></tr>
                  ))}</tbody></table></div>
                ) : <p className="hint">{t('noDeliveries')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settings → integrations (spec 7.2): personal API keys, and the organisation's webhooks for its admins. */
export function SettingsPage() {
  const { t } = useI18n();
  const { me } = useSession();
  const orgs = me?.organisations ?? [];
  const admin = orgs.filter(o => (o.role === 'owner' || o.role === 'admin') && o.plan !== 'free');
  return (
    <div className="shell">
      <TopBar><Link className="btn" to="/">{t('projects')}</Link></TopBar>
      <div className="view">
        <div className="rep">
          <div className="rep-head"><div><h1>{t('accountSettings')}</h1></div></div>
          <ApiKeys orgs={orgs} />
          {admin.map(o => (
            <div key={o.id}>
              {admin.length > 1 && <h3 className="org-h" dir="auto">{o.name}</h3>}
              <Webhooks orgId={o.id} />
              {o.plan === 'business' && <SsoSettings orgId={o.id} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
