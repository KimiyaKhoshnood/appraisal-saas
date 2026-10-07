import { Injectable } from '@nestjs/common';
import { Database } from '../../core';
import { Prisma } from '../../generated/prisma/client';
import { UserDirectory } from '../iam';

/**
 * Public, read-only API of organization for the evaluation module: who reports to whom, and
 * display names. The manager *scope* rule (MVP: direct reports only) is answered here.
 */
@Injectable()
export class OrgDirectory {
  constructor(
    private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  async managerOf(userId: string): Promise<string | null> {
    const p = await this.db.client.employeeProfile.findFirst({ where: { userId }, select: { managerId: true } });
    return p?.managerId ?? null;
  }

  async directReportIds(managerId: string): Promise<string[]> {
    const rows = await this.db.client.employeeProfile.findMany({ where: { managerId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async hasReports(userId: string): Promise<boolean> {
    return (await this.db.client.employeeProfile.count({ where: { managerId: userId } })) > 0;
  }

  /**
   * Optional extension (scope = whole subtree): one recursive CTE instead of N queries. Runs in a
   * tenant transaction, so RLS applies to every level of the recursion.
   */
  async subtreeIds(managerId: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ user_id: string }[]>(Prisma.sql`
        WITH RECURSIVE tree AS (
          SELECT user_id, 1 AS depth FROM employee_profile WHERE manager_id = ${managerId}::uuid
          UNION ALL
          SELECT e.user_id, t.depth + 1 FROM employee_profile e JOIN tree t ON e.manager_id = t.user_id
          WHERE t.depth < 64
        )
        SELECT DISTINCT user_id FROM tree`);
      return rows.map((r) => r.user_id);
    });
  }

  /** Active employees with their current manager: the roster a cycle is activated for. */
  async activeRoster(): Promise<{ userId: string; managerId: string | null }[]> {
    const users = await this.users.all();
    const profiles = await this.db.client.employeeProfile.findMany({ select: { userId: true, managerId: true } });
    const managerOf = new Map(profiles.map((p) => [p.userId, p.managerId]));
    return users.filter((u) => u.active).map((u) => ({ userId: u.id, managerId: managerOf.get(u.id) ?? null }));
  }

  async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const users = await this.users.byIds(ids.filter((x): x is string => Boolean(x)));
    return new Map([...users.values()].map((u) => [u.id, u.fullName]));
  }
}
