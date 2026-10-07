/**
 * Permissions are code; roles are data (ADR-007).
 *
 * The catalog below is the only place a permission can be defined. It is seeded into the
 * read-only `permission` table so roles stored per tenant can reference it with a foreign key.
 */
export const PERMISSIONS = {
  'user:read': 'View users of the organisation',
  'user:write': 'Invite, edit and deactivate users',
  'role:read': 'View roles and their permissions',
  'role:write': 'Create/edit roles and assign them to users',
  'org:read': 'View departments and reporting lines',
  'org:write': 'Edit departments and reporting lines',
  'config:read': 'View branding, features and evaluation policy',
  'config:write': 'Change branding, features and evaluation policy',
  'audit:read': 'Search the audit log',
  'cycle:read': 'View evaluation cycles',
  'cycle:write': 'Create, activate and close cycles; manage competencies',
  'evaluation:self': 'Fill in and submit own self-assessment',
  'evaluation:manage': 'Evaluate direct reports',
  'evaluation:approve': 'Approve or reject submitted evaluations',
  'evaluation:read-all': 'Read every evaluation in the organisation',
  'report:read': 'Read summary reports',
  'analytics:read': 'Read advanced analytics',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

/** System role templates copied into every tenant on creation (rows, not code paths). */
export const SYSTEM_ROLE_TEMPLATES = {
  TENANT_ADMIN: {
    name: 'Tenant admin',
    permissions: ALL_PERMISSIONS,
  },
  MANAGER: {
    name: 'Manager',
    permissions: [
      'user:read',
      'org:read',
      'cycle:read',
      'evaluation:self',
      'evaluation:manage',
      'report:read',
    ],
  },
  EMPLOYEE: {
    name: 'Employee',
    permissions: ['cycle:read', 'evaluation:self'],
  },
} as const satisfies Record<string, { name: string; permissions: readonly Permission[] }>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLE_TEMPLATES;
