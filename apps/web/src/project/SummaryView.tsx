import { type Baseline, type ComputedProject, type Health, baselineFinish, reportData, toDay, toIso } from '@wbs-master/engine';
import { useMemo } from 'react';
import { type MessageKey, useI18n } from '../i18n.js';
import { Pill, Var, useToast } from '../ui.js';
import type { ProjectStore, Summary } from './store.js';
import { type FillKey, type TextCtx, fillSection, narrative, reportHtml, reportText } from './summaryText.js';

const SECTIONS: [keyof Summary, MessageKey, boolean][] = [
  ['achievements', 'sec_achievements', true], ['nextSteps', 'sec_nextSteps', true], ['risks', 'sec_risks', true], ['decisions', 'sec_decisions', false],
];

/** Executive summary of one project (spec 4.9), from the same calculations as every other view. */
export function SummaryView({ store, computed, maxLevel }: {
  store: ProjectStore; computed: ComputedProject; maxLevel: number;
}) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const toast = useToast();
  const data = store.data!;
  const model = store.model!;
  const levels = maxLevel || 1;
  const R = useMemo(() => reportData(model, computed, levels), [model, computed, levels]);
  const active = data.baselines.find(b => b.id === data.project.settings.activeBaselineId) ?? null;
  const ctx: TextCtx = { i: i18n, projectName: data.project.name, computed, report: R, baselineName: active?.name ?? t('latestPlan') };
  const p = computed.project;
  const s = data.summary;
  const canEdit = store.canEdit;
  const d = (day: number | null | undefined) => date(toIso(day ?? null));
  const tot = R.live.length || 1;
  const seg = (k: Health, c: string) => (R.counts[k] ? <i style={{ width: `${(100 * R.counts[k]) / tot}%`, background: `var(--${c})` }} title={`${t(`health_${k}` as MessageKey)}: ${R.counts[k]}`} /> : null);
  const fin = (x: (typeof R.live)[number]) => (x.info.status === 'completed' ? x.info.actual.finish : x.info.forecast.finish);

  const setText = (k: keyof Summary, v: string) => { if (v !== s[k]) store.saveSummary({ [k]: v }); };
  async function copy() {
    try { await navigator.clipboard.writeText(reportText(ctx, s)); toast(t('copied')); } catch { toast(t('copyBlocked')); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([reportHtml(ctx, s)], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.project.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${t('execSummary')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('reportSaved'));
  }

  return (
    <div className="rep">
      <div className="rep-head">
        <div>
          <div className="eyebrow">{t('execSummary')} · {t('statusDateEyebrow', { date: d(computed.statusDate) })}</div>
          <h1 dir="auto">{data.project.name}</h1>
        </div>
        <div className="grp">
          <button className="btn" onClick={copy}>{t('copyText')}</button>
          {/* the demo runs in a viewer that blocks downloads */}
          {import.meta.env.MODE !== 'demo' && <button className="btn primary" onClick={download}>{t('downloadReport')}</button>}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="k">{t('overall')}</div><div className="v"><Pill health={R.overall} /></div><div className="s">{i18n.reason(p.reason)}</div></div>
        <div className="kpi">
          <div className="k">{t('progress')}</div><div className="v">{p.progress}%</div>
          <div className="pbar"><div className="f" style={{ width: `${p.progress}%` }} />{p.plannedPct != null && <div className="m" style={{ insetInlineStart: `${p.plannedPct}%` }} />}</div>
          <div className="s">{p.plannedPct != null ? t('plannedByDate', { pp: p.plannedPct }) : t('noBaselineDates')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('forecastFinish')}</div><div className="v">{d(p.forecast.finish)}</div>
          <div className="s">{t('planVs', { date: d(p.planned.finish), baseline: ctx.baselineName })} · <Var v={p.variance} /></div>
        </div>
        <div className="kpi">
          <div className="k">{t('workPackages', { n: R.live.length })}</div>
          <div className="v" style={{ fontSize: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--r)' }}>{t('delayedN', { n: R.counts.red })}</span><span style={{ color: 'var(--a)' }}>{t('atRiskN', { n: R.counts.amber })}</span>
          </div>
          <div className="stack">{seg('done', 'done')}{seg('green', 'g')}{seg('amber', 'a')}{seg('red', 'r')}</div>
          <div className="s">{t('completeOnTrack', { done: R.counts.done, green: R.counts.green })}{R.counts.none ? t('undatedN', { n: R.counts.none }) : ''}</div>
        </div>
      </div>

      <section className="sec">
        <h2>{t('summaryH')}{canEdit && <button className="btn sm" onClick={() => store.saveSummary({ narrative: narrative(ctx) })}>{t('writeFromWbs')}</button>}</h2>
        <textarea key={`n-${s.narrative}`} rows={5} dir="auto" defaultValue={s.narrative} placeholder={t('summaryPh')} disabled={!canEdit}
          onBlur={e => setText('narrative', e.currentTarget.value)} />
      </section>

      <section className="sec">
        <h2>{t('statusByElement')} <small>{t('levelsHint', { n: levels })}</small></h2>
        <div className="rt-wrap">
          <table className="rt">
            <thead><tr><th>{t('wbs')}</th><th>{t('element')}</th><th>{t('owner')}</th><th>{t('health')}</th><th>{t('planFinish')}</th><th>{t('forecastActual')}</th><th>{t('variance')}</th><th>{t('doneVsPlan')}</th></tr></thead>
            <tbody>
              {R.byElement.map(x => (
                <tr key={x.item.id} className={`lv${Math.min(x.info.level, 6)}`}>
                  <td className="c" dir="ltr">{x.info.code}</td>
                  <td dir="auto" style={{ paddingInlineStart: 8 + (x.info.level - 1) * 14, fontWeight: x.info.childCount ? 600 : 400 }}>{x.item.name}</td>
                  <td>{x.item.owner}</td><td><Pill health={x.info.health} title={i18n.reason(x.info.reason)} /></td>
                  <td className="nw">{d(x.info.planned.finish)}</td><td className="nw">{d(fin(x))}</td><td className="nw"><Var v={x.info.variance} /></td>
                  <td className="nw">
                    <div className="pbar mini"><div className="f" style={{ width: `${x.info.progress}%` }} />{x.info.plannedPct != null && <div className="m" style={{ insetInlineStart: `${x.info.plannedPct}%` }} />}</div>
                    <span className="hint">{x.info.progress}%{x.info.plannedPct != null ? ` / ${x.info.plannedPct}%` : ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols2">
        <section className="sec">
          <h2>{t('delayedAtRisk')} <small>{R.delayed.length}</small></h2>
          {R.delayed.length ? (
            <ul className="ilist">{R.delayed.slice(0, 10).map(x => (
              <li key={x.item.id}><span className="ptag" dir="ltr">{x.info.code}</span><span><b dir="auto">{x.item.name}</b><span className="hint"> · {i18n.reason(x.info.reason)}{x.item.owner ? ` · ${x.item.owner}` : ''}</span></span><Var v={x.info.variance} /></li>
            ))}</ul>
          ) : <p className="hint">{t('nothingDelayed')}</p>}
        </section>
        <section className="sec">
          <h2>{t('comingUp')} <small>{R.upcoming.length}</small></h2>
          {R.upcoming.length ? (
            <ul className="ilist">{R.upcoming.slice(0, 10).map(x => (
              <li key={x.item.id}><span className="ptag" dir="ltr">{x.info.code}</span>
                <span><b dir="auto">{x.item.name}</b><span className="hint"> · {x.info.status === 'not_started' ? `${t('startsOn', { date: d(x.info.forecast.start) })} · ` : ''}{t('dueOn', { date: d(x.info.forecast.finish) })}{x.item.owner ? ` · ${x.item.owner}` : ''}</span></span>
                <Pill health={x.info.health} /></li>
            ))}</ul>
          ) : <p className="hint">{t('nothingDue')}</p>}
        </section>
      </div>

      <BaselineHistory baselines={data.baselines} activeId={data.project.settings.activeBaselineId} forecastFinish={p.forecast.finish} store={store} />

      <section className="sec">
        <h2>{t('critical')} <small>{R.critical.length ? t('critHint', { n: R.critical.length, date: d(p.forecast.finish) }) : t('critNone')}</small></h2>
        {R.critical.length > 0 && (
          <ul className="ilist">{R.critical.map(x => (
            <li key={x.item.id}><span className="ptag" dir="ltr">{x.info.code}</span><span><b dir="auto">{x.item.name}</b><span className="hint"> · {d(x.info.forecast.start)} – {d(fin(x))}</span></span><Var v={x.info.variance} /></li>
          ))}</ul>
        )}
      </section>

      <section className="sec">
        <h2>{t('milestones')} <small>{R.milestones.length}</small></h2>
        {R.milestones.length ? (
          <ul className="ilist">{R.milestones.map(x => (
            <li key={x.item.id}><span className="ptag" dir="ltr">{x.info.code}</span>
              <span><b dir="auto">{x.item.name}</b><span className="hint"> · {t('planOn', { date: d(x.info.planned.finish) })} · {x.info.status === 'completed' ? t('doneOn', { date: d(x.info.actual.finish) }) : t('forecastOn', { date: d(x.info.forecast.finish) })}</span></span>
              <Pill health={x.info.health} /></li>
          ))}</ul>
        ) : <p className="hint">{t('noMilestones')}</p>}
      </section>

      <div className="cols2">
        {SECTIONS.map(([k, label, fillable]) => (
          <section className="sec" key={k}>
            <h2>{t(label)}{canEdit && fillable && <button className="btn sm" onClick={() => store.saveSummary({ [k]: fillSection(k as FillKey, ctx) })}>{t('fillFromWbs')}</button>}</h2>
            <textarea key={`${k}-${s[k]}`} rows={6} dir="auto" defaultValue={s[k]} disabled={!canEdit} onBlur={e => setText(k, e.currentTarget.value)} />
          </section>
        ))}
      </div>
    </div>
  );
}

/** Each saved baseline and how far the planned finish moved (spec 4.8). */
function BaselineHistory({ baselines, activeId, forecastFinish, store }: {
  baselines: Baseline[]; activeId: string | null; forecastFinish: number | null; store: ProjectStore;
}) {
  const { t, date } = useI18n();
  if (!baselines.length) return null;
  let prev: number | null = null;
  const rows = baselines.map((b, k) => {
    const fin = toDay(baselineFinish(b));
    const change = prev != null && fin != null ? store.calendar.diff(prev, fin) : null;
    prev = fin;
    return { b, k, fin, change };
  });
  const f0 = toDay(baselineFinish(baselines[0]!));
  const drift = f0 != null && forecastFinish != null ? store.calendar.diff(f0, forecastFinish) : null;
  return (
    <section className="sec">
      <h2>{t('baselineHistory')} <small>{t('bhHint')}</small></h2>
      <div className="rt-wrap">
        <table className="rt">
          <thead><tr><th>{t('baselines')}</th><th>{t('setOn')}</th><th>{t('reason')}</th><th>{t('plannedFinish')}</th><th>{t('change')}</th></tr></thead>
          <tbody>{rows.map(({ b, k, fin, change }) => (
            <tr key={b.id}>
              <td><b dir="auto">{b.name}</b>{k === 0 && <span className="hint"> · {t('original')}</span>}{activeId === b.id && <> <span className="pill amber">{t('comparedNow')}</span></>}</td>
              <td className="nw">{date(b.setOn)}</td><td dir="auto">{b.reason || '—'}</td><td className="nw">{date(toIso(fin))}</td><td className="nw"><Var v={change} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {drift != null && f0 != null && (
        <p className="hint">{drift > 0 ? t('driftLater', { date: date(toIso(f0)), n: drift }) : drift < 0 ? t('driftEarlier', { date: date(toIso(f0)), n: -drift }) : t('driftOn', { date: date(toIso(f0)) })}</p>
      )}
    </section>
  );
}
