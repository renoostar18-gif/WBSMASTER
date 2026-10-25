/**
 * Demo mode: a stand-in for the API that runs inside the browser, so the app
 * can be tried from a single link with nothing installed. It uses the same
 * engine as the real server; data is kept in this browser only.
 */
import {
  type Baseline, type CalendarDefinition, DEFAULT_SETTINGS, type Op, OpError, type ProjectSettings, SAUDI_WEEK,
  type WbsItem, WorkCalendar, applyOps, blankItem, deleteBaseline, renameBaseline, restoreBaseline, saudiHolidays, saveBaseline,
  toDay, todayDay, toIso,
} from '@wbs-master/engine';
import { ApiError } from '../api.js';

interface DemoProject {
  id: string; name: string; version: number; updatedAt: string;
  settings: ProjectSettings; items: WbsItem[]; baselines: Baseline[];
  summary?: Record<string, string>;
}
interface DemoState {
  signedIn: boolean;
  user: { id: string; email: string; name: string; locale: 'en' | 'ar'; theme: 'auto' | 'light' | 'dark' };
  org: { id: string; name: string; plan: 'team'; role: 'owner' };
  projects: DemoProject[];
}

const KEY = 'wbs.demo.v1';
const uuid = () => crypto.randomUUID();

function calendar(): CalendarDefinition {
  const y = Number(toIso(todayDay())!.slice(0, 4));
  return { ...SAUDI_WEEK, exceptions: [...saudiHolidays(y - 1), ...saudiHolidays(y), ...saudiHolidays(y + 1)] };
}
const CAL = new WorkCalendar(calendar());

/** The WBS Builder prototype's example project: a 24 kV ring main unit development. */
function sampleItems(): WbsItem[] {
  const items: WbsItem[] = [];
  const add = (parentId: string | null, name: string, o: { owner?: string; b?: [string, string]; f?: [string, string]; a?: [string, string?]; p?: number; notes?: string } = {}) => {
    const f = o.f ?? o.b;
    const n = blankItem(parentId, {
      id: uuid(), name, owner: o.owner ?? '',
      plannedStart: o.b?.[0] ?? null, plannedFinish: o.b?.[1] ?? null,
      forecastStart: f?.[0] ?? null, forecastFinish: f?.[1] ?? null,
      actualStart: o.a?.[0] ?? null, actualFinish: o.a?.[1] ?? null,
      progress: o.p ?? 0, notes: o.notes ?? '',
    });
    items.push(n);
    return n.id;
  };
  const pm = add(null, 'Project Management', { owner: 'PMO' });
  add(pm, 'Project charter & business case', { owner: 'PMO', b: ['2026-07-05', '2026-07-23'], f: ['2026-07-05', '2026-07-28'], a: ['2026-07-05', '2026-07-28'], p: 100 });
  add(pm, 'Stage-gate reviews (G1–G6)', { owner: 'PMO', b: ['2026-07-26', '2027-03-25'], a: ['2026-07-26'], p: 30 });
  const de = add(null, 'Design & Engineering', { owner: 'R&D' });
  const el = add(de, 'Electrical design', { owner: 'R&D' });
  const sld = add(el, 'Single-line diagram & ratings', { owner: 'R&D', b: ['2026-07-26', '2026-08-20'], f: ['2026-07-26', '2026-08-27'], a: ['2026-07-26', '2026-08-27'], p: 100 });
  const bus = add(el, 'Busbar & insulation design', { owner: 'R&D', b: ['2026-08-16', '2026-09-24'], f: ['2026-08-23', '2026-10-08'], a: ['2026-08-23'], p: 85, notes: 'Waiting on insulation supplier data' });
  const me = add(de, 'Mechanical design', { owner: 'R&D' });
  add(me, 'Enclosure & tank 3D model', { owner: 'R&D', b: ['2026-08-09', '2026-09-17'], a: ['2026-08-09', '2026-09-17'], p: 100 });
  const mech = add(me, 'Mechanism integration', { owner: 'R&D', b: ['2026-09-13', '2026-10-22'], f: ['2026-09-20', '2026-11-05'], a: ['2026-09-20'], p: 45 });
  const tt = add(null, 'Prototype & Type Test', { owner: 'R&D' });
  const proto = add(tt, 'Prototype build', { owner: 'Industrialization', b: ['2026-10-25', '2026-11-26'], f: ['2026-11-08', '2026-12-10'] });
  const tests = add(tt, 'IEC 62271-200 type tests', { owner: 'R&D', b: ['2026-11-29', '2027-01-14'], f: ['2026-12-13', '2027-01-28'] });
  const cert = add(tt, 'Type test certificate', { owner: 'R&D', b: ['2027-01-17', '2027-01-17'], f: ['2027-01-31', '2027-01-31'], notes: 'Milestone' });
  const ind = add(null, 'Industrialization', { owner: 'Industrialization' });
  add(ind, 'Process & tooling design', { owner: 'Industrialization', b: ['2026-10-11', '2026-12-31'], a: ['2026-10-11'], p: 5 });
  const pilot = add(ind, 'Pilot production run', { owner: 'Industrialization', b: ['2027-01-24', '2027-02-25'], f: ['2027-02-07', '2027-03-11'] });
  const cl = add(null, 'Commercial Launch', { owner: 'Sales' });
  add(cl, 'Datasheets & pricing', { owner: 'Sales', b: ['2027-01-31', '2027-02-25'] });
  const handover = add(cl, 'Hand over to production', { owner: 'PMO', b: ['2027-03-07', '2027-03-07'], f: ['2027-03-21', '2027-03-21'], notes: 'Milestone' });
  // the chain that drives the finish date
  const link = (succ: string, pred: string) => items.find(i => i.id === succ)!.deps.push({ id: pred, lag: 0 });
  link(bus, sld); link(proto, mech); link(proto, bus); link(tests, proto); link(cert, tests); link(pilot, cert); link(handover, pilot);
  return items;
}

