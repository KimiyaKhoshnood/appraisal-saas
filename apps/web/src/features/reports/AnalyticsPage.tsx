import { useQuery } from '@tanstack/react-query';
import { ChartColumn, ChartLine } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Card, ColumnChart, LineChart, Page, PageHeader, QueryState, Skeleton } from '../../shared/ui';

interface Overview {
  cycleId: string | null;
  distribution: { from: number; to: number; count: number }[];
  trend: { cycleId: string; name: string; startsOn: string; average: number | null; published: number }[];
}

/** RP-03 (feature `analytics`): the visible difference between plans in demo 2. */
export default function AnalyticsPage() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.analytics, queryFn: () => tenantApi.get<Overview>('/api/analytics/overview') });
  return (
    <Page>
      <PageHeader title={t('nav.analytics')} />
      <QueryState
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        }
      >
        {q.data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('reports.distribution')} icon={<ChartColumn className="size-4" />}>
              <ColumnChart items={q.data.distribution.map((b) => ({ label: `${b.from}–${b.to}`, value: b.count }))} />
            </Card>
            <Card title={t('reports.trend')} icon={<ChartLine className="size-4" />}>
              <LineChart points={q.data.trend.map((p) => ({ label: p.name, value: p.average }))} max={100} />
            </Card>
          </div>
        )}
      </QueryState>
    </Page>
  );
}
