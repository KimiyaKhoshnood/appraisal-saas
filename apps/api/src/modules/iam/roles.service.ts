import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  SYSTEM_ROLE_TEMPLATES,
  isPermission,
  type CreateRoleInput,
  type Permission,
  type RoleView,
  type SystemRoleKey,
} from '@appraisal/contracts';
import { BusinessRuleError, ConflictError, Database, EventBus, NotFoundError, TenantContext, ValidationFailedError } from '../../core';
import { AuthzService } from './authz.service';
import { GrantPolicy } from './grant-policy';

function validatePermissions(keys: string[]): Permission[] {
  const invalid = keys.filter((k) => !isPermission(k));
  if (invalid.length) {
    throw new ValidationFailedError(invalid.map((k) => ({ path: 'permissions', message: `Unknown permission: ${k}` })));
  }
  return [...new Set(keys)] as Permission[];
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly events: EventBus,
    private readonly grants: GrantPolicy,
  ) {}

  catalog(): { key: Permission; description: string }[] {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({ key: key as Permission, description }));
  }

  async list(): Promise<RoleView[]> {
    const roles = await this.db.client.role.findMany({
      orderBy: [{ systemKey: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      include: { permissions: { select: { permissionKey: true } }, _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      systemKey: r.systemKey,
      permissions: r.permissions.map((p) => p.permissionKey).filter(isPermission),
      userCount: r._count.users,
    }));
  }

  /** TA-08: custom role = new row + permission keys. No code path changes (roles are data). */
  async create(input: CreateRoleInput): Promise<RoleView> {
    const tenantId = TenantContext.requireTenantId();
    const permissions = validatePermissions(input.permissions);
    this.grants.assertCanGrantPermissions(permissions);
    return this.db.transaction(async (tx) => {
      const clash = await tx.role.findFirst({ where: { name: input.name }, select: { id: true } });
      if (clash) throw new ConflictError('ROLE_NAME_TAKEN', 'A role with this name already exists');
      const role = await tx.role.create({
        data: {
          tenantId,
          name: input.name,
          permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await this.authz.bump();
      await this.events.publish({
        type: 'iam.role.created',
        category: 'CHANGE',
        entityType: 'role',
        entityId: role.id,
        metadata: { permissions },
      });
      return { id: role.id, name: role.name, systemKey: null, permissions, userCount: 0 };
    });
  }

  async update(id: string, input: Partial<CreateRoleInput>): Promise<RoleView> {
    const tenantId = TenantContext.requireTenantId();
    return this.db.transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw new NotFoundError('role', id);
      if (role.systemKey) throw new BusinessRuleError('SYSTEM_ROLE_READONLY', 'System roles cannot be modified');
      if (input.name) await tx.role.update({ where: { id }, data: { name: input.name } });
      if (input.permissions) {
        const permissions = validatePermissions(input.permissions);
        this.grants.assertCanGrantPermissions(permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: permissions.map((permissionKey) => ({ tenantId, roleId: id, permissionKey })) });
      }
      await this.authz.bump();
      await this.events.publish({
        type: 'iam.role.updated',
        category: 'CHANGE',
        entityType: 'role',
        entityId: id,
        metadata: { fields: Object.keys(input), ...(input.permissions ? { permissions: input.permissions } : {}) },
      });
      const views = await this.list();
      return views.find((v) => v.id === id)!;
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
      if (!role) throw new NotFoundError('role', id);
      if (role.systemKey) throw new BusinessRuleError('SYSTEM_ROLE_READONLY', 'System roles cannot be deleted');
      if (role._count.users > 0) throw new BusinessRuleError('ROLE_IN_USE', 'Unassign the role from all users first');
      await tx.role.delete({ where: { id } });
      await this.authz.bump();
      await this.events.publish({ type: 'iam.role.deleted', category: 'CHANGE', entityType: 'role', entityId: id });
    });
  }

  /** Used by onboarding: copies the system templates into the new tenant (inside its transaction). */
  async createSystemRoles(): Promise<Record<SystemRoleKey, string>> {
    const tenantId = TenantContext.requireTenantId();
    const ids = {} as Record<SystemRoleKey, string>;
    for (const [key, template] of Object.entries(SYSTEM_ROLE_TEMPLATES) as [SystemRoleKey, (typeof SYSTEM_ROLE_TEMPLATES)[SystemRoleKey]][]) {
      const role = await this.db.client.role.create({
        data: {
          tenantId,
          name: template.name,
          systemKey: key,
          permissions: { create: template.permissions.map((permissionKey) => ({ permissionKey })) },
        },
        select: { id: true },
      });
      ids[key] = role.id;
    }
    await this.db.client.tenantAuthzState.create({ data: { tenantId, version: 1 } });
    return ids;
  }
}
