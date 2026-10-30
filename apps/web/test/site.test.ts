import { describe, expect, it } from 'vitest';
import { ANNUAL_DISCOUNT, PLANS, SAR_PER_USD } from '../../api/src/plans.js';
import { FREE_LIMITS, PAID_ITEMS_PER_PROJECT, SITE_PRICES } from '../src/site/pricing.js';

describe('public site prices', () => {
  it('match what checkout charges', () => {
    for (const p of ['team', 'business'] as const) {
      const month = PLANS[p].priceMonthlyUsd * SAR_PER_USD;
      expect(SITE_PRICES[p].month).toBe(month);
      expect(SITE_PRICES[p].year).toBe(Math.round(month * (1 - ANNUAL_DISCOUNT)));
    }
  });
  it('state the plan limits the API enforces', () => {
    expect(FREE_LIMITS.members).toBe(PLANS.free.members);
    expect(FREE_LIMITS.activeProjects).toBe(PLANS.free.activeProjects);
    expect(FREE_LIMITS.itemsPerProject).toBe(PLANS.free.itemsPerProject);
    expect(FREE_LIMITS.baselinesPerProject).toBe(PLANS.free.baselinesPerProject);
    expect(PAID_ITEMS_PER_PROJECT).toBe(PLANS.team.itemsPerProject);
  });
});
