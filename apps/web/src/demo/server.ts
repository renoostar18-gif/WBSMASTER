/**
 * Demo mode: a stand-in for the API that runs inside the browser, so the app
 * can be tried from a single link with nothing installed. It uses the same
 * engine as the real server; data is kept in this browser only.
 */
import {
  type Baseline, type CalendarDefinition, DEFAULT_SETTINGS, type Op, OpError, type ProjectSettings, SAUDI_WEEK,
  type WbsItem, WorkCalendar, applyOps, blankItem, computeProject, deleteBaseline, portfolioEntry, renameBaseline, restoreBaseline,
  saudiHolidays, saveBaseline, sortPortfolio, toDay, todayDay, toIso,
} from '@wbs-master/engine';
import type { Notification } from '../Bell.js';
import type { Comment, Person } from '../project/comments.js';
import { ApiError } from '../api.js';

interface DemoProject {
  id: string; name: string; version: number; updatedAt: string;
  settings: ProjectSettings; items: WbsItem[]; baselines: Baseline[];
  summary?: Record<string, string>;
  comments?: Comment[];
  /** Finish variance per day, for the portfolio trend. */
  trend?: { date: string; variance: number | null }[];
}
interface DemoState {
  signedIn: boolean;
  user: { id: string; email: string; name: string; locale: 'en' | 'ar'; theme: 'auto' | 'light' | 'dark'; notifyEmail: 'instant' | 'daily' | 'off' };
  org: { id: string; name: string; plan: 'free' | 'team' | 'business'; role: 'owner' };
  projects: DemoProject[];
  notifications?: Notification[];
  people?: { id: string; email: string; name: string; role: 'owner' | 'admin' | 'member' | 'guest' }[];
  invitations?: { id: string; email: string; role: 'admin' | 'member' | 'guest'; invitedBy: string; createdAt: string; expiresAt: string; expired: boolean }[];
  billing?: DemoBilling;
}
interface DemoInvoice {
  id: string; number: number; status: 'paid'; kind: 'new' | 'renew' | 'upgrade'; plan: 'team' | 'business'; interval: 'month' | 'year'; seats: number;
  periodStart: string; periodEnd: string; total: number; createdAt: string; paidAt: string; payUrl: null;
}
interface DemoBilling {
  trial: { plan: 'team' | 'business'; ends: string } | null;
  current: { plan: 'team' | 'business'; interval: 'month' | 'year'; seats: number; periodStart: string; periodEnd: string } | null;
  invoices: DemoInvoice[];
  profile: { name: string; address: string; vatNumber: string; email: string };
}

/** Seat prices in halalas, as on the server (apps/api/src/billing.ts): SAR 45 / 90 a month, 20% off a year. */
const SEAT = { team: { month: 4500, year: 43200 }, business: { month: 9000, year: 86400 } } as const;
const VAT_RATE = 15;
const addDays = (iso: string, n: number) => toIso(toDay(iso)! + n)!;
function addInterval(iso: string, interval: 'month' | 'year') {
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  const ty = interval === 'year' || mo === 12 ? y + 1 : y;
  const tm = interval === 'year' ? mo : mo === 12 ? 1 : mo + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const KEY = 'wbs.demo.v3';
/** Example colleagues, so @mentions can be tried in the demo. */
const COLLEAGUES: Person[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Sara Ahmed', email: 'sara@wbs-master.example' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Omar Khalid', email: 'omar@wbs-master.example' },
];
const uuid = () => crypto.randomUUID();

function calendar(): CalendarDefinition {
  const y = Number(toIso(todayDay())!.slice(0, 4));
  return { ...SAUDI_WEEK, exceptions: [...saudiHolidays(y - 1), ...saudiHolidays(y), ...saudiHolidays(y + 1)] };
}
const CAL = new WorkCalendar(calendar());

type SampleOpts = { owner?: string; b?: [string, string]; f?: [string, string]; a?: [string, string?]; p?: number; notes?: string };

