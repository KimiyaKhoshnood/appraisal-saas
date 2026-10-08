/**
 * Query-key factory: one place that knows the shape of every cached query, so invalidation
 * after a mutation is explicit and typo-proof ("invalidate everything about evaluations").
 */
export const qk = {
  me: ['me'] as const,
  evaluations: {
    all: ['evaluations'] as const,
    list: (scope: string) => ['evaluations', 'list', scope] as const,
    detail: (id: string) => ['evaluations', 'detail', id] as const,
  },
  team: ['team'] as const,
  cycles: ['cycles'] as const,
  users: (search: string) => ['users', search] as const,
  usersAll: ['users'] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  departments: ['departments'] as const,
  employees: ['employees'] as const,
  features: ['features'] as const,
  policy: ['policy'] as const,
  audit: (filters: Record<string, string>) => ['audit', filters] as const,
  reports: ['reports'] as const,
  analytics: ['analytics'] as const,
  platform: {
    tenants: ['platform', 'tenants'] as const,
    audit: ['platform', 'audit'] as const,
  },
};
