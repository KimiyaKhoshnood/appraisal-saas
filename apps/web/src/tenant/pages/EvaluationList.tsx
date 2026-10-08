import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { EvaluationSummaryView, Page } from '@appraisal/contracts';
import { Button, Card, PageHeader, QueryState, StatusBadge, Table, Td } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { tenantApi } from '../../lib/api';

const TITLES: Record<string, MessageKey> = {
  mine: 'nav.myEvaluations',
  team: 'nav.team',
  approvals: 'nav.approvals',
  all: 'nav.allEvaluations',
};

export default function EvaluationList({ scope }: { scope: 'mine' | 'team' | 'approvals' | 'all' }) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const q = useInfiniteQuery({
    queryKey: ['evaluations', scope],
    queryFn: ({ pageParam }) =>
      tenantApi.get<Page<EvaluationSummaryView>>(`/api/evaluations?scope=${scope}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={t(TITLES[scope]!)} />
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!rows.length} onRetry={() => void q.refetch()}>
          <Table head={[t('eval.cycle'), t('eval.employee'), t('eval.manager'), t('app.status'), t('eval.finalScore'), '']}>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td>{e.cycle.name}</Td>
                <Td>{e.employee.fullName}</Td>
                <Td>{e.manager?.fullName ?? '—'}</Td>
                <Td>
                  <StatusBadge status={e.status} />
                </Td>
                <Td>{e.finalScore === null ? '—' : formatNumber(e.finalScore)}</Td>
                <Td className="text-end">
                  <Link to={`/evaluations/${e.id}`} className="text-sm font-medium text-brand hover:underline" title={formatDateTime(e.updatedAt)}>
                    {t('dash.open')}
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-4" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {t('audit.loadMore')}
            </Button>
          )}
        </QueryState>
      </Card>
    </>
  );
}
