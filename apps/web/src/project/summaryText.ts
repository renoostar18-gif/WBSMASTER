import { type ComputedProject, type ReportData, type ReportRow, toIso } from '@wbs-master/engine';
import type { I18n, MessageKey } from '../i18n.js';
import type { Summary } from './store.js';

/** Text written from the WBS data (prototype: autoNarrative, fillSection), in the reader's language. */
export interface TextCtx { i: I18n; projectName: string; computed: ComputedProject; report: ReportData; baselineName: string }

const health = (ctx: TextCtx, h: string) => ctx.i.t(`health_${h}` as MessageKey);
const d = (ctx: TextCtx, day: number | null | undefined) => ctx.i.date(toIso(day ?? null));

export function narrative(ctx: TextCtx): string {
  const { t } = ctx.i, p = ctx.computed.project, R = ctx.report;
  const parts = [t('n_open', {
    date: d(ctx, ctx.computed.statusDate), name: ctx.projectName, health: health(ctx, R.overall),
    done: p.progress, vsPlan: p.plannedPct != null ? t('n_vsPlan', { pp: p.plannedPct }) : '',
  })];
  if (p.forecast.finish != null) {
    if (p.planned.finish != null) {
      const v = p.variance ?? 0;
      const delta = v > 0 ? t('n_late', { n: v }) : v < 0 ? t('n_early', { n: -v }) : t('n_onPlan');
      parts.push(t('n_finishPlan', { finish: d(ctx, p.forecast.finish), plan: d(ctx, p.planned.finish), delta }));
    } else parts.push(t('n_finish', { finish: d(ctx, p.forecast.finish) }));
  }
  parts.push(t('n_counts', { done: R.counts.done, total: R.live.length, red: R.counts.red, amber: R.counts.amber }));
  const top = R.delayed.slice(0, 3).map(x => `${x.item.name} (${x.info.variance && x.info.variance > 0 ? `+${x.info.variance}${t('daysShort')}` : health(ctx, x.info.health)})`);
  if (top.length) parts.push(t('n_pressure', { list: top.join('; ') }));
  if (R.upcoming.length) parts.push(R.upcoming.length === 1 ? t('n_upcoming1') : t('n_upcoming', { n: R.upcoming.length }));
  return parts.join(' ');
}

export type FillKey = 'achievements' | 'nextSteps' | 'risks';

export function fillSection(key: FillKey, ctx: TextCtx): string {
  const { t } = ctx.i, R = ctx.report;
  const lines = (rows: ReportRow[], fn: (r: ReportRow) => string) => rows.slice(0, 8).map(fn).join('\n');
  if (key === 'achievements') {
    return lines(R.recentlyDone, x => t('f_done', { name: x.item.name, date: d(ctx, x.info.actual.finish) })
      + (x.info.variance && x.info.variance > 0 ? t('f_late', { n: x.info.variance }) : '')) || t('f_noDone');
  }
  if (key === 'nextSteps') {
    return lines(R.upcoming, x => t('f_next', {
      name: x.item.name, date: d(ctx, x.info.forecast.finish),
      start: x.info.status === 'not_started' ? t('f_start', { date: d(ctx, x.info.forecast.start) }) : '',
    }) + (x.item.owner ? ` — ${x.item.owner}` : '')) || t('f_noNext');
  }
  return lines(R.delayed, x => `• ${x.item.name}${x.item.owner ? ` (${x.item.owner})` : ''}: ${ctx.i.reason(x.info.reason)}${x.item.notes ? ` — ${x.item.notes}` : ''}`) || t('f_noRisk');
}

const SECTIONS: [keyof Summary, MessageKey][] = [
  ['achievements', 'sec_achievements'], ['nextSteps', 'sec_nextSteps'], ['risks', 'sec_risks'], ['decisions', 'sec_decisions'],
];

