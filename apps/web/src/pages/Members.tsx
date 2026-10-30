import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, DEMO, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar, useToast } from '../ui.js';

type Role = 'owner' | 'admin' | 'member' | 'guest';
interface Member { id: string; email: string; name: string; role: Role }
interface Invitation { id: string; email: string; role: Exclude<Role, 'owner'>; invitedBy: string | null; createdAt: string; expiresAt: string; expired: boolean }

/** An organisation's people (spec 2): members and their roles, invitations by email, and seats in use. */
export function MembersPage() {
  const { orgId = '' } = useParams();
  const { t, error, date } = useI18n();
  const { me, refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const org = me?.organisations.find(o => o.id === orgId);
  const myRole = org?.role as Role | undefined;
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const deleteOn = org?.deleteOn ?? null;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [seats, setSeats] = useState<{ used: number; limit: number | null } | null>(null);
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState<string | null>(null);

  const fail = useCallback((x: unknown) => toast(error(x instanceof ApiError ? x.code : 'server_error')), [toast, error]);
  const load = useCallback(async () => {
    try {
      setMembers((await api.get<{ members: Member[] }>(`/orgs/${orgId}/members`)).members);
      if (isAdmin) {
        const r = await api.get<{ invitations: Invitation[]; seats: { used: number; limit: number | null } }>(`/orgs/${orgId}/invitations`);
        setInvites(r.invitations);
        setSeats(r.seats);
      }
    } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); }
  }, [orgId, isAdmin, error]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get('email') ?? '').trim();
    try {
      const r = await api.post<{ invited?: boolean }>(`/orgs/${orgId}/members`, { email, role: f.get('role') });
      toast(r.invited ? t('inviteSent', { email }) : t('memberAdded', { email }));
      form.reset();
      load();
    } catch (x) { fail(x); }
  }

  /** A second press confirms, as elsewhere for removing things. */
  const confirmFirst = (key: string, run: () => Promise<void>) => async () => {
    if (armed !== key) { setArmed(key); setTimeout(() => setArmed(a => (a === key ? null : a)), 3500); return; }
    setArmed(null);
    try { await run(); load(); } catch (x) { fail(x); }
  };

  const roleOptions = (r: Role) => (['owner', 'admin', 'member', 'guest'] as const)
    .filter(o => o !== 'owner' || myRole === 'owner' || r === 'owner')
    .map(o => <option key={o} value={o}>{t(`role_${o}`)}</option>);

  return (
    <div className="shell">
      <TopBar><Link className="btn" to="/">{t('projects')}</Link>{!DEMO && <Link className="btn" to="/settings">{t('accountSettings')}</Link>}</TopBar>
      <div className="view">
        <div className="rep">
          <div className="rep-head"><div><h1>{t('members')}</h1><div className="crumb" dir="auto">{org?.name}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {seats && <span className="hint">{seats.limit == null ? t('seatsUsedN', { n: seats.used }) : t('seatsUsedOf', { n: seats.used, limit: seats.limit })}</span>}
              {isAdmin && <Link className="btn" to={`/audit/${orgId}`}>{t('auditLog')}</Link>}
            </div>
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          {deleteOn && <DeletionNotice orgId={orgId} deleteOn={deleteOn} />}

          {isAdmin && !deleteOn && (
            <div className="sec">
              <h2>{t('invitePeople')}</h2>
              <p className="hint">{t('invitePeopleHint')}</p>
              <form className="row-form" onSubmit={invite}>
                <label className="fld grow"><span>{t('email')}</span><input name="email" type="email" required maxLength={254} dir="ltr" placeholder="name@company.sa" /></label>
                <label className="fld"><span>{t('role')}</span>
                  <select name="role" defaultValue="member">
                    <option value="member">{t('role_member')}</option>
                    <option value="admin">{t('role_admin')}</option>
                    <option value="guest">{t('role_guest')}</option>
                  </select>
                </label>
                <button className="btn primary" type="submit">{t('sendInvite')}</button>
              </form>
              {seats?.limit != null && seats.used >= seats.limit && (
                <p className="hint">{t('seatsFull')} {myRole === 'owner' && <Link to={`/billing/${orgId}`}>{t('billing')}</Link>}</p>
              )}
            </div>
          )}

          {isAdmin && invites.length > 0 && (
            <div className="sec">
              <h2>{t('pendingInvites')}</h2>
              <div className="rt-wrap"><table className="rt">
                <thead><tr><th>{t('email')}</th><th>{t('role')}</th><th>{t('invitedBy')}</th><th>{t('expires')}</th><th /></tr></thead>
                <tbody>{invites.map(i => (
                  <tr key={i.id}>
                    <td dir="ltr">{i.email}</td><td>{t(`role_${i.role}`)}</td><td dir="auto">{i.invitedBy ?? ''}</td>
                    <td className="nw">{i.expired ? <span className="err">{t('expired')}</span> : date(i.expiresAt.slice(0, 10))}</td>
                    <td className="tactions">
                      <button className="btn sm" onClick={async () => { try { await api.post(`/orgs/${orgId}/invitations/${i.id}/resend`); toast(t('inviteSent', { email: i.email })); load(); } catch (x) { fail(x); } }}>{t('resend')}</button>
                      <button className={`btn sm${armed === `i${i.id}` ? ' armed' : ''}`} onClick={confirmFirst(`i${i.id}`, () => api.del(`/orgs/${orgId}/invitations/${i.id}`))}>
                        {armed === `i${i.id}` ? t('confirmWithdraw') : t('withdraw')}
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          <div className="sec">
            <h2>{t('members')}</h2>
            {members && (
              <div className="rt-wrap"><table className="rt">
                <thead><tr><th>{t('personName')}</th><th>{t('email')}</th><th>{t('role')}</th><th /></tr></thead>
                <tbody>{members.map(m => {
                  const self = m.id === me?.user.id;
                  const canChange = isAdmin && !deleteOn && !self && (m.role !== 'owner' || myRole === 'owner');
                  // the only owner cannot leave (an organisation keeps at least one owner)
                  const canLeave = self && !deleteOn && (m.role !== 'owner' || members.filter(x => x.role === 'owner').length > 1);
                  return (
                    <tr key={m.id}>
                      <td dir="auto">{m.name}{self && <span className="hint"> · {t('you')}</span>}</td>
                      <td dir="ltr">{m.email}</td>
                      <td>{canChange ? (
                        <select aria-label={t('role')} value={m.role} onChange={async e => {
                          try { await api.patch(`/orgs/${orgId}/members/${m.id}`, { role: e.target.value }); load(); } catch (x) { fail(x); }
                        }}>{roleOptions(m.role)}</select>
                      ) : t(`role_${m.role}`)}</td>
                      <td>{(canChange || canLeave) && (
                        <button className={`btn sm${armed === `m${m.id}` ? ' armed' : ''}`} onClick={confirmFirst(`m${m.id}`, async () => {
                          await api.del(`/orgs/${orgId}/members/${m.id}`);
                          if (self) { await refresh(); nav('/'); }
                        })}>{armed === `m${m.id}` ? t('confirmRemove') : self ? t('leaveOrg') : t('remove')}</button>
                      )}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}
          </div>

          {isOwner && !deleteOn && members && org && (
            <>
              <TransferOwnership orgId={orgId} members={members.filter(m => m.id !== me?.user.id)} onDone={async () => { await refresh(); load(); }} />
              <DeleteOrganisation orgId={orgId} name={org.name} onDone={refresh} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The organisation is waiting to be deleted: when, and (owners) cancel it. */
export function DeletionNotice({ orgId, deleteOn, onCancelled }: { orgId: string; deleteOn: string; onCancelled?: () => void }) {
  const { t, error, date } = useI18n();
  const { refresh } = useSession();
  const toast = useToast();
  return (
    <div className="notice warn" role="note">
      <span>{t('deletionScheduled', { date: date(deleteOn) })}</span>
      <button className="btn" onClick={async () => {
        try { await api.del(`/orgs/${orgId}/deletion`); toast(t('deletionCancelled')); await refresh(); onCancelled?.(); }
        catch (x) { toast(error(x instanceof ApiError ? x.code : 'server_error')); }
      }}>{t('cancelDeletion')}</button>
    </div>
  );
}

/** Owners make another member an owner, and may step down to administrator (spec 2). */
function TransferOwnership({ orgId, members, onDone }: { orgId: string; members: Member[]; onDone: () => Promise<void> }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [stepDown, setStepDown] = useState(true);
  const [armed, setArmed] = useState(false);
  const target = members.find(m => m.id === to);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    try {
      await api.post(`/orgs/${orgId}/transfer`, { userId: target.id, stepDown });
      toast(t('transferred', { name: target.name }));
      setTo('');
      await onDone();
    } catch (x) { toast(error(x instanceof ApiError ? x.code : 'server_error')); }
  }
  return (
    <div className="sec">
      <h2>{t('transferOwnership')}</h2>
      <p className="hint">{t('transferHint')}</p>
      {members.length ? (
        <form className="row-form" onSubmit={submit}>
          <label className="fld grow"><span>{t('newOwner')}</span>
            <select name="newOwner" value={to} onChange={e => { setTo(e.target.value); setArmed(false); }} required>
              <option value="" disabled>{t('chooseMember')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}
            </select>
          </label>
          <label className="chk"><input type="checkbox" name="stepDown" checked={stepDown} onChange={e => { setStepDown(e.target.checked); setArmed(false); }} /> {t('stepDown')}</label>
          <button className={`btn${armed ? ' armed' : ' primary'}`} type="submit" disabled={!target}>
            {armed && target ? t('confirmTransfer', { name: target.name }) : t('transfer')}
          </button>
        </form>
      ) : <p className="hint">{t('transferNoOne')}</p>}
    </div>
  );
}

/** Owners delete the organisation: typed name, then 30 days locked before it is deleted for good. */
function DeleteOrganisation({ orgId, name, onDone }: { orgId: string; name: string; onDone: () => Promise<void> }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await api.post(`/orgs/${orgId}/deletion`, { confirm: typed });
      toast(t('deletionRequested'));
      setTyped('');
      await onDone();
    } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); }
  }
  return (
    <div className="sec danger-zone">
      <h2>{t('deleteOrg')}</h2>
      <p className="hint">{t('deleteOrgHint', { days: 30 })}</p>
      <form className="row-form" onSubmit={submit}>
        <label className="fld grow"><span>{t('typeOrgName', { name })}</span>
          <input name="confirmName" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" dir="auto" maxLength={200} />
        </label>
        <button className="btn danger" type="submit" disabled={typed.trim() !== name}>{t('deleteOrg')}</button>
      </form>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}
