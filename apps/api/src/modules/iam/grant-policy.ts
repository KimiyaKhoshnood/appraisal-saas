import { Injectable } from '@nestjs/common';
import { isPermission, type Permission } from '@appraisal/contracts';
import { BusinessRuleError, Database, ForbiddenError, TenantContext } from '../../core';

/**
 * Privilege ceiling for every iam write (found by review: without it, `user:write` could mint a
 * tenant admin and `role:write` was equivalent to every permission).
 *
 *  - you can only grant permissions you hold yourself (directly or through a role you assign);
 *  - you can only manage (re-role, deactivate) users whose permissions are a subset of yours;
 *  - the tenant always keeps at least one active Tenant admin, checked under a row lock so that
 *    two admins demoting each other concurrently cannot both succeed.
 *
 * All methods run inside the caller's transaction (`db.client` is the ambient transaction).
 */
@Injectable()
export class GrantPolicy {
  constructor(private readonly db: Database) {}

  private actorPermissions(): ReadonlySet<Permission> {
    return TenantContext.requireAccess().permissions;
  }

  assertCanGrantPermissions(permissions: readonly string[]): void {
    const mine = this.actorPermissions();
    const beyond = permissions.filter((p) => !isPermission(p) || !mine.has(p));
    if (beyond.length) {
      throw new ForbiddenError('GRANT_EXCEEDS_OWN', `You cannot grant permissions you do not hold: ${beyond.join(', ')}`);
    }
  }

  async assertCanGrantRoles(roleIds: string[]): Promise<void> {
    const rows = await this.db.client.rolePermission.findMany({ where: { roleId: { in: roleIds } }, select: { permissionKey: true } });
    this.assertCanGrantPermissions([...new Set(rows.map((r) => r.permissionKey))]);
  }

  async assertCanManageUser(userId: string): Promise<void> {
    const rows = await this.db.client.rolePermission.findMany({
      where: { role: { users: { some: { userId } } } },
      select: { permissionKey: true },
    });
    const mine = this.actorPermissions();
    const beyond = [...new Set(rows.map((r) => r.permissionKey))].filter((p) => !isPermission(p) || !mine.has(p));
    if (beyond.length) {
      throw new ForbiddenError('TARGET_MORE_PRIVILEGED', 'You cannot manage a user who holds permissions you do not have');
    }
  }

  /** Serialises every change that could remove the last Tenant admin. */
  async lockAdminRole(): Promise<void> {
    await this.db.client.$queryRaw`SELECT id FROM role WHERE system_key = 'TENANT_ADMIN' FOR UPDATE`;
  }

  async assertAdminRemains(): Promise<void> {
    const admins = await this.db.client.user.count({
      where: { active: true, roles: { some: { role: { systemKey: 'TENANT_ADMIN' } } } },
    });
    if (admins === 0) {
      throw new BusinessRuleError('LAST_ADMIN', 'The organisation must keep at least one active Tenant admin');
    }
  }
}