/** Plain text for email or Teams. */
export function reportText(ctx: TextCtx, s: Summary): string {
  const { t } = ctx.i, p = ctx.computed.project, R = ctx.report;
  const L: string[] = [
    `${ctx.projectName} — ${t('execSummary')}`, t('statusDateEyebrow', { date: d(ctx, ctx.computed.statusDate) }), '',
    `${t('overall')}: ${health(ctx, R.overall)} · ${p.progress}%${p.plannedPct != null ? ` (${p.plannedPct}%)` : ''} · ${t('forecastFinish')} ${d(ctx, p.forecast.finish)} · ${t('planVs', { date: d(ctx, p.planned.finish), baseline: ctx.baselineName })}`, '',
  ];
  if (s.narrative) L.push(s.narrative, '');
  if (R.critical.length) {
    L.push(t('critical').toUpperCase());
    for (const x of R.critical) L.push(`${x.info.code} ${x.item.name} — ${d(ctx, x.info.forecast.finish)}${x.info.variance ? ` (${x.info.variance > 0 ? '+' : ''}${x.info.variance}${t('daysShort')})` : ''}`);
    L.push('');
  }
  L.push(t('statusByElement').toUpperCase());
  for (const x of R.byElement) L.push(`${'  '.repeat(x.info.level - 1)}${x.info.code} ${x.item.name} — ${health(ctx, x.info.health)}, ${x.info.progress}%, ${d(ctx, x.info.status === 'completed' ? x.info.actual.finish : x.info.forecast.finish)}`);
  L.push('');
  for (const [k, label] of SECTIONS) if (s[k]) L.push(t(label).toUpperCase(), s[k], '');
  return L.join('\n');
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A standalone HTML report (opens in a browser or Word; print to PDF). */
export function reportHtml(ctx: TextCtx, s: Summary): string {
  const { t, locale, dir } = ctx.i, p = ctx.computed.project, R = ctx.report;
  const col: Record<string, string> = { green: '#138A3E', amber: '#B26B00', red: '#C0362C', done: '#56636E', none: '#56636E' };
  const pill = (h: string) => `<span class="pill" style="background:${col[h]}">${esc(health(ctx, h))}</span>`;
  const vv = (v: number | null) => (v == null ? '—' : `<span style="color:${v > 0 ? '#C0362C' : v < 0 ? '#138A3E' : '#56636E'};font-weight:600" dir="ltr">${v > 0 ? '+' : ''}${v}${esc(t('daysShort'))}</span>`);
  const nl = (x: string) => esc(x).replace(/\n/g, '<br>');
  const fin = (x: ReportRow) => d(ctx, x.info.status === 'completed' ? x.info.actual.finish : x.info.forecast.finish);
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(ctx.projectName)} — ${esc(t('execSummary'))}</title>
<style>body{font:14px/1.5 "IBM Plex Sans","IBM Plex Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif;color:#15202B;max-width:960px;margin:32px auto;padding:0 24px}
h1{font-size:24px;margin:4px 0 0}h2{font-size:15px;border-bottom:1px solid #D6DDDB;padding-bottom:4px;margin-top:26px}.eb{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#56636E}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #E7ECEA;padding:6px 8px;text-align:start}th{font-size:11px;text-transform:uppercase;color:#56636E}
.k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}.k div{border:1px solid #D6DDDB;border-radius:8px;padding:10px 12px}.k b{display:block;font-size:20px}.k span{font-size:11px;text-transform:uppercase;color:#56636E}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#fff}code{font-family:Consolas,monospace;color:#08776C;font-weight:600}</style></head><body>
<div class="eb">${esc(t('execSummary'))} · ${esc(t('statusDateEyebrow', { date: d(ctx, ctx.computed.statusDate) }))}</div><h1>${esc(ctx.projectName)}</h1>
<div class="k"><div><span>${esc(t('overall'))}</span><b>${pill(R.overall)}</b></div><div><span>${esc(t('progress'))}</span><b>${p.progress}%</b>${p.plannedPct != null ? `${p.plannedPct}% ${esc(t('planned'))}` : ''}</div>
<div><span>${esc(t('forecastFinish'))}</span><b>${esc(d(ctx, p.forecast.finish))}</b>${esc(t('planVs', { date: d(ctx, p.planned.finish), baseline: ctx.baselineName }))} ${vv(p.variance)}</div>
<div><span>${esc(t('workPackages', { n: R.live.length }))}</span><b>${R.live.length}</b>${esc(t('completeOnTrack', { done: R.counts.done, green: R.counts.green }))} · ${esc(t('delayedN', { n: R.counts.red }))} · ${esc(t('atRiskN', { n: R.counts.amber }))}</div></div>
${s.narrative ? `<h2>${esc(t('summaryH'))}</h2><p>${nl(s.narrative)}</p>` : ''}
<h2>${esc(t('statusByElement'))}</h2><table><tr><th>${esc(t('wbs'))}</th><th>${esc(t('element'))}</th><th>${esc(t('owner'))}</th><th>${esc(t('health'))}</th><th>${esc(t('planFinish'))}</th><th>${esc(t('forecastActual'))}</th><th>${esc(t('variance'))}</th><th>${esc(t('doneVsPlan'))}</th></tr>
${R.byElement.map(x => `<tr><td><code dir="ltr">${x.info.code}</code></td><td style="padding-inline-start:${8 + (x.info.level - 1) * 14}px">${esc(x.item.name)}</td><td>${esc(x.item.owner)}</td><td>${pill(x.info.health)}</td><td>${esc(d(ctx, x.info.planned.finish))}</td><td>${esc(fin(x))}</td><td>${vv(x.info.variance)}</td><td>${x.info.progress}%${x.info.plannedPct != null ? ` / ${x.info.plannedPct}%` : ''}</td></tr>`).join('')}</table>
${R.critical.length ? `<h2>${esc(t('critical'))}</h2><table>${R.critical.map(x => `<tr><td><code dir="ltr">${x.info.code}</code></td><td>${esc(x.item.name)}</td><td>${esc(d(ctx, x.info.forecast.start))} – ${esc(fin(x))}</td><td>${vv(x.info.variance)}</td><td>${pill(x.info.health)}</td></tr>`).join('')}</table>` : ''}
${R.milestones.length ? `<h2>${esc(t('milestones'))}</h2><table>${R.milestones.map(x => `<tr><td><code dir="ltr">${x.info.code}</code></td><td>${esc(x.item.name)}</td><td>${esc(t('planOn', { date: d(ctx, x.info.planned.finish) }))}</td><td>${esc(fin(x))}</td><td>${vv(x.info.variance)}</td></tr>`).join('')}</table>` : ''}
${SECTIONS.filter(([k]) => s[k]).map(([k, label]) => `<h2>${esc(t(label))}</h2><p>${nl(s[k])}</p>`).join('')}
<p style="color:#56636E;font-size:12px;margin-top:30px">${esc(t('generatedOn', { date: ctx.i.date(new Date().toISOString().slice(0, 10)) }))}</p></body></html>`;
}
