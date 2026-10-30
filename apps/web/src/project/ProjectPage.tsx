import { type Op, Tree, toIso } from '@wbs-master/engine';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { Icon, TopBar, Var, useToast } from '../ui.js';
import { addChildOps, addSiblingOps, indentOps, moveOps, outdentOps, visibleItems } from './actions.js';
import { ActivityPanel } from './ActivityPanel.js';
import { BaselinesDialog } from './BaselinesDialog.js';
import { useComments } from './comments.js';
import { CommentsPanel } from './CommentsPanel.js';
import { safeFileName, saveBlob, writeWorkbook } from './excel.js';
import { ImportDialog } from './ImportDialog.js';
import { Inspector } from './Inspector.js';
import { SummaryView } from './SummaryView.js';
import { type EditResult, useProject } from './store.js';
import { TableView } from './TableView.js';
import { ChartView } from './ChartView.js';
import { type GanttOptions, GanttView, type Scale } from './GanttView.js';

type View = 'table' | 'chart' | 'gantt' | 'summary';

/** A per-viewer preference kept in this browser (falls back to the default when storage is blocked). */
function useLocal<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* blocked */ }
  }, [key]);
  return [v, set] as const;
}

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
  const { me } = useSession();
  const selectedRef = useRef<string | null>(null);
  const store = useProject(projectId, me?.user.id ?? null, change => {
    // someone else saved the item this person is working on: say so (spec 3.2, story 6)
    if (selectedRef.current && change.items.includes(selectedRef.current)) toast(t('remoteChanged', { name: change.actorName }));
  });
  const { data, computed, items } = store;
  const [selected, setSelected] = useState<string | null>(null);
  const [maxLevel, setMaxLevel] = useState(0);
  const [view, setView] = useLocal<View>('wbs.view', 'table');
  const [zoom, setZoom] = useLocal('wbs.zoom', 1);
  const [gantt, setGantt] = useLocal<GanttOptions>('wbs.gantt', { scale: 'week', showBaseline: true, showCritical: true, criticalOnly: false });
  const [collapsed, toggle] = useCollapsed(projectId);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baselinesOpen, setBaselinesOpen] = useState(false);
  const [panel, setPanel] = useState<'details' | 'activity' | 'comments'>('details');
  const [commentScope, setCommentScope] = useState<'all' | 'item'>('all');
  const comments = useComments(projectId, store.commentsTick);
  const location = useLocation();
  // opened from the portfolio: start on the Summary view
  useEffect(() => {
    const v = (location.state as { view?: View } | null)?.view;
    if (v) setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  // opened from a notification (?item=…&panel=comments): select the item and show its comments
  const linked = useRef<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const item = q.get('item');
    if (!store.data || linked.current === location.key) return;
    linked.current = location.key;
    if (item && store.items.some(i => i.id === item)) {
      setSelected(item);
      if (view === 'summary') setView('table');
      requestAnimationFrame(() => document.querySelector(`tr[data-id="${item}"]`)?.scrollIntoView({ block: 'center' }));
    }
    if (q.get('panel') === 'comments') { setCommentScope(item ? 'item' : 'all'); setPanel('comments'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, location.search, !!store.data]);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();
  const i18n = useI18n();
  const focusAfter = useRef<string | null>(null);

  const rows = useMemo(() => visibleItems(items, maxLevel, collapsed), [items, maxLevel, collapsed]);
  const codes = useMemo(() => new Map([...(computed?.items ?? new Map()).entries()].map(([id, i]) => [id, i.code as string])), [computed]);
  useEffect(() => { selectedRef.current = selected; store.shareSelection(selected); }, [selected, store.shareSelection]);
  // other people viewing (each person once), and which items they have selected
  const others = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of store.viewers) if (v.userId !== me?.user.id) seen.set(v.userId, v.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [store.viewers, me]);
  const othersByItem = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of store.viewers) {
      if (v.userId === me?.user.id || !v.selected) continue;
      const l = m.get(v.selected) ?? [];
      if (!l.includes(v.name)) l.push(v.name);
      m.set(v.selected, l);
    }
    return m;
  }, [store.viewers, me]);
  const tree = useMemo(() => new Tree(items), [items]);
  useEffect(() => { if (selected && !tree.byId.has(selected)) setSelected(null); }, [tree, selected]);
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    requestAnimationFrame(() => {
      // the table has a name cell per row; the chart and Gantt use the inspector's name field
      const el = document.querySelector<HTMLInputElement>(`input[data-name="${id}"]`) ?? document.querySelector<HTMLInputElement>('input[data-insp-name]');
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
      if (view === 'summary') return; // the summary has text fields, not WBS rows
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
      else if (e.key === 'F2') { e.preventDefault(); (document.querySelector<HTMLInputElement>(`input[data-name="${selected}"]`) ?? document.querySelector<HTMLInputElement>('input[data-insp-name]'))?.focus(); }
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
        {others.length > 0 && (
          <span className="viewers" title={t('alsoViewing', { names: others.map(o => o.name).join(', ') })}>
            {others.slice(0, 5).map(o => <span key={o.id} className="av" style={{ background: avatarColor(o.id) }}>{initials(o.name)}</span>)}
            {others.length > 5 && <span className="av more">+{others.length - 5}</span>}
          </span>
        )}
      </TopBar>
      {data.project.readOnly === 'plan' && <div className="notice warn" role="note">{t('readOnlyPlan')}</div>}
      {data.project.readOnly === 'deletion' && <div className="notice warn" role="note">{t('readOnlyDeletion', { date: date(data.project.deleteOn) })}</div>}
      <div className="rail wrap">
        <div className="grp"><span className="lbl">{t('view')}</span>
          <div className="seg">
            {(['table', 'chart', 'gantt', 'summary'] as const).map(v => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{t(`view_${v}`)}</button>
            ))}
          </div>
        </div>
        {view === 'chart' && (
          <div className="grp"><span className="lbl">{t('zoom')}</span>
            <div className="seg">
              {[0.6, 0.8, 1].map(z => <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{Math.round(z * 100)}%</button>)}
            </div>
          </div>
        )}
        {view === 'gantt' && (
          <div className="grp"><span className="lbl">{t('scale')}</span>
            <div className="seg">
              {(['day', 'week', 'month', 'quarter'] as Scale[]).map(sc => (
                <button key={sc} aria-pressed={gantt.scale === sc} onClick={() => setGantt({ ...gantt, scale: sc })}>{t(`scale_${sc}`)}</button>
              ))}
            </div>
            <label className="chk sm"><input type="checkbox" checked={gantt.showBaseline} onChange={e => setGantt({ ...gantt, showBaseline: e.target.checked })} /> {t('showBaseline')}</label>
            <label className="chk sm"><input type="checkbox" checked={gantt.showCritical} onChange={e => setGantt({ ...gantt, showCritical: e.target.checked })} /> {t('critical')}</label>
            <label className="chk sm"><input type="checkbox" checked={gantt.criticalOnly} onChange={e => setGantt({ ...gantt, criticalOnly: e.target.checked })} /> {t('criticalOnly')}</label>
          </div>
        )}
        <div className="grp"><span className="lbl">{t('showLevels')}</span>
          <div className="seg lv">
            {Array.from({ length: Math.min(9, Math.max(3, depth)) }, (_, k) => k + 1).map(l => (
              <button key={l} aria-pressed={maxLevel === l} onClick={() => setMaxLevel(l)}>{l}</button>
            ))}
            <button aria-pressed={!maxLevel} onClick={() => setMaxLevel(0)}>{t('all')}</button>
          </div>
        </div>
        {store.canEdit && view !== 'summary' && (
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
        <div className="grp">
          <button className="ib" onClick={() => setBaselinesOpen(true)} title={t('baselines')}>{Icon.baseline}<span className="lbl-long">{t('baselines')}</span></button>
          {activeBaseline && (
            <span className="base-chip">{t('comparingTo', { name: activeBaseline.name })}
              {store.isAdmin && <button onClick={() => store.baselines.compare(null)} title={t('backToLatest')} aria-label={t('backToLatest')}>×</button>}
            </span>
          )}
          {store.canEdit && <button className="ib" onClick={() => setImportOpen(true)} title={t('importExcel')}>{Icon.importIcon}<span className="lbl-long">{t('importExcel')}</span></button>}
          {/* the demo runs in a viewer that blocks downloads */}
          {import.meta.env.MODE !== 'demo' && (
            <button className="ib" title={t('exportExcel')} onClick={async () => {
              const blob = await writeWorkbook({
                projectId: data.project.id, name: data.project.name, items, computed, summary: data.summary, baselines: data.baselines, i18n,
              });
              saveBlob(blob, `${safeFileName(data.project.name)}.xlsx`);
              toast(t('exported'));
            }}>{Icon.exportIcon}<span className="lbl-long">{t('exportExcel')}</span></button>
          )}
          {view !== 'summary' && (
            <button className="ib" aria-pressed={panel === 'comments'} onClick={() => { setCommentScope('all'); setPanel(x => (x === 'comments' ? 'details' : 'comments')); }} title={t('comments')}>
              {Icon.comment}<span className="lbl-long">{t('comments')}</span>{comments.open > 0 && <span className="count" aria-label={t('openThreadsN', { n: comments.open })}>{comments.open}</span>}
            </button>
          )}
          {view !== 'summary' && <button className="ib" aria-pressed={panel === 'activity'} onClick={() => setPanel(x => (x === 'activity' ? 'details' : 'activity'))} title={t('activity')}>{Icon.history}<span className="lbl-long">{t('activity')}</span></button>}
          {store.isAdmin && <button className="ib" onClick={() => setSettingsOpen(true)} title={t('settings')}>{Icon.gear}<span className="lbl-long">{t('settings')}</span></button>}
        </div>
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
          {view === 'table' && (
            <TableView items={items} rows={rows} computed={computed} canEdit={store.canEdit} selected={selected} collapsed={collapsed}
              maxLevel={maxLevel} activeBaselineName={activeBaseline?.name ?? null} onSelect={setSelected} onToggle={toggle} onEdit={edit}
              onAddChild={addChild} onEnterInName={addSibling} othersByItem={othersByItem} />
          )}
          {view === 'chart' && (
            <ChartView projectName={data.project.name} items={items} computed={computed} canEdit={store.canEdit} selected={selected}
              collapsed={collapsed} maxLevel={maxLevel} zoom={zoom} showCritical onSelect={setSelected} onToggle={toggle}
              onAddChild={addChild} onEdit={edit} othersByItem={othersByItem}
              onRename={id => { setSelected(id); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[data-insp-name]')?.select()); }} />
          )}
          {view === 'gantt' && (
            <GanttView items={items} rows={rows} computed={computed} calendar={store.calendar} canEdit={store.canEdit} selected={selected}
              collapsed={collapsed} maxLevel={maxLevel} options={gantt} onSelect={setSelected} onToggle={toggle} onEdit={edit} othersByItem={othersByItem} />
          )}
        
          {view === 'summary' && <SummaryView store={store} computed={computed} maxLevel={maxLevel} />}
        </section>
        {view !== 'summary' && panel === 'activity' && <ActivityPanel store={store} items={items} codes={codes} selected={selected} onClose={() => setPanel('details')} />}
        {view !== 'summary' && panel === 'comments' && (
          <CommentsPanel store={comments} items={items} codes={codes} selected={selected} meId={me?.user.id ?? null} isAdmin={store.isAdmin}
            canComment={store.canComment} scope={commentScope} onScope={setCommentScope} onSelectItem={setSelected} onClose={() => setPanel('details')} />
        )}
        {view !== 'summary' && panel === 'details' && (
          <Inspector item={sel} items={items} computed={computed} canEdit={store.canEdit} onEdit={edit}
            openComments={sel ? comments.openByItem.get(sel.id) ?? 0 : 0}
            onComments={() => { setCommentScope('item'); setPanel('comments'); }} />
        )}
      </main>
      {settingsOpen && <SettingsDialog store={store} onClose={() => setSettingsOpen(false)} />}
      {baselinesOpen && <BaselinesDialog store={store} onClose={() => setBaselinesOpen(false)} />}
      {importOpen && (
        <ImportDialog orgId={data.project.orgId} project={{ id: data.project.id, name: data.project.name, items, canEdit: store.canEdit }}
          applyToProject={edit} onClose={() => setImportOpen(false)}
          onCreated={id => { setImportOpen(false); navigate(`/p/${id}`); }} />
      )}
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

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
/** A stable colour per person, from their id. */
export function avatarColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}
