import { type ComputedProject, type EditableField, type Op, type Status, Tree, type WbsItem, formatDeps } from '@wbs-master/engine';
import { type KeyboardEvent, useMemo, useRef } from 'react';
import { type MessageKey, useI18n } from '../i18n.js';
import { Pill, Var, Who } from '../ui.js';

const STATUSES: Status[] = ['auto', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'];

export interface TableProps {
  items: WbsItem[];
  rows: WbsItem[];
  computed: ComputedProject;
  canEdit: boolean;
  selected: string | null;
  collapsed: Set<string>;
  maxLevel: number;
  activeBaselineName: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (ops: Op[]) => void;
  onAddChild: (parentId: string | null) => void;
  onEnterInName: (id: string) => void;
  othersByItem?: Map<string, string[]>;
}

/** Text input that commits on blur or Enter and reverts on Escape. Re-mounts when the stored value changes. */
function Cell({ value, onCommit, onEnter, ...rest }: {
  value: string; onCommit: (v: string) => void; onEnter?: () => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  // Enter commits and then moves focus, which blurs: remember what was sent so it is sent once
  const sent = useRef(value);
  const commit = (el: HTMLInputElement) => {
    if (el.value === value || el.value === sent.current) return;
    sent.current = el.value;
    onCommit(el.value);
  };
  return (
    <input
      key={value}
      defaultValue={value}
      onBlur={e => commit(e.currentTarget)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget); onEnter ? onEnter() : e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
      }}
      {...rest}
    />
  );
}

