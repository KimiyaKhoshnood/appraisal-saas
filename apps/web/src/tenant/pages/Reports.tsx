import { useMutation, useQuery } from '@tanstack/react-query';
import type { EvaluationStatus } from '@appraisal/contracts';
import { BarList } from '../../components/charts';
import { Button, Card, ErrorBox, PageHeader, QueryState, Stat } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';
import { useMe } from '../session';

interface Summary {
  cycle: { id: string; name: string } | null;
  byStatus: Record<EvaluationStatus, number>;
  published: number;
  averageFinalScore: number | null;
  minFinalScore: number | null;
  maxFinalScore: number | null;
  competencies: { id: string; name: string; weight: number; averageManagerScore: number | null }[];
}

/** RP-01/RP-02, visible only when the `reports` feature is on (and CSV with `csvExport`). */
export default function ReportsPage() {
  const { t, formatNumber } = useI18n();
  const { has, can } = useMe();
  const q = useQuery({ queryKey: ['reports', 'summary'], queryFn: () => tenantApi.get<Summary>('/api/reports/summary') });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const blob = await tenantApi.download('/api/reports/export.csv');
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `results-${q.data?.cycle?.name ?? 'cycle'}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const d = q.data;
  const fmt = (n: number | null) => (n === null ? '—' : formatNumber(n));
  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        subtitle={d?.cycle?.name}
        actions={
          has('csvExport') &&
          can('evaluation:read-all') && (
            <Button variant="secondary" busy={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
              {t('reports.export')}
            </Button>
          )
        }
      />
      {exportCsv.error && <ErrorBox error={exportCsv.error} />}
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!d?.cycle} onRetry={() => void q.refetch()}>
        {d && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t('reports.published')} value={formatNumber(d.published)} />
              <Stat label={t('reports.average')} value={fmt(d.averageFinalScore)} />
              <Stat label={t('reports.min')} value={fmt(d.minFinalScore)} />
              <Stat label={t('reports.max')} value={fmt(d.maxFinalScore)} />
            </div>
            <Card title={t('reports.summary')}>
              <BarList items={(Object.keys(d.byStatus) as EvaluationStatus[]).map((s) => ({ label: t(`status.${s}`), value: d.byStatus[s] }))} />
            </Card>
            <Card title={t('reports.byCompetency')}>
              <BarList items={d.competencies.map((c) => ({ label: `${c.name} (${c.weight}%)`, value: c.averageManagerScore ?? 0 }))} />
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}
