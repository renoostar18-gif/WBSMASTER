/* eslint-disable */
// @ts-nocheck
/**
 * Reference implementation: the calculation code of the WBS Builder prototype
 * (single-file HTML artifact, version 1792410563-dbf1), copied with only the
 * global state turned into parameters. The engine must match it exactly when
 * every day is a working day. Do not "fix" this file; it is the oracle.
 */
const DAY = 864e5;
const toD = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], m[2]-1, +m[3]) / DAY : null; };
const fromD = n => n == null ? '' : new Date(n * DAY).toISOString().slice(0, 10);
const HRANK = { none: 0, done: 0, green: 1, amber: 2, red: 3 };

export interface ProtoNode { id: string; parent: string | null; name: string; owner: string; status: string; bStart: string; bEnd: string; start: string; end: string; aStart: string; aEnd: string; progress: number; notes: string; deps: { id: string; lag: number }[] }
export interface ProtoProject { nodes: ProtoNode[]; baselines: { id: string; d: [string, number | null, number | null][] }[]; settings: { redDays: number; asOf: string; autoSched?: boolean; activeBase?: string } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function protoCompute(P: ProtoProject, today: number): { info: Map<string, any>; proj: any; crit: Set<string> } {
  const T = () => toD(P.settings?.asOf) ?? today;
  const redDays = () => Math.max(1, +(P.settings?.redDays) || 10);
  let idx, kidsMap, info, proj, crit, activeBaseMap;
  function pair(s, e) { s = toD(s); e = toD(e); if (s != null && e == null) e = s; if (e != null && s == null) s = e; return { s, e }; }
  function leafCalc(n) {
    const t = T();
    const wb = pair(n.bStart, n.bEnd); const ar = activeBaseMap ? activeBaseMap.get(n.id) : null;
    const b = ar ? { s: ar[1] ?? ar[2], e: ar[2] ?? ar[1] } : activeBaseMap ? { s: null, e: null } : wb;
    let f = pair(n.start, n.end); if (f.s == null) f = { ...wb };
    const a = { s: toD(n.aStart), e: toD(n.aEnd) };
    let st = n.status !== 'auto' ? n.status : (a.e != null ? 'done' : (a.s != null || (+n.progress || 0) > 0) ? 'wip' : 'ns');
    const p = st === 'done' ? 100 : Math.max(0, Math.min(100, +n.progress || 0));
    const fin = st === 'done' ? (a.e ?? f.e) : f.e;
    const vr = (fin != null && b.e != null) ? fin - b.e : null;
    const pp = b.s != null ? Math.max(0, Math.min(100, Math.round(100 * (t - b.s + 1) / (b.e - b.s + 1)))) : null;
    const late = st !== 'done' && st !== 'cx' && f.e != null && f.e < t;
    const lateStart = st === 'ns' && b.s != null && b.s < t;
    let h = 'none';
    if (st === 'cx') { h = 'none'; }
    else if (st === 'done') { h = 'done'; }
    else if (f.e == null) { h = 'none'; }
    else if (late) { h = 'red'; }
    else if (vr != null && vr >= redDays()) { h = 'red'; }
    else if (vr != null && vr > 0) { h = 'amber'; }
    else if (lateStart) { h = 'amber'; }
    else if (st === 'hold') { h = 'amber'; }
    else if (pp != null && pp - p >= 25) { h = 'amber'; }
    else { h = 'green'; }
    return { b, f, a, st, p, pp, vr, late, lateStart, h, ms: f.s != null && f.s === f.e };
  }
  function reindex() {
    idx = new Map(P.nodes.map(n => [n.id, n]));
    const abl = P.settings && P.settings.activeBase ? (P.baselines || []).find(x => x.id === P.settings.activeBase) : null;
    activeBaseMap = abl ? new Map(abl.d.map(x => [x[0], x])) : null;
    kidsMap = new Map(); kidsMap.set(null, []);
    for (const n of P.nodes) { const k = n.parent ?? null; if (!kidsMap.has(k)) kidsMap.set(k, []); kidsMap.get(k).push(n); }
    info = new Map();
    const agg = (list) => {
      const t = T(); const r = { b: { s: null, e: null }, f: { s: null, e: null }, a: { s: null, e: null } };
      let wsum = 0, psum = 0, ppw = 0, ppsum = 0, allDone = true, anyStart = false, allHold = list.length > 0, worst = 'none', any = 0, live = 0;
      const mn = (x, y) => x == null ? y : y == null ? x : Math.min(x, y), mx = (x, y) => x == null ? y : y == null ? x : Math.max(x, y);
      for (const ci of list) {
        if (ci.st === 'cx') continue; live++;
        for (const k of ['b', 'f']) { r[k].s = mn(r[k].s, ci[k].s); r[k].e = mx(r[k].e, ci[k].e); }
        r.a.s = mn(r.a.s, ci.a.s); r.a.e = mx(r.a.e, ci.a.e);
        const w = ci.b.s != null ? ci.b.e - ci.b.s + 1 : ci.f.s != null ? ci.f.e - ci.f.s + 1 : 1;
        wsum += w; psum += w * ci.p; if (ci.pp != null) { ppw += w; ppsum += w * ci.pp; }
        if (ci.st !== 'done') allDone = false; if (ci.st === 'wip' || ci.st === 'done') anyStart = true; if (ci.st !== 'hold') allHold = false;
        if (HRANK[ci.h] > HRANK[worst]) worst = ci.h; any++;
      }
      const st = !live ? 'cx' : allDone ? 'done' : anyStart ? 'wip' : allHold ? 'hold' : 'ns';
      if (st !== 'done') r.a.e = null;
      const p = wsum ? Math.round(psum / wsum) : 0; const pp = ppw ? Math.round(ppsum / ppw) : null;
      const fin = st === 'done' ? (r.a.e ?? r.f.e) : r.f.e; const vr = fin != null && r.b.e != null ? fin - r.b.e : null;
      const late = st !== 'done' && r.f.e != null && r.f.e < t;
      let h;
      if (st === 'done') { h = 'done'; }
      else if (r.f.e == null) { h = 'none'; }
      else if (late) { h = 'red'; }
      else if (vr != null && vr >= redDays()) { h = 'red'; }
      else if (vr != null && vr > 0 || worst === 'red' || worst === 'amber') { h = 'amber'; }
      else { h = 'green'; }
      return { ...r, st, p, pp, vr, late, h, ms: false };
    };
    const walk = (pid, pcode, lvl) => {
      const out = [];
      (kidsMap.get(pid) || []).forEach((n, i) => {
        const code = pcode ? pcode + '.' + (i + 1) : String(i + 1);
        const ks = kidsMap.get(n.id) || [];
        let inf;
        if (ks.length) { const sub = walk(n.id, code, lvl + 1); inf = agg(sub); }
        else inf = leafCalc(n);
        Object.assign(inf, { code, level: lvl, kids: ks.length });
        info.set(n.id, inf); out.push(inf);
      });
      return out;
    };
    proj = agg(walk(null, '', 1));
    crit = criticalSet();
  }
  const kids = id => kidsMap.get(id ?? null) || [];
  function descendants(id) { const out = []; const st = [...kids(id)]; while (st.length) { const n = st.pop(); out.push(n.id); st.push(...kids(n.id)); } return out; }
  function leafIdsOf(id) { if (!idx.has(id)) return []; return kids(id).length ? descendants(id).filter(d => !kids(d).length) : [id]; }
  function leafEdges() {
    const m = new Map();
    for (const n of P.nodes) for (const d of n.deps || []) { const ps = leafIdsOf(d.id), ss = leafIdsOf(n.id); for (const sId of ss) for (const pId of ps) if (pId !== sId) { if (!m.has(sId)) m.set(sId, []); m.get(sId).push({ p: pId, lag: d.lag || 0 }); } }
    return m;
  }
  function criticalSet() {
    const set = new Set(); const E = leafEdges(); if (!E.size) return set;
    let end = null, endId = null;
    for (const n of P.nodes) { const i = info.get(n.id); if (!i || i.kids || i.st === 'cx' || i.f.e == null) continue; const fe = i.st === 'done' ? (i.a.e ?? i.f.e) : i.f.e; if (end == null || fe > end) { end = fe; endId = n.id; } }
    const stack = endId ? [endId] : [];
    while (stack.length) { const id = stack.pop(); if (set.has(id)) continue; set.add(id); const i = info.get(id); const st = i.st === 'done' ? (i.a.s ?? i.f.s) : i.f.s;
      for (const { p, lag } of E.get(id) || []) { const pi = info.get(p); if (!pi) continue; const pf = pi.st === 'done' ? (pi.a.e ?? pi.f.e) : pi.f.e; if (pf != null && st != null && pf + 1 + lag >= st) stack.push(p); } }
    return set.size > 1 ? set : new Set();
  }
  reindex();
  return { info, proj, crit };
}

export function protoSchedule(P: ProtoProject): number {
  if (P.settings && P.settings.autoSched === false) return 0;
  const idx = new Map(P.nodes.map(n => [n.id, n]));
  const kidsMap = new Map(); kidsMap.set(null, []);
  for (const n of P.nodes) { const k = n.parent ?? null; if (!kidsMap.has(k)) kidsMap.set(k, []); kidsMap.get(k).push(n); }
  const kids = id => kidsMap.get(id ?? null) || [];
  function descendants(id) { const out = []; const st = [...kids(id)]; while (st.length) { const n = st.pop(); out.push(n.id); st.push(...kids(n.id)); } return out; }
  function leafIdsOf(id) { if (!idx.has(id)) return []; return kids(id).length ? descendants(id).filter(d => !kids(d).length) : [id]; }
  const E = new Map();
  for (const n of P.nodes) for (const d of n.deps || []) { const ps = leafIdsOf(d.id), ss = leafIdsOf(n.id); for (const sId of ss) for (const pId of ps) if (pId !== sId) { if (!E.has(sId)) E.set(sId, []); E.get(sId).push({ p: pId, lag: d.lag || 0 }); } }
  if (!E.size) return 0;
  const nodes = new Set(); const indeg = new Map(); const out = new Map();
  for (const [sId, ps] of E) { nodes.add(sId); for (const { p } of ps) { nodes.add(p); if (!out.has(p)) out.set(p, []); out.get(p).push(sId); indeg.set(sId, (indeg.get(sId) || 0) + 1); } }
  const q = [...nodes].filter(x => !indeg.get(x)); const order = [];
  while (q.length) { const x = q.shift(); order.push(x); for (const y of out.get(x) || []) { indeg.set(y, indeg.get(y) - 1); if (!indeg.get(y)) q.push(y); } }
  const rawS = n => toD(n.start) ?? toD(n.bStart) ?? toD(n.end) ?? toD(n.bEnd);
  const rawE = n => toD(n.end) ?? toD(n.bEnd) ?? toD(n.start) ?? toD(n.bStart);
  const predFinish = pn => { if (pn.status === 'cx') return null; return toD(pn.aEnd) ?? rawE(pn); };
  let moved = 0;
  for (const id of order) {
    const n = idx.get(id); const preds = E.get(id); if (!n || !preds) continue;
    if (n.aStart || n.aEnd || n.status === 'done' || n.status === 'cx') continue;
    let es = null; for (const { p, lag } of preds) { const pn = idx.get(p); const pf = pn ? predFinish(pn) : null; if (pf == null) continue; const c = pf + 1 + lag; if (es == null || c > es) es = c; }
    if (es == null) continue;
    const s0 = rawS(n), e0 = rawE(n);
    if (s0 == null) { const dur = 6; n.start = fromD(es); n.end = fromD(es + dur); if (!n.bStart) { n.bStart = n.start; n.bEnd = n.end; } moved++; }
    else if (s0 < es) { const d = es - s0; n.start = fromD(s0 + d); n.end = fromD((e0 ?? s0) + d); moved++; }
  }
  return moved;
}
