import { healthRank } from './compute.js';
import { type IsoDate, toIso } from './dates.js';
import { leafEdges } from './deps.js';
import { REPORT_WINDOW_DAYS, reportData } from './report.js';
import { Tree } from './tree.js';
import type { ComputedProject, Health, HealthReason, Project } from './types.js';

/** Longest look-ahead the Team view offers (spec 4.9: 14, 30 or 60 days). */
export const PORTFOLIO_HORIZON_MAX = 60;
/** Behind plan by this many points counts as an early warning. */
const BEHIND_POINTS = 25;

/** Why an open item may slip before it is late (spec 4.9 "early warnings"). Structured so the UI can translate it. */
export type EarlyWarning =
  | { code: 'waits'; predCode: string; predName: string; health: Health }
  | { code: 'late_start'; date: IsoDate | null }
  | { code: 'on_hold' }
  | { code: 'behind_plan'; progress: number; planned: number }
  | { code: 'health'; reason: HealthReason };

/** An open work package that matters to the Team view. Offsets are calendar days from the status date. */
export interface PortfolioTask {
  itemId: string;
  code: string;
  name: string;
  owner: string;
  notes: string;
  level: number;
  forecastStart: IsoDate | null;
  forecastFinish: IsoDate | null;
  startIn: number | null;
  finishIn: number | null;
  notStarted: boolean;
  progress: number;
  health: Health;
  critical: boolean;
  overdue: boolean;
  warning: EarlyWarning | null;
}

export interface PortfolioMilestone {
  itemId: string;
  name: string;
  plannedFinish: IsoDate | null;
  forecastFinish: IsoDate | null;
  variance: number | null;
  health: Health;
}

/** A decision or risk line: typed by people, or suggested from the plan (marked so the UI can say so). */
export type PortfolioNote =
  | { text: string }
  | { recovery: { name: string; variance: number | null } }
  | { item: { name: string; reason: HealthReason } };

/** One project's line in the portfolio. Plain JSON, so the API can send it as is. */
export interface PortfolioEntry {
  id: string;
  name: string;
  statusDate: IsoDate;
  overall: Health;
  progress: number;
  plannedPct: number | null;
  plannedStart: IsoDate | null;
  plannedFinish: IsoDate | null;
  forecastStart: IsoDate | null;
  forecastFinish: IsoDate | null;
  variance: number | null;
  counts: Record<Health, number>;
  topIssue: { name: string; reason: HealthReason } | null;
  decisions: PortfolioNote[];
  decisionsSuggested: boolean;
  risks: PortfolioNote[];
  risksSuggested: boolean;
  /** Open milestones forecast within the longest horizon. */
  milestones: PortfolioMilestone[];
  tasks: PortfolioTask[];
  /** Finish variance per day, oldest first (spec 4.9 trend). Filled by the server from snapshots. */
  trend: { date: IsoDate; variance: number | null }[];
}

const lines = (s: string) => s.split(/\r?\n/).map(l => l.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);

/** Summarise one project for the portfolio (spec 4.9), from the engine's calculations. */
export function portfolioEntry(
  project: Project, c: ComputedProject, summary: { risks?: string; decisions?: string } = {},
): PortfolioEntry {
  const tree = new Tree(project.items);
  const R = reportData(project, c);
  const t = c.statusDate;
  const edges = leafEdges(tree);
  const p = c.project;
  const tasks: PortfolioTask[] = [];
  for (const { item: n, info: i } of R.live) {
    if (i.status === 'completed') continue;
    const fs = i.forecast.start, fe = i.forecast.finish;
    let warning: EarlyWarning | null = null;
    if (!i.overdue) {
      const slipped = (edges.get(n.id) ?? [])
        .map(e => ({ n: tree.byId.get(e.pred), i: c.items.get(e.pred) }))
        .find(x => x.n && x.i && x.i.status !== 'completed' && (x.i.health === 'red' || x.i.health === 'amber'));
      if (slipped) warning = { code: 'waits', predCode: slipped.i!.code, predName: slipped.n!.name, health: slipped.i!.health };
      else if (i.lateStart) warning = { code: 'late_start', date: toIso(i.planned.start) };
      else if (i.status === 'on_hold') warning = { code: 'on_hold' };
      else if (i.plannedPct != null && i.plannedPct - i.progress >= BEHIND_POINTS) warning = { code: 'behind_plan', progress: i.progress, planned: i.plannedPct };
      else if (i.health === 'red' || i.health === 'amber') warning = { code: 'health', reason: i.reason };
    }
    const startIn = fs == null ? null : fs - t, finishIn = fe == null ? null : fe - t;
    const H = PORTFOLIO_HORIZON_MAX;
    const relevant = i.overdue || warning != null ||
      (startIn != null && finishIn != null && startIn <= H && finishIn >= 0);
    if (!relevant) continue;
    tasks.push({
      itemId: n.id, code: i.code, name: n.name, owner: n.owner, notes: n.notes, level: i.level,
      forecastStart: toIso(fs), forecastFinish: toIso(fe), startIn, finishIn, notStarted: i.status === 'not_started',
      progress: i.progress, health: i.health, critical: c.critical.has(n.id), overdue: i.overdue, warning,
    });
  }
  const critLate = R.live.filter(x => c.critical.has(x.item.id) && (x.info.health === 'red' || x.info.health === 'amber'));
  const typedDecisions = lines(summary.decisions ?? '');
  const decisions: PortfolioNote[] = typedDecisions.length
    ? typedDecisions.map(text => ({ text }))
    : critLate.filter(x => x.info.health === 'red').slice(0, 2).map(x => ({ recovery: { name: x.item.name, variance: x.info.variance } }));
  const typedRisks = lines(summary.risks ?? '');
  const risks: PortfolioNote[] = typedRisks.length
    ? typedRisks.map(text => ({ text }))
    : R.delayed.slice(0, 3).map(x => ({ item: { name: x.item.name, reason: x.info.reason } }));
  const top = critLate[0] ?? R.delayed[0];
  const milestones = R.milestones
    .filter(x => x.info.status !== 'completed' && x.info.forecast.finish != null && x.info.forecast.finish <= t + PORTFOLIO_HORIZON_MAX)
    .map(x => ({
      itemId: x.item.id, name: x.item.name, plannedFinish: toIso(x.info.planned.finish), forecastFinish: toIso(x.info.forecast.finish),
      variance: x.info.variance, health: x.info.health,
    }));
  return {
    id: project.id, name: project.name, statusDate: toIso(t)!, overall: R.overall,
    progress: p.progress, plannedPct: p.plannedPct,
    plannedStart: toIso(p.planned.start), plannedFinish: toIso(p.planned.finish),
    forecastStart: toIso(p.forecast.start), forecastFinish: toIso(p.forecast.finish),
    variance: p.variance, counts: R.counts,
    topIssue: top ? { name: top.item.name, reason: top.info.reason } : null,
    decisions, decisionsSuggested: !typedDecisions.length,
    risks: risks.slice(0, typedRisks.length ? 4 : 3), risksSuggested: !typedRisks.length,
    milestones, tasks, trend: [],
  };
}

