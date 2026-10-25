import {
  type EarlyWarning, type PortfolioEntry, type PortfolioNote, type TeamRow, portfolioTotals, teamView, toDay, toIso,
} from '@wbs-master/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { type I18n, useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { Icon, Pill, TopBar, Var, useToast } from '../ui.js';

type Mode = 'exec' | 'team';
const HORIZONS = [14, 30, 60] as const;

/** A per-viewer preference kept in this browser. */
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

const shortName = (s: string) => (s.length > 26 ? `${s.slice(0, 25)}…` : s);

function noteText(n: PortfolioNote, i18n: I18n) {
  if ('text' in n) return n.text;
  if ('recovery' in n) return i18n.t('pfRecovery', { name: n.recovery.name, v: n.recovery.variance ? ` (+${n.recovery.variance})` : '' });
  return `${n.item.name}: ${i18n.reason(n.item.reason)}`;
}

function warningText(w: EarlyWarning, i18n: I18n) {
  switch (w.code) {
    case 'waits': return i18n.t('w_waits', { code: w.predCode, name: w.predName, health: i18n.t(`health_${w.health}`) });
    case 'late_start': return i18n.t('w_late_start', { date: i18n.date(w.date) });
    case 'on_hold': return i18n.t('w_on_hold');
    case 'behind_plan': return i18n.t('w_behind_plan', { progress: w.progress, planned: w.planned });
    case 'health': return i18n.reason(w.reason);
  }
}

/** Finish slip over time, as a small line (spec 4.9 trend). */
function Spark({ trend }: { trend: PortfolioEntry['trend'] }) {
  const { t } = useI18n();
  const pts = trend.filter(x => x.variance != null).slice(-30) as { date: string; variance: number }[];
  if (pts.length < 2) return <span className="hint">—</span>;
  const W = 92, H = 26, vs = pts.map(p => p.variance), mn = Math.min(0, ...vs), mx = Math.max(0, ...vs);
  const sy = (v: number) => (mx === mn ? H / 2 : 3 + (H - 6) * (1 - (v - mn) / (mx - mn)));
  const sx = (k: number) => 3 + (k * (W - 6)) / (pts.length - 1);
  const last = vs[vs.length - 1]!, prev = vs[Math.max(0, vs.length - 5)]!;
  const col = last > prev ? 'var(--r)' : last < prev ? 'var(--g)' : 'var(--muted)';
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('pfTrendLabel', { from: vs[0]!, to: last })}>
      <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="var(--line)" strokeDasharray="2 2" />
      <polyline fill="none" stroke={col} strokeWidth={1.8} strokeLinejoin="round" points={pts.map((p, k) => `${sx(k).toFixed(1)},${sy(p.variance).toFixed(1)}`).join(' ')} />
      <circle cx={sx(pts.length - 1)} cy={sy(last)} r={2.8} fill={col} />
    </svg>
  );
}

