import { type Op, Tree, toIso } from '@wbs-master/engine';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../i18n.js';
import { Icon, TopBar, Var, useToast } from '../ui.js';
import { addChildOps, addSiblingOps, indentOps, moveOps, outdentOps, visibleItems } from './actions.js';
import { Inspector } from './Inspector.js';
import { type EditResult, useProject } from './store.js';
import { TableView } from './TableView.js';

function useCollapsed(projectId: string) {
  const key = `wbs.collapsed.${projectId}`;
  const [set, setSet] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const toggle = useCallback((id: string) => setSet(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* blocked */ }
    return next;
  }), [key]);
  return [set, toggle] as const;
}

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const { t, error, date, dir } = useI18n();
  const toast = useToast();
  const store = useProject(projectId);
  const { data, computed, items } = store;
  const [selected, setSelected] = useState<string | null>(null);
  const [maxLevel, setMaxLevel] = useState(0);
  const [collapsed, toggle] = useCollapsed(projectId);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focusAfter = useRef<string | null>(null);

  const rows = useMemo(() => visibleItems(items, maxLevel, collapsed), [items, maxLevel, collapsed]);
  const tree = useMemo(() => new Tree(items), [items]);
  useEffect(() => { if (selected && !tree.byId.has(selected)) setSelected(null); }, [tree, selected]);
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(`input[data-name="${id}"]`);
      el?.focus();
      el?.select();
    });
  }, [rows]);

  const report = useCallback((r: EditResult) => {
    if (!r.ok) toast(error(r.error ?? 'server_error'));
    else if (r.ignoredDeps.length) toast(t('ignoredDeps', { list: r.ignoredDeps.join(', ') }));
    else if (r.scheduled) toast(t('scheduledN', { n: r.scheduled }));
    return r.ok;
  }, [toast, error, t]);
  const edit = useCallback((ops: Op[]) => report(store.run(ops)), [store, report]);

  const addChild = (parentId: string | null) => {
    if (parentId && collapsed.has(parentId)) toggle(parentId);
    const { ops, id } = addChildOps(parentId, t('newItem'));
    if (edit(ops)) { setSelected(id); focusAfter.current = id; }
  };
  const addSibling = (refId: string) => {
    const { ops, id } = addSiblingOps(items, refId, t('newItem'));
    if (edit(ops)) { setSelected(id); focusAfter.current = id; }
  };
  const doMove = (ops: Op[] | null) => { if (ops) edit(ops); };
  const del = (id: string) => {
    const n = tree.descendants(id).length;
    if (n && armedDelete !== id) { setArmedDelete(id); setTimeout(() => setArmedDelete(a => (a === id ? null : a)), 3500); return; }
    setArmedDelete(null);
    const vis = rows.map(r => r.id);
    const k = vis.indexOf(id);
    const gone = new Set([id, ...tree.descendants(id)]);
    const next = vis.slice(k + 1).find(x => !gone.has(x)) ?? vis.slice(0, k).reverse().find(x => !gone.has(x)) ?? null;
    if (edit([{ op: 'delete', id }])) setSelected(next);
  };

  // keyboard shortcuts (spec 3.3); in Arabic the indent arrows follow the reading direction
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!store.canEdit && !['ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) return;
      const target = e.target as HTMLElement;
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); store.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !inField) { e.preventDefault(); store.redo(); return; }
      if (!selected) return;
      if (e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        if (inField) target.blur();
        const deeper = dir === 'rtl' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
        doMove(deeper ? indentOps(items, selected) : outdentOps(items, selected));
        return;
      }
      if (e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        doMove(moveOps(items, selected, e.key === 'ArrowUp' ? -1 : 1));
        return;
      }
      if (inField) return;
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); addChild(selected); }
      else if (e.key === 'Enter') { e.preventDefault(); addSibling(selected); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(selected); }
      else if (e.key === 'F2') { e.preventDefault(); focusAfter.current = selected; document.querySelector<HTMLInputElement>(`input[data-name="${selected}"]`)?.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const k = rows.findIndex(r => r.id === selected);
        const next = rows[Math.max(0, Math.min(rows.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) { setSelected(next.id); document.querySelector(`tr[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (store.loadError) return <div className="shell"><TopBar /><p className="empty">{error(store.loadError)}</p></div>;
  if (!data || !computed) return <div className="shell"><TopBar /></div>;

  const sel = selected ? tree.byId.get(selected) ?? null : null;
  const selIndex = sel ? tree.kids(tree.parentOf(sel.id)).indexOf(sel) : -1;
  const depth = Math.max(0, ...[...computed.items.values()].map(i => i.level));
  const leaves = [...computed.items.values()].filter(i => !i.childCount);
  const red = leaves.filter(i => i.health === 'red').length, amber = leaves.filter(i => i.health === 'amber').length;
  const p = computed.project;
  const activeBaseline = data.baselines.find(b => b.id === data.project.settings.activeBaselineId) ?? null;
  const saveLabel = { idle: '', saving: t('saving'), saved: t('saved'), error: t('notSaved'), offline: t('offline') }[store.save];

  return (
    <div className="shell">
      <TopBar>
        <input className="title-input" dir="auto" key={data.project.name} defaultValue={data.project.name} aria-label={t('projectName')} disabled={!store.isAdmin}
          onBlur={e => { const v = e.currentTarget.value.trim(); if (v && v !== data.project.name) store.updateProject({ name: v }); }}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
        {saveLabel && <span className="status" data-s={store.save === 'offline' ? 'error' : store.save}>{saveLabel}</span>}
      </TopBar>
      <div className="rail wrap">
        <div className="grp"><span className="lbl">{t('view')}</span>
          <div className="seg">
            <button aria-pressed="true">{t('view_table')}</button>
            <button disabled title={t('comingSoon')}>{t('view_chart')}</button>
            <button disabled title={t('comingSoon')}>{t('view_gantt')}</button>
          </div>
        </div>
        <div className="grp"><span className="lbl">{t('showLevels')}</span>
          <div className="seg lv">
            {Array.from({ length: Math.min(9, Math.max(3, depth)) }, (_, k) => k + 1).map(l => (
              <button key={l} aria-pressed={maxLevel === l} onClick={() => setMaxLevel(l)}>{l}</button>
            ))}
            <button aria-pressed={!maxLevel} onClick={() => setMaxLevel(0)}>{t('all')}</button>
          </div>
        </div>
        {store.canEdit && (
          <div className="grp">
            <button className="ib" onClick={() => addChild(sel?.id ?? null)} title={`${t('addChild')} (Tab)`}>{Icon.child}<span className="lbl-long">{t('addChild')}</span></button>
            <button className="ib" disabled={!sel} onClick={() => sel && addSibling(sel.id)} title={`${t('addSibling')} (Enter)`}>{Icon.sibling}<span className="lbl-long">{t('addSibling')}</span></button>
            <button className="ib" disabled={!sel?.parentId} onClick={() => sel && doMove(outdentOps(items, sel.id))} title={t('outdent')} aria-label={t('outdent')}>{Icon.outdent}</button>
            <button className="ib" disabled={!sel || selIndex < 1} onClick={() => sel && doMove(indentOps(items, sel.id))} title={t('indent')} aria-label={t('indent')}>{Icon.indent}</button>
            <button className="ib" disabled={!sel || selIndex < 1} onClick={() => sel && doMove(moveOps(items, sel.id, -1))} title={t('moveUp')} aria-label={t('moveUp')}>{Icon.up}</button>
            <button className="ib" disabled={!sel || selIndex === tree.kids(tree.parentOf(sel.id)).length - 1} onClick={() => sel && doMove(moveOps(items, sel.id, 1))} title={t('moveDown')} aria-label={t('moveDown')}>{Icon.down}</button>
            <button className={`ib${armedDelete && armedDelete === sel?.id ? ' armed' : ''}`} disabled={!sel} onClick={() => sel && del(sel.id)} title={t('delete')}>
              {Icon.del}<span className="lbl-long">{armedDelete && armedDelete === sel?.id ? t('deleteMany', { n: tree.descendants(sel.id).length + 1 }) : t('delete')}</span>
            </button>
            <button className="ib" disabled={!store.canUndo} onClick={store.undo} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')}>{Icon.undo}</button>
            <button className="ib" disabled={!store.canRedo} onClick={store.redo} title={`${t('redo')} (Ctrl+Y)`} aria-label={t('redo')}>{Icon.redo}</button>
          </div>
        )}
        {store.isAdmin && <button className="ib" onClick={() => setSettingsOpen(true)} title={t('settings')}>{Icon.gear}<span className="lbl-long">{t('settings')}</span></button>}
        <div className="summary">
          {t('summaryLine', { items: items.length, levels: depth, done: p.progress })}
          {p.plannedPct != null && <> {t('vsPlan', { pp: p.plannedPct })}</>}
          {p.forecast.finish != null && <> · {t('finishOn', { date: date(toIso(p.forecast.finish)) })} <Var v={p.variance} /></>}
          {red > 0 && <> · <span style={{ color: 'var(--r)', fontWeight: 600 }}>{t('delayedN', { n: red })}</span></>}
          {amber > 0 && <> · <span style={{ color: 'var(--a)', fontWeight: 600 }}>{t('atRiskN', { n: amber })}</span></>}
        </div>
      </div>
      <main className="work">
        <section className="view" tabIndex={-1}>
          <TableView items={items} rows={rows} computed={computed} canEdit={store.canEdit} selected={selected} collapsed={collapsed}
            maxLevel={maxLevel} activeBaselineName={activeBaseline?.name ?? null} onSelect={setSelected} onToggle={toggle} onEdit={edit}
            onAddChild={addChild} onEnterInName={addSibling} />
        </section>
        <Inspector item={sel} items={items} computed={computed} canEdit={store.canEdit} onEdit={edit} />
      </main>
      {settingsOpen && <SettingsDialog store={store} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function SettingsDialog({ store, onClose }: { store: ReturnType<typeof useProject>; onClose: () => void }) {
  const { t, error } = useI18n();
  const s = store.data!.project.settings;
  const [err, setErr] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const code = await store.updateProject({
      statusDate: String(f.get('statusDate') || '') || null,
      redThresholdDays: Math.max(1, Number(f.get('red')) || 10),
      autoSchedule: f.get('auto') === 'on',
    });
    if (code) setErr(error(code)); else onClose();
  }
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-label={t('settings')} onSubmit={submit} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <h2>{t('settings')}</h2>
        <label className="fld"><span>{t('statusDate')}</span><input type="date" name="statusDate" defaultValue={s.statusDate ?? ''} /><span className="hint">{t('statusDateHint')}</span></label>
        <label className="fld"><span>{t('redThreshold')}</span><input type="number" name="red" min={1} defaultValue={s.redThresholdDays} /></label>
        <label className="chk"><input type="checkbox" name="auto" defaultChecked={s.autoSchedule} /> {t('autoSchedule')}</label>
        {err && <div className="err">{err}</div>}
        <div className="mfoot"><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button><button className="btn primary" type="submit">{t('save')}</button></div>
      </form>
    </div>
  );
}

