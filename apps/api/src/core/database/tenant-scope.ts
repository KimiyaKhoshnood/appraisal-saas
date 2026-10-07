/**
 * Layer 2 of tenant isolation: automatic tenant predicates on every Prisma operation against a
 * tenant-scoped model. Pure functions so they can be unit-tested without a database.
 */

/** Models that carry tenant_id and are protected by RLS. Mirrors migration 20261007000100. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'TenantSettings',
  'TenantAuthzState',
  'TenantFeature',
  'TenantBranding',
  'User',
  'Role',
  'RolePermission',
  'UserRole',
  'RefreshToken',
  'Department',
  'EmployeeProfile',
  'EvaluationCycle',
  'Competency',
  'Evaluation',
  'EvaluationScore',
  'ApprovalRecord',
  'AuditLog',
]);

export class CrossTenantWriteError extends Error {
  constructor(model: string) {
    super(`Refusing to write ${model} for a tenant other than the one in context`);
    this.name = 'CrossTenantWriteError';
  }
}

type Args = Record<string, unknown> | undefined;

function withTenantWhere(where: unknown, tenantId: string): Record<string, unknown> {
  if (!where || typeof where !== 'object') return { tenantId };
  // AND keeps any caller predicate intact and makes a conflicting tenantId match nothing.
  return { AND: [where, { tenantId }] };
}

/** Unique-where inputs cannot be wrapped in AND; extra non-unique fields are allowed (Prisma ≥5). */
function withTenantUniqueWhere(where: unknown, tenantId: string, model: string): Record<string, unknown> {
  const w = { ...((where as Record<string, unknown>) ?? {}) };
  if (w.tenantId !== undefined && w.tenantId !== tenantId) throw new CrossTenantWriteError(model);
  w.tenantId = tenantId;
  return w;
}

function stampData(data: unknown, tenantId: string, model: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampData(d, tenantId, model));
  if (!data || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  if (d.tenantId !== undefined && d.tenantId !== tenantId) throw new CrossTenantWriteError(model);
  return { ...d, tenantId };
}

export function scopeArgs(model: string, operation: string, args: Args, tenantId: string): Args {
  const a: Record<string, unknown> = { ...(args ?? {}) };
  switch (operation) {
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'update':
    case 'delete':
      a.where = withTenantUniqueWhere(a.where, tenantId, model);
      break;
    case 'upsert':
      a.where = withTenantUniqueWhere(a.where, tenantId, model);
      a.create = stampData(a.create, tenantId, model);
      if (a.update && typeof a.update === 'object' && 'tenantId' in (a.update as object)) {
        throw new CrossTenantWriteError(model);
      }
      break;
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findMany':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'deleteMany':
      a.where = withTenantWhere(a.where, tenantId);
      break;
    case 'updateMany':
    case 'updateManyAndReturn':
      a.where = withTenantWhere(a.where, tenantId);
      if (a.data && typeof a.data === 'object' && 'tenantId' in (a.data as object)) {
        throw new CrossTenantWriteError(model);
      }
      break;
    case 'create':
    case 'createMany':
    case 'createManyAndReturn':
      a.data = stampData(a.data, tenantId, model);
      break;
    default:
      // Unknown operation: fail closed rather than run it unscoped.
      throw new Error(`Tenant scoping does not support ${model}.${operation}`);
  }
  return a;
}
