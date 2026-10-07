import { z } from 'zod';
import type { PlanCode } from './features.js';

/**
 * Evaluation policy — level 2 (parameters) and level 3 (strategy selection) of the
 * customisation ladder. Every behavioural difference between tenants lives here as data.
 */
export const CYCLE_CADENCES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const RESULT_VISIBILITY = ['AFTER_PUBLISH', 'MANAGERS_ONLY'] as const;
export const APPROVAL_STRATEGIES = ['SINGLE', 'TWO_STAGE'] as const;

export type CycleCadence = (typeof CYCLE_CADENCES)[number];
export type ResultVisibility = (typeof RESULT_VISIBILITY)[number];
export type ApprovalStrategyKey = (typeof APPROVAL_STRATEGIES)[number];

export const scaleSchema = z
  .object({
    min: z.number().int().min(0).max(1),
    max: z.number().int().min(3).max(10),
  })
  .strict();

export const evaluationPolicySchema = z
  .object({
    cycle: z.enum(CYCLE_CADENCES),
    scale: scaleSchema,
    selfAssessmentRequired: z.boolean(),
    approvalRequired: z.boolean(),
    approvalStrategy: z.enum(APPROVAL_STRATEGIES),
    resultVisibility: z.enum(RESULT_VISIBILITY),
  })
  .strict();

export type EvaluationPolicy = z.infer<typeof evaluationPolicySchema>;

/** Partial override stored per tenant; missing keys fall through to lower layers. */
export const evaluationPolicyOverrideSchema = evaluationPolicySchema.partial().strict();
export type EvaluationPolicyOverride = z.infer<typeof evaluationPolicyOverrideSchema>;

/** Versioned shape of the `tenant_settings.settings` JSONB document. */
export const SETTINGS_SCHEMA_VERSION = 1;
export const tenantSettingsDocumentSchema = z
  .object({
    schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
    evaluation: evaluationPolicyOverrideSchema,
  })
  .strict();
export type TenantSettingsDocument = z.infer<typeof tenantSettingsDocumentSchema>;

/** Layer 1: platform defaults. */
export const PLATFORM_DEFAULT_POLICY: EvaluationPolicy = {
  cycle: 'QUARTERLY',
  scale: { min: 1, max: 5 },
  selfAssessmentRequired: true,
  approvalRequired: false,
  approvalStrategy: 'SINGLE',
  resultVisibility: 'AFTER_PUBLISH',
};

/** Layer 2: what each plan allows. */
export interface PlanPolicyLimits {
  approvalStrategies: readonly ApprovalStrategyKey[];
  maxScale: number;
}

export const PLAN_POLICY_LIMITS: Record<PlanCode, PlanPolicyLimits> = {
  STARTER: { approvalStrategies: ['SINGLE'], maxScale: 5 },
  BUSINESS: { approvalStrategies: ['SINGLE', 'TWO_STAGE'], maxScale: 10 },
  ENTERPRISE: { approvalStrategies: ['SINGLE', 'TWO_STAGE'], maxScale: 10 },
};

export interface PolicyViolation {
  path: string;
  message: string;
}

/** Checks a tenant override against its plan; used to reject writes with a precise error. */
export function checkOverrideAgainstPlan(
  override: EvaluationPolicyOverride,
  plan: PlanCode,
): PolicyViolation[] {
  const limits = PLAN_POLICY_LIMITS[plan];
  const violations: PolicyViolation[] = [];
  if (override.approvalStrategy && !limits.approvalStrategies.includes(override.approvalStrategy)) {
    violations.push({
      path: 'approvalStrategy',
      message: `The ${plan} plan does not include the ${override.approvalStrategy} approval strategy`,
    });
  }
  if (override.scale && override.scale.max > limits.maxScale) {
    violations.push({
      path: 'scale.max',
      message: `The ${plan} plan allows a scale up to ${limits.maxScale}`,
    });
  }
  return violations;
}

/**
 * Effective policy = platform default ← plan limits ← tenant override.
 * Values the plan no longer allows (e.g. after a downgrade) fall back instead of failing:
 * a plan change must never break a running cycle.
 */
export function resolveEvaluationPolicy(
  override: EvaluationPolicyOverride,
  plan: PlanCode,
): EvaluationPolicy {
  const limits = PLAN_POLICY_LIMITS[plan];
  const merged: EvaluationPolicy = { ...PLATFORM_DEFAULT_POLICY, ...override };
  if (!limits.approvalStrategies.includes(merged.approvalStrategy)) {
    merged.approvalStrategy = limits.approvalStrategies[0] ?? 'SINGLE';
  }
  if (merged.scale.max > limits.maxScale) {
    merged.scale = { ...merged.scale, max: limits.maxScale };
  }
  return merged;
}