export function TableView(p: TableProps) {
  const { t, reason } = useI18n();
  const tree = useMemo(() => new Tree(p.items), [p.items]);
  const codeById = useMemo(() => new Map([...p.computed.items].map(([id, i]) => [id, i.code])), [p.computed]);
  const set = (id: string, field: EditableField, value: string | number | null) =>
    p.onEdit([{ op: 'set', id, field, value } as Op]);

  const dateCell = (n: WbsItem, field: EditableField, shown: string | null, disabled: boolean, cls = '') => (
    <td className={cls}>
      <Cell
        type="date" value={shown ?? ''} disabled={disabled || !p.canEdit}
        title={disabled ? t('rolledUp') : undefined} aria-label={t(field.startsWith('planned') ? 'planned' : field.startsWith('forecast') ? 'forecast' : 'actual')}
        onCommit={v => set(n.id, field, v || null)}
      />
    </td>
  );

  if (!p.rows.length) {
    return (
      <div className="tbl-wrap">
        <p className="empty">{t('noItems')}</p>
        {p.canEdit && <button className="btn primary" onClick={() => p.onAddChild(null)}>+ {t('addLevel1')}</button>}
      </div>
    );
  }

  return (
    <div className="tbl-wrap">
      <table className="wt">
        <thead>
          <tr>
            <th className="stk1" /><th className="stk2" /><th colSpan={4} />
            <th className="grp-h gs" colSpan={2}>{t('planned')}{p.activeBaselineName ? ` · ${p.activeBaselineName}` : ''}</th>
            <th className="grp-h gs" colSpan={2}>{t('forecast')}</th>
            <th className="grp-h gs" colSpan={2}>{t('actual')}</th>
            <th className="gs" colSpan={5} />
          </tr>
          <tr>
            <th className="stk1">{t('wbs')}</th><th className="stk2">{t('name')}</th>
            <th>{t('owner')}</th><th>{t('status')}</th><th>{t('health')}</th><th style={{ textAlign: 'end' }}>{t('planPct')}</th>
            <th className="gs">{t('start')}</th><th>{t('finish')}</th>
            <th className="gs">{t('start')}</th><th>{t('finish')}</th>
            <th className="gs">{t('start')}</th><th>{t('finish')}</th>
            <th className="gs" title={t('varianceLong')}>{t('variance')}</th>
            <th title={t('dependsHint')}>{t('dependsOn')}</th><th>{t('progress')}</th><th style={{ minWidth: 160 }}>{t('notes')}</th><th />
          </tr>
        </thead>
        <tbody>
          {p.rows.map(n => {
            const i = p.computed.items.get(n.id);
            if (!i) return null;
            const parent = i.childCount > 0;
            const baselineView = !!p.activeBaselineName;
            const iso = (d: number | null) => (d == null ? null : new Date(d * 864e5).toISOString().slice(0, 10));
            const expandable = parent && (!p.maxLevel || i.level < p.maxLevel);
            return (
              <tr key={n.id} data-id={n.id} className={`lv${Math.min(i.level, 6)}${parent ? ' parent' : ''}${p.selected === n.id ? ' sel' : ''}`}
                onMouseDown={() => p.onSelect(n.id)}>
                <td className="code stk1">{i.code}{p.computed.critical.has(n.id) && <> <span className="cp" title={t('critical')}>CP</span></>}<Who names={p.othersByItem?.get(n.id)} /></td>
                <td className="stk2">
                  <div className="namecell" style={{ paddingInlineStart: (i.level - 1) * 16 }}>
                    {expandable
                      ? <button className="tg" onClick={() => p.onToggle(n.id)} aria-label={p.collapsed.has(n.id) ? '+' : '−'}>{p.collapsed.has(n.id) ? (document.dir === 'rtl' ? '◂' : '▸') : '▾'}</button>
                      : <button className="tg none" tabIndex={-1} aria-hidden>·</button>}
                    <Cell value={n.name} data-name={n.id} aria-label={t('name')} dir="auto" disabled={!p.canEdit}
                      onCommit={v => set(n.id, 'name', v)} onEnter={() => p.onEnterInName(n.id)} />
                  </div>
                </td>
                <td><Cell value={n.owner} aria-label={t('owner')} dir="auto" style={{ width: 120 }} disabled={!p.canEdit} onCommit={v => set(n.id, 'owner', v)} /></td>
                <td>
                  {parent
                    ? <select disabled aria-label={t('status')}><option>{t(`status_${i.status}` as MessageKey)}</option></select>
                    : (
                      <select value={n.status} disabled={!p.canEdit} aria-label={t('status')} onChange={e => set(n.id, 'status', e.target.value)}>
                        {STATUSES.map(s => (
                          <option key={s} value={s}>{s === 'auto' ? `${t('status_auto')}: ${t(`status_${i.status}` as MessageKey)}` : t(`status_${s}` as MessageKey)}</option>
                        ))}
                      </select>
                    )}
                </td>
                <td><Pill health={i.health} title={reason(i.reason)} /></td>
                <td className="num muted">{i.plannedPct != null ? `${i.plannedPct}%` : '—'}</td>
                {dateCell(n, 'plannedStart', parent || baselineView ? iso(i.planned.start) : n.plannedStart, parent || baselineView, 'gs')}
                {dateCell(n, 'plannedFinish', parent || baselineView ? iso(i.planned.finish) : n.plannedFinish, parent || baselineView)}
                {dateCell(n, 'forecastStart', parent ? iso(i.forecast.start) : n.forecastStart, parent, 'gs')}
                {dateCell(n, 'forecastFinish', parent ? iso(i.forecast.finish) : n.forecastFinish, parent)}
                {dateCell(n, 'actualStart', parent ? iso(i.actual.start) : n.actualStart, parent, 'gs')}
                {dateCell(n, 'actualFinish', parent ? iso(i.actual.finish) : n.actualFinish, parent)}
                <td className="num gs"><Var v={i.variance} /></td>
                <td>
                  <Cell value={formatDeps(n.deps, codeById)} placeholder="—" aria-label={t('dependsOn')} title={t('dependsHint')} dir="ltr"
                    style={{ width: 110, fontFamily: 'var(--f-mono)', fontSize: 12 }} disabled={!p.canEdit}
                    onCommit={v => p.onEdit([{ op: 'setDeps', id: n.id, text: v }])} />
                </td>
                <td>
                  <Cell value={String(i.progress)} type="number" min={0} max={100} className="pct" aria-label={t('progress')}
                    disabled={parent || i.status === 'completed' || !p.canEdit} onCommit={v => set(n.id, 'progress', Number(v) || 0)} />
                </td>
                <td><Cell value={n.notes} aria-label={t('notes')} dir="auto" style={{ minWidth: 160 }} disabled={!p.canEdit} onCommit={v => set(n.id, 'notes', v)} /></td>
                <td>{p.canEdit && <button className="rowadd" onClick={() => p.onAddChild(n.id)} title={t('addChild')} aria-label={t('addChild')}>+</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.canEdit && (
        <div className="grp" style={{ marginTop: 10, gap: 12 }}>
          <button className="btn" onClick={() => p.onAddChild(null)}>+ {t('addLevel1')}</button>
          <span className="hint">{t('keyboardHint')}</span>
        </div>
      )}
    </div>
  );

}

