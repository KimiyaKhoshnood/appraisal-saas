import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownToLine, BarChart3, ClipboardCheck, Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import type { EvaluationStatus } from '@appraisal/contracts';
import { useMe } from '../../app/tenant/session';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { BarList, Button, Card, EmptyState, Page, PageHeader, QueryState, SkeletonCards, Stat } from '../../shared/ui';
import { StatusProgress } from '../dashboard/DashboardPage';

interface Summary {
  cycle: { id: string; name: string } | null;
  byStatus: Record<EvaluationStatus, number>;
  published: number;
  averageFinalScore: number | null;
  minFinalScore: number | null;
  maxFinalScore: number | null;
  competencies: { id: string; name: string; weight: number; averageManagerScore: number | null }[];
}

/** RP-01/RP-02, visible only when the `reports` feature is on (CSV with `csvExport`). */
export default function ReportsPage() {
  const { t } = useI18n();
  const { has, can } = useMe();
  const q = useQuery({ queryKey: qk.reports, queryFn: () => tenantApi.get<Summary>('/api/reports/summary') });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const blob = await tenantApi.download('/api/reports/export.csv');
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `results-${q.data?.cycle?.name ?? 'cycle'}.csv` }).click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success(t('reports.export')),
  });
  const d = q.data;
  return (
    <Page>
      <PageHeader
        title={t('nav.reports')}
        subtitle={d?.cycle?.name}
        actions={
          has('csvExport') &&
          can('evaluation:read-all') && (
            <Button variant="secondary" busy={exportCsv.isPending} onClick={() => exportCsv.mutate()} icon={<ArrowDownToLine className="size-4" />}>
              {t('reports.export')}
            </Button>
          )
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!d?.cycle} onRetry={() => void q.refetch()} skeleton={<SkeletonCards />} empty={<EmptyState title={t('dash.noCycle')} />}>
        {d && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('reports.average')} value={d.averageFinalScore} decimals={2} icon={<Gauge className="size-4" />} accent />
              <Stat label={t('reports.published')} value={d.published} icon={<ClipboardCheck className="size-4" />} />
              <Stat label={t('reports.max')} value={d.maxFinalScore} decimals={2} icon={<TrendingUp className="size-4" />} />
              <Stat label={t('reports.min')} value={d.minFinalScore} decimals={2} icon={<TrendingDown className="size-4" />} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title={t('reports.summary')} icon={<BarChart3 className="size-4" />}>
                <StatusProgress byStatus={d.byStatus} />
              </Card>
              <Card title={t('reports.byCompetency')} icon={<BarChart3 className="size-4" />}>
                <BarList items={d.competencies.map((c) => ({ label: `${c.name} · ${c.weight}%`, value: c.averageManagerScore ?? 0 }))} />
              </Card>
            </div>
          </>
        )}
      </QueryState>
    </Page>
  );
}
