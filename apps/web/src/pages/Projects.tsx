import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { type MessageKey, useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { DeletionNotice } from './Members.js';
import { ImportDialog } from '../project/ImportDialog.js';
import { Icon, TopBar } from '../ui.js';

interface ProjectRow { id: string; name: string; updatedAt: string; itemCount: number; role: string }

export function ProjectsPage() {
  const { t, error, locale } = useI18n();
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const orgs = me?.organisations ?? [];
  const [orgId, setOrgId] = useState(() => orgs[0]?.id ?? '');
  const org = orgs.find(o => o.id === orgId);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [err, setErr] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // the chosen organisation can disappear (left, deleted): fall back to the first one
  useEffect(() => { if (!orgs.some(o => o.id === orgId)) setOrgId(orgs[0]?.id ?? ''); }, [orgs, orgId]);

  const load = useCallback(async () => {
    if (!orgId) { setProjects(null); return; }
    setProjects((await api.get<{ projects: ProjectRow[] }>(`/orgs/${orgId}/projects`)).projects);
  }, [orgId]);
  useEffect(() => { load().catch(e => setErr(error(e instanceof ApiError ? e.code : 'server_error'))); }, [load, error]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    setErr('');
    try {
      const r = await api.post<{ id: string }>(`/orgs/${orgId}/projects`, { name, locale });
      nav(`/p/${r.id}`);
    } catch (x) {
      setErr(error(x instanceof ApiError ? x.code : 'server_error'));
    }
  }

  /** A new organisation, for someone who belongs to none (or wants another); they become its owner. */
  async function createOrg(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('orgName') ?? '').trim();
    if (!name) return;
    setErr('');
    try {
      const r = await api.post<{ id: string }>('/orgs', { name });
      await refresh();
      setOrgId(r.id);
    } catch (x) {
      setErr(error(x instanceof ApiError ? x.code : 'server_error'));
    }
  }

  const updated = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="shell">
      <TopBar>
        {orgs.length > 1 && (
          <select className="btn" value={orgId} onChange={e => setOrgId(e.target.value)} aria-label="Organisation">
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}{o.deleteOn ? ` · ${t('pendingDeletion')}` : ''}</option>)}
          </select>
        )}
      </TopBar>
      <div className="view">
        <div className="page">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1>{t('projects')}</h1>
            {org && <span className="crumb">{org.name}</span>}
            {org && <span className="badge">{t(`plan_${org.plan}` as MessageKey)}</span>}
            {org && <Link className="btn" to={`/portfolio/${org.id}`} style={{ marginInlineStart: 'auto' }}>{Icon.portfolio} {t('portfolio')}</Link>}
            {org && org.role !== 'guest' && <Link className="btn" to={`/members/${org.id}`}>{t('members')}</Link>}
            {org?.role === 'owner' && <Link className="btn" to={`/billing/${org.id}`}>{t('billing')}</Link>}
            {import.meta.env.MODE !== 'demo' && <Link className="btn" to="/settings">{Icon.gear} {t('accountSettings')}</Link>}
          </div>
          {!org && (
            <div className="sec">
              <h2>{t('noOrgs')}</h2>
              <p className="hint">{t('noOrgsHint')}</p>
              <form className="newp org" onSubmit={createOrg}>
                <input name="orgName" placeholder={t('orgName')} aria-label={t('orgName')} maxLength={200} required />
                <button className="btn primary" type="submit">{t('createOrg')}</button>
              </form>
            </div>
          )}
          {org?.deleteOn && <DeletionNotice orgId={org.id} deleteOn={org.deleteOn} onCancelled={() => { load().catch(() => {}); }} />}
          {org && !org.deleteOn && <form className="newp" onSubmit={create}>
            <input name="name" placeholder={t('projectName')} aria-label={t('projectName')} maxLength={200} />
            <button className="btn primary" type="submit">{t('newProject')}</button>
            <button className="btn" type="button" onClick={() => setImportOpen(true)}>{t('newFromExcel')}</button>
          </form>}
          {err && <div className="err" role="alert">{err}</div>}
          {projects && !projects.length && <p className="hint">{t('noProjects')}</p>}
          <div className="plist">
            {projects?.map(p => (
              <Link key={p.id} to={`/p/${p.id}`} className="card pitem">
                <b dir="auto">{p.name}</b>
                <span className="hint">{p.itemCount} {t('items')} · {t('updated')} {updated.format(new Date(p.updatedAt))}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
      {importOpen && orgId && <ImportDialog orgId={orgId} onClose={() => setImportOpen(false)} onCreated={id => nav(`/p/${id}`)} />}
    </div>
  );
}
