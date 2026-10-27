import type { WbsItem } from '@wbs-master/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type MessageKey, useI18n } from '../i18n.js';
import type { ActivityEntry, ProjectStore } from './store.js';

const DATE_FIELDS = new Set(['plannedStart', 'plannedFinish', 'forecastStart', 'forecastFinish', 'actualStart', 'actualFinish']);

/** Who changed what and when (spec 7.1), newest first, for the project or the selected item. */
export function ActivityPanel({ store, items, codes, selected, onClose }: {
  store: ProjectStore; items: WbsItem[]; codes: Map<string, string>; selected: string | null; onClose: () => void;
}) {
  const { t, date, locale } = useI18n();
  const [scope, setScope] = useState<'all' | 'item'>('all');
  const [rows, setRows] = useState<ActivityEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [kept, setKept] = useState<{ days: number | null; csv: boolean } | null>(null);
  const itemId = scope === 'item' && selected ? selected : undefined;
  const version = store.data?.project.version;

  const load = useCallback(async (before?: number) => {
    const r = await store.activity(before, itemId);
    setRows(prev => (before && prev ? [...prev, ...r.activity] : r.activity));
    setMore(r.activity.length === 100);
    if (r.retentionDays !== undefined) setKept({ days: r.retentionDays, csv: !!r.canExport });
  }, [store, itemId]);
  useEffect(() => { load().catch(() => setRows([])); }, [load, version]);

  const names = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items]);
  const when = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }), [locale]);

  const value = (field: string | null, v: unknown) => {
    if (v == null || v === '') return t('empty');
    if (field && DATE_FIELDS.has(field)) return date(String(v));
    if (field === 'status') return t(`status_${v}` as MessageKey);
    if (field === 'progress') return `${v}%`;
    return String(v);
  };
  const itemLabel = (e: ActivityEntry) => {
    if (!e.itemId) return '';
    const name = names.get(e.itemId) ?? (e.action === 'item.delete' ? String(e.oldValue ?? '') : '') ?? t('aDeletedItem');
    const code = codes.get(e.itemId);
    return `${code ? `${code} ` : ''}${name || t('aDeletedItem')}`;
  };
  const line = (e: ActivityEntry) => {
    const who = e.actorName ?? t('someone');
    const item = itemLabel(e);
    const nv = e.newValue as { id?: string; name?: string } | null;
    const ov = e.oldValue as { id?: string } | null;
    const pred = (() => { const id = nv?.id ?? (typeof e.oldValue === 'string' ? e.oldValue : ov?.id); return id ? `${codes.get(id) ?? ''} ${names.get(id) ?? t('aDeletedItem')}`.trim() : ''; })();
    switch (e.action) {
      case 'item.add': return t('a_item_add', { who, item });
      case 'item.delete': return t('a_item_delete', { who, item });
      case 'item.update': return t('a_item_update', { who, item, field: t(`f_${e.field}` as MessageKey), from: value(e.field, e.oldValue), to: value(e.field, e.newValue) });
      case 'item.schedule': return t('a_item_schedule', { item, field: t(`f_${e.field}` as MessageKey), from: value(e.field, e.oldValue), to: value(e.field, e.newValue) });
      case 'item.move': return t('a_item_move', { who, item });
      case 'link.add': return t('a_link_add', { who, item, pred });
      case 'link.remove': return t('a_link_remove', { who, item, pred });
      case 'link.lag': return t('a_link_lag', { who, item, pred });
      case 'project.create': return t('a_project_create', { who });
      case 'project.settings': return t('a_project_settings', { who });
      case 'baseline.save': return t('a_baseline_save', { who, name: nv?.name ?? '' });
      default: return `${who}: ${e.action}`;
    }
  };

  return (
    <aside className="insp activity" aria-label={t('activity')}>
      <div className="dhead"><h3>{t('activity')}</h3><button className="btn sm" onClick={onClose}>{t('close')}</button></div>
      <div className="seg">
        <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{t('activityAll')}</button>
        <button aria-pressed={scope === 'item'} disabled={!selected} onClick={() => setScope('item')}>{t('activityThis')}</button>
      </div>
      {kept && (
        <p className="hint">{kept.days == null ? t('historyKeptAll') : t('historyKeptN', { n: kept.days })}
          {kept.csv && store.data && <> <a href={`/api/projects/${store.data.project.id}/activity.csv`} download>{t('exportCsv')}</a></>}
        </p>
      )}
      {rows && !rows.length && <p className="hint">{t('noActivity')}</p>}
      <ol className="alist">
        {rows?.map(e => (
          <li key={e.id}><span dir="auto">{line(e)}</span><time className="hint">{when.format(new Date(e.at))}</time></li>
        ))}
      </ol>
      {more && rows && <button className="btn sm" onClick={() => load(rows[rows.length - 1]!.id)}>{t('loadMore')}</button>}
    </aside>
  );
}
