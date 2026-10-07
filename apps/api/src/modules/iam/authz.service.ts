import { Injectable } from '@nestjs/common';
import { isPermission, type Permission } from '@appraisal/contracts';
import { Database, TenantContext, TtlCache } from '../../core';

export interface UserAccess {
  user: { id: string; email: string; fullName: string };
  permissions: ReadonlySet<Permission>;
}

/**
 * Roles are rows, permissions are code (ADR-007). Effective permissions are cached per
 * (tenant, user, authz version). The version is read on every request (one PK lookup), so a role
 * change or deactivation is visible on the next request on every replica, with no invalidation
 * bus and no stale roles inside long-lived JWTs.
 */
@Injectable()
export class AuthzService {
  private readonly cache = new TtlCache<UserAccess | null>(60_000, 20_000);

  constructor(private readonly db: Database) {}

  async version(): Promise<number> {
    const row = await this.db.client.tenantAuthzState.findUnique({ where: { tenantId: TenantContext.requireTenantId() } });
    return row?.version ?? 0;
  }

  /** Called by every iam write that can change what someone may do, inside its transaction. */
  async bump(): Promise<void> {
    const tenantId = TenantContext.requireTenantId();
    await this.db.client.tenantAuthzState.upsert({
      where: { tenantId },
      create: { tenantId, version: 2 },
      update: { version: { increment: 1 } },
    });
  }

  async userAccess(userId: string): Promise<UserAccess | null> {
    const tenantId = TenantContext.requireTenantId();
    const version = await this.version();
    return this.cache.getOrLoad(`${tenantId}:${userId}:${version}`, () => this.load(userId));
  }

  private async load(userId: string): Promise<UserAccess | null> {
    const user = await this.db.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        active: true,
        roles: { select: { role: { select: { permissions: { select: { permissionKey: true } } } } } },
      },
    });
    if (!user || !user.active) return null;
    const permissions = new Set<Permission>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) if (isPermission(rp.permissionKey)) permissions.add(rp.permissionKey);
    }
    return { user: { id: user.id, email: user.email, fullName: user.fullName }, permissions };
  }
}
