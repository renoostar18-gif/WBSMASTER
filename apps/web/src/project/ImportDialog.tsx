import {
  type DateOrder, type HierarchyMode, type ImportField, type Mapping, type Op, type WbsItem, type WorkbookChange,
  analyzeHierarchy, buildImportRows, describeChanges, detectColumns, detectHeaderRow, diffToOps, guessDateOrder, headerNames, isConnectedSheet,
  mergeWorkbookItems, readConnectedSheet, rowsToItems,
} from '@wbs-master/engine';
import { type DragEvent, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../api.js';
import { type MessageKey, useI18n } from '../i18n.js';
import { type SheetData, readSpreadsheet } from './excel.js';

/** Largest batch sent in one request (the API accepts up to 500 edits per batch). */
const CHUNK = 400;

/** Send edits to a project in batches, in order. Returns an error code or null. */
export async function sendOps(projectId: string, ops: Op[]): Promise<string | null> {
  try {
    for (let k = 0; k < ops.length; k += CHUNK) await api.post(`/projects/${projectId}/ops`, { ops: ops.slice(k, k + CHUNK) });
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : 'server_error';
  }
}

const FIELDS: [ImportField, MessageKey, boolean?][] = [
  ['name', 'name', true], ['code', 'imCode'], ['level', 'level'], ['owner', 'owner'], ['status', 'status'],
  ['plannedStart', 'imPlannedStart'], ['plannedFinish', 'imPlannedFinish'], ['forecastStart', 'imForecastStart'], ['forecastFinish', 'imForecastFinish'],
  ['actualStart', 'imActualStart'], ['actualFinish', 'imActualFinish'], ['progress', 'progress'], ['deps', 'dependsOn'], ['notes', 'notes'],
];

interface Props {
  /** Inside a project: re-import its workbook, or add rows to it. Without one: always a new project. */
  project?: { id: string; name: string; items: WbsItem[]; canEdit: boolean };
  orgId: string;
  /** Apply edits to the open project (with undo); only given inside a project. */
  applyToProject?: (ops: Op[]) => boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

/** Used only when the sheet's own dates could be read either way. */
const localeDateOrder = (): DateOrder => (navigator.language === 'en-US' ? 'mdy' : 'dmy');

export function ImportDialog(p: Props) {
  const { t, error, locale } = useI18n();
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // generic import state
  const [sheetIdx, setSheetIdx] = useState(0);
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<HierarchyMode | null>(null);
  const [g1, setG1] = useState<number | null>(null);
  const [g2, setG2] = useState<number | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>(localeDateOrder);
  const [dest, setDest] = useState<'new' | 'append'>(p.project ? 'append' : 'new');

  async function open(file: File) {
    setErr('');
    setBusy(true);
    try {
      const s = await readSpreadsheet(file);
      setFileName(file.name.replace(/\.[^.]+$/, ''));
      setSheets(s);
      const first = Math.max(0, s.findIndex(x => x.rows.some(r => r.some(c => String(c ?? '').trim()))));
      pickSheet(s, first);
    } catch (e) {
      setErr(error((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  function pickSheet(s: SheetData[], idx: number) {
    setSheetIdx(idx);
    const rows = s[idx]?.rows ?? [];
    setDateOrder(guessDateOrder(rows) ?? localeDateOrder());
    const h = detectHeaderRow(rows);
    setHeader(h);
    const m = detectColumns(headerNames(rows, h));
    if (m.name == null) {
      // no name-like header: take the first column that is mostly text
      const data = rows.slice(h + 1, h + 20);
      const names = headerNames(rows, h);
      const used = new Set(Object.values(m));
      const k = names.findIndex((_, j) => !used.has(j) && data.filter(r => typeof r[j] === 'string' && String(r[j]).trim()).length > data.length / 2);
      m.name = Math.max(0, k);
    }
    setMapping(m);
    setMode(null);
    setG1(null);
    setG2(null);
  }

  // ---- connected workbook ----
  const connected = useMemo(() => {
    const wbs = sheets?.find(s => s.name === 'WBS' && isConnectedSheet(s.rows));
    if (!wbs) return null;
    const projects = readConnectedSheet(wbs.rows, dateOrder);
    const same = p.project ? projects.find(x => x.projectId === p.project!.id) : undefined;
    if (same && p.project) {
      const merged = mergeWorkbookItems(p.project.items, same.items);
      return { kind: 'update' as const, target: merged, change: describeChanges(p.project.items, merged), ignored: same.ignoredLinks, name: same.name };
    }
    const other = projects[0];
    return other ? { kind: 'copy' as const, target: other.items, change: null, ignored: other.ignoredLinks, name: other.name } : null;
  }, [sheets, p.project, dateOrder]);

  // ---- generic import ----
  const rows = sheets?.[sheetIdx]?.rows ?? [];
  const names = useMemo(() => headerNames(rows, header), [rows, header]);
  const hier = useMemo(() => (sheets ? analyzeHierarchy(rows, header, mapping) : null), [sheets, rows, header, mapping]);
  const effMode: HierarchyMode = mode ?? hier?.suggested ?? '1';
  const effG1 = g1 ?? hier?.group1 ?? null, effG2 = g2 ?? hier?.group2 ?? null;
  const preview = useMemo(
    () => (sheets && !connected ? buildImportRows(rows, { header, mapping, mode: effMode, group1: effG1, group2: effG2, dateOrder }) : []),
    [sheets, connected, rows, header, mapping, effMode, effG1, effG2, dateOrder]);
  const levels = preview.reduce((m, r) => Math.max(m, r.level), 0);
  const groups = preview.filter(r => r.group).length;
  const modes: [HierarchyMode, MessageKey, boolean][] = [
    ['code', 'imModeCode', !!hier?.hasCode], ['num', 'imModeNum', !!hier?.numbered], ['1', 'imMode1', true],
    ['2', 'imMode2', (hier?.groupColumns.length ?? 0) >= 1], ['3', 'imMode3', (hier?.groupColumns.length ?? 0) >= 2],
  ];

  async function createProject(name: string, items: WbsItem[]) {
    const r = await api.post<{ id: string }>(`/orgs/${p.orgId}/projects`, { name: name.slice(0, 200) || t('imUntitled'), locale });
    const code = await sendOps(r.id, diffToOps([], items));
    if (code) throw new ApiError(400, code);
    return r.id;
  }

  async function go() {
    setErr('');
    setBusy(true);
    try {
      if (connected?.kind === 'update' && p.project && p.applyToProject) {
        const ops = diffToOps(p.project.items, connected.target);
        if (ops.length) p.applyToProject(ops);
        p.onClose();
        return;
      }
      if (connected) {
        p.onCreated(await createProject(`${connected.name}${connected.kind === 'copy' && p.project?.name === connected.name ? ` (${t('imCopy')})` : ''}`, connected.target));
        return;
      }
      if (!preview.length) return;
      if (dest === 'append' && p.project && p.applyToProject) {
        const { items } = rowsToItems(preview, null);
        p.applyToProject(diffToOps(p.project.items, [...p.project.items, ...items]));
        p.onClose();
        return;
      }
      const { items } = rowsToItems(preview, null);
      p.onCreated(await createProject(fileName, items));
    } catch (e) {
      setErr(error(e instanceof ApiError ? e.code : (e as Error).message || 'server_error'));
    } finally {
      setBusy(false);
    }
  }

  const fieldSelect = (f: ImportField, label: MessageKey, required?: boolean) => (
    <label className="fld" key={f}>
      <span>{t(label)}{required ? ' *' : ''}</span>
      <select value={mapping[f] ?? ''} onChange={e => { const v = e.target.value; setMapping(m => ({ ...m, [f]: v === '' ? undefined : Number(v) })); setMode(null); }}>
        {!required && <option value="">{t('imNone')}</option>}
        {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
      </select>
    </label>
  );
  const change = connected?.change;

  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && p.onClose()}>
      <div className="modal xwide" role="dialog" aria-label={t('imTitle')} onKeyDown={e => e.key === 'Escape' && p.onClose()}>
        <div className="dhead"><h2>{t('imTitle')}</h2><button className="btn" onClick={p.onClose}>{t('close')}</button></div>

        {!sheets && (
          <div className={`drop-zone${over ? ' over' : ''}`} role="button" tabIndex={0}
            onClick={() => input.current?.click()} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) open(f); }}>
            <b>{busy ? t('imReading') : t('imDrop')}</b>
            <span className="hint">{t('imDropHint')}</span>
            <input ref={input} type="file" accept=".xlsx,.xlsm,.csv,.xls" hidden aria-label={t('imTitle')}
              onChange={e => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ''; }} />
          </div>
        )}

        {sheets && connected && (
          <div className="im-body">
            <p>{connected.kind === 'update' ? t('imConnectedUpdate', { name: connected.name }) : t('imConnectedCopy', { name: connected.name })}</p>
            {change && <ChangeList change={change} />}
            {!change && <p className="hint">{t('imItemsN', { n: connected.target.length })}</p>}
            {connected.ignored.length > 0 && <p className="hint">{t('ignoredDeps', { list: connected.ignored.join(', ') })}</p>}
          </div>
        )}

        {sheets && !connected && (
          <div className="im-body">
            <div className="map">
              <label className="fld"><span>{t('imSheet')}</span>
                <select value={sheetIdx} onChange={e => pickSheet(sheets, Number(e.target.value))}>{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select>
              </label>
              <label className="fld"><span>{t('imHeaderRow')}</span>
                <input type="number" min={1} value={header + 1} onChange={e => { const h = Math.max(0, Number(e.target.value) - 1); setHeader(h); setMapping(detectColumns(headerNames(rows, h))); setMode(null); }} />
              </label>
              <label className="fld"><span>{t('imDateOrder')}</span>
                <select value={dateOrder} onChange={e => setDateOrder(e.target.value as DateOrder)}>
                  <option value="dmy">{t('imDmy')}</option><option value="mdy">{t('imMdy')}</option>
                </select>
              </label>
              {FIELDS.map(([f, l, req]) => fieldSelect(f, l, req))}
            </div>
            <div className="hier">
              <b>{t('imHowManyLevels')}</b>
              <div className="seg wrap-seg">
                {modes.map(([k, label, enabled]) => (
                  <button key={k} type="button" aria-pressed={effMode === k} disabled={!enabled} onClick={() => setMode(k)}>
                    {t(label)}{hier?.suggested === k && <span className="rec">{t('imSuggested')}</span>}
                  </button>
                ))}
              </div>
              {(effMode === '2' || effMode === '3') && (
                <div className="map">
                  <label className="fld"><span>{t('imGroup1')}</span>
                    <select value={effG1 ?? ''} onChange={e => setG1(e.target.value === '' ? null : Number(e.target.value))}>
                      <option value="">{t('imNone')}</option>
                      {hier?.groupColumns.map(g => <option key={g.index} value={g.index}>{t('imGroupOpt', { name: g.name, n: g.groups })}</option>)}
                    </select>
                  </label>
                  {effMode === '3' && (
                    <label className="fld"><span>{t('imGroup2')}</span>
                      <select value={effG2 ?? ''} onChange={e => setG2(e.target.value === '' ? null : Number(e.target.value))}>
                        <option value="">{t('imNone')}</option>
                        {hier?.groupColumns.map(g => <option key={g.index} value={g.index}>{t('imGroupOpt', { name: g.name, n: g.groups })}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              <p className="hint">{t(`imHint_${effMode}` as MessageKey)}</p>
            </div>
            {p.project?.canEdit && (
              <div className="radios">
                <label><input type="radio" name="dest" checked={dest === 'append'} onChange={() => setDest('append')} /> {t('imAppend')}</label>
                <label><input type="radio" name="dest" checked={dest === 'new'} onChange={() => setDest('new')} /> {t('imNew')}</label>
              </div>
            )}
            <p className="hint">{preview.length ? [t('imRowsN', { n: preview.length - groups }), groups ? t('imGroupsN', { n: groups }) : '', t('imLevelsN', { n: levels })].filter(Boolean).join(' · ') : t('imNoRows')}</p>
            <div className="prev">
              <table>
                <thead><tr><th>{t('level')}</th><th>{t('name')}</th><th>{t('owner')}</th><th>{t('planned')}</th><th>{t('forecast')}</th><th>{t('actual')}</th><th>%</th><th>{t('dependsOn')}</th></tr></thead>
                <tbody>
                  {preview.slice(0, 60).map((r, k) => (
                    <tr key={k}>
                      <td>{r.level}</td>
                      <td dir="auto" style={{ paddingInlineStart: 8 + (r.level - 1) * 16, fontWeight: r.group ? 600 : 400 }}>{r.name}</td>
                      <td>{r.owner}</td>
                      <td dir="ltr">{r.plannedStart ? `${r.plannedStart} → ${r.plannedFinish ?? ''}` : ''}</td>
                      <td dir="ltr">{r.forecastStart ? `${r.forecastStart} → ${r.forecastFinish ?? ''}` : ''}</td>
                      <td dir="ltr">{r.actualStart ?? ''}{r.actualFinish ? ` → ${r.actualFinish}` : ''}</td>
                      <td>{r.progress || ''}</td>
                      <td dir="ltr">{r.depsRaw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {err && <div className="err" role="alert">{err}</div>}
        {sheets && (
          <div className="mfoot">
            <button className="btn" onClick={() => { setSheets(null); setErr(''); }}>{t('imOtherFile')}</button>
            <button className="btn primary" disabled={busy || (!connected && !preview.length) || (connected?.kind === 'update' && !!change && !change.added.length && !change.removed.length && !change.changed.length)} onClick={go}>
              {busy ? t('saving') : connected?.kind === 'update' ? t('imApply') : t('imImport')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeList({ change }: { change: WorkbookChange }) {
  const { t } = useI18n();
  const field = (f: string) => (f === 'parentId' ? t('imPosition') : f === 'deps' ? t('links') : t(`f_${f}` as MessageKey));
  if (!change.added.length && !change.removed.length && !change.changed.length) return <p className="hint">{t('imNoChanges')}</p>;
  return (
    <div className="diff">
      <b>{t('imChangesN', { changed: change.changed.length, added: change.added.length, removed: change.removed.length })}</b>
      <ul>
        {change.changed.slice(0, 15).map((c, k) => <li key={`c${k}`}><span dir="auto">{c.name}</span>: {c.fields.map(field).join(', ')}</li>)}
        {change.changed.length > 15 && <li>{t('imAndMore', { n: change.changed.length - 15 })}</li>}
        {change.added.slice(0, 8).map((n, k) => <li key={`a${k}`}>{t('imAdded')}: <span dir="auto">{n}</span></li>)}
        {change.removed.slice(0, 8).map((n, k) => <li key={`r${k}`}>{t('imRemoved')}: <span dir="auto">{n}</span></li>)}
      </ul>
    </div>
  );
}
