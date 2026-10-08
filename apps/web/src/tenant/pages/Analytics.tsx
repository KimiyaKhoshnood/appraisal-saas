import { useQuery } from '@tanstack/react-query';
import { ColumnChart, LineChart } from '../../components/charts';
import { Card, PageHeader, QueryState } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';

interface Overview {
  cycleId: string | null;
  distribution: { from: number; to: number; count: number }[];
  trend: { cycleId: string; name: string; startsOn: string; average: number | null; published: number }[];
}

/** RP-03 (feature `analytics`): the visible difference between plans in demo 2. */
export default function AnalyticsPage() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['analytics'], queryFn: () => tenantApi.get<Overview>('/api/analytics/overview') });
  return (
    <>
      <PageHeader title={t('nav.analytics')} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('reports.distribution')}>
              <ColumnChart items={q.data.distribution.map((b) => ({ label: `${b.from}–${b.to}`, value: b.count }))} />
            </Card>
            <Card title={t('reports.trend')}>
              <LineChart points={q.data.trend.map((p) => ({ label: p.name, value: p.average }))} max={100} />
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}
