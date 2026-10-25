import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useToast } from '../ui.js';

type Provider = 'entra' | 'google' | 'oidc';
interface SsoState {
  callbackUrl: string;
  connection: { provider: Provider; issuer: string; clientId: string; enforce: boolean; autoJoin: boolean; tenant?: string } | null;
  domains: { domain: string; verified: boolean; record: string }[];
}

/** Single sign-on for one organisation (spec 7.2, Business plan): provider, proved domains, and whether SSO is required. */
export function SsoSettings({ orgId }: { orgId: string }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [s, setS] = useState<SsoState | null>(null);
  const [provider, setProvider] = useState<Provider>('entra');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api.get<SsoState>(`/orgs/${orgId}/sso`);
      setS(r);
      if (r.connection) setProvider(r.connection.provider);
    } catch { setS(null); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;
  const c = s.connection;
  const verified = s.domains.some(d => d.verified);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setErr('');
    try { await fn(); await load(); if (done) toast(done); return true; } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); return false; }
  };

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    setBusy(true);
    await act(() => api.put(`/orgs/${orgId}/sso`, {
      provider, tenant: v('tenant') || undefined, issuer: v('issuer') || undefined, clientId: v('clientId'),
      clientSecret: v('clientSecret') || undefined, autoJoin: f.get('autoJoin') === 'on', enforce: f.get('enforce') === 'on',
    }), t('ssoSaved'));
    setBusy(false);
  }

  return (
    <div className="sec">
      <h2>{t('sso')}</h2>
      <p className="hint">{t('ssoHint')}</p>

      <h3 className="sub-h">1. {t('ssoDomains')}</h3>
      <p className="hint">{t('ssoDomainsHint')}</p>
      {s.domains.length > 0 && (
        <ul className="domains">
          {s.domains.map(d => (
            <li key={d.domain}>
              <code dir="ltr">{d.domain}</code>
              {d.verified ? <span className="pill green">{t('verified')}</span> : (
                <>
                  <span className="hint">{t('addTxt')}</span>
                  <code className="record" dir="ltr">{d.record}</code>
                  <button className="btn sm" onClick={() => act(() => api.post(`/orgs/${orgId}/sso/domains/${d.domain}/verify`), t('domainVerified'))}>{t('verify')}</button>
                </>
              )}
              <button className="btn sm danger" onClick={() => act(() => api.del(`/orgs/${orgId}/sso/domains/${d.domain}`))}>{t('remove')}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="row-form" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const domain = String(new FormData(form).get('domain') ?? '').trim(); if (await act(() => api.post(`/orgs/${orgId}/sso/domains`, { domain }))) form.reset(); }}>
        <label className="fld"><span>{t('emailDomain')}</span><input name="domain" required placeholder="example.sa" dir="ltr" /></label>
        <button className="btn" type="submit">{t('addDomain')}</button>
      </form>

      <h3 className="sub-h">2. {t('ssoProvider')}</h3>
      <p className="hint">{t('ssoRedirectHint')} <code dir="ltr" className="record">{s.callbackUrl}</code></p>
      <form className="row-form" onSubmit={save} key={JSON.stringify(c)}>
        <label className="fld"><span>{t('provider')}</span>
          <select value={provider} onChange={e => setProvider(e.target.value as Provider)}>
            <option value="entra">Microsoft Entra ID</option><option value="google">Google Workspace</option><option value="oidc">{t('otherOidc')}</option>
          </select>
        </label>
        {provider === 'entra' && <label className="fld grow"><span>{t('tenantId')}</span><input name="tenant" required defaultValue={c?.tenant ?? ''} dir="ltr" placeholder="00000000-0000-0000-0000-000000000000" /></label>}
        {provider === 'oidc' && <label className="fld grow"><span>{t('issuerUrl')}</span><input name="issuer" type="url" required defaultValue={c?.provider === 'oidc' ? c.issuer : ''} dir="ltr" placeholder="https://id.example.sa" /></label>}
        <label className="fld grow"><span>{t('clientId')}</span><input name="clientId" required defaultValue={c?.clientId ?? ''} dir="ltr" /></label>
        <label className="fld grow"><span>{t('clientSecret')}</span><input name="clientSecret" type="password" required={!c} placeholder={c ? t('secretKept') : ''} autoComplete="off" dir="ltr" /></label>
        <div className="events">
          <label className="chk sm"><input type="checkbox" name="autoJoin" defaultChecked={c?.autoJoin ?? true} /> {t('ssoAutoJoin')}</label>
          <label className="chk sm" title={verified ? '' : t('ssoVerifyFirst')}><input type="checkbox" name="enforce" defaultChecked={c?.enforce ?? false} disabled={!verified} /> {t('ssoEnforce')}</label>
        </div>
        <button className="btn primary" disabled={busy} type="submit">{t('save')}</button>
        {c && <button className="btn danger" type="button" onClick={() => act(() => api.del(`/orgs/${orgId}/sso`), t('ssoRemoved'))}>{t('ssoRemove')}</button>}
      </form>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}
