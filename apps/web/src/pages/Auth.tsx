import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar } from '../ui.js';

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { t, locale, error } = useI18n();
  const { refresh } = useSession();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
      nav('/');
    } catch (x) {
      const code = x instanceof ApiError
        ? (x.code === 'invalid_request' && JSON.stringify(x.details ?? '').includes('password_too_short') ? 'password_too_short' : x.code)
        : 'server_error';
      setErr(error(code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <TopBar />
      <div className="auth">
        <h1>{mode === 'signin' ? t('signIn') : t('signUp')}</h1>
        <form className="card" onSubmit={submit}>
          {mode === 'signup' && <label className="fld"><span>{t('yourName')}</span><input name="name" required autoComplete="name" /></label>}
          <label className="fld"><span>{t('email')}</span><input name="email" type="email" required autoComplete="email" /></label>
          <label className="fld">
            <span>{t('password')}</span>
            <input name="password" type="password" required minLength={mode === 'signup' ? 10 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            {mode === 'signup' && <span className="hint">{t('passwordHint')}</span>}
          </label>
          {mode === 'signup' && <label className="fld"><span>{t('organisation')}</span><input name="organisation" autoComplete="organization" /></label>}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy} type="submit">{mode === 'signin' ? t('signIn') : t('signUp')}</button>
        </form>
        <p className="hint">
          {mode === 'signin' ? <>{t('noAccount')} <Link to="/signup">{t('signUp')}</Link></> : <>{t('haveAccount')} <Link to="/signin">{t('signIn')}</Link></>}
        </p>
      </div>
    </div>
  );
}
