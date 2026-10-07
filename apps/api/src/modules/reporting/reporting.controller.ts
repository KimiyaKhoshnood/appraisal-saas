import { Controller, Get, Header, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { NotFoundError, RequireFeature, RequirePermission, TenantContext, ValidQuery } from '../../core';
import { EvaluationReadModel } from '../evaluation';

const cycleQuery = z.object({ cycleId: z.uuid().optional() }).strict();

/** CSV-injection safe cell (OWASP): neutralise leading formula characters, quote everything. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * reporting: read-only, owns no table, reads through evaluation's public read model.
 * Managers see their own team; holders of evaluation:read-all see the organisation.
 */
@Controller()
export class ReportingController {
  constructor(private readonly read: EvaluationReadModel) {}

  private scope(): string | undefined {
    const access = TenantContext.requireAccess();
    return access.permissions.has('evaluation:read-all') ? undefined : access.user.id;
  }

  /** RP-01 (feature: reports) */
  @Get('reports/summary')
  @RequirePermission('report:read')
  @RequireFeature('reports')
  summary(@ValidQuery(cycleQuery) q: z.infer<typeof cycleQuery>) {
    return this.read.cycleStats(q.cycleId ?? null, this.scope());
  }

  /** RP-02 (feature: csvExport) */
  @Get('reports/export.csv')
  @RequirePermission('report:read', 'evaluation:read-all')
  @RequireFeature('csvExport')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@ValidQuery(cycleQuery) q: z.infer<typeof cycleQuery>, @Res({ passthrough: true }) res: Response) {
    const cycleId = q.cycleId ?? (await this.read.latestCycleId());
    if (!cycleId) throw new NotFoundError('cycle');
    const rows = await this.read.publishedResults(cycleId);
    res.setHeader('Content-Disposition', `attachment; filename="results-${cycleId}.csv"`);
    const header = ['evaluation_id', 'employee', 'manager', 'final_score', 'published_at'].map(csvCell).join(',');
    return [header, ...rows.map((r) => [r.evaluationId, r.employee, r.manager, r.finalScore, r.publishedAt].map(csvCell).join(','))].join('\r\n');
  }

  /** RP-03 (feature: analytics): score distribution (10-point buckets) and trend across cycles. */
  @Get('analytics/overview')
  @RequirePermission('analytics:read')
  @RequireFeature('analytics')
  async analytics(@ValidQuery(cycleQuery) q: z.infer<typeof cycleQuery>) {
    const scope = this.scope();
    const cycleId = q.cycleId ?? (await this.read.latestCycleId());
    const results = cycleId ? await this.read.publishedResults(cycleId, scope) : [];
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, count: 0 }));
    for (const r of results) {
      if (r.finalScore === null) continue;
      buckets[Math.min(9, Math.floor(r.finalScore / 10))]!.count++;
    }
    return { cycleId, distribution: buckets, trend: await this.read.trend(scope) };
  }
}
