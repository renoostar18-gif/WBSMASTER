import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar } from '../ui.js';

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { t, locale, error } = useI18n();
  const { refresh } = useSession();
  const nav = useNavigate();
  const location = useLocation();
  // coming back from a company sign-in that failed: say why
  const params = new URLSearchParams(location.search);
  const ssoError = params.get('sso_error');
  // where to go afterwards (an invitation page), only within this site
  const next = params.get('next');
  const after = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [err, setErr] = useState(() => (ssoError ? error(ssoError) : ''));
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState(!!ssoError);
  const [email, setEmail] = useState('');

  /** Company sign-in (single sign-on): the email's domain decides where to go. */
  async function startSso(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api.post<{ url: string }>('/auth/sso/start', { email: email.trim() });
      window.location.assign(r.url);
    } catch (x) {
      setErr(error(x instanceof ApiError ? x.code : 'server_error'));
      setBusy(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries([...f.entries()].filter(([, v]) => String(v).trim() !== ''));
    setBusy(true);
    setErr('');
    try {
      if (mode === 'signup') await api.post('/auth/signup', { ...body, locale });
      else await api.post('/auth/login', body);
      await refresh();
      nav(after);
    } catch (x) {
      const code = x instanceof ApiError
        ? (x.code === 'invalid_request' && JSON.stringify(x.details ?? '').includes('password_too_short') ? 'password_too_short' : x.code)
        : 'server_error';
      setErr(error(code));
      if (code === 'sso_required') { setEmail(String(f.get('email') ?? '')); setSso(true); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <TopBar />
      <div className="auth">
        <h1>{mode === 'signin' ? t('signIn') : t('signUp')}</h1>
        {sso && mode === 'signin' ? (
          <form className="card" onSubmit={startSso}>
            <p className="hint">{t('ssoIntro')}</p>
            <label className="fld"><span>{t('workEmail')}</span>
              <input name="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
            </label>
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn primary" disabled={busy} type="submit">{t('continueSso')}</button>
            <button className="btn" type="button" onClick={() => { setSso(false); setErr(''); }}>{t('usePassword')}</button>
          </form>
        ) : (
        <form className="card" onSubmit={submit}>
          {mode === 'signup' && <label className="fld"><span>{t('yourName')}</span><input name="name" required autoComplete="name" /></label>}
          <label className="fld"><span>{t('email')}</span><input name="email" type="email" required autoComplete="email" defaultValue={params.get('email') ?? ''} /></label>
          <label className="fld">
            <span>{t('password')}</span>
            <input name="password" type="password" required minLength={mode === 'signup' ? 10 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            {mode === 'signup' && <span className="hint">{t('passwordHint')}</span>}
          </label>
          {mode === 'signup' && <label className="fld"><span>{t('organisation')}</span><input name="organisation" autoComplete="organization" /></label>}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy} type="submit">{mode === 'signin' ? t('signIn') : t('signUp')}</button>
          {mode === 'signin' && import.meta.env.MODE !== 'demo' && (
            <button className="btn" type="button" onClick={() => { setSso(true); setErr(''); }}>{t('signInSso')}</button>
          )}
        </form>
        )}
        <p className="hint">
          {mode === 'signin' ? <>{t('noAccount')} <Link to="/signup">{t('signUp')}</Link></> : <>{t('haveAccount')} <Link to="/signin">{t('signIn')}</Link></>}
        </p>
      </div>
    </div>
  );
}
