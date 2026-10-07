import type { PlanCode, TenantStatus } from '@appraisal/contracts';
import type { AccessContext } from './context/request-context';

/**
 * Ports: tenancy-core declares what it needs, domain modules provide it, the composition root
 * (src/app) wires them. This keeps core free of imports from any module (NF-12, ADR-001).
 */

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  plan: PlanCode;
  status: TenantStatus;
}

/** Implemented by the platform module (owner of the `tenant` table). */
export interface TenantLookup {
  bySlug(slug: string): Promise<TenantRecord | null>;
  byId(id: string): Promise<TenantRecord | null>;
}
export const TENANT_LOOKUP = Symbol('TENANT_LOOKUP');

/** Implemented in the composition root from iam (user, permissions) + configuration (features, policy). */
export interface AccessContextLoader {
  /** Runs inside the tenant context; returns null when the user is unknown or inactive. */
  load(tenant: TenantRecord, userId: string): Promise<AccessContext | null>;
}
export const ACCESS_CONTEXT_LOADER = Symbol('ACCESS_CONTEXT_LOADER');

/** Implemented by the platform module. */
export interface PlatformAdminLookup {
  activeAdmin(id: string): Promise<{ id: string; fullName: string } | null>;
}
export const PLATFORM_ADMIN_LOOKUP = Symbol('PLATFORM_ADMIN_LOOKUP');
