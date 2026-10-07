import { Injectable } from '@nestjs/common';
import type { DepartmentView, EmployeeView, UpdateEmployeeProfileInput } from '@appraisal/contracts';
import { BusinessRuleError, ConflictError, Database, EventBus, NotFoundError, TenantContext } from '../../core';
import { UserDirectory } from '../iam';

const MAX_CHAIN = 64;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly events: EventBus,
  ) {}

  async departments(): Promise<DepartmentView[]> {
    const rows = await this.db.client.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
    return rows.map((d) => ({ id: d.id, name: d.name, employeeCount: d._count.employees }));
  }

  async createDepartment(name: string): Promise<DepartmentView> {
    const tenantId = TenantContext.requireTenantId();
    return this.db.transaction(async (tx) => {
      if (await tx.department.count({ where: { name } })) throw new ConflictError('DEPARTMENT_EXISTS', 'Department already exists');
      const d = await tx.department.create({ data: { tenantId, name } });
      await this.events.publish({ type: 'org.department.created', category: 'CHANGE', entityType: 'department', entityId: d.id });
      return { id: d.id, name: d.name, employeeCount: 0 };
    });
  }

  async renameDepartment(id: string, name: string): Promise<DepartmentView> {
    return this.db.transaction(async (tx) => {
      const d = await tx.department.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
      if (!d) throw new NotFoundError('department', id);
      await tx.department.update({ where: { id }, data: { name } });
      await this.events.publish({ type: 'org.department.renamed', category: 'CHANGE', entityType: 'department', entityId: id });
      return { id, name, employeeCount: d._count.employees };
    });
  }

  async deleteDepartment(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const d = await tx.department.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
      if (!d) throw new NotFoundError('department', id);
      if (d._count.employees) throw new BusinessRuleError('DEPARTMENT_NOT_EMPTY', 'Move the employees out of the department first');
      await tx.department.delete({ where: { id } });
      await this.events.publish({ type: 'org.department.deleted', category: 'CHANGE', entityType: 'department', entityId: id });
    });
  }

  async employees(): Promise<EmployeeView[]> {
    const users = await this.users.all();
    const profiles = await this.db.client.employeeProfile.findMany();
    const departments = await this.db.client.department.findMany({ select: { id: true, name: true } });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    return users
      .filter((u) => u.active)
      .map((u) => {
        const p = byUser.get(u.id);
        return {
          userId: u.id,
          fullName: u.fullName,
          email: u.email,
          jobTitle: p?.jobTitle ?? null,
          department: p?.departmentId ? { id: p.departmentId, name: deptName.get(p.departmentId) ?? '' } : null,
          manager: p?.managerId ? { id: p.managerId, fullName: userName.get(p.managerId) ?? '' } : null,
        };
      });
  }

  /** TA-03: department and direct manager. Refuses reporting loops (A → B → A). */
  async updateProfile(userId: string, input: UpdateEmployeeProfileInput): Promise<EmployeeView> {
    const tenantId = TenantContext.requireTenantId();
    await this.db.transaction(async (tx) => {
      if (!(await this.users.exists(userId))) throw new NotFoundError('user', userId);
      if (input.managerId) {
        if (input.managerId === userId) throw new BusinessRuleError('SELF_MANAGER', 'An employee cannot manage themselves');
        if (!(await this.users.exists(input.managerId))) throw new NotFoundError('user', input.managerId);
        await this.assertNoCycle(userId, input.managerId);
      }
      if (input.departmentId && !(await tx.department.count({ where: { id: input.departmentId } }))) {
        throw new NotFoundError('department', input.departmentId);
      }
      const data = {
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      };
      await tx.employeeProfile.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { tenantId, userId, ...data },
        update: data,
      });
      await this.events.publish({
        type: 'org.profile.updated',
        category: 'CHANGE',
        entityType: 'user',
        entityId: userId,
        metadata: { ...data },
      });
    });
    const view = (await this.employees()).find((e) => e.userId === userId);
    if (!view) throw new NotFoundError('user', userId);
    return view;
  }

  private async assertNoCycle(userId: string, newManagerId: string): Promise<void> {
    let current: string | null = newManagerId;
    for (let i = 0; current && i < MAX_CHAIN; i++) {
      if (current === userId) throw new BusinessRuleError('REPORTING_CYCLE', 'This change would create a reporting loop');
      const p: { managerId: string | null } | null = await this.db.client.employeeProfile.findFirst({
        where: { userId: current },
        select: { managerId: true },
      });
      current = p?.managerId ?? null;
    }
  }
}
