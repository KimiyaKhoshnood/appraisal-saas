import { Injectable, Logger } from '@nestjs/common';
import type { CreateUserInput, Page, PageQuery, UserView } from '@appraisal/contracts';
import {
  BusinessRuleError,
  ConflictError,
  Database,
  EventBus,
  NotFoundError,
  TenantContext,
  hashPassword,
  keysetArgs,
  toPage,
} from '../../core';
import { AuthzService } from './authz.service';

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  active: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const;

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  createdAt: Date;
  roles: { role: { id: string; name: string } }[];
};

function toView(u: UserRow): UserView {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    active: u.active,
    roles: u.roles.map((r) => r.role),
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger('Mailer');

  constructor(
    private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly events: EventBus,
  ) {}

  async list(q: PageQuery & { search?: string }): Promise<Page<UserView>> {
    const rows = await this.db.client.user.findMany({
      where: q.search
        ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }
        : {},
      select: userSelect,
      ...keysetArgs(q.limit, q.cursor, 'asc'),
    });
    return toPage(rows, q.limit, toView);
  }

  async get(id: string): Promise<UserView> {
    const user = await this.db.client.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw new NotFoundError('user', id);
    return toView(user);
  }

  /** TA-01. The "invitation" is a mock mailer that logs; real e-mail is out of scope. */
  async create(input: CreateUserInput): Promise<UserView> {
    const tenantId = TenantContext.requireTenantId();
    const passwordHash = await hashPassword(input.password);
    const user = await this.db.transaction(async (tx) => {
      const exists = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: input.email } }, select: { id: true } });
      if (exists) throw new ConflictError('EMAIL_TAKEN', 'A user with this e-mail already exists in the organisation');
      const roleIds = input.roleIds.length ? input.roleIds : await this.defaultRoleIds();
      await this.assertRolesExist(roleIds);
      const created = await tx.user.create({
        data: {
          tenantId,
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
        },
        select: userSelect,
      });
      await this.authz.bump();
      await this.events.publish({
        type: 'iam.user.created',
        category: 'CHANGE',
        entityType: 'user',
        entityId: created.id,
        metadata: { roleIds },
      });
      return created;
    });
    this.logger.log({ to: user.id }, 'invitation e-mail queued (mock mailer)');
    return toView(user);
  }

  async update(id: string, input: { fullName?: string }): Promise<UserView> {
    return this.db.transaction(async (tx) => {
      await this.requireUser(id);
      const user = await tx.user.update({ where: { id }, data: input, select: userSelect });
      await this.events.publish({
        type: 'iam.user.updated',
        category: 'CHANGE',
        entityType: 'user',
        entityId: id,
        metadata: { fields: Object.keys(input) },
      });
      return toView(user);
    });
  }

  async setActive(id: string, active: boolean): Promise<UserView> {
    const actorId = TenantContext.actor().id;
    if (!active && actorId === id) throw new BusinessRuleError('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate yourself');
    return this.db.transaction(async (tx) => {
      await this.requireUser(id);
      const user = await tx.user.update({ where: { id }, data: { active }, select: userSelect });
      if (!active) {
        // Kill every session of the user immediately; access tokens die with the authz bump.
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.authz.bump();
      await this.events.publish({
        type: active ? 'iam.user.activated' : 'iam.user.deactivated',
        category: 'CHANGE',
        entityType: 'user',
        entityId: id,
      });
      return toView(user);
    });
  }

  /** TA-02. Changing roles is audited and takes effect on the user's next request. */
  async setRoles(id: string, roleIds: string[]): Promise<UserView> {
    const tenantId = TenantContext.requireTenantId();
    return this.db.transaction(async (tx) => {
      await this.requireUser(id);
      await this.assertRolesExist(roleIds);
      if (TenantContext.actor().id === id) await this.assertKeepsAdmin(roleIds);
      const before = await tx.userRole.findMany({ where: { userId: id }, select: { roleId: true } });
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ tenantId, userId: id, roleId })) });
      await this.authz.bump();
      await this.events.publish({
        type: 'iam.user.roles_changed',
        category: 'CHANGE',
        entityType: 'user',
        entityId: id,
        metadata: { before: before.map((r) => r.roleId), after: roleIds },
      });
      return this.get(id);
    });
  }

  private async requireUser(id: string) {
    const user = await this.db.client.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError('user', id);
  }

  private async assertRolesExist(roleIds: string[]) {
    const unique = [...new Set(roleIds)];
    const found = await this.db.client.role.count({ where: { id: { in: unique } } });
    // A role id from another tenant is invisible under RLS → counted as missing → 404.
    if (found !== unique.length) throw new NotFoundError('role');
  }

  /** Stops an admin from locking the organisation out by removing their own admin role. */
  private async assertKeepsAdmin(roleIds: string[]) {
    const keepsAdmin = await this.db.client.role.count({ where: { id: { in: roleIds }, systemKey: 'TENANT_ADMIN' } });
    if (!keepsAdmin) {
      throw new BusinessRuleError('CANNOT_REMOVE_OWN_ADMIN', 'You cannot remove the Tenant admin role from yourself');
    }
  }

  private async defaultRoleIds(): Promise<string[]> {
    const role = await this.db.client.role.findFirst({ where: { systemKey: 'EMPLOYEE' }, select: { id: true } });
    return role ? [role.id] : [];
  }
}