/** Worst first: Delayed, At risk, On track, then the largest finish slip (spec 4.9, FR-15). */
export function sortPortfolio<T extends Pick<PortfolioEntry, 'overall' | 'variance'>>(entries: T[]): T[] {
  return [...entries].sort((a, b) => healthRank(b.overall) - healthRank(a.overall) || (b.variance ?? -1e9) - (a.variance ?? -1e9));
}

export interface PortfolioTotals {
  projects: number;
  counts: Record<Health, number>;
  avgProgress: number;
  avgPlanned: number | null;
  slipping: number;
  largestSlip: number;
  decisions: number;
  projectsWithDecisions: number;
}

/** Figures for the Executive view's headline cards. */
export function portfolioTotals(entries: PortfolioEntry[]): PortfolioTotals {
  const counts: Record<Health, number> = { green: 0, amber: 0, red: 0, done: 0, none: 0 };
  for (const e of entries) counts[e.overall]++;
  const avg = (v: number[]) => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null);
  return {
    projects: entries.length, counts,
    avgProgress: avg(entries.map(e => e.progress)) ?? 0,
    avgPlanned: avg(entries.flatMap(e => (e.plannedPct == null ? [] : [e.plannedPct]))),
    slipping: entries.filter(e => (e.variance ?? 0) > 0).length,
    largestSlip: Math.max(0, ...entries.map(e => e.variance ?? 0)),
    decisions: entries.reduce((s, e) => s + e.decisions.length, 0),
    projectsWithDecisions: entries.filter(e => e.decisions.length).length,
  };
}

export interface TeamRow extends PortfolioTask {
  projectId: string;
  projectName: string;
}

export interface TeamView {
  owners: string[];
  overdue: TeamRow[];
  /** Due, or not started and starting, within the horizon. */
  upcoming: TeamRow[];
  warnings: TeamRow[];
  criticalToWatch: number;
  /** Open tasks active within the horizon or overdue, per owner ('' = unassigned), all owners. */
  workload: [string, number][];
}

/** The Team view (spec 4.9): overdue, due soon, early warnings and workload, optionally for one owner. */
export function teamView(entries: PortfolioEntry[], opts: { owner?: string; horizon?: number } = {}): TeamView {
  const H = Math.min(opts.horizon ?? REPORT_WINDOW_DAYS, PORTFOLIO_HORIZON_MAX);
  const all: TeamRow[] = entries.flatMap(e => e.tasks.map(x => ({ ...x, projectId: e.id, projectName: e.name })));
  const owners = [...new Set(all.map(x => x.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const mine = all.filter(x => !opts.owner || x.owner === opts.owner);
  const within = (v: number | null) => v != null && v >= 0 && v <= H;
  const dueSoon = (x: TeamRow) => within(x.finishIn);
  const startSoon = (x: TeamRow) => x.notStarted && within(x.startIn);
  const overdue = mine.filter(x => x.overdue).sort((a, b) => (a.finishIn ?? 0) - (b.finishIn ?? 0));
  const upcoming = mine.filter(x => !x.overdue && (dueSoon(x) || startSoon(x)))
    .sort((a, b) => (startSoon(a) ? a.startIn! : a.finishIn!) - (startSoon(b) ? b.startIn! : b.finishIn!));
  const warnings = mine.filter(x => x.warning && !x.overdue)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || healthRank(b.health) - healthRank(a.health));
  const load = new Map<string, number>();
  for (const x of all) {
    // overdue work is still on the owner's desk, so it counts as well
    if (x.overdue || (x.startIn != null && x.finishIn != null && x.startIn <= H && x.finishIn >= 0)) load.set(x.owner, (load.get(x.owner) ?? 0) + 1);
  }
  return {
    owners, overdue, upcoming, warnings,
    criticalToWatch: mine.filter(x => x.critical && (x.overdue || x.warning || dueSoon(x))).length,
    workload: [...load].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
