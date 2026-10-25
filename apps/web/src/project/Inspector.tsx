import { type ComputedProject, type EditableField, type Op, type Status, Tree, type WbsItem, toIso } from '@wbs-master/engine';
import { type KeyboardEvent, useMemo } from 'react';
import { type MessageKey, useI18n } from '../i18n.js';
import { Pill, Var } from '../ui.js';

const STATUSES: Status[] = ['auto', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'];

/** Details of the selected item, as in the prototype's inspector. */
export function Inspector({ item, items, computed, canEdit, onEdit, openComments, onComments }: {
  item: WbsItem | null; items: WbsItem[]; computed: ComputedProject; canEdit: boolean; onEdit: (ops: Op[]) => void;
  /** Open comment threads on this item, and how to show them. */
  openComments: number; onComments: () => void;
}) {
  const { t, reason, date } = useI18n();
  const codes = useMemo(() => new Map([...computed.items].map(([id, i]) => [id, i.code])), [computed]);
  const idByCode = useMemo(() => new Map([...computed.items].map(([id, i]) => [i.code, id])), [computed]);
  const tree = useMemo(() => new Tree(items), [items]);
  if (!item) return <aside className="insp"><p className="hint">{t('selectItem')}</p></aside>;
  const i = computed.items.get(item.id);
  if (!i) return null;
  const parent = i.childCount > 0;
  const set = (field: EditableField, value: string | number | null) => onEdit([{ op: 'set', id: item.id, field, value } as Op]);
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.currentTarget.tagName === 'INPUT') e.currentTarget.blur();
  };
  const dateField = (field: EditableField, label: string, own: string | null, rolled: number | null) => (
    <label className="fld">
      <span>{label}</span>
      <input key={`${item.id}-${field}-${own}-${rolled}`} type="date" defaultValue={(parent ? toIso(rolled) : own) ?? ''}
        disabled={parent || !canEdit} title={parent ? t('rolledUp') : undefined}
        onBlur={e => { const v = e.currentTarget.value || null; if (v !== own) set(field, v); }} onKeyDown={blurOnEnter} />
    </label>
  );

  return (
    <aside className="insp" aria-label={item.name}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="code" dir="ltr">{i.code}</span>
        <Pill health={i.health} />
        {computed.critical.has(item.id) && <span className="cp" title={t('critical')}>CP</span>}
        {i.milestone && <span className="badge">{t('milestone')}</span>}
        <button className="btn sm" style={{ marginInlineStart: 'auto' }} onClick={onComments}>
          {openComments ? t('openThreadsN', { n: openComments }) : t('comments')}
        </button>
      </div>
      <div className="hint">{reason(i.reason)}</div>
      <label className="fld">
        <span>{t('name')}</span>
        <input key={`${item.id}-name-${item.name}`} defaultValue={item.name} dir="auto" disabled={!canEdit} data-insp-name
          onBlur={e => e.currentTarget.value !== item.name && set('name', e.currentTarget.value)} onKeyDown={blurOnEnter} />
      </label>
      <div className="row2">
        <label className="fld">
          <span>{t('owner')}</span>
          <input key={`${item.id}-owner-${item.owner}`} defaultValue={item.owner} dir="auto" disabled={!canEdit}
            onBlur={e => e.currentTarget.value !== item.owner && set('owner', e.currentTarget.value)} onKeyDown={blurOnEnter} />
        </label>
        <label className="fld">
          <span>{t('status')}</span>
          {parent
            ? <select disabled><option>{t(`status_${i.status}` as MessageKey)}</option></select>
            : (
              <select value={item.status} disabled={!canEdit} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s === 'auto' ? `${t('status_auto')}: ${t(`status_${i.status}` as MessageKey)}` : t(`status_${s}` as MessageKey)}</option>)}
              </select>
            )}
        </label>
      </div>
      <div className="dset"><b>{t('planned')}</b>
        <div className="row2">{dateField('plannedStart', t('start'), item.plannedStart, i.planned.start)}{dateField('plannedFinish', t('finish'), item.plannedFinish, i.planned.finish)}</div>
      </div>
      <div className="dset"><b>{t('forecast')}</b>
        <div className="row2">{dateField('forecastStart', t('start'), item.forecastStart, i.forecast.start)}{dateField('forecastFinish', t('finish'), item.forecastFinish, i.forecast.finish)}</div>
      </div>
      <div className="dset"><b>{t('actual')}</b>
        <div className="row2">{dateField('actualStart', t('start'), item.actualStart, i.actual.start)}{dateField('actualFinish', t('finish'), item.actualFinish, i.actual.finish)}</div>
      </div>
      <div className="row2">
        <label className="fld">
          <span>{t('progress')} (%)</span>
          <input key={`${item.id}-p-${i.progress}`} type="number" min={0} max={100} defaultValue={i.progress}
            disabled={parent || i.status === 'completed' || !canEdit}
            onBlur={e => Number(e.currentTarget.value) !== i.progress && set('progress', Number(e.currentTarget.value) || 0)} onKeyDown={blurOnEnter} />
        </label>
        <div className="fld">
          <span>{t('varianceLong')}</span>
          <div style={{ paddingBlock: 6 }}><Var v={i.variance} /> <span className="hint">{i.plannedPct != null ? `${t('planPct')} ${i.plannedPct}%` : ''}</span></div>
        </div>
      </div>
      <div className="fld">
        <span>{t('links')}</span>
        <div className="chips">
          {item.deps.map(d => (
            <span className="chip" key={d.id}>
              <code dir="ltr">{codes.get(d.id)}</code>
              <span title={tree.byId.get(d.id)?.name}>{tree.byId.get(d.id)?.name}</span>
              <input key={`${d.id}-${d.lag}`} type="number" defaultValue={d.lag} aria-label={t('lag')} title={t('lag')} disabled={!canEdit}
                onBlur={e => { const v = Math.round(Number(e.currentTarget.value) || 0); if (v !== d.lag) onEdit([{ op: 'setLag', succ: item.id, pred: d.id, lag: v }]); }}
                onKeyDown={blurOnEnter} />
              {canEdit && <button onClick={() => onEdit([{ op: 'unlink', succ: item.id, pred: d.id }])} aria-label={t('remove')}>×</button>}
            </span>
          ))}
        </div>
        {canEdit && (
          <input placeholder={t('addLink')} dir="ltr" aria-label={t('addLink')}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              const m = /^(\d+(?:\.\d+)*)(?:\s*([+-])\s*(\d+))?$/.exec(e.currentTarget.value.trim());
              const pred = m ? idByCode.get(m[1]!) : undefined;
              if (pred) {
                onEdit([{ op: 'link', succ: item.id, pred, lag: m![2] ? (m![2] === '-' ? -1 : 1) * Number(m![3]) : 0 }]);
                e.currentTarget.value = '';
              }
            }} />
        )}
      </div>
      <label className="fld">
        <span>{t('notes')}</span>
        <textarea key={`${item.id}-notes-${item.notes}`} rows={4} defaultValue={item.notes} dir="auto" disabled={!canEdit}
          onBlur={e => e.currentTarget.value !== item.notes && set('notes', e.currentTarget.value)} />
      </label>
      <div className="hint">{t('planned')}: {date(toIso(i.planned.start))} – {date(toIso(i.planned.finish))}</div>
    </aside>
  );
}