/** Plan (thin grey) and forecast (coloured) per project, with the status date line; mirrored in Arabic. */
function Roadmap({ entries, statusDate }: { entries: PortfolioEntry[]; statusDate: string }) {
  const { t, date, dir, locale } = useI18n();
  let s: number | null = null, e: number | null = null;
  const ext = (iso: string | null) => {
    const d = toDay(iso);
    if (d == null) return;
    if (s == null || d < s) s = d;
    if (e == null || d > e) e = d;
  };
  for (const a of entries) { ext(a.plannedStart); ext(a.plannedFinish); ext(a.forecastStart); ext(a.forecastFinish); }
  if (s == null || e == null) return <p className="hint">{t('pfNoDates')}</p>;
  ext(statusDate);
  const S = s as number, E = e as number;
  const W = 1000, L = 240, RW = 84, rh = 32, H = entries.length * rh + 30;
  const rtl = dir === 'rtl';
  // in Arabic time runs right to left and the names sit on the right
  const X = (d: number) => { const x = L + ((d - S) * (W - L - RW)) / Math.max(1, E - S); return rtl ? W - x : x; };
  const w = (a: number, b: number) => Math.max(2, Math.abs(X(b + 1) - X(a)));
  const left = (a: number, b: number) => Math.min(X(a), X(b + 1));
  const months: { x: number; label: string }[] = [];
  const span = E - S, step = span > 1100 ? 6 : span > 500 ? 3 : 1;
  const first = new Date(S * 864e5);
  const mf = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); ; m += step) {
    while (m > 11) { m -= 12; y++; }
    const d = Date.UTC(y, m, 1) / 864e5;
    if (d > E) break;
    if (d >= S) months.push({ x: X(d), label: mf.format(new Date(d * 864e5)) });
  }
  const color = { red: 'var(--r)', amber: 'var(--a)', green: 'var(--g)', done: 'var(--done)', none: 'var(--muted)' };
  const tx = X(toDay(statusDate)!);
  return (
    <div className="rt-wrap">
      {/* positions are mirrored by X() in Arabic, so the drawing itself stays left-to-right and text-anchor keeps its meaning */}
      <svg className="road" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 660 }} direction="ltr" role="img" aria-label={t('pfRoadmapLabel')}>
        {months.map(m => (
          <g key={m.x}>
            <line x1={m.x} x2={m.x} y1={18} y2={H} stroke="var(--line2)" />
            <text x={m.x + (rtl ? -3 : 3)} y={12} textAnchor={rtl ? 'end' : 'start'}>{m.label}</text>
          </g>
        ))}
        {entries.map((a, k) => {
          const y0 = 24 + k * rh;
          const bs = toDay(a.plannedStart), be = toDay(a.plannedFinish), fs = toDay(a.forecastStart), fe = toDay(a.forecastFinish);
          return (
            <g key={a.id}>
              <text className="lbl" x={rtl ? W : 0} y={y0 + 14} textAnchor={rtl ? 'end' : 'start'}>{a.name.length > 34 ? `${a.name.slice(0, 33)}…` : a.name}</text>
              {bs != null && be != null && (
                <rect x={left(bs, be)} y={y0 + 18} width={w(bs, be)} height={5} rx={2} fill="var(--base, var(--muted))">
                  <title>{t('pfPlanRange', { from: date(a.plannedStart), to: date(a.plannedFinish) })}</title>
                </rect>
              )}
              {fs != null && fe != null && (
                <>
                  <rect x={left(fs, fe)} y={y0 + 4} width={w(fs, fe)} height={11} rx={3} fill={color[a.overall]}>
                    <title>{t('pfForecastRange', { from: date(a.forecastStart), to: date(a.forecastFinish) })}</title>
                  </rect>
                  <text x={X(fe + 1) + (rtl ? -6 : 6)} y={y0 + 13} textAnchor={rtl ? 'end' : 'start'} direction="ltr"
                    style={{ fill: (a.variance ?? 0) > 0 ? 'var(--r)' : 'var(--muted)', fontWeight: 600 }}>
                    {a.variance ? `${a.variance > 0 ? '+' : ''}${a.variance}${t('daysShort')}` : t('onPlan')}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <line x1={tx} x2={tx} y1={16} y2={H} stroke="var(--danger)" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function ExecView({ entries, statusDate, open }: { entries: PortfolioEntry[]; statusDate: string; open: (id: string) => void }) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const T = portfolioTotals(entries);
  const seg = (k: 'done' | 'green' | 'amber' | 'red', c: string) => (T.counts[k]
    ? <i style={{ width: `${(100 * T.counts[k]) / T.projects}%`, background: `var(--${c})` }} title={`${t(`health_${k}`)}: ${T.counts[k]}`} /> : null);
  const t0 = toDay(statusDate)!;
  const ms = entries.flatMap(a => a.milestones.map(x => ({ a, x })))
    .filter(({ x }) => toDay(x.forecastFinish)! <= t0 + 60)
    .sort((u, v) => toDay(u.x.forecastFinish)! - toDay(v.x.forecastFinish)!);
  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="k">{t('pfHealth', { n: T.projects })}</div>
          <div className="v pf-counts"><span style={{ color: 'var(--r)' }}>{t('delayedN', { n: T.counts.red })}</span><span style={{ color: 'var(--a)' }}>{t('atRiskN', { n: T.counts.amber })}</span><span style={{ color: 'var(--g)' }}>{t('onTrackN', { n: T.counts.green })}</span></div>
          <div className="stack">{seg('done', 'done')}{seg('green', 'g')}{seg('amber', 'a')}{seg('red', 'r')}</div>
          <div className="s">{T.counts.done ? t('completeN', { n: T.counts.done }) : t('pfWorstFirst')}</div></div>
        <div className="kpi"><div className="k">{t('pfAvgProgress')}</div><div className="v">{T.avgProgress}%</div>
          <div className="pbar"><div className="f" style={{ width: `${T.avgProgress}%` }} />{T.avgPlanned != null && <div className="m" style={{ insetInlineStart: `${T.avgPlanned}%` }} />}</div>
          <div className="s">{T.avgPlanned != null ? t('pfPlannedByNow', { n: T.avgPlanned }) : t('pfNoBaselines')}</div></div>
        <div className="kpi"><div className="k">{t('pfSlipping')}</div><div className="v">{T.slipping} <small className="muted">{t('ofN', { n: T.projects })}</small></div>
          <div className="s">{t('pfLargestSlip')} {T.largestSlip ? <Var v={T.largestSlip} /> : '—'}</div></div>
        <div className="kpi"><div className="k">{t('pfDecisions')}</div><div className="v">{T.decisions}</div>
          <div className="s">{t('pfAcrossN', { n: T.projectsWithDecisions })}</div></div>
      </div>
      <div className="cols2">
        <div className="sec"><h2>{t('pfDecisions')} <small>{T.decisions}</small></h2>
          {T.decisions ? (
            <ul className="ilist">{entries.flatMap(a => a.decisions.map((d, k) => (
              <li key={`${a.id}${k}`}><span className="ptag" dir="auto">{shortName(a.name)}</span>
                <span dir="auto">{noteText(d, i18n)}{a.decisionsSuggested && <span className="hint"> · {t('pfSuggested')}</span>}</span></li>
            )))}</ul>
          ) : <p className="hint">{t('pfNoDecisions')}</p>}
        </div>
        <div className="sec"><h2>{t('pfRisks')}</h2>
          {entries.some(a => a.risks.length) ? (
            <ul className="ilist">{entries.flatMap(a => a.risks.map((r, k) => (
              <li key={`${a.id}${k}`}><span className="ptag" dir="auto">{shortName(a.name)}</span><span dir="auto">{noteText(r, i18n)}</span></li>
            )))}</ul>
          ) : <p className="hint">{t('pfNoRisks')}</p>}
        </div>
      </div>
      <div className="sec"><h2>{t('pfRoadmap')} <small>{t('pfRoadmapHint')}</small></h2><Roadmap entries={entries} statusDate={statusDate} /></div>
      <div className="sec"><h2>{t('pfProjects')} <small>{t('pfTrendHint')}</small></h2>
        <div className="rt-wrap"><table className="rt">
          <thead><tr><th>{t('project')}</th><th>{t('health')}</th><th>{t('pfDoneVsPlan')}</th><th>{t('plannedFinish')}</th><th>{t('forecast')}</th><th>{t('variance')}</th><th>{t('pfTrend')}</th><th>{t('pfDelayedItems')}</th></tr></thead>
          <tbody>{entries.map(a => (
            <tr key={a.id}>
              <td><button className="linkish" dir="auto" onClick={() => open(a.id)}>{a.name}</button>
                {a.topIssue && <div className="hint" dir="auto">{a.topIssue.name}: {i18n.reason(a.topIssue.reason)}</div>}</td>
              <td><Pill health={a.overall} /></td>
              <td className="nw"><div className="pbar mini"><div className="f" style={{ width: `${a.progress}%` }} />{a.plannedPct != null && <div className="m" style={{ insetInlineStart: `${a.plannedPct}%` }} />}</div>
                <span className="hint">{a.progress}%{a.plannedPct != null ? ` / ${t('pctPlan', { n: a.plannedPct })}` : ''}</span></td>
              <td className="nw">{date(a.plannedFinish)}</td><td className="nw">{date(a.forecastFinish)}</td>
              <td className="nw"><Var v={a.variance} /></td><td><Spark trend={a.trend} /></td>
              <td className="nw" style={{ textAlign: 'center' }}>{a.counts.red}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="sec"><h2>{t('pfMilestones')} <small>{ms.length}</small></h2>
        {ms.length ? (
          <div className="rt-wrap"><table className="rt"><tbody>{ms.map(({ a, x }) => (
            <tr key={`${a.id}${x.itemId}`}><td><span className="ptag" dir="auto">{shortName(a.name)}</span></td><td dir="auto">{x.name}</td>
              <td className="nw">{t('planOn', { date: date(x.plannedFinish) })}</td><td className="nw">{t('forecastOn', { date: date(x.forecastFinish) })}</td>
              <td><Var v={x.variance} /></td><td><Pill health={x.health} /></td></tr>
          ))}</tbody></table></div>
        ) : <p className="hint">{t('pfNoMilestones')}</p>}
      </div>
    </>
  );
}

function TeamView({ entries, owner, setOwner, horizon, setHorizon }: {
  entries: PortfolioEntry[]; owner: string; setOwner: (o: string) => void; horizon: number; setHorizon: (h: number) => void;
}) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const D = teamView(entries, { owner, horizon });
  const lmax = Math.max(1, ...D.workload.map(([, n]) => n));
  const table = (rows: TeamRow[], extra: (x: TeamRow) => string, empty: string) => (rows.length ? (
    <div className="rt-wrap"><table className="rt">
      <thead><tr><th>{t('project')}</th><th>WBS</th><th>{t('task')}</th><th>{t('owner')}</th><th>{t('forecast')}</th><th>{t('done')}</th><th>{t('health')}</th></tr></thead>
      <tbody>{rows.slice(0, 80).map(x => (
        <tr key={`${x.projectId}${x.itemId}`} className={`lv${Math.min(6, x.level)}`}>
          <td><span className="ptag" dir="auto">{shortName(x.projectName)}</span></td><td className="c" dir="ltr">{x.code}</td>
          <td><span dir="auto">{x.name}</span>{x.critical && <> <span className="cp" title={t('critical')}>CP</span></>}<div className="hint" dir="auto">{extra(x)}</div></td>
          <td className="nw" dir="auto">{x.owner || '—'}</td>
          <td className="nw">{date(x.forecastStart)} – {date(x.forecastFinish)}</td><td className="nw">{x.progress}%</td><td><Pill health={x.health} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  ) : <p className="hint">{empty}</p>);
  return (
    <>
      <div className="sec"><h2>{t('filter')}</h2>
        <div className="grp" style={{ gap: 14, alignItems: 'flex-end' }}>
          <label className="fld" style={{ width: 230 }}><span>{t('owner')}</span>
            <select value={owner} onChange={e => setOwner(e.target.value)}>
              <option value="">{t('everyone')}</option>
              {D.owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <div className="fld"><span>{t('lookAhead')}</span>
            <div className="seg">{HORIZONS.map(h => <button key={h} aria-pressed={horizon === h} onClick={() => setHorizon(h)}>{t('nDays', { n: h })}</button>)}</div>
          </div>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="k">{t('overdue')}</div><div className="v" style={{ color: 'var(--r)' }}>{D.overdue.length}</div><div className="s">{t('pfOverdueHint')}</div></div>
        <div className="kpi"><div className="k">{t('pfDueOrStarting')}</div><div className="v">{D.upcoming.length}</div><div className="s">{t('pfInNextDays', { n: horizon })}{owner ? ` · ${owner}` : ''}</div></div>
        <div className="kpi"><div className="k">{t('pfWarnings')}</div><div className="v" style={{ color: 'var(--a)' }}>{D.warnings.length}</div><div className="s">{t('pfWarningsHint')}</div></div>
        <div className="kpi"><div className="k">{t('pfCriticalWatch')}</div><div className="v">{D.criticalToWatch}</div><div className="s">{t('pfCriticalHint')}</div></div>
      </div>
      <div className="sec"><h2>{t('overdue')} <small>{D.overdue.length}</small></h2>
        {table(D.overdue, x => [t('pfDaysPast', { n: -(x.finishIn ?? 0) }), x.notes].filter(Boolean).join(' · '), t('pfNothingOverdue'))}</div>
      <div className="sec"><h2>{t('pfToDo', { n: horizon })} <small>{D.upcoming.length}</small></h2>
        {table(D.upcoming, x => (x.notStarted && x.startIn != null && x.startIn <= horizon ? t('startsOn', { date: date(x.forecastStart) }) : t('dueOn', { date: date(x.forecastFinish) })), t('pfNothingDue'))}</div>
      <div className="sec"><h2>{t('pfWarnings')} <small>{t('pfWarningsSub')}</small></h2>
        {table(D.warnings, x => (x.warning ? warningText(x.warning, i18n) : ''), t('pfNoWarnings'))}</div>
      <div className="sec"><h2>{t('pfWorkload')} <small>{t('pfWorkloadHint', { n: horizon })}</small></h2>
        {D.workload.length ? D.workload.map(([o, n]) => (
          <div key={o} className="owner-bar"><span dir="auto">{o || t('unassigned')}</span><div className="track"><div className="b" style={{ width: `${(100 * n) / lmax}%` }} /></div><span className="hint" style={{ textAlign: 'end' }}>{n}</span></div>
        )) : <p className="hint">{t('pfNoWorkload')}</p>}
      </div>
    </>
  );
}

/** Plain text for email or Teams (spec 6.4 "copy as text"). */
function asText(mode: Mode, entries: PortfolioEntry[], statusDate: string, owner: string, horizon: number, i18n: I18n) {
  const { t, date } = i18n;
  const L = [t(mode === 'exec' ? 'pfExecTitle' : 'pfTeamTitle').toUpperCase(), t('pfTextHead', { date: date(statusDate), n: entries.length }), ''];
  if (mode === 'exec') {
    for (const a of entries) {
      L.push(`• ${a.name}: ${t(`health_${a.overall}`)} · ${t('pctDone', { n: a.progress })}${a.plannedPct != null ? ` (${t('pctPlan', { n: a.plannedPct })})` : ''} · ${t('finishOn', { date: date(a.forecastFinish) })}${a.variance ? ` (${a.variance > 0 ? '+' : ''}${a.variance}${t('daysShort')})` : ''}${a.topIssue ? ` — ${a.topIssue.name}: ${i18n.reason(a.topIssue.reason)}` : ''}`);
    }
    L.push('', t('pfDecisions').toUpperCase());
    for (const a of entries) for (const d of a.decisions) L.push(`• [${shortName(a.name)}] ${noteText(d, i18n)}`);
    L.push('', t('pfRisks').toUpperCase());
    for (const a of entries) for (const r of a.risks) L.push(`• [${shortName(a.name)}] ${noteText(r, i18n)}`);
  } else {
    const D = teamView(entries, { owner, horizon });
    const ln = (x: TeamRow) => `• [${shortName(x.projectName)}] ${x.code} ${x.name} — ${x.owner || t('unassigned')}, ${date(x.forecastStart)}–${date(x.forecastFinish)}${x.critical ? ` (${t('critical')})` : ''}`;
    if (owner) L.push(`${t('owner')}: ${owner}`, '');
    const block = (title: string, rows: TeamRow[], extra?: (x: TeamRow) => string) => {
      L.push(title.toUpperCase());
      for (const x of rows) L.push(ln(x) + (extra ? ` — ${extra(x)}` : ''));
      if (!rows.length) L.push(`• ${t('none')}`);
      L.push('');
    };
    block(t('overdue'), D.overdue);
    block(t('pfToDo', { n: horizon }), D.upcoming);
    block(t('pfWarnings'), D.warnings, x => (x.warning ? warningText(x.warning, i18n) : ''));
  }
  return L.join('\n').trim();
}

/** Portfolio (spec 4.9, FR-15): every project the person can see, worst first, for executives or the project team. */
export function PortfolioPage() {
  const { orgId = '' } = useParams();
  const i18n = useI18n();
  const { t, error, date } = i18n;
  const toast = useToast();
  const nav = useNavigate();
  const { me } = useSession();
  const org = me?.organisations.find(o => o.id === orgId);
  const [mode, setMode] = useLocal<Mode>('wbs.pf.mode', 'exec');
  const [excluded, setExcluded] = useLocal<string[]>(`wbs.pf.excluded.${orgId}`, []);
  const [horizon, setHorizon] = useLocal<number>('wbs.pf.horizon', 30);
  const [owner, setOwner] = useState('');
  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<{ statusDate: string; projects: PortfolioEntry[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await api.get(`/orgs/${orgId}/portfolio${asOf ? `?asOf=${asOf}` : ''}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'server_error');
    }
  }, [orgId, asOf]);
  useEffect(() => { load(); }, [load]);

  const chosen = useMemo(() => (data?.projects ?? []).filter(p => !excluded.includes(p.id)), [data, excluded]);
  const toggle = (id: string) => setExcluded(excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id]);
  const open = (id: string) => nav(`/p/${id}`, { state: { view: 'summary' } });
  const statusDate = data?.statusDate ?? toIso(Math.floor(Date.now() / 864e5))!;

  return (
    <div className="shell">
      <TopBar><Link className="btn" to="/">{t('projects')}</Link></TopBar>
      <div className="view">
        <div className="rep">
          <div className="rep-head">
            <div>
              <div className="eyebrow">{t('pfEyebrow', { n: chosen.length, total: data?.projects.length ?? 0, date: date(statusDate) })}{org ? ` · ${org.name}` : ''}</div>
              <h1>{t(mode === 'exec' ? 'pfExecTitle' : 'pfTeamTitle')}</h1>
            </div>
            <div className="rep-tools">
              <div className="fld"><span>{t('audience')}</span>
                <div className="seg">
                  <button aria-pressed={mode === 'exec'} onClick={() => setMode('exec')}>{t('executives')}</button>
                  <button aria-pressed={mode === 'team'} onClick={() => setMode('team')}>{t('projectTeam')}</button>
                </div>
              </div>
              <label className="fld"><span>{t('statusDate')}</span><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
              <button className="btn" onClick={load}>{t('refresh')}</button>
              <button className="btn" disabled={!chosen.length} onClick={async () => {
                try { await navigator.clipboard.writeText(asText(mode, chosen, statusDate, owner, horizon, i18n)); toast(t('copied')); } catch { toast(t('copyFailed')); }
              }}>{t('copyText')}</button>
            </div>
          </div>
          {err === 'plan_portfolio' && (
            <div className="sec"><h2>{Icon.portfolio} {t('pfUpgradeTitle')}</h2><p className="hint">{t('pfUpgrade')}</p></div>
          )}
          {err && err !== 'plan_portfolio' && <p className="err" role="alert">{error(err)}</p>}
          {data && (
            <div className="sec"><h2>{t('pfInSummary')}
              <span className="grp"><button className="btn sm" onClick={() => setExcluded([])}>{t('selectAll')}</button><button className="btn sm" onClick={() => setExcluded(data.projects.map(p => p.id))}>{t('clear')}</button></span></h2>
              <div className="pf-sel">
                {data.projects.length ? data.projects.map(p => (
                  <label key={p.id} className={`pf-chip${excluded.includes(p.id) ? '' : ' on'}`}>
                    <input type="checkbox" checked={!excluded.includes(p.id)} onChange={() => toggle(p.id)} /><span dir="auto">{p.name}</span>
                  </label>
                )) : <span className="hint">{t('noProjects')}</span>}
              </div>
            </div>
          )}
          {data && !chosen.length && data.projects.length > 0 && <p className="hint">{t('pfSelectOne')}</p>}
          {data && chosen.length > 0 && (mode === 'exec'
            ? <ExecView entries={chosen} statusDate={statusDate} open={open} />
            : <TeamView entries={chosen} owner={owner} setOwner={setOwner} horizon={horizon} setHorizon={setHorizon} />)}
        </div>
      </div>
    </div>
  );
}
