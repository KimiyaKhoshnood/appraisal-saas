import { Injectable } from '@nestjs/common';
import type { EvaluationStatus } from '@appraisal/contracts';
import { Database } from '../../core';
import { Prisma } from '../../generated/prisma/client';
import { OrgDirectory } from '../organization';

export interface CycleStats {
  cycle: { id: string; name: string; status: string } | null;
  byStatus: Record<EvaluationStatus, number>;
  published: number;
  averageFinalScore: number | null;
  minFinalScore: number | null;
  maxFinalScore: number | null;
  competencies: { id: string; name: string; weight: number; averageManagerScore: number | null }[];
}

const EMPTY_STATUS: Record<EvaluationStatus, number> = {
  DRAFT: 0,
  SELF_SUBMITTED: 0,
  MANAGER_SUBMITTED: 0,
  PENDING_APPROVAL: 0,
  PUBLISHED: 0,
};

/**
 * Read-only queries over evaluation data for dashboards and the reporting module. Aggregates
 * are computed in PostgreSQL inside the tenant transaction (RLS still applies to raw SQL there).
 */
@Injectable()
export class EvaluationReadModel {
  constructor(
    private readonly db: Database,
    private readonly org: OrgDirectory,
  ) {}

  async latestCycleId(): Promise<string | null> {
    const active = await this.db.client.evaluationCycle.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
    if (active) return active.id;
    const last = await this.db.client.evaluationCycle.findFirst({ orderBy: { startsOn: 'desc' }, select: { id: true } });
    return last?.id ?? null;
  }

  /** `managerId` restricts the statistics to one manager's team (manager scope). */
  async cycleStats(cycleId: string | null, managerId?: string): Promise<CycleStats> {
    const id = cycleId ?? (await this.latestCycleId());
    if (!id) return { cycle: null, byStatus: { ...EMPTY_STATUS }, published: 0, averageFinalScore: null, minFinalScore: null, maxFinalScore: null, competencies: [] };
    const cycle = await this.db.client.evaluationCycle.findUnique({ where: { id }, include: { competencies: true } });
    if (!cycle) return { cycle: null, byStatus: { ...EMPTY_STATUS }, published: 0, averageFinalScore: null, minFinalScore: null, maxFinalScore: null, competencies: [] };

    const scope: Prisma.EvaluationWhereInput = { cycleId: id, ...(managerId ? { managerId } : {}) };
    const groups = await this.db.client.evaluation.groupBy({ by: ['status'], where: scope, _count: { _all: true } });
    const agg = await this.db.client.evaluation.aggregate({
        where: { ...scope, status: 'PUBLISHED' },
        _avg: { finalScore: true },
        _min: { finalScore: true },
        _max: { finalScore: true },
        _count: { _all: true },
    });
    const perCompetency = await this.db.transaction((tx) =>
      tx.$queryRaw<{ competency_id: string; avg: number | null }[]>(Prisma.sql`
        SELECT s.competency_id, AVG(s.score)::float8 AS avg
          FROM evaluation_score s
          JOIN evaluation e ON e.tenant_id = s.tenant_id AND e.id = s.evaluation_id
         WHERE e.cycle_id = ${id}::uuid AND e.status = 'PUBLISHED' AND s.evaluator = 'MANAGER'
           ${managerId ? Prisma.sql`AND e.manager_id = ${managerId}::uuid` : Prisma.empty}
         GROUP BY s.competency_id`),
    );
    const avgBy = new Map(perCompetency.map((r) => [r.competency_id, r.avg]));
    const byStatus = { ...EMPTY_STATUS };
    for (const g of groups) byStatus[g.status] = g._count._all;
    const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Math.round(Number(d) * 100) / 100);
    return {
      cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
      byStatus,
      published: agg._count._all,
      averageFinalScore: num(agg._avg.finalScore),
      minFinalScore: num(agg._min.finalScore),
      maxFinalScore: num(agg._max.finalScore),
      competencies: [...cycle.competencies]
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, weight: c.weight, averageManagerScore: avgBy.has(c.id) ? Math.round((avgBy.get(c.id) ?? 0) * 100) / 100 : null })),
    };
  }

  /** Published final scores of a cycle, for distributions and CSV export. */
  async publishedResults(cycleId: string, managerId?: string) {
    const rows = await this.db.client.evaluation.findMany({
      where: { cycleId, status: 'PUBLISHED', ...(managerId ? { managerId } : {}) },
      select: { id: true, employeeId: true, managerId: true, finalScore: true, publishedAt: true },
      orderBy: { id: 'asc' },
      take: 10_000,
    });
    const names = await this.org.names(rows.flatMap((r) => [r.employeeId, r.managerId]));
    return rows.map((r) => ({
      evaluationId: r.id,
      employee: names.get(r.employeeId) ?? '',
      manager: r.managerId ? (names.get(r.managerId) ?? '') : '',
      finalScore: r.finalScore === null ? null : Number(r.finalScore),
      publishedAt: r.publishedAt?.toISOString() ?? null,
    }));
  }

  /** Average final score per cycle, oldest first (trend). */
  async trend(managerId?: string): Promise<{ cycleId: string; name: string; startsOn: string; average: number | null; published: number }[]> {
    const cycles = await this.db.client.evaluationCycle.findMany({ orderBy: { startsOn: 'asc' }, take: 24 });
    const out = [];
    for (const c of cycles) {
      const agg = await this.db.client.evaluation.aggregate({
        where: { cycleId: c.id, status: 'PUBLISHED', ...(managerId ? { managerId } : {}) },
        _avg: { finalScore: true },
        _count: { _all: true },
      });
      out.push({
        cycleId: c.id,
        name: c.name,
        startsOn: c.startsOn.toISOString().slice(0, 10),
        average: agg._avg.finalScore === null ? null : Math.round(Number(agg._avg.finalScore) * 100) / 100,
        published: agg._count._all,
      });
    }
    return out;
  }

  /** EV-08: the manager's open work for the latest cycle. */
  async teamDashboard(managerId: string) {
    const cycleId = await this.latestCycleId();
    const stats = await this.cycleStats(cycleId, managerId);
    const reports = await this.org.directReportIds(managerId);
    const evaluations = cycleId
      ? await this.db.client.evaluation.findMany({
          where: { cycleId, managerId },
          select: { id: true, employeeId: true, status: true, finalScore: true, updatedAt: true },
          orderBy: { id: 'asc' },
        })
      : [];
    const names = await this.org.names([...reports, ...evaluations.map((e) => e.employeeId)]);
    return {
      ...stats,
      directReports: reports.length,
      team: evaluations.map((e) => ({
        evaluationId: e.id,
        employee: { id: e.employeeId, fullName: names.get(e.employeeId) ?? '' },
        status: e.status,
        finalScore: e.finalScore === null ? null : Number(e.finalScore),
        updatedAt: e.updatedAt.toISOString(),
      })),
    };
  }
}