function seed(): DemoState {
  return {
    signedIn: true,
    user: { id: uuid(), email: 'demo@wbs-master.example', name: 'Demo user', locale: 'en', theme: 'auto' },
    org: { id: uuid(), name: 'Demo workspace', plan: 'team', role: 'owner' },
    projects: [{
      id: uuid(), name: '24 kV RMU development', version: 1, updatedAt: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS }, items: sampleItems(), baselines: [],
    }],
  };
}

let state: DemoState | null = null;
function load(): DemoState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw) as DemoState;
  } catch { /* storage blocked: keep the demo in memory */ }
  return (state ??= seed());
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked or full */ }
}

/** Start the demo again from the example project. */
export function resetDemo() {
  state = seed();
  persist();
}

const notFound = () => new ApiError(404, 'not_found');

export async function demoRequest<T>(method: string, url: string, body: unknown): Promise<T> {
  const s = load();
  const b = (body ?? {}) as Record<string, unknown>;
  const route = `${method} ${url}`;
  const out = (v: unknown) => { persist(); return v as T; };

  if (route === 'POST /auth/logout') { s.signedIn = false; return out({ ok: true }); }
  if (route === 'POST /auth/login' || route === 'POST /auth/signup') {
    if (typeof b.name === 'string' && b.name.trim()) s.user.name = b.name.trim();
    if (typeof b.email === 'string') s.user.email = b.email;
    if (typeof b.organisation === 'string' && b.organisation.trim()) s.org.name = b.organisation.trim();
    s.signedIn = true;
    return out({ user: s.user, orgId: s.org.id });
  }
  if (!s.signedIn) throw new ApiError(401, 'not_signed_in');
  if (route === 'GET /me') return out({ user: s.user, organisations: [s.org] });
  if (route === 'PATCH /me') { Object.assign(s.user, b); return out({ user: s.user }); }

  let m = /^\/orgs\/[^/]+\/projects$/.exec(url);
  if (m && method === 'GET') {
    return out({
      projects: s.projects.map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, itemCount: p.items.length, role: 'admin', archived: false })),
    });
  }
  if (m && method === 'POST') {
    const p: DemoProject = {
      id: uuid(), name: String(b.name ?? 'Untitled project'), version: 0, updatedAt: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS }, items: [], baselines: [],
    };
    s.projects.unshift(p);
    return out({ id: p.id });
  }

  const EMPTY_SUMMARY = { narrative: '', achievements: '', nextSteps: '', risks: '', decisions: '' };
  const bm = /^\/projects\/([^/]+)\/(summary|activity|baselines)(?:\/([^/]+))?(\/restore)?(?:\?.*)?$/.exec(url);
  if (bm) {
    const p = s.projects.find(x => x.id === bm[1]);
    if (!p) throw notFound();
    const asProject = () => ({ id: p.id, name: p.name, items: p.items, baselines: p.baselines, settings: p.settings });
    const apply = (next: ReturnType<typeof asProject>) => { p.items = next.items; p.baselines = next.baselines; p.settings = next.settings; p.version++; };
    if (bm[2] === 'activity') return out({ activity: [] }); // the demo keeps no history
    if (bm[2] === 'summary' && method === 'PUT') { p.summary = { ...EMPTY_SUMMARY, ...p.summary, ...(b as Record<string, string>) }; return out({ ok: true }); }
    if (bm[2] === 'baselines' && method === 'POST' && !bm[3]) {
      const r = saveBaseline(asProject(), { name: b.name as string | undefined, reason: b.reason as string | undefined, today: todayDay() });
      if (typeof r === 'string') throw new ApiError(400, r);
      r.baselines = r.baselines.map(x => (p.baselines.some(y => y.id === x.id) ? x : { ...x, id: uuid() }));
      apply(r);
      return out({ saved: r.baselines.slice(-1).map(x => x.name) });
    }
    if (bm[2] === 'baselines' && bm[3] && bm[4] && method === 'POST') { apply(restoreBaseline(asProject(), bm[3])); return out({ ok: true }); }
    if (bm[2] === 'baselines' && bm[3] && method === 'PATCH') { apply(renameBaseline(asProject(), bm[3], String(b.name ?? ''))); return out({ ok: true }); }
    if (bm[2] === 'baselines' && bm[3] && method === 'DELETE') { apply(deleteBaseline(asProject(), bm[3])); return out({ ok: true }); }
    throw notFound();
  }

  m = /^\/projects\/([^/]+)(\/ops)?$/.exec(url);
  const p = m ? s.projects.find(x => x.id === m![1]) : undefined;
  if (!m || !p) throw notFound();
  const touch = () => { p.version++; p.updatedAt = new Date().toISOString(); };

  if (!m[2] && method === 'GET') {
    return out({
      project: { id: p.id, orgId: s.org.id, name: p.name, version: p.version, calendarId: null, locale: 'en', archived: false, settings: p.settings },
      role: 'admin', items: p.items, baselines: p.baselines, calendar: calendar(),
      summary: { ...EMPTY_SUMMARY, ...p.summary },
    });
  }
  if (!m[2] && method === 'PATCH') {
    if (typeof b.name === 'string') p.name = b.name;
    for (const k of ['statusDate', 'redThresholdDays', 'autoSchedule', 'activeBaselineId'] as const) {
      if (k in b) (p.settings as unknown as Record<string, unknown>)[k] = b[k];
    }
    touch();
    return out({ ok: true });
  }
  if (m[2] && method === 'POST') {
    try {
      const statusDate = toDay(p.settings.statusDate) ?? todayDay();
      const r = applyOps({ id: p.id, name: p.name, items: p.items, baselines: p.baselines, settings: p.settings }, (b.ops ?? []) as Op[],
        { statusDate, calendar: CAL, maxItems: 10_000 });
      p.items = r.project.items;
      touch();
      return out({ version: p.version, items: p.items, scheduled: r.scheduled, ignoredDeps: r.ignoredDeps, created: r.created });
    } catch (e) {
      if (e instanceof OpError) throw new ApiError(400, e.code, e.details, e.index);
      throw e;
    }
  }
  throw notFound();
}
