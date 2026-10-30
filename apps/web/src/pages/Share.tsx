import {
  type Baseline, type CalendarDefinition, type ProjectSettings, type WbsItem, WorkCalendar, computeProject, toIso, todayDay,
} from '@wbs-master/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { type MessageKey, useI18n } from '../i18n.js';
import { visibleItems } from '../project/actions.js';
import { ChartView } from '../project/ChartView.js';
import { type GanttOptions, GanttView, type Scale } from '../project/GanttView.js';
import type { Summary } from '../project/store.js';
import { type SummaryStore, SummaryView } from '../project/SummaryView.js';
import { TableView } from '../project/TableView.js';
import { type Theme, useSession } from '../session.js';
import { Var } from '../ui.js';

type View = 'table' | 'chart' | 'gantt' | 'summary';

/** What a public link returns: the chosen views and only what they need. */
interface SharePayload {
  project: { name: string; locale: string; archived: boolean; settings: ProjectSettings };
  views: View[];
  showOwners: boolean;
  expiresAt: string | null;
  items: WbsItem[];
  baselines: Baseline[];
  calendar: CalendarDefinition;
  summary: Summary | null;
}

const NEXT_THEME: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
const EMPTY_SUMMARY: Summary = { narrative: '', achievements: '', nextSteps: '', risks: '', decisions: '' };
const noop = () => false;

/** Keep shared plans out of search engines while the page is open. */
function useNoIndex() {
  useEffect(() => {
    const robots = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    const referrer = Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' });
    document.head.append(robots, referrer);
    return () => { robots.remove(); referrer.remove(); };
  }, []);
}

/**
 * A project shared through a public read-only link (`/share/:token`): no sign-in, the existing views
 * with editing off, and nothing else (no comments, activity, presence or people).
 */
export function SharePage() {
  const { token = '' } = useParams();
  const { t, error, date, locale, setLocale } = useI18n();
  const { theme, setTheme } = useSession();
  const [data, setData] = useState<SharePayload | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>('table');
  const [maxLevel, setMaxLevel] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [gantt, setGantt] = useState<GanttOptions>({ scale: 'week', showBaseline: true, showCritical: true, criticalOnly: false });
  useNoIndex();

  useEffect(() => {
    api.get<SharePayload>(`/share/${encodeURIComponent(token)}`).then(p => {
      setData(p);
      setView(p.views[0] ?? 'table');
      document.title = `${p.project.name} · ${t('app')}`;
    }, x => setErr(error(x instanceof ApiError ? x.code : 'server_error')));
    // load once per link, not again when the language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const calendar = useMemo(() => new WorkCalendar(data?.calendar), [data]);
  const model = useMemo(() => data && ({
    id: 'shared', name: data.project.name, items: data.items, baselines: data.baselines, settings: data.project.settings,
  }), [data]);
  const computed = useMemo(() => (model ? computeProject(model, { calendar, today: todayDay() }) : null), [model, calendar]);
  const rows = useMemo(() => visibleItems(data?.items ?? [], maxLevel, collapsed), [data, maxLevel, collapsed]);
  const toggle = useCallback((id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  // the summary takes the editor's store; here it is read-only data
  const summaryStore: SummaryStore | null = useMemo(() => data && model && ({
    data: {
      project: { id: 'shared', orgId: '', name: data.project.name, version: 0, calendarId: null, locale: data.project.locale, archived: data.project.archived, readOnly: 'archived', settings: data.project.settings },
      role: 'viewer', items: data.items, baselines: data.baselines, calendar: data.calendar, summary: data.summary ?? EMPTY_SUMMARY,
    },
    model, canEdit: false, saveSummary: async () => {}, calendar,
  }), [data, model, calendar]);

  const bar = (
    <header className="top wrap">
      <span className="mark"><i><b /><b /><b /><b /></i>{t('app')}</span>
      {data && <h1 className="share-title" dir="auto">{data.project.name}</h1>}
      <span className="sp" />
      <span className="demo-chip share-chip" role="note">{t('sharedNote')}</span>
      <button className="btn" onClick={() => setTheme(NEXT_THEME[theme])} title={t('theme')}>{t(`theme_${theme}` as MessageKey)}</button>
      <button className="btn" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')} lang={locale === 'en' ? 'ar' : 'en'}>{t('language')}</button>
    </header>
  );

  if (err) return <div className="shell">{bar}<div className="auth"><p className="err" role="alert">{err}</p></div></div>;
  if (!data || !computed || !summaryStore) return <div className="shell">{bar}</div>;

  const depth = Math.max(0, ...[...computed.items.values()].map(i => i.level));
  const leaves = [...computed.items.values()].filter(i => !i.childCount);
  const red = leaves.filter(i => i.health === 'red').length, amber = leaves.filter(i => i.health === 'amber').length;
  const p = computed.project;
  const activeBaseline = data.baselines.find(b => b.id === data.project.settings.activeBaselineId) ?? null;

  return (
    <div className="shell">
      {bar}
      {data.project.archived && <div className="notice" role="note">{t('shareArchived')}</div>}
      <div className="rail wrap">
        {data.views.length > 1 && (
          <div className="grp"><span className="lbl">{t('view')}</span>
            <div className="seg">
              {data.views.map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{t(`view_${v}`)}</button>)}
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
        <div className="summary">
          {t('summaryLine', { items: data.items.length, levels: depth, done: p.progress })}
          {p.plannedPct != null && <> {t('vsPlan', { pp: p.plannedPct })}</>}
          {p.forecast.finish != null && <> · {t('finishOn', { date: date(toIso(p.forecast.finish)) })} <Var v={p.variance} /></>}
          {red > 0 && <> · <span style={{ color: 'var(--r)', fontWeight: 600 }}>{t('delayedN', { n: red })}</span></>}
          {amber > 0 && <> · <span style={{ color: 'var(--a)', fontWeight: 600 }}>{t('atRiskN', { n: amber })}</span></>}
        </div>
      </div>
      <main className="work">
        <section className="view" tabIndex={-1}>
          {view === 'table' && (
            <TableView items={data.items} rows={rows} computed={computed} canEdit={false} selected={selected} collapsed={collapsed}
              maxLevel={maxLevel} activeBaselineName={activeBaseline?.name ?? null} onSelect={setSelected} onToggle={toggle} onEdit={noop}
              onAddChild={noop} onEnterInName={noop} hideOwner={!data.showOwners} hideNotes />
          )}
          {view === 'chart' && (
            <ChartView projectName={data.project.name} items={data.items} computed={computed} canEdit={false} selected={selected}
              collapsed={collapsed} maxLevel={maxLevel} zoom={1} showCritical onSelect={setSelected} onToggle={toggle}
              onAddChild={noop} onEdit={noop} onRename={noop} />
          )}
          {view === 'gantt' && (
            <GanttView items={data.items} rows={rows} computed={computed} calendar={calendar} canEdit={false} selected={selected}
              collapsed={collapsed} maxLevel={maxLevel} options={gantt} onSelect={setSelected} onToggle={toggle} onEdit={noop} />
          )}
          {view === 'summary' && <SummaryView store={summaryStore} computed={computed} maxLevel={maxLevel} />}
        </section>
      </main>
      {data.expiresAt && <p className="hint share-foot">{t('shareUntil', { date: date(new Date(new Date(data.expiresAt).getTime() - 1).toISOString().slice(0, 10)) })}</p>}
    </div>
  );
}
