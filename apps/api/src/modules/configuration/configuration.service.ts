import { Injectable } from '@nestjs/common';
import {
  ALL_FEATURES,
  DEFAULT_BRANDING,
  FEATURES,
  PLANS,
  PLAN_POLICY_LIMITS,
  SETTINGS_SCHEMA_VERSION,
  brandingSchema,
  checkOverrideAgainstPlan,
  evaluationPolicyOverrideSchema,
  isFeatureKey,
  resolveEvaluationPolicy,
  tenantSettingsDocumentSchema,
  type Branding,
  type EvaluationPolicy,
  type EvaluationPolicyOverride,
  type FeatureKey,
  type PlanCode,
  type PublicBranding,
  type TenantSettingsDocument,
} from '@appraisal/contracts';
import { BusinessRuleError, Database, EventBus, TenantContext, TtlCache, ValidationFailedError, zodIssues } from '../../core';
import type { Prisma } from '../../generated/prisma/client';

export interface EffectiveConfig {
  configVersion: number;
  branding: Branding;
  features: ReadonlySet<FeatureKey>;
  policy: EvaluationPolicy;
  override: EvaluationPolicyOverride;
}

export interface FeatureState {
  key: FeatureKey;
  description: string;
  allowedByPlan: boolean;
  enabled: boolean;
}

function parseDocument(raw: unknown): TenantSettingsDocument {
  const parsed = tenantSettingsDocumentSchema.safeParse(raw);
  // A document that no longer validates (e.g. schema evolved) degrades to defaults, loudly.
  return parsed.success ? parsed.data : { schemaVersion: SETTINGS_SCHEMA_VERSION, evaluation: {} };
}

/**
 * Configuration instead of code (principle 1). The effective configuration is computed from
 * three layers (platform default → plan limits → tenant override), validated by the shared Zod
 * schemas, and cached under (tenant, config_version, plan).
 */
@Injectable()
export class ConfigurationService {
  private readonly cache = new TtlCache<EffectiveConfig>(5 * 60_000, 10_000);

