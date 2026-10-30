/**
 * Prices shown on the public site, in SAR per user per month, before VAT.
 * They mirror apps/api/src/plans.ts (priceMonthlyUsd × SAR_PER_USD, annual = 20% less), which is what
 * checkout charges; test/site.test.ts fails if the two drift apart.
 */
export const SITE_PRICES = {
  team: { month: 45, year: 36 },
  business: { month: 90, year: 72 },
} as const;

/** Saudi VAT added at checkout, in percent (VAT_RATE in apps/api/src/billing.ts). */
export const SITE_VAT_RATE = 15;

/** Free plan limits (spec 3.4), as in apps/api/src/plans.ts. */
export const FREE_LIMITS = { members: 3, activeProjects: 3, itemsPerProject: 500, baselinesPerProject: 1 } as const;
export const PAID_ITEMS_PER_PROJECT = 10_000;
/** Free trial of Team and Business (TRIAL_DAYS in apps/api/src/billing.ts). */
export const TRIAL_DAYS = 14;
