/** Plan limits (spec 3.4). Infinity = no limit. */
export type Plan = 'free' | 'team' | 'business';

export interface PlanLimits {
  members: number;
  activeProjects: number;
  itemsPerProject: number;
  baselinesPerProject: number;
  portfolio: boolean;
  guests: boolean;
  multipleCalendars: boolean;
  /** Public REST API keys and webhooks (spec 3.4, 7.2). */
  api: boolean;
  /** Single sign-on with Entra ID, Google or another OpenID Connect provider (spec 3.4). */
  sso: boolean;
  /** Days of project activity and audit log kept (spec 3.4); older entries are deleted by the daily job. */
  historyDays: number;
  /** Activity and audit log export to CSV (spec 3.4). */
  historyExport: boolean;
  /** USD per user per month, monthly billing. Annual billing is 20% less. */
  priceMonthlyUsd: number;
}

export const PLANS: Record<Plan, PlanLimits> = {
  free: { members: 3, activeProjects: 3, itemsPerProject: 500, baselinesPerProject: 1, portfolio: false, guests: false, multipleCalendars: false, api: false, sso: false, historyDays: 30, historyExport: false, priceMonthlyUsd: 0 },
  team: { members: Infinity, activeProjects: Infinity, itemsPerProject: 10_000, baselinesPerProject: Infinity, portfolio: true, guests: true, multipleCalendars: false, api: true, sso: false, historyDays: 365, historyExport: false, priceMonthlyUsd: 12 },
  business: { members: Infinity, activeProjects: Infinity, itemsPerProject: 10_000, baselinesPerProject: Infinity, portfolio: true, guests: true, multipleCalendars: true, api: true, sso: true, historyDays: Infinity, historyExport: true, priceMonthlyUsd: 24 },
};

export const ANNUAL_DISCOUNT = 0.2;
export const SAR_PER_USD = 3.75;
