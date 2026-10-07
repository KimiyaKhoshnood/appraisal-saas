/**
 * Feature catalog (level 1 of the customisation ladder). A plan decides which features a
 * tenant *may* enable; the tenant admin decides which of those are *on*.
 */
export const FEATURES = {
  reports: 'Summary reports for managers and admins',
  analytics: 'Score distribution and trend analytics',
  csvExport: 'CSV export of cycle results',
  customRoles: 'Define custom roles from the permission catalog',
} as const;

export type FeatureKey = keyof typeof FEATURES;
export const ALL_FEATURES = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURES, value);
}

export const PLANS = {
  STARTER: { name: 'Starter', features: [] as FeatureKey[] },
  BUSINESS: { name: 'Business', features: ['reports', 'csvExport'] as FeatureKey[] },
  ENTERPRISE: { name: 'Enterprise', features: [...ALL_FEATURES] },
} as const;

export type PlanCode = keyof typeof PLANS;
export const PLAN_CODES = Object.keys(PLANS) as PlanCode[];
