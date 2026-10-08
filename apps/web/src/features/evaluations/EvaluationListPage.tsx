import { useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { Avatar, Button, Card, EmptyState, Page, PageHeader, QueryState, StatusBadge, Table, Td, Tr } from '../../shared/ui';
import { useEvaluations, type EvaluationScope } from './api';

const TITLES: Record<EvaluationScope, MessageKey> = {
  mine: 'nav.myEvaluations',
  team: 'nav.team',
  approvals: 'nav.approvals',
  all: 'nav.allEvaluations',
};

export default function EvaluationListPage({ scope }: { scope: EvaluationScope }) {
  const { t, formatNumber } = useI18n();
  const navigate = useNavigate();
  const q = useEvaluations(scope);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader title={t(TITLES[scope])} />
      <Card padded>
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!rows.length} onRetry={() => void q.refetch()} empty={<EmptyState title={t('app.empty')} />}>
          <Table head={[t('eval.employee'), t('eval.cycle'), t('eval.manager'), t('app.status'), t('eval.finalScore'), '']}>
            {rows.map((e) => (
              <Tr key={e.id} onClick={() => navigate(`/evaluations/${e.id}`)}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={e.employee.fullName} size="sm" />
                    <span className="font-medium text-fg">{e.employee.fullName}</span>
                  </div>
                </Td>
                <Td className="text-muted">{e.cycle.name}</Td>
                <Td className="text-muted">{e.manager?.fullName ?? '—'}</Td>
                <Td>
                  <StatusBadge status={e.status} />
                </Td>
                <Td className="font-semibold tabular">{e.finalScore === null ? <span className="text-muted">—</span> : formatNumber(e.finalScore)}</Td>
                <Td className="text-end">
                  <ArrowRight className="inline size-4 text-muted rtl:rotate-180" />
                </Td>
              </Tr>
            ))}
          </Table>
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-4" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {t('audit.loadMore')}
            </Button>
          )}
        </QueryState>
      </Card>
    </Page>
  );
}
