import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar } from '../ui.js';

interface InviteInfo {
  organisation: string; invitedBy: string | null; email: string; role: 'admin' | 'member' | 'guest';
  status: 'open' | 'expired' | 'used'; hasAccount: boolean;
}

/**
 * The page an invitation email links to. New people create their account here and join;
 * people with an account sign in (and come back) or, signed in already, accept.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const { t, error, locale } = useI18n();
  const { me, refresh, signOut } = useSession();
  const nav = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<InviteInfo>(`/invitations/${token}`).then(setInfo, x => setErr(error(x instanceof ApiError ? x.code : 'server_error')));
  }, [token, error]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      await refresh();
      nav('/');
    } catch (x) {
      const code = x instanceof ApiError
        ? (x.code === 'invalid_request' && JSON.stringify(x.details ?? '').includes('password_too_short') ? 'password_too_short' : x.code)
        : 'server_error';
      setErr(error(code));
      setBusy(false);
    }
  }

  function signUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(() => api.post('/auth/signup', { email: info!.email, name: String(f.get('name') ?? '').trim(), password: f.get('password'), locale, invite: token }));
  }

  const back = `/invite/${token}`;
  const mine = me && info && me.user.email.toLowerCase() === info.email.toLowerCase();

  return (
    <div className="shell">
      <TopBar />
      <div className="auth">
        {!info ? (err ? <><h1>{t('inviteTitle')}</h1><p className="err" role="alert">{err}</p><p><Link to="/">{t('projects')}</Link></p></> : null) : (
          <>
            <h1>{t('joinOrg', { org: info.organisation })}</h1>
            <p className="hint">{info.invitedBy
              ? t('invitedByAs', { name: info.invitedBy, role: t(`role_${info.role}`) })
              : t('invitedAs', { role: t(`role_${info.role}`) })}</p>
            {info.status !== 'open' ? (
              <div className="card"><p className="err" role="alert">{error(info.status === 'used' ? 'invitation_used' : 'invitation_expired')}</p>
                <Link className="btn" to="/">{t('projects')}</Link></div>
            ) : mine ? (
              <div className="card">
                <p dir="ltr">{info.email}</p>
                {err && <div className="err" role="alert">{err}</div>}
                <button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/invitations/${token}/accept`))}>{t('acceptInvite')}</button>
              </div>
            ) : me ? (
              <div className="card">
                <p>{t('inviteOtherAccount', { email: info.email, me: me.user.email })}</p>
                <button className="btn" onClick={() => signOut()}>{t('signOut')}</button>
              </div>
            ) : info.hasAccount ? (
              <div className="card">
                <p>{t('inviteSignIn', { email: info.email })}</p>
                <Link className="btn primary" to={`/signin?${new URLSearchParams({ next: back, email: info.email })}`}>{t('signIn')}</Link>
              </div>
            ) : (
              <form className="card" onSubmit={signUp}>
                <label className="fld"><span>{t('email')}</span><input value={info.email} readOnly dir="ltr" /></label>
                <label className="fld"><span>{t('yourName')}</span><input name="name" required autoComplete="name" autoFocus /></label>
                <label className="fld"><span>{t('password')}</span>
                  <input name="password" type="password" required minLength={10} autoComplete="new-password" />
                  <span className="hint">{t('passwordHint')}</span>
                </label>
                {err && <div className="err" role="alert">{err}</div>}
                <button className="btn primary" disabled={busy} type="submit">{t('createAndJoin')}</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
