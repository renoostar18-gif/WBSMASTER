import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { useI18n } from '../i18n.js';
import { useToast } from '../ui.js';

type View = 'table' | 'chart' | 'gantt' | 'summary';
const VIEWS: View[] = ['table', 'chart', 'gantt', 'summary'];

interface Link {
  id: string; views: View[]; showOwners: boolean; createdAt: string; expiresAt: string | null; expired: boolean;
  lastUsedAt: string | null; createdBy: string | null;
}

/** The last day a link works: it stops at the start of the next day (UTC). */
const lastDay = (expiresAt: string) => new Date(new Date(expiresAt).getTime() - 1).toISOString().slice(0, 10);

/** Public read-only links to a project (project admins, Team and Business): create, copy once, revoke. */
export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t, date, error } = useI18n();
  const toast = useToast();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get<{ links: Link[]; available: boolean }>(`/projects/${projectId}/links`)
    .then(r => { setLinks(r.links); setAvailable(r.available); }, x => setErr(error(x instanceof ApiError ? x.code : 'server_error'))), [projectId, error]);
  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const views = VIEWS.filter(v => f.get(`v_${v}`) === 'on');
    if (!views.length) { setErr(error('share_views')); return; }
    setErr('');
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/projects/${projectId}/links`, {
        views,
        showOwners: f.get('owners') === 'on',
        expiresOn: String(f.get('expires') || '') || null,
      });
      setFresh(r.url);
      await load();
    } catch (x) {
      setErr(error(x instanceof ApiError ? x.code : 'server_error'));
    }
    setBusy(false);
  }

  async function revoke(id: string) {
    if (armed !== id) { setArmed(id); setTimeout(() => setArmed(a => (a === id ? null : a)), 3500); return; }
    setArmed(null);
    try { await api.del(`/projects/${projectId}/links/${id}`); } catch (x) { setErr(error(x instanceof ApiError ? x.code : 'server_error')); }
    await load();
  }

  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={t('shareTitle')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <div className="dhead"><h2>{t('shareTitle')}</h2><button className="btn" onClick={onClose}>{t('close')}</button></div>
        <p className="hint">{t('shareHint')}</p>
        {fresh && (
          <div className="secret" role="status">
            <b>{t('shareNewOnce')}</b>
            <code dir="ltr" data-share-url>{fresh}</code>
            <div className="mfoot">
              <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(fresh); toast(t('copiedPlain')); } catch { toast(t('copyFailed')); } }}>{t('copy')}</button>
              <button className="btn sm primary" onClick={() => setFresh(null)}>{t('savedIt')}</button>
            </div>
          </div>
        )}
        {!available ? <p className="hint" role="note">{t('shareNeedsPlan')}</p> : !fresh && (
          <form className="share-form" onSubmit={create}>
            <fieldset className="share-views"><legend>{t('shareViews')}</legend>
              {VIEWS.map(v => <label key={v} className="chk"><input type="checkbox" name={`v_${v}`} defaultChecked /> {t(`view_${v}`)}</label>)}
            </fieldset>
            <label className="chk"><input type="checkbox" name="owners" defaultChecked /> {t('shareOwners')}</label>
            <label className="fld"><span>{t('shareExpires')}</span><input type="date" name="expires" /></label>
            <div className="mfoot"><button className="btn primary" type="submit" disabled={busy}>{t('shareCreate')}</button></div>
          </form>
        )}
        {err && <p className="err" role="alert">{err}</p>}
        {links && (links.length ? (
          <div className="rt-wrap"><table className="rt">
            <thead><tr><th>{t('shareViews')}</th><th>{t('created')}</th><th>{t('expires')}</th><th>{t('lastUsed')}</th><th /></tr></thead>
            <tbody>{links.map(l => (
              <tr key={l.id} data-link={l.id}>
                <td>{l.views.map(v => t(`view_${v}`)).join(', ')}{!l.showOwners && <div className="hint">{t('shareOwnersHidden')}</div>}</td>
                <td className="nw">{date(l.createdAt.slice(0, 10))}{l.createdBy && <div className="hint" dir="auto">{l.createdBy}</div>}</td>
                <td className="nw">{l.expired ? <span className="err">{t('expired')}</span> : l.expiresAt ? date(lastDay(l.expiresAt)) : t('shareNoExpiry')}</td>
                <td className="nw">{l.lastUsedAt ? date(l.lastUsedAt.slice(0, 10)) : t('never')}</td>
                <td><button className={`btn sm${armed === l.id ? ' armed' : ''}`} onClick={() => revoke(l.id)}>{armed === l.id ? t('confirmRevoke') : t('revoke')}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="hint">{t('shareNone')}</p>)}
      </div>
    </div>
  );
}
