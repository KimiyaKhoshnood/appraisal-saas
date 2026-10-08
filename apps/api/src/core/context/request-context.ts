import { AsyncLocalStorage } from 'node:async_hooks';
import type { FeatureKey, Permission, EvaluationPolicy, PlanCode } from '@appraisal/contracts';

export type ActorType = 'USER' | 'PLATFORM_ADMIN' | 'SYSTEM' | 'ANONYMOUS';

export interface Actor {
  type: ActorType;
  id: string | null;
  name: string | null;
}

/** What the tenant guard resolved for an authenticated tenant user. Read-only for the request. */
export interface AccessContext {
  tenant: { id: string; slug: string; name: string; plan: PlanCode };
  user: { id: string; email: string; fullName: string };
  permissions: ReadonlySet<Permission>;
  features: ReadonlySet<FeatureKey>;
  policy: EvaluationPolicy;
}

/**
 * Per-request state carried by AsyncLocalStorage (ADR-004).
 *
 * `tenantId` is the only input to the database tenant setting. It is written by exactly two
 * places: the tenant guard (from a verified JWT, cross-checked with the sub-domain) and
 * `TenantContext.runAs` (platform onboarding/seed, ADR-012). Never from a body, query or header.
 */
export interface RequestStore {
  requestId: string;
  ip: string | null;
  tenantId: string | null;
  actor: Actor;
  access: AccessContext | null;
  /** Interactive transaction client when inside `Database.transaction`. */
  tx: unknown;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const TenantContext = {
  storage,

  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  current(): RequestStore | undefined {
    return storage.getStore();
  },

  tenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  },

  /** Throws when there is no tenant: the application layer of fail-closed isolation. */
  requireTenantId(): string {
    const id = storage.getStore()?.tenantId;
    if (!id) throw new MissingTenantContextError();
    return id;
  },

  requireAccess(): AccessContext {
    const access = storage.getStore()?.access;
    if (!access) throw new MissingTenantContextError('No authenticated tenant user in context');
    return access;
  },

  actor(): Actor {
    return storage.getStore()?.actor ?? { type: 'SYSTEM', id: null, name: null };
  },

  /** Runs `fn` in platform scope (no tenant): scripts and the seed acting as a platform admin. */
  runPlatform<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
    // `await` inside the scope: a lazy (Prisma) promise must start while the context is active.
    return storage.run({ requestId: 'system', ip: null, tenantId: null, actor, access: null, tx: undefined }, async () => await fn());
  },

  /**
   * Runs `fn` inside a child context bound to `tenantId`. Used by platform onboarding, the
   * seed and background tasks: the platform enters a tenant instead of bypassing RLS (ADR-012).
   */
  runAs<T>(tenantId: string, actor: Actor, fn: () => Promise<T>): Promise<T> {
    const parent = storage.getStore();
    const child: RequestStore = {
      requestId: parent?.requestId ?? 'system',
      ip: parent?.ip ?? null,
      tenantId,
      actor,
      access: null,
      tx: undefined,
    };
    return storage.run(child, async () => await fn());
  },
};

export class MissingTenantContextError extends Error {
  constructor(message = 'Tenant context is required but missing') {
    super(message);
    this.name = 'MissingTenantContextError';
  }
}
