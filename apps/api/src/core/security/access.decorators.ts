import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { FeatureKey, Permission } from '@appraisal/contracts';

/**
 * Every route declares exactly one access policy; the app refuses to boot if one is missing
 * (RouteRegistry.verify). Secure by default: forgetting a decorator is a startup error, not an
 * open endpoint.
 */
export type AccessPolicy =
  | { kind: 'public'; tenant: 'none' | 'host' }
  | { kind: 'platform' }
  | { kind: 'tenant'; permissions: Permission[] };

export const ACCESS_KEY = 'appraisal:access';
export const FEATURE_KEY = 'appraisal:feature';
export const RATE_LIMIT_KEY = 'appraisal:rate-limit';

/** No token. With `tenant: 'host'` the tenant is taken from the sub-domain (login, branding). */
export const Public = (options: { tenant?: 'none' | 'host' } = {}) =>
  SetMetadata(ACCESS_KEY, { kind: 'public', tenant: options.tenant ?? 'none' } satisfies AccessPolicy);

/** Platform-admin token (separate key and audience); never accepts a tenant token. */
export const PlatformRoute = () => SetMetadata(ACCESS_KEY, { kind: 'platform' } satisfies AccessPolicy);

/** Tenant token + every listed permission (RBAC). Scope checks remain the service's job. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(ACCESS_KEY, { kind: 'tenant', permissions } satisfies AccessPolicy);

/**
 * Any authenticated user of the tenant. Used where the decision depends on the record (e.g. "is
 * this my evaluation?"), which only the domain service can answer.
 */
export const Authenticated = () => SetMetadata(ACCESS_KEY, { kind: 'tenant', permissions: [] } satisfies AccessPolicy);

/** Hides the route entirely (404) when the feature is off for the tenant. */
export const RequireFeature = (feature: FeatureKey) => applyDecorators(SetMetadata(FEATURE_KEY, feature));

export const SkipRateLimit = () => SetMetadata(RATE_LIMIT_KEY, false);
