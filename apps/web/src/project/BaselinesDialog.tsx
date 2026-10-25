import { baselineFinish, toDay, toIso } from '@wbs-master/engine';
import { type FormEvent, useState } from 'react';
import { useI18n } from '../i18n.js';
import { useToast } from '../ui.js';
import type { ProjectStore } from './store.js';

/** Save, compare, restore, rename and delete baselines (spec 4.8). Changes are for project admins. */
export function BaselinesDialog({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const { t, date, error } = useI18n();
  const toast = useToast();
  const data = store.data!;
  const admin = store.isAdmin;
  const active = data.project.settings.activeBaselineId;
  const [armed, setArmed] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const latestFinish = store.computed?.project.planned.finish ?? null;

  const act = async (fn: () => Promise<string | null>, ok?: string) => {
    setErr('');
    const code = await fn();
    if (code) setErr(error(code)); else if (ok) toast(ok);
  };
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(() => store.baselines.save(String(f.get('name') ?? '').trim(), String(f.get('reason') ?? '').trim()), t('baselineSaved'));
    e.currentTarget?.reset?.();
  }

  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={t('baselines')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <div className="dhead"><h2>{t('baselines')}</h2><button className="btn" onClick={onClose}>{t('close')}</button></div>
        <h4 className="sub">{t('compareAgainst')}</h4>
        <div className="bl-list">
          <label className={`bl-row${!active ? ' on' : ''}`}>
            <input type="radio" name="bl" checked={!active} disabled={!admin} onChange={() => act(() => store.baselines.compare(null))} />
            <span className="bl-t"><b>{t('latestPlan')}</b><small>{t('latestPlanSub', { date: date(toIso(latestFinish)) })}</small></span>
          </label>
          {[...data.baselines].map((b, k) => ({ b, k })).reverse().map(({ b, k }) => (
            <div key={b.id} className={`bl-row${active === b.id ? ' on' : ''}`}>
              <label className="bl-pick">
                <input type="radio" name="bl" checked={active === b.id} disabled={!admin} onChange={() => act(() => store.baselines.compare(b.id))} />
                <span className="bl-t">
                  {renaming === b.id
                    ? <input autoFocus defaultValue={b.name} aria-label={t('blName')} maxLength={120}
                        onBlur={e => { const v = e.currentTarget.value.trim(); setRenaming(null); if (v && v !== b.name) act(() => store.baselines.rename(b.id, v)); }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                    : <b dir="auto">{b.name}</b>}
                  <small>{k === 0 ? `${t('original')} · ` : ''}{t('blSub', { date: date(b.setOn), finish: date(toIso(toDay(baselineFinish(b)))), n: Object.keys(b.items).length })}</small>
                  {b.reason && <small dir="auto">{b.reason}</small>}
                </span>
              </label>
              {admin && (
                <span className="bl-act">
                  <button title={t('rename')} aria-label={t('rename')} onClick={() => setRenaming(b.id)}>✎</button>
                  <button title={t('restore')} aria-label={t('restore')} onClick={() => act(() => store.baselines.restore(b.id))}>↺</button>
                  <button className={armed === b.id ? 'armed' : ''} title={t('delete')} aria-label={t('delete')}
                    onClick={() => { if (armed !== b.id) { setArmed(b.id); setTimeout(() => setArmed(a => (a === b.id ? null : a)), 3500); return; } setArmed(null); act(() => store.baselines.remove(b.id)); }}>
                    {armed === b.id ? t('deleteQ') : '×'}
                  </button>
                </span>
              )}
            </div>
          ))}
          {!data.baselines.length && <p className="hint">{t('noBaselines')}</p>}
        </div>
        {admin && (
          <form className="bl-form" onSubmit={save}>
            <h4 className="sub">{t('saveBaseline')}</h4>
            <label className="fld"><span>{t('blName')}</span><input name="name" maxLength={120} placeholder={data.baselines.length ? `Re-baseline ${data.baselines.length}` : 'Original baseline'} /></label>
            <label className="fld"><span>{t('blReason')}</span><input name="reason" maxLength={1000} placeholder={t('blReasonPh')} dir="auto" /></label>
            <p className="hint">{t('blSaveHint')}</p>
            <div className="mfoot"><button className="btn primary" type="submit">{t('saveBaseline')}</button></div>
          </form>
        )}
        {err && <div className="err" role="alert">{err}</div>}
      </div>
    </div>
  );
}
