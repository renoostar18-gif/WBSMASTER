import { type ComputedProject, type Day, type ItemInfo, type Op, type WbsItem, type WorkCalendar, toIso, todayDay } from '@wbs-master/engine';
import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n.js';
import { Var, Who } from '../ui.js';

export type Scale = 'day' | 'week' | 'month' | 'quarter';
/** Pixels per day for each zoom level (from the prototype). */
const PPD: Record<Scale, number> = { day: 30, week: 11, month: 3.6, quarter: 1.3 };
const RH = 38;

export interface GanttOptions { scale: Scale; showBaseline: boolean; showCritical: boolean; criticalOnly: boolean }

interface Props {
  items: WbsItem[];
  rows: WbsItem[];
  computed: ComputedProject;
  calendar: WorkCalendar;
  canEdit: boolean;
  selected: string | null;
  collapsed: Set<string>;
  maxLevel: number;
  options: GanttOptions;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (ops: Op[]) => boolean;
  othersByItem?: Map<string, string[]>;
}

const DAY_MS = 864e5;
const ymd = (d: Day) => new Date(d * DAY_MS);
const finishOf = (i: ItemInfo) => (i.status === 'completed' ? i.actual.finish ?? i.forecast.finish : i.forecast.finish);

export function GanttView(p: Props) {
  const { t, date, dir, locale } = useI18n();
  const rtl = dir === 'rtl';
  const ppd = PPD[p.options.scale];
  const today = p.computed.statusDate ?? todayDay();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; start: Day; finish: Day; x: number; y: number } | null>(null);
  const [linking, setLinking] = useState<{ from: string; x1: number; y1: number; x2: number; y2: number; target: string | null } | null>(null);

  // rows on the critical path only (with their parents), when asked
  const rows = useMemo(() => {
    if (!p.options.criticalOnly || !p.computed.critical.size) return p.rows;
    const keep = new Set<string>();
    const byId = new Map(p.items.map(i => [i.id, i]));
    for (const id of p.computed.critical) {
      let cur = byId.get(id);
      while (cur) { keep.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    }
    return p.rows.filter(r => keep.has(r.id));
  }, [p.rows, p.items, p.computed.critical, p.options.criticalOnly]);

  // time range of everything that has dates, with some margin
  const { d0, dEnd } = useMemo(() => {
    let s: Day | null = null, e: Day | null = null;
    const ext = (v: Day | null) => { if (v == null) return; if (s == null || v < s) s = v; if (e == null || v > e) e = v; };
    for (const i of p.computed.items.values()) { ext(i.forecast.start); ext(i.forecast.finish); ext(i.planned.start); ext(i.planned.finish); ext(i.actual.start); ext(i.actual.finish); }
    ext(today);
    const pad = p.options.scale === 'day' ? 7 : p.options.scale === 'week' ? 14 : 45;
    let start = s! - pad;
    if (p.options.scale !== 'day') { const dt = ymd(start); start = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / DAY_MS; }
    return { d0: start, dEnd: e! + pad * 2 };
  }, [p.computed, p.options.scale, today]);
  const W = Math.ceil((dEnd - d0) * ppd);
  const X = (d: Day) => (d - d0) * ppd;
  /** SVG x in screen order (mirrored in Arabic). */
  const SX = (x: number) => (rtl ? W - x : x);

  // put the status date in view when the scale changes
  useEffect(() => {
    scroller.current?.querySelector('.today')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [p.options.scale, rtl]);

  const fmt = useMemo(() => {
    const tag = locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';
    return {
      month: new Intl.DateTimeFormat(tag, { month: 'short', timeZone: 'UTC' }),
      monthYear: new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  }, [locale]);

  // scale ticks and background
  const scale = useMemo(() => {
    const top: { x: number; w: number; label: string }[] = [], bottom: typeof top = [], lines: number[] = [], off: number[] = [];
    const months: { y: number; m: number; st: Day; en: Day }[] = [];
    const dt = ymd(d0);
    for (let y = dt.getUTCFullYear(), m = dt.getUTCMonth(); ;) {
      const st = Math.max(d0, Date.UTC(y, m, 1) / DAY_MS);
      if (st >= dEnd) break;
      months.push({ y, m, st, en: Math.min(dEnd, Date.UTC(y, m + 1, 1) / DAY_MS) });
      if (++m > 11) { m = 0; y++; }
    }
    if (p.options.scale === 'month' || p.options.scale === 'quarter') {
      const years = new Map<number, { st: Day; en: Day }>();
      for (const mo of months) { const yv = years.get(mo.y); if (yv) yv.en = mo.en; else years.set(mo.y, { st: mo.st, en: mo.en }); }
      for (const [y, v] of years) top.push({ x: X(v.st), w: (v.en - v.st) * ppd, label: String(y) });
      for (const mo of months) {
        if (p.options.scale === 'quarter' && mo.m % 3) continue;
        const en = p.options.scale === 'month' ? mo.en : Math.min(dEnd, Date.UTC(mo.y, mo.m + 3, 1) / DAY_MS);
        bottom.push({ x: X(mo.st), w: (en - mo.st) * ppd, label: p.options.scale === 'month' ? fmt.month.format(ymd(mo.st)) : `Q${mo.m / 3 + 1}` });
        lines.push(X(mo.st));
      }
    } else {
      for (const mo of months) top.push({ x: X(mo.st), w: (mo.en - mo.st) * ppd, label: fmt.monthYear.format(ymd(mo.st)) });
      for (let d = d0; d < dEnd; d++) {
        if (!p.calendar.isWorking(d)) off.push(X(d));
        const dow = ymd(d).getUTCDay();
        if (p.options.scale === 'day') bottom.push({ x: X(d), w: ppd, label: String(ymd(d).getUTCDate()) });
        else if (dow === 0) { bottom.push({ x: X(d), w: 7 * ppd, label: String(ymd(d).getUTCDate()) }); lines.push(X(d)); }
      }
    }
    return { top, bottom, lines, off };
  }, [d0, dEnd, ppd, p.options.scale, p.calendar, fmt]);

  const rowIndex = new Map(rows.map((r, k) => [r.id, k]));
  const crit = p.options.showCritical ? p.computed.critical : new Set<string>();

  // link arrows between visible rows
  const arrows: { d: string; critical: boolean }[] = [];
  for (const n of rows) for (const dep of n.deps) {
    if (!rowIndex.has(dep.id)) continue;
    const pi = p.computed.items.get(dep.id), si = p.computed.items.get(n.id);
    if (!pi || !si) continue;
    const pf = finishOf(pi);
    if (pf == null || si.forecast.start == null) continue;
    const x1 = X(pf + 1), y1 = rowIndex.get(dep.id)! * RH + 15;
    const j = rowIndex.get(n.id)!, y2 = j * RH + 15;
    const x2 = X(si.forecast.start) + (si.milestone && !si.childCount ? ppd / 2 - 7 : 0);
    const d = x2 - 8 >= x1
      ? `M${SX(x1)} ${y1}H${SX(x2 - 8)}V${y2 + (y2 > y1 ? -6 : 6)}`
      : `M${SX(x1)} ${y1}H${SX(x1 + 8)}V${y2 > y1 ? j * RH : (j + 1) * RH}H${SX(x2 - 10)}V${y2}H${SX(x2 - 3)}`;
    arrows.push({ d, critical: crit.has(n.id) && crit.has(dep.id) });
  }

  // ---- interactions ----
  function startBarDrag(e: RPointerEvent<HTMLDivElement>, n: WbsItem, i: ItemInfo, mode: 'move' | 'l' | 'r') {
    if (!p.canEdit || i.forecast.start == null || i.forecast.finish == null) return;
    e.preventDefault();
    e.stopPropagation();
    p.onSelect(n.id);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const s0 = i.forecast.start, e0 = i.forecast.finish, x0 = e.clientX;
    let ns = s0, ne = e0;
    const move = (ev: PointerEvent) => {
      const dd = Math.round(((ev.clientX - x0) * (rtl ? -1 : 1)) / ppd);
      ns = s0; ne = e0;
      if (mode === 'move') { ns += dd; ne += dd; } else if (mode === 'l') ns = Math.min(e0, s0 + dd); else ne = Math.max(s0, e0 + dd);
      setDrag({ id: n.id, start: ns, finish: ne, x: ev.clientX, y: ev.clientY });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (ns === s0 && ne === e0) return;
      const ops: Op[] = [];
      // the first plan becomes the baseline: keep the dates from before the drag
      if (!n.plannedStart && !n.plannedFinish) ops.push({ op: 'put', id: n.id, values: { plannedStart: toIso(s0), plannedFinish: toIso(e0) } });
      ops.push({ op: 'set', id: n.id, field: 'forecastStart', value: toIso(ns) }, { op: 'set', id: n.id, field: 'forecastFinish', value: toIso(ne) });
      p.onEdit(ops);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function startLink(e: RPointerEvent<HTMLDivElement>, from: string) {
    if (!p.canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
    let target: string | null = null;
    setLinking({ from, x1, y1, x2: x1, y2: y1, target: null });
    const move = (ev: PointerEvent) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-row]');
      target = row && row.dataset.row !== from ? row.dataset.row! : null;
      setLinking({ from, x1, y1, x2: ev.clientX, y2: ev.clientY, target });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setLinking(null);
      if (target) p.onEdit([{ op: 'link', succ: target, pred: from, lag: 0 }]);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Click on the empty track of an undated item: place it as 5 working days from that day. */
  function placeUndated(e: React.MouseEvent<HTMLDivElement>, n: WbsItem, i: ItemInfo) {
    if (!p.canEdit || i.childCount || i.forecast.start != null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = rtl ? r.right - e.clientX : e.clientX - r.left;
    const start = p.calendar.onOrAfter(d0 + Math.floor(px / ppd));
    const finish = p.calendar.add(start, 4);
    p.onEdit([
      { op: 'set', id: n.id, field: 'forecastStart', value: toIso(start) },
      { op: 'set', id: n.id, field: 'forecastFinish', value: toIso(finish) },
    ]);
  }

  const dragInfo = drag && (() => {
    const i = p.computed.items.get(drag.id)!;
    const v = i.planned.finish != null ? p.calendar.diff(i.planned.finish, drag.finish) : null;
    return `${date(toIso(drag.start))} → ${date(toIso(drag.finish))} · ${t('workingDaysN', { n: p.calendar.count(drag.start, drag.finish) })}${v != null ? ` · ${v > 0 ? '+' : ''}${v}${t('daysShort')}` : ''}`;
  })();

  return (
    <div className="gantt-wrap" ref={scroller}>
      <div className="gantt" style={{ width: `calc(var(--g-left) + ${W}px)` }}>
        <div className="g-head">
          <div className="g-corner">{t('wbs')} · {t('name')}</div>
          <div className="g-scale" style={{ width: W }}>
            {scale.top.map(s => <div key={`t${s.x}`} className="t yr" style={{ insetInlineStart: s.x, width: s.w }}>{s.label}</div>)}
            {scale.bottom.map(s => <div key={`b${s.x}`} className="t sub" style={{ insetInlineStart: s.x, width: s.w }}>{s.label}</div>)}
          </div>
        </div>
        <div className="g-body" style={{ height: rows.length * RH }}>
          <div className="g-bg" style={{ width: W }}>
            {scale.off.map(x => <div key={`o${x}`} className="we" style={{ insetInlineStart: x, width: ppd }} />)}
            {scale.lines.map(x => <div key={`l${x}`} className="gl" style={{ insetInlineStart: x }} />)}
            {today >= d0 && today <= dEnd && <div className="today" style={{ insetInlineStart: X(today) }} title={t('statusDate')} />}
          </div>
          {rows.map(n => {
            const i = p.computed.items.get(n.id);
            if (!i) return null;
            const parent = i.childCount > 0;
            const isDrag = drag?.id === n.id;
            const fs = isDrag ? drag!.start : i.forecast.start, ff = isDrag ? drag!.finish : i.forecast.finish;
            const expandable = parent && (!p.maxLevel || i.level < p.maxLevel);
            const health = i.health === 'red' || i.health === 'amber' ? i.health : '';
            return (
              <div key={n.id} data-row={n.id} className={`g-row lv${Math.min(i.level, 6)}${p.selected === n.id ? ' sel' : ''}${crit.has(n.id) ? ' crit' : ''}${linking?.target === n.id ? ' linktgt' : ''}`}>
                <div className={`g-left${parent ? ' parent' : ''}`} style={{ paddingInlineStart: 8 + (i.level - 1) * 14 }} onMouseDown={() => p.onSelect(n.id)}>
                  {expandable
                    ? <button className="tg" onClick={() => p.onToggle(n.id)} aria-label={p.collapsed.has(n.id) ? '+' : '−'}>{p.collapsed.has(n.id) ? (rtl ? '◂' : '▸') : '▾'}</button>
                    : <span className="tg none" />}
                  <span className={`dot ${i.health}`} />
                  <span className="c" dir="ltr">{i.code}</span>
                  <span className="n" dir="auto" title={n.name}>{n.name}</span>
                  <Who names={p.othersByItem?.get(n.id)} />
                </div>
                <div className="g-track" style={{ width: W }} onClick={e => { p.onSelect(n.id); placeUndated(e, n, i); }}>
                  {p.options.showBaseline && i.planned.start != null && i.planned.finish != null && (
                    i.planned.start === i.planned.finish && !parent
                      ? <div className="bl ms" style={{ insetInlineStart: X(i.planned.start) + ppd / 2 }} title={`${t('planned')} ${date(toIso(i.planned.start))}`} />
                      : <div className="bl" style={{ insetInlineStart: X(i.planned.start), width: Math.max(ppd, (i.planned.finish - i.planned.start + 1) * ppd) }}
                          title={`${t('planned')} ${date(toIso(i.planned.start))} – ${date(toIso(i.planned.finish))}`} />
                  )}
                  {i.actual.start != null && (
                    <div className="act" style={{ insetInlineStart: X(i.actual.start), width: Math.max(2, ((i.actual.finish ?? Math.min(today, i.forecast.finish ?? today)) - i.actual.start + 1) * ppd) }} />
                  )}
                  {fs != null && ff != null && (parent ? (
                    <>
                      <div className="sum" style={{ insetInlineStart: X(fs), width: Math.max(ppd, (ff - fs + 1) * ppd) }} title={`${n.name}: ${date(toIso(fs))} – ${date(toIso(ff))}`} />
                      <div className="bar-lbl" style={{ insetInlineStart: X(fs) + Math.max(ppd, (ff - fs + 1) * ppd) + 6 }}>{i.progress}% {i.variance ? <Var v={i.variance} /> : null}</div>
                    </>
                  ) : i.milestone && !isDrag ? (
                    <>
                      <div className={`msk${i.health === 'red' ? ' red' : i.health === 'done' ? ' done' : ''}${crit.has(n.id) ? ' crit' : ''}`} style={{ insetInlineStart: X(fs) + ppd / 2 }}
                        title={`${n.name}: ${date(toIso(fs))}`} onPointerDown={e => startBarDrag(e, n, i, 'move')} />
                      {p.canEdit && <div className="lk" style={{ insetInlineStart: X(fs) + ppd / 2 + 8 }} title={t('linkDragHint')} onPointerDown={e => startLink(e, n.id)} />}
                      <div className="bar-lbl" style={{ insetInlineStart: X(fs) + ppd / 2 + 16 }}>{date(toIso(fs))} {i.variance ? <Var v={i.variance} /> : null}</div>
                    </>
                  ) : (
                    <>
                      <div className={`bar ${health}${crit.has(n.id) ? ' crit' : ''}${isDrag ? ' dragging' : ''}`}
                        style={{ insetInlineStart: X(fs), width: Math.max(ppd, (ff - fs + 1) * ppd) }}
                        title={`${n.name}: ${date(toIso(fs))} – ${date(toIso(ff))}`} onPointerDown={e => startBarDrag(e, n, i, 'move')}>
                        <div className="pf" style={{ width: `${i.progress}%` }} />
                        {p.canEdit && <div className="h s" onPointerDown={e => startBarDrag(e, n, i, 'l')} />}
                        {p.canEdit && <div className="h e" onPointerDown={e => startBarDrag(e, n, i, 'r')} />}
                      </div>
                      {p.canEdit && <div className="lk" style={{ insetInlineStart: X(fs) + Math.max(ppd, (ff - fs + 1) * ppd) }} title={t('linkDragHint')} onPointerDown={e => startLink(e, n.id)} />}
                      <div className="bar-lbl" style={{ insetInlineStart: X(fs) + Math.max(ppd, (ff - fs + 1) * ppd) + 10 }}>
                        {i.progress}% {i.variance ? <Var v={i.variance} /> : null}{n.owner ? ` · ${n.owner}` : ''}
                      </div>
                    </>
                  ))}
                  {fs == null && !parent && <div className="nodate" style={{ insetInlineStart: Math.max(X(today), 0) + 6 }}>{p.canEdit ? t('noDatesPlace') : t('health_none')}</div>}
                </div>
              </div>
            );
          })}
          <svg className="g-links" width={W} height={rows.length * RH} aria-hidden>
            <defs>
              <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)" /></marker>
              <marker id="ahc" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="3.6" markerHeight="3.6" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--r)" /></marker>
            </defs>
            {arrows.filter(a => !a.critical).map((a, k) => <path key={`a${k}`} d={a.d} markerEnd="url(#ah)" />)}
            {arrows.filter(a => a.critical).map((a, k) => <path key={`c${k}`} className="crit" d={a.d} markerEnd="url(#ahc)" />)}
          </svg>
        </div>
      </div>
      <div className="legend">
        <span><i className="lg-bar" />{p.canEdit ? t('lgForecast') : t('forecast')}</span>
        {p.options.showBaseline && <span><i className="lg-base" />{t('planned')}</span>}
        <span><i className="lg-act" />{t('actual')}</span>
        <span><i className="lg-ms" />{t('milestone')}</span>
        <span><i className="lg-today" />{t('statusDate')}</span>
        {p.options.showCritical && <span><i className="lg-crit" />{t('critical')}</span>}
        <span><i className="lg-off" />{t('nonWorking')}</span>
        {p.canEdit && <span><i className="lg-lk" />{t('linkDragHint')}</span>}
      </div>
      {dragInfo && <div className="g-tip" style={{ left: drag!.x + 12, top: drag!.y - 32 }}>{dragInfo}</div>}
      {linking && (
        <svg className="linkline" aria-hidden><line x1={linking.x1} y1={linking.y1} x2={linking.x2} y2={linking.y2} /></svg>
      )}
    </div>
  );
}