/** Builds sample items; `add` returns the new item's id. */
function builder() {
  const items: WbsItem[] = [];
  const add = (parentId: string | null, name: string, o: SampleOpts = {}) => {
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
  const link = (succ: string, pred: string) => items.find(i => i.id === succ)!.deps.push({ id: pred, lag: 0 });
  return { items, add, link };
}

/** Example: a substation automation upgrade, on plan. */
function substationItems(): WbsItem[] {
  const { items, add, link } = builder();
  const eng = add(null, 'Engineering', { owner: 'Engineering' });
  const study = add(eng, 'Protection coordination study', { owner: 'Engineering', b: ['2026-09-06', '2026-10-15'], a: ['2026-09-06', '2026-10-15'], p: 100 });
  const panel = add(eng, 'Control panel design', { owner: 'Engineering', b: ['2026-10-11', '2026-11-12'], a: ['2026-10-11'], p: 50 });
  const del = add(null, 'Delivery', { owner: 'Projects' });
  const fat = add(del, 'Factory acceptance test', { owner: 'Quality', b: ['2026-11-15', '2026-11-26'] });
  const site = add(del, 'Site installation & commissioning', { owner: 'Projects', b: ['2026-12-06', '2026-12-24'] });
  const energ = add(del, 'Energisation', { owner: 'Projects', b: ['2026-12-27', '2026-12-27'], notes: 'Milestone' });
  link(panel, study); link(fat, panel); link(site, fat); link(energ, site);
  return items;
}

/** Example: an ERP roll-out at a second plant, running late. */
function erpItems(): WbsItem[] {
  const { items, add, link } = builder();
  const map = add(null, 'Process mapping', { owner: 'IT', b: ['2026-08-02', '2026-08-27'], f: ['2026-08-02', '2026-09-10'], a: ['2026-08-02', '2026-09-10'], p: 100 });
  const data = add(null, 'Data migration', { owner: 'IT', b: ['2026-09-06', '2026-10-08'], f: ['2026-09-13', '2026-11-05'], a: ['2026-09-13'], p: 40, notes: 'Legacy BOM data needs cleaning' });
  const train = add(null, 'User training', { owner: 'HR', b: ['2026-10-18', '2026-11-05'], f: ['2026-11-08', '2026-11-26'] });
  const live = add(null, 'Go-live', { owner: 'IT', b: ['2026-11-08', '2026-11-08'], f: ['2026-11-29', '2026-11-29'], notes: 'Milestone' });
  link(data, map); link(train, data); link(live, train);
  return items;
}

/** The WBS Builder prototype's example project: a 24 kV ring main unit development. */
function sampleItems(): WbsItem[] {
  const { items, add, link } = builder();
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
  link(bus, sld); link(proto, mech); link(proto, bus); link(tests, proto); link(cert, tests); link(pilot, cert); link(handover, pilot);
  return items;
}

function seed(): DemoState {
  const user = { id: uuid(), email: 'demo@wbs-master.example', name: 'Demo user', locale: 'en' as const, theme: 'auto' as const, notifyEmail: 'off' as const };
  const project = (name: string, items: WbsItem[], trend: number[]): DemoProject => ({
    id: uuid(), name, version: 1, updatedAt: new Date().toISOString(), settings: { ...DEFAULT_SETTINGS }, items, baselines: [],
    // a few weeks of finish slip, so the portfolio trend has a line to draw
    trend: trend.map((variance, k) => ({ date: toIso(todayDay() - 7 * (trend.length - k))!, variance })),
  });
  const rmu = project('24 kV RMU development', sampleItems(), [0, 5, 5, 10, 10]);
  const busbar = rmu.items.find(i => i.name === 'Busbar & insulation design')!;
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  const threadId = uuid();
  rmu.comments = [
    { id: threadId, itemId: busbar.id, parentId: null, body: `The supplier promised the insulation test data by Thursday. @${user.name} can you update the forecast when it arrives?`,
      mentions: [user.id], createdAt: at(2), editedAt: null, resolvedAt: null, resolvedByName: null, authorId: COLLEAGUES[0]!.id, authorName: COLLEAGUES[0]!.name },
    { id: uuid(), itemId: busbar.id, parentId: threadId, body: 'If it slips again, prototype build moves too: it is on the critical path.',
      mentions: [], createdAt: at(1), editedAt: null, resolvedAt: null, resolvedByName: null, authorId: COLLEAGUES[1]!.id, authorName: COLLEAGUES[1]!.name },
  ];
  const mention: Notification = {
    id: uuid(), kind: 'mention', projectId: rmu.id, itemId: busbar.id, commentId: threadId, createdAt: at(2), readAt: null,
    data: { actorName: COLLEAGUES[0]!.name, projectName: rmu.name, itemName: busbar.name, excerpt: rmu.comments[0]!.body },
  };
  return {
    signedIn: true, user, notifications: [mention],
    org: { id: uuid(), name: 'Demo workspace', plan: 'team', role: 'owner' },
    projects: [rmu, project('Substation automation upgrade', substationItems(), [0, 0, 0, 0]), project('ERP roll-out – Plant 2', erpItems(), [5, 10, 15, 20, 25])],
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

/** Today's point of the portfolio trend (spec 4.9): one per day, the latest value wins. */
function recordTrend(p: DemoProject, variance: number | null) {
  const date = toIso(todayDay())!;
  p.trend = [...(p.trend ?? []).filter(x => x.date !== date), { date, variance }].slice(-180);
}

export async function demoRequest<T>(method: string, url: string, body: unknown): Promise<T> {
  const s = load();
  const b = (body ?? {}) as Record<string, unknown>;
  const route = `${method} ${url}`;
  // a copy, as a real response would be: callers must never share the stored arrays (React would see no change)
  const out = (v: unknown) => { persist(); return structuredClone(v) as T; };

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
  // the demo sends no email; notifications come from the example colleagues only
  const notes = (s.notifications ??= []);
  if (route === 'GET /notifications/unread') return out({ unread: notes.filter(n => !n.readAt).length });
  if (route === 'GET /notifications') return out({ notifications: notes, unread: notes.filter(n => !n.readAt).length });
  if (route === 'POST /notifications/read') {
    const ids = b.ids as string[] | undefined;
    for (const n of notes) if (!ids || ids.includes(n.id)) n.readAt ??= new Date().toISOString();
    return out({ ok: true });
  }

  const r = demoOrgRoute(s, method, url, b);
  if (r !== undefined) return out(r);

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

  const asModel = (p: DemoProject, statusDate?: string | null) => ({
    id: p.id, name: p.name, items: p.items, baselines: p.baselines,
    settings: statusDate ? { ...p.settings, statusDate } : p.settings,
  });
  m = /^\/orgs\/[^/]+\/portfolio(?:\?asOf=(\d{4}-\d{2}-\d{2}))?$/.exec(url);
  if (m && method === 'GET') {
    const asOf = m[1] ?? null, today = todayDay();
    const entries = s.projects.map(p => {
      const model = asModel(p, asOf);
      const c = computeProject(model, { calendar: CAL, today });
      if (!asOf && !p.settings.statusDate) recordTrend(p, c.project.variance);
      return { ...portfolioEntry(model, c, p.summary), trend: p.trend ?? [] };
    });
    return out({ statusDate: asOf ?? toIso(today), projects: sortPortfolio(entries) });
  }

  const cm = /^\/projects\/([^/]+)\/(comments|people)(?:\/([^/]+))?(\/resolve)?$/.exec(url);
  if (cm) {
    const p = s.projects.find(x => x.id === cm[1]);
    if (!p) throw notFound();
    const people: Person[] = [{ id: s.user.id, name: s.user.name, email: s.user.email }, ...COLLEAGUES];
    if (cm[2] === 'people') return out({ people });
    const list = (p.comments ??= []);
    if (!cm[3] && method === 'GET') return out({ comments: list });
    if (!cm[3] && method === 'POST') {
      const text = String(b.body ?? '').trim();
      if (!text) throw new ApiError(400, 'invalid_request');
      const parent = b.parentId ? list.find(c => c.id === b.parentId) : undefined;
      if (b.parentId && !parent) throw new ApiError(404, 'comment_not_found');
      if (parent?.parentId) throw new ApiError(400, 'reply_to_reply');
      const ids = new Set(people.map(x => x.id));
      const c: Comment = {
        id: uuid(), itemId: parent ? parent.itemId : ((b.itemId as string | null) ?? null), parentId: parent?.id ?? null, body: text,
        mentions: ((b.mentions as string[] | undefined) ?? []).filter(id => ids.has(id) && id !== s.user.id),
        createdAt: new Date().toISOString(), editedAt: null, resolvedAt: null, resolvedByName: null, authorId: s.user.id, authorName: s.user.name,
      };
      list.push(c);
      if (parent) { parent.resolvedAt = null; parent.resolvedByName = null; }
      return out({ id: c.id, mentions: c.mentions });
    }
    const c = list.find(x => x.id === cm[3]);
    if (!c) throw new ApiError(404, 'comment_not_found');
    if (cm[4] && method === 'POST') {
      if (c.parentId) throw new ApiError(400, 'not_thread');
      c.resolvedAt = b.resolved ? new Date().toISOString() : null;
      c.resolvedByName = b.resolved ? s.user.name : null;
      return out({ ok: true });
    }
    if (method === 'PATCH') { c.body = String(b.body ?? '').trim() || c.body; c.editedAt = new Date().toISOString(); return out({ ok: true }); }
    if (method === 'DELETE') { p.comments = list.filter(x => x.id !== c.id && x.parentId !== c.id); return out({ ok: true }); }
    throw notFound();
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
      if (!p.settings.statusDate) recordTrend(p, computeProject(asModel(p), { calendar: CAL, today: todayDay() }).project.variance);
      return out({ version: p.version, items: p.items, scheduled: r.scheduled, ignoredDeps: r.ignoredDeps, created: r.created });
    } catch (e) {
      if (e instanceof OpError) throw new ApiError(400, e.code, e.details, e.index);
      throw e;
    }
  }
  throw notFound();
}

/**
 * Members, invitations and billing in the demo: kept in this browser, no email is sent and no payment
 * is taken (paying marks the invoice paid at once). Returns undefined for other routes.
 */
function demoOrgRoute(s: DemoState, method: string, url: string, b: Record<string, unknown>): unknown {
  const today = toIso(todayDay())!;
  const people = (s.people ??= [
    { id: s.user.id, email: s.user.email, name: s.user.name, role: 'owner' },
    { ...COLLEAGUES[0]!, role: 'member' },
    { ...COLLEAGUES[1]!, role: 'admin' },
  ]);
  people[0] = { ...people[0]!, name: s.user.name, email: s.user.email };
  const invites = (s.invitations ??= []);
  const billing = (s.billing ??= {
    trial: { plan: 'team', ends: addDays(today, 10) }, current: null, invoices: [],
    profile: { name: '', address: '', vatNumber: '', email: '' },
  });
  const seatsUsed = () => people.filter(p => p.role !== 'guest').length + invites.filter(i => i.role !== 'guest').length;
  const route = `${method} ${url.replace(/^\/orgs\/[^/]+/, '/orgs/:org')}`;

  if (route === 'GET /orgs/:org/members') return { members: people };
  if (route === 'POST /orgs/:org/members') {
    const email = String(b.email ?? '').trim().toLowerCase();
    const role = (b.role ?? 'member') as 'admin' | 'member' | 'guest';
    if (people.some(p => p.email.toLowerCase() === email)) throw new ApiError(409, 'already_member');
    const seats = billing.current?.seats;
    if (role !== 'guest' && seats != null && seats <= seatsUsed()) throw new ApiError(403, 'plan_seat_limit');
    const old = invites.findIndex(i => i.email === email);
    if (old >= 0) invites.splice(old, 1);
    invites.unshift({ id: uuid(), email, role, invitedBy: s.user.name, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(), expired: false });
    return { invited: true };
  }
  let m = /^(PATCH|DELETE) \/orgs\/:org\/members\/([^/]+)$/.exec(route);
  if (m) {
    const i = people.findIndex(p => p.id === m![2]);
    if (i < 0) throw new ApiError(404, 'member_not_found');
    if (m[1] === 'DELETE') people.splice(i, 1);
    else people[i] = { ...people[i]!, role: b.role as 'owner' };
    if (!people.some(p => p.role === 'owner')) throw new ApiError(400, 'last_owner');
    return { ok: true };
  }
  if (route === 'GET /orgs/:org/invitations') {
    return { invitations: invites, seats: { used: seatsUsed(), limit: billing.current?.seats ?? null } };
  }
  m = /^(POST|DELETE) \/orgs\/:org\/invitations\/([^/]+)(\/resend)?$/.exec(route);
  if (m) {
    const i = invites.findIndex(x => x.id === m![2]);
    if (i < 0) throw new ApiError(404, 'invitation_not_found');
    if (m[1] === 'DELETE') invites.splice(i, 1);
    else invites[i]!.expiresAt = new Date(Date.now() + 14 * 864e5).toISOString();
    return { ok: true };
  }

  // billing: the plan in force comes from the paid period, then the trial
  const cur = billing.current && today < billing.current.periodEnd ? billing.current : null;
  const trial = !cur && billing.trial && today < billing.trial.ends ? billing.trial : null;
  s.org.plan = cur?.plan ?? trial?.plan ?? 'free';
  if (route === 'GET /orgs/:org/billing') {
    return {
      plan: s.org.plan, seats: cur?.seats ?? null, members: people.filter(p => p.role !== 'guest').length, current: cur,
      paidUntil: cur?.periodEnd ?? null, inGrace: false, renewed: false, trial, trialAvailable: false, trialDays: 14,
      payments: true, vatRate: VAT_RATE, comped: false, prices: SEAT, profile: billing.profile, invoices: billing.invoices,
    };
  }
  if (route === 'PUT /orgs/:org/billing/profile') { billing.profile = b as DemoBilling['profile']; return { ok: true }; }
  if (route === 'POST /orgs/:org/billing/quote' || route === 'POST /orgs/:org/billing/checkout') {
    const plan = b.plan as 'team' | 'business', interval = b.interval as 'month' | 'year', seats = Number(b.seats);
    if (seats < people.filter(p => p.role !== 'guest').length) throw new ApiError(400, 'billing_seats_below_members');
    const kind = cur ? 'renew' as const : 'new' as const;
    const periodStart = cur ? cur.periodEnd : today;
    const periodEnd = addInterval(periodStart, interval);
    const subtotal = SEAT[plan][interval] * seats, vat = Math.round(subtotal * VAT_RATE / 100);
    const q = { kind, plan, interval, seats, seatPrice: SEAT[plan][interval], periodStart, periodEnd, subtotal, vatRate: VAT_RATE, vat, total: subtotal + vat };
    if (route.endsWith('quote')) return q;
    const now = new Date().toISOString();
    billing.invoices.unshift({ id: uuid(), number: billing.invoices.length + 1, status: 'paid', kind, plan, interval, seats, periodStart, periodEnd, total: q.total, createdAt: now, paidAt: now, payUrl: null });
    billing.current = { plan, interval, seats, periodStart: cur ? cur.periodStart : periodStart, periodEnd };
    billing.trial = null;
    s.org.plan = plan;
    // no payment page in the demo: the page shows the result straight away
    return { id: billing.invoices[0]!.id, url: null, demoPaid: true, quote: q };
  }
  if (route === 'POST /orgs/:org/billing/trial') {
    billing.trial = { plan: b.plan as 'team', ends: addDays(today, 14) };
    return billing.trial;
  }
  return undefined;
}
