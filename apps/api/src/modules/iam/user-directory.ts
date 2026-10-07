import { Injectable } from '@nestjs/common';
import { ConflictError, Database, TenantContext, hashPassword } from '../../core';
import { RolesService } from './roles.service';

export interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
}

/**
 * The read-only face of iam for other modules (organization, evaluation via organization).
 * Other modules never query `app_user` themselves (module-owns-its-tables rule).
 */
@Injectable()
export class UserDirectory {
  constructor(private readonly db: Database) {}

  async byIds(ids: string[]): Promise<Map<string, DirectoryUser>> {
    if (!ids.length) return new Map();
    const users = await this.db.client.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, fullName: true, email: true, active: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async exists(id: string): Promise<boolean> {
    return (await this.db.client.user.count({ where: { id } })) === 1;
  }

  /** Every user of the tenant ordered by name; the organisation screens show the whole roster. */
  async all(limit = 2000): Promise<DirectoryUser[]> {
    return this.db.client.user.findMany({
      select: { id: true, fullName: true, email: true, active: true },
      orderBy: { fullName: 'asc' },
      take: limit,
    });
  }
}

/** Used by platform onboarding inside the new tenant's context and transaction. */
@Injectable()
export class IamProvisioning {
  constructor(
    private readonly db: Database,
    private readonly roles: RolesService,
  ) {}

  async provision(admin: { email: string; fullName: string; password: string }): Promise<{ adminUserId: string; roleIds: Record<string, string> }> {
    const tenantId = TenantContext.requireTenantId();
    const roleIds = await this.roles.createSystemRoles();
    const clash = await this.db.client.user.count({ where: { email: admin.email } });
    if (clash) throw new ConflictError('EMAIL_TAKEN', 'Admin e-mail already exists in this tenant');
    const user = await this.db.client.user.create({
      data: {
        tenantId,
        email: admin.email,
        fullName: admin.fullName,
        passwordHash: await hashPassword(admin.password),
        roles: { create: [{ roleId: roleIds.TENANT_ADMIN }] },
      },
      select: { id: true },
    });
    return { adminUserId: user.id, roleIds };
  }

  /** Seed/demo helper: creates a user with the given system roles in the current tenant. */
  async createUser(input: { email: string; fullName: string; passwordHash: string; roleIds: string[] }): Promise<string> {
    const tenantId = TenantContext.requireTenantId();
    const user = await this.db.client.user.create({
      data: {
        tenantId,
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    return user.id;
  }
}