  constructor(
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  async version(): Promise<number> {
    const row = await this.db.client.tenantSettings.findUnique({
      where: { tenantId: TenantContext.requireTenantId() },
      select: { configVersion: true },
    });
    return row?.configVersion ?? 0;
  }

  async effective(plan: PlanCode): Promise<EffectiveConfig> {
    const tenantId = TenantContext.requireTenantId();
    const version = await this.version();
    return this.cache.getOrLoad(`${tenantId}:${version}:${plan}`, () => this.load(plan, version));
  }

  private async load(plan: PlanCode, configVersion: number): Promise<EffectiveConfig> {
    // Sequential on purpose: this runs inside the request's interactive transaction, which owns
    // a single connection; concurrent queries on it would only queue (and pg@9 rejects them).
    const tenantId = TenantContext.requireTenantId();
    const settings = await this.db.client.tenantSettings.findUnique({ where: { tenantId } });
    const branding = await this.db.client.tenantBranding.findUnique({ where: { tenantId } });
    const features = await this.db.client.tenantFeature.findMany({ where: { enabled: true } });
    const doc = parseDocument(settings?.settings);
    const allowed = new Set<FeatureKey>(PLANS[plan].features);
    return {
      configVersion,
      branding: branding
        ? {
            appName: branding.appName,
            logoUrl: branding.logoUrl,
            primaryColor: branding.primaryColor,
            secondaryColor: branding.secondaryColor,
            locale: branding.locale === 'fa' ? 'fa' : 'en',
          }
        : DEFAULT_BRANDING,
      // Effective = enabled by the tenant ∩ allowed by the plan (a downgrade switches features off).
      features: new Set(features.map((f) => f.featureKey).filter(isFeatureKey).filter((k) => allowed.has(k))),
      policy: resolveEvaluationPolicy(doc.evaluation, plan),
      override: doc.evaluation,
    };
  }

  /** The only tenant data visible before login (pre-auth branding of the login page). */
  async publicBranding(tenantName: string): Promise<PublicBranding> {
    const row = await this.db.client.tenantBranding.findUnique({ where: { tenantId: TenantContext.requireTenantId() } });
    const branding: Branding = row
      ? {
          appName: row.appName,
          logoUrl: row.logoUrl,
          primaryColor: row.primaryColor,
          secondaryColor: row.secondaryColor,
          locale: row.locale === 'fa' ? 'fa' : 'en',
        }
      : DEFAULT_BRANDING;
    return { ...branding, tenantName };
  }

  async updateBranding(input: unknown, plan: PlanCode): Promise<Branding> {
    const parsed = brandingSchema.safeParse(input);
    if (!parsed.success) throw new ValidationFailedError(zodIssues(parsed.error));
    const tenantId = TenantContext.requireTenantId();
    await this.db.transaction(async (tx) => {
      const before = await tx.tenantBranding.findUnique({ where: { tenantId } });
      await tx.tenantBranding.upsert({ where: { tenantId }, create: { tenantId, ...parsed.data }, update: parsed.data });
      await this.bump();
      const changed = (Object.keys(parsed.data) as (keyof Branding)[]).filter(
        (k) => !before || (before as Record<string, unknown>)[k] !== parsed.data[k],
      );
      await this.events.publish({
        type: 'config.branding.updated',
        category: 'CHANGE',
        entityType: 'tenant_branding',
        entityId: tenantId,
        metadata: { changed },
      });
    });
    return (await this.effective(plan)).branding;
  }

  async features(plan: PlanCode): Promise<FeatureState[]> {
    const enabled = await this.db.client.tenantFeature.findMany();
    const on = new Set(enabled.filter((f) => f.enabled).map((f) => f.featureKey));
    const allowed = new Set<string>(PLANS[plan].features);
    return ALL_FEATURES.map((key) => ({
      key,
      description: FEATURES[key],
      allowedByPlan: allowed.has(key),
      enabled: on.has(key) && allowed.has(key),
    }));
  }

  /** TA-05: toggle features within what the plan allows. */
  async setFeatures(changes: Record<string, boolean>, plan: PlanCode): Promise<FeatureState[]> {
    const tenantId = TenantContext.requireTenantId();
    const allowed = new Set<string>(PLANS[plan].features);
    const errors: { path: string; message: string }[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (!isFeatureKey(key)) errors.push({ path: key, message: 'Unknown feature' });
      else if (value && !allowed.has(key)) errors.push({ path: key, message: `Not included in the ${plan} plan` });
    }
    if (errors.length) throw new BusinessRuleError('FEATURE_NOT_ALLOWED', 'Some features cannot be changed', errors);

    await this.db.transaction(async (tx) => {
      for (const [featureKey, enabled] of Object.entries(changes)) {
        await tx.tenantFeature.upsert({
          where: { tenantId_featureKey: { tenantId, featureKey } },
          create: { tenantId, featureKey, enabled },
          update: { enabled },
        });
      }
      await this.bump();
      await this.events.publish({
        type: 'config.features.updated',
        category: 'CHANGE',
        entityType: 'tenant_feature',
        entityId: tenantId,
        metadata: { changes },
      });
    });
    return this.features(plan);
  }

  async policy(plan: PlanCode) {
    const effective = await this.effective(plan);
    return { override: effective.override, effective: effective.policy, planLimits: PLAN_POLICY_LIMITS[plan] };
  }

  /** TA-06: replace the tenant's policy override (validated, then checked against the plan). */
  async updatePolicy(input: unknown, plan: PlanCode) {
    const parsed = evaluationPolicyOverrideSchema.safeParse(input);
    if (!parsed.success) throw new ValidationFailedError(zodIssues(parsed.error));
    const override = parsed.data;
    if (override.scale && override.scale.min >= override.scale.max) {
      throw new ValidationFailedError([{ path: 'scale', message: 'min must be lower than max' }]);
    }
    const violations = checkOverrideAgainstPlan(override, plan);
    if (violations.length) throw new BusinessRuleError('PLAN_LIMIT', 'The plan does not allow this policy', violations);

    const tenantId = TenantContext.requireTenantId();
    await this.db.transaction(async (tx) => {
      const current = await tx.tenantSettings.findUnique({ where: { tenantId } });
      const before = parseDocument(current?.settings).evaluation;
      const doc: TenantSettingsDocument = { schemaVersion: SETTINGS_SCHEMA_VERSION, evaluation: override };
      await tx.tenantSettings.upsert({
        where: { tenantId },
        create: { tenantId, settings: doc as Prisma.InputJsonValue },
        update: { settings: doc as Prisma.InputJsonValue, configVersion: { increment: 1 } },
      });
      const changed = [...new Set([...Object.keys(before), ...Object.keys(override)])].filter(
        (k) => JSON.stringify(before[k as keyof EvaluationPolicyOverride]) !== JSON.stringify(override[k as keyof EvaluationPolicyOverride]),
      );
      await this.events.publish({
        type: 'config.policy.updated',
        category: 'CHANGE',
        entityType: 'tenant_settings',
        entityId: tenantId,
        metadata: { changed, after: override },
      });
    });
    return this.policy(plan);
  }

  /** Onboarding: writes the three configuration rows of a brand-new tenant (inside its transaction). */
  async provision(input: {
    plan: PlanCode;
    branding?: Branding;
    features?: string[];
    policy?: EvaluationPolicyOverride;
    tenantName: string;
  }): Promise<void> {
    const tenantId = TenantContext.requireTenantId();
    const allowed = new Set<string>(PLANS[input.plan].features);
    const requested = input.features ?? [...allowed];
    const invalid = requested.filter((f) => !isFeatureKey(f) || !allowed.has(f));
    if (invalid.length) {
      throw new BusinessRuleError(
        'FEATURE_NOT_ALLOWED',
        'Some features are not available on this plan',
        invalid.map((f) => ({ path: `features.${f}`, message: `Not included in the ${input.plan} plan` })),
      );
    }
    const policy = input.policy ?? {};
    const violations = checkOverrideAgainstPlan(policy, input.plan);
    if (violations.length) throw new BusinessRuleError('PLAN_LIMIT', 'The plan does not allow this policy', violations);

    const doc: TenantSettingsDocument = { schemaVersion: SETTINGS_SCHEMA_VERSION, evaluation: policy };
    await this.db.client.tenantSettings.create({ data: { tenantId, settings: doc as Prisma.InputJsonValue } });
    await this.db.client.tenantBranding.create({
      data: { tenantId, ...(input.branding ?? { ...DEFAULT_BRANDING, appName: input.tenantName.slice(0, 60) }) },
    });
    await this.db.client.tenantFeature.createMany({
      data: ALL_FEATURES.map((featureKey) => ({ tenantId, featureKey, enabled: requested.includes(featureKey) })),
    });
  }

  private async bump(): Promise<void> {
    const tenantId = TenantContext.requireTenantId();
    await this.db.client.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, configVersion: 2 },
      update: { configVersion: { increment: 1 } },
    });
  }
}
