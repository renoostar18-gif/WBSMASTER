import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar } from '../ui.js';

const codeOf = (x: unknown) => (x instanceof ApiError
  ? (x.code === 'invalid_request' && JSON.stringify(x.details ?? '').includes('password_too_short') ? 'password_too_short' : x.code)
  : 'server_error');

/** The link in the confirmation email: confirms the address, signed in or not. */
export function VerifyPage() {
  const { token = '' } = useParams();
  const { t, error } = useI18n();
  const { me, refresh } = useSession();
  const [state, setState] = useState<'working' | 'done' | string>('working');
  useEffect(() => {
    let live = true;
    api.post('/auth/verify', { token }).then(
      async () => { await refresh().catch(() => {}); if (live) setState('done'); },
      x => { if (live) setState(error(codeOf(x))); });
    return () => { live = false; };
  }, [token, refresh, error]);
  return (
    <div className="shell">
      <TopBar />
      <div className="auth">
        <h1>{t('confirmEmailTitle')}</h1>
        <div className="card">
          {state === 'working' ? <p className="hint">{t('loading')}</p>
            : state === 'done' ? <p role="status">{t('emailConfirmed')}</p>
            : <p className="err" role="alert">{state}</p>}
          <Link className="btn primary" to={me ? '/' : '/signin'}>{me ? t('projects') : t('signIn')}</Link>
        </div>
      </div>
    </div>
  );
}

/** Forgotten password: ask for a link by email. The answer is the same whether or not the account exists. */
export function ForgotPage() {
  const { t, error } = useI18n();
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/password/forgot', { email: String(new FormData(e.currentTarget).get('email') ?? '').trim() });
      setSent(true);
    } catch (x) { setErr(error(codeOf(x))); } finally { setBusy(false); }
  }
  return (
    <div className="shell">
      <TopBar />
      <div className="auth">
        <h1>{t('forgotTitle')}</h1>
        {sent ? (
          <div className="card"><p role="status">{t('forgotSent')}</p><Link className="btn" to="/signin">{t('signIn')}</Link></div>
        ) : (
          <form className="card" onSubmit={submit}>
            <p className="hint">{t('forgotHint')}</p>
            <label className="fld"><span>{t('email')}</span><input name="email" type="email" required autoComplete="email" autoFocus /></label>
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn primary" disabled={busy} type="submit">{t('forgotSend')}</button>
          </form>
        )}
        <p className="hint"><Link to="/signin">{t('backToSignIn')}</Link></p>
      </div>
    </div>
  );
}

/** The link in the reset email: choose a new password, then go straight in. */
export function ResetPage() {
  const { token = '' } = useParams();
  const { t, error } = useI18n();
  const { refresh } = useSession();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/password/reset', { token, password: new FormData(e.currentTarget).get('password') });
      await refresh();
      nav('/');
    } catch (x) { setErr(error(codeOf(x))); setBusy(false); }
  }
  return (
    <div className="shell">
      <TopBar />
      <div className="auth">
        <h1>{t('resetTitle')}</h1>
        <form className="card" onSubmit={submit}>
          <label className="fld"><span>{t('newPassword')}</span>
            <input name="password" type="password" required minLength={10} autoComplete="new-password" autoFocus />
            <span className="hint">{t('passwordHint')}</span>
          </label>
          {err && <div className="err" role="alert">{err}{err === error('link_invalid') && <> <Link to="/forgot">{t('forgotAgain')}</Link></>}</div>}
          <button className="btn primary" disabled={busy} type="submit">{t('resetSave')}</button>
        </form>
      </div>
    </div>
  );
}
